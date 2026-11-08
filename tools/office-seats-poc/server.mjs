import http from 'node:http';
import net from 'node:net';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createOfficeBridge } from './office-bridge.mjs';

const secret = process.env.POC_SECRET || 'local-demo-only';
const lease = Number(process.env.LEASE_MS || 30000);
if (!Number.isInteger(lease) || lease < 1000) throw Error('LEASE_MS must be at least 1000');
const sessions = new Map();
const launches = new Map();
const publicPort = Number(process.env.POC_PUBLIC_PORT || 8894);
if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) throw Error('Invalid POC_PUBLIC_PORT');
const permissions = new Map();
const docKey = doc => createHash('sha256').update(doc).digest('hex');
const permissionKey = (doc, user) => JSON.stringify([doc, user]);
const defaultRights = {read: true, comment: true, edit: true, blocked: false};
const rightsFor = (doc, user) => permissions.get(permissionKey(doc, user)) || defaultRights;

// No expiration is reclaimed by Redis alone: the gateway must first close every
// stream controlled by it. Orphans after a crash intentionally remain reserved.
const acquire = `
local old = redis.call('HGET', KEYS[2], ARGV[1])
if old and old ~= ARGV[2] then return -1 end
local people = {}
for _, user in ipairs(redis.call('HVALS', KEYS[2])) do people[user] = true end
local count = 0
for _ in pairs(people) do count = count + 1 end
if not people[ARGV[2]] and count >= 10 then return 0 end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
return 1`;
const renew = `
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then return 0 end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local expiry = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expiry or tonumber(expiry) <= now then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
return 1`;
const release = `
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[1])
return 1`;

function redisCommand(args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379)});
    let data = Buffer.alloc(0);
    socket.setTimeout(3000, () => socket.destroy(new Error('Redis timeout')));
    socket.on('error', reject);
    socket.on('end', () => reject(new Error('Redis disconnected before reply')));
    socket.on('close', () => reject(new Error('Redis connection closed before reply')));
    socket.on('connect', () => socket.write(`*${args.length}\r\n` + args.map(arg => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join('')));
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      const end = data.indexOf('\r\n');
      if (end < 0) return;
      const prefix = String.fromCharCode(data[0]);
      const line = data.subarray(1, end).toString();
      if (prefix === ':') { socket.end(); resolve(Number(line)); }
      else if (prefix === '-') { socket.end(); reject(new Error(`Redis: ${line}`)); }
      else { socket.destroy(); reject(new Error('Unexpected Redis reply')); }
    });
  });
}
function run(script, session) {
  const hash = docKey(session.doc);
  return redisCommand(['EVAL', script, '2', `poc:seats:{${hash}}:exp`, `poc:seats:{${hash}}:users`, session.id, session.user, lease]);
}
function closeStreams(session) {
  for (const response of session.streams) response.destroy();
  session.streams.clear();
}
async function invalidate(session) {
  if (!session.active) return;
  session.active = false;
  sessions.delete(session.token);
  launches.delete(session.launchCode);
  closeStreams(session);
  if (session.seated) await run(release, session);
}
async function reserve(session) {
  if (!session.active) return false;
  const rights = rightsFor(session.doc, session.user);
  if (!rights.edit || rights.blocked) return false;
  const acquired = await run(acquire, session);
  if (acquired !== 1) return false;
  // An access change can happen while Redis is processing the request.
  if (!session.active || rightsFor(session.doc, session.user) !== rights) {
    await run(release, session);
    return false;
  }
  session.seated = true;
  session.deadline = Date.now() + lease;
  return true;
}
function mode(session) {
  const rights = rightsFor(session.doc, session.user);
  return session.seated && rights.edit ? 'edit' : rights.comment ? 'comment' : 'view';
}
function json(res, status, value) { res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}); res.end(JSON.stringify(value)); }
async function body(req) {
  let result = '';
  for await (const chunk of req) { result += chunk; if (result.length > 4096) throw Error('request too large'); }
  return JSON.parse(result || '{}');
}
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function currentSession(req) {
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '')?.[1];
  const token = bearer || /(?:^|;\s*)poc_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  const session = sessions.get(token);
  return session?.active && (bearer || req.headers.host === `${session.id}.localhost:${publicPort}`) ? session : null;
}
const bridge = createOfficeBridge({sessionFor: currentSession, rightsFor, lease, sessions});
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, {ok: true});
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store'});
      return res.end(`<!doctype html><meta charset="utf-8"><title>Seat PoC</title><form><label>Документ <input name="doc" value="doc1" required></label><label>Пользователь <input name="user" value="alice" required></label><label>Пароль <input name="password" type="password" required></label><button>Открыть</button></form><p id="error"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch('/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok){document.querySelector('#error').textContent='Не удалось создать сессию';return}location.href=(await r.json()).editorUrl}</script>`);
    }
    if (req.method === 'GET' && req.url === '/bootstrap') {
      res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      return res.end(`<!doctype html><meta charset="utf-8"><title>Seat PoC</title><p>Открываем редактор…</p><script>const code=location.hash.slice(1);history.replaceState(null,'','/bootstrap');fetch('/office-bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})}).then(r=>{if(!r.ok)throw Error();location.replace('/editor')}).catch(()=>document.querySelector('p').textContent='Ссылка недействительна или сессия завершена')</script>`);
    }
    if (req.method === 'POST' && req.url === '/office-bootstrap') {
      const input = await body(req);
      const session = launches.get(input.code);
      const host = session && `${session.id}.localhost:${publicPort}`;
      if (!session?.active || Date.now() >= session.deadline || req.headers.host !== host || req.headers.origin !== `http://${host}`) return json(res, 403, {error:'invalid launch'});
      launches.delete(input.code);
      res.setHeader('set-cookie', `poc_session=${session.token}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, 200, {ok:true});
    }
    if (req.method === 'POST' && req.url === '/session') {
      const input = await body(req);
      if (input.password !== secret || !validId(input.doc) || !validId(input.user)) return json(res, 401, {error: 'unauthorized'});
      const rights = rightsFor(input.doc, input.user);
      if (!rights.read || rights.blocked) return json(res, 403, {error: 'forbidden'});
      const session = {id: randomUUID(), token: randomBytes(32).toString('base64url'), sourceCapability: randomBytes(32).toString('base64url'), launchCode: randomBytes(32).toString('base64url'), doc: input.doc, user: input.user, active: true, seated: false, deadline: Date.now() + lease, streams: new Set()};
      sessions.set(session.token, session);
      try { if (rights.edit) await reserve(session); } catch (error) { await invalidate(session); throw error; }
      if (!session.active || rightsFor(session.doc, session.user) !== rights) { await invalidate(session); return json(res, 403, {error: 'permission changed'}); }
      launches.set(session.launchCode, session);
      return json(res, 200, {token: session.token, user: session.user, mode: mode(session), editorUrl: `http://${session.id}.localhost:${publicPort}/bootstrap#${session.launchCode}`});
    }
    if (req.method === 'POST' && req.url === '/admin/permissions') {
      const input = await body(req);
      if (input.secret !== secret) return json(res, 401, {error: 'unauthorized'});
      if (!validId(input.doc) || !validId(input.user) || !['read','comment','edit','blocked'].every(k => typeof input[k] === 'boolean')) return json(res, 400, {error: 'invalid permissions'});
      if (!input.read && (input.comment || input.edit)) return json(res, 400, {error: 'inconsistent permissions'});
      permissions.set(permissionKey(input.doc, input.user), {read: input.read, comment: input.comment, edit: input.edit, blocked: input.blocked});
      await Promise.all([...sessions.values()].filter(s => s.doc === input.doc && s.user === input.user).map(invalidate));
      return json(res, 200, {ok: true});
    }
    if (req.url.startsWith('/office-source/') || req.url === '/office-callback') return await bridge.handle(req, res);
    const session = currentSession(req);
    if (!session) return json(res, 401, {error: 'unauthorized'});
    // SameSite cookies also cover sibling localhost origins: browser mutations
    // must originate from the exact host assigned to this session.
    if (req.method === 'POST' && !/^Bearer [A-Za-z0-9_-]+$/.test(req.headers.authorization || '') && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, {error: 'invalid origin'});
    if (Date.now() >= session.deadline) { await invalidate(session); return json(res, 401, {error: 'expired'}); }
    const rights = rightsFor(session.doc, session.user);
    if (!rights.read || rights.blocked) { await invalidate(session); return json(res, 403, {error: 'forbidden'}); }
    if (req.method === 'POST' && req.url === '/close') { await invalidate(session); return json(res, 200, {ok: true}); }
    if (req.method === 'POST' && req.url === '/heartbeat') {
      if (session.seated && await run(renew, session) !== 1) { await invalidate(session); return json(res, 401, {error: 'expired'}); }
      if (!session.active) return json(res, 401, {error: 'revoked'});
      session.deadline = Date.now() + lease;
      return json(res, 200, {mode: mode(session), canRequestEdit: rightsFor(session.doc, session.user).edit && !session.seated});
    }
    if (req.method === 'POST' && req.url === '/seat') {
      if (!session.seated && rights.edit) await reserve(session);
      if (!session.active) return json(res, 401, {error: 'revoked'});
      return json(res, 200, {mode: mode(session), canRequestEdit: rightsFor(session.doc, session.user).edit && !session.seated});
    }
    if (req.method === 'GET' && req.url === '/published') return json(res, 200, {content: 'public version fixture'});
    if (req.method === 'GET' && (req.url === '/draft' || req.url === '/draft/stream')) {
      if (!rights.comment && !rights.edit) return json(res, 403, {error: 'draft forbidden'});
      if (req.url === '/draft') return json(res, 200, {content: 'draft fixture'});
      res.writeHead(200, {'content-type': 'text/plain', 'cache-control': 'no-store'});
      res.write('draft event\n');
      session.streams.add(res);
      const timer = setInterval(() => res.write('draft event\n'), 1000);
      res.on('close', () => { clearInterval(timer); session.streams.delete(res); });
      return;
    }
    return await bridge.handle(req, res);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) json(res, 503, {error: 'service unavailable'}); else res.destroy();
  }
});
server.on('upgrade', bridge.upgrade);
setInterval(() => {
  for (const session of sessions.values()) if (Date.now() >= session.deadline) invalidate(session).catch(error => console.error('expiry release failed:', error.message));
}, Math.min(1000, lease / 4)).unref();
server.listen(8894, '0.0.0.0', () => console.log('Seat PoC listening on 8894'));
