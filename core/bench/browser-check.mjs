// Loads core/bench/browser.html through the Vite dev server and a production build of that page in Chromium.
//   node core/bench/browser-check.mjs
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
import {chromium} from 'playwright';
import {createServer, build, preview} from 'vite';
const results = {};
const visit = async (url) => { const b = await chromium.launch(); try { const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); await p.goto(url); await p.waitForFunction(() => window.__result, null, {timeout: 60000}); return {...await p.evaluate(() => window.__result), errs}; } finally { await b.close(); } };
// dev server
const dev = await createServer({root: ROOT + '', server: {host: '127.0.0.1', port: 0, strictPort: true}, logLevel: 'silent'});
await dev.listen(); results.dev = await visit(`http://127.0.0.1:${dev.httpServer.address().port}/core/bench/browser.html`); await dev.close();
// production build of the page alone
await build({root: ROOT + '', logLevel: 'silent', build: {outDir: ROOT + '/core/bench/dist', emptyOutDir: true, rollupOptions: {input: ROOT + '/core/bench/browser.html'}}});
const pv = await preview({root: ROOT + '', build: {outDir: ROOT + '/core/bench/dist'}, preview: {host: '127.0.0.1', port: 0, strictPort: true}, logLevel: 'silent'});
results.build = await visit(`http://127.0.0.1:${pv.httpServer.address().port}/core/bench/browser.html`); pv.httpServer.close();
console.log(JSON.stringify(results, null, 1)); process.exit(0);
