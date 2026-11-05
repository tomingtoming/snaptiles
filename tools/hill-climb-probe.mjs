import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car');
  await page.waitForFunction(() => window.__sim);
  await page.click('#challenge-open');
  await page.getByRole('button', { name: /三段の登坂路/ }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'terraced-climb' && window.__sim.frame > 35);
  await page.focus('#view');
  const {angles, top} = await page.evaluate(() => {
    const sim = window.__sim, api = sim.api(), view = document.querySelector('#view');
    view.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', code:'ArrowUp', bubbles:true}));
    function sample(z) {
      for (let n = 0; n < 750 && sim.corePosition().z > z; n++) sim.step();
      const p = sim.corePosition();
      if (p.z > z || Math.abs(p.x) >= 14) throw Error('Missed road sample at ' + z);
      return {z:p.z, surface:p.y-api._H(0)};
    }
    const angles = [-12,-50,-88].map(start => {
      const a = sample(start-4), b = sample(start-18);
      return Math.atan2(b.surface-a.surface, a.z-b.z)*180/Math.PI;
    });
    const top = sample(-116).surface;
    view.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowUp', code:'ArrowUp', bubbles:true}));
    return {angles, top};
  });
  angles.forEach((value,i) => assert.ok(Math.abs(value-[6,12,18][i]) < 0.25, 'measured '+value));
  const expected = [6, 12, 18].reduce((height, angle) => height + 24 * Math.tan(angle * Math.PI / 180), 0);
  assert.ok(Math.abs(top - expected) < 0.03, 'summit ' + top);
  console.log('Stock car reached the summit at', top.toFixed(2), 'm.');
  for (const stop of ['rolling', 'landing', 'incline']) {
    await page.reload();
    await page.waitForFunction(() => window.__sim?.scenario?.id === 'terraced-climb' && window.__sim.frame > 35);
    await page.focus('#view');
    const result = await page.evaluate(stop => {
      const sim = window.__sim, view = document.querySelector('#view'), held = new Set();
      const press = (code, key, down) => {
        if (held.has(code) === down) return;
        if (down) held.add(code); else held.delete(code);
        view.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code, key, bubbles: true}));
      };
      const stops = [];
      const brakeAt = stop === 'incline' ? [-21, -59, -97] : stop === 'landing' ? [-38, -76] : [];
      let stationary = 0, brakeFrames = 0;
      const holds = [];
      let lastSecondPeak = 0;
      for (let frame = 0; frame < 4500 && sim.climbPasses.size < 3; frame++) {
        const {z} = sim.corePosition(), speed = sim.coreVelocity().length();
        const steering = Math.max(-22, Math.min(22, -2 * sim.corePosition().x - 4 * sim.coreVelocity().x));
        const handle = sim.env('HANDLE');
        press('ArrowLeft', 'ArrowLeft', steering < handle - 1);
        press('ArrowRight', 'ArrowRight', steering > handle + 1);
        const brake = stops.length < brakeAt.length && (brakeFrames > 0 || z < brakeAt[stops.length]);
        press('ArrowUp', 'ArrowUp', !brake && speed < 7);
        press('KeyZ', 'z', brake);
        if (brake) {
          brakeFrames++;
          stationary = speed < 0.05 ? stationary + 1 : 0;
          if (brakeFrames > 60) lastSecondPeak = Math.max(lastSecondPeak, speed);
          if (stationary === 30 || (stop === 'incline' && brakeFrames === 90)) {
            holds.push({ stationary: stationary >= 30, speed, downhill: sim.coreVelocity().z, lastSecondPeak });
            stops.push(z); stationary = brakeFrames = lastSecondPeak = 0;
          }
        }
        sim.step();
      }
      press('ArrowUp', 'ArrowUp', false); press('KeyZ', 'z', false);
      return { stops, holds, end: sim.corePosition().toArray(), passes: Array.from(sim.climbPasses.values()) };
    }, stop);
    assert.equal(result.passes.length, 3, JSON.stringify(result));
    assert.equal(result.stops.length, { rolling: 0, landing: 2, incline: 3 }[stop]);
    if (stop === 'incline') assert.ok(result.holds.every(hold => !hold.stationary && hold.downhill > 0));
    result.stops.forEach((z,i) => {
      const [near, far] = stop === 'incline' ? [-21, -27] : [-36, -50];
      assert.ok(z < near - i * 38 && z > far - i * 38, 'stop at ' + z);
    });
    await page.waitForFunction(() => document.querySelector('#challenge-banner-text').textContent.includes('18° ') && document.querySelector('#challenge-banner-text').textContent.includes('秒（進入'));
    console.log(stop, JSON.stringify(result));
    await page.evaluate(() => window.__sim.reset());
    assert.equal(await page.evaluate(() => window.__sim.climbPasses.size), 0);
  }
} finally { await browser.close(); }
