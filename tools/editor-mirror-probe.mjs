import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');
 const source='Body { Core(){ E:Frame(angle=15){N:Cowl(option=3,color=#ff4400) E:Wheel(angle=90,power=400,option=1)} } }';
 await page.fill('#source',source);await page.selectOption('#parts','1');await page.click('#mirror-branch');
 const mirrored=await page.inputValue('#source');assert.equal(await page.locator('#parts option').count(),7);assert.equal(await page.inputValue('#parts'),'4');
 await page.click('#frame-model');
 const meshError=await page.evaluate(()=>{
  const s=window.__scene;s.group.updateMatrixWorld(true);const a=s.views.get(2).mesh,b=s.views.get(5).mesh;
  const vertices=m=>{const p=m.geometry.attributes.position, out=[];for(let i=0;i<p.count;i++)out.push(m.position.clone().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld));return out;};
  const av=vertices(a),bv=vertices(b);return Math.max(...av.map(v=>{v.x*=-1;return Math.min(...bv.map(w=>v.distanceTo(w)))}));
 });assert.ok(meshError<1e-6,`reflected triangular Cowl vertices ${meshError}`);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-mirror-desktop.png',import.meta.url))});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-mirror-mobile.png',import.meta.url))});
 // The reflected root is selected. Its opposite edge is occupied: refuse without another history entry.
 await page.click('#mirror-branch');assert.equal(await page.inputValue('#source'),mirrored);assert.match(await page.locator('#status').textContent(),/既に部品/);
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),source);assert.equal(await page.inputValue('#parts'),'1');
 await page.click('#edit-redo');assert.equal(await page.inputValue('#source'),mirrored);assert.equal(await page.inputValue('#parts'),'4');
 await page.selectOption('#parts','0');assert.equal(await page.locator('#mirror-branch').isDisabled(),true);
 await page.click('#run');await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);
 assert.deepEqual(await page.evaluate(()=>window.__sim.assembly.tiles.filter(t=>t.type==='wheel').map(t=>t.node.attrs.power)),['400','- 400']);
 assert.deepEqual(errors,[]);console.log('Mirror: nested reflected geometry, triangular Cowl mesh, wheel power, selection, one-step Undo/Redo, occupied-edge rejection and runtime pass');
}finally{await browser.close()}
