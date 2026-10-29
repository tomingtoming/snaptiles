import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2] ?? 'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); await page.click('#new-model'); await page.click('[data-edge="N"]');
 const source=await page.inputValue('#source'), oldAddress=page.url();
 await page.click('#share-model'); await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));
 const link=await page.inputValue('#share-url');
 assert.equal(page.url(),oldAddress); assert.equal(await page.locator('#builder').isVisible(),true);
 const receiver=await browser.newPage(); await receiver.goto(link); await receiver.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);
 assert.equal(await receiver.inputValue('#source'),source); await receiver.close();
 // Deterministic clipboard-denied path, without changing the host clipboard.
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
 await page.click('#copy-link'); await page.waitForFunction(()=>document.querySelector('#share-status').textContent.includes('自動コピーできません'));
 assert.equal(await page.locator('#share-url').evaluate(el=>el.selectionEnd-el.selectionStart),link.length);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-share-mobile.png',import.meta.url))});
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}}));
 await page.click('#copy-link'); await page.waitForFunction(()=>document.querySelector('#share-status').textContent==='コピーしました');
 assert.equal(await page.evaluate(()=>window.copied),link);
 await page.locator('#share-dialog button').last().click();
 assert.equal(await page.locator('#share-model').evaluate(el=>el===document.activeElement),true);
 await page.click('[data-edge="E"]');
 await page.click('#share-model'); await page.waitForFunction(old=>document.querySelector('#share-url').value && document.querySelector('#share-url').value!==old,link);
 await page.keyboard.press('Escape');
 await page.fill('#source','Body { Core('); await page.click('#share-model');
 await page.waitForFunction(()=>document.querySelector('#share-status').textContent.includes('リンクを作れませんでした'));
 assert.equal(await page.inputValue('#share-url'),''); assert.equal(await page.locator('#copy-link').isDisabled(),true);
 assert.equal(page.url(),oldAddress); assert.deepEqual(errors,[]);
 console.log('Share: unsimulated edits round-trip; clipboard success/denial; focus return; changed source; invalid source pass');
} finally {await browser.close();}
