import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { verifyCourseReplay } from './verify-course-replay.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(process.argv[2] + '#raft&c=inlet-buoys');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'inlet-buoys');
  await page.focus('#view');
  const advance = async frames => page.evaluate(count => {
    for (let n = 0; n < count; n++) window.__sim.step();
  }, frames);
  await advance(90);
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => {
    const sim = window.__sim;
    while (sim.corePosition().z > -12 && sim.frame < 700) sim.step();
  });
  assert(await page.evaluate(() => window.__sim.checkpointPassed));
  await page.keyboard.down('ArrowRight');
  await advance(42);
  await page.keyboard.up('ArrowRight');
  await page.evaluate(() => {
    const sim = window.__sim;
    while (sim.corePosition().z > -21.8 && sim.frame < 1400) sim.step();
  });
  const result = page.locator('#challenge-result[open]');
  await result.waitFor();
  await page.keyboard.up('ArrowUp');
  assert.match(await result.textContent(), /クリア！/);
  const time = (await result.textContent()).match(/タイム([\d.]+) 秒/)[1];
  await page.click('#challenge-copy');
  await page.waitForFunction(() => document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
  const link = await page.evaluate(async () => navigator.clipboard.readText());
  assert(link.includes('inlet-buoys'));
  await verifyCourseReplay(link, time);
  console.log('Twin-jet raft passed both buoy gates:', time, 's');

  for (const [width, height] of [[390, 844], [844, 390]]) {
    const mobile = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await mobile.goto(process.argv[2] + '#raft&c=inlet-buoys');
    await mobile.waitForFunction(() => window.__sim?.frame > 20);
    await mobile.click('#terrain-map summary');
    const cdp = await mobile.context().newCDPSession(mobile);
    const finger = async (label, id) => {
      const cap = await mobile.locator('#keys .cap').filter({ hasText: label }).boundingBox();
      return { id, x: cap.x + cap.width / 2, y: cap.y + cap.height / 2 };
    };
    const up = await finger('↑', 1), right = await finger('→', 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [up, right] });
    await mobile.waitForFunction(() => window.__sim.env('TURN') === 2200 && window.__sim.env('THRUST') === 3600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [right] });
    await mobile.waitForFunction(() => window.__sim.api()._KEY(0) === 1 && window.__sim.api()._KEY(3) === 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mobile.waitForFunction(() => window.__sim.api()._KEY(0) === 0);
    const rows = await mobile.locator('#samples button').evaluateAll(buttons => new Set(buttons.map(b => b.getBoundingClientRect().top)).size);
    assert(rows <= 2, 'sample buttons fit within two rows');
    await mobile.close();
  }
} finally { await browser.close(); }
