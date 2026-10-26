// Screenshot / probe harness: node tools/shot.mjs <url> <outPrefix> [keys...]
// keys: sequences like "ArrowUp:1500" (hold ms). Takes a screenshot after each.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [url = 'http://127.0.0.1:5173/', prefix = '.shots/shot', ...keySpecs] = process.argv.slice(2);
mkdirSync('.shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-0.png` });
let i = 1;
for (const spec of keySpecs) {
  const [code, ms = '1000'] = spec.split(':');
  await page.focus('#view');
  await page.keyboard.down(code);
  await page.waitForTimeout(Number(ms));
  await page.keyboard.up(code);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${prefix}-${i++}.png` });
}
const state = await page.evaluate(() => ({
  status: document.getElementById('status')?.textContent,
  vals: document.getElementById('vals')?.textContent,
  out: document.getElementById('out')?.textContent,
}));
console.log(JSON.stringify(state));
console.log(logs.slice(-30).join('\n'));
await browser.close();
