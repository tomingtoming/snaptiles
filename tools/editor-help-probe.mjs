import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 assert.equal(await page.locator('#run').getAttribute('aria-label'),'実行');
 assert.ok((await page.locator('#viewmode').getAttribute('aria-label')).includes('視点 A: 追従'));
 // the editor keeps its own orbit; the button still picks the runtime view used after ▶
 await page.click('#build'); assert.equal(await page.evaluate(()=>window.__scene.viewMode),'orbit');
 await page.click('#viewmode'); assert.ok((await page.locator('#viewmode').getAttribute('aria-label')).includes('視点 B: 観客席')); assert.equal(await page.evaluate(()=>window.__scene.viewMode),'orbit');
 const text=await page.inputValue('#source');
 await page.getByRole('button',{name:'使い方',exact:true}).click();
 assert.equal(await page.getByRole('dialog',{name:'作って、走らせる'}).isVisible(),true);
 assert.ok((await page.locator('#help-dialog').textContent()).includes('共有リンク'));
 const sharing=await page.locator('#shared-control-help').textContent();
 assert.ok(sharing.includes('この部品用に分ける')&&sharing.includes('同じキーで動きます'));
 await page.locator('#shared-control-help').scrollIntoViewIfNeeded();
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-sharing-help.png',import.meta.url))});
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-help-mobile.png',import.meta.url))});
 await page.keyboard.press('Escape'); assert.equal(await page.evaluate(()=>document.activeElement.id),'help');
 assert.equal(await page.inputValue('#source'),text); assert.equal(await page.locator('#builder').isVisible(),true);
 await page.setViewportSize({width:320,height:568});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.click('#help');
 assert.equal(await page.locator('#help-title').evaluate(el=>{const b=el.getBoundingClientRect(),d=document.querySelector('#help-dialog').getBoundingClientRect();return b.top>=d.top&&b.bottom<=d.bottom;}),true,'small-screen guide must open at its title');
 await page.locator('#help-dialog button').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('#help-dialog button').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;}),true);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-help-small.png',import.meta.url))});
 await page.getByRole('button',{name:'閉じる',exact:true}).click(); assert.equal(await page.locator('#help-dialog').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'help');
 console.log('Guide: reachable named dialog, current view labels, Escape/close focus return, source preservation, 320px bounds pass');
} finally {await browser.close();}
