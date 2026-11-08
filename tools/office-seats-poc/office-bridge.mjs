import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const origin = new URL(process.env.OFFICE_INTERNAL_URL || 'http://documentserver');
const secret = process.env.JWT_SECRET || 'local-office-demo-only';
const docs = new Map();
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
const docKey = doc => { if (!docs.has(doc)) docs.set(doc, randomUUID()); return docs.get(doc); };
const headers = req => ({...req.headers, host: origin.host, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http', cookie: ''});
const html = lease => `<!doctype html><html><head><meta charset="utf-8"><title>Seat PoC</title><style>html,body,#editor{height:100%;margin:0}</style><script src="/web-apps/apps/api/documents/api.js"></script></head><body><div id="editor"></div><script>
fetch('/office-config').then(r => { if (!r.ok) throw Error('access denied'); return r.json(); }).then(config => new DocsAPI.DocEditor('editor',config)).catch(error => document.body.textContent = error.message);
setInterval(() => fetch('/heartbeat',{method:'POST'}).then(r => {if (!r.ok) location.reload();}).catch(() => {}), ${Math.max(300, Math.floor(lease / 3))});
window.addEventListener('pagehide', () => navigator.sendBeacon('/close', '{}'));
</script></body></html>`;

export function createOfficeBridge({ sessionFor, rightsFor, lease, sessions }) {
  const permitted = session => session?.active && Date.now() < session.deadline && (() => { const r = rightsFor(session.doc, session.user); return r.read && !r.blocked && (r.edit || r.comment); })();
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname.startsWith('/office-source/')) {
      // This unguessable capability is supplied to Document Server, never as a public static path.
      const token = url.pathname.slice('/office-source/'.length).replace(/\.docx$/, '');
      const session = sessions.get(token);
      if (!permitted(session)) return json(res, 403, {error: 'forbidden'}), true;
      const bytes = await readFile(new URL('./sample.docx', import.meta.url));
      res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store'});
      res.end(bytes); return true;
    }
    if (req.method === 'POST' && url.pathname === '/office-callback') {
      let data = '';
      for await (const chunk of req) { data += chunk; if (data.length > 1024 * 1024) throw Error('callback too large'); }
      let payload;
      try { const body = JSON.parse(data); payload = verify(body.token || req.headers.authorization?.replace(/^Bearer /i, '')); } catch { json(res, 403, {error: 1}); return true; }
      if (![...docs.values()].includes(payload.key)) { json(res, 403, {error: 1}); return true; }
      // Saves intentionally fail: fixture persistence and document-key rotation are not implemented.
      json(res, 200, {error: [2, 6].includes(payload.status) ? 1 : 0}); return true;
    }
    const session = sessionFor(req);
    if (req.method === 'GET' && url.pathname === '/editor') {
      if (!permitted(session)) { json(res, 403, {error: 'draft forbidden'}); return true; }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}); res.end(html(lease)); return true;
    }
    if (req.method === 'GET' && url.pathname === '/office-config') {
      if (!permitted(session)) { json(res, 403, {error: 'draft forbidden'}); return true; }
      const r = rightsFor(session.doc, session.user);
      const config = {documentType: 'word', width: '100%', height: '100%',
        document: {fileType: 'docx', key: docKey(session.doc), title: 'sample.docx', url: `http://gateway:8894/office-source/${session.token}.docx`, permissions: {edit: Boolean(session.seated && r.edit), comment: r.comment, download: false}},
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
