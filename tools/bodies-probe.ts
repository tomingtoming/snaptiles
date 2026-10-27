// Per-body motion of a model while a Val is forced: bun tools/bodies-probe.ts <model> [VAL=value] [frames] [tuneJson]
// Prints, for each rigid body (one line per group root tile), its mass, linear and angular speed.
import { readFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

const [file, valSpec = 'ENGINE=1', framesArg = '120', tuneArg] = process.argv.slice(2);
if (tuneArg) (globalThis as unknown as { __tune?: unknown }).__tune = JSON.parse(tuneArg);
const [valName, valValue] = valSpec.split('=');
const buf = readFileSync(file);
let src = new TextDecoder('utf-8', { fatal: false }).decode(buf);
if (/�/.test(src)) src = new TextDecoder('shift_jis').decode(buf);
const R = await initRapier();
const sim = new Simulation(R, src, new KeyState(new EventTarget()));
await sim.start();
const v = sim.vals.get(valName.toUpperCase());
const frames = Number(framesArg);
for (let n = 1; n <= frames; n++) {
  if (v && n > 30) { v.value = Number(valValue); v.default = Number(valValue); }
  sim.step();
  if (n % 30 === 0) {
    console.log(`--- frame ${n} core ${sim.corePosition().toArray().map((x) => x.toFixed(2)).join(',')} scriptError=${sim.scriptError}`);
    const seen = new Set<number>();
    for (const tb of sim.physics.tiles) {
      if (seen.has(tb.body.handle)) continue;
      seen.add(tb.body.handle);
      const lv = tb.body.linvel();
      const av = tb.body.angvel();
      const p = tb.body.translation();
      console.log(`  body of ${tb.tile.type}#${tb.tile.chipIndex} m=${tb.body.mass().toFixed(0)} y=${p.y.toFixed(2)} |v|=${Math.hypot(lv.x, lv.y, lv.z).toFixed(3)} |w|=${Math.hypot(av.x, av.y, av.z).toFixed(3)} joint=${tb.joint ? 'yes' : 'no'} animated=${tb.animated} rim=${tb.rim ? 'yes' : 'no'}`);
    }
  }
}
await sim.lua.dispose();
