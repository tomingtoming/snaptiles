// Drive test: node tools/drive-probe.mjs <keySpec> <file...> — loads each file, holds keys, reports speed/upright
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [spec, ...files] = process.argv.slice(2);
const [codes, ms = '4000'] = spec.split(':');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
for (const f of files) {
  const buf = readFileSync(f);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
  if (process.env.TUNE) await page.evaluate((c) => { window.__tune = c; }, JSON.parse(process.env.TUNE));
  await page.fill('#source', text);
  await page.click('#run');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => { const s = window.__sim; const p = s.physics.pose(s.physics.tiles[0]); return [p.position.x, p.position.y, p.position.z]; });
  await page.focus('#view');
  for (const c of codes.split('+')) await page.keyboard.down(c);
  await page.waitForTimeout(Number(ms));
  const r = await page.evaluate(() => {
    const s = window.__sim; const tb = s.physics.tiles[0]; const p = s.physics.pose(tb);
    const q = p.quaternion; const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const v = s.physics.velocity(tb, p);
    return { x: p.position.x, y: p.position.y, z: p.position.z, upY: +upY.toFixed(2), kmh: +(v.length() * 3.6).toFixed(1), err: s.scriptError ?? '' };
  });
  for (const c of codes.split('+')) await page.keyboard.up(c);
  const dist = Math.hypot(r.x - before[0], r.z - before[2]).toFixed(1);
  console.log(`${r.upY < 0.5 ? 'FLIP' : 'ok  '} ${f.split(/[\/]/).slice(-2).join('/')} dist=${dist} kmh=${r.kmh} upY=${r.upY} y=${r.y.toFixed(2)} ${r.err.slice(0, 60)}`);
}
await browser.close();
