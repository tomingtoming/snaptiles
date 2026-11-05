import {chromium} from 'playwright';
import assert from 'node:assert/strict';
// Challenges: pick one, the banner shows cost against budget, a cheap car clears 100m, the result keeps a personal
// best, the record link replays the clear in another page ("確認済み"), and leaving the challenge restores the course.
const MINI=`Val { ENGINE(default=0,min=-3000,max=3000,step=500) }
Key { 0:ENGINE(step=500) }
Body { Core(){ N:Chip(){ W:Wheel(angle=90,power=-ENGINE){} E:Wheel(angle=90,power=ENGINE){} } S:Chip(){ W:Wheel(angle=90,power=-ENGINE){} E:Wheel(angle=90,power=ENGINE){} } } }
`;
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const base=process.argv[2]??'http://127.0.0.1:5175/';
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(base).origin});
 const page=await context.newPage();
 await page.goto(base+'#car'); await page.waitForFunction(()=>window.__sim);
 await page.click('#challenge-open');
 assert.equal(await page.locator('#challenge-list button').count(),13); // 2 free drives, 5 challenges, 6 missions
 await page.click('#challenge-list button:has-text("100m走")');
 await page.waitForFunction(()=>window.__sim?.scenario?.id==='sprint');
 assert.match(await page.evaluate(()=>location.hash),/&c=sprint/);
 await page.waitForFunction(()=>!document.getElementById('challenge-banner').hidden);
 assert.match(await page.textContent('#challenge-banner'),/100m走.*コスト 36 \/ 30/);
 assert.equal(await page.evaluate(()=>document.getElementById('challenge-banner').classList.contains('over')),true);
 // the default course is gone in the physics
 assert.equal(await page.evaluate(()=>window.__sim.physics.crates.length),0);
 // a car within the budget
 await page.fill('#source',MINI); await page.focus('#source'); await page.keyboard.press('Control+Enter');
 await page.waitForFunction(()=>document.getElementById('challenge-banner').textContent.includes('コスト 22 / 30'));
 assert.equal(await page.evaluate(()=>document.getElementById('challenge-banner').classList.contains('over')),false);
 await page.focus('#view'); await page.keyboard.down('ArrowUp');
 await page.waitForFunction(()=>document.getElementById('challenge-result').open,null,{timeout:30000});
 await page.keyboard.up('ArrowUp');
 const title=await page.textContent('#challenge-result-title');
 assert.match(title,/クリア！ 100m走/);
 const body=await page.textContent('#challenge-result-body');
 const time=body.match(/タイム([\d.]+) 秒/)[1];
 assert.match(body,/初クリア！|自己ベスト更新！/); assert.match(body,/コスト22 \/ 30/); assert.match(body,/Luaなし/);
 await page.click('#challenge-copy');
 await page.waitForFunction(()=>document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
 const link=await page.evaluate(()=>navigator.clipboard.readText());
 assert.match(link,/#m=.*&c=sprint&r=/);
 await page.click('#challenge-result form button');
 // the personal best shows in the list
 await page.click('#challenge-open');
 assert.match(await page.textContent('#challenge-list'),new RegExp(`自己ベスト ${time} 秒 / コスト 22`));
 await page.click('#challenge-dialog form button');
 // the record link replays the clear in another page and confirms it
 const page2=await context.newPage();
 await page2.goto(link); await page2.waitForFunction(()=>window.__sim?.scenario?.id==='sprint');
 await page2.waitForFunction(()=>document.getElementById('challenge-result').open,null,{timeout:30000});
 const body2=await page2.textContent('#challenge-result-body');
 assert.match(body2,new RegExp(`タイム${time} 秒`)); assert.match(body2,/確認済み/);
 // while building, the cost of the model being edited against the budget
 await page.click('#build');
 await page.waitForFunction(()=>!document.getElementById('build-cost').hidden);
 assert.match(await page.textContent('#build-cost'),/100m走.*コスト 22 \/ 30（残り 8）/);
 assert.match(await page.textContent('#build-cost'),/｜Wheel 4×5=20 · Chip 2×1=2$/);
 // the part lists carry each type's cost
 assert.equal(await page.$eval('#add-type option[value="Wheel"]',o=>o.text),'Wheel　コスト5');
 assert.equal(await page.$eval('#part-type option[value="Core"]',o=>o.text),'Core　コスト0');
 await page.click('#new-model');
 await page.waitForFunction(()=>document.getElementById('build-cost').textContent.includes('コスト 0 / 30'));
 await page.click('[data-edge="N"]');
 await page.waitForFunction(()=>!document.getElementById('build-cost').textContent.includes('コスト 0 /'));
 await page.fill('#source',MINI); await page.click('#run');
 await page.waitForFunction(()=>!document.body.classList.contains('building'));
 assert.equal(await page.isVisible('#build-cost'),false);
 // a mission swaps in its own model and shows how long the state has been held
 await page.click('#challenge-open');
 await page.click('#challenge-list button:has-text("セグウェイを立たせる")');
 await page.waitForFunction(()=>window.__sim?.scenario?.id==='balance');
 assert.match(await page.inputValue('#source'),/ミッション：セグウェイ/);
 await page.waitForFunction(()=>/ミッション：セグウェイを立たせる｜保持/.test(document.getElementById('challenge-banner').textContent));
 // a mission with a waypoint says whether the Core has passed it
 await page.click('#challenge-open');
 await page.click('#challenge-list button:has-text("行って帰る")');
 await page.waitForFunction(()=>window.__sim?.scenario?.id==='shuttle');
 await page.waitForFunction(()=>/ミッション：行って帰る｜折り返しはまだ｜保持/.test(document.getElementById('challenge-banner').textContent));
 // leaving the challenge
 await page.click('#challenge-quit');
 await page.waitForFunction(()=>window.__sim&&!window.__sim.scenario);
 assert.equal(await page.isVisible('#challenge-banner'),false);
 await page.waitForFunction(()=>!location.hash.includes('&c='));
 assert.ok(await page.evaluate(()=>window.__sim.physics.crates.length)>0);
 console.log(`Challenge: list, banner and over-budget mark, 100m cleared in ${time} s at cost 22, best kept, build-mode cost, mission model and hold banner, waypoint banner, record link replays and confirms the clear, leaving restores the course pass`);
}finally{await browser.close();}
