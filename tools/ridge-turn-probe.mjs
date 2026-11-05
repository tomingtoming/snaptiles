import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const base = process.argv[2];
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  await page.goto(base + '#car&c=ridge-turn');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'ridge-turn');
  assert.match(await page.textContent('#challenge-banner'), /黄色の中間地点へ/);
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
  console.log('Ridge turn: steered through checkpoint and goal, replay verified in', time, 's');
} finally {
  await browser.close();
}
