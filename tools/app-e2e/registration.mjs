import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.E2E_URL ?? 'http://localhost:8892';
const run = new Date().toISOString().replace(/[:.]/g, '-');
const directory = join(process.env.E2E_REPORT_DIR ?? fileURLToPath(new URL('../../.local/app-e2e/reports/', import.meta.url)), `registration-${run}`);
await mkdir(directory, { recursive: true });
const email = `identity07-${Date.now()}@example.test`;
const password = 'Identity-registration-2026!';
const report = { at: new Date().toISOString(), kind: 'whole-app-registration', base, email, steps: [], result: 'running' };
const redact = text => String(text).replace(/([?&](?:signature|token)=)[^\s&"']+/g, '$1[redacted]');
let browser;
let context;
let page;

async function csrf() {
    const cookies = await context.cookies(base);
    const cookie = cookies.find(cookie => cookie.name === 'XSRF-TOKEN');
    assert(cookie, 'Browser did not receive a CSRF cookie');
    return decodeURIComponent(cookie.value);
}

try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    report.browser = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const noCsrf = await context.request.post(`${base}/api/v1/auth/register`, { data: {} });
    assert.equal(noCsrf.status(), 419, 'Real CSRF middleware must reject a request without a token');
    report.steps.push('A registration request without CSRF was rejected with419');

    page = await context.newPage();
    await page.goto(`${base}/register`);
    await page.getByLabel('Ваше имя', { exact: true }).fill('Проверка регистрации');
    await page.getByLabel('Электронная почта', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByLabel('Повторите пароль', { exact: true }).fill(password);
    const registration = page.waitForResponse(response => response.url() === `${base}/api/v1/auth/register` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Создать учётную запись', exact: true }).click();
    const registered = await registration;
    assert.equal(registered.status(), 201, 'Browser registration did not create an account');
    const account = (await registered.json()).data;
    assert.equal(account.role, 'employee');
    assert.equal(account.email, email);
    report.accountId = account.id;
    await page.getByRole('heading', { name: /Все документы/ }).waitFor();
    assert(await page.getByRole('button', { name: 'Загрузить документ', exact: true }).isEnabled());
    report.steps.push('The visitor registered as employee and entered the library');

    const allowed = await context.request.post(`${base}/api/v1/documents`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await csrf(), 'Idempotency-Key': `registered-${run}` }, multipart: { file: { name: 'identity-registration.txt', mimeType: 'text/plain', buffer: Buffer.from('Private test document created after registration') } } });
    assert.equal(allowed.status(), 202, 'The new employee cannot enter the existing upload pipeline');
    const library = await (await context.request.get(`${base}/api/v1/documents`)).json();
    assert.equal(library.meta.total, 1, 'The uploaded document did not persist');
    await page.reload();
    await page.getByText('identity-registration.txt', { exact: true }).waitFor();
    await page.screenshot({ path: join(directory, 'registered-library.png'), fullPage: true });
    report.steps.push('Upload after registration was accepted and appeared in the account library; processing was not asserted');
    report.result = 'passed';
} catch (error) {
    report.result = 'failed';
    report.reason = redact(error.message);
    await page?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
} finally {
    await context?.tracing.stop({ path: join(directory, 'trace.zip') }).catch(() => {});
    await context?.close();
    await browser?.close();
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: report.result, report: join(directory, 'report.json'), reason: report.reason }, null, 2));
}
