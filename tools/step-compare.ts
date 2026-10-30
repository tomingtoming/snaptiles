// Replay the original's step probe (tools/orig-harness/rc_step.sh) in SnapTiles, headless:
//   bun tools/step-compare.ts <model.txt> <out.csv> --h=0.10 [--frames=450]
// Bare ground plus a static box h m tall spanning x −10..10, z 6..36 (the probe land, without its 50 m
// base height). The model drives itself (Val defaults). Columns match harness_step.rcs: core pose,
// velocity, Euler, then y, z and _WY of the first four Wheel/RLW chips.
import { readFileSync, writeFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => Number(args.find((x) => x.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const H = opt('h', 0.1), FRAMES = opt('frames', 450);
(globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };

const R = await initRapier();
const sim = new Simulation(R, readFileSync(args[0], 'utf8'), new KeyState(new EventTarget()));
await sim.start();
// same membership/filter as the course colliders (physics/world.ts GROUND_GROUP)
sim.physics.world.createCollider(R.ColliderDesc.cuboid(10, H / 2, 15).setTranslation(0, H / 2, 21).setFriction(1.0).setCollisionGroups(0x0002_0007));
const api = sim.api() as Record<string, (n: number) => number>;
const wheels = sim.assembly!.tiles.filter((t) => t.spec.wheel).map((t) => t.chipIndex).sort((a, b) => a - b).slice(0, 4);
const rows = ['frame,x,y,z,vx,vy,vz,ex,ey,ez,w0y,w0z,w0wy,w1y,w1z,w1wy,w2y,w2z,w2wy,w3y,w3z,w3wy'];
for (let n = 1; n <= FRAMES; n++) {
  sim.step();
  const row = [n, api._X(0), api._Y(0), api._Z(0), api._VX(0), api._VY(0), api._VZ(0), api._EX(0), api._EY(0), api._EZ(0)];
  for (let i = 0; i < 4; i++) { const c = wheels[i]; row.push(...(c === undefined ? [0, 0, 0] : [api._Y(c), api._Z(c), api._WY(c)])); }
  rows.push(row.join(','));
}
writeFileSync(args[1], rows.join('\n') + '\n');
await sim.dispose();
