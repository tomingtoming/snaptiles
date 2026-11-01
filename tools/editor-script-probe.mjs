import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');
 const body='Val { P(default=0,min=-5000,max=5000) }\nBody { Core(){ N:Jet(power=P){ } } }\n';
 await page.fill('#source',body);
 await page.click('#script-tools summary');
 // no Lua yet: "Luaへ移動" appends a Lua section with an OnFrame and puts the caret inside it
 await page.click('#script-goto');
 assert.equal(await page.inputValue('#source'),body+'Lua {\nfunction OnFrame()\n  \nend\n}\n');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'source');
 const caret=await page.evaluate(()=>document.querySelector('#source').selectionStart);
 assert.equal(caret,(body+'Lua {\nfunction OnFrame()\n  ').length);
 // search the reference and insert at the caret
 await page.fill('#api-search','高さ');
 const listed=await page.locator('#api-list option').allTextContents();
 assert.ok(listed.some(t=>t.startsWith('_H(n)')),listed.join('|'));
 await page.selectOption('#api-list',{index:listed.findIndex(t=>t.startsWith('_H(n)'))});
 assert.match(await page.locator('#api-desc').textContent(),/地面までの距離/);
 await page.click('#api-insert');
 assert.equal(await page.inputValue('#source'),body+'Lua {\nfunction OnFrame()\n  _H(0)\nend\n}\n');
 // a snippet names the model's first Val
 await page.fill('#api-search','');
 await page.selectOption('#snippet',{label:'値を画面に表示'});
 await page.evaluate(()=>{const s=document.querySelector('#source');const i=s.value.indexOf('_H(0)')+5;s.setSelectionRange(i,i);});
 await page.click('#snippet-insert');
 assert.equal(await page.inputValue('#source'),body+'Lua {\nfunction OnFrame()\n  _H(0)out(0, "P = ", P)\nend\n}\n');
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),body+'Lua {\nfunction OnFrame()\n  _H(0)\nend\n}\n');
 // a runtime error names its line; the button outside the builder selects that line
 const broken=body+'Lua {\nfunction OnFrame()\n  P = nosuch.field\nend\n}\n';
 await page.fill('#source',broken);await page.click('#run');
 await page.waitForFunction(()=>/line \d+:/.test(document.querySelector('#status').textContent));
 assert.equal(await page.locator('#script-error').isVisible(),true);
 assert.match(await page.locator('#script-error-text').textContent(),/エラー: 5行目/);
 await page.click('#script-error-goto');
 const sel=await page.evaluate(()=>{const s=document.querySelector('#source');return s.value.slice(s.selectionStart,s.selectionEnd);});
 assert.equal(sel,'  P = nosuch.field');
 // fixing the source and running again clears it
 await page.fill('#source',body+'Lua {\nfunction OnFrame()\n  P = 0\nend\n}\n');await page.click('#run');
 await page.waitForFunction(()=>!/line \d+:/.test(document.querySelector('#status').textContent));
 assert.equal(await page.locator('#script-error').isHidden(),true);
 await page.click('#build');await page.click('#script-tools summary').catch(()=>{});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-script-mobile.png',import.meta.url)),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Script tools: Lua section creation, reference search/description/insert at caret, snippets with the model\'s Val, Undo, error line jump and clearing pass');
}finally{await browser.close()}
