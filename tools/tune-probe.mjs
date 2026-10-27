// Try sign/frame conventions for _AX/_AZ/_WX.. against self-balancing models:
// node tools/tune-probe.mjs <idleMs> <file...>   — prints upY per combination per file
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [idle = '5000', ...files] = process.argv.slice(2);
const combos = [];
for (const wLocal of [true, false])
  for (const w of [1, -1])
    for (const ax of [1, -1])
      for (const az of [1, -1]) combos.push({ ax, ay: 1, az, w, wLocal });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
const texts = files.map((f) => {
  const buf = readFileSync(f);
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(t)) t = new TextDecoder('shift_jis').decode(buf);
  return t;
});
for (const c of combos) {
  const row = [];
  for (const [i, text] of texts.entries()) {
    await page.evaluate((c) => { window.__tune = c; }, c);
    await page.fill('#source', text);
    await page.click('#run');
    await page.waitForTimeout(Number(idle));
    const r = await page.evaluate(() => {
      const s = window.__sim; const tb = s.physics.tiles[0]; const p = s.physics.pose(tb);
      const q = p.quaternion; return +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2);
    });
    row.push(`${files[i].split(/[\\/]/).pop()}=${r}`);
  }
  console.log(`ax=${c.ax} az=${c.az} w=${c.w} local=${c.wLocal}  ${row.join('  ')}`);
}
await browser.close();
