import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const engine=process.argv[3]??'chromium';
const browser=await {chromium,firefox,webkit}[engine].launch(engine==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');await page.click('#new-model');
 await page.selectOption('#add-type','Trim');await page.click('[data-edge="S"]');await page.selectOption('#angle-control','new:vertical');
 await page.selectOption('#parts','0');await page.selectOption('#add-type','Jet');await page.click('[data-edge="N"]');
 await page.fill('#part-angle','90');await page.locator('#part-angle').press('Tab');
 await page.fill('#part-power','1000');await page.locator('#part-power').press('Tab');await page.selectOption('#power-control','hold:zx');
 assert.match(await page.locator('#power-control option:checked').textContent(),/Z \/ X（保持）/);
 const initial=await page.inputValue('#source');await page.fill('#part-power','2000');await page.locator('#part-power').press('Tab');const source=await page.inputValue('#source');
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),initial);await page.click('#edit-redo');assert.equal(await page.inputValue('#source'),source);
 await page.locator('#power-control').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`../.shots/editor-throttle-${engine}.png`,import.meta.url))});
 await page.click('#run');await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===3);
 const value=()=>page.evaluate(()=>window.__sim.env('ST_THROTTLE_1'));
 const settle=async()=>{const tick=await page.evaluate(()=>window.__sim.ticks);await page.waitForFunction(t=>window.__sim.ticks>=t+5,tick);};
 await page.keyboard.down('z');await page.waitForFunction(()=>window.__sim.env('ST_THROTTLE_1')>=200);await page.keyboard.up('z');await settle();const held=await value();
 assert.ok(held>0&&held<2000);await settle();assert.equal(await value(),held);
 await page.keyboard.down('ArrowUp');await page.waitForFunction(()=>window.__sim.env('ST_STEER_1')===-30);assert.equal(await value(),held);await page.keyboard.up('ArrowUp');await page.waitForFunction(()=>window.__sim.env('ST_STEER_1')===0);assert.equal(await value(),held);
 await page.keyboard.down('z');await page.waitForFunction(()=>window.__sim.env('ST_THROTTLE_1')===2000);await page.keyboard.up('z');await settle();assert.equal(await value(),2000);
 await page.keyboard.down('x');await page.waitForFunction(()=>window.__sim.env('ST_THROTTLE_1')===0);await page.keyboard.up('x');await settle();assert.equal(await value(),0);
 // Screen controls obey the same held-value behavior.
 const cap=page.locator('#keys .cap').filter({hasText:/^Z$/}),r=await cap.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForFunction(()=>window.__sim.env('ST_THROTTLE_1')>=100);await page.mouse.up();await settle();const screenHeld=await value();await settle();assert.equal(await value(),screenHeld);
 await page.click('#build');await page.click('#share-model');await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await page.inputValue('#share-url');await page.keyboard.press('Escape');
 const receiver=await browser.newPage();receiver.on('pageerror',e=>errors.push(e.message));await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim?.assembly?.tiles.length===3);assert.equal(await receiver.inputValue('#source'),source);assert.equal(await receiver.evaluate(()=>window.__sim.env('ST_THROTTLE_1')),0);
 await page.click('#run');await page.waitForFunction(()=>!document.body.classList.contains('building'));await settle();assert.equal(await value(),0);
 assert.deepEqual(errors,[]);console.log(`${engine}: throttle GUI, scaled maximum, Undo/Redo, ramp/hold/clamp/decrease, independent pitch, screen hold, shared source and restart zero pass`);
}finally{await browser.close()}
