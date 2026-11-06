import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:640,height:360}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   let callbacks=[], now, manual=false; const native=requestAnimationFrame.bind(window);
   window.__startManualFrames=()=>{manual=true;};window.__queuedFrames=()=>callbacks.length;
   window.requestAnimationFrame=cb=>{if(!manual)return native(cb);callbacks.push(cb);return callbacks.length;};
   window.__advanceFrame=dt=>{now=(now??performance.now())+dt;const pending=callbacks;callbacks=[];for(const cb of pending)cb(now);};
 });
 await page.goto(process.argv[2]+'?bare#plane');
 await page.waitForFunction(()=>window.__sim,{polling:100});
 await page.evaluate(()=>window.__startManualFrames());
 await page.waitForFunction(()=>window.__queuedFrames()>0,{},{polling:100});
 const results=await page.evaluate(()=>{
   const sim=window.__sim, scene=window.__scene;
   sim.evalLua('THROTTLE=60000');
   for(let i=0;i<600;i++)window.__advanceFrame(1000/60);
   const results=[];
   for(const hz of [60,144])for(const mode of ['A','C','D','E','F','I']) {
     scene.setView(/** @type {import('../src/render/scene').ViewId} */ (mode));
     let tick=sim.ticks, p=scene.views.get(0).mesh.position.clone(), sameTick=0, smooth=0, worstOffset=0;
     for(let i=0;i<72;i++){
       window.__advanceFrame(1000/hz);
       const mesh=scene.views.get(0).mesh;
       if(sim.ticks===tick){sameTick++;if(mesh.position.distanceTo(p)>0.00001)smooth++;}
       if(['C','D','I'].includes(mode)){
         const expected=mode==='C'?[0.4,0.8,2.3]:mode==='D'?[0.16,0,7.4]:[0.8,0,0.8];
         const relative=scene.camera.position.clone().sub(mesh.position).applyQuaternion(mesh.quaternion.clone().invert());
         worstOffset=Math.max(worstOffset,relative.distanceTo(relative.clone().set(expected[0],expected[1],expected[2])));
       }
       tick=sim.ticks;p.copy(mesh.position);
     }
     results.push({hz,mode,sameTick,smooth,worstOffset,kmh:sim.coreVelocity().length()*3.6});
   }
   return results;
 });
 for(const r of results){assert.ok(r.kmh>30);assert.ok(r.sameTick>20);assert.equal(r.smooth,process.argv.includes('--baseline')?0:r.sameTick,JSON.stringify(r));assert.ok(r.worstOffset<1e-6,JSON.stringify(r));}
 // Pause and reset use the current pose, without blending back to the previous run.
 await page.locator('#view').focus();await page.keyboard.press('Space');
 await page.evaluate(()=>window.__advanceFrame(1000/60));
 const paused=await page.evaluate(()=>{const s=window.__scene;return s.views.get(0).mesh.position.distanceTo(window.__sim.corePosition());});
 assert.ok(paused<1e-6);
 await page.keyboard.press('Space');await page.evaluate(()=>window.__advanceFrame(1000/120));
 assert.ok(await page.evaluate(()=>window.__scene.views.get(0).mesh.position.distanceTo(window.__sim.corePosition())<1e-6));
 await page.keyboard.press('Space');
 await page.keyboard.press('KeyR');await page.evaluate(()=>window.__advanceFrame(1000/60));
 assert.ok(await page.evaluate(()=>window.__scene.views.get(0).mesh.position.distanceTo(window.__sim.corePosition())<1e-6));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,paused,errors}));
}finally{await browser.close();}
