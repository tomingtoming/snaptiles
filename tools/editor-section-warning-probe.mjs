import {chromium} from 'playwright';import assert from 'node:assert/strict';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 const p=await b.newPage({viewport:{width:390,height:844}});await p.goto(process.argv[2]??'http://127.0.0.1:5175/');await p.waitForFunction(()=>window.__sim);
 const extra='Metadata { label="keep me" }\n',source=extra+'Body {Core(){E:Chip(angle=0,user1=7)}}\nLua {function OnFrame() out(0,_GET(1,"USER1")) end}';
 await p.setInputFiles('#model-file',{name:'metadata.rcd',mimeType:'text/plain',buffer:Buffer.from(source)});await p.waitForFunction(()=>window.__sim?.out[0]==='7');
 assert.match(await p.locator('#status').textContent(),/Metadata.*line 1/);assert.equal(await p.inputValue('#source'),source);
 await p.click('#build');await p.selectOption('#parts','1');await p.fill('#part-angle','20');await p.locator('#part-angle').press('Tab');const edited=source.replace('angle=0','angle=20');assert.equal(await p.inputValue('#source'),edited);await p.click('#copy-branch');assert.match(await p.locator('#status').textContent(),/Metadata/);
 const event=p.waitForEvent('download');await p.click('#save-model');let text='';for await(const c of await(await event).createReadStream())text+=c;assert.equal(text,edited);
 // A warning must not hide a storage failure.
 await p.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota')}});await p.fill('#part-angle','21');await p.locator('#part-angle').press('Tab');assert.match(await p.locator('#status').textContent(),/Metadata[\s\S]*下書きを保存できません/);
 await p.fill('#source',extra+'Body {Core()} Lua {function OnFrame() error("script failed") end}');await p.click('#run');await p.waitForFunction(()=>window.__sim?.scriptError);await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('script failed'));assert.match(await p.locator('#status').textContent(),/Metadata/);
 await p.screenshot({path:'.shots/editor-section-warning.png'});
 await p.fill('#source','Body {Core()}');await p.click('#run');await p.waitForFunction(()=>window.__sim&&!window.__sim.model.script);assert.equal(await p.locator('#status').textContent(),'');
 console.log('Section warning: runs supported content/USER1, preserves unknown block through edit/save, copy keeps warning, storage/script errors remain visible, clean reload clears warning');
}finally{await b.close()}
