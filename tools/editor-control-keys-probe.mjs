import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');await page.click('#new-model');
 const add=async(parent,edge,type)=>{await page.selectOption('#parts',String(parent));await page.selectOption('#add-type',type);await page.click(`[data-edge="${edge}"]`);};
 await add(0,'E','Trim');await page.selectOption('#angle-control','new');await page.click('#mirror-branch');
 await add(0,'S','Chip');await add(3,'S','Trim');await page.selectOption('#angle-control','new:vertical');
 await page.fill('#part-angle','25');await page.locator('#part-angle').press('Tab');
 await add(3,'N','Rudder');await page.selectOption('#angle-control','new:ad');
 await add(0,'N','Jet');await page.fill('#part-angle','90');await page.locator('#part-angle').press('Tab');
 await page.fill('#part-power','3000');await page.locator('#part-power').press('Tab');await page.selectOption('#power-control','new:zx');
 assert.match(await page.locator('#power-control option:checked').textContent(),/Z \/ X/);
 const source=await page.inputValue('#source');await page.click('#edit-undo');assert.equal(await page.inputValue('#power-control'),'constant');await page.click('#edit-redo');assert.equal(await page.inputValue('#source'),source);
 await page.click('#run');await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);
 const names=['ST_STEER_1','ST_STEER_2','ST_STEER_3','ST_POWER_1'];
 const values=()=>page.evaluate(names=>names.map(n=>window.__sim.env(n)),names);
 for(const [key,expected] of [['ArrowUp',[0,-25,0,0]],['ArrowRight',[30,0,0,0]],['a',[0,0,-30,0]],['z',[0,0,0,3000]]]){
  await page.keyboard.down(key);await page.waitForFunction(({names,expected})=>names.every((n,i)=>window.__sim.env(n)===expected[i]),{names,expected});
  await page.keyboard.up(key);await page.waitForFunction(names=>names.every(n=>window.__sim.env(n)===0),names);
 }
 await page.keyboard.down('w');await page.waitForTimeout(80);assert.deepEqual(await values(),[0,0,0,0]);await page.keyboard.up('w');
 for(const k of ['ArrowUp','ArrowRight','a','z'])await page.keyboard.down(k);
 await page.waitForFunction(names=>names.map(n=>window.__sim.env(n)).join(',')==='30,-25,-30,3000',names);
 for(const k of ['ArrowUp','ArrowRight','a','z'])await page.keyboard.up(k);
 await page.waitForFunction(names=>names.every(n=>window.__sim.env(n)===0),names);
 await page.setViewportSize({width:320,height:568});assert.deepEqual(await page.locator('#keys .cap').allTextContents(),['↑','↓','←','→','Z','X','A','D']);
 const thrust=page.locator('#keys .cap').filter({hasText:/^Z$/});const r=await thrust.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
 await page.waitForFunction(()=>window.__sim.env('ST_POWER_1')===3000);assert.equal((await values())[1],0);await page.mouse.up();await page.waitForFunction(()=>window.__sim.env('ST_POWER_1')===0);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-flight-controls.png',import.meta.url))});
 await page.click('#build');await page.selectOption('#parts','6');
 await page.locator('#power-control').scrollIntoViewIfNeeded();
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-key-binding-small.png',import.meta.url))});
 await page.click('#share-model');await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await page.inputValue('#share-url');
 const receiver=await browser.newPage();await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);assert.equal(await receiver.inputValue('#source'),source);
 assert.deepEqual(await receiver.evaluate(()=>window.__sim.model.keys.map(k=>k.key)),[2,3,0,1,7,9,4,5]);
 assert.deepEqual(errors,[]);console.log('Control keys: GUI pitch/roll/yaw/thrust, strength edits, Undo/Redo, independent/simultaneous physical keys, WASD isolation, screen key and shared bindings pass');
}finally{await browser.close()}
