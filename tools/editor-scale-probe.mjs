import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=process.argv[2]??'http://127.0.0.1:5175/';await page.goto(url);await page.waitForFunction(()=>window.__sim);
 const n=100,vals=Array.from({length:n},(_,i)=>`ST_STEER_${i+1}(default=0,min=-30,max=30,step=30)`).join('\n');
 const keys=Array.from({length:n},(_,i)=>`2:ST_STEER_${i+1}(step=-30) 3:ST_STEER_${i+1}(step=30)`).join('\n');
 const source=`// Named construction stress fixture\nVal {${vals}} Key {${keys}} Body {Core(){${Array.from({length:n},(_,i)=>`N:Trim(name=PART_${i+1},angle=ST_STEER_${i+1}){`).join('')}${'}'.repeat(n)}}}`;
 await page.setInputFiles('#model-file',{name:'many-controls.rcd',mimeType:'text/plain',buffer:Buffer.from(source)});await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===101);await page.click('#build');
 const times=await page.evaluate(()=>{const select=document.querySelector('#parts'),times=[];for(const i of [1,20,40,60,80]){select.value=String(i);const start=performance.now();select.dispatchEvent(new Event('change'));times.push(performance.now()-start)}return times});
 assert.equal(await page.inputValue('#parts'),'80');assert.match(await page.locator('#angle-control option:checked').textContent(),/← \/ →/);
 await page.fill('#part-angle','45');await page.locator('#part-angle').press('Tab');assert.equal(await page.inputValue('#part-angle'),'45');
 const changed=await page.inputValue('#source');assert.ok(changed.includes('name=PART_80'));await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),source);assert.equal(await page.inputValue('#part-angle'),'30');await page.click('#edit-redo');assert.equal(await page.inputValue('#source'),changed);assert.equal(await page.inputValue('#part-angle'),'45');
 await page.click('#copy-branch');assert.match(await page.locator('#status').textContent(),/名前付き/);assert.equal(await page.inputValue('#source'),changed);
 await page.click('#mirror-branch');assert.match(await page.locator('#status').textContent(),/名前付き/);assert.equal(await page.inputValue('#source'),changed);
 // Existing Lua-driven model: edit one colour token, export, reopen and compare every byte.
 await page.goto(url+'#walker');await page.waitForFunction(()=>window.__sim?.model?.vals.some(v=>v.name==='FL_H'));const original=await page.inputValue('#source');
 const range=await page.evaluate(()=>window.__sim.assembly.tiles[2].node.source.attributes.color);
 await page.click('#build');await page.selectOption('#parts','2');assert.equal(await page.locator('#part-angle').isDisabled(),true);
 await page.click('#appearance summary');await page.fill('#part-color','#abcdef');await page.locator('#part-color').dispatchEvent('change');
 const expected=original.slice(0,range[0])+'#abcdef'+original.slice(range[1]);assert.equal(await page.inputValue('#source'),expected);
 const event=page.waitForEvent('download');await page.click('#save-model');const download=await event,stream=await download.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const bytes=Buffer.concat(chunks);assert.equal(bytes.toString(),expected);
 await page.setInputFiles('#model-file',{name:download.suggestedFilename(),mimeType:'text/plain',buffer:bytes});await page.waitForFunction(()=>window.__sim&& !document.body.classList.contains('building'));assert.equal(await page.inputValue('#source'),expected);assert.equal(await page.evaluate(()=>window.__sim.scriptError),null);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'scale and scripted import pass',parts:101,controls:100,selectionMs:times,medianMs:[...times].sort((a,b)=>a-b)[2],checks:['control labels','strength/Undo/Redo','named-copy/mirror guard','Lua exact-byte colour edit/export/reopen']}));
}finally{await browser.close()}
