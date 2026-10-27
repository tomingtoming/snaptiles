// Check that the synthesized sounds react: node tools/sfx-probe.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const state = () => page.evaluate(() => {
  const s = window.__sfx;
  const ctx = s.ctx;
  return ctx ? { ctxState: ctx.state, engine: +s.engineGain.gain.value.toFixed(3), engineHz: Math.round(s.engineOsc.frequency.value), jet: +s.jetGain.gain.value.toFixed(3), muted: s.muted } : { ctxState: 'none' };
});
await page.goto('http://127.0.0.1:5173/#car', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
console.log('before gesture', JSON.stringify(await state()));
await page.focus('#view');
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(2500);
console.log('car driving   ', JSON.stringify(await state()));
await page.keyboard.up('ArrowUp');
await page.goto('http://127.0.0.1:5173/#hover', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.focus('#view');
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(1500);
console.log('hover flying  ', JSON.stringify(await state()));
await page.keyboard.up('ArrowUp');
await page.click('#mute');
await page.waitForTimeout(300);
console.log('after mute    ', JSON.stringify(await state()));
await browser.close();
