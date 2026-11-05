import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Drive the left, centre and right of the same rendered course. A downward ray
// from the Core (_H) gives the actual collider height below it at every crest.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car&c=washboard');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'washboard');
  const car = await page.inputValue('#source');
  let baseline;
  for (const { target, height } of [{ target: 11, height: 0.12 }, { target: 0, height: 0.32 }, { target: -11, height: 0.55 }]) {
    const driver = `local x = _X(0)
      local vx = (x - (lastX or x)) * 30
      lastX = x
      ENGINE = (5 - math.abs(_VZ(0))) * 280
      HANDLE = math.max(-22, math.min(22, (x - (${target})) * 2 + vx * 5))
      -- lane ${target}`;
    await page.fill('#source', car.replace('out(0, "km/h", v * 3.6)', driver));
    await page.focus('#source');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(target => window.__sim?.source.includes('-- lane ' + target + '\n'), target);
    const { peaks, valleys, run, observedPeak } = await page.evaluate(() => {
      const sim = window.__sim, api = sim.api();
      const peaks = Array(6).fill(-Infinity), valleys = Array(6).fill(Infinity);
      let observedPeak = 0;
      for (let frame = 0; frame < 1500; frame++) {
        const previousZ = sim.corePosition().z;
        sim.step();
        const { y, z } = sim.corePosition();
        if (z < -12 && previousZ > -48) observedPeak = Math.max(observedPeak, Math.abs(sim.coreVelocity().y));
        if (z < -51) break;
        const surface = y - api._H(0);
        for (let wave = 0; wave < 6; wave++) {
          if (Math.abs(z + 15 + wave * 6) < 0.25) peaks[wave] = Math.max(peaks[wave], surface);
          if (Math.abs(z + 18 + wave * 6) < 0.25) valleys[wave] = Math.min(valleys[wave], surface);
        }
      }
      return { peaks, valleys, run: sim.bumpRun, observedPeak };
    });
    assert.ok(run?.complete && run.entryKmh > 0 && observedPeak > 0);
    assert.equal(run.peakVertical, observedPeak);
    await page.waitForFunction(() => document.querySelector('#challenge-banner-text').textContent.includes('上下速度の最大'));
    if (!baseline) {
      await page.click('#bump-pin');
      baseline = '基準 ' + run.peakVertical.toFixed(2) + ' m/s';
    }
    await page.waitForFunction(text => document.querySelector('#challenge-banner-text').textContent.includes(text), baseline);
    console.log('Crest', height, 'm; entry', run.entryKmh.toFixed(1), 'km/h; peak', observedPeak.toFixed(2), 'm/s');
    await page.evaluate(() => window.__sim.reset());
    assert.equal(await page.evaluate(() => window.__sim.bumpRun), undefined);
    assert.ok(peaks.every(h => Math.abs(h - height) < 0.03), 'lane peaks: ' + peaks);
    assert.ok(valleys.every(h => Math.abs(h) < 0.03), 'lane troughs: ' + valleys);
  }
  console.log('Washboard: six crests and troughs at all three lane heights pass');
} finally {
  await browser.close();
}
