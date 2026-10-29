import {chromium} from 'playwright';import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const p=await b.newPage({viewport:{width:320,height:568}});await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const source='Val {OLD(default=0,min=0,max=100,step=100) OTHER(default=0,min=0,max=50,step=50)} Key {6:OLD(step=100),OTHER(step=50)} Body {Core(){E:Jet(power=OLD) W:Jet()}}';
 await p.fill('#source',source);await p.click('#build');await p.selectOption('#parts','2');await p.selectOption('#power-control','custom');await p.selectOption('#control-key-first','6');await p.selectOption('#control-key-second','10');
 assert.match(await p.locator('#control-key-usage').textContent(),/C：既存の割り当て OLD、OTHER[\s\S]*V：Key定義に割り当てなし/);
 await p.locator('#control-key-usage').scrollIntoViewIfNeeded();await p.screenshot({path:'.shots/editor-key-usage.png'});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await p.selectOption('#control-key-first','14');assert.doesNotMatch(await p.locator('#control-key-usage').textContent(),/OLD/);assert.equal(await p.inputValue('#source'),source);
 await p.click('#control-key-cancel');await p.waitForFunction(()=>!document.querySelector('#control-key-dialog').open);assert.equal(await p.inputValue('#source'),source);
 await p.selectOption('#power-control','custom');await p.selectOption('#control-key-first','6');await p.selectOption('#control-key-second','10');await p.locator('#control-key-form button[type=submit]').click();assert.ok((await p.inputValue('#source')).includes('6:OLD(step=100),OTHER(step=50)'));
 await p.click('#run');await p.waitForFunction(()=>window.__sim?.model.vals.length===3);await p.focus('#view');await p.keyboard.down('c');await p.waitForFunction(()=>window.__sim.env('OLD')===100&&window.__sim.env('OTHER')===50&&window.__sim.env('ST_POWER_1')===1000);await p.keyboard.up('c');await p.waitForFunction(()=>window.__sim.env('OLD')===0&&window.__sim.env('ST_POWER_1')===0);
 console.log('Key usage: existing assignments and selection updates, nonmutating cancel, intentional shared key preserved and simultaneous runtime pass');
}finally{await b.close()}
