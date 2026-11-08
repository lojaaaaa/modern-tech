import assert from 'node:assert/strict';
import { test } from 'node:test';

const base = process.env.POC_URL || 'http://127.0.0.1:8894';
const secret = process.env.POC_SECRET || 'local-demo-only';
async function request(path, {token, body} = {}) {
  const response = await fetch(base + path, {method: body ? 'POST' : 'GET', headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  return {status: response.status, value: await response.json()};
}
async function login(user, doc) {
  return (await request('/session', {body: {user, doc, password: secret}})).value;
}

test('последнее место атомарно, вкладки учитываются отдельно и открытый поток закрывается при отзыве', async () => {
  const doc = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const users = await Promise.all(Array.from({length: 9}, (_, i) => login(`user${i}`, doc)));
  assert.ok(users.every(u => u.mode === 'edit'));
  const tab = await login('user0', doc);
  assert.equal(tab.mode, 'edit');
  const racers = await Promise.all([login('racer1', doc), login('racer2', doc)]);
  assert.deepEqual(racers.map(u => u.mode).sort(), ['comment', 'edit']);
  await request('/close', {token: users[0].token, body: {}});
  const denied = racers.find(u => u.mode === 'comment');
  assert.equal((await request('/seat', {token: denied.token, body: {}})).value.mode, 'comment');
  await request('/close', {token: tab.token, body: {}});
  assert.equal((await request('/seat', {token: denied.token, body: {}})).value.mode, 'edit');
  const stream = await fetch(base + '/draft/stream', {headers: {authorization: `Bearer ${denied.token}`}});
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  assert.equal((await reader.read()).done, false);
  const revoked = await request('/admin/permissions', {body: {secret, doc, user: denied.user, read: true, comment: false, edit: false, blocked: false}});
  assert.equal(revoked.status, 200);
  const ended = await Promise.race([reader.read().then(() => true, () => true), new Promise(resolve => setTimeout(() => resolve(false), 2000))]);
  assert.equal(ended, true, 'open stream must close');
  assert.equal((await request('/draft', {token: denied.token})).status, 401);
  const readOnly = await login(denied.user, doc);
  assert.equal(readOnly.mode, 'view');
  assert.equal((await request('/draft', {token: readOnly.token})).status, 403);
  assert.equal((await request('/published', {token: readOnly.token})).status, 200);
  for (const session of [...users, tab, ...racers, readOnly]) await request('/close', {token: session.token, body: {}});
});

test('права edit и comment проверяются независимо при смене доступа', async () => {
  const doc = `rights-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = 'editor';
  const editor = await login(user, doc);
  assert.equal(editor.mode, 'edit');
  let change = await request('/admin/permissions', {body: {secret, doc, user, read: true, comment: false, edit: true, blocked: false}});
  assert.equal(change.status, 200);
  assert.equal((await request('/draft', {token: editor.token})).status, 401);
  const editOnly = await login(user, doc);
  assert.equal(editOnly.mode, 'edit');
  assert.equal((await request('/draft', {token: editOnly.token})).status, 200);
  change = await request('/admin/permissions', {body: {secret, doc, user, read: true, comment: true, edit: false, blocked: false}});
  assert.equal(change.status, 200);
  const commenter = await login(user, doc);
  assert.equal(commenter.mode, 'comment');
  assert.equal((await request('/draft', {token: commenter.token})).status, 200);
  change = await request('/admin/permissions', {body: {secret, doc, user, read: true, comment: true, edit: false, blocked: true}});
  assert.equal(change.status, 200);
  assert.equal((await request('/draft', {token: commenter.token})).status, 401);
  assert.equal((await request('/session', {body: {doc, user, password: secret}})).status, 403);
});
