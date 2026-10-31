// SnapTiles side of the corpus geometry probe (tools/orig-harness/rc_geom_corpus.sh):
//   bun tools/geom-compare.ts <runs/geom dir>
// For every model in index.tsv that has an original dump, writes snap/<n>.g1.csv (after the first frame) and
// snap/<n>.g30.csv (after 30 frames) with the same columns as harness_geom2.rcs; load failures go to snap/<n>.err.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const dir = process.argv[2];
const SNAP = process.env.SNAP_DIR ?? 'snap'; // write a variant's replays elsewhere
mkdirSync(`${dir}/${SNAP}`, { recursive: true });
(globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
const R = await initRapier();
const f4 = (x: number) => x.toFixed(4);
for (const line of readFileSync(`${dir}/index.tsv`, 'utf8').split('\n').filter(Boolean)) {
  const n = line.split('\t')[0];
  if (!existsSync(`${dir}/${n}.g30.csv`)) continue;
  let sim: Simulation | null = null;
  try {
    sim = new Simulation(R, readFileSync(`${dir}/models/${n}.txt`, 'utf8'), new KeyState(new EventTarget()));
    await sim.start();
    const api = sim.api() as Record<string, (n: number, k?: string) => number>;
    const dump = () => ['chip,type,dir,parent,x,y,z,ex,ey,ez', ...sim!.assembly!.tiles.map((t) => {
      const c = t.chipIndex;
      return [c, api._TYPE(c), api._DIR?.(c) ?? '', api._PARENT?.(c) ?? '', f4(api._X(c)), f4(api._Y(c)), f4(api._Z(c)), f4(api._EX(c)), f4(api._EY(c)), f4(api._EZ(c))].join(',');
    })].join('\n') + '\n';
    sim.step();
    writeFileSync(`${dir}/${SNAP}/${n}.g1.csv`, dump());
    for (let i = 1; i < 30; i++) sim.step();
    writeFileSync(`${dir}/${SNAP}/${n}.g30.csv`, dump());
  } catch (e) {
    writeFileSync(`${dir}/${SNAP}/${n}.err`, String(e instanceof Error ? e.message : e));
  } finally {
    if (sim) await sim.dispose();
  }
}
console.log('done');
process.exit(0); // rapier's wasm can keep bun alive after the last dispose
