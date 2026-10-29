import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const bad='// keep me\nBody {Core(){\n E:Wheeel(angle=90,power=0)\n}}\nLua { function OnFrame() out(0,"kept") end }';
 await p.setInputFiles('#model-file',{name:'unknown.rcd',mimeType:'text/plain',buffer:Buffer.from(bad)});
 await p.waitForFunction(()=>window.__sim===null&&document.querySelector('#status').textContent.includes('Wheeel'));
 assert.match(await p.locator('#status').textContent(),/未対応.*Wheeel.*line 3/);assert.equal(await p.inputValue('#source'),bad);
 await p.click('#build');assert.equal(await p.locator('#parts option').count(),0);assert.equal(await p.locator('[data-edge="N"]').isDisabled(),true);
 await p.locator('#source').evaluate(e=>{e.focus();const start=e.value.indexOf('Wheeel');e.setSelectionRange(start,start+6)});await p.keyboard.insertText('Wheel');
 const fixed=bad.replace('Wheeel','Wheel');assert.equal(await p.inputValue('#source'),fixed);assert.equal(await p.locator('#parts option').count(),2);
 await p.keyboard.press('Control+z');assert.equal(await p.inputValue('#source'),bad);assert.match(await p.locator('#status').textContent(),/未対応/);
 await p.keyboard.press('Control+Shift+z');assert.equal(await p.inputValue('#source'),fixed);assert.equal(await p.locator('#status').textContent(),'');
 await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);assert.equal(await p.evaluate(()=>window.__sim.assembly.tiles[1].spec.wheel),true);assert.equal(await p.evaluate(()=>window.__sim.scriptError),null);
 await p.click('#build');const event=p.waitForEvent('download');await p.click('#save-model');const file=await event;assert.equal(file.suggestedFilename(),'unknown.rcd');let text='';for await(const chunk of await file.createReadStream())text+=chunk;assert.equal(text,fixed);
 assert.deepEqual(errors,[]);console.log('Unsupported part: explicit type/line error, original source retained, repair/Undo/Redo, real Wheel runtime and exact export pass');
}finally{await b.close()}
