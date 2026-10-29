import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 const active=()=>page.evaluate(()=>document.activeElement.id);
 assert.equal(await active(),'view');
 await page.keyboard.press('Shift+Tab'); assert.equal(await active(),'source');
 const source=await page.inputValue('#source');
 await page.keyboard.press('Shift+Tab'); assert.equal(await active(),'run'); assert.equal(await page.inputValue('#source'),source);
 await page.evaluate(()=>window.previous=window.__sim); await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.__sim&&window.__sim!==window.previous);
 assert.equal(await active(),'view');
 await page.keyboard.down('ArrowUp'); await page.waitForFunction(()=>window.__sim.env('ENGINE')>0); await page.keyboard.up('ArrowUp');
 await page.waitForFunction(()=>window.__sim.env('ENGINE')===0);
 const tick = await page.evaluate(()=>window.__sim.ticks);
 await page.keyboard.down('Control'); await page.keyboard.down('z');
 await page.waitForFunction(t=>window.__sim.ticks>=t+3,tick);
 assert.equal(await page.evaluate(()=>window.__sim.env('BRAKE')),0);
 await page.keyboard.up('z'); await page.keyboard.up('Control');
 await page.screenshot({path:fileURLToPath(new URL('../.shots/keyboard-run-focus.png',import.meta.url))});
 const tabTo=async(selector,reverse=false)=>{
   for(let i=0;i<35;i++) {if(await page.evaluate(s=>document.activeElement.matches(s),selector))return;await page.keyboard.press(reverse?'Shift+Tab':'Tab');}
   throw new Error(`Keyboard could not reach ${selector}`);
 };
 await tabTo('#build',true); await page.keyboard.press('Enter');
 await tabTo('#new-model'); await page.keyboard.press('Enter');
 await tabTo('[data-edge="N"]'); await page.keyboard.press('Enter');
 assert.equal(await page.locator('#parts option').count(),2);
 await tabTo('#parts',true); await page.keyboard.press('Control+z'); assert.equal(await page.locator('#parts option').count(),1);
 await page.keyboard.press('Control+Shift+z'); assert.equal(await page.locator('#parts option').count(),2);
 // A delayed run must not steal focus from a field the user moved to meanwhile.
 await page.evaluate(()=>{
   const proto=Object.getPrototypeOf(window.__sim),start=proto.start;
   proto.start=async function(){await new Promise(resolve=>{window.releaseStart=resolve;});return start.call(this);};
 });
 await tabTo('#run',true); await page.keyboard.press('Enter'); await page.waitForFunction(()=>window.releaseStart);
 await page.keyboard.press('Tab'); assert.equal(await active(),'source');
 await page.evaluate(()=>window.releaseStart()); await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);
 assert.equal(await active(),'source');
 console.log('Keyboard: source exit, run-to-drive, modifier isolation, reachable build/add, selector Undo/Redo, focus preservation pass');
}finally{await browser.close();}
