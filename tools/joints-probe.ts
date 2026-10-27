// Joint deflection of a settled model: bun tools/joints-probe.ts <model> [frames] [tuneJson]
// Lists every revolute joint (animated servo or compliant spring) with its current angle (deg).
import { readFileSync } from 'node:fs';
import { initRapier } from '../src/physics/world';
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
for (const tb of sim.physics.tiles) {
  const j = tb.joint ?? tb.rimJoint;
  if (!j) continue;
  const a = (j as unknown as { angle?: () => number }).angle?.();
  console.log(`${tb.tile.type}#${tb.tile.chipIndex} parent=${tb.tile.parent?.type}#${tb.tile.parent?.chipIndex} animated=${tb.animated} rim=${!!tb.rimJoint} servo=${((tb.servoAngle * 180) / Math.PI).toFixed(1)} angle=${a === undefined ? '?' : ((a * 180) / Math.PI).toFixed(1)} spring=${tb.tile.node.attrs.spring ?? ''} attrAngle=${tb.tile.node.attrs.angle ?? ''}`);
}
await sim.lua.dispose();
