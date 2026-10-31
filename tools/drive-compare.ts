// SnapTiles side of the corpus driving probe (tools/orig-harness/rc_drive_corpus.sh):
//   bun tools/drive-compare.ts <runs/drive dir> <runs/geom dir> [n ...]
// For every original log <n>.<mode>.csv, replays the model (runs/geom/models/<n>.txt) on bare flat ground,
// holding key 0 exactly on the frames the original logged it held, and writes snap/<n>.<mode>.csv with the
// same columns (frame,key0,x,y,z,vx,vy,vz,ex,ey,ez,chips). Load failures go to snap/<n>.<mode>.err.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const [dir, geom, ...only] = process.argv.slice(2);
const SNAP = process.env.SNAP_DIR ?? 'snap'; // write a variant's replays elsewhere
mkdirSync(`${dir}/${SNAP}`, { recursive: true });
(globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
const R = await initRapier();
const logs = readdirSync(dir).filter((f) => /^\d+\.(idle|up)\.csv$/.test(f)).filter((f) => !only.length || only.includes(f.split('.')[0]));
for (const file of logs) {
  const [n, mode] = file.split('.');
  const out = `${dir}/${SNAP}/${n}.${mode}.csv`;
  if (existsSync(out)) continue;
  const orig = readFileSync(`${dir}/${file}`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const held = new Set(orig.filter((r) => Number(r[1]) === 1).map((r) => Number(r[0])));
  const keys = new KeyState(new EventTarget());
  let sim: Simulation | null = null;
  try {
    sim = new Simulation(R, readFileSync(`${geom}/models/${n}.txt`, 'utf8'), keys);
    await sim.start();
    const api = sim.api() as Record<string, (n: number) => number>;
    const rows = ['frame,key0,x,y,z,vx,vy,vz,ex,ey,ez,chips'];
    for (let f = 1; f <= 600; f++) {
      keys.down.clear();
      if (held.has(f)) keys.down.add(0);
      sim.step();
      rows.push([f, held.has(f) ? 1 : 0, api._X(0), api._Y(0), api._Z(0), api._VX(0), api._VY(0), api._VZ(0), api._EX(0), api._EY(0), api._EZ(0), api._CHIPS()].join(','));
    }
    writeFileSync(out, rows.join('\n') + '\n');
  } catch (e) {
    writeFileSync(`${dir}/${SNAP}/${n}.${mode}.err`, String(e instanceof Error ? e.message : e));
  } finally {
    if (sim) await sim.dispose();
  }
}
console.log('done', logs.length);
process.exit(0); // rapier's wasm can keep bun alive after the last dispose
