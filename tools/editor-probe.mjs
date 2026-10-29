import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5175/';
const out = new URL('../.shots', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto(base); await page.waitForFunction(() => window.__sim);
 await page.click('#build');
 const before = await page.inputValue('#source');
 const count = await page.locator('#parts option').count();
 await page.selectOption('#add-type', 'Chip'); await page.click('[data-edge="N"]');
 assert.equal(await page.locator('#parts option').count(), count + 1);
 const target = await page.locator('#parts option').last().getAttribute('value');
 await page.selectOption('#parts', target); await page.fill('#part-angle', '45'); await page.locator('#part-angle').press('Tab');
 assert.equal(await page.inputValue('#part-angle'), '45');
 await page.click('#edit-undo'); assert.equal(await page.inputValue('#part-angle'), '0');
 await page.click('#edit-redo'); assert.equal(await page.inputValue('#part-angle'), '45');
 await page.screenshot({ path: `${out}/editor-desktop.png` });
 // Ray selection uses actual mesh projection; it must pick something without orbiting.
 const point = await page.evaluate(() => {
   const s = window.__scene, mesh = [...s.views.values()].at(-1).mesh;
   const v = mesh.position.clone().project(s.camera), r = s.renderer.domElement.getBoundingClientRect();
   return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
 });
 await page.selectOption('#parts', '0'); await page.mouse.click(point.x, point.y);
 assert.notEqual(await page.inputValue('#parts'), '0');
 const saved = await page.inputValue('#source');
 const download = page.waitForEvent('download'); await page.click('#save-model');
 const stream = await (await download).createReadStream(); let content = ''; for await (const chunk of stream) content += chunk;
 assert.equal(content, saved);
 await page.click('#run'); await page.waitForFunction(() => location.hash.startsWith('#m='));
 assert.equal(await page.locator('#builder').isVisible(), false);
 assert.equal(await page.locator('#status').textContent(), '');
 await page.click('#build'); assert.equal(await page.locator('#edit-undo').isEnabled(), true);
 await page.click('#edit-undo'); await page.click('#edit-undo'); assert.equal(await page.inputValue('#source'), before);
 // Shared URL restores the edited file in a new page.
 const shared = await browser.newPage(); await shared.goto(page.url()); await shared.waitForFunction(() => window.__sim);
 assert.equal(await shared.inputValue('#source'), saved); await shared.close();
 await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${out}/editor-mobile.png` });
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 for (const selector of ['#add-type', '[data-edge="S"]', '#part-angle', '#save-model']) {
   assert.equal(await page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(), p = document.querySelector('#builder').getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }), true, `${selector} must be visible without panel scrolling`);
 }
 await page.fill('#source', 'Body { Core(){ N:Chip(angle=');
 assert.equal(await page.locator('[data-edge="N"]').isDisabled(), true);
 await page.fill('#source', before); assert.equal(await page.locator('[data-edge="N"]').isEnabled(), true);
 // Configure a new motor without writing Val/Key code, then exercise the real input loop.
 await page.setViewportSize({ width: 1280, height: 800 });
 await page.fill('#source', 'Body { Core(){ E:Jet(angle=0) } }');
 await page.selectOption('#parts', '1');
 await page.fill('#part-power', '1200'); await page.locator('#part-power').press('Tab');
 await page.selectOption('#power-control', 'new');
 assert.equal(await page.inputValue('#power-control'), 'ST_POWER_1');
 await page.click('#run');
 await page.waitForFunction(() => window.__sim?.model.vals.some(v => v.name === 'ST_POWER_1'));
 await page.focus('#view'); await page.keyboard.down('ArrowUp');
 await page.waitForFunction(() => window.__sim.env('ST_POWER_1') === 1200);
 await page.keyboard.up('ArrowUp'); await page.waitForFunction(() => window.__sim.env('ST_POWER_1') === 0);
 await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__sim.env('ST_POWER_1') === -1200); await page.keyboard.up('ArrowDown');
 await page.click('#build'); await page.selectOption('#parts', '1');
 await page.setViewportSize({width: 390, height: 844});
 await page.screenshot({path: `${out}/editor-power-mobile.png`});
 for (const selector of ['#part-power', '#power-control', '#add-type', '[data-edge="S"]']) {
   assert.equal(await page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(), p = document.querySelector('#builder').getBoundingClientRect(); return b.top >= p.top && b.bottom <= p.bottom; }), true, `${selector} must fit with power controls`);
 }
 assert.deepEqual(errors, []);
 console.log(JSON.stringify({ result: 'pass', count, checks: ['add', 'angle', 'undo-redo', '3D pick', 'save contents', 'run', 'history after run', 'URL reload', 'mobile overflow', 'invalid source recovery'], errors }));
} finally { await browser.close(); }
