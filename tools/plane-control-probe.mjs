import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.argv[2]??'http://127.0.0.1:5175/')+'#plane');await page.waitForFunction(()=>window.__sim?.model?.vals.some(v=>v.name==='THROTTLE'));
 const source=await page.inputValue('#source');
 await page.click('#build');const fin=await page.evaluate(()=>window.__sim.assembly.tiles.find(t=>t.node.attrs.angle?.includes('RUD')).id);
 await page.selectOption('#parts',String(fin));await page.click('#frame-model');
 await page.screenshot({path:fileURLToPath(new URL('../.shots/plane-control-geometry.png',import.meta.url))});
 await page.click('#run');await page.waitForFunction(()=>window.__sim&&!document.body.classList.contains('building'));
 const tick=await page.evaluate(()=>window.__sim.ticks);await page.keyboard.down('z');await page.waitForFunction(()=>window.__sim.env('THROTTLE')===60000);await page.keyboard.up('z');
 await page.waitForFunction(t=>window.__sim.ticks>=t+150,tick);await page.keyboard.down('ArrowDown');
 await page.waitForFunction(()=>window.__sim.corePosition().y>3.5);await page.keyboard.up('ArrowDown');
 const takeoff=await page.evaluate(()=>({ticks:window.__sim.ticks,position:window.__sim.corePosition().toArray(),throttle:window.__sim.env('THROTTLE')}));
 assert.ok(takeoff.position[2]<-60);assert.equal(takeoff.throttle,60000);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/plane-takeoff.png',import.meta.url))});
 await page.click('#build');const pending=page.waitForEvent('download');await page.click('#save-model');const downloaded=await pending;
 const stream=await downloaded.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),source);
 assert.equal(await page.inputValue('#source'),source);assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'plane takeoff pass',takeoff,errors}));
}finally{await browser.close()}
