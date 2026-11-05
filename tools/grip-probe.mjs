import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  const url = process.argv[2] + '#car&c=brake-track';
  async function run(grip, turn) {
    await page.goto(url);
    await page.reload();
    await page.waitForFunction(() => window.__sim?.scenario?.id === 'brake-track');
    const car = await page.inputValue('#source');
    if (grip === 1) {
      await page.click('#brake-compare');
      await page.waitForFunction(() => window.__sim?.scenario?.id === 'brake-track-normal');
      await page.waitForFunction(() => location.hash.includes('&c=brake-track-normal'));
      assert.equal(await page.inputValue('#source'), car);
      await page.reload();
      await page.waitForFunction(() => window.__sim?.scenario?.id === 'brake-track-normal');
    }
    const drive = `local v = -_VZ(0)
      ENGINE = math.max(0, math.min(1500, (9-v)*350))
      if _Z(0) < -36 or active then
        active = true
        ${turn ? 'HANDLE = 18' : 'ENGINE = 0; BRAKE = 100'}
      end
      out(0, active and 1 or 0)`;
    await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', drive));
    await page.focus('#source');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => window.__sim?.source.includes('active and 1'));
    const result = await page.evaluate(turn => {
      const sim = window.__sim;
      let start, still = 0;
      for (let frame = 0; frame < 900; frame++) {
        const p = sim.corePosition(), speed = -sim.coreVelocity().z;
        sim.step();
        if (!start && sim.out[0] === '1') start = { x: p.x, z: p.z, speed, frame };
        if (!start) continue;
        still = Math.abs(sim.coreVelocity().z) < 0.15 ? still + 1 : 0;
        if (turn ? frame - start.frame >= 24 : still >= 6) {
          const end = sim.corePosition();
          return { speed: start.speed, distance: turn ? end.x - start.x : start.z - end.z, fromLine: sim.scenario.brakeLine - end.z };
        }
      }
      throw new Error('vehicle did not finish the material trial');
    }, turn);
    if (!turn) {
      await page.waitForFunction(value => {
        const readout = document.getElementById('challenge-banner-text').textContent.match(/基準線から ([\d.]+)m/);
        return readout && Math.abs(Number(readout[1]) - value) < 0.2;
      }, result.fromLine);
    }
    return result;
  }
  for (const turn of [false, true]) {
    const dry = await run(1, turn), slick = await run(0.18, turn);
    assert.ok(Math.abs(dry.speed - slick.speed) < 0.1 && dry.speed > 8, 'matched entry speeds');
    assert.ok(turn ? slick.distance < dry.distance * 0.5 : slick.distance > dry.distance * 1.5);
    console.log(turn ? 'Lateral travel at 0.8 s' : 'Braking distance', { dry, slick });
  }

  await page.goto(process.argv[2] + '#car&c=braking-box');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'braking-box');
  const slow = (await page.inputValue('#source')).replace('out(0, "km/h", v * 3.6)', 'ENGINE = (5 + _VZ(0)) * 200');
  await page.fill('#source', slow);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(source => window.__sim?.source === source, slow);
  await page.evaluate(() => {
    const step = document.getElementById('debug-forward');
    for (let i = 0; i < 500 && window.__sim.brakingEntryKmh === undefined; i++) step.click();
  });
  await page.waitForFunction(() => document.getElementById('challenge-banner-text').textContent.includes('速度不足'));
  const slowKmh = await page.evaluate(() => window.__sim.brakingEntryKmh);
  assert.ok(slowKmh > 0 && slowKmh < 36);
  await page.click('#brake-retry');
  await page.waitForFunction(() => window.__sim && window.__sim.frame < 30 && window.__sim.brakingEntryKmh === undefined);
  assert.equal(await page.inputValue('#source'), slow);
  assert.equal(await page.isVisible('#brake-retry'), false);
  console.log('Slow entry measured at', slowKmh.toFixed(1), 'km/h; retry kept the model.');
  for (const brake of [false, true]) {
    await page.goto(process.argv[2] + '#car&c=braking-box');
    await page.reload();
    await page.waitForFunction(() => window.__sim?.scenario?.id === 'braking-box');
    await page.focus('#view');
    await page.evaluate(() => {
      const step = document.getElementById('debug-forward');
      do { step.click(); } while (window.__sim.frame < 45);
    });
    await page.keyboard.down('ArrowUp');
    await page.evaluate(() => {
      const step = document.getElementById('debug-forward');
      for (let i = 0; i < 400 && window.__sim.corePosition().z > -36; i++) step.click();
    });
    assert.equal(await page.evaluate(() => window.__sim.checkpointPassed), true);
    if (brake) {
      await page.keyboard.up('ArrowUp');
      await page.keyboard.down('z');
    }
    const outcome = await page.evaluate(() => {
      const sim = window.__sim;
      const step = document.getElementById('debug-forward');
      let enteredAtSpeed = false;
      for (let i = 0; i < 500 && !document.getElementById('challenge-result').open; i++) {
        step.click();
        const p = sim.corePosition();
        if (p.z < -70 && p.z > -85 && Math.abs(p.x) <= 6.5 && sim.coreVelocity().length() > 1) enteredAtSpeed = true;
      }
      return { enteredAtSpeed, clear: document.getElementById('challenge-result').open, speedKmh: sim.coreVelocity().length() * 3.6 };
    });
    await page.keyboard.up(brake ? 'z' : 'ArrowUp');
    assert.ok(outcome.enteredAtSpeed);
    assert.equal(outcome.clear, brake);
    if (brake) {
      assert.ok(outcome.speedKmh <= 1);
      const measurements = await page.locator('#challenge-result-body dd').allTextContents();
      const stop = await page.evaluate(() => window.__sim.scenario.brakeLine - window.__sim.corePosition().z);
      assert.ok(measurements.includes(stop.toFixed(2) + ' m先'));
      const finishFrame = await page.evaluate(() => window.__sim.frame);
      await page.evaluate(() => {
        for (let i = 0; i < 60; i++) document.getElementById('debug-forward').click();
      });
      assert.equal(await page.evaluate(() => window.__sim.frame), finishFrame + 60);
      await page.click('#challenge-copy');
      await page.waitForFunction(() => document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
      const link = await page.evaluate(() => navigator.clipboard.readText());
      const receiver = await browser.newPage();
      await receiver.goto(link);
      await receiver.waitForFunction(() => window.__sim?.replaying);
      assert.equal(await receiver.evaluate(() => window.__sim.player.frames), finishFrame);
      await receiver.evaluate(() => {
        const step = document.getElementById('debug-forward');
        for (let i = 0; i < 900 && !document.getElementById('challenge-result').open; i++) step.click();
      });
      const reproduced = await receiver.locator('#challenge-result-body dd').allTextContents();
      assert.deepEqual(reproduced.slice(0, 5), measurements.slice(0, 5));
      assert.match(await receiver.textContent('#challenge-result-body'), /再計算して確認済み/);
      console.log('Recorded braking run reproduced:', reproduced);
      await receiver.close();
    }
    console.log(brake ? 'Stopped inside the box:' : 'Driving through did not clear:', outcome);
  }
} finally {
  await browser.close();
}
