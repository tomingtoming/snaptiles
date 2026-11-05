import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#car');
  await page.waitForFunction(() => window.__sim);
  await page.getByRole('button', { name: 'raft', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#raft&c=inlet-float');
  await page.reload();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'inlet-float');
  assert.match(await page.inputValue('#source'), /双胴艇/);
  await page.click('#challenge-quit');
  await page.getByRole('button', { name: 'car', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#car');
  await page.click('#challenge-open');
  await page.getByRole('button', { name: /入り江の試走場/ }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'tidal-inlet');
  const car = await page.inputValue('#source');
  await page.getByRole('button', { name: '水上から落とす' }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'inlet-float');
  await page.reload();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'inlet-float');
  await page.waitForFunction(() => document.getElementById('challenge-banner-text').textContent.includes('Core 水面下'));
  assert.equal(await page.inputValue('#source'), car);
  await page.getByRole('button', { name: '岸から走る' }).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'tidal-inlet');
  await page.click('#terrain-map summary');
  const lake = page.locator('#terrain-map rect[fill="#3994b2"]');
  assert.equal(await lake.getAttribute('width'), '72');
  assert.match(await page.textContent('#challenge-banner-text'), /岸まで [\d.]+m/);
  await page.focus('#view');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => document.getElementById('challenge-banner-text').textContent.includes('Core 水面下'));
  const depthLabel = await page.textContent('#challenge-banner-text');
  assert.match(depthLabel, /水面下 [0-9]+\.[0-9]{2}m/);
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
  assert(path.some(([, y, z]) => z < -25 && y < 0));
  assert(path.every(p => p.every(Number.isFinite)));
  console.log('Stock car enters the inlet from dry ground. Lowest Core:', Math.min(...path.map(p => p[1])).toFixed(2), 'm');
} finally { await browser.close(); }
