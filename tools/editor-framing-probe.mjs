import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1600,height:600}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.fill('#source','Body { Core(){ E:Chip(){E:Chip(){E:Chip(){E:Chip(){E:Chip(){E:Chip(){E:Chip()}}}}}} W:Chip(){W:Chip(){W:Chip(){W:Chip(){W:Chip(){W:Chip(){W:Chip()}}}}}} } }');
 await page.click('#build'); await page.click('#frame-model');
 const settle=()=>page.waitForTimeout(800);
 const extent=()=>page.evaluate(()=>{
  const s=window.__scene; s.group.updateMatrixWorld(true); s.camera.updateMatrixWorld(); let max=0;
  s.group.traverse(mesh=>{
   if(!mesh.geometry)return; mesh.geometry.computeBoundingBox(); const b=mesh.geometry.boundingBox;
   for(const x of [b.min.x,b.max.x]) for(const y of [b.min.y,b.max.y]) for(const z of [b.min.z,b.max.z]) {
    const p=mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(s.camera);
    max=Math.max(max,Math.abs(p.x),Math.abs(p.y));
   }
  }); return max;
 });
 await settle(); assert.ok(await extent()<1,'initial full frame');
 for(const yaw of [0,1.5,3,4.5]) {
  await page.evaluate(yaw=>{window.__scene.camYaw=yaw;},yaw); await settle();
  assert.ok(await extent()<1,`full frame after orbit ${yaw}`);
 }
 await page.evaluate(()=>{window.__scene.camYaw=.6;}); await settle();
 for(const viewport of [{width:850,height:1000},{width:390,height:844},{width:1600,height:600}]) {
  await page.setViewportSize(viewport); await settle();
  const e=await extent(); assert.ok(e<1,`resize ${viewport.width}: projected extent ${e}`);
  await page.screenshot({path:fileURLToPath(new URL(`../.shots/editor-framing-${viewport.width}.png`,import.meta.url))});
 }
 // A manual zoom must survive a resize round trip instead of being reset to full fit.
 const before=await page.evaluate(()=>{const s=window.__scene;s.camDist*=.7;return s.camDist;});
 await page.setViewportSize({width:850,height:1000}); await settle();
 await page.setViewportSize({width:1600,height:600}); await settle();
 assert.ok(Math.abs(await page.evaluate(()=>window.__scene.camDist)-before)<1e-8,'manual zoom preserved');
 await page.click('#run'); await page.waitForFunction(()=>!document.body.classList.contains('building'));
 const runningDistance=await page.evaluate(()=>window.__scene.camDist);
 await page.setViewportSize({width:850,height:1000}); await settle();
 assert.equal(await page.evaluate(()=>window.__scene.camDist),runningDistance,'runtime camera distance unchanged');
 console.log('Framing: complete geometry remains visible across wide, narrow desktop and mobile viewports');
} finally {await browser.close();}
