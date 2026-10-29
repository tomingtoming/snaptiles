import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const engine=process.argv[3]??'chromium';
const b=await({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
try{
 const p=await b.newPage({viewport:{width:320,height:568}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const base='Val { P(default=0,min=0,max=100,step=100) } Key { 0:P(step=100) } Body {Core(){E:Jet(power=P)}}';
 for(const fn of ['OnInit','OnFrame']){
  const bad=base+` Lua { function ${fn}() error(string.rep("long_error_",80)) end }`;
  await p.fill('#source',bad);await p.click('#run');await p.waitForFunction(()=>window.__sim?.scriptError);
  await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('long_error_'));
  assert.equal(await p.inputValue('#source'),bad);
  const metrics=await p.evaluate(()=>{const e=document.querySelector('#status'),r=e.getBoundingClientRect();return {width:document.documentElement.scrollWidth,right:r.right,bottom:r.bottom,height:r.height,overflow:e.scrollHeight>e.clientHeight}});
  assert.ok(metrics.width<=320&&metrics.right<=320&&metrics.bottom<=569&&metrics.height<=86&&metrics.overflow,JSON.stringify(metrics));
  await p.locator('#status').focus();await p.keyboard.press('PageDown');await p.waitForFunction(()=>document.querySelector('#status').scrollTop>0);
  await p.keyboard.press('Home');await p.waitForFunction(()=>document.querySelector('#status').scrollTop===0);
  assert.equal(await p.locator('#status').textContent(),await p.evaluate(()=>window.__sim.scriptError),'full error retained');
  if(fn==='OnFrame')await p.screenshot({path:`.shots/editor-errors-${engine}.png`});
  await p.click('#build');assert.equal(await p.inputValue('#source'),bad);await p.fill('#source',base);await p.click('#run');await p.waitForFunction(()=>window.__sim && !window.__sim.model.script);
  assert.equal(await p.evaluate(()=>window.__sim.scriptError),null);assert.equal(await p.locator('#status').textContent(),'');assert.equal(await p.locator('#status').isVisible(),false);
  await p.focus('#view');await p.keyboard.down('ArrowUp');await p.waitForFunction(()=>window.__sim.env('P')===100);
  await p.click('#run');await p.waitForFunction(()=>window.__sim?.env('P')===0);await p.keyboard.up('ArrowUp');
 }
 await p.fill('#source','Val { A(default=1) }');await p.click('#run');await p.waitForFunction(()=>window.__sim===null&&document.querySelector('#status').textContent.includes('Body'));
 await p.click('#build');await p.fill('#source',base);await p.click('#run');await p.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);assert.equal(await p.locator('#status').textContent(),'');
 assert.deepEqual(errors,[]);console.log(`${engine}: long OnInit/OnFrame errors stay bounded, keyboard scroll, source repair, cleared input and missing-Body recovery pass`);
}finally{await b.close()}
