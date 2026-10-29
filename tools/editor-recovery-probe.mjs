import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
 const page=await context.newPage();
 const url=process.argv[2]??'http://127.0.0.1:5175/';await page.goto(url);await page.waitForFunction(()=>window.__sim);
 const original=await page.inputValue('#source');
 const a={version:1,text:'Body { Core(){N:Chip()} }',filename:'試作車 A.rcd',savedAt:Date.UTC(2026,9,30,0,30)};
 const b={...a,text:'Body { Core(){S:Frame()} }',filename:'別の試作 B.rcd'};
 const put=async(p,d)=>p.evaluate(d=>localStorage.setItem('snaptiles.editor.draft.v1',JSON.stringify(d)),d);
 await put(page,a);await page.click('#build');
 assert.equal(await page.locator('#draft-filename').textContent(),a.filename);
 assert.equal(await page.locator('#draft-saved').textContent(),'保存: 2026/10/30 09:30');
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-recovery-mobile.png',import.meta.url))});
 await page.setViewportSize({width:320,height:568});await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-recovery-small.png',import.meta.url))});
 // A same-document storage rewrite does not emit a storage event: the visible candidate must win.
 await put(page,b);await page.click('#restore-draft');assert.equal(await page.inputValue('#source'),a.text);
 assert.equal(await page.locator('#draft-recovery').isVisible(),false);
 const download=page.waitForEvent('download');await page.click('#save-model');assert.equal((await download).suggestedFilename(),a.filename);
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),original);
 const other=await page.context().newPage();await other.goto(url);await other.waitForFunction(()=>window.__sim);
 await put(other,b);await page.waitForFunction(()=>document.querySelector('#draft-filename').textContent==='別の試作 B.rcd');
 await page.click('#restore-draft');assert.equal(await page.inputValue('#source'),b.text);
 const unnamed={version:1,text:'Body { Core(',savedAt:1e100};await put(other,unnamed);
 await page.waitForFunction(()=>document.querySelector('#draft-saved').textContent==='保存時刻不明');
 assert.equal(await page.locator('#draft-filename').textContent(),'名前未設定のモデル');
 await page.click('#restore-draft');assert.equal(await page.inputValue('#source'),unnamed.text);
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),b.text);
 await other.close();console.log('Recovery: named timestamp, visible snapshot identity, Undo, cross-tab refresh, unnamed/invalid-date/incomplete-source recovery pass');
}finally{await browser.close();}
