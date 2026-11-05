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
    const held = new Set();
    const press = (key, down) => {
      if (held.has(key) === down) return;
      if (down) held.add(key); else held.delete(key);
      view.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key, code:key, bubbles:true }));
    };
    function sample(z) {
      for (let n = 0; n < 750 && sim.corePosition().z > z; n++) {
        const steer = Math.max(-22, Math.min(22, -2 * sim.corePosition().x - 4 * sim.coreVelocity().x));
        press('ArrowLeft', steer < sim.env('HANDLE') - 1);
        press('ArrowRight', steer > sim.env('HANDLE') + 1);
        press('ArrowUp', sim.coreVelocity().length() < 7);
        sim.step();
      }
      const p = sim.corePosition();
      if (p.z > z || Math.abs(p.x) >= 14) throw Error('Missed road sample at ' + z);
      return {z:p.z, surface:p.y-api._H(0)};
    }
    const angles = [-12,-50,-88].map(start => {
      const a = sample(start-4), b = sample(start-18);
      return Math.atan2(b.surface-a.surface, a.z-b.z)*180/Math.PI;
    });
    const top = sample(-116).surface;
    for (const key of held) press(key, false);
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
    const result = await page.evaluate(async stop => {
      const sim = window.__sim, view = document.querySelector('#view'), held = new Set();
      const press = (code, key, down) => {
        if (held.has(code) === down) return;
        if (down) held.add(code); else held.delete(code);
        view.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code, key, bubbles: true}));
      };
      const stops = [], readings = [], departures = [];
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
            if (stop === 'incline') {
              await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
              readings.push(document.querySelector('#challenge-banner-text').textContent);
            }
            holds.push({ stationary: stationary >= 30, speed, downhill: sim.coreVelocity().z, lastSecondPeak });
            stops.push(z); stationary = brakeFrames = lastSecondPeak = 0;
          }
        }
        if (stop === 'incline' && stops.length > departures.length && sim.coreVelocity().z < -0.5) {
          await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
          departures.push(document.querySelector('#challenge-banner-text').textContent);
        }
        sim.step();
      }
      press('ArrowUp', 'ArrowUp', false); press('KeyZ', 'z', false);
      return { stops, holds, readings, departures, end: sim.corePosition().toArray(), passes: Array.from(sim.climbPasses.values()) };
    }, stop);
    assert.equal(result.passes.length, 3, JSON.stringify(result));
    assert.equal(result.stops.length, { rolling: 0, landing: 2, incline: 3 }[stop]);
    if (stop === 'incline') assert.ok(result.holds.every(hold => !hold.stationary && hold.downhill > 0));
    if (stop === 'incline') {
      assert.equal(result.departures.length, 3);
      result.departures.forEach(text => assert.match(text, /坂道発進・上り/));
    }
    result.readings.forEach((text,i) => {
      const match = text.match(/坂道発進・下り (\d+) cm\/s/);
      assert.ok(match && Math.abs(Number(match[1]) - result.holds[i].downhill * 100) <= 1, text);
    });
    result.stops.forEach((z,i) => {
      const [near, far] = stop === 'incline' ? [-21, -27] : [-36, -50];
      assert.ok(z < near - i * 38 && z > far - i * 38, 'stop at ' + z);
    });
    await page.waitForFunction(() => document.querySelector('#challenge-banner-text').textContent.includes('18° ') && document.querySelector('#challenge-banner-text').textContent.includes('秒（進入'));
    console.log(stop, JSON.stringify(result));
    await page.evaluate(() => window.__sim.reset());
    assert.equal(await page.evaluate(() => window.__sim.climbPasses.size), 0);
  }
  await page.click('#challenge-open');
  await page.click('[data-course-section="course-lessons"]');
  await page.getByRole('button', { name: /坂の途中で止まる/ }).click();
  await page.waitForFunction(() => location.hash === '#lesson=incline-hold' && window.__sim?.scenario?.id === 'incline-hold');
  await page.click('#mission-edit');
  const source = await page.inputValue('#source');
  await page.fill('#source', source.replace('ENGINE = 300 ', 'ENGINE = math.min(6, (z + 62) * 0.7) * 220 + vz * 220 + 100 '));
  await page.press('#source', 'Control+Enter');
  await page.waitForFunction(() => window.__sim?.source.includes('math.min(6'));
  const position = await page.evaluate(() => {
    const sim = window.__sim;
    while (sim.frame < 1800 && sim.missionProgress.held < 89) sim.step();
    return {z: sim.corePosition().z, held: sim.missionProgress.held, speed: sim.coreVelocity().length()};
  });
  assert.equal(position.held, 89); assert.ok(position.z >= -65 && position.z <= -59 && position.speed <= 0.05);
  await page.waitForFunction(() => document.querySelector('#challenge-result').open);
  assert.match(await page.textContent('#challenge-result-title'), /クリア！ 坂の途中で止まる/);
  console.log('Hill hold mission', position, await page.textContent('#challenge-result-body'));
} finally { await browser.close(); }
