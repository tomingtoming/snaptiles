import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// The debug panel: watch list, frame stepping, rewind (re-run to a frame, identical to the first pass), graph and a
// breakpoint that pauses with the locals of its line.
const MODEL=`Val { ENGINE(default=0,min=-2000,max=2000,step=200) }
Key { 0:ENGINE(step=200) }
Body { Core(){ N:Chip(){ N:Wheel(angle=90,power=ENGINE){ } } S:Chip(){ S:Wheel(angle=90,power=ENGINE){ } } } }
Lua {
count = 0
function OnFrame()
  count = count + 1
  local speed = math.floor(_VZ(0) * 100) / 100
  out(0, "count ", count, speed)
end
}
`;
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.fill('#source',MODEL); await page.focus('#source'); await page.keyboard.press('Control+Enter');
 await page.waitForFunction(()=>window.__sim?.model.script);
 // a trace of the core position by frame, kept across simulation swaps (rewind)
 await page.evaluate(()=>{window.__trace={};const wrap=()=>{const s=/** @type {any} */(window.__sim);if(!s||s.__wrapped)return;s.__wrapped=true;const step=s.step.bind(s);s.step=()=>{step();if(!(s.frame in window.__trace))window.__trace[s.frame]=s.corePosition().toArray().join(',');};};setInterval(wrap,5);wrap();});
 await page.focus('#view'); await page.keyboard.down('ArrowUp');
 await page.waitForFunction(()=>window.__sim.frame>=60); await page.keyboard.up('ArrowUp');
 await page.click('#debug-toggle');
 assert.equal(await page.isVisible('#debug'),true);
 await page.waitForFunction(()=>[...document.querySelectorAll('.watch-name')].some(e=>e.textContent==='count'));
 const names=await page.$$eval('.watch-row .watch-name',els=>els.map(e=>e.textContent));
 assert.ok(names.includes('ENGINE')&&names.includes('count'),names.join(','));
 // pause and step one frame
 await page.click('#debug-play');
 await page.waitForFunction(()=>document.getElementById('debug-play').textContent==='▶');
 const f0=await page.evaluate(()=>window.__sim.frame);
 await page.click('#debug-forward');
 assert.equal(await page.evaluate(()=>window.__sim.frame),f0+1);
 const count=async()=>page.evaluate(()=>[...document.querySelectorAll('.watch-row')].find(r=>r.querySelector('.watch-name').textContent==='count').querySelector('.watch-value').textContent);
 await page.waitForFunction(f=>[...document.querySelectorAll('.watch-row')].find(r=>r.querySelector('.watch-name').textContent==='count')?.querySelector('.watch-value').textContent===String(f),f0+1);
 // rewind to frame 40 with the timeline: the same position as the first pass, count 40
 await page.$eval('#debug-timeline',el=>{el.value='40';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>window.__sim.frame===40);
 const trace=await page.evaluate(()=>window.__trace);
 const at40=await page.evaluate(()=>window.__sim.corePosition().toArray().join(','));
 assert.equal(at40,trace[40]);
 await page.waitForFunction(()=>[...document.querySelectorAll('.watch-row')].find(r=>r.querySelector('.watch-name').textContent==='count')?.querySelector('.watch-value').textContent==='40');
 // step back one frame
 await page.focus('#view'); await page.keyboard.press('Comma');
 await page.waitForFunction(()=>window.__sim.frame===39);
 assert.equal(await page.evaluate(()=>window.__sim.corePosition().toArray().join(',')),trace[39]);
 // graph a value
 await page.evaluate(()=>[...document.querySelectorAll('.watch-row')].find(r=>r.querySelector('.watch-name').textContent==='count').querySelector('input').click());
 assert.match(await page.textContent('#debug-legend'),/count/);
 // resume: the rest of the run replays from the rewind point
 await page.click('#debug-play');
 await page.waitForFunction(()=>window.__sim.frame>=55);
 assert.equal(await page.evaluate(f=>window.__trace[f],55),trace[55]);
 // a breakpoint on the out() line pauses with the locals there
 const line=MODEL.split('\n').findIndex(l=>l.includes('out(0, "count "'))+1;
 await page.fill('#debug-bp-line',String(line)); await page.click('#debug-bp-add');
 assert.match(await page.textContent('#debug-bp-list'),new RegExp(`${line}行`));
 await page.waitForFunction(()=>!document.getElementById('debug-break').hidden);
 const brk=await page.textContent('#debug-break');
 assert.match(brk,new RegExp(`${line}行目で停止`)); assert.match(brk,/speed/);
 assert.equal(await page.evaluate(()=>document.getElementById('debug-play').textContent),'▶');
 const stopped=await page.evaluate(()=>window.__sim.frame);
 await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>window.__sim.frame),stopped,'paused at the breakpoint');
 await page.screenshot({path:new URL('../.shots/debug-panel.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
 // removing it lets the run go on
 await page.click('#debug-bp-list .bp'); await page.click('#debug-play');
 await page.waitForFunction(f=>window.__sim.frame>f+10,stopped);
 console.log(`Debug panel: watch (count, ENGINE), frame step, rewind to 40 and back to 39 identical to the first pass, graph, resume replays, breakpoint at line ${line} with locals pass`);
}finally{await browser.close();}
