// Dump tile poses from the running page: node tools/dump.mjs <url> [@sample] [keys...]
import { chromium } from 'playwright';

const [url = 'http://127.0.0.1:5173/', ...rest] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const sampleArg = rest.find((k) => k.startsWith('@'));
if (sampleArg) {
  await page.getByRole('button', { name: sampleArg.slice(1), exact: true }).click();
  await page.waitForTimeout(1000);
}
for (const spec of rest.filter((k) => !k.startsWith('@'))) {
  const [codes, ms = '1000'] = spec.split(':');
  const list = codes.split('+').filter(Boolean);
  await page.focus('#view');
  for (const c of list) await page.keyboard.down(c);
  await page.waitForTimeout(Number(ms));
  for (const c of list) await page.keyboard.up(c);
}
await page.waitForTimeout(300);
const rows = await page.evaluate(() => {
  const sim = window.__sim;
  const out = [];
  for (const tb of sim.physics.tiles) {
    const t = tb.tile;
    const pose = sim.physics.pose(tb);
    const p = pose.position;
    const r = pose.quaternion;
    // normal = local +Y
    const x = 2 * (r.x * r.y - r.w * r.z);
    const y = 1 - 2 * (r.x * r.x + r.z * r.z);
    const z = 2 * (r.y * r.z + r.w * r.x);
    const rest = t.position;
    out.push({
      i: t.chipIndex, type: t.type, dir: t.dir, angle: t.node.attrs.angle ?? '',
      rest: [rest.x, rest.y, rest.z].map((v) => +v.toFixed(2)),
      pos: [p.x, p.y, p.z].map((v) => +v.toFixed(2)),
      normal: [x, y, z].map((v) => +v.toFixed(2)),
      joint: tb.joint ? (typeof tb.joint.angle === "function" ? +tb.joint.angle().toFixed(2) : "n/a") : null,
    });
  }
  return { out, vals: document.getElementById('vals')?.textContent, status: document.getElementById('status')?.textContent };
});
for (const r of rows.out) console.log(JSON.stringify(r));
console.log(rows.vals, rows.status);
await browser.close();
