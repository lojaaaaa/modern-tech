import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// The fixture must be created exclusively in the dedicated app-e2e database.
const fixture = process.env.E2E_CURSOR_FIXTURE;
assert(fixture, 'Set E2E_CURSOR_FIXTURE to a local synthetic fixture JSON');
const seed = JSON.parse(await readFile(resolve(fixture)));
assert(seed.id && seed.alice && seed.bob && seed.password, 'Fixture needs id, alice, bob, password');
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
const clients=[];
try {
  for (const name of ['alice','bob']) {
    const context=await browser.newContext({viewport:{width:1920,height:1200},locale:'en-US'});
    const page=await context.newPage();
    await page.goto('http://localhost:8892');
    await page.getByLabel('Электронная почта',{exact:true}).fill(seed[name]);
    await page.getByLabel('Пароль',{exact:true}).fill(seed.password);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.getByRole('button',{name:'Выйти',exact:true}).waitFor();
    await page.goto(`http://localhost:8892/documents/${seed.id}`);
    await page.getByRole('button',{name:'Совместная работа',exact:true}).click({timeout:30000});
    await page.getByText('Редактор подключён',{exact:true}).waitFor({timeout:120000});
    const frame=page.frames().find(f=>f.url().includes('/documenteditor/'));
    if (!frame) throw Error('documenteditor frame not found');
    clients.push({name,context,page,frame});
  }
  for (const client of clients) {
    const rect=await client.frame.locator('#editor_sdk').boundingBox();
    console.log(client.name,'editor bounds',JSON.stringify(rect));
    await client.page.screenshot({path:`/tmp/office-cursor-${client.name}.png`});
  }
  const results=[];
  for (const observer of clients) {
    const peer=clients.find(c=>c!==observer);
    const rect=await peer.frame.locator('#editor_sdk').boundingBox();
    await peer.page.mouse.click(rect.x+rect.width*.5,rect.y+Math.min(140,rect.height*.3));
    await peer.page.keyboard.type(' CursorProbe');
    await peer.page.keyboard.press('ArrowLeft');
    const deadline=Date.now()+12000;
    let found=[];
    while(Date.now()<deadline && !found.length) {
      found=await observer.frame.locator('.username-tip[userid]').evaluateAll(es=>es.filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0}).map(e=>({name:e.textContent?.trim(),userid:e.getAttribute('userid')})));
      found=found.filter(x=>x.name===`Office ${peer.name==='alice'?'Alice':'Bob'}`);
      if(!found.length) await new Promise(r=>setTimeout(r,250));
    }
    await observer.page.screenshot({path:`/tmp/office-cursor-observer-${observer.name}.png`});
    results.push({observer:observer.name,peer:peer.name,found});
    console.log('peer cursor',observer.name,JSON.stringify(found));
  }
  await writeFile('/tmp/office-cursor-result.json',JSON.stringify({results},null,2));
  assert(results.every(result=>result.found.length>0), 'A native peer cursor was not visible to both users');
} finally {await browser.close();}
