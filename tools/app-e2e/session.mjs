import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.E2E_URL ?? 'http://localhost:8892';
const mailpit = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8893';
const run = Date.now();
const directory = join(process.env.E2E_REPORT_DIR ?? fileURLToPath(new URL('../../.local/app-e2e/reports/', import.meta.url)), `session-${run}`);
await mkdir(directory, { recursive: true });
const first = `identity08-a-${run}@example.test`;
const second = `identity08-b-${run}@example.test`;
const password = 'Session-recovery-before-2026!';
const nextPassword = 'Session-recovery-after-2026!';
const report = { at: new Date().toISOString(), kind: 'whole-app-session-and-password-recovery', base, steps: [], result: 'running' };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext();
const other = await browser.newContext();
const page = await context.newPage();
await context.tracing.start({ screenshots: true, snapshots: true });
async function post(client, path, data) {
    const token = (await client.cookies(base)).find(cookie => cookie.name === 'XSRF-TOKEN');
    assert(token, 'Missing real CSRF cookie');
    return client.request.post(`${base}/api/v1${path}`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token.value) }, data });
}
async function login(email, secret = password) {
    await page.getByLabel('Электронная почта', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(secret);
    const pending = page.waitForResponse(response => response.url() === `${base}/api/v1/auth/login` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Войти в пространство', exact: true }).click();
    assert.equal((await pending).status(), 200);
    await page.getByRole('heading', { name: /Все документы/ }).waitFor();
}
async function logout() {
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.getByRole('heading', { name: 'С возвращением', exact: true }).waitFor();
}
try {
    assert.equal((await context.request.post(`${base}/api/v1/auth/login`, { data: { email: first, password } })).status(), 419);
    for (const [client, email, name] of [[context, first, 'Session First'], [other, second, 'Session Second']]) {
        await client.request.get(`${base}/sanctum/csrf-cookie`);
        assert.equal((await post(client, '/auth/register', { name, email, password, password_confirmation: password })).status(), 201);
        assert.equal((await post(client, '/auth/logout', {})).status(), 200);
    }
    await page.goto(base);
    await login(first.toUpperCase());
    await page.getByText('Session First', { exact: true }).waitFor();
    const oldCookies = await context.cookies();
    await logout();
    const revoked = await browser.newContext();
    await revoked.addCookies(oldCookies);
    assert.equal((await revoked.request.get(`${base}/api/v1/me`)).status(), 401);
    await revoked.close();
    await login(second);
    await page.getByText('Session Second', { exact: true }).waitFor();
    assert.equal(await page.getByText('Session First', { exact: true }).count(), 0);
    await page.screenshot({ path: join(directory, 'second-account.png'), fullPage: true });
    report.steps.push('Real CSRF rejected missing token; A→logout→B browser login changed identity, and captured logout cookie was rejected');
    await logout();
    await login(first);
    assert.equal((await post(other, '/auth/login', { email: first, password })).status(), 200);
    await page.goto(`${base}/forgot-password`);
    await page.getByLabel('Электронная почта', { exact: true }).fill(first.toUpperCase());
    await page.getByRole('button', { name: 'Отправить ссылку', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Если учётная запись существует' }).waitFor();
    let link;
    for (let attempt = 0; attempt < 30 && !link; attempt++) {
        const search = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${first}`)}`)).json();
        for (const item of search.messages ?? []) {
            const mail = await (await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(item.ID)}`)).json();
            const href = mail.HTML?.match(/href="([^" ]*\/reset-password[^" ]*)"/)?.[1];
            if (href) link = new URL(href.replaceAll('&amp;', '&'), base);
        }
        if (!link) await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert(link, 'Expected reset message was not delivered through real SMTP');
    assert.equal(link.origin, new URL(base).origin);
    await page.goto(link.href);
    await page.getByLabel('Новый пароль', { exact: true }).fill(nextPassword);
    await page.getByLabel('Повторите пароль', { exact: true }).fill(nextPassword);
    const reset = page.waitForResponse(response => response.url() === `${base}/api/v1/auth/reset-password` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    assert.equal((await reset).status(), 200);
    await page.getByRole('status').filter({ hasText: 'Пароль обновлён' }).waitFor();
    assert.equal((await context.request.get(`${base}/api/v1/me`)).status(), 401, 'Reset retained its own session');
    assert.equal((await other.request.get(`${base}/api/v1/me`)).status(), 401, 'Independent old session survived reset');
    assert.equal((await post(context, '/auth/reset-password', { email: first, token: link.searchParams.get('token'), password: nextPassword, password_confirmation: nextPassword })).status(), 422);
    assert.equal((await post(context, '/auth/login', { email: first, password })).status(), 422);
    await page.getByRole('link', { name: 'Вернуться ко входу', exact: true }).click();
    await login(first, nextPassword);
    assert.match((await context.request.get(`${base}/api/v1/me`)).headers()['cache-control'], /no-store/);
    await page.screenshot({ path: join(directory, 'new-password-login.png'), fullPage: true });
    report.steps.push('Real Mailpit link reset password; current and independent old sessions failed, token replay and old password failed, new browser login succeeded');
    report.result = 'passed';
} catch (error) {
    report.result = 'failed';
    report.reason = String(error.message).replace(/([?&](?:signature|token)=)[^\s&"']+/g, '$1[redacted]');
    await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
} finally {
    await context.tracing.stop({ path: join(directory, 'trace.zip') });
    await browser.close();
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: report.result, report: join(directory, 'report.json'), reason: report.reason }, null, 2));
}
