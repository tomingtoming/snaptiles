// Drive a built-in sample headless: bun tools/sample-probe.ts <car|plane|walker|hover|tank> <key> [frames] [tuneJson]
// Holds the key after 30 settling frames and prints the core displacement, speed and up-vector.
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';
import { SAMPLES } from '../src/samples/index';

const [name, keyArg = '0', framesArg = '180', tuneArg] = process.argv.slice(2);
if (tuneArg) (globalThis as unknown as { __tune?: unknown }).__tune = JSON.parse(tuneArg);
const sample = (SAMPLES as unknown as Record<string, unknown>[]).find((s) => Object.values(s).includes(name));
const src = sample ? (Object.values(sample).find((v) => typeof v === 'string' && v.length > 200) as string | undefined) : undefined;
if (!src) throw new Error(`unknown sample ${name}`);
const R = await initRapier();
const keys = new KeyState(new EventTarget());
const sim = new Simulation(R, src, keys);
await sim.start();
for (let i = 0; i < 30; i++) sim.step();
const p0 = sim.corePosition().clone();
keys.press(Number(keyArg));
const frames = Number(framesArg);
let prev = p0.clone();
for (let i = 1; i <= frames; i++) {
  sim.step();
  if (i % 60 === 0) {
    const p = sim.corePosition();
    const q = sim.physics.pose(sim.physics.tiles[0]).quaternion;
    const up = 1 - 2 * (q.x * q.x + q.z * q.z);
    console.log(`f${i} dz=${(p.z - p0.z).toFixed(2)} dx=${(p.x - p0.x).toFixed(2)} y=${p.y.toFixed(2)} v=${(p.distanceTo(prev) * 0.5).toFixed(2)} up=${up.toFixed(2)} err=${sim.scriptError ?? ''}`);
    prev = p.clone();
  }
}
await sim.lua.dispose();
