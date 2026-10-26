// Download a getuploader file by pressing its download button: node tools/fetch-model.mjs <pageUrl> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [url, outDir = '.'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ acceptDownloads: true });
await page.goto(url, { waitUntil: 'domcontentloaded' });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('form[name="agree"] input[type="submit"]')]);
const name = dl.suggestedFilename();
await dl.saveAs(join(outDir, name));
console.log('saved', join(outDir, name));
await browser.close();
