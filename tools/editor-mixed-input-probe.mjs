import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 const held=async()=>{const tick=await page.evaluate(()=>window.__sim.ticks);await page.waitForFunction(t=>window.__sim.ticks>t,tick);return page.evaluate(()=>window.__sim.api()._KEY(0));};
 const cap=page.locator('#keys .cap').first();
 await page.keyboard.down('ArrowUp');await page.waitForFunction(()=>window.__sim.env('ENGINE')===1500);
 await cap.click();assert.equal(await held(),1);
 const tick=await page.evaluate(()=>window.__sim.ticks);await page.waitForFunction(t=>window.__sim.ticks>=t+3,tick);
 assert.equal(await page.evaluate(()=>window.__sim.env('ENGINE')),1500);await page.keyboard.up('ArrowUp');assert.equal(await held(),0);
 const box=await cap.boundingBox();const x=box.x+12,y=box.y+20;
 await page.mouse.move(x,y);await page.mouse.down();await page.keyboard.down('ArrowUp');await page.keyboard.up('ArrowUp');assert.equal(await held(),1);
 await page.mouse.up();assert.equal(await held(),0);
 await page.keyboard.down('ArrowUp');await page.keyboard.down('w');await page.keyboard.up('ArrowUp');assert.equal(await held(),1);await page.keyboard.up('w');assert.equal(await held(),0);
 const cdp=await page.context().newCDPSession(page);
 const send=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 await send('touchStart',[[1,x,y],[2,x+16,y]]);assert.equal(await held(),1);
 await send('touchEnd',[[2,x+16,y]]);assert.equal(await held(),1);
 await send('touchCancel',[]);assert.equal(await held(),0);
 // Replacing keycap DOM during a run must not leave an orphaned pointer press.
 await send('touchStart',[[1,x,y]]);assert.equal(await held(),1);
 await page.evaluate(()=>window.previous=window.__sim);await page.click('#run');await page.waitForFunction(()=>window.__sim&&window.__sim!==window.previous);
 assert.equal(await held(),0);await send('touchCancel',[]);
 console.log('Mixed input: keyboard/screen in both release orders, aliases, two touches, cancellation and reload cleanup pass');
}finally{await browser.close();}
