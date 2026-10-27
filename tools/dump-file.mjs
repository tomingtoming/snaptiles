// Dump poses for a model file: node tools/dump-file.mjs <url> <file> [typeFilter]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [url, file, filter = ''] = process.argv.slice(2);
const buf = readFileSync(file);
let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.fill('#source', text);
await page.click('#run');
await page.waitForTimeout(2500);
const rows = await page.evaluate((filter) => {
  const sim = window.__sim;
  const out = [];
  for (const tb of sim.physics.tiles) {
    const t = tb.tile;
    if (filter && t.type !== filter) continue;
    const pose = sim.physics.pose(tb);
    const r = pose.quaternion;
    const n = [2 * (r.x * r.y - r.w * r.z), 1 - 2 * (r.x * r.x + r.z * r.z), 2 * (r.y * r.z + r.w * r.x)];
    const chain = [];
    for (let p = t.parent; p; p = p.parent) chain.unshift(`${p.dir ?? ''}${p.type}(${p.node.attrs.angle ?? ''})`);
    out.push({ i: t.chipIndex, type: t.type, dir: t.dir, pos: [pose.position.x, pose.position.y, pose.position.z].map((v) => +v.toFixed(2)), normal: n.map((v) => +v.toFixed(2)), chain: chain.slice(-4).join(' > ') });
  }
  return out;
}, filter);
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
