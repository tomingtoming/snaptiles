import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 const source='Body { Core(){ N:Frame(){E:Wheel()} S:Chip(angle=17) } }';
 await page.fill('#source',source);await page.click('#build');await page.selectOption('#parts','2');
 await page.click('#part-delete');
 assert.equal(await page.inputValue('#parts'),'1','delete selects surviving parent');
 await page.click('#edit-undo');assert.equal(await page.inputValue('#part-type'),'Wheel','undo restores deleted selection');
 await page.click('#edit-redo');assert.equal(await page.inputValue('#part-type'),'Frame');
 await page.click('#edit-undo');await page.selectOption('#parts','3');
 await page.locator('#source').evaluate(el=>{el.focus();const pos=el.value.indexOf('N:Frame');el.setSelectionRange(pos,pos);});
 await page.keyboard.insertText('W:Weight() ');
 assert.equal(await page.inputValue('#part-type'),'Chip','source insertion retains original selected part');
 assert.equal(await page.inputValue('#part-angle'),'17');
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#parts'),'3');
 await page.keyboard.press('Control+Shift+z');assert.equal(await page.inputValue('#parts'),'4');
 // Identical inserted text must not be confused with the existing selected declaration.
 await page.locator('#source').evaluate(el=>{el.focus();const pos=el.value.indexOf('S:Chip');el.setSelectionRange(pos,pos);});
 await page.keyboard.insertText('S:Chip(angle=17) ');
 assert.equal(await page.inputValue('#parts'),'5','identical insertion keeps original, now later part');
 await page.keyboard.press('Control+z');
 await page.selectOption('#parts','3');assert.equal(await page.inputValue('#part-type'),'Wheel');
 await page.selectOption('#power-control','new');assert.equal(await page.inputValue('#part-type'),'Wheel','generated controls preserve selected part');
 await page.locator('#source').evaluate(el=>{el.focus();const start=el.value.indexOf('E:Wheel');el.setSelectionRange(start,el.value.indexOf(')',start)+1);});
 await page.keyboard.press('Backspace');assert.equal(await page.inputValue('#part-type'),'Core','deleted declaration falls back safely');
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#part-type'),'Wheel');
 await page.click('#run');await page.waitForFunction(()=>!document.body.classList.contains('building'));await page.click('#build');
 assert.equal(await page.inputValue('#part-type'),'Wheel','run/build retains selected part');
 assert.equal(await page.evaluate(()=>window.__scene.selectedId),Number(await page.inputValue('#parts')),'scene highlight matches selection');
 console.log('Selection: parent after removal, Undo/Redo restore selection, source insertion shifts index without changing target');
}finally{await browser.close();}
