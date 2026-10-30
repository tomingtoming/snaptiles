import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
// Runtime views against the original's measurements (docs/measured.md, camera).
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim?.ticks>60);
 const cam=()=>page.evaluate(()=>{const s=window.__scene,c=window.__sim.modelCenter(),p=s.camera.position;
  return {mode:s.viewMode,fov:s.viewFov,cameraFov:s.camera.fov,dx:p.x-c.x,dy:p.y-c.y,dz:p.z-c.z,dist:p.distanceTo(c),x:p.x,y:p.y,z:p.z,label:document.querySelector('#viewmode').getAttribute('aria-label')};});
 await page.locator('#view').click({position:{x:500,y:350}});
 // default A: the leash settles 8.0 m from the model centre, 2.0 m above it, starting toward +x/−z
 let c=await cam();assert.equal(c.mode,'A');assert.ok(c.label.includes('視点 A'));
 assert.ok(Math.abs(c.dist-8)<0.4&&Math.abs(c.dy-2)<0.4,`A leash ${JSON.stringify(c)}`);assert.ok(c.dx>5&&c.dz<0,`A starts at the original's bearing ${JSON.stringify(c)}`);
 await page.screenshot({path:fileURLToPath(new URL('../.shots/runtime-view-a.png',import.meta.url))});
 // I/O: ×0.8 / ×1.25 between 9.44° and 87.89°, one value for every view
 for(let i=0;i<9;i++)await page.keyboard.press('i');c=await cam();assert.ok(Math.abs(c.fov-9.437)<0.01&&Math.abs(c.cameraFov-c.fov)<1e-9,`zoom in floor ${c.fov}`);
 for(let i=0;i<12;i++)await page.keyboard.press('o');c=await cam();assert.ok(Math.abs(c.fov-87.89)<0.01,`zoom out ceiling ${c.fov}`);
 for(let i=0;i<3;i++)await page.keyboard.press('i');c=await cam();assert.ok(Math.abs(c.fov-45)<1e-9,`back to 45 ${c.fov}`);
 // keys: F8–F12 = A–E, Ctrl+F8–F12 = F–J, 1–9/0 = A–J
 await page.keyboard.press('F12');await page.waitForTimeout(200);c=await cam();assert.equal(c.mode,'E');assert.ok(Math.abs(c.dy-29.9)<0.05&&Math.hypot(c.dx,c.dz)<0.1,`E overhead ${JSON.stringify(c)}`);
 await page.keyboard.press('i');await page.keyboard.press('F9');c=await cam();assert.equal(c.mode,'B');assert.ok(Math.abs(c.fov-36)<1e-9,'zoom is shared by the views');await page.keyboard.press('o');
 await page.keyboard.press('Control+F12');c=await cam();assert.equal(c.mode,'J');
 const j0=await cam();await page.waitForTimeout(600);const j1=await cam();assert.ok(Math.hypot(j1.dx-j0.dx,j1.dz-j0.dz)>1,'J orbits');
 await page.keyboard.press('Control+F8');assert.equal((await cam()).mode,'F');
 await page.keyboard.press('Digit0');assert.equal((await cam()).mode,'J');await page.keyboard.press('Digit9');assert.equal((await cam()).mode,'I');
 // H freezes eye and direction; with the model driving away the camera stays put
 await page.keyboard.press('Digit1');await page.waitForTimeout(400);await page.keyboard.press('Digit8');const h0=await cam();assert.equal(h0.mode,'H');
 await page.keyboard.down('ArrowUp');await page.waitForTimeout(1500);const h1=await cam();assert.ok(Math.hypot(h1.x-h0.x,h1.y-h0.y,h1.z-h0.z)<1e-6,'H stays');
 // B starts at the current camera and does not follow (re-placement comes after 5 s or 76 m)
 await page.keyboard.press('Digit2');const b0=await cam();await page.waitForTimeout(1500);const b1=await cam();assert.ok(Math.hypot(b1.x-b0.x,b1.z-b0.z)<1e-6,'B stays put');
 await page.keyboard.up('ArrowUp');
 // A again: the wheel (a SnapTiles extra) lengthens the leash and driving keeps it
 await page.keyboard.press('KeyR');await page.keyboard.press('Digit1');await page.waitForTimeout(1500);const a0=await cam();
 await page.locator('#view').hover();await page.mouse.wheel(0,400);await page.waitForTimeout(1500);const a1=await cam();assert.ok(a1.dist>a0.dist*1.3,`wheel lengthens the leash ${a0.dist}→${a1.dist}`);
 assert.deepEqual(errors,[]);console.log('Runtime camera: A leash 8 m/+2 m at the original bearing, I/O 9.44–87.89° shared, F8–F12/Ctrl/digits A–J, E overhead, J orbit, H and B fixed, wheel leash pass');
}finally{await browser.close();}
