import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Drive the left, centre and right of the same rendered course. A downward ray
// from the Core (_H) gives the actual collider height below it at every crest.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car&c=washboard');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'washboard');
  await page.click('#terrain-map summary');
  const chart = page.locator('#terrain-map');
  const nextLine = chart.locator('line[stroke="#ffc747"]');
  await nextLine.waitFor({ state: 'attached' });
  assert.equal(await nextLine.getAttribute('aria-label'), '計測入口');
  assert.equal(await chart.locator('line[aria-label^="山頂"]').count(), 6);
  const car = await page.inputValue('#source');
  let baseline;
  for (const { target, height } of [{ target: 11, height: 0.12 }, { target: 0, height: 0.32 }, { target: -11, height: 0.55 },
    { target: "math.max(-11, 11 - math.max(0, math.abs(_Z(0)) - 17) * 1.3)", height: null }]) {
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
    const profile = run.crestsCm.every(cm => cm === run.crestsCm[0]) ? run.crestsCm[0] + ' cm × 6' : run.crestsCm.join('→') + ' cm';
    if (!baseline) {
      await page.click('#bump-pin');
      baseline = '基準 ' + run.peakVertical.toFixed(2) + ' m/s（進入 ' + run.entryKmh.toFixed(1) + ' km/h・山頂 ' + profile + '）';
    }
    await page.waitForFunction(text => document.querySelector('#challenge-banner-text').textContent.includes(text), baseline);
    console.log('Crest', height, 'm; entry', run.entryKmh.toFixed(1), 'km/h; peak', observedPeak.toFixed(2), 'm/s');
    const banner = await page.textContent('#challenge-banner-text');
    assert.ok(banner.split('｜基準')[0].includes('山頂 ' + profile), banner);
    if (height === null) assert.ok(banner.includes(run.crestsCm.join('→')), banner);
    await page.waitForFunction(() => document.querySelector('#terrain-map small').textContent.includes('計測終了'));
    assert.equal(await nextLine.count(), 0);
    await page.evaluate(() => window.__sim.reset());
    await page.waitForFunction(() => document.querySelector('#terrain-map line[stroke="#ffc747"]')?.getAttribute('aria-label') === '計測入口');
    assert.equal(await page.evaluate(() => window.__sim.bumpRun), undefined);
    assert.equal(run.crestsCm.length, 6);
    assert.ok(peaks.every((h, i) => Math.abs(h * 100 - run.crestsCm[i]) < 3), 'ray vs crest: ' + peaks);
    console.log('Crest profile (cm)', run.crestsCm);
    if (height === null) assert.ok(new Set(run.crestsCm).size >= 3);
    if (height !== null) assert.ok(peaks.every(h => Math.abs(h - height) < 0.03), 'lane peaks: ' + peaks);
    assert.ok(valleys.every(h => Math.abs(h) < 0.03), 'lane troughs: ' + valleys);
  }
  await page.evaluate(() => {
    const sim = window.__sim;
    for (let i = 0; i < 1000 && (sim.bumpRun?.crestsCm.length ?? 0) < 2; i++) sim.step();
  });
  await page.waitForFunction(() => document.querySelector('#terrain-map line[stroke="#ffc747"]')?.getAttribute('aria-label') === '山頂3');
  console.log('Washboard: six crests and troughs at all three lane heights pass');
} finally {
  await browser.close();
}
