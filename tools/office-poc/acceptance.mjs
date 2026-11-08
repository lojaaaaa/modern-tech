// Real editor acceptance: no mocks, paid connector, or private editor state.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = process.env.POC_URL ?? 'http://localhost:8890';
const office = process.env.OFFICE_PUBLIC_URL ?? 'http://localhost:8891';
const formats = process.argv.slice(2).length ? process.argv.slice(2) : ['docx', 'xlsx', 'pptx'];
assert(formats.every(format => ['docx', 'xlsx', 'pptx'].includes(format)), 'Formats: docx xlsx pptx');
const run = new Date().toISOString().replace(/[:.]/g, '-');
const output = fileURLToPath(new URL(`./data/acceptance/${run}/`, import.meta.url));
await mkdir(output, { recursive: true });
const report = { at: new Date().toISOString(), run, kind: 'live-native-editor-acceptance', base, office, formats: {}, result: 'running' };
const names = { alice: 'Алиса Петрова', bob: 'Борис Иванов' };
let browser;
let active = [];
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
const persist = async () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));

async function until(description, inspect, accepts, timeout = 45000) {
  const started = Date.now();
  let value;
  while (Date.now() - started < timeout) {
    value = await inspect();
    if (accepts(value)) return value;
    await pause(500);
  }
  throw new Error(`${description}: timed out; last value=${JSON.stringify(value).slice(0, 1500)}`);
}

async function request(path, method = 'GET') {
  const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return await response.json();
}

async function plugin(page) {
  return await until('free validation plugin initialization', async () => {
    for (const frame of page.frames()) {
      if (frame.url().includes('/plugin/') && /\/index\.html(?:[?#]|$)/.test(frame.url()) && await frame.evaluate(() => Boolean(window.pocPlugin)).catch(() => false)) return frame;
    }
    return null;
  }, Boolean, 60000);
}

async function command(client, action) {
  const frame = await plugin(client.page);
  return await frame.evaluate(action => window.pocPlugin.run(action), action);
}

async function openPair(format, phase, record) {
  const clients = [];
  for (const user of ['alice', 'bob']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, locale: 'en-US' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    const client = { context, page, user, mainNavigations: 0, errors: [] };
    active.push(client);
    clients.push(client);
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) client.mainNavigations++; });
    page.on('pageerror', error => client.errors.push(error.message));
    await page.goto(`${base}/?file=sample.${format}&user=${user}&validation=1`);
    await until('native editor initialization', async () => {
      if (client.errors.length) throw new Error(`${format}/${user} initialization: ${client.errors[0]}`);
      return await page.evaluate(() => window.pocReady || window.pocError);
    }, Boolean, 180000);
    const error = await page.evaluate(() => window.pocError);
    if (error) throw new Error(`${format}/${user} editor error: ${JSON.stringify(error)}`);
    await plugin(page);
    const config = await request(`/config?file=sample.${format}&user=${user}&validation=1`);
    client.key = config.document.key;
    record[`${phase}-${user}`] = { key: client.key, userId: config.editorConfig.user.id, opened: true };
    await page.screenshot({ path: `${output}/${format}-${phase}-${user}.png` });
  }
  assert.equal(clients[0].key, clients[1].key, 'Both participants must edit the same native session');
  return clients;
}

function cellValues(snapshot) {
  return snapshot.values.flat(Infinity).map(Number);
}

function contains(format, snapshot, markers, both = true) {
  if (format === 'xlsx') {
    const values = cellValues(snapshot);
    return values[0] === 17 && (!both || values[1] === 25 && values[2] === 42);
  }
  const text = JSON.stringify(snapshot);
  return text.includes(markers.alice) && (!both || text.includes(markers.bob));
}

async function closed(clients, format, key) {
  const began = new Date().toISOString();
  for (const client of clients) {
    await client.page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
    await client.context.tracing.stop({ path: `${output}/${format}-${client.user}-${key}-trace.zip` });
    await client.context.close();
    active = active.filter(item => item !== client);
  }
  return await until('editor close callback', () => request('/events'), events => events.some(event => event.file === `sample.${format}` && event.key === key && event.at >= began && [2, 4].includes(event.status)), 60000);
}

async function cursorEvidence(clients, format) {
  for (const client of clients) {
    await command(client, { op: 'select' });
    if (format === 'pptx') {
      // Enter inside the slide canvas rather than the thumbnails or plugin panel.
      const editor = client.page.frames().find(frame => frame.url().includes('/presentationeditor/main/index.html'));
      assert(editor, 'Presentation editor frame missing');
      const hints = editor.getByRole('button', { name: 'Got it', exact: true });
      for (let index = 0; index < await hints.count(); index++) {
        if (await hints.nth(index).isVisible()) await hints.nth(index).click();
      }
      // Fixed-corpus coordinates at the runner's1920×1200 viewport: title/body text.
      await client.page.mouse.dblclick(client.user === 'alice' ? 800 : 700, client.user === 'alice' ? 380 : 490);
      await client.page.keyboard.press('ArrowRight');
      await client.page.keyboard.type(' ');
      await client.page.keyboard.press('Backspace');
    }
  }
  const evidence = [];
  for (const observer of clients) {
    const peer = observer.user === 'alice' ? 'bob' : 'alice';
    const result = await until('visible native peer cursor/selection label', async () => {
      const frames = [];
      for (const frame of observer.page.frames()) {
        if (!frame.url().includes('/web-apps/apps/')) continue;
        const labels = await frame.evaluate(peerName => {
          const canvas = document.querySelector('#editor_sdk')?.getBoundingClientRect();
          if (!canvas) return [];
          const selectors = '.username-tip, .usertip, [class*="cursor-label" i], [id*="cursor" i], [class*="foreign" i], [id*="foreign" i]';
          return Array.from(document.querySelectorAll(selectors)).filter(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return element.textContent.includes(peerName) && !element.closest('button, [role="menu"], .dropdown-menu') && rect.width > 0 && rect.width < 400 && rect.height > 0 && rect.height <= 60 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.left >= Math.max(0, canvas.left) && rect.top >= Math.max(0, canvas.top) && rect.right <= Math.min(innerWidth, canvas.right) && rect.bottom <= Math.min(innerHeight, canvas.bottom);
          }).map(element => ({ text: element.textContent.trim(), tag: element.tagName, id: element.id, className: element.className, rect: element.getBoundingClientRect().toJSON() }));
        }, names[peer]);
        frames.push(...labels);
      }
      return frames;
    }, value => value.length > 0, 12000);
    await observer.page.screenshot({ path: `${output}/${format}-cursor-observed-by-${observer.user}.png` });
    evidence.push({ observer: observer.user, peer, labels: result });
  }
  return evidence;
}

async function runFormat(format) {
  const record = report.formats[format] = { result: 'running', phases: {} };
  const markers = { alice: `ALICE_${format.toUpperCase()}_${run}`, bob: `BOB_${format.toUpperCase()}_${run}` };
  const clients = await openPair(format, 'initial', record.phases);
  const key = clients[0].key;
  const initial = await Promise.all(clients.map(client => command(client, { op: 'read' })));
  record.initial = initial;
  assert.deepEqual(initial[0], initial[1], 'Initial native content differs between independent clients');
  if (format === 'xlsx') {
    await command(clients[0], { op: 'prepare' });
    for (const client of clients) await until('initial worksheet values', () => command(client, { op: 'read' }), snapshot => { const values = cellValues(snapshot); return values[0] === 10 && values[1] === 20 && values[2] === 30; });
  } else {
    assert(!JSON.stringify(initial).includes(markers.alice), 'This run marker must not exist before the edit');
  }
  await command(clients[0], { op: 'edit', marker: markers.alice });
  record.aliceSeenByBob = await until('Alice edit delivered live to Bob', () => command(clients[1], { op: 'read' }), snapshot => contains(format, snapshot, markers, false));
  await command(clients[1], { op: 'edit', marker: markers.bob });
  const converged = [];
  for (const client of clients) converged.push(await until('both edits converge without refresh', () => command(client, { op: 'read' }), snapshot => contains(format, snapshot, markers)));
  assert.deepEqual(converged[0], converged[1], 'Native content did not converge');
  assert(clients.every(client => client.mainNavigations === 1), 'Convergence must not rely on refreshing either page');
  record.convergence = { passed: true, markers, clients: converged, mainNavigations: clients.map(client => client.mainNavigations) };
  console.log(`${format}: both native edits converged without refresh`);
  try { record.cursors = { passed: true, evidence: await cursorEvidence(clients, format) }; }
  catch (error) { record.cursors = { passed: false, reason: error.message }; }
  for (const client of clients) {
    await client.page.screenshot({ path: `${output}/${format}-after-edits-${client.user}.png` });
    const dom = await Promise.all(client.page.frames().map(async frame => ({ url: frame.url().split('?')[0], text: (await frame.locator('body').innerText()).slice(0, 30000) })));
    await writeFile(`${output}/${format}-after-edits-${client.user}.json`, JSON.stringify(dom, null, 2));
  }
  const saveBegan = new Date().toISOString();
  const commandReply = await request(`/forcesave/sample.${format}`, 'POST');
  assert.equal(commandReply.error, 0, 'Force-save command must be accepted');
  const events = await until('confirmed native saved artifact', () => request('/events'), events => events.some(event => event.file === `sample.${format}` && event.key === key && event.at >= saveBegan && event.status === 6 && event.bytes > 0 && /^[a-f0-9]{64}$/.test(event.sha256)), 90000);
  const saved = events.findLast(event => event.file === `sample.${format}` && event.key === key && event.at >= saveBegan && event.status === 6);
  const response = await fetch(`${base}/files/sample.${format}`);
  assert(response.ok, 'Saved file download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, saved.sha256, 'Downloaded file differs from the confirmed callback artifact');
  await writeFile(`${output}/sample.${format}`, bytes);
  record.save = { passed: true, callback: saved, commandReply, downloadedSha256: hash };
  await closed(clients, format, key);
  const reopened = await openPair(format, 'reopened', record.phases);
  assert.notEqual(reopened[0].key, key, 'Reopening must download stored OOXML under a fresh editor key');
  record.reopened = [];
  for (const client of reopened) record.reopened.push(await until('reopened saved content', () => command(client, { op: 'read' }), snapshot => contains(format, snapshot, markers)));
  assert.deepEqual(record.reopened[0], record.reopened[1], 'Reopened contents differ');
  await closed(reopened, format, reopened[0].key);
  record.reopen = { passed: true, newKey: reopened[0].key };
  record.result = record.cursors.passed ? 'passed' : 'failed-cursor-evidence';
  console.log(`${format}: downloaded native saved file and reopened it in both clients; cursor proof=${record.cursors.passed}`);
}

try {
  const health = await fetch(`${office}/healthcheck`, { signal: AbortSignal.timeout(10000) });
  assert(health.ok && (await health.text()).trim() === 'true', 'Editor healthcheck must return true');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADED !== '1' });
  report.browser = browser.version();
  for (const format of formats) {
    try { await runFormat(format); }
    catch (error) {
      report.formats[format] ??= {};
      report.formats[format].result = 'failed';
      report.formats[format].reason = error.message;
      console.error(`${format}: ${error.message}`);
      for (const client of active) {
        await client.page.screenshot({ path: `${output}/${format}-failure-${client.user}.png` }).catch(() => {});
        await client.context.tracing.stop({ path: `${output}/${format}-failure-${client.user}-trace.zip` }).catch(() => {});
        await client.context.close();
      }
      active = [];
    }
    await persist();
  }
  const allFormats = ['docx', 'xlsx', 'pptx'].every(format => report.formats[format]?.save?.passed);
  report.artifactVerification = { passed: false, reason: 'All three callback artifacts are required' };
  if (allFormats) {
    const python = process.env.POC_PYTHON ?? fileURLToPath(new URL('./.venv/bin/python', import.meta.url));
    const verification = spawnSync(python, [fileURLToPath(new URL('./corpus.py', import.meta.url)), 'verify', output, '--edited'], { encoding: 'utf8', timeout: 45000 });
    await writeFile(`${output}/artifact-verification.txt`, `${verification.stdout ?? ''}${verification.stderr ?? ''}${verification.error?.message ?? ''}`);
    report.artifactVerification = { passed: verification.status === 0, exitCode: verification.status, error: verification.error?.message };
  }
  const clientChecks = formats.every(format => report.formats[format]?.result === 'passed');
  report.result = clientChecks && (formats.length < 3 || report.artifactVerification.passed) ? (formats.length === 3 ? 'passed' : 'passed-selected-live-format-checks') : 'failed';
  if (report.result === 'failed') process.exitCode = 1;
} catch (error) {
  report.result = 'failed';
  report.reason = error.message;
  report.cause = error.cause?.code;
  process.exitCode = 1;
} finally {
  for (const client of active) await client.context.close();
  await browser?.close();
  await persist();
  console.log(JSON.stringify({ result: report.result, report: `${output}/report.json`, reason: report.reason }, null, 2));
}
