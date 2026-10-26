// Screenshot / probe harness: node tools/shot.mjs <url> <outPrefix> [keys...]
// keys: "ArrowUp:1500" (hold ms) or "ArrowUp+ArrowLeft:1500" for chords. Screenshot after each.
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
// "--file=path" pastes a model file into the editor and runs it (utf-8, falling back to shift_jis)
const fileArg = keySpecs.find((k) => k.startsWith('--file='));
if (fileArg) {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(fileArg.slice(7));
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
  await page.fill('#source', text);
  await page.click('#run');
  await page.waitForTimeout(1500);
  keySpecs.splice(keySpecs.indexOf(fileArg), 1);
}
// "@name" selects a sample by its button text before the key sequence
const sampleArg = keySpecs.find((k) => k.startsWith('@'));
if (sampleArg) {
  await page.getByRole('button', { name: sampleArg.slice(1), exact: true }).click();
  await page.waitForTimeout(1500);
  keySpecs.splice(keySpecs.indexOf(sampleArg), 1);
}
await page.screenshot({ path: `${prefix}-0.png` });
let i = 1;
for (const spec of keySpecs) {
  const [codes, ms = '1000'] = spec.split(':');
  const list = codes.split('+').filter(Boolean);
  await page.focus('#view');
  for (const c of list) await page.keyboard.down(c);
  await page.waitForTimeout(Number(ms));
  for (const c of list) await page.keyboard.up(c);
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
