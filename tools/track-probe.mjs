// node tools/track-probe.mjs <file> <keySpec> [samples] — samples the core pose every 250 ms while keys are held
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, spec = 'ArrowUp', n = '12'] = process.argv.slice(2);
const buf = readFileSync(file);
let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
if (process.env.TUNE) await page.evaluate((c) => { window.__tune = c; }, JSON.parse(process.env.TUNE));
await page.fill('#source', text);
await page.click('#run');
await page.waitForTimeout(1500);
await page.focus('#view');
for (const c of spec.split('+')) await page.keyboard.down(c);
for (let i = 0; i < Number(n); i++) {
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const s = window.__sim; const tb = s.physics.tiles[0]; const p = s.physics.pose(tb); const q = p.quaternion;
    const v = s.physics.velocity(tb, p);
    const vals = [...s.vals.values()].filter((x) => /WHEEL|ENGINE|JET|E_/.test(x.name)).slice(0, 6).map((x) => `${x.name}=${Math.round(x.value)}`).join(' ');
    return `t=${(s.ticks / 30).toFixed(2)} pos=(${p.position.x.toFixed(1)},${p.position.y.toFixed(1)},${p.position.z.toFixed(1)}) upY=${(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2)} v=${(v.length() * 3.6).toFixed(0)}km/h ${vals}`;
  });
  console.log(r);
}
await browser.close();
