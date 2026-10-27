// Run every model file under the given directories through the app and report
// parse/script errors: node tools/corpus.mjs <url> <dir> [dir...]
import { chromium } from 'playwright';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [url, ...dirs] = process.argv.slice(2);
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(rcd|txt)$/i.test(n)) files.push(p);
  }
};
dirs.forEach(walk);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url, { waitUntil: 'networkidle' });
const rows = [];
for (const f of files) {
  const buf = readFileSync(f);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (/�/.test(text)) text = new TextDecoder('shift_jis').decode(buf);
  pageErrors.length = 0;
  await page.fill('#source', text);
  await page.click('#run');
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => {
    const sim = window.__sim;
    return {
      status: document.getElementById('status')?.textContent ?? '',
      chips: sim?.assembly?.chipCount ?? 0,
      lang: sim?.model?.script?.lang ?? '-',
      err: sim?.scriptError ?? '',
      ticks: sim?.ticks ?? 0,
    };
  });
  rows.push({ file: f.replace(/\\/g, '/').split('/').slice(-2).join('/'), ...r, pageError: pageErrors[0] ?? '' });
  const bad = r.status || r.err || pageErrors.length;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${rows.at(-1).file} chips=${r.chips} ${r.lang} ticks=${r.ticks} ${(r.status || r.err || pageErrors[0] || '').slice(0, 140)}`);
}
console.log(`\n${rows.filter((r) => !(r.status || r.err || r.pageError)).length}/${rows.length} ok`);
await browser.close();
