import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); await page.click('#new-model');
 await page.selectOption('#add-type','Wheel'); await page.click('[data-edge="E"]');
 await page.fill('#part-angle','65'); await page.locator('#part-angle').press('Tab');
 await page.selectOption('#part-option','2');
 await page.selectOption('#add-type','Chip');
 for(const dir of ['N','W','E','S']) {
  await page.selectOption('#parts','1'); await page.click(`[data-edge="${dir}"]`);
 }
 await page.selectOption('#parts','1');
 for(const [width,height,yaw,pitch] of [[390,844,.6,.35],[390,844,2.1,.7],[1000,700,3.2,.2]]) {
  await page.setViewportSize({width,height});
  await page.evaluate(({yaw,pitch})=>{window.__scene.camYaw=yaw;window.__scene.camPitch=pitch;},{yaw,pitch});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const errors=await page.evaluate(()=>{
   const s=window.__scene, parent=s.views.get(1), rect={width:s.canvas.clientWidth,height:s.canvas.clientHeight};
   return [...document.querySelectorAll('[data-direction]')].map(mark=>{
    const child=[...s.views.values()].find(v=>v.tile.parent===parent.tile&&v.tile.dir===mark.dataset.direction);
    if(!child) throw new Error('Missing fixture child');
    const anchor=child.tile.anchor.clone().add(parent.mesh.position.clone().sub(parent.tile.position)).project(s.camera);
    const line=mark.querySelector('line');
    return Math.hypot(Number(line.getAttribute('x1'))-(anchor.x+1)*rect.width/2,Number(line.getAttribute('y1'))-(1-anchor.y)*rect.height/2);
   });
  });
  assert.ok(errors.every(e=>e<.01),JSON.stringify(errors));
  await page.screenshot({path:fileURLToPath(new URL(`../.shots/editor-direction-${width}-${yaw}.png`,import.meta.url))});
 }
 await page.click('#run'); await page.waitForFunction(()=>getComputedStyle(document.querySelector('.attachment-directions')).display==='none');
 console.log('Direction markers: actual child hinge anchors on folded enlarged wheel, camera rotation, resize and run hiding pass');
} finally {await browser.close();}
