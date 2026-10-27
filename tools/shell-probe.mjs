import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, key = 'KeyZ'] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#source', text);
await page.click('#run');
await page.waitForTimeout(6500);
await page.focus('#view');
await page.keyboard.down(key);
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(60);
  console.log(JSON.stringify(await page.evaluate(() => {
    const s = window.__sim;
    const arm = s.physics.tiles.find((t) => t.tile.type === 'arm');
    const pose = s.physics.pose(arm); const q = pose.quaternion;
    const n = [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)].map((v) => +v.toFixed(2));
    return { tick: s.physics.tick, charge: s.physics.armCharge.get(arm.tile.id), P: s.vals.get('P').value, armPos: [pose.position.x, pose.position.y, pose.position.z].map((v) => +v.toFixed(2)), n, shells: s.physics.projectiles.map((p) => { const t = p.body.translation(); return [+t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)]; }) };
  })));
}
await page.keyboard.up(key);
await browser.close();
