import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('мост отказывает в ответе, не заменяя нативную ветку', async () => {
  const source = await readFile(new URL('../web/plugin/code.js', import.meta.url), 'utf8');
  const calls = [];
  let receive;
  const response = new Promise(resolve => {
    const top = { postMessage: message => { if (message.kind === 'response') resolve(message); } };
    const window = { top, addEventListener: (name, handler) => { if (name === 'message') receive = handler; } };
    const element = {};
    const Asc = { plugin: { executeMethod: (name, args, callback) => {
      calls.push(name);
      callback(name === 'GetAllComments' ? [{ Id: 'thread', Data: { Replies: [] } }] : true);
    } } };
    vm.runInNewContext(source, { window, Asc, location: { pathname: '/plugin/alice/sample.docx/index.html', origin: 'http://localhost:8890' }, document: { querySelector: () => element }, setTimeout, clearTimeout, console });
    receive({ origin: 'http://localhost:8890', source: top, data: { channel: 'office-discussion-v1', kind: 'request', user: 'alice', file: 'sample.docx', id: 1, op: 'reply', value: { id: 'thread', text: 'Ответ' } } });
  });
  const message = await response;
  assert.match(message.error, /ответ.*недоступ/i);
  assert.equal(calls.includes('ChangeComment'), false);
});
