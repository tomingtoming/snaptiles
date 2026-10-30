import {chromium} from 'playwright';import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const url=process.argv[2]??'http://127.0.0.1:5175/';
 const mark=async(p,dir)=>{await p.waitForTimeout(700);const r=await p.locator(`svg.attachment-directions g[data-direction="${dir}"] .hit`).boundingBox();assert.ok(r&&r.width>=39.5,`${dir} mark has a 40px hit target`);return {x:r.x+r.width/2,y:r.y+r.height/2};};
 const p=await b.newPage({viewport:{width:1400,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>window.__sim);
 // Running hides the marks, so a stray click cannot edit the model mid-drive.
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('svg.attachment-directions')).display==='none',null,{timeout:5000});
 await p.click('#build');await p.click('#new-model');await p.waitForTimeout(300);
 const n=await mark(p,'N');await p.mouse.click(n.x,n.y);
 assert.match(await p.inputValue('#source'),/Core\(\)\s*\{\s*N:Chip\(/);assert.equal(await p.inputValue('#parts'),'1','new part becomes the selection, like the panel button');
 // Paste mode is shared with the panel: copy the new Chip, select Core, paste east from the view.
 await p.click('#copy-branch');await p.selectOption('#parts','0');await p.selectOption('#add-type','clipboard');await p.waitForTimeout(200);
 const e=await mark(p,'E');await p.mouse.click(e.x,e.y);assert.match(await p.inputValue('#source'),/E:Chip\(/);assert.equal(await p.locator('#parts option').count(),3);
 await p.click('#edit-undo');assert.doesNotMatch(await p.inputValue('#source'),/E:Chip/);await p.click('#edit-redo');assert.match(await p.inputValue('#source'),/E:Chip/);
 // A drag that starts on a mark must not orbit the camera or pick a tile underneath.
 await p.selectOption('#parts','0');await p.waitForTimeout(200);const before=await p.inputValue('#source');const s=await mark(p,'S');
 await p.mouse.move(s.x,s.y);await p.mouse.down();await p.mouse.move(s.x+60,s.y+10,{steps:4});await p.mouse.up();assert.equal(await p.inputValue('#source'),before,'drag off a mark does not add');
 // Invalid source disables the panel buttons; the view marks follow them.
 const valid=await p.inputValue('#source');await p.fill('#source','Body {');await p.mouse.click(s.x,s.y);assert.equal(await p.inputValue('#source'),'Body {');
 await p.keyboard.press('Control+z');assert.equal(await p.inputValue('#source'),valid);
 await p.click('#run');await p.waitForFunction(()=>!document.body.classList.contains('building'));await p.waitForFunction(()=>getComputedStyle(document.querySelector('svg.attachment-directions')).display==='none',null,{timeout:5000});
 await p.screenshot({path:'.shots/editor-view-direction.png'});assert.deepEqual(errors,[]);
 // Touch: a tap on a mark adds once.
 const t=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await t.goto(url);await t.waitForFunction(()=>window.__sim);await t.tap('#build');await t.tap('#new-model');await t.waitForTimeout(300);
 const w=await mark(t,'W');await t.touchscreen.tap(w.x,w.y);assert.equal((await t.inputValue('#source')).match(/W:Chip/g)?.length,1);
 console.log('View directions: click add, selection, shared paste mode, Undo/Redo, drag-off, invalid source, hidden while running and touch tap pass');
}finally{await b.close()}
