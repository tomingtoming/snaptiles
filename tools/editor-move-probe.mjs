// Let native dialogs be presented before sending Escape; see webkit-dialog-diagnostic.mjs.
import {chromium,firefox,webkit} from 'playwright';import assert from 'node:assert/strict';
const engine=process.argv[3]??'chromium';
const b=await ({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});try{
 const p=await b.newPage({viewport:{width:390,height:844}});await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const source='Body {Core(){N:Frame(name=BRANCH){E:Wheel(angle=90,name=TYRE)} W:Chip(name=TARGET)}}';await p.fill('#source',source);await p.click('#build');await p.selectOption('#parts','1');await p.click('#placement summary');await p.click('#move-branch');
 assert.deepEqual(await p.locator('#move-parent option').evaluateAll(es=>es.map(e=>e.value)),['0','3']);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement.id==='move-branch',null,{polling:50,timeout:3000}).catch(async error=>{console.log(await p.evaluate(()=>({active:document.activeElement.outerHTML,open:document.querySelector('#move-branch-dialog').open,placement:document.querySelector('#placement').open})));throw error;});assert.equal(await p.inputValue('#source'),source);
 await p.click('#move-branch');await p.selectOption('#move-direction','W');await p.locator('#move-branch-form button[type=submit]').click();assert.match(await p.locator('#move-branch-status').textContent(),/既に部品/);assert.equal(await p.locator('#status').textContent(),'');assert.equal(await p.inputValue('#source'),source);
 await p.selectOption('#move-parent','3');await p.selectOption('#move-direction','S');await p.setViewportSize({width:320,height:568});await p.screenshot({path:`.shots/editor-move-dialog-${engine}.png`});await p.locator('#move-branch-form button[type=submit]').click();
 assert.equal(await p.inputValue('#parts'),'2');assert.match(await p.locator('#parts option:checked').textContent(),/BRANCH/);assert.equal(await p.locator('#parts option').count(),4);const moved=await p.inputValue('#source');
 await p.click('#edit-undo');assert.equal(await p.inputValue('#source'),source);assert.equal(await p.inputValue('#parts'),'1');await p.click('#edit-redo');assert.equal(await p.inputValue('#source'),moved);assert.equal(await p.inputValue('#parts'),'2');
 await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles[2]?.name==='BRANCH');assert.equal(await p.evaluate(()=>window.__sim.assembly.tiles[2].parent.name),'TARGET');assert.equal(await p.evaluate(()=>window.__sim.assembly.tiles[3].name),'TYRE');
 await p.click('#build');const event=p.waitForEvent('download');await p.click('#save-model');let bytes='';for await(const c of await(await event).createReadStream())bytes+=c;assert.equal(bytes,moved);
 // Independent right-angle oracle: N-folded TARGET is at (0,-.3,-.3),
 // rotated -90 degrees about X. Local north/south therefore point down/up.
 const folded='Body {Core(){N:Frame(angle=90,name=TARGET) W:Frame(angle=0,name=BRANCH){S:Wheel(angle=90,name=TYRE)}}}';
 const expected={N:[0,-.9,-.3],S:[0,.3,-.3],E:[.6,-.3,-.3],W:[-.6,-.3,-.3]};
 const near=(actual,wanted,label)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-wanted[i])<1e-6,`${label}[${i}]: ${v} != ${wanted[i]}`));
 const poses=()=>p.evaluate(()=>{
  const views=[...window.__scene.views.values()],core=views.find(v=>v.tile.type==='core').mesh.position;
  return Object.fromEntries(views.filter(v=>v.tile.name).map(v=>[v.tile.name,{p:v.mesh.position.clone().sub(core).toArray(),q:v.mesh.quaternion.toArray()}]));
 });
 for(const [dir,position] of Object.entries(expected)){
  await p.fill('#source',folded);await p.locator('#source').press('Shift+Tab');await p.selectOption('#parts','2');
  const before=await poses();await p.locator('#placement').evaluate(e=>e.open=true);await p.click('#move-branch');await p.selectOption('#move-parent','1');await p.selectOption('#move-direction',dir);await p.locator('#move-branch-form button[type=submit]').click();
  const after=await poses();near(after.TARGET.p,[0,-.3,-.3],'parent');near(after.BRANCH.p,position,dir+' branch');near(after.BRANCH.q,[-Math.SQRT1_2,0,0,Math.SQRT1_2],'branch rotation');
  near(after.TYRE.p,[position[0],position[1]+.3,position[2]+.3],dir+' wheel');near(after.TYRE.q,[0,0,0,1],'wheel rotation');assert.notDeepEqual(after.BRANCH.p,before.BRANCH.p);
  const relocated=await p.inputValue('#source');await p.click('#edit-undo');assert.equal(await p.inputValue('#source'),folded);assert.deepEqual(await poses(),before);await p.click('#edit-redo');assert.equal(await p.inputValue('#source'),relocated);assert.deepEqual(await poses(),after);assert.match(await p.locator('#parts option:checked').textContent(),/BRANCH/);
  await p.click('#run');await p.waitForFunction(d=>window.__sim?.assembly.tiles.find(t=>t.name==='BRANCH')?.dir===d&&window.__sim.assembly.tiles.find(t=>t.name==='BRANCH')?.parent?.name==='TARGET',dir);
  const rest=await p.evaluate(()=>Object.fromEntries(window.__sim.assembly.tiles.filter(t=>t.name).map(t=>[t.name,{p:t.position.toArray(),q:t.quaternion.toArray()}])));
  for(const name of ['TARGET','BRANCH','TYRE']){near(rest[name].p,after[name].p,name+' runtime rest');near(rest[name].q,after[name].q,name+' runtime orientation')}
  await p.click('#build');
 }
 console.log('Transformed relocation: four edges match independent coordinates, child rotation, preview/runtime rest poses and exact Undo/Redo');
 console.log('Move: named subtree, eligible parents, occupied-edge rejection, cancel/focus, selection, Undo/Redo, runtime parent and exact export pass');
}finally{await b.close()}
