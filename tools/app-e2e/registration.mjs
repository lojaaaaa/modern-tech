import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.E2E_URL ?? 'http://localhost:8892';
const mailpit = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8893';
const run = new Date().toISOString().replace(/[:.]/g, '-');
const directory = join(process.env.E2E_REPORT_DIR ?? fileURLToPath(new URL('../../.local/app-e2e/reports/', import.meta.url)), `registration-${run}`);
await mkdir(directory, { recursive: true });
const email = `identity07-${Date.now()}@example.test`;
const password = 'Identity-registration-2026!';
const report = { at: new Date().toISOString(), kind: 'whole-app-registration-and-email-verification', base, mailpit, email, steps: [], result: 'running' };
const redact = text => String(text).replace(/([?&](?:signature|token)=)[^\s&"']+/g, '$1[redacted]');
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
let browser;
let context;
let page;

async function eventually(description, inspect, accepts, timeout = 30000) {
    const began = Date.now();
    while (Date.now() - began < timeout) {
        const result = await inspect();
        if (accepts(result)) return result;
        await pause(500);
    }
    throw new Error(`${description}: timed out`);
}

async function messages() {
    const response = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert(response.ok, 'Isolated Mailpit search is unavailable');
    const data = await response.json();
    return (data.messages ?? []).filter(message => message.To?.some(recipient => recipient.Address === email));
}

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
    assert.equal(account.email_verified_at, null);
    assert.equal(account.email, email);
    report.accountId = account.id;
    await page.getByRole('heading', { name: 'Подтвердите электронную почту', exact: true }).waitFor();
    assert(await page.getByText(email, { exact: true }).isVisible(), 'Verification step must identify the destination email');
    await page.screenshot({ path: join(directory, 'verification-step.png'), fullPage: true });
    report.steps.push('The visitor registered as employee and saw the account-specific verification step');

    const blocked = await context.request.post(`${base}/api/v1/documents`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await csrf(), 'Idempotency-Key': `blocked-${run}` }, multipart: { file: { name: 'blocked.txt', mimeType: 'text/plain', buffer: Buffer.from('Unverified upload must be blocked') } } });
    assert.equal(blocked.status(), 403, 'An unverified user bypassed the server-side upload restriction');
    await page.getByRole('link', { name: 'Перейти к библиотеке', exact: true }).click();
    await page.getByRole('heading', { name: /Все документы/ }).waitFor();
    assert(!(await page.getByRole('button', { name: 'Загрузить документ', exact: true }).isEnabled()), 'Upload command must explain the unverified state');
    await page.getByRole('link', { name: 'Подтвердить электронную почту', exact: true }).click();
    report.steps.push('Reading remained available; upload was disabled in UI and rejected with403 by the real API');

    const delivered = await eventually('Initial verification email in real Mailpit', messages, items => items.length >= 1);
    const resendResponse = page.waitForResponse(response => response.url() === `${base}/api/v1/auth/verification-notification` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Отправить письмо ещё раз', exact: true }).click();
    assert.equal((await resendResponse).status(), 202, 'Resend request was not accepted');
    const redelivered = await eventually('Resent verification email in real Mailpit', messages, items => items.length >= 2);
    report.mail = { initialMessageId: delivered[0].ID, deliveredMessages: redelivered.length };
    report.steps.push('Initial and resent messages reached the isolated Mailpit through SMTP');

    const emailResponse = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(redelivered[0].ID)}`);
    assert(emailResponse.ok, 'Delivered email could not be read');
    const mail = await emailResponse.json();
    const href = mail.HTML?.match(/href="([^\"]*\/auth\/verify-email\/[^\"]+)"/)?.[1];
    assert(href, 'Delivered email does not contain the signed verification action');
    const link = new URL(href.replaceAll('&amp;', '&'), base);
    assert.equal(link.origin, new URL(base).origin, 'Verification link must lead to the isolated application');
    assert(link.pathname.includes(`/verify-email/${account.id}/`), 'Verification link belongs to another account');
    await page.goto(link.href);
    await page.getByRole('heading', { name: /Все документы/ }).waitFor();
    const verified = await (await context.request.get(`${base}/api/v1/me`)).json();
    assert(verified.data.email_verified_at, 'The email link did not persist verification');
    assert(await page.getByRole('button', { name: 'Загрузить документ', exact: true }).isEnabled(), 'Verified user still cannot use the upload command');
    const repeated = await context.request.get(link.href, { headers: { Accept: 'application/json' } });
    assert.equal(repeated.status(), 200);
    assert.equal((await repeated.json()).data.email_verified_at, verified.data.email_verified_at, 'Repeated confirmation rewrote its timestamp');
    report.steps.push('Following the actual email link confirmed the account; repeated use preserved the timestamp');

    const allowed = await context.request.post(`${base}/api/v1/documents`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': await csrf(), 'Idempotency-Key': `verified-${run}` }, multipart: { file: { name: 'identity-verification.txt', mimeType: 'text/plain', buffer: Buffer.from('Private test document created after email verification') } } });
    assert.equal(allowed.status(), 202, 'The verified user cannot enter the existing upload pipeline');
    const library = await (await context.request.get(`${base}/api/v1/documents`)).json();
    assert.equal(library.meta.total, 1, 'Blocked upload created a document or allowed upload did not persist');
    await page.reload();
    await page.getByText('identity-verification.txt', { exact: true }).waitFor();
    await page.screenshot({ path: join(directory, 'verified-library.png'), fullPage: true });
    report.steps.push('Verified upload was accepted and appeared in the account library; processing was not asserted');
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
