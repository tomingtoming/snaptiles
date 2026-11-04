import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// A driven run travels in the share link and replays exactly in another page; a key takes the replay over.
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.argv[2]??'http://127.0.0.1:5175/';
// log the core position by frame from the moment the hook is installed
const hook=()=>{const s=window.__sim,step=s.step.bind(s);window.__trace={};s.step=()=>{step();window.__trace[s.frame]=s.corePosition().toArray();};};
try {
 const page=await browser.newPage();
 await page.goto(base+'#car'); await page.waitForFunction(()=>window.__sim);
 await page.evaluate(hook);
 await page.focus('#view');
 await page.keyboard.down('ArrowUp'); await page.waitForFunction(()=>window.__sim.frame>=60); await page.keyboard.up('ArrowUp');
 await page.keyboard.down('ArrowLeft'); await page.waitForFunction(()=>window.__sim.frame>=90); await page.keyboard.up('ArrowLeft');
 await page.waitForFunction(()=>window.__sim.frame>=120);
 await page.click('#build');
 const frames=await page.evaluate(()=>window.__sim.recording.frames);
 await page.click('#share-model');
 // the model alone by default; ticking the run adds it to the link
 await page.waitForFunction(()=>document.getElementById('share-url').value.includes('#m='));
 assert.equal(await page.isVisible('#share-run'),true);
 assert.equal(await page.isChecked('#share-run'),false);
 assert.equal((await page.inputValue('#share-url')).includes('&r='),false);
 await page.check('#share-run');
 await page.waitForFunction(()=>document.getElementById('share-url').value.includes('&r='));
 const url=await page.inputValue('#share-url');
 const trace=await page.evaluate(()=>window.__trace);
 const page2=await browser.newPage();
 await page2.goto(url); await page2.waitForFunction(()=>window.__sim);
 assert.equal(await page2.evaluate(()=>window.__sim.replaying),true);
 await page2.evaluate(hook);
 await page2.waitForFunction(f=>window.__sim.frame>=f,frames);
 const trace2=await page2.evaluate(()=>window.__trace);
 let compared=0;
 for(const f of Object.keys(trace2)){ if(trace[f]&&Number(f)<=frames){assert.deepEqual(trace2[f],trace[f],`frame ${f}`);compared++;} }
 assert.ok(compared>60,`compared ${compared} frames`);
 // after the end of the run the page is live again; during a replay a held key takes it over
 assert.equal(await page2.evaluate(()=>window.__sim.replaying),false);
 const page3=await browser.newPage();
 await page3.goto(url); await page3.waitForFunction(()=>window.__sim?.replaying);
 await page3.focus('#view'); await page3.keyboard.down('ArrowDown');
 await page3.waitForFunction(()=>!window.__sim.replaying); await page3.keyboard.up('ArrowDown');
 console.log(`Replay: ${frames}-frame run in the link (${url.length} chars), ${compared} frames identical in a new page, off by default, a key takes over pass`);
}finally{await browser.close();}
