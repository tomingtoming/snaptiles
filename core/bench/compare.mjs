// Prototype check: the Rust core (Emscripten) against the current stack (rapier3d-compat + wasmoon) on the same
// scene: N boxes dropped in a grid, a Lua OnFrame reading _Y of every box and writing out(). Per-frame time.
//   node core/bench/compare.mjs [N] [frames]
import SnapTilesCore from '../pkg/snaptiles_core.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { LuaFactory } from 'wasmoon';
const N = Number(process.argv[2] ?? 200), FRAMES = Number(process.argv[3] ?? 600);
const grid = (i) => [(i % 20) * 0.7 - 7, 1 + Math.floor(i / 400) * 0.5, (Math.floor(i / 20) % 20) * 0.7 - 7];
const script = `function OnFrame() local s = 0 for i = 0, ${N - 1} do s = s + _Y(i) end out(0, "sum ", s) end`;

// ---- Rust core
const m = await SnapTilesCore();
for (let i = 0; i < N; i++) { const [x, y, z] = grid(i); m._core_add_box(x, y + 3, z, 0.3, 0.015, 0.3, 25.2); }
const bytes = new TextEncoder().encode(script), p = m._malloc(bytes.length);
m.HEAPU8.set(bytes, p);
if (m._core_load_lua(p, bytes.length, 0) !== 0) throw new Error(m.UTF8ToString(m._core_error()));
m._free(p);
if (!process.env.NOWARM) m._core_step_n(30); // warm up (NOWARM=1 times the falling phase)
let t0 = performance.now();
for (let f = 0; f < FRAMES; f++) m._core_step();
const rustMs = (performance.now() - t0) / FRAMES;
const state = new Float64Array(m.HEAPF64.buffer, m._core_state_ptr(), m._core_state_len());
const rustY = Array.from({ length: N }, (_, i) => state[i * 7 + 1]);
const rustOut = m.UTF8ToString(m._core_out());

// ---- current stack: rapier3d-compat + wasmoon, same settings and order (Lua, then two 1/60 s steps)
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.8, z: 0 });
world.numSolverIterations = 1; world.integrationParameters.numInternalPgsIterations = 48;
world.createCollider(RAPIER.ColliderDesc.cuboid(100000, 1, 100000).setTranslation(0, -1, 0).setFriction(1));
const bodies = [];
for (let i = 0; i < N; i++) {
  const [x, y, z] = grid(i);
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + 3, z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.015, 0.3).setMass(25.2), b);
  bodies.push(b);
}
const lua = await new LuaFactory().createEngine();
let jsOut = '';
lua.global.set('_Y', (i) => bodies[i]?.translation().y ?? 0);
lua.global.set('out', (row, ...a) => { jsOut = a.map((v) => typeof v === 'number' ? v.toFixed(2) : String(v)).join(''); });
await lua.doString(script);
const onFrame = lua.global.get('OnFrame');
const frame = () => { onFrame(); for (let s = 0; s < 2; s++) { world.timestep = 1 / 60; world.step(); } };
if (!process.env.NOWARM) for (let f = 0; f < 30; f++) frame();
t0 = performance.now();
for (let f = 0; f < FRAMES; f++) frame();
const jsMs = (performance.now() - t0) / FRAMES;
const jsY = bodies.map((b) => b.translation().y);

const maxDiff = Math.max(...rustY.map((y, i) => Math.abs(y - jsY[i])));
console.log(JSON.stringify({ N, FRAMES, rustMsPerFrame: +rustMs.toFixed(3), currentMsPerFrame: +jsMs.toFixed(3), speedup: +(jsMs / rustMs).toFixed(2), rustOut, jsOut, restY: { rust: +rustY[0].toFixed(4), current: +jsY[0].toFixed(4) }, maxYDiff: +maxDiff.toFixed(4) }));
process.exit(0);
