import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto(process.argv[2]??'http://127.0.0.1:5175/'); await page.waitForFunction(()=>window.__sim);
 await page.click('#build'); await page.click('#new-model'); await page.selectOption('#add-type','Cowl'); await page.click('[data-edge="N"]');
 await page.click('#viewmode');
 const geometry=[];
 for(let shape=0;shape<8;shape++) {
   await page.selectOption('#part-option',String(shape));
   const signature=await page.evaluate(()=>{
     const view=window.__scene.views.get(1);
     return {option:view.tile.option,positions:Array.from(view.mesh.geometry.attributes.position.array).join(',')};
   });
   assert.equal(signature.option,shape);geometry.push(signature.positions);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   if(shape<=5) await page.screenshot({path:fileURLToPath(new URL(`../.shots/editor-cowl-${shape}.png`,import.meta.url))});
 }
 assert.equal(new Set(geometry.slice(0,6)).size,6);
 assert.equal(geometry[6],geometry[0]); assert.equal(geometry[7],geometry[0]);
 await page.click('#edit-undo');assert.equal(await page.inputValue('#part-option'),'6');
 await page.click('#edit-redo');assert.equal(await page.inputValue('#part-option'),'7');
 await page.selectOption('#part-option','5');
 await page.click('#run');await page.waitForFunction(()=>window.__sim?.assembly?.tiles[1]?.option===5);
 assert.equal(await page.evaluate(()=>window.__sim.assembly.tiles[1].type),'cowl');
 console.log('Cowl: eight GUI options, six distinct meshes, plate variants, Undo/Redo and runtime option pass');
}finally{await browser.close();}
