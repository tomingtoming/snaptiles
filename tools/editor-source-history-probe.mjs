import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); await page.click('#new-model');
 const blank=await page.inputValue('#source');
 await page.click('[data-edge="N"]'); const added=await page.inputValue('#source');
 await page.locator('#source').focus(); await page.keyboard.press('Control+End');
 await page.keyboard.type('// handwritten'); const typed=await page.inputValue('#source');
 assert.equal(await page.locator('#edit-undo').isEnabled(),true,'typing must retain Undo history');
 await page.click('#edit-undo'); assert.equal(await page.inputValue('#source'),added,'undo typing batch');
 await page.click('#edit-undo'); assert.equal(await page.inputValue('#source'),blank,'undo earlier GUI add');
 await page.click('#edit-redo'); await page.click('#edit-redo'); assert.equal(await page.inputValue('#source'),typed);
 await page.fill('#source','Body { Core(){');
 assert.equal(await page.locator('[data-edge="N"]').isDisabled(),true);
 await page.keyboard.press('Control+z'); assert.equal(await page.inputValue('#source'),typed,'recover incomplete source via keyboard');
 await page.keyboard.press('Control+Shift+z'); assert.equal(await page.inputValue('#source'),'Body { Core(){');
 await page.keyboard.press('Control+z');
 await page.click('#run'); await page.waitForFunction(()=>!document.body.classList.contains('building'));
 await page.locator('#source').focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Tab');
 await page.keyboard.press('Control+z'); assert.equal(await page.inputValue('#source'),typed,'indent undo outside builder');
 // Use Chromium's IME event path rather than replacing text with JavaScript.
 await page.keyboard.press('Control+End');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'a',selectionStart:1,selectionEnd:1});
 await page.waitForTimeout(1100);
 await cdp.send('Input.imeSetComposition',{text:'あ',selectionStart:1,selectionEnd:1});
 await cdp.send('Input.insertText',{text:'あ'});
 assert.equal(await page.inputValue('#source'),typed+'あ');
 await page.keyboard.press('Control+z'); assert.equal(await page.inputValue('#source'),typed,'IME is one undo batch');
 await page.keyboard.type(' new branch');
 await page.keyboard.press('Control+Shift+z'); assert.equal(await page.inputValue('#source'),typed+' new branch','new input clears obsolete redo');
 // Browser-provided history gestures route through the same document history.
 await page.locator('#source').evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{inputType:'historyUndo',bubbles:true,cancelable:true})));
 assert.equal(await page.inputValue('#source'),typed);
 console.log('Source history: GUI/typing Undo/Redo, invalid source, indentation, slow IME, history gesture and redo branching pass');
} finally {await browser.close();}
