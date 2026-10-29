import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page = await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2] ?? 'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); const original=await page.inputValue('#source');
 await page.click('#new-model'); assert.equal(await page.locator('#parts option').count(),1);
 await page.click('#edit-undo'); assert.equal(await page.inputValue('#source'),original);
 await page.click('#edit-redo'); assert.equal(await page.locator('#parts option').count(),1);
 async function add(parent,dir,type) {
   await page.selectOption('#parts',String(parent)); await page.selectOption('#add-type',type); await page.click(`[data-edge="${dir}"]`);
   return Number(await page.inputValue('#parts'));
 }
 async function wheel(parent,dir,first=false) {
   const id=await add(parent,dir,'Wheel'); await page.fill('#part-angle','90'); await page.locator('#part-angle').press('Tab');
   if(first) { await page.fill('#part-power','800'); await page.locator('#part-power').press('Tab'); }
   await page.selectOption('#power-control',first?'new':dir==='W'?'-ST_POWER_1':'ST_POWER_1'); return id;
 }
 await wheel(0,'E',true); await wheel(0,'W');
 const steer=await add(0,'N','Rudder'); await page.selectOption('#angle-control','new');
 await page.fill('#part-angle','45'); await page.locator('#part-angle').press('Tab');
 assert.equal(await page.inputValue('#part-angle'),'45'); await page.click('#edit-undo'); assert.equal(await page.inputValue('#part-angle'),'30');
 const axle=await add(steer,'N','Chip'); await wheel(axle,'E'); await wheel(axle,'W');
 await page.selectOption('#parts',String(steer));
 for (const selector of ['#angle-control', '#add-type', '[data-edge="S"]']) {
   assert.equal(await page.locator(selector).evaluate(el => { const b=el.getBoundingClientRect(), p=document.querySelector('#builder').getBoundingClientRect(); return b.top>=p.top && b.bottom<=p.bottom; }),true,`${selector} fits desktop steering panel`);
 }
 await page.screenshot({path:new URL('../.shots/editor-built-car.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await page.setViewportSize({width:390,height:844}); await page.screenshot({path:new URL('../.shots/editor-steering-mobile.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await page.click('#run'); await page.waitForFunction(()=>window.__sim?.model.vals.some(v=>v.name==='ST_STEER_1'));
 await page.waitForTimeout(2000); await page.focus('#view');
 const before=await page.evaluate(()=>window.__sim.corePosition().toArray());
 await page.keyboard.down('ArrowUp'); await page.waitForFunction(()=>window.__sim.env('ST_POWER_1')===800);
 await page.waitForTimeout(2000);
 const after=await page.evaluate(()=>window.__sim.corePosition().toArray());
 await page.keyboard.down('ArrowLeft'); await page.waitForFunction(()=>window.__sim.env('ST_STEER_1')===-30);
 await page.keyboard.up('ArrowLeft'); await page.waitForFunction(()=>window.__sim.env('ST_STEER_1')===0);
 await page.keyboard.down('ArrowRight'); await page.waitForFunction(()=>window.__sim.env('ST_STEER_1')===30);
 await page.keyboard.up('ArrowRight'); await page.keyboard.up('ArrowUp');
 assert.ok(Math.hypot(after[0]-before[0],after[2]-before[2])>1,'vehicle should move on the ground');
 assert.ok(after[1]>0 && after[1]<2,'vehicle should stay near the ground');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'pass',before,after,distance:Math.hypot(after[0]-before[0],after[2]-before[2]),steer,axle,errors}));
} finally {await browser.close();}
