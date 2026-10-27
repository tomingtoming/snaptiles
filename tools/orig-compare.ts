// Replay the original-exe measurement harness in SnapTiles (headless):
//   bun tools/orig-compare.ts <model.txt> <out.csv> [--allwheels] [--power=2500] [--on=31] [--off=150] [--frames=330] [--tune='{"wheelFriction":1}']
// Every frame in [on, off] the Val ENGINE is forced to `power` (the harness scenario in the original sets
// POWER on every wheel; pass --allwheels to give the Basic car's front wheels power=±Engine too).
// Prints the same columns as the original's log.txt: frame,x,y,z,vx,vy,vz,ex,ey,ez,chips,wheel,wheelpow,wheelwy,wheely
import { readFileSync, writeFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const args = process.argv.slice(2);
const file = args[0];
const outFile = args[1] ?? 'orig-compare.csv';
const opt = (k: string, d: number) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const allWheels = args.includes('--allwheels');
const POWER = opt('power', 2500);
const ON = opt('on', 31);
const OFF = opt('off', 150);
const FRAMES = opt('frames', 330);
const GEOM_AT = opt('geomAt', 30);
const CHIPS6 = args.includes('--chips6'); // log chips 0..5 (x,y,z,ex,ey,ez) per frame instead, like harness_servo.rcs
const tuneArg = args.find((x) => x.startsWith('--tune='));
if (tuneArg) (globalThis as unknown as { __tune?: unknown }).__tune = JSON.parse(tuneArg.slice(7)); // same knobs as window.__tune (merged over TUNE_DEFAULTS)

const buf = readFileSync(file);
let src = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(src)) src = new TextDecoder('shift_jis').decode(buf);
if (allWheels) {
  src = src.replace(/W:Wheel\(angle=90,brake=Brake\)/g, 'W:Wheel(angle=90,power=Engine,brake=Brake)');
  src = src.replace(/E:Wheel\(angle=90,brake=Brake\)/g, 'E:Wheel(angle=90,power=-Engine,brake=Brake)');
}

const R = await initRapier();
const keys = new KeyState(new EventTarget());
const sim = new Simulation(R, src, keys);
await sim.start();
const api = sim.api() as Record<string, (n: number) => number>;
const wheelTile = sim.assembly!.tiles.find((t) => t.spec.wheel);
const wheelNo = wheelTile ? wheelTile.chipIndex : -1;
const f4 = (x: number) => x.toFixed(4);
const geomDump = (): string => {
  const g = ['chip,type,dir,parent,x,y,z,ex,ey,ez'];
  for (const t of sim.assembly!.tiles) {
    const n = t.chipIndex;
    g.push([n, api._TYPE(n), api._DIR?.(n) ?? '', api._PARENT?.(n) ?? '', f4(api._X(n)), f4(api._Y(n)), f4(api._Z(n)), f4(api._EX(n)), f4(api._EY(n)), f4(api._EZ(n))].join(','));
  }
  return g.join('\n') + '\n';
};
const engine = sim.vals.get('ENGINE');
if (!engine && !CHIPS6) throw new Error('model has no ENGINE val');
const rows: string[] = [CHIPS6 ? 'frame,' + [0, 1, 2, 3, 4, 5].map((c) => `x${c},y${c},z${c},ex${c},ey${c},ez${c}`).join(',') : 'frame,x,y,z,vx,vy,vz,ex,ey,ez,chips,wheel,wheelpow,wheelwy,wheely'];
let prev = sim.corePosition().clone();
for (let n = 1; n <= FRAMES; n++) {
  const p = n >= ON && n <= OFF ? POWER : 0;
  if (engine) { engine.default = p; engine.value = p; }
  sim.step();
  if (CHIPS6) {
    const m = api._CHIPS(0) - 1;
    rows.push([n, ...[0, 1, 2, 3, 4, 5].map((c) => (c <= m ? [api._X(c), api._Y(c), api._Z(c), api._EX(c), api._EY(c), api._EZ(c)].map(f4).join(',') : ',,,,,'))].join(','));
    continue;
  }
  if (n === GEOM_AT) {
    const g = geomDump();
    writeFileSync(outFile.replace(/\.csv$/, '') + '.geom.csv', g);
    console.log(g);
  }
  const c = sim.corePosition();
  const v = c.clone().sub(prev).multiplyScalar(30);
  prev = c.clone();
  const f = (x: number) => x.toFixed(4);
  rows.push(
    [n, f(c.x), f(c.y), f(c.z), f(v.x), f(v.y), f(v.z), f(api._EX(0)), f(api._EY(0)), f(api._EZ(0)),
      api._CHIPS(0), wheelNo, p, wheelNo >= 0 ? f(api._WY(wheelNo)) : '', wheelNo >= 0 ? f(api._Y(wheelNo)) : ''].join(','),
  );
}
writeFileSync(outFile, rows.join('\n') + '\n');
for (const k of [1, 30, 31, 59, 89, 119, 149, 150, 151, 199, 249, 329]) console.log(rows[k]);
if (sim.scriptError) console.log('scriptError', sim.scriptError);
await sim.lua.dispose();
