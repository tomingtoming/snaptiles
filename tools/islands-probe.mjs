import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyCourseReplay } from './verify-course-replay.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(process.argv[2] + '#raft&c=island-passage');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'island-passage');
  await page.click('#terrain-map summary');
  assert.match(await page.textContent('.contour-key'), /水深1.2m以内/);
  await page.waitForFunction(() => document.querySelector('.map-sounding').textContent.includes('水深 3.00m'));
  const firstMarker = page.locator('#terrain-map line[aria-label="ブイ1"]');
  assert.equal(await firstMarker.getAttribute('stroke'), '#ffc747');
  await page.focus('#view');
  const crossed = await page.evaluate(() => {
    const sim = window.__sim;
    const route = [[0, 0], [9, -32], [3, -49], [-9, -76], [-4, -96], [11, -126]];
    const pressed = new Set();
    const key = (code, down) => {
      if (pressed.has(code) === down) return;
      if (down) pressed.add(code); else pressed.delete(code);
      document.getElementById('view').dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: code, code, bubbles: true }));
    };
    let previousHeading = 0;
    while (sim.frame < 1900 && sim.corePosition().z > -125) {
      const p = sim.corePosition(), q = sim.physics.tiles[0].quaternion;
      const ahead = p.z - 13;
      let targetX = route.at(-1)[0];
      for (let leg = 1; leg < route.length; leg++) {
        const [x0, z0] = route[leg - 1], [x1, z1] = route[leg];
        if (ahead < z1) continue;
        targetX = x0 + (x1 - x0) * Math.max(0, Math.min(1, (ahead - z0) / (z1 - z0)));
        break;
      }
      const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
      const heading = Math.atan2(-2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const yawRate = 30 * wrap(heading - previousHeading);
      previousHeading = heading;
      const error = wrap(Math.atan2(targetX - p.x, 13) - heading);
      const rudder = Math.max(-1200, Math.min(1200, (error - 0.5 * yawRate) * 1300));
      const turn = sim.env('TURN') ?? 0;
      key('ArrowUp', sim.frame >= 60 && (sim.env('THRUST') ?? 0) < 2000);
      key('ArrowLeft', sim.frame >= 60 && rudder < turn - 130);
      key('ArrowRight', sim.frame >= 60 && rudder > turn + 130);
      sim.step();
    }
    key('ArrowLeft', false); key('ArrowRight', false); key('ArrowUp', true);
    return sim.ringsPassed;
  });
  assert.equal(crossed, 2);
  const result = page.locator('#challenge-result[open]');
  await result.waitFor();
  await page.keyboard.up('ArrowUp');
  assert.match(await result.textContent(), /クリア！ 三島の蛇行航路/);
  const time = (await result.textContent()).match(/タイム([\d.]+) 秒/)[1];
  await page.click('#challenge-copy');
  await page.waitForFunction(() => document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await verifyCourseReplay(link, time);
  console.log('Three island channels sailed in', time, 's');
} finally { await browser.close(); }
