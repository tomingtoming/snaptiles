import { describe, it, expect } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

async function run(src: string, frames: number, read: (api: Record<string, (...a: number[]) => number>) => number): Promise<number> {
  (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
  const R = await initRapier();
  const sim = new Simulation(R, src, new KeyState(new EventTarget()));
  try {
    await sim.start();
    for (let f = 0; f < frames; f++) sim.step();
    return read(sim.api() as Record<string, (...a: number[]) => number>);
  } finally {
    await sim.dispose();
  }
}

describe('measured on the original 1.5B26 (2026-11-01)', () => {
  // harness_weight.rcs: 176.4 kg, 50.4 after _SPLIT cuts the Chip+Weight off; _CHIPS keeps 4
  it('_WEIGHT drops what _SPLIT cut off, _CHIPS does not', async () => {
    const src = 'Val { A(default=0) }\nKey { }\nBody { Core(){ N:Chip(name=cut){ N:Weight(){ } } S:Chip(){ } } }\nLua {\nfunction OnFrame()\n  if _TICKS()==10 then _SPLIT(CUT) end\nend\n}\n';
    expect(await run(src, 5, (a) => a._WEIGHT())).toBeCloseTo(176.4, 0);
    expect(await run(src, 20, (a) => a._WEIGHT())).toBeCloseTo(50.4, 0);
    expect(await run(src, 20, (a) => a._CHIPS())).toBe(4);
  });
  // rc_models40.sh: two option-1 jets at 4000 lift a 98.7 kg core, option-2 (air) ones do nothing
  it.each([[1, true], [2, false]])('a balloon jet of option %d lifts: %s', async (option, lifts) => {
    const src = `Val { P(default=0,min=-100000,max=100000) }\nKey { }\nBody { Core(){ N:Jet(power=P,option=${option}){ } S:Jet(power=P,option=${option}){ } } }\nLua {\nfunction OnFrame()\n  if _TICKS()>=30 then P=4000 end\nend\n}\n`;
    const y = await run(src, 90, (a) => a._Y(0));
    expect(y > 1).toBe(lifts);
  });
  // rc_models38.sh: an upside-down chip reads _AZ ≈ 0 although its Euler roll is ±π
  it('_AZ of an upside-down chip is a tilt, not an Euler roll', async () => {
    const az = await run('Val { A(default=0) }\nKey { }\nBody { Core(){ N:Chip(angle=180){ } E:Chip(angle=40){ } } }\n', 120, (a) => a._AZ(1));
    expect(az).toBeCloseTo(0.35, 1);
  });
});
