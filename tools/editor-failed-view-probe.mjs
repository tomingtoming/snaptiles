import {chromium} from 'playwright';import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 assert.ok(await p.evaluate(()=>window.__scene.views.size)>0);
 await p.evaluate(()=>{
  const s=window.__scene;s.setLines3d([0,0,0,1,1,1,1,0,0]);s.syncProjectiles([{body:{translation:()=>({x:0,y:2,z:0})}}]);
  const hud=document.querySelector('#hud'),ctx=hud.getContext('2d');ctx.fillRect(0,0,10,10);
  document.querySelector('#source').value='Body {Core(){E:Unknown()}}';document.querySelector('#run').click();
 });
 await p.waitForFunction(()=>window.__sim===null&&document.querySelector('#status').textContent.includes('未対応'));
 const cleared=await p.evaluate(()=>({parts:window.__scene.views.size,lines:window.__scene.lines.visible,shells:window.__scene.shellPool.filter(m=>m.visible).length,hud:document.querySelector('#hud').getContext('2d').getImageData(0,0,1,1).data[3]}));
 assert.deepEqual(cleared,{parts:0,lines:false,shells:0,hud:0});
 await p.screenshot({path:'.shots/editor-failed-model.png'});
 await p.click('#build');await p.fill('#source','Body {Core(){E:Wheel(angle=90)}}');assert.equal(await p.evaluate(()=>window.__scene.views.size),2);
 await p.fill('#source','Body {Core(){');assert.equal(await p.evaluate(()=>window.__scene.views.size),0);assert.equal(await p.locator('#parts option').count(),0);
 await p.keyboard.press('Control+z');assert.equal(await p.evaluate(()=>window.__scene.views.size),2);await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);
 // A rejected older asynchronous start must not erase a newer editor preview.
 await p.evaluate(()=>{const proto=Object.getPrototypeOf(window.__sim),start=proto.start;proto.start=async function(){if(this.env('WAIT')===1){const free=this.physics.world.free.bind(this.physics.world);this.physics.world.free=()=>{window.disposedOld=true;free()};await new Promise(resolve=>window.releaseOld=resolve);throw new Error('old delayed failure')}return start.call(this)}});
 await p.fill('#source','Val {WAIT(default=1)} Body {Core(){N:Chip()}}');await p.click('#run');await p.waitForFunction(()=>window.releaseOld);
 await p.click('#build');assert.equal(await p.evaluate(()=>window.__scene.views.size),2);await p.evaluate(()=>window.releaseOld());await p.waitForFunction(()=>window.disposedOld);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await p.evaluate(()=>window.__scene.views.size),2);assert.equal(await p.locator('#status').textContent(),'');
 await p.fill('#source','Body {Core(){S:Chip()}}');await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);assert.equal(await p.evaluate(()=>window.__scene.views.size),2);
 assert.deepEqual(errors,[]);console.log('Failed view: old model/lines/projectiles/HUD cleared, invalid-preview Undo recovery and stale async rejection isolation pass');
}finally{await b.close()}
