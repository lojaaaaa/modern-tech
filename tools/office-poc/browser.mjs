// Readiness probe only: real co-editing/cursor/save acceptance uses README protocol.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.POC_URL ?? 'http://127.0.0.1:8890';
const office = process.env.OFFICE_PUBLIC_URL ?? 'http://localhost:8891';
const output = fileURLToPath(new URL('./data/browser/', import.meta.url));
const formats = process.argv.slice(2).length ? process.argv.slice(2) : ['docx', 'xlsx', 'pptx'];
if (formats.some(value => !['docx', 'xlsx', 'pptx'].includes(value))) throw new Error('Formats: docx xlsx pptx');
await mkdir(output, { recursive: true });
const report = { at: new Date().toISOString(), kind: 'real-editor-readiness-only', base, office, formats: {}, result: 'running' };
let browser;
let contexts = [];
try {
  const health = await fetch(`${office}/healthcheck`, { signal: AbortSignal.timeout(10000) });
  if (!health.ok || (await health.text()).trim() !== 'true') throw new Error('Editor healthcheck did not return true');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  report.browser = browser.version();
  for (const format of formats) {
    report.formats[format] = [];
    for (const user of ['alice', 'bob']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
      contexts.push(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/?file=sample.${format}&user=${user}`);
      await page.waitForFunction(() => window.pocReady || window.pocError, null, { timeout: 120000 });
      const error = await page.evaluate(() => window.pocError);
      if (error) throw new Error(`${format}/${user}: ${JSON.stringify(error)}`);
      report.formats[format].push({ user, opened: true, errors });
    }
    for (const [index, context] of contexts.entries()) {
      const page = context.pages()[0];
      await page.screenshot({ path: `${output}/${format}-${index}.png`, fullPage: true });
      const frames = await Promise.all(page.frames().map(async frame => ({ url: frame.url(), title: await frame.title(), text: (await frame.locator('body').innerText()).slice(0, 15000) })));
      await writeFile(`${output}/${format}-${index}.json`, JSON.stringify(frames, null, 2));
    }
    for (const context of contexts) await context.close();
    contexts = [];
  }
  report.result = 'opened-both-independent-contexts';
  report.remaining = ['edit convergence', 'cursor/name visibility', 'save callback', 'saved-file reopen'];
} catch (error) {
  report.result = 'failed';
  report.reason = error.message;
  report.cause = error.cause?.code;
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await writeFile(`${output}/readiness.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
