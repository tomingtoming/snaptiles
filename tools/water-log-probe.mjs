import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(process.argv[2] + '#raft&c=tow-basin');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'tow-basin');
  await page.click('#water-log');
  const dialog = page.locator('#water-log-dialog');
  const rows = dialog.locator('tbody tr');
  assert.equal(await rows.count(), 6);
  assert.equal(await rows.first().locator('td').first().textContent(), '—');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await page.focus('#view');
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => {
    const sim = window.__sim;
    for (let i = 0; i < 750 && sim.waterPasses.size < 6; i++) sim.step();
  });
  await page.keyboard.up('ArrowUp');
  await page.click('#water-log');
  const table = await rows.allTextContents();
  assert(table.every(row => row.includes('秒') && row.includes('km/h')));
  assert.match(table.at(-1), /^150 m/);
  assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
  await dialog.getByRole('button', { name: 'この走行を基準にする' }).click();
  assert.match(await page.textContent('#water-reference-label'), /raft（6地点）/);
  assert.equal(await rows.last().locator('small').first().textContent(), '0.00 秒');
  console.log('Water station log:', table);
  await dialog.getByRole('button', { name: '閉じる' }).click();
  const slow = (await page.inputValue('#source')).replace('max=3600', 'max=1200');
  await page.fill('#source', slow);
  await page.focus('#source');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__sim?.model.vals.some(v => v.name === 'THRUST' && v.max === 1200));
  await page.focus('#view');
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => {
    const sim = window.__sim;
    for (let i = 0; i < 1300 && sim.waterPasses.size < 6; i++) sim.step();
  });
  await page.keyboard.up('ArrowUp');
  await page.click('#water-log');
  const changes = await rows.last().locator('small').allTextContents();
  assert(Number.parseFloat(changes[0]) > 4, 'lower thrust takes longer');
  assert(Number.parseFloat(changes[1]) < -9, 'lower thrust reduces crossing speed');
  console.log('150 m, lower thrust versus reference:', changes);
  await dialog.getByRole('button', { name: '基準を外す' }).click();
  assert.equal(await rows.locator('small').count(), 0);
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await page.click('#challenge-quit');
  assert(await page.locator('#water-log').isHidden());
} finally { await browser.close(); }
