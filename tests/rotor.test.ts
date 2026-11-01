import { describe, it, expect } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

// tools/orig-harness/rc_models34.sh: a horizontal RLW on a weighted base carrying two chips, powered from frame 60.
const rotor = (power: number, carried: string) => `Val { P(default=0,min=-100000,max=100000) }
Key { }
Body { Core(){ N:RLW(angle=0,power=P){ W:${carried}(){ } E:${carried}(){ } } W:Weight(){ } E:Weight(){ } S:Weight(){ S:Weight(){ } } } }
Lua {
function OnFrame()
  if _TICKS()>=60 then P=${power} end
end
}`;

describe('a wheel carrying chips is a rotor (original 1.5B26, 2026-11-01)', () => {
  // steady spin of the carried chips in the original: 26.1 / 43.8 / 64.3 rad/s with two Trims, 20.5 with two Weights;
  // +power turns them clockwise seen from above in the original's frame
  it.each([[5000, 'Trim', 26.1], [20000, 'Trim', 43.8], [60000, 'Trim', 64.3], [20000, 'Weight', 20.5]])('power %d with two %s', async (power, carried, want) => {
    (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
    const R = await initRapier();
    const sim = new Simulation(R, rotor(power, carried), new KeyState(new EventTarget()));
    try {
      await sim.start();
      const api = sim.api() as Record<string, (n: number) => number>;
      const ang = () => Math.atan2(api._Z(3) - api._Z(2), api._X(3) - api._X(2));
      for (let f = 1; f <= 200; f++) sim.step();
      let prev = ang(), turned = 0;
      for (let f = 0; f < 30; f++) {
        sim.step();
        const a = ang();
        turned += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
        prev = a;
      }
      expect(-turned).toBeGreaterThan(want * 0.95);
      expect(-turned).toBeLessThan(want * 1.05);
      expect(api._Y(0)).toBeLessThan(0.3); // the base stays down
    } finally {
      await sim.dispose();
    }
  });
});
