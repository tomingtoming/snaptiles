import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
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
} finally {
  await browser.close();
}
