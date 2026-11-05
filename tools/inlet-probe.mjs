import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car');
  await page.waitForFunction(() => window.__sim);
  await page.click('#challenge-open');
  await page.getByRole('button', { name: /入り江の試走場/ }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'tidal-inlet');
  await page.click('#terrain-map summary');
  const lake = page.locator('#terrain-map rect[fill="#3994b2"]');
  assert.equal(await lake.getAttribute('width'), '72');
  await page.focus('#view');
  await page.keyboard.down('ArrowUp');
  const path = await page.evaluate(() => {
    const sim = window.__sim;
    const points = [];
    for (let frame = 0; frame < 900; frame++) {
      sim.step();
      if (frame % 30 === 0) points.push(sim.corePosition().toArray());
    }
    return points;
  });
  await page.keyboard.up('ArrowUp');
  assert(path.some(([, y, z]) => z > -18 && y > 0));
  assert(path.some(([, y, z]) => z < -25 && y < 0));
  assert(path.every(p => p.every(Number.isFinite)));
  console.log('Stock car enters the inlet from dry ground. Lowest Core:', Math.min(...path.map(p => p[1])).toFixed(2), 'm');
} finally { await browser.close(); }
