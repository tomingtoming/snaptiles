// node tools/delta-probe.mjs <file> <phase1 keys:ms> <phase2 keys:ms> <jsExpr>
// Holds phase1 keys, evaluates expr, adds phase2 keys (phase1 still held), evaluates again.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, p1, p2, expr] = process.argv.slice(2);
const buf = readFileSync(file);
let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
if (process.env.TUNE) await page.evaluate((c) => { window.__tune = c; }, JSON.parse(process.env.TUNE));
await page.fill('#source', text);
await page.click('#run');
await page.waitForTimeout(1200);
await page.focus('#view');
const hold = async (spec) => { const [codes, ms] = spec.split(':'); for (const c of codes.split('+')) await page.keyboard.down(c); await page.waitForTimeout(Number(ms)); return codes.split('+'); };
const k1 = await hold(p1);
const before = await page.evaluate(expr);
const k2 = await hold(p2);
const after = await page.evaluate(expr);
for (const c of [...k1, ...k2]) await page.keyboard.up(c);
console.log(JSON.stringify({ before, after }));
await browser.close();
