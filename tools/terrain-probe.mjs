import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car');
  await page.waitForFunction(() => window.__sim);
  const car = await page.inputValue('#source');
  async function choose(title, id) {
    await page.click('#challenge-open');
    await page.getByRole('button', { name: new RegExp(title) }).click();
    await page.waitForFunction(id => window.__sim?.scenario?.id === id, id);
  }
  await choose('峠の自由走行', 'mountain-drive');
  assert.equal(await page.textContent('#challenge-banner-text'), '峠の自由走行');
  assert.equal(await page.inputValue('#source'), car);
  // Load a degenerate hull through the normal run button. Reload restores the
  // authored data and proves the app recovers from a rejected course.
  await page.evaluate(() => {
    window.__sim.scenario.ground = [[[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]];
  });
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => !window.__sim && document.body.textContent.includes('衝突形状 1'));
  await page.reload();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'mountain-drive');
  await page.click('#build');
  assert.equal(await page.isVisible('#build-cost'), false);
  await page.click('#run');
  await page.waitForFunction(() => !document.body.classList.contains('building'));
  await page.click('#challenge-quit');
  await page.waitForFunction(() => window.__sim && !window.__sim.scenario);
  assert.ok(await page.evaluate(() => window.__sim.physics.crates.length > 0));

  await choose('峠越え', 'mountain-pass');
  // Keep the car centred on the pass. A real-time throttle click changes its
  // landing and downhill drift, making a test of the terrain depend on input timing.
  const driveCentre = `local x = _X(0)
    local vx = (x - (lastX or x)) * 30
    lastX = x
    ENGINE = (7 - math.abs(_VZ(0))) * 250
    HANDLE = math.max(-22, math.min(22, x * 2 + vx * 5))`;
  await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', driveCentre));
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__sim?.source.includes('local x = _X(0)'));
  await page.waitForFunction(() => {
    const p = window.__sim.corePosition();
    return p.z < -45 && p.z > -65 && p.y > 5;
  }, null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('challenge-result').open, null, { timeout: 30000 });
  assert.match(await page.textContent('#challenge-result-title'), /クリア！ 峠越え/);
  console.log('Free drive selection, reload, build and exit passed. Car crossed the crest and finished:', await page.textContent('#challenge-result-body'));
  await page.click('#challenge-result form button');
  await choose('峠の自由走行', 'mountain-drive');
  const turnBack = `local z = _Z(0)
    if z > 90 then returning = true end
    local target = returning and -6 or 6
    ENGINE = (_VZ(0) - target) * 240
    HANDLE = 0`;
  await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', turnBack));
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__sim?.source.includes('if z > 90'));
  // The southern shoulder meets the low plain at z=80; a thin 6km hull used to
  // tip the car over there. Run the actual fixed steps to check both directions.
  const returned = await page.evaluate(() => {
    const sim = window.__sim;
    let reachedPlain = false;
    for (let i = 0; i < 1800; i++) {
      sim.step();
      const p = sim.corePosition();
      if (p.z > 90 && p.y < -1) reachedPlain = true;
      if (reachedPlain && p.z < 25 && p.y > 0) return true;
    }
    return false;
  });
  assert.ok(returned, 'car should descend onto the outer plain and climb back');
  const tunedCar = await page.inputValue('#source');
  await page.click('#challenge-open');
  await page.click('#course-restart');
  await page.waitForFunction(() => window.__sim?.frame < 30 && window.__sim.scenario?.id === 'mountain-drive');
  assert.equal(await page.inputValue('#source'), tunedCar);
} finally {
  await browser.close();
}
