import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
const engine=process.argv[3]??'chromium';
const browser=await ({chromium,firefox,webkit}[engine]).launch(engine==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 const source=`Val { A(default=10) P(default=20) O(default=0) C(default=16711680) }\n${'// preserved comment\n'.repeat(25)}Body {Core(){\n${' '.repeat(100)}E:Wheel(angle=A+1,power=P*2,option=O,color=C)\n}}`;
 await page.setInputFiles('#model-file',{name:'expressions.rcd',mimeType:'text/plain',buffer:Buffer.from(source)});await page.waitForFunction(()=>window.__sim?.assembly?.tiles.length===2);await page.click('#build');await page.selectOption('#parts','1');
 assert.equal(await page.locator('#source-edit-help button').count(),4);
 for(const [attr,expression] of Object.entries({angle:'A+1',power:'P*2',option:'O',color:'C'})) {
  await page.click(`[data-source-attribute="${attr}"]`);
  const state=await page.locator('#source').evaluate(e=>({selected:e.value.slice(e.selectionStart,e.selectionEnd),active:document.activeElement===e,top:e.scrollTop,left:e.scrollLeft}));
  assert.equal(state.selected,expression);assert.equal(state.active,true);assert.ok(state.top>0&&state.left>0,'offscreen expression is revealed');
  assert.equal(await page.inputValue('#source'),source,'navigation must not rewrite source');
 }
 await page.click('[data-source-attribute="angle"]');await page.keyboard.type('42');
 const edited=source.replace('angle=A+1','angle=42');assert.equal(await page.inputValue('#source'),edited);assert.equal(await page.locator('[data-source-attribute="angle"]').count(),0);
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),source);assert.equal(await page.locator('[data-source-attribute="angle"]').count(),1);
 await page.click('[data-source-attribute="power"]');
 await page.screenshot({path:`.shots/editor-source-help-${engine}.png`});
 await page.selectOption('#parts','0');assert.equal(await page.locator('#source-edit-help').isVisible(),false);
 await page.selectOption('#parts','1');await page.fill('#source','Body {');assert.equal(await page.locator('#source-edit-help').isVisible(),false);
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),source);
 const event=page.waitForEvent('download');await page.click('#save-model');const stream=await (await event).createReadStream();let bytes='';for await(const chunk of stream)bytes+=chunk;assert.equal(bytes,source);
 assert.deepEqual(errors,[]);console.log(`${engine}: source-only field navigation, exact selection, edit/Undo, stale-hint clearing and exact export pass`);
} finally {await browser.close()}
