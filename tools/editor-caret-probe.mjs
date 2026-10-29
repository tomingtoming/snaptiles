import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);
 const text=Array.from({length:90},(_,i)=>`// comment ${i} ${'long '.repeat(30)}`).join('\n')+'\nBody { Core(){N:Chip(angle=0)} }';
 await page.fill('#source',text);await page.click('#build');
 const capture=()=>page.locator('#source').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,top:el.scrollTop,left:el.scrollLeft}));
 await page.locator('#source').evaluate(el=>{el.focus();const p=el.value.indexOf('comment 40');el.setSelectionRange(p,p+10,'backward');el.scrollTop=700;el.scrollLeft=100;});
 const before=await capture();
 await page.keyboard.type('changed');const after=await capture();
 await page.keyboard.press('Control+z');assert.equal(await page.inputValue('#source'),text);
 assert.deepEqual(await capture(),before,'undo restores original selection and scroll');
 await page.keyboard.press('Control+Shift+z');assert.deepEqual(await capture(),after,'redo restores caret and scroll');
 await page.keyboard.press('Control+z');
 // A GUI attribute edit before the caret should shift the offset without losing its text location.
 await page.selectOption('#parts','1');
 await page.locator('#source').evaluate(el=>{el.setSelectionRange(el.value.length,el.value.length);el.scrollTop=700;el.scrollLeft=100;});
 const guiBefore=await capture();
 await page.fill('#part-angle','90');await page.locator('#part-angle').press('Tab');
 const guiAfter=await capture();assert.equal(guiAfter.start,guiBefore.start+1);assert.equal(guiAfter.top,guiBefore.top);assert.equal(guiAfter.left,guiBefore.left);
 await page.click('#edit-undo');assert.deepEqual(await capture(),guiBefore);
 await page.click('#edit-redo');assert.deepEqual(await capture(),guiAfter);
 // Replacing a backwards selection with indentation uses the same before-edit checkpoint.
 await page.locator('#source').evaluate(el=>{el.focus();el.setSelectionRange(3,8,'backward');el.scrollTop=0;el.scrollLeft=0;});
 const tabBefore=await capture();await page.keyboard.press('Tab');await page.keyboard.press('Control+z');assert.deepEqual(await capture(),tabBefore);
 console.log('Caret: backward selection, scroll offsets, GUI offset tracking, Undo/Redo and Tab replacement pass');
}finally{await browser.close();}
