import {firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
export async function runPortabilityProbe(engine) {
const browser=await {firefox,webkit}[engine].launch();
try {
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 const audioAvailable=await page.evaluate(()=>window.__sfx.available);
 assert.equal(await page.locator('#mute').isDisabled(),!audioAvailable);
 if(!audioAvailable)assert.equal(await page.locator('#mute').getAttribute('aria-label'),'この環境では音声を利用できません');
 await page.click('#build');await page.click('#new-model');
 const add=async(parent,dir,type)=>{await page.selectOption('#parts',String(parent));await page.selectOption('#add-type',type);await page.click(`[data-edge="${dir}"]`);return Number(await page.inputValue('#parts'));};
 const wheel=async(parent,dir,first=false)=>{
  await add(parent,dir,'Wheel');await page.fill('#part-angle','90');await page.locator('#part-angle').press('Tab');
  if(first){await page.fill('#part-power','800');await page.locator('#part-power').press('Tab');}
  await page.selectOption('#power-control',first?'new':dir==='W'?'-ST_POWER_1':'ST_POWER_1');
 };
 await wheel(0,'E',true);await page.click('#mirror-branch');const steering=await add(0,'N','Rudder');await page.selectOption('#angle-control','new');
 const axle=await add(steering,'N','Chip');await wheel(axle,'E');await page.click('#mirror-branch');
 const built=await page.inputValue('#source');assert.equal(await page.locator('#parts option').count(),7);
 await page.locator('#source').focus();await page.keyboard.press('Control+End');await page.keyboard.type(`// ${engine}`);
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),built,'source Undo');
 await page.click('#run');await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);await page.waitForTimeout(1500);
 const before=await page.evaluate(()=>window.__sim.corePosition().toArray());await page.locator('#view').focus();await page.keyboard.down('ArrowUp');
 await page.waitForFunction(()=>window.__sim.env('ST_POWER_1')===800);await page.waitForTimeout(1500);
 const after=await page.evaluate(()=>window.__sim.corePosition().toArray());await page.keyboard.up('ArrowUp');await page.waitForFunction(()=>window.__sim.env('ST_POWER_1')===0);
 const distance=Math.hypot(after[0]-before[0],after[2]-before[2]);assert.ok(distance>1,`drive distance ${distance}`);
 await page.click('#build');await page.click('#rename-model');await page.fill('#filename-input',`${engine}試作`);
 const downloadEvent=page.waitForEvent('download');await page.keyboard.press('Control+s');const download=await downloadEvent;
 assert.equal(download.suggestedFilename(),`${engine}試作.rcd`);const stream=await download.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const bytes=Buffer.concat(chunks);assert.equal(bytes.toString(),built);
 await page.click('#share-model');await page.waitForFunction(()=>document.querySelector('#share-url').value.includes('#m='));const link=await page.inputValue('#share-url');await page.keyboard.press('Escape');
 const receiver=await browser.newPage({viewport:{width:390,height:844}});receiver.on('pageerror',e=>errors.push(e.message));await receiver.goto(link);await receiver.waitForFunction(()=>window.__sim?.assembly?.tiles.length===7);
 assert.equal(await receiver.inputValue('#source'),built);await receiver.click('#build');await receiver.selectOption('#parts','1');
 await receiver.fill('#part-power','1100');await receiver.locator('#part-power').press('Tab');await receiver.click('#frame-model');
 for(const width of [320,390]) {
  await receiver.setViewportSize({width,height:844});
  const bounds=await receiver.locator('#editor-toolbar button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,left:r.left,right:r.right};}));
  assert.ok(bounds.every(r=>r.left>=0&&r.right<=width),`${engine} toolbar ${width}: ${JSON.stringify(bounds)}`);
 }
 assert.equal(await receiver.locator('html').evaluate(e=>getComputedStyle(e).colorScheme),'dark');
 // ResizeObserver updates the drawing buffer; wait for subsequent rendered frames.
 await receiver.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await receiver.screenshot({path:fileURLToPath(new URL(`../.shots/editor-${engine}-narrow.png`,import.meta.url))});
 await receiver.click('#edit-undo');assert.equal(await receiver.inputValue('#part-power'),'800');await receiver.click('#edit-redo');assert.equal(await receiver.inputValue('#part-power'),'1100');
 const picker=receiver.waitForEvent('filechooser');await receiver.click('#open-model');await (await picker).setFiles({name:`${engine}試作.rcd`,mimeType:'text/plain',buffer:bytes});
 await receiver.waitForFunction(()=>!document.body.classList.contains('building')&&window.__sim?.env('ST_POWER_1')===0);assert.equal(await receiver.inputValue('#source'),built);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,version:browser.version(),audioAvailable,distance,parts:7,sourceBytes:bytes.length,checks:['build','source Undo','drive/release','named keyboard save','share','narrow editing','Undo/Redo','file reopen'],errors}));
}finally{await browser.close();}

}
