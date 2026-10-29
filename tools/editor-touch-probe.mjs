import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');
 await page.evaluate(()=>{window.pointerEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.querySelector('#view').addEventListener(type,e=>window.pointerEvents.push([type,e.pointerId]));});
 const cdp=await page.context().newCDPSession(page);
 const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const send=async(type,points)=>{await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});await frame();};
 const read=()=>page.evaluate(()=>({yaw:window.__scene.camYaw,dist:window.__scene.camDist,left:window.__sim.api()._ML(),right:window.__sim.api()._MR()}));
 await send('touchStart',[[1,140,150],[2,240,150]]);const start=await read();
 await send('touchMove',[[1,110,150],[2,270,150]]);const zoom=await read();assert.ok(zoom.dist<start.dist*0.75);
 // CDP touchEnd names the points being lifted, not the remaining points.
 await send('touchEnd',[[2,270,150]]);assert.equal((await read()).left,1);
 await send('touchMove',[[1,150,150]]);const orbit=await read();assert.ok(Math.abs(orbit.yaw-zoom.yaw)>0.1);assert.ok(Math.abs(orbit.dist-zoom.dist)<0.001);
 assert.equal(await page.evaluate(()=>window.pointerEvents.filter(e=>e[0]==='pointerdown').length),2);
 await send('touchCancel',[]);assert.equal((await read()).left,0);
 await send('touchStart',[[1,140,150]]);assert.equal((await read()).left,1);await send('touchCancel',[]);assert.equal((await read()).left,0);
 await send('touchStart',[[1,140,150]]);
 await send('touchMove',[[1,142,150]]);
 await page.evaluate(()=>{const id=window.pointerEvents.filter(e=>e[0]==='pointerdown').at(-1)[1];document.querySelector('#view').releasePointerCapture(id);});
 await send('touchMove',[[1,141,150]]); // Capture changes are processed before the next pointer event.
 const events = await page.evaluate(()=>window.pointerEvents);
 const captured = events.filter(e=>e[0]==='pointerdown').at(-1)[1];
 assert.ok(events.some(e=>e[0]==='gotpointercapture'&&e[1]===captured));
 assert.ok(events.some(e=>e[0]==='lostpointercapture'&&e[1]===captured));
 assert.equal((await read()).left,0);await send('touchEnd',[]);
 await send('touchStart',[[1,140,150]]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await read()).left,0);await send('touchCancel',[]);
 // Mouse button chords update from the buttons mask as individual buttons lift.
 await page.mouse.move(150,150);await page.mouse.down({button:'left'});await page.mouse.down({button:'right'});await frame();
 assert.equal((await read()).left,1);assert.equal((await read()).right,1);
 await page.mouse.up({button:'left'});await frame();assert.equal((await read()).left,0);assert.equal((await read()).right,1);
 await page.mouse.up({button:'right'});await frame();assert.equal((await read()).right,0);
 console.log('Touch: pinch, same remaining pointer orbits, cancel, capture loss, blur handler and mouse button chords pass');
}finally{await browser.close();}
