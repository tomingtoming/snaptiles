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
 // Continue the same vehicle through revision, real download, sharing and another editing session.
 await page.click('#build'); await page.selectOption('#parts','1');
 await page.fill('#part-power','1000'); await page.locator('#part-power').press('Tab');
 const revised=await page.inputValue('#source');
 const downloadEvent=page.waitForEvent('download'); await page.click('#save-model');
 const download=await downloadEvent, stream=await download.createReadStream(), chunks=[];
 for await(const chunk of stream) chunks.push(chunk);
 const bytes=Buffer.concat(chunks); assert.equal(bytes.toString(),revised);
 await page.click('#share-model'); await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));
 const link=await page.inputValue('#share-url'); await page.keyboard.press('Escape');
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const receiver=await context.newPage();receiver.on('pageerror',e=>errors.push(e.message));
 await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim?.model.vals.some(v=>v.name==='ST_POWER_1'&&v.max===1000));
 assert.equal(await receiver.inputValue('#source'),revised,'shared vehicle source matches the saved revision');
 const cdp=await context.newCDPSession(receiver);
 const up=await receiver.locator('#keys .cap').filter({hasText:'↑'}).boundingBox();
 const left=await receiver.locator('#keys .cap').filter({hasText:'←'}).boundingBox();
 const touch=(id,b)=>({id,x:b.x+b.width/2,y:b.y+b.height/2});
 await receiver.waitForTimeout(1500);const receiverBefore=await receiver.evaluate(()=>window.__sim.corePosition().toArray());
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,up)]});
 await receiver.waitForFunction(()=>window.__sim.env('ST_POWER_1')===1000);
 await receiver.waitForTimeout(1500);const receiverAfter=await receiver.evaluate(()=>window.__sim.corePosition().toArray());
 assert.ok(Math.hypot(receiverAfter[0]-receiverBefore[0],receiverAfter[2]-receiverBefore[2])>1,'shared vehicle drives through touch controls');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,up),touch(2,left)]});
 await receiver.waitForFunction(()=>window.__sim.env('ST_STEER_1')===-30&&window.__sim.env('ST_POWER_1')===1000);
 await receiver.waitForFunction(()=>[...document.querySelectorAll('#keys .cap')].filter(el=>['↑','←'].includes(el.textContent)).every(el=>el.dataset.down==='true'&&getComputedStyle(el).backgroundColor==='rgb(242, 183, 5)'));
 await receiver.screenshot({path:new URL('../.shots/editor-workflow-touch.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await receiver.waitForFunction(()=>window.__sim.env('ST_STEER_1')===0&&window.__sim.env('ST_POWER_1')===0);
 await receiver.click('#build');await receiver.click('#new-model');
 const picker=receiver.waitForEvent('filechooser');await receiver.click('#open-model');
 await (await picker).setFiles({name:'sprint-car.rcd',mimeType:'text/plain',buffer:bytes});
 await receiver.waitForFunction(()=>window.__sim?.model.vals.some(v=>v.name==='ST_POWER_1'&&v.max===1000)&&!document.body.classList.contains('building'));
 assert.equal(await receiver.inputValue('#source'),revised,'download reopens exactly');
 await receiver.click('#build');await receiver.selectOption('#parts','1');
 await receiver.fill('#part-power','1200');await receiver.locator('#part-power').press('Tab');
 const secondDownload=receiver.waitForEvent('download');await receiver.click('#save-model');
 assert.equal((await secondDownload).suggestedFilename(),'sprint-car.rcd');
 await receiver.click('#frame-model');
 await receiver.screenshot({path:new URL('../.shots/editor-workflow-reopened.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await receiver.click('#run');await receiver.waitForFunction(()=>window.__sim?.model.vals.some(v=>v.name==='ST_POWER_1'&&v.max===1200));
 await context.close();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'pass',before,after,distance:Math.hypot(after[0]-before[0],after[2]-before[2]),steer,axle,sharedTouchDistance:Math.hypot(receiverAfter[0]-receiverBefore[0],receiverAfter[2]-receiverBefore[2]),savedBytes:bytes.length,roundTrip:'save-share-touch-reopen-edit-run',errors}));
} finally {await browser.close();}
