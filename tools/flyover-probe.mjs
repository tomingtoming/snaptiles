import { verifyCourseReplay } from './verify-course-replay.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(process.argv[2] + '#plane&c=pass-flyover');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'pass-flyover');
  assert.match(await page.textContent('#challenge-banner'), /高度8〜26m/);
  await page.focus('#view');
  await page.waitForFunction(() => window.__sim.frame >= 45);
  await page.keyboard.down('z');
  await page.waitForFunction(() => window.__sim.env('THROTTLE') === 60000);
  await page.keyboard.up('z');
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__sim.checkpointPassed);
  assert.match(await page.textContent('#challenge-banner'), /高度14〜38m/);
  await page.waitForFunction(() => document.getElementById('challenge-result').open);
  await page.keyboard.up('ArrowDown');
  assert.match(await page.textContent('#challenge-result-title'), /クリア！ 峠の空路/);
  console.log('Flyover: stock plane cleared both altitude gates:', await page.textContent('#challenge-result-body'));

  await page.goto(process.argv[2] + '#plane&c=highland-bank');
  await page.waitForFunction(() => window.__sim?.scenario?.id === 'highland-bank');
  assert.equal(await page.isVisible('#challenge-result'), false);
  await page.focus('#view');
  await page.waitForFunction(() => window.__sim.frame >= 45);
  await page.keyboard.down('z');
  await page.waitForFunction(() => window.__sim.env('THROTTLE') === 60000);
  await page.keyboard.up('z');
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__sim.checkpointPassed);
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => document.getElementById('challenge-result').open, null, { timeout: 25000 });
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  assert.match(await page.textContent('#challenge-result-title'), /クリア！ 四峰高原の旋回飛行/);
  const time = (await page.locator('#challenge-result-body dd').first().textContent()).split(' ')[0];
  await page.click('#challenge-copy');
  await page.waitForFunction(() => document.getElementById('challenge-result-status').textContent.includes('コピーしました'));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await verifyCourseReplay(link, time);
  console.log('Highland bank: turned at the yellow gate and reached the northeast airspace:', await page.textContent('#challenge-result-body'));
} finally {
  await browser.close();
}
