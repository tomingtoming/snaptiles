import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const lua='Lua { function OnFrame() out(0, "branch test") end }';
 const untouched='E:Frame(angle=17,color=#123456){N:Trim(angle=A)}';
 const source=`// preserve branches\nVal { A(default=0,min=-20,max=20,step=1) }\nBody {Core(){\nN:Frame(angle=10){N:Chip(color=#ffaa00) E:Wheel(angle=90,power=A)}\n${untouched}\nW:Weight(option=2)\n}}\n${lua}`;
 await p.setInputFiles('#model-file',{name:'branches.rcd',mimeType:'text/plain',buffer:Buffer.from(source)});await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);await p.click('#build');
 const history=[];
 const snapshot=async()=>({text:await p.inputValue('#source'),selected:await p.inputValue('#parts')});
 const step=async(action,count,type)=>{const before=await snapshot();await action();const after=await snapshot();history.push({before,after});assert.equal(await p.locator('#parts option').count(),count);assert.equal(await p.inputValue('#part-type'),type);assert.ok(after.text.includes(untouched));assert.ok(after.text.endsWith(lua));assert.equal(await p.evaluate(()=>window.__scene.selectedId),Number(after.selected));};
 await p.selectOption('#parts','1');await p.click('#copy-branch');await p.selectOption('#parts','0');
 await step(()=>p.click('[data-edge="S"]'),10,'Frame');assert.equal(await p.inputValue('#parts'),'7');
 await p.selectOption('#parts','9');await step(()=>p.selectOption('#power-control','new'),10,'Wheel');
 await step(async()=>{await p.fill('#part-power','1500');await p.locator('#part-power').press('Tab')},10,'Wheel');
 await p.selectOption('#parts','1');await step(()=>p.click('#part-delete'),7,'Core');
 // The untouched east branch moved earlier after removing the entire north branch.
 await p.selectOption('#parts','1');assert.equal(await p.inputValue('#part-angle'),'17');
 await p.selectOption('#parts','4');await step(()=>p.click('#mirror-branch'),10,'Frame');assert.equal(await p.inputValue('#parts'),'7');
 const final=await snapshot();
 for(let i=history.length-1;i>=0;i--){await p.click('#edit-undo');assert.deepEqual(await snapshot(),history[i].before,`undo ${i}`)}
 assert.equal(await p.inputValue('#source'),source);
 for(let i=0;i<history.length;i++){await p.click('#edit-redo');assert.equal(await p.inputValue('#source'),history[i].after.text,`redo ${i}`)}
 assert.deepEqual(await snapshot(),final);
 await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===10);
 assert.equal(await p.evaluate(()=>window.__sim.scriptError),null);
 await p.focus('#view');await p.keyboard.down('ArrowUp');await p.waitForFunction(()=>window.__sim.env('ST_POWER_1')===1500);await p.keyboard.up('ArrowUp');await p.waitForFunction(()=>window.__sim.env('ST_POWER_1')===0);
 await p.click('#build');assert.deepEqual(await snapshot(),final);
 const download=p.waitForEvent('download');await p.click('#save-model');const stream=await(await download).createReadStream();let bytes='';for await(const c of stream)bytes+=c;assert.equal(bytes,final.text);
 await p.click('#share-model');await p.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await p.inputValue('#share-url');
 const receiver=await b.newPage({viewport:{width:390,height:844}});await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim?.assembly?.tiles.length===10);assert.equal(await receiver.inputValue('#source'),final.text);await receiver.click('#build');await receiver.selectOption('#parts','9');assert.equal(await receiver.inputValue('#part-type'),'Wheel');assert.equal(await receiver.inputValue('#part-power'),'1500');await receiver.fill('#part-power','1200');await receiver.locator('#part-power').press('Tab');await receiver.click('#edit-undo');assert.equal(await receiver.inputValue('#source'),final.text);await receiver.close();
 assert.deepEqual(errors,[]);console.log('Branch workflow: copy, shared power, subtree deletion, mirror, five-step Undo/Redo, runtime controls, exact save and fresh shared edit pass');
}finally{await b.close()}
