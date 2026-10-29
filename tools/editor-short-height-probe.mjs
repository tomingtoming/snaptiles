import {chromium, firefox, webkit} from 'playwright';
import assert from 'node:assert/strict';
const engine=process.argv[3]??'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');
 for(const viewport of [{width:1280,height:720},{width:1280,height:600},{width:390,height:844},{width:320,height:568}]) {
  await page.setViewportSize(viewport);await page.click('#new-model');
  await page.click('[data-edge="N"]');
  const original=await page.inputValue('#source');
  const bounds=await page.locator('#source').evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {top:r.top,bottom:r.bottom,content:r.height-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),line:parseFloat(s.lineHeight),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}});
  assert.ok(bounds.content>=2*bounds.line-1,JSON.stringify({viewport,bounds}));
  assert.ok(bounds.top>=0&&bounds.bottom<=viewport.height+1&&bounds.hit,'source visible and unobstructed');
  await page.locator('#source').click();await page.keyboard.press('Control+End');await page.keyboard.type('// visible source');
  assert.equal(await page.inputValue('#source'),original+'// visible source');
  await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),original);
  await page.fill('#source','Body { Core(){');await page.waitForFunction(()=>document.querySelector('#status').textContent.length>0);
  const errorBounds=await page.locator('#source').boundingBox();assert.ok(errorBounds.height>=58&&errorBounds.y+errorBounds.height<=viewport.height+1,'source remains readable with parse error');
  await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),original);
  await page.locator('[data-edge="S"]').click();assert.equal(await page.locator('#parts option').count(),3,'scrolled builder add remains usable');
  if(viewport.width===320)await page.screenshot({path:`.shots/editor-short-${engine}.png`});
 }
 assert.deepEqual(errors,[]);console.log(`${engine}: short-height source visibility, typing/history, error recovery and scrolled part addition pass`);
} finally {await browser.close()}
