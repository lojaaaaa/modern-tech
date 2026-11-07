import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { docx: 'word', xlsx: 'cell', pptx: 'slide' };
const names = { alice: 'Алиса Петрова', bob: 'Борис Иванов' };

function token(payload, secret) {
  const encoded = [ { alg: 'HS256', typ: 'JWT' }, payload ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
}

function verified(encoded, secret) {
  if (typeof encoded !== 'string') throw new Error('Missing callback signature');
  const [header, payload, signature, extra] = encoded.split('.');
  if (extra || !signature || JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') throw new Error('Invalid callback signature');
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid callback signature');
  const result = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (result.exp && result.exp < Date.now() / 1000) throw new Error('Expired callback signature');
  return result.payload ?? result;
}

export async function createHarness(options = {}) {
  const corpus = options.corpus ?? process.env.CORPUS ?? join(root, 'corpus');
  const data = options.data ?? process.env.DATA ?? join(root, 'data');
  const secret = options.secret ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('Set JWT_SECRET in the isolated PoC environment');
  const internal = process.env.HARNESS_INTERNAL_URL ?? 'http://harness:8890';
  const office = process.env.OFFICE_INTERNAL_URL ?? 'http://documentserver';
  const officePublic = process.env.OFFICE_PUBLIC_URL ?? 'http://localhost:8891';
  await mkdir(data, { recursive: true });
  const stateFile = join(data, 'sessions.json');
  let sessions;
  try { sessions = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; sessions = {}; }
  const events = [];
  const persist = async () => { await writeFile(`${stateFile}.tmp`, JSON.stringify(sessions, null, 2)); await rename(`${stateFile}.tmp`, stateFile); };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const source = async name => {
    try { return await readFile(join(data, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; return await readFile(join(corpus, name)); }
  };
  const validFile = name => /^sample\.(docx|xlsx|pptx)$/.test(name);
  const record = async event => {
    const item = { at: new Date().toISOString(), ...event };
    events.push(item);
    if (events.length > 500) events.shift();
    await writeFile(join(data, 'events.json'), JSON.stringify(events, null, 2));
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, candidate: 'ONLYOFFICE Community 9.4.0.1' });
      if (req.method === 'GET' && url.pathname === '/events') return json(res, 200, events);
      if (req.method === 'GET' && url.pathname === '/config') {
        const file = url.searchParams.get('file');
        const user = url.searchParams.get('user');
        if (!validFile(file) || !names[user]) return json(res, 404, { error: 'Unknown fixture or participant' });
        await source(file);
        if (!sessions[file] || sessions[file].closed) {
          sessions[file] = { key: randomUUID(), closed: false };
          await persist();
        }
        const extension = file.split('.').pop();
        const config = {
          documentType: types[extension], width: '100%', height: '100%',
          document: { fileType: extension, key: sessions[file].key, title: file, url: `${internal}/files/${file}`, permissions: { edit: true, comment: true, download: true } },
          editorConfig: { mode: 'edit', lang: 'en', user: { id: user, name: names[user] }, callbackUrl: `${internal}/callback/${file}`, coEditing: { mode: 'fast', change: false }, customization: { autosave: true, forcesave: true, anonymous: { request: false }, help: false, feedback: false } },
        };
        config.token = token(config, secret);
        return json(res, 200, config);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
        const name = url.pathname.slice('/files/'.length);
        if (!validFile(name)) return json(res, 404, { error: 'Unknown fixture' });
        const content = await source(name);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
        return res.end(content);
      }
      if (req.method === 'POST' && (url.pathname.startsWith('/callback/') || url.pathname.startsWith('/forcesave/'))) {
        const file = url.pathname.split('/').pop();
        if (!validFile(file) || !sessions[file]) return json(res, 404, { error: 'Unknown session' });
        if (url.pathname.startsWith('/forcesave/')) {
          const command = { c: 'forcesave', key: sessions[file].key };
          const response = await fetch(`${office}/coauthoring/CommandService.ashx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, token: token(command, secret) }), signal: AbortSignal.timeout(15000) });
          return json(res, response.status, await response.json());
        }
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1048576) return json(res, 413, { error: 1 }); }
        const received = JSON.parse(body);
        let payload;
        try { payload = verified(received.token ?? req.headers.authorization?.replace(/^Bearer /i, ''), secret); } catch { return json(res, 403, { error: 1 }); }
        if (payload.key !== sessions[file].key || sessions[file].closed) return json(res, 409, { error: 1 });
        const event = { file, key: payload.key, status: payload.status, users: payload.users ?? [] };
        if ([2, 6].includes(payload.status)) {
          const download = new URL(payload.url);
          const accepted = [new URL(office).origin, new URL(officePublic).origin];
          if (!accepted.includes(download.origin) || download.username || download.password || !download.pathname.startsWith('/cache/')) return json(res, 400, { error: 1 });
          const response = await fetch(`${office}${download.pathname}${download.search}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
          if (!response.ok) return json(res, 502, { error: 1 });
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 50 * 1024 * 1024 || bytes.subarray(0, 2).toString() !== 'PK') return json(res, 400, { error: 1 });
          await writeFile(join(data, `${file}.tmp`), bytes);
          await rename(join(data, `${file}.tmp`), join(data, file));
          event.sha256 = createHash('sha256').update(bytes).digest('hex');
          event.bytes = bytes.length;
        }
        if ([2, 4].includes(payload.status)) { sessions[file].closed = true; await persist(); }
        await record(event);
        return json(res, 200, { error: 0 });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const html = (await readFile(join(root, 'web/index.html'), 'utf8')).replaceAll('__OFFICE_PUBLIC_URL__', officePublic);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.code === 'ENOENT') return json(res, 404, { error: 'Fixture not generated' });
      console.error(error.message);
      return json(res, 500, { error: 'PoC request failed' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createHarness();
  server.listen(Number(process.env.PORT ?? 8890), '0.0.0.0', () => console.log('Isolated Office PoC on port 8890'));
}
