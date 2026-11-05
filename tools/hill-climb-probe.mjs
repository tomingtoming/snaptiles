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
  await page.keyboard.down('ArrowUp');
  for (const [start, degrees] of [[-12, 6], [-50, 12], [-88, 18]]) {
    const result = await page.evaluate(start => {
      const sim = window.__sim, api = sim.api();
      function sample(z) {
        for (let n = 0; n < 750 && sim.corePosition().z > z; n++) sim.step();
        const p = sim.corePosition();
        return { z: p.z, surface: p.y - api._H(0), x: p.x };
      }
      return [sample(start - 4), sample(start - 18)];
    }, start);
    const [a, b] = result;
    assert.ok(b.z <= start - 18 && Math.abs(b.x) < 14, JSON.stringify(result));
    const angle = Math.atan2(b.surface - a.surface, a.z - b.z) * 180 / Math.PI;
    assert.ok(Math.abs(angle - degrees) < 0.25, 'measured ' + angle);
    console.log('North ascent', degrees, 'degrees; measured', angle.toFixed(2));
  }
  await page.evaluate(() => {
    const sim = window.__sim;
    for (let i = 0; i < 500 && sim.corePosition().z > -116; i++) sim.step();
  });
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => document.querySelector('#challenge-banner-text').textContent.includes('頂上の平場'));
  const top = await page.evaluate(() => window.__sim.corePosition().y - window.__sim.api()._H(0));
  const expected = [6, 12, 18].reduce((height, angle) => height + 24 * Math.tan(angle * Math.PI / 180), 0);
  assert.ok(Math.abs(top - expected) < 0.03, 'summit ' + top);
  console.log('Stock car reached the summit at', top.toFixed(2), 'm.');
} finally { await browser.close(); }
