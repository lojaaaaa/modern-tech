import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarness } from '../server.mjs';

test('two users receive one shared file session with distinct identities', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'office-poc-'));
  await writeFile(join(directory, 'sample.docx'), Buffer.from('fixture'));
  const harness = await createHarness({ corpus: directory, data: directory, secret: 'test-only-secret' });
  await new Promise(resolve => harness.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => harness.close(resolve)); await rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${harness.address().port}`;
  const alice = await (await fetch(`${origin}/config?file=sample.docx&user=alice`)).json();
  const bob = await (await fetch(`${origin}/config?file=sample.docx&user=bob`)).json();
  assert.equal(alice.document.key, bob.document.key);
  assert.equal(alice.editorConfig.user.id, 'alice');
  assert.equal(bob.editorConfig.user.id, 'bob');
  assert.equal(alice.document.fileType, 'docx');
  assert.equal(alice.editorConfig.mode, 'edit');
  assert.equal(alice.editorConfig.coEditing.mode, 'fast');
  assert.equal((await fetch(`${origin}/config?file=../secret&user=alice`)).status, 404);
});

test('a forged callback cannot replace a fixture or report a successful save', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'office-poc-'));
  await writeFile(join(directory, 'sample.docx'), Buffer.from('original fixture'));
  const harness = await createHarness({ corpus: directory, data: directory, secret: 'test-only-secret' });
  await new Promise(resolve => harness.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => harness.close(resolve)); await rm(directory, { recursive: true }); });
  const origin = `http://127.0.0.1:${harness.address().port}`;
  const config = await (await fetch(`${origin}/config?file=sample.docx&user=alice`)).json();
  const callback = await fetch(`${origin}/callback/sample.docx`, { method: 'POST', body: JSON.stringify({ key: config.document.key, status: 2, url: 'http://untrusted.invalid/replacement.docx', token: 'forged' }) });
  assert.equal(callback.status, 403);
  assert.equal(await (await fetch(`${origin}/files/sample.docx`)).text(), 'original fixture');
  assert.deepEqual(await (await fetch(`${origin}/events`)).json(), []);
});
