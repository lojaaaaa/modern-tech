import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// A synthetic bridge tests panel behavior only; it is not Office acceptance.
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const fixture = `<script>
window.fixtureComments = [
 { Id:'one', Data:{ UserName:'Alice', UserId:'alice', Text:'Ветка 1', QuoteText:'Одинаковая цитата', Replies:[] } },
 { Id:'two', Data:{ UserName:'Bob', UserId:'bob', Text:'Ветка 2', QuoteText:'Одинаковая цитата', Replies:[] } }
];
window.DocsAPI = { DocEditor: class { destroyEditor() {} } };
window.addEventListener('message', event => {
 const data=event.data;
 if(data?.kind!=='request') return;
 if(data.op==='list') window.postMessage({ channel:data.channel, kind:'response', user:data.user, file:data.file, id:data.id, result:window.fixtureComments },location.origin);
});
setTimeout(()=>window.postMessage({ channel:'office-discussion-v1', kind:'ready', user:'alice', file:'sample.docx' },location.origin),300);
</script>`;
const server = http.createServer((req,res) => {
 if (req.url.startsWith('/config?')) { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({document:{key:'fixture'},editorConfig:{user:{name:'Alice'}}})); }
 res.setHeader('content-type','text/html'); res.end(html.replace('<script src="__OFFICE_PUBLIC_URL__/web-apps/apps/api/documents/api.js"></script>',fixture));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser = await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/?file=sample.docx&user=alice&discussion=1`);
 await page.getByText('Ветка 1').waitFor();
 await page.evaluate(()=>{ window.fixtureComments=window.fixtureComments.filter(comment=>comment.Id==='two'); window.dispatchEvent(new Event('focus')); });
 const missing=page.locator('article').filter({hasText:'Ветка 1'});
 await missing.getByText(/не найдена/i).waitFor({timeout:3000});
 assert.equal(await missing.getByText('Одинаковая цитата').count(),1);
 assert.equal(await missing.getByRole('button',{name:'Перейти к фрагменту'}).count(),0);
 const live=page.locator('article').filter({hasText:'Ветка 2'});
 assert.equal(await live.getByRole('button',{name:'Перейти к фрагменту'}).count(),1);
 await page.evaluate(()=>{ window.fixtureComments.push({ Id:'one', Data:{ UserName:'Alice', UserId:'alice', Text:'Ветка 1', QuoteText:'', Replies:[] } }); window.dispatchEvent(new Event('focus')); });
 await missing.getByText(/текущая привязка не подтверждена/i).waitFor();
 assert.equal(await missing.getByText('Одинаковая цитата').count(),1);
 assert.equal(await missing.getByRole('button',{name:'Перейти к фрагменту'}).count(),0);
 await page.evaluate(()=>{ window.fixtureComments.push(window.fixtureComments[0]); window.dispatchEvent(new Event('focus')); });
 await page.locator('#discussion-status').getByText(/неполный список/i).waitFor();
 assert.equal(await missing.getByText('Одинаковая цитата').count(),1);
 console.log('Панель сохраняет отсутствующую ветку только для чтения и не переносит её на одинаковую цитату.');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
