// Times both simulation cores in Chromium on the built page (dist): initial load (navigation → first model running,
// and the page's own load split `__loadTimes` = [construct, start, scene]) and the per-frame step time of
// `__sim.step()` on samples, with ArrowUp held. Usage: bun run build && node tools/core-bench.mjs [frames] [samples…]
import { preview } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const frames = Number(process.argv[2] ?? 600);
const samples = process.argv.length > 3 ? process.argv.slice(3) : ['car', 'walker', 'plane'];
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const rows = [];
  for (const core of ['ts', 'rust']) {
    for (const sample of samples) {
      const page = await browser.newPage();
      const t0 = Date.now();
      await page.goto(`${base}?core=${core}#${sample}`);
      await page.waitForFunction(() => window.__sim && window.__sim.ticks > 0);
      const ready = Date.now() - t0;
      const r = await page.evaluate(async (n) => {
        const s = window.__sim;
        await new Promise((res) => requestAnimationFrame(res));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
        for (let i = 0; i < 30; i++) s.step(); // warm-up
        const ts = [];
        for (let i = 0; i < n; i++) { const a = performance.now(); s.step(); ts.push(performance.now() - a); }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
        ts.sort((a, b) => a - b);
        return { mean: ts.reduce((a, b) => a + b, 0) / n, median: ts[n >> 1], p95: ts[Math.floor(n * 0.95)], load: window.__loadTimes, core: document.documentElement.dataset.core, tiles: s.physics.tiles.length, y: s.corePosition().y };
      }, frames);
      rows.push({ core: r.core, sample, tiles: r.tiles, readyMs: ready, loadTimes: r.load.join('/'), meanMs: +r.mean.toFixed(3), medianMs: +r.median.toFixed(3), p95Ms: +r.p95.toFixed(3), coreY: +r.y.toFixed(2) });
      await page.close();
    }
  }
  console.table(rows);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
