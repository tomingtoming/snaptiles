// Pinch-zoom check with two synthetic touches: node tools/pinch-probe.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:5173/#car', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const cdp = await page.context().newCDPSession(page);
const before = await page.evaluate(() => window.__scene.camDist);
const pts = (d) => [{ x: 195 - d, y: 300 }, { x: 195 + d, y: 300 }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
for (let d = 45; d <= 120; d += 15) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await page.waitForTimeout(30);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const after = await page.evaluate(() => window.__scene.camDist);
console.log(JSON.stringify({ before, after }));
await browser.close();
