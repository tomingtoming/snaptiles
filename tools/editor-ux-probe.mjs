import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Keyboard and visibility in the editor: Esc leaves the source, the 3D view takes arrows / + − / Delete / N W E S in
// build mode, an opened section scrolls into the panel, and the small controls meet size and contrast floors.
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1280,height:640}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 const active=()=>page.evaluate(()=>document.activeElement.id);
 await page.focus('#source'); await page.keyboard.press('Escape'); assert.equal(await active(),'view');
 assert.match(await page.textContent('#source-hint'),/Esc/);
 await page.click('#build'); await page.click('#new-model');
 await page.focus('#view');
 const cam=()=>page.evaluate(()=>({yaw:window.__scene.camYaw,pitch:window.__scene.camPitch,dist:window.__scene.camDist}));
 const c0=await cam();
 await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
 const c1=await cam(); assert.ok(c1.yaw>c0.yaw&&c1.pitch>c0.pitch,`orbit ${JSON.stringify([c0,c1])}`);
 await page.keyboard.press('-'); const c2=await cam(); assert.ok(c2.dist>c1.dist,'minus zooms out');
 await page.keyboard.press('+'); await page.keyboard.press('+'); assert.ok((await cam()).dist<c2.dist,'plus zooms in');
 const parts=()=>page.locator('#parts option').count();
 assert.equal(await parts(),1);
 await page.keyboard.press('n'); assert.equal(await parts(),2); assert.equal(await active(),'view');
 await page.keyboard.press('e'); assert.equal(await parts(),3);
 await page.keyboard.press('Delete'); assert.equal(await parts(),2);
 // an opened section is brought into the scrolling builder panel
 await page.evaluate(()=>{document.getElementById('builder').scrollTop=0;});
 await page.click('#script-tools summary');
 // the toggle event is async: wait for the scroll (fully inside, or its top at the panel's top when taller)
 await page.waitForFunction(()=>{
   const panel=document.getElementById('builder').getBoundingClientRect(),d=document.getElementById('script-tools').getBoundingClientRect();
   return d.top>=panel.top-1&&(d.bottom<=panel.bottom+1||d.top<=panel.top+1);
 },null,{timeout:5000});
 // size and contrast floors
 const m=await page.evaluate(()=>{
   const lum=c=>{const v=c.match(/\d+(\.\d+)?/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4;});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];};
   const badge=document.querySelector('.edge-count'),button=badge.closest('button');
   const fg=lum(getComputedStyle(badge).color),bg=lum(getComputedStyle(button).backgroundColor);
   const view=document.getElementById('viewmode').getBoundingClientRect();
   const summaries=[...document.querySelectorAll('#builder summary')].map(s=>s.getBoundingClientRect().height);
   return {size:parseFloat(getComputedStyle(badge).fontSize),ratio:(Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05),view:[view.width,view.height],summaries};
 });
 assert.ok(m.size>=11,`badge ${m.size}px`); assert.ok(m.ratio>=4.5,`badge contrast ${m.ratio.toFixed(2)}`);
 assert.ok(m.view[0]>=24&&m.view[1]>=24,`view button ${m.view}`);
 assert.ok(m.summaries.every(h=>h>=24),`summaries ${m.summaries}`);
 console.log(`Editor UX: Esc leaves source, arrows orbit, +/- zoom, N/E add, Delete removes, opened section in view, badge ${m.size}px ${m.ratio.toFixed(1)}:1, view ${m.view.join('×')} pass`);
}finally{await browser.close();}
