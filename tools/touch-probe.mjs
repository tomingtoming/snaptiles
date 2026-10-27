import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ hasTouch: true, viewport: { width: 900, height: 700 } });
await page.goto('http://127.0.0.1:5173/#car', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const cap = page.locator('#keys .cap').nth(1); // ↑ = ENGINE
const box = await cap.boundingBox();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 10, y: box.y + 10 }] });
await page.waitForTimeout(1500);
const during = await page.evaluate(() => document.getElementById('vals').textContent);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(800);
const after = await page.evaluate(() => document.getElementById('out').textContent);
console.log(JSON.stringify({ during, after }));
await browser.close();
