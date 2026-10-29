import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); await page.click('#new-model');
 await page.selectOption('#add-type','Wheel'); await page.click('[data-edge="E"]');
 await page.fill('#part-angle','90'); await page.locator('#part-angle').press('Tab');
 await page.selectOption('#part-option','2');
 const check=await page.evaluate(()=>{
   const scene=window.__scene; scene.group.updateMatrixWorld(true);
   let bottom=Infinity, extent=0;
   scene.group.traverse(mesh=>{
     if(!mesh.geometry)return;
     mesh.geometry.computeBoundingBox(); const b=mesh.geometry.boundingBox;
     for(const x of [b.min.x,b.max.x]) for(const y of [b.min.y,b.max.y]) for(const z of [b.min.z,b.max.z]) {
       const p=mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld); bottom=Math.min(bottom,p.y); p.project(scene.camera); extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
     }
   });
   return {scale:scene.views.get(1).mesh.scale.x,bottom,extent};
 });
 assert.equal(check.scale,2); assert.ok(check.bottom>=0.049,JSON.stringify(check)); assert.ok(check.extent<1,JSON.stringify(check));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-wheel-option-mobile.png',import.meta.url))});
 for(const sel of ['#part-type','#part-angle','#part-option','#part-delete']) {
   assert.equal(await page.locator(sel).evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}),true,sel);
 }
 await page.click('#edit-undo'); assert.equal(await page.inputValue('#part-option'),'0');
 await page.click('#edit-redo'); assert.equal(await page.inputValue('#part-option'),'2');
 await page.click('#run'); await page.waitForFunction(()=>window.__sim?.assembly?.tiles[1]?.option===2);
 assert.equal(await page.evaluate(()=>window.__sim.assembly.tiles[1].type),'wheel');
 await page.click('#build'); await page.selectOption('#parts','1'); await page.selectOption('#part-type','Weight');
 await page.selectOption('#part-option','8');
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-weight-option-mobile.png',import.meta.url))});
 await page.click('#run'); await page.waitForFunction(()=>window.__sim?.assembly?.tiles[1]?.option===8);
 assert.ok(Math.abs(await page.evaluate(()=>window.__sim.assembly.tiles[1].mass)-806.4)<0.001);
 const bodyMass = await page.evaluate(()=>[...new Map(window.__sim.physics.tiles.map(t=>[t.body.handle,t.body])).values()].reduce((sum,b)=>sum+b.mass(),0));
 assert.ok(Math.abs(bodyMass-(806.4+25.2))<0.1, `Core + Weight physics mass: ${bodyMass}`);
 await page.click('#build'); await page.fill('#source','Val { R(default=2) } Body { Core(){E:Wheel(option=R)} }');
 await page.selectOption('#parts','1'); assert.equal(await page.locator('#part-option').isDisabled(),true);
 console.log('Options: wheel preview radius/ground clearance; undo/redo; runtime option; ballast mass; expression protection pass');
} finally {await browser.close();}
