import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(process.argv[2] + '#car&c=highlands');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'highlands');
  await page.click('#terrain-map summary');
  await page.waitForFunction(() => document.querySelectorAll('#terrain-map path').length === 5);
  const arrow = page.locator('.map-direction');
  assert.equal(await arrow.isVisible(), false);
  await page.focus('#view');
  for (const { key, north } of [{ key: 'ArrowUp', north: true }, { key: 'ArrowDown', north: false }]) {
    await page.keyboard.down(key);
    await page.waitForFunction(north => {
      const v = window.__sim.physics.tiles[0].vel;
      return north ? v.z < -1 : v.z > 1;
    }, north);
    const transform = await arrow.getAttribute('transform');
    assert.ok(transform);
    const angle = Number(transform.match(/rotate\(([-.\d]+)\)/)?.[1]);
    assert.ok(north ? Math.abs(angle) < 30 : Math.abs(angle) > 150);
    assert.equal(await arrow.isVisible(), true);
    await page.keyboard.up(key);
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto(process.argv[2] + '#plane&c=highland-bank');
    await page.waitForFunction(() => window.__sim?.scenario?.id === 'highland-bank');
    if (!(await page.locator('#terrain-map').evaluate(el => el.open))) await page.click('#terrain-map summary');
    const blocked = await page.locator('#keys .cap').evaluateAll(caps => caps.filter(cap => {
      const r = cap.getBoundingClientRect();
      return !cap.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }).map(cap => cap.textContent));
    assert.deepEqual(blocked, []);
  }
  console.log('Highlands map: five contours, stationary dot, forward and reverse bearings.');
} finally {
  await browser.close();
}
