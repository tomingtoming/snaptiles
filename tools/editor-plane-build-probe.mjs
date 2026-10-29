import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.argv[2]??'http://127.0.0.1:5175/')+'#plane');await page.waitForFunction(()=>window.__sim?.model?.vals.some(v=>v.name==='THROTTLE'));
 const blueprint=await page.evaluate(()=>window.__sim.model.body);await page.click('#build');
 const poses=()=>page.evaluate(()=>[...window.__scene.views.values()].map(v=>({position:v.mesh.position.toArray(),quaternion:v.mesh.quaternion.toArray()})));
 const reference=await poses();await page.click('#new-model');const bindings=new Map();let next=0,rudderId;
 const create=async(node,parent)=>{
  let id=0;
  if(parent!==null){await page.selectOption('#parts',String(parent));await page.selectOption('#add-type',node.type);await page.click(`[data-edge="${node.dir}"]`);id=++next;assert.equal(await page.inputValue('#parts'),String(id));}
  if(node.attrs.color){await page.locator('#appearance').evaluate(e=>e.open=true);await page.fill('#part-color',node.attrs.color.replace(/\s/g,''));await page.locator('#part-color').dispatchEvent('change');}
  for(const attr of ['angle','power']){
   const raw=node.attrs[attr];if(raw===undefined)continue;const expression=raw.replace(/\s/g,'');
   const field=attr==='angle'?'#part-angle':'#part-power',control=attr==='angle'?'#angle-control':'#power-control';
   if(Number.isFinite(Number(expression))){await page.fill(field,expression);await page.locator(field).press('Tab');continue;}
   if(attr==='angle'&&!await page.locator('#angle-control-row').isVisible())await page.click('#angle-settings');
   const name=expression.replace(/^-/,'');
   if(!bindings.has(name)){
    if(name==='THROTTLE'){await page.fill(field,'60000');await page.locator(field).press('Tab');await page.selectOption(control,'hold:zx');}
    else{
     await page.selectOption(control,name==='AIL'?'new':name==='ELEV'?'new:vertical':'new:ad');
     await page.fill(field,name==='ELEV'?'25':'20');await page.locator(field).press('Tab');
    }
    bindings.set(name,await page.inputValue(control));
   }
   await page.selectOption(control,(expression.startsWith('-')?'-':'')+bindings.get(name));
   if(name==='RUD')rudderId=id;
  }
  for(const child of node.children)await create(child,id);
 };
 await create(blueprint,null);await page.locator('#appearance').evaluate(e=>e.open=false);
 const built=await page.inputValue('#source'),actual=await poses();assert.equal(actual.length,reference.length);
 for(let i=0;i<actual.length;i++)for(const key of ['position','quaternion'])for(let j=0;j<actual[i][key].length;j++)assert.ok(Math.abs(actual[i][key][j]-reference[i][key][j])<1e-6,`pose ${i} ${key} ${j}`);
 await page.selectOption('#parts',String(rudderId));assert.equal(await page.locator('#angle-control-row').isVisible(),true);assert.match(await page.locator('#angle-control option:checked').textContent(),/A \/ D/);
 await page.click('#frame-model');await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-built-plane.png',import.meta.url))});
 await page.click('#run');await page.waitForFunction(count=>window.__sim?.assembly?.tiles.length===count&&!document.body.classList.contains('building'),actual.length);
 const tick=await page.evaluate(()=>window.__sim.ticks),throttle=bindings.get('THROTTLE');await page.keyboard.down('z');await page.waitForFunction(n=>window.__sim.env(n)===60000,throttle);await page.keyboard.up('z');
 await page.waitForFunction(t=>window.__sim.ticks>=t+150,tick);await page.keyboard.down('ArrowDown');await page.waitForFunction(()=>window.__sim.corePosition().y>3.5);await page.keyboard.up('ArrowDown');
 const takeoff=await page.evaluate(()=>window.__sim.corePosition().toArray());assert.ok(takeoff[2]<-60);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-built-plane-takeoff.png',import.meta.url))});
 await page.click('#build');await page.click('#rename-model');await page.fill('#filename-input','GUI飛行機');
 const downloadEvent=page.waitForEvent('download');await page.keyboard.press('Control+s');const download=await downloadEvent;assert.equal(download.suggestedFilename(),'GUI飛行機.rcd');
 const stream=await download.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const bytes=Buffer.concat(chunks);assert.equal(bytes.toString(),built);
 await page.click('#share-model');await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await page.inputValue('#share-url');await page.keyboard.press('Escape');
 const receiver=await browser.newPage({viewport:{width:390,height:844}});receiver.on('pageerror',e=>errors.push(e.message));await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim);assert.equal(await receiver.inputValue('#source'),built);
 await receiver.click('#build');await receiver.selectOption('#parts',String(rudderId));assert.equal(await receiver.inputValue('#angle-control'),bindings.get('RUD'));
 await receiver.locator('#angle-control').scrollIntoViewIfNeeded();await receiver.screenshot({path:fileURLToPath(new URL('../.shots/editor-plane-tail-small.png',import.meta.url))});
 await receiver.fill('#part-angle','15');await receiver.locator('#part-angle').press('Tab');assert.equal(await receiver.inputValue('#part-angle'),'15');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'GUI aircraft build/fly/save/share/re-edit pass',parts:actual.length,takeoff,sourceBytes:bytes.length,bindings:Object.fromEntries(bindings)}));
}finally{await browser.close()}
