import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const maker=await browser.newPage();await maker.goto(process.argv[2]??'http://127.0.0.1:5175/');await maker.waitForFunction(()=>window.__sim);
 const small='Body { Core(){E:Wheel(angle=90) W:Wheel(angle=90) N:Chip(){E:Wheel(angle=90) W:Wheel(angle=90)}} }';
 const large='Body { Core(){'+ 'E:Chip(){'.repeat(20)+'E:Chip()'+'}'.repeat(20)+'} }';
 const huge='Body { Core(){'+ 'E:Chip(){'.repeat(40)+'E:Chip()'+'}'.repeat(40)+'} }';
 for(const [name,source] of [['small',small],['large',large],['huge',huge]]) {
  await maker.fill('#source',source);await maker.click('#build');await maker.click('#share-model');
  await maker.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await maker.inputValue('#share-url');await maker.keyboard.press('Escape');
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(link);await page.waitForFunction(()=>window.__sim?.ticks>10);
  await page.waitForTimeout(500);
  const bounds=await page.evaluate(()=>{
   const s=window.__scene;s.group.updateMatrixWorld(true);s.camera.updateMatrixWorld();let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
   s.group.traverse(mesh=>{if(!mesh.geometry)return;mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
     const p=mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(s.camera);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
    }
   });return {minX,maxX,minY,maxY,pixels:Math.max((maxX-minX)*s.canvas.clientWidth/2,(maxY-minY)*s.canvas.clientHeight/2),distance:s.camDist};
  });
  assert.ok(bounds.minX>-1&&bounds.maxX<1&&bounds.minY>-1&&bounds.maxY<1,`${name} fits: ${JSON.stringify(bounds)}`);
  if(name==='small')assert.ok(bounds.pixels>90,`small shared model needs readable size: ${JSON.stringify(bounds)}`);
  await page.screenshot({path:fileURLToPath(new URL(`../.shots/runtime-frame-${name}.png`,import.meta.url))});
  await page.locator('#view').hover();await page.mouse.wheel(0,250);await page.waitForTimeout(100);
  const manual=await page.evaluate(()=>window.__scene.camDist);assert.ok(manual>bounds.distance,'zoom out must never jump inward');await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__scene.camDist),manual,'driving does not auto-reset manual zoom');
  console.log(name,bounds);await page.close();
 }
}finally{await browser.close();}
