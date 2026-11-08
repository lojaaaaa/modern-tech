import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('отзыв закрывает уже начатую передачу файла и запрещает повтор', async t => {
  const base = process.env.POC_URL || 'http://127.0.0.1:8894';
  const data = process.env.OFFICE_DATA_DIR || '/tmp/office-seats-poc-data';
  const secret = process.env.POC_SECRET || 'local-demo-only';
  const doc = `stream-${randomUUID()}`, user = 'stream-reader';
  const path = join(data, `${createHash('sha256').update(doc).digest('hex')}.docx`);
  await mkdir(data, {recursive: true});
  await writeFile(path, Buffer.alloc(32 * 1024 * 1024, 1));
  t.after(() => unlink(path).catch(() => {}));
  const post = async (path, body, token) => fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization:`Bearer ${token}`} : {})}, body: JSON.stringify(body)});
  const login = await post('/session', {doc, user, password:secret});
  assert.equal(login.status, 200);
  const session = await login.json();
  const config = await (await fetch(base + '/office-config', {headers: {authorization:`Bearer ${session.token}`}})).json();
  const source = new URL(config.document.url).pathname;
  const response = await new Promise((resolve, reject) => {
    const req = http.get(base + source, res => { res.pause(); resolve(res); });
    req.on('error', reject);
  });
  assert.equal(response.statusCode, 200);
  const ended = new Promise((resolve, reject) => {
    let bytes = 0;
    response.on('data', chunk => { bytes += chunk.length; });
    response.on('aborted', () => resolve({aborted:true, bytes}));
    response.on('end', () => resolve({aborted:false, bytes}));
    response.on('error', () => resolve({aborted:true, bytes}));
    setTimeout(() => reject(Error('active source stream did not close')), 5000).unref();
  });
  assert.equal((await post('/admin/permissions', {secret, doc, user, read:false, comment:false, edit:false, blocked:false})).status, 200);
  response.resume();
  const result = await ended;
  assert.equal(result.aborted, true);
  assert.ok(result.bytes < 32 * 1024 * 1024);
  assert.equal((await fetch(base + source)).status, 403);
});
