// Which colliding tiles touch the ground? bun tools/lowest-corner.ts <model> [frames] [tuneJson]
// For every colliding tile prints the lowest corner of its plate (or the bottom of a tyre sphere).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { initRapier, wheelRadius } from '../src/physics/world';
import { TILE, TILE_T } from '../src/model/assemble';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const [file, framesArg = '30', tuneArg] = process.argv.slice(2);
if (tuneArg) (globalThis as unknown as { __tune?: unknown }).__tune = JSON.parse(tuneArg);
const buf = readFileSync(file);
let src = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(src)) src = new TextDecoder('shift_jis').decode(buf);
const R = await initRapier();
const sim = new Simulation(R, src, new KeyState(new EventTarget()));
await sim.start();
for (let n = 0; n < Number(framesArg); n++) sim.step();
const rows: { y: number; what: string }[] = [];
for (const tb of sim.physics.tiles) {
  const t = tb.tile;
  if (!t.spec.collides || t.ghost) continue;
  const pose = sim.physics.pose(tb);
  if (t.spec.wheel) {
    rows.push({ y: pose.position.y - wheelRadius(t.option), what: `${t.type}#${t.chipIndex} (tyre bottom)` });
    continue;
  }
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Vector3((sx * TILE) / 2, (sy * TILE_T) / 2, (sz * TILE) / 2).applyQuaternion(pose.quaternion).add(pose.position);
    min = Math.min(min, c.y);
  }
  rows.push({ y: min, what: `${t.type}#${t.chipIndex} center y=${pose.position.y.toFixed(3)}` });
}
rows.sort((a, b) => a.y - b.y);
for (const r of rows.slice(0, 10)) console.log(r.y.toFixed(3), r.what);
await sim.lua.dispose();
