import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 await page.click('#build');await page.click('#new-model');await page.click('[data-edge="N"]');const source=await page.inputValue('#source');
 const expectName=async name=>{const pending=page.waitForEvent('download');await page.click('#save-model');assert.equal((await pending).suggestedFilename(),name);};
 await page.click('#rename-model');assert.equal(await page.inputValue('#filename-input'),'model.rcd');
 await page.fill('#filename-input','試作車 02');await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-filename-mobile.png',import.meta.url))});
 await page.getByRole('button',{name:'名前を設定',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.id),'rename-model');
 await expectName('試作車 02.rcd');assert.equal(await page.inputValue('#source'),source);
 await page.click('#edit-undo');await expectName('model.rcd');await page.click('#edit-redo');await expectName('試作車 02.rcd');
 await page.click('#rename-model');await page.fill('#filename-input','discard');await page.keyboard.press('Escape');await expectName('試作車 02.rcd');
 await page.click('#rename-model');await page.fill('#filename-input','keyboard variant');
 const keyboardSave=page.waitForEvent('download');await page.keyboard.press('Control+s');assert.equal((await keyboardSave).suggestedFilename(),'keyboard variant.rcd');
 assert.equal(await page.locator('#filename-dialog').isVisible(),false);await page.click('#edit-undo');await expectName('試作車 02.rcd');
 await page.click('#rename-model');await page.fill('#filename-input','試作:03?.rcd');
 assert.equal(await page.locator('#filename-preview').textContent(),'保存される名前: 試作_03_.rcd');
 await page.keyboard.press('Enter');await expectName('試作_03_.rcd');
 await page.reload();await page.waitForFunction(()=>window.__sim);await page.click('#build');await page.click('#restore-draft');await expectName('試作_03_.rcd');
 assert.equal(await page.inputValue('#source'),source);
 await page.setViewportSize({width:320,height:568});await page.click('#rename-model');
 assert.ok(await page.getByRole('button',{name:'名前を設定',exact:true}).evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight;}));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-filename-small.png',import.meta.url))});
 await page.click('#filename-cancel');await expectName('試作_03_.rcd');
 console.log('Filename: exact downloaded name, source preservation, Undo/Redo, cancel, sanitization preview, draft recovery and 320px dialog pass');
}finally{await browser.close();}
