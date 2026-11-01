// Physics oracle for the Rust core (core/PORT.md, stage 2a): the TypeScript PhysicsWorld run on every corpus model
// without its script, as JSON for core/tests/physics_oracle.rs.   bun tools/export-physics-oracle.ts [outDir]
//
// Load as Simulation.start does: Vals keyed by upper-case name at their defaults (a later declaration of the same name
// wins), assemble with no chip names yet, then chip names join the environment and the world is built at the default
// spawn. No script runs, so the Vals never change. Bare ground (__tune.noCourse). Each 1/30 s frame is two
// applyControls + step pairs, as in Simulation.step. Recorded: the core (tile 0) pose position, its body's linear
// velocity, its pose quaternion and 'YXZ' Euler angles after every frame, and every tile's pose position after the
// build (frame 0) and after frames 1 and 30.
//
// A second run ("drive") moves the Vals to exercise servos, wheels and jets: from frame DRIVE_AT on, every Val takes
// its max (when that is at most 1e5 and differs from the default), else its min (same rule), else keeps its default.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { parseRc } from '../src/rc/parser';
import { assemble } from '../src/model/assemble';
import { initRapier, PhysicsWorld } from '../src/physics/world';

const GEOM = 'D:/snaptiles-models/quarantine/original/runs/geom';
const OUT = resolve(process.argv[2] ?? 'D:/snaptiles-models/quarantine/oracle-physics');
const FRAMES = 300;
const DRIVE_AT = 100;
mkdirSync(OUT, { recursive: true });
(globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
const R = await initRapier();

function run(name: string, sourcePath: string, origin: string, drive: boolean) {
  const out: Record<string, unknown> = { name, source: sourcePath, origin, frames: FRAMES, driveAt: DRIVE_AT };
  let physics: PhysicsWorld | null = null;
  try {
    const model = parseRc(readFileSync(sourcePath, 'utf8'));
    const vals = new Map<string, number>();
    for (const v of model.vals) vals.set(v.name.toUpperCase(), v.default);
    const chipNames = new Map<string, number>();
    const env = (n: string) => vals.get(n.toUpperCase()) ?? chipNames.get(n.toUpperCase());
    const a = assemble(model, env);
    if (!a) { out.error = 'Body section is missing'; return out; }
    for (const t of a.tiles) if (t.name) chipNames.set(t.name, t.chipIndex);
    physics = new PhysicsWorld(R);
    physics.build(a, env);
    const p = physics;
    const tiles = () => p.tiles.map((tb) => p.pose(tb).position.toArray());
    out.tileCount = p.tiles.length;
    out.tiles0 = tiles();
    const core: number[][] = [];
    for (let f = 1; f <= FRAMES; f++) {
      if (drive && f === DRIVE_AT) for (const v of model.vals) {
        const k = v.name.toUpperCase();
        if (v.max <= 1e5 && v.max !== v.default) vals.set(k, v.max);
        else if (v.min >= -1e5 && v.min !== v.default) vals.set(k, v.min);
      }
      for (let i = 0; i < 2; i++) { p.applyControls(env); p.step(); }
      const tb = p.tiles[0];
      const pose = p.pose(tb);
      const v = tb.body.linvel();
      const e = new THREE.Euler().setFromQuaternion(pose.quaternion, 'YXZ');
      const q = pose.quaternion;
      core.push([...pose.position.toArray(), v.x, v.y, v.z, e.x, e.y, e.z, q.x, q.y, q.z, q.w]);
      if (f === 1) out.tiles1 = tiles();
      if (f === 30) out.tiles30 = tiles();
    }
    out.core = core;
  } catch (e) {
    out.error = (e as Error).message;
  } finally {
    physics?.world.free();
  }
  return out;
}

let count = 0;
const t0 = performance.now();
for (const row of readFileSync(join(GEOM, 'index.tsv'), 'utf8').split(/\r?\n/)) {
  if (!row.trim()) continue;
  const [n, path] = row.split('\t');
  const src = join(GEOM, 'models', `${n}.txt`).replace(/\\/g, '/');
  // JSON writes NaN as null; the Rust side treats null as non-finite
  const rest = run(n, src, path, false);
  const driven = run(n, src, path, true);
  rest.drive = driven.core;
  writeFileSync(join(OUT, `${n}.json`), JSON.stringify(rest));
  count++;
}
console.log(`wrote ${count} physics oracle files to ${OUT} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
