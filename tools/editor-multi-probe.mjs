import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/');await page.waitForFunction(()=>window.__sim);await page.click('#build');
 const source='Body { Core(){ N:Chip(){ N:Chip(){ } } W:Chip(){ } E:Chip(){ } S:Chip(){ } } }\nLua { function main() end }';
 // 0 Core, 1 N:Chip, 2 N:Chip, 3 W:Chip, 4 E:Chip, 5 S:Chip
 await page.fill('#source',source);await page.selectOption('#parts','1');await page.click('#frame-model');
 await page.evaluate(()=>new Promise(r=>setTimeout(r,600)));
 const at=id=>page.evaluate(id=>{const s=window.__scene,c=s.renderer.domElement.getBoundingClientRect(),p=s.views.get(id).mesh.getWorldPosition(s.views.get(id).mesh.position.clone()).project(s.camera);return {x:c.left+(p.x+1)/2*c.width,y:c.top+(1-p.y)/2*c.height};},id);
 const click=async(id,modifiers=[])=>{const p=await at(id);for(const m of modifiers)await page.keyboard.down(m);await page.mouse.click(p.x,p.y);for(const m of modifiers)await page.keyboard.up(m);};
 const status=()=>page.locator('#multi-status');
 assert.equal(await status().isHidden(),true);
 // Shift+click adds a part; the clicked part becomes the primary one, the others are outlined in blue
 await click(3,['Shift']);
 assert.equal(await status().isVisible(),true);assert.match(await page.locator('#multi-count').textContent(),/^2部品/);
 assert.equal(await page.inputValue('#parts'),'3');assert.equal(await page.evaluate(()=>window.__scene.markedCount),1);
 for(const id of ['#copy-branch','#mirror-branch','#move-branch']) assert.equal(await page.locator(id).isDisabled(),true,id);
 assert.equal(await page.locator('[data-edge="N"]').isDisabled(),true);
 // touch-style mode: plain taps toggle
 await page.click('#multi-select');assert.equal(await page.getAttribute('#multi-select','aria-pressed'),'true');
 await click(5);assert.match(await page.locator('#multi-count').textContent(),/^3部品/);
 await click(5);assert.match(await page.locator('#multi-count').textContent(),/^2部品/);
 await click(4);await page.click('#multi-select');
 assert.match(await page.locator('#multi-count').textContent(),/^3部品/);
 // one change applies to all selected parts, each one undo step
 await page.fill('#part-angle','25');await page.locator('#part-angle').press('Enter');
 await page.locator('#part-color').evaluate(e=>{e.value='#336699';e.dispatchEvent(new Event('change'));});
 await page.selectOption('#part-type','Frame');
 const edited=await page.evaluate(()=>window.__editor?.document?.text ?? document.querySelector('#source').value);
 const nodes=await page.evaluate(()=>[...document.querySelector('#source').value.matchAll(/([NSWE]):(\w+)\(([^)]*)\)/g)].map(m=>m.slice(1).join('|')));
 assert.deepEqual(nodes,['N|Frame|angle=25, color=#336699','N|Chip|','W|Frame|angle=25, color=#336699','E|Frame|angle=25, color=#336699','S|Chip|']);
 assert.match(edited,/Lua \{ function main\(\) end \}/);
 assert.match(await page.locator('#multi-count').textContent(),/^3部品/,'the selection survives the edits');
 // delete all three in one step; the nested child goes with its branch
 assert.equal(await page.locator('#part-delete').textContent(),'3部品を削除');
 await page.click('#part-delete');
 assert.equal(await page.inputValue('#source'),'Body { Core(){    S:Chip(){ } } }\nLua { function main() end }');
 assert.equal(await status().isHidden(),true);assert.equal(await page.inputValue('#parts'),'0');
 await page.click('#edit-undo');assert.equal(await page.inputValue('#source'),edited);
 await page.click('#edit-undo');await page.click('#edit-undo');await page.click('#edit-undo');
 assert.equal(await page.inputValue('#source'),source);
 // a plain click or choosing from the list ends the multi-selection
 await page.selectOption('#parts','1');await click(3,['Control']);assert.equal(await status().isVisible(),true);
 await page.selectOption('#parts','5');assert.equal(await status().isHidden(),true);assert.equal(await page.evaluate(()=>window.__scene.markedCount),0);
 await click(3,['Shift']);assert.equal(await status().isVisible(),true);await page.click('#multi-clear');assert.equal(await status().isHidden(),true);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-multi-mobile.png',import.meta.url))});
 assert.deepEqual(errors,[]);console.log('Multi-selection: Shift/Ctrl click and tap mode, blue outlines, bulk angle/colour/type, one-step bulk delete with nested parts, Undo, list/clear exits pass');
}finally{await browser.close()}
