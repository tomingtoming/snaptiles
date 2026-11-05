import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// The Lua tools: line numbers toggle breakpoints, completion, the live syntax check, replacing the Lua block while
// running, the console, a rewind over both (they are recorded), and a breakpoint with a pass count.
const MODEL=`Val { ENGINE(default=0,min=-2000,max=2000,step=200) }
Key { 0:ENGINE(step=200) }
Body { Core(){ N:Chip(){ N:Wheel(angle=90,power=ENGINE){ } } S:Chip(){ S:Wheel(angle=90,power=ENGINE){ } } } }
Lua {
count = 0
function OnFrame()
  count = count + 1
  out(0, "v1", count)
end
}
`;
const step=(/** @type {string} */ s)=>{ if(process.env.STEPS) console.error('·',s); };
const lineOf=(text,needle)=>text.split('\n').findIndex(l=>l.includes(needle))+1;
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.fill('#source',MODEL); await page.focus('#source'); await page.keyboard.press('Control+Enter');
 await page.waitForFunction(()=>window.__sim?.model.script);
 // line numbers: one per line; clicking one toggles a breakpoint
 assert.equal(await page.locator('#source-gutter [data-line]').count(),MODEL.split('\n').length);
 const outLine=lineOf(MODEL,'out(0, "v1"');
 // paused while toggling, so the breakpoint is not hit in between
 await page.focus('#view'); await page.keyboard.press('Space');
 await page.click('#debug-toggle');
 await page.click(`#source-gutter [data-line="${outLine}"]`);
 assert.match(await page.textContent('#debug-bp-list'),new RegExp(`${outLine}行`));
 await page.waitForFunction(l=>document.querySelector(`#source-gutter [data-line="${l}"]`).classList.contains('bp'),outLine);
 await page.click(`#source-gutter [data-line="${outLine}"]`);
 await page.waitForFunction(()=>document.getElementById('debug-bp-list').textContent==='');
 await page.click('#debug-play');
 await page.waitForFunction(()=>document.getElementById('debug-play').textContent==='⏸');
 step('colours');
 // colours: the API and keywords
 assert.ok(await page.locator('#source-highlight .hl-keyword').count()>0);
 step('completion');
 // completion: type at the end of the count line
 const caretAfter=async(needle)=>page.evaluate(n=>{const s=document.getElementById('source');const i=s.value.indexOf(n)+n.length;s.focus();s.setSelectionRange(i,i);},needle);
 await caretAfter('count = count + 1');
 await page.keyboard.press('Enter'); await page.keyboard.type('  _V');
 await page.waitForFunction(()=>!document.getElementById('completion').hidden);
 assert.equal(await page.textContent('#completion .completion-row[aria-selected="true"] .completion-label'),'_VEL');
 assert.match(await page.textContent('#completion .completion-detail'),/速/);
 await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
 assert.match(await page.inputValue('#source'),/\n  _VX\(\)\n/);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'source');
 step('esc');
 // Esc closes the popup but stays in the source
 // the caret sits inside the accepted call's brackets; go to the line's end first
 await page.keyboard.press('End'); await page.keyboard.type(' ma'); await page.waitForFunction(()=>!document.getElementById('completion').hidden);
 await page.keyboard.press('Escape');
 assert.equal(await page.isVisible('#completion'),false); assert.equal(await page.evaluate(()=>document.activeElement.id),'source');
 step('syntax');
 // the live syntax check marks the line ("_VX() ma" is not a statement)
 // (Lua reports it where the statement fails: the line after "ma", where out( starts)
 const badLine=lineOf(await page.inputValue('#source'),'_VX() ma');
 await page.waitForFunction(l=>[l,l+1].some(n=>document.querySelector(`#source-gutter [data-line="${n}"]`)?.classList.contains('err')),badLine);
 assert.match(await page.textContent('#source-hint'),/文法：line/);
 step('live edit');
 // back to a clean Lua block with a new out() row: the live edit keeps the run (and the count) going
 const edited=MODEL.replace('out(0, "v1", count)','out(0, "v2", count)');
 await page.fill('#source',edited);
 await page.waitForFunction(()=>!document.getElementById('source-hint').classList.contains('error'));
 await page.waitForFunction(()=>!document.getElementById('lua-apply').hidden);
 const before=await page.evaluate(()=>({sim:window.__sim, frame:window.__sim.frame}));
 await page.click('#lua-apply');
 await page.waitForFunction(()=>/^v2 \d+/.test(window.__sim.out[0]));
 const after=await page.evaluate(()=>({frame:window.__sim.frame, count:Number(window.__sim.out[0].split(' ')[1])}));
 assert.ok(after.count>=before.frame,`count went on: ${JSON.stringify([before.frame,after])}`);
 assert.equal(await page.isVisible('#lua-apply'),false);
 step('console');
 // the console
 await page.fill('#debug-console','count * 0 + 7'); await page.press('#debug-console','Enter');
 assert.equal(await page.textContent('#debug-console-log .console-out:last-child'),'7');
 await page.fill('#debug-console','count = 1000'); await page.press('#debug-console','Enter');
 await page.waitForFunction(()=>Number(window.__sim.out[0].split(' ')[1])>=1000);
 await page.fill('#debug-console','nosuch.x'); await page.press('#debug-console','Enter');
 assert.match(await page.textContent('#debug-console-log .console-err:last-child'),/エラー/);
 step('rewind');
 // a rewind past both repeats them: the frame after the console set 1000 shows it again
 const consoleFrame=await page.evaluate(()=>window.__sim.recording.commands.find(c=>c.kind==='eval'&&c.text==='count = 1000').frame);
 await page.waitForFunction(f=>window.__sim.frame>=f+10,consoleFrame); // the run has gone past the frame to rewind to
 await page.$eval('#debug-timeline',(el,f)=>{el.value=String(f+2);el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));},consoleFrame);
 await page.waitForFunction(f=>window.__sim.frame===f+2,consoleFrame);
 assert.match(await page.evaluate(()=>window.__sim.out[0]),/^v2 100[12]$/);
 step('breakpoint');
 // a breakpoint from its 3rd pass, with a condition over a global
 await page.fill('#debug-bp-line',String(outLine)); await page.fill('#debug-bp-after','3'); await page.fill('#debug-bp-cond','count > 0');
 await page.click('#debug-bp-add');
 assert.match(await page.textContent('#debug-bp-list'),/count > 0・3回目〜/);
 await page.click('#debug-play');
 await page.waitForFunction(()=>!document.getElementById('debug-break').hidden);
 assert.match(await page.textContent('#debug-break'),new RegExp(`${outLine}行目で停止`));
 assert.deepEqual(errors,[]);
 console.log('Lua tools: gutter breakpoints, colours, completion (API detail, Esc), live syntax mark, live Lua edit keeps the count, console, rewind repeats the console, breakpoint with condition and pass count pass');
}finally{await browser.close();}
