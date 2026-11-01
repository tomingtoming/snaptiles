// Browser check of the prototype core: load the Emscripten module through Vite, drop 200 boxes, run a Lua OnFrame
// that reads every box, and report time per frame and the script's output.
import SnapTilesCore from '../pkg/snaptiles_core.js';
const out = document.getElementById('out');
const t0 = performance.now();
const m = await SnapTilesCore();
const loadMs = performance.now() - t0;
const N = 200;
for (let i = 0; i < N; i++) m._core_add_box((i % 20) * 0.7 - 7, 4, Math.floor(i / 20) * 0.7 - 7, 0.3, 0.015, 0.3, 25.2);
const bytes = new TextEncoder().encode(`function OnFrame() local s = 0 for i = 0, ${N - 1} do s = s + _Y(i) end out(0, "sum ", string.format("%.2f", s)) end`);
const p = m._malloc(bytes.length); m.HEAPU8.set(bytes, p);
const loaded = m._core_load_lua(p, bytes.length, 0); m._free(p);
const t1 = performance.now();
for (let f = 0; f < 300; f++) m._core_step();
const frameMs = (performance.now() - t1) / 300;
const result = { loadMs: +loadMs.toFixed(1), loaded, frameMs: +frameMs.toFixed(3), out: m.UTF8ToString(m._core_out()), error: m.UTF8ToString(m._core_error()) };
window.__result = result;
out.textContent = JSON.stringify(result, null, 1);
