import { chromium, firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const base = process.argv[2];
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(base + '#car&c=ridge-turn');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'ridge-turn');
  assert.match(await page.textContent('#challenge-banner'), /黄色の中間地点へ/);
  await page.click('#terrain-map summary');
  await page.waitForFunction(() => document.querySelector('#terrain-map small').textContent.includes('中間まで'));
  const car = await page.inputValue('#source');
  // Drive the sample car by its own steering and throttle. Original Lua X increases to the left.
  const driver = `local x,z = _X(0),_Z(0)
    local vx = (x - (lastX or x)) * 30
    lastX = x
    local target = z > -43 and 8 or -10
    ENGINE = (7 - math.abs(_VZ(0))) * 250
    HANDLE = math.max(-22, math.min(22, (x - target) * 2 + vx * 5))`;
  await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', driver));
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__sim?.checkpointPassed, null, { timeout: 35000 });
  assert.match(await page.textContent('#challenge-banner'), /中間地点通過/);
  assert.match(await page.textContent('#terrain-map small'), /ゴールまで/);
  const result = page.locator('#challenge-result[open]');
  await result.waitFor({ timeout: 45000 });
  assert.match(await result.textContent(), /クリア！ 峠の切り返し/);
  const time = (await result.textContent()).match(/タイム([\d.]+) 秒/)[1];
  await page.click('#challenge-copy');
  await page.waitForFunction(() => document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(link);
  await page.reload(); // changing the hash alone leaves the running model in place
  await result.waitFor({ timeout: 60000 });
  assert.match(await result.textContent(), /確認済み/);
  assert.ok((await result.textContent()).includes('タイム' + time + ' 秒'));
  await page.click('#challenge-result form button');
  await page.click('#debug-toggle');
  for (const { frame, passed } of [{ frame: 45, passed: false }, { frame: 360, passed: true }]) {
    await page.waitForFunction(frame => Number(document.getElementById('debug-timeline').max) >= frame, frame);
    await page.$eval('#debug-timeline', (slider, value) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    }, frame);
    await page.waitForFunction(frame => window.__sim.frame === frame, frame);
    assert.equal(await page.evaluate(() => window.__sim.checkpointPassed), passed);
    assert.match(await page.textContent('#challenge-banner'), passed ? /中間地点通過/ : /黄色の中間地点へ/);
  }
  // Re-run the same link in the other browser engines. Fast-forward the physics
  // to just before the finish, then let the normal UI evaluate the goal and time.
  for (const engine of [firefox, webkit]) {
    const receiver = await engine.launch();
    try {
      const tab = await receiver.newPage();
      await tab.goto(link);
      await tab.waitForFunction(() => window.__sim?.replaying, null, { timeout: 30000 });
      await tab.evaluate(frame => {
        const sim = window.__sim;
        while (sim.frame < frame) sim.step();
      }, Math.round(Number(time) * 30) - 12);
      const verified = tab.locator('#challenge-result[open]');
      await verified.waitFor({ timeout: 30000 });
      const body = await verified.textContent();
      assert.match(body, /確認済み/);
      assert.ok(body.includes('タイム' + time + ' 秒'), engine.name() + ': ' + body);
      console.log(engine.name(), 'verified the ridge turn in', time, 's');
    } finally {
      await receiver.close();
    }
  }
  // A shortcut enters the finish from the right, missing the left-hand checkpoint.
  await page.goto(base + '#car&c=ridge-turn');
  await page.reload();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'ridge-turn');
  const shortcut = driver.replace('z > -43 and 8 or -10', '-10');
  await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', shortcut));
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__sim?.source.includes('local target = -10'));
  await page.evaluate(() => {
    const sim = window.__sim;
    while (sim.frame < 1000 && sim.corePosition().z > -86) sim.step();
  });
  await page.waitForFunction(() => {
    const { x, y, z } = window.__sim.corePosition();
    return x >= 4 && x <= 20 && y >= 0 && y <= 8 && z < -96 && z > -113;
  });
  assert.equal(await page.evaluate(() => window.__sim.checkpointPassed), false);
  assert.equal(await result.count(), 0, 'the finish alone must not clear the course');
  console.log('Ridge turn: steered through checkpoint and goal, replay verified in', time, 's');
} finally {
  await browser.close();
}
