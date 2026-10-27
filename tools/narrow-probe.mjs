import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto('http://127.0.0.1:5173/#car', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '.shots/narrow.png' });
await browser.close();
