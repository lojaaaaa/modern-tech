import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const base = process.env.E2E_URL ?? 'http://localhost:8892';
const mailpit = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8893';
assert.equal(new URL(base).origin, 'http://localhost:8892', 'This scenario requires the dedicated default app-e2e environment');
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
    await page.getByRole('button', { name: 'Выйти', exact: true }).waitFor();
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
    let verification;
    for (let attempt = 0; attempt < 30 && !verification; attempt++) {
        const search = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${first}`)}`)).json();
        for (const item of search.messages ?? []) {
            const mail = await (await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(item.ID)}`)).json();
            const href = mail.HTML?.match(/href="([^\"]*\/auth\/verify-email\/[^\"]+)"/)?.[1];
            if (href) verification = new URL(href.replaceAll('&amp;', '&'), base);
        }
        if (!verification) await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert(verification && verification.origin === new URL(base).origin, 'Verification message was not delivered');
    await page.goto(verification.href);
    await page.getByRole('heading', { name: /Все документы/ }).waitFor();
    const csrf = (await context.cookies(base)).find(cookie => cookie.name === 'XSRF-TOKEN');
    const title = `private-session-${run}.txt`;
    const uploaded = await context.request.post(`${base}/api/v1/documents`, {
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(csrf.value), 'Idempotency-Key': `private-${run}` },
        multipart: { file: { name: title, mimeType: 'text/plain', buffer: Buffer.from('Private owner data') } },
    });
    assert.equal(uploaded.status(), 202, 'Private document creation failed');
    const documentId = (await uploaded.json()).data.id;
    const connectionName = `private-connection-${run}`;
    const connection = await post(context, '/connections', { provider: 'yandex', name: connectionName, token: 'synthetic-test-token' });
    assert.equal(connection.status(), 201, 'Private test connection was not created');
    await page.goto(`${base}/integrations`);
    await page.getByText(connectionName).waitFor();
    await page.goto(`${base}/documents/${documentId}`);
    await page.getByText(title, { exact: true }).first().waitFor();
    const oldCookies = await context.cookies();
    await logout();
    const revoked = await browser.newContext();
    await revoked.addCookies(oldCookies);
    assert.equal((await revoked.request.get(`${base}/api/v1/me`)).status(), 401);
    await revoked.close();
    await login(second);
    await page.getByText('Session Second', { exact: true }).waitFor();
    await page.getByText('Подтвердите email перед загрузкой, редактированием и комментированием.').waitFor();
    assert.equal(await page.getByText('Session First', { exact: true }).count(), 0);
    assert.equal(await page.getByText(title, { exact: true }).count(), 0, 'Previous account document appeared in the next library');
    assert([403, 404].includes((await context.request.get(`${base}/api/v1/documents/${documentId}`)).status()), 'Next account can read the private document');
    await page.goto(`${base}/documents/${documentId}`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByText(title, { exact: true }).count(), 0, 'Private document remained visible after account switch');
    await page.goto(base);
    await page.goto(`${base}/integrations`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.getByText(connectionName).count(), 0, 'Previous account connection remained visible');
    const secondConnections = await (await context.request.get(`${base}/api/v1/connections`)).json();
    assert(!(secondConnections.data ?? []).some(item => item.name === connectionName), 'Previous account connection was returned to next account');
    await page.screenshot({ path: join(directory, 'second-account.png'), fullPage: true });
    report.steps.push('Real CSRF rejected missing token; after viewing A’s private document, A→logout→B rejected the old cookie and hid/forbade the document');
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
    const firstId = (await (await context.request.get(`${base}/api/v1/me`)).json()).data.id;
    await page.goto(`${base}/documents/${documentId}`);
    await page.getByText(title, { exact: true }).first().waitFor();
    // The administrator exists only in the dedicated app-e2e database.
    execFileSync('docker', ['exec', 'modern-tech-app-e2e-api-1', 'php', '-r', `require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); App\\Models\\User::where('email', ${JSON.stringify(second)})->update(['role' => 'admin']);`]);
    assert.equal((await post(other, '/auth/login', { email: second, password })).status(), 200);
    const blocked = await other.request.patch(`${base}/api/v1/users/${firstId}`, { headers: { Accept: 'application/json', 'X-XSRF-TOKEN': decodeURIComponent((await other.cookies(base)).find(cookie => cookie.name === 'XSRF-TOKEN').value) }, data: { active: false } });
    assert.equal(blocked.status(), 200, 'Admin could not block the test account');
    assert.equal((await context.request.get(`${base}/api/v1/documents/${documentId}`)).status(), 401);
    await page.reload();
    await page.getByRole('heading', { name: 'С возвращением', exact: true }).waitFor();
    assert.equal(await page.getByText(title, { exact: true }).count(), 0, 'Blocked account recovered a cached private screen');
    report.steps.push('B could not see A’s connection; blocking A revoked its server session and reload removed the cached private screen');
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
