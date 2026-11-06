import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.argv[2] + '#plane');
  await page.waitForFunction(() => window.__sim);
  await page.click('#challenge-open');
  await page.getByRole('button', { name: /^制動試験路/ }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'brake-track');
  await page.evaluate(() => {
    const box = (x0,x1,y0,y1,z0,z1) => [[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
    const s = window.__sim.scenario;
    s.ground = [box(-1000,1000,-1,0,-1000,1000)];
    s.solids = [box(-1000,1000,0,500,-402,-400)];
    s.goal = undefined;
  });
  await page.click('#build');
  await page.click('#run');
  await page.waitForFunction(() => window.__sim && !document.body.classList.contains('building'));
  await page.focus('#view');
  await page.keyboard.press('Space');
  const before = await page.evaluate(() => {
    const s = window.__sim;
    const command = s.evalLua('THROTTLE=60000');
    if (!command.ok) throw new Error(command.text);
    for (let i=0; i<1200 && s.corePosition().z > -370; i++) s.step();
    const cuts = s.physics.tiles.filter(t => t.tile.parent != null && s.api()._PARENT(t.tile.chipIndex) === -1).map(t => t.tile.chipIndex);
    return { position:s.corePosition().toArray(), speed:s.coreVelocity().length(), cuts };
  });
  assert.ok(before.position[2] <= -370, JSON.stringify(before));
  assert.deepEqual(before.cuts, []);
  await page.keyboard.press('Digit5');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: fileURLToPath(new URL('../.shots/collision-plane-before.png', import.meta.url)) });
  const after = await page.evaluate(() => {
    const s=window.__sim;
    const cut = () => s.physics.tiles.filter(t => t.tile.parent != null && s.api()._PARENT(t.tile.chipIndex) === -1);
    for(let i=0;i<300 && !cut().length;i++) s.step();
    for(let i=0;i<15;i++) s.step();
    return { position:s.corePosition().toArray(), cuts:cut().map(t=>t.tile.chipIndex), durability:s.physics.tiles.map(t=>s.api()._T(t.tile.chipIndex)), poses:s.physics.tiles.map(t=>t.position.toArray()) };
  });
  assert.ok(after.cuts.length > 0, JSON.stringify(after));
  assert.ok(after.durability.every(t=>t===10000));
  assert.ok(after.poses.flat().every(Number.isFinite));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: fileURLToPath(new URL('../.shots/collision-plane-after.png', import.meta.url)) });
  await page.keyboard.press('KeyR');
  assert.deepEqual(await page.evaluate(() => window.__sim.physics.tiles.filter(t=>t.tile.parent != null && window.__sim.api()._PARENT(t.tile.chipIndex)===-1).map(t=>t.tile.chipIndex)), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ before, after:{ position:after.position,cuts:after.cuts }, errors }));
} finally { await browser.close(); }
