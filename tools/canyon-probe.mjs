import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] + '#plane');
  await page.waitForFunction(() => window.__sim);
  await page.click('#challenge-open');
  await page.getByRole('button', {name: /峡谷の飛行場/}).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'canyon-airfield' && window.__sim.frame >= 45);
  await page.click('#terrain-map summary');
  assert.match(await page.textContent('#terrain-map'), /等高線 10m/);
  await page.focus('#view');
  const entrance = await page.evaluate(() => {
    const sim = window.__sim, view = document.querySelector('#view');
    const key = (code, key, down) => view.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code,key,bubbles:true}));
    key('KeyZ','z',true);
    for (let n = 0; n < 150 && sim.env('THROTTLE') < 60000; n++) sim.step();
    key('KeyZ','z',false);
    key('ArrowDown','ArrowDown',true);
    for (let n = 0; n < 900 && sim.corePosition().z > -120; n++) sim.step();
    key('ArrowDown','ArrowDown',false);
    return { x:sim.corePosition().x, z:sim.corePosition().z, y:sim.corePosition().y, clearance:sim.api()._H(0) };
  });
  assert.ok(entrance.z <= -120 && Math.abs(entrance.x) < 24 && entrance.clearance > 2 && entrance.y < 45, JSON.stringify(entrance));
  console.log('Stock plane at canyon entrance', entrance);
  await page.click('#challenge-open');
  await page.getByRole('button', {name:/峡谷の低空飛行/}).click();
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'canyon-run');
  await page.waitForFunction(() => document.querySelectorAll('#terrain-map circle[aria-label^="リング"]').length === 3);
  assert.match(await page.textContent('#challenge-banner-text'), /リング 1 \/ 3/);
} finally { await browser.close(); }
