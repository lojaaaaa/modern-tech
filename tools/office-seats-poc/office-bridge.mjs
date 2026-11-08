import http from 'node:http';
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { validateDocx } from './docx.mjs';

const origin = new URL(process.env.OFFICE_INTERNAL_URL || 'http://documentserver');
const secret = process.env.JWT_SECRET || 'local-office-demo-only';
const docs = new Map();
const dataDir = process.env.OFFICE_DATA_DIR || '/tmp/office-seats-poc-data';
const maxFileBytes = 50 * 1024 * 1024;
const jwt = payload => {
  const part = [{alg: 'HS256', typ: 'JWT'}, payload].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`;
};
function verify(encoded) {
  const [header, payload, signature, extra] = (encoded || '').split('.');
  if (!signature || extra || JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') throw Error('invalid JWT');
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('invalid signature');
  const data = JSON.parse(Buffer.from(payload, 'base64url'));
  if (data.exp && data.exp <= Date.now() / 1000) throw Error('expired JWT');
  return data.payload || data;
}
const json = (res, status, value) => { res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(value)); };
const filePath = doc => join(dataDir, `${createHash('sha256').update(doc).digest('hex')}.docx`);
function documentState(doc) {
  let state = docs.get(doc);
  if (!state || state.closed) { state = {doc, key: randomUUID(), sessions: new Set(), hosts: new Set(), closed: false, saving: false}; docs.set(doc, state); }
  return state;
}
async function source(doc) {
  try { return await readFile(filePath(doc)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return readFile(new URL('./sample.docx', import.meta.url)); }
}
async function save(state, downloadUrl) {
  const url = new URL(downloadUrl);
  if (url.username || url.password || !url.pathname.startsWith('/cache/') || (url.origin !== origin.origin && !(url.protocol === 'http:' && state.hosts.has(url.host)))) throw Error('Invalid save URL');
  // Browser-facing callback URLs are accepted only for this document's known
  // session hosts; download always targets the configured private server.
  const response = await fetch(new URL(url.pathname + url.search, origin), {redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (!response.ok || Number(response.headers.get('content-length') || 0) > maxFileBytes || !response.body) throw Error('Invalid save response');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxFileBytes) throw Error('Saved DOCX too large');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, length);
  validateDocx(bytes);
  await mkdir(dataDir, {recursive: true});
  const destination = filePath(state.doc);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}
const headers = req => ({...req.headers, host: origin.host, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http', cookie: ''});
const editorPage = new URL('./editor.html', import.meta.url);

export function createOfficeBridge({ sessionFor, rightsFor, lease, sessions }) {
  const permitted = session => session?.active && Date.now() < session.deadline && (() => { const r = rightsFor(session.doc, session.user); return r.read && !r.blocked && (r.edit || r.comment); })();
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname.startsWith('/office-source/')) {
      // Separate capability cannot authenticate any of the session API routes.
      const capability = url.pathname.slice('/office-source/'.length).replace(/\.docx$/, '');
      const session = [...sessions.values()].find(candidate => candidate.sourceCapability === capability);
      if (!permitted(session)) return json(res, 403, {error: 'forbidden'}), true;
      const bytes = await source(session.doc);
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store'});
      res.end(bytes); return true;
    }
    if (req.method === 'POST' && url.pathname === '/office-callback') {
      let data = '';
      for await (const chunk of req) { data += chunk; if (data.length > 1024 * 1024) throw Error('callback too large'); }
      let payload;
      try { const body = JSON.parse(data); payload = verify(body.token || req.headers.authorization?.replace(/^Bearer /i, '')); } catch { json(res, 403, {error: 1}); return true; }
      const state = [...docs.values()].find(doc => doc.key === payload.key);
      if (!state || state.closed || state.saving) { json(res, 409, {error: 1}); return true; }
      if (payload.status === 2) {
        state.saving = true;
        try {
          const result = await save(state, payload.url);
          state.closed = true;
          console.log(`Saved isolated DOCX: ${result.bytes} bytes sha256=${result.sha256}`);
          json(res, 200, {error: 0});
        } catch (error) {
          console.error('DOCX save failed:', error.message);
          json(res, 200, {error: 1});
        } finally { state.saving = false; }
        return true;
      }
      if (payload.status === 4) state.closed = true;
      // Force-save ordering is not established; reject it instead of overwriting a newer draft.
      json(res, 200, {error: [1, 4].includes(payload.status) ? 0 : 1}); return true;
    }
    const session = sessionFor(req);
    if (req.method === 'GET' && url.pathname === '/editor') {
      if (!permitted(session)) { json(res, 403, {error: 'draft forbidden'}); return true; }
      const html = (await readFile(editorPage, 'utf8')).replace('__HEARTBEAT_MS__', String(Math.max(300, Math.floor(lease / 3))));
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}); res.end(html); return true;
    }
    if (req.method === 'GET' && url.pathname === '/office-config') {
      if (!permitted(session)) { json(res, 403, {error: 'draft forbidden'}); return true; }
      const r = rightsFor(session.doc, session.user);
      const state = documentState(session.doc);
      if (state.saving || (state.sessions.size && ![...state.sessions].some(token => sessions.get(token)?.active))) {
        json(res, 409, {error: 'waiting for editor save callback'}); return true;
      }
      state.sessions.add(session.token);
      state.hosts.add(`${session.id}.localhost:${Number(process.env.POC_PUBLIC_PORT || 8894)}`);
      const config = {documentType: 'word', width: '100%', height: '100%',
        document: {fileType: 'docx', key: state.key, title: 'sample.docx', url: `http://gateway:8894/office-source/${session.sourceCapability}.docx`, permissions: {edit: Boolean(session.seated && r.edit), comment: r.comment, download: false}},
        editorConfig: {mode: session.seated && r.edit || r.comment ? 'edit' : 'view', user: {id: session.user, name: session.user}, callbackUrl: 'http://gateway:8894/office-callback', customization: {autosave: true, forcesave: false}}};
      config.token = jwt(config); json(res, 200, config); return true;
    }
    if (!permitted(session)) { json(res, 403, {error: 'draft forbidden'}); return true; }
    if (/^\/(?:coauthoring\/CommandService\.ashx|office-source|office-callback)/i.test(url.pathname)) { json(res, 403, {error: 'forbidden'}); return true; }
    const upstream = http.request(origin, {method: req.method, path: req.url, headers: headers(req)}, proxyRes => {
      if (!permitted(session)) { proxyRes.destroy(); res.destroy(); return; }
      const responseHeaders = {...proxyRes.headers};
      delete responseHeaders['set-cookie'];
      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });
    session.streams.add(res);
    res.on('close', () => { session.streams.delete(res); upstream.destroy(); });
    upstream.on('error', () => { if (!res.headersSent) json(res, 502, {error: 'editor unavailable'}); else res.destroy(); });
    req.pipe(upstream); return true;
  }
  function upgrade(req, socket, head) {
    const session = sessionFor(req);
    if (!permitted(session)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    session.streams.add(socket);
    const upstream = http.request(origin, {method: req.method, path: req.url, headers: headers(req)});
    socket.on('close', () => { session.streams.delete(socket); upstream.destroy(); });
    socket.on('error', () => upstream.destroy());
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      if (!permitted(session)) { upstreamSocket.destroy(); socket.destroy(); return; }
      session.streams.add(upstreamSocket);
      upstreamSocket.on('close', () => { session.streams.delete(upstreamSocket); socket.destroy(); });
      upstreamSocket.on('error', () => socket.destroy());
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + response.rawHeaders.reduce((acc, value, index, all) => index % 2 ? acc : acc + `${value}: ${all[index + 1]}\r\n`, '') + '\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.end();
  }
  return {handle, upgrade};
}
