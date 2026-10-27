// node tools/fire-probe.mjs <file> <key:ms> ... — reports arm charge and shell count after each key
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, ...keys] = process.argv.slice(2);
const buf = readFileSync(file);
let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#source', text);
await page.click('#run');
await page.waitForTimeout(6500);
const state = () => page.evaluate(() => {
  const sim = window.__sim;
  const arms = sim.physics.tiles.filter((t) => t.tile.type === 'arm').map((t) => ({ i: t.tile.chipIndex, e: sim.physics.armCharge.get(t.tile.id) ?? 0, opt: t.tile.option }));
  return { tick: sim.physics.tick, shells: sim.physics.projectiles.length, arms: arms.slice(0, 3), status: document.getElementById('status').textContent, out: document.getElementById('out').textContent.slice(0, 120) };
});
console.log('before', JSON.stringify(await state()));
for (const spec of keys) {
  const [code, ms = '800'] = spec.split(':');
  await page.focus('#view');
  await page.keyboard.down(code);
  await page.waitForTimeout(Number(ms));
  console.log(code, 'held', JSON.stringify(await state()));
  await page.keyboard.up(code);
  await page.waitForTimeout(300);
}
await browser.close();
