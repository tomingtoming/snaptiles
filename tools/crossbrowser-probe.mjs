import {chromium, firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
// A run recorded in Chromium replays bit for bit in Firefox and WebKit: the record links' "確認済み" re-runs a run in
// whatever browser opens it. Two runs: the hover sample (jets, a Lua attitude controller) and a car whose Lua draws
// on math.random, _RND, pairs over string keys and trigonometry.
const NOISY=`Val { ENGINE(default=0,min=-3000,max=3000,step=500) STEER(default=0,min=-30,max=30) }
Key { 0:ENGINE(step=500) }
Body { Core(){ N:Chip(){ W:Wheel(angle=90,power=-ENGINE){} E:Wheel(angle=90,power=ENGINE){} } S:Chip(){ W:Wheel(angle=90,power=-ENGINE){} E:Wheel(angle=90,power=ENGINE){} } } }
Lua {
t = { alpha = 1, beta = 2, gamma = 3, delta = 4 }
function OnFrame()
  local s = 0
  for k, v in pairs(t) do s = s * 3 + v + #k end
  STEER = math.sin(_TICKS() * 0.1 + s) * 10 + math.random() * 5 + _RND()
  out(0, s, math.random(100), math.cos(_TICKS()) * math.exp(-_TICKS() / 300))
end
}
`;
const base=process.argv[2]??'http://127.0.0.1:5175/';
const FRAMES=180;
// the state of every frame from the moment the hook is in: core pose, velocity and out() rows, full precision
const hook=()=>{const s=/** @type {any} */(window.__sim),step=s.step.bind(s);window.__trace={};s.step=()=>{step();window.__trace[s.frame]=JSON.stringify([s.corePosition().toArray(),s.coreVelocity().toArray(),s.physics.tiles.map(t=>t.quaternion.toArray()),s.out]);};};
async function record(page, setup){
 await setup(page);
 await page.evaluate(hook);
 await page.focus('#view');
 await page.keyboard.down('ArrowUp'); await page.waitForFunction(()=>window.__sim.frame>=70); await page.keyboard.up('ArrowUp');
 await page.keyboard.down('ArrowLeft'); await page.waitForFunction(()=>window.__sim.frame>=110); await page.keyboard.up('ArrowLeft');
 await page.waitForFunction(f=>window.__sim.frame>=f,FRAMES);
 const trace=await page.evaluate(()=>window.__trace);
 await page.click('#build'); await page.click('#share-model');
 await page.check('#share-run');
 await page.waitForFunction(()=>document.getElementById('share-url').value.includes('&r='));
 return {trace, url: await page.inputValue('#share-url')};
}
async function replay(type, url){
 const browser=await type.launch();
 try{
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url); await page.waitForFunction(()=>window.__sim?.replaying,null,{timeout:60000});
  await page.evaluate(hook);
  await page.waitForFunction(f=>window.__sim.frame>=f,FRAMES,{timeout:120000});
  return {trace: await page.evaluate(()=>window.__trace), errors};
 }finally{await browser.close();}
}
const chrome=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
/** @type {[string, {trace: Record<string, string>, url: string}][]} */
const runs=[];
try{
 const page=await chrome.newPage();
 runs.push(['hover', await record(page, async p=>{await p.goto(base+'#hover'); await p.waitForFunction(()=>window.__sim);})]);
 const page2=await chrome.newPage();
 runs.push(['noisy car', await record(page2, async p=>{await p.goto(base); await p.waitForFunction(()=>window.__sim); await p.fill('#source',NOISY); await p.focus('#source'); await p.keyboard.press('Control+Enter'); await p.waitForFunction(()=>window.__sim?.model.script);})]);
}finally{await chrome.close();}
const report=[];
for(const [name,{trace,url}] of runs){
 for(const [label,type] of [['Firefox',firefox],['WebKit',webkit]]){
  const got=await replay(type,url);
  assert.deepEqual(got.errors,[],`${name} in ${label}: page errors`);
  let same=0;
  for(const f of Object.keys(got.trace)) if(trace[f]!==undefined&&Number(f)<=FRAMES){ assert.equal(got.trace[f],trace[f],`${name} in ${label}, frame ${f}`); same++; }
  assert.ok(same>=FRAMES-60,`${name} in ${label}: only ${same} frames compared`);
  report.push(`${name}/${label} ${same}`);
 }
}
console.log(`Cross-browser replay: Chromium runs identical frame by frame in Firefox and WebKit (${report.join(', ')} frames) pass`);
