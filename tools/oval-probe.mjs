import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyCourseReplay } from './verify-course-replay.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(process.argv[2] + '#car&c=banked-oval');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'banked-oval');
  const custom = (await page.inputValue('#source')) + '\n// practice setup';
  await page.fill('#source', custom);
  await page.focus('#view'); await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__sim.corePosition().z < -4);
  await page.keyboard.up('ArrowUp');
  await page.getByRole('button', { name: 'タイムアタックへ', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'oval-lap');
  const start = await page.evaluate(() => ({ z: window.__sim.corePosition().z, gates: window.__sim.ringsPassed, source: window.__sim.source }));
  assert.ok(Math.abs(start.z) < 1); assert.equal(start.gates, 0); assert.equal(start.source, custom);
  await page.click('#challenge-open');
  assert.equal(await page.locator('#challenge-list button').filter({hasText:'バンク付き周回路'}).count(), 1);
  await page.locator('#challenge-dialog form button').click();
  await page.getByRole('button', { name: '自由走行に戻る', exact: true }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'banked-oval');
  assert.equal(await page.inputValue('#source'), custom);
  const runLap = async launch => {
    await page.goto(process.argv[2] + '#car&c=oval-lap');
    await page.waitForFunction(() => window.__sim?.scenario?.id === 'oval-lap');
    await page.focus('#view');
    const gates = await page.evaluate(launch => {
      const sim = window.__sim, view = document.getElementById('view');
      const held = new Set();
      const key = (code, down) => {
        if (held.has(code) === down) return;
        if (down) held.add(code); else held.delete(code);
        view.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: code, code, bubbles: true }));
      };
      // Follow the lane centre 7 m ahead of the current position.
      while (sim.frame < 2550) {
        const { x, z } = sim.corePosition(), v = sim.coreVelocity();
        if (sim.ringsPassed === 7 && z < 2) break;
        let tx, tz;
        if (z <= -36 || z >= 36) {
          const cz = z < 0 ? -36 : 36;
          const angle = Math.atan2(z - cz, x - 24) + 7 / 24;
          tx = 24 + 24 * Math.cos(angle);
          tz = cz + 24 * Math.sin(angle);
        } else {
          tx = x < 24 ? 0 : 48;
          tz = z + (x < 24 ? -7 : 7);
        }
        const angle = Math.atan2(tx - x, z - tz) - Math.atan2(v.x, -v.z);
        const desired = Math.max(-24, Math.min(24, 65 * Math.atan2(Math.sin(angle), Math.cos(angle))));
        const handle = sim.env('HANDLE') ?? 0;
        key('ArrowLeft', desired < handle - 1);
        key('ArrowRight', desired > handle + 1);
        key('ArrowUp', sim.frame > launch && Math.hypot(v.x, v.z) < 6);
        sim.step();
      }
      key('ArrowLeft', false); key('ArrowRight', false); key('ArrowUp', true);
      return sim.ringsPassed;
    }, launch);
    assert.equal(gates, 7);
    const result = page.locator('#challenge-result[open]');
    await result.waitFor();
    return result.textContent();
  };
  const body = await runLap(40);
  const time = body.match(/タイム([\d.]+) 秒/)[1];
  const sections = [...body.matchAll(/(?:スタート → 北カーブ|北カーブ → 東直線|東直線 → 南カーブ|南カーブ → ゴール)[\d.]+ 秒/g)].map(match => match[0]);
  assert.equal(sections.length, 4);
  console.log(time, sections);
  await page.click('#challenge-copy');
  await page.waitForFunction(() => document.querySelector('#challenge-result-status').textContent.includes('コピーしました'));
  await verifyCourseReplay(await page.evaluate(() => navigator.clipboard.readText()), time, sections);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('snaptiles.challenge.oval-lap')));
  const first = await stored();
  assert.equal(first.sectorDurations.length, 4);
  await page.reload();
  const slower = await runLap(70);
  assert.match(slower, /自己最速周より[\d.]+ 秒遅い/);
  assert.deepEqual(await stored(), first);
  // A legacy record has no split evidence. A slower drive cannot fill it.
  await page.evaluate(() => localStorage.setItem('snaptiles.challenge.oval-lap', JSON.stringify({ time: 1, cost: 40 })));
  await page.reload();
  const legacy = await runLap(40);
  assert.ok(!legacy.includes('自己最速周'));
  assert.deepEqual(await stored(), { time: 1, cost: 36 });
  console.log('Slow lap compared against fastest lap; older best preserved after cheaper finish.');
} finally { await browser.close(); }
