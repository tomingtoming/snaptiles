// Replay a terrain probe (tools/orig-harness/rc_terrain.sh) in SnapTiles, headless:
//   bun tools/terrain-compare.ts <scene|all> <out-dir> [--model=tools/orig-harness/basic_drive_2500.txt] [--frames=450] [--tune='{…}']
// Builds the scene of tools/orig-harness/terrains.json in place of the default ground (boxes as cuboids, ramps
// as convex wedges, same membership as the course) and drives the model by its Val defaults. Columns match
// harness_step.rcs: core pose, velocity, Euler, then y, z and _WY of the first four Wheel/RLW chips.
import { readFileSync, writeFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

type Box = [number, number, number, number, number, number];
const args = process.argv.slice(2);
const opt = (k: string) => args.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3);
const spec = JSON.parse(readFileSync(new URL('./orig-harness/terrains.json', import.meta.url), 'utf8'));
const model = readFileSync(opt('model') ?? 'tools/orig-harness/basic_drive_2500.txt', 'utf8');
const FRAMES = Number(opt('frames') ?? 450);
const scenes = args[0] === 'all' ? Object.keys(spec.scenes) : [args[0]];
const R = await initRapier();
const GROUND = 0x0002_0007;

for (const name of scenes) {
  const scene = spec.scenes[name];
  (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true, ...(opt('tune') ? JSON.parse(opt('tune')!) : {}) };
  const sim = new Simulation(R, model, new KeyState(new EventTarget()));
  await sim.start();
  const world = sim.physics.world;
  // replace the default 4000 m ground slab with the scene's ground
  const old: RAPIER_Collider[] = [];
  world.forEachCollider((c) => { if (!c.parent() && c.halfExtents?.()?.x === 2000) old.push(c); });
  for (const c of old) world.removeCollider(c, false);
  const grounds: Box[] = scene.ground ?? [spec.ground];
  const box = ([x0, x1, y0, y1, z0, z1]: Box) => world.createCollider(R.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
    .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).setFriction(1).setCollisionGroups(GROUND));
  for (const g of (Array.isArray(grounds[0]) ? grounds : [grounds as unknown as Box])) box(g as Box);
  for (const s of scene.solids) {
    if (s.box) box(s.box);
    else {
      // slope and plateau as one convex solid (a seam between two colliders catches the wheels at the crest)
      const [x0, x1, z0, z1, h, zEnd] = s.ramp as number[];
      const pts = new Float32Array([x0, 0, z0, x1, 0, z0, x0, 0, zEnd, x1, 0, zEnd, x0, h, z1, x1, h, z1, x0, h, zEnd, x1, h, zEnd]);
      world.createCollider(R.ColliderDesc.convexHull(pts)!.setFriction(1).setCollisionGroups(GROUND));
    }
  }
  const api = sim.api() as Record<string, (n: number) => number>;
  const wheels = sim.assembly!.tiles.filter((t) => t.spec.wheel).map((t) => t.chipIndex).sort((a, b) => a - b).slice(0, 4);
  const rows = ['frame,x,y,z,vx,vy,vz,ex,ey,ez,w0y,w0z,w0wy,w1y,w1z,w1wy,w2y,w2z,w2wy,w3y,w3z,w3wy'];
  for (let n = 1; n <= FRAMES; n++) {
    sim.step();
    const row = [n, api._X(0), api._Y(0), api._Z(0), api._VX(0), api._VY(0), api._VZ(0), api._EX(0), api._EY(0), api._EZ(0)];
    for (let i = 0; i < 4; i++) { const c = wheels[i]; row.push(...(c === undefined ? [0, 0, 0] : [api._Y(c), api._Z(c), api._WY(c)])); }
    rows.push(row.join(','));
  }
  writeFileSync(`${args[1]}/${name}_p2500.csv`, rows.join('\n') + '\n');
  await sim.dispose();
  console.log(name, 'done');
}
type RAPIER_Collider = Parameters<Parameters<InstanceType<typeof R.World>['forEachCollider']>[0]>[0];
