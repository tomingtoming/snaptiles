import { describe, it, expect } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

// tools/orig-harness/rc_models32.sh: an arm standing up from a heavy base, its hinge commanded −90 → −60 at frame 150.
const arm = (spring: number) => `Val { A(default=-90,min=-180,max=180) }
Key { }
Body { Core(){ N:Frame(angle=A,spring=${spring},damper=0.5){ N:Chip(){ N:Chip(){ N:Chip(){ } } } } W:Weight(){ } E:Weight(){ } S:Chip(){ S:Weight(){ } } } }
Lua {
function OnFrame()
  if _TICKS()>=150 then A=-60 end
end
}`;

describe('joints with spring < 1 follow their command like a damped spring (original 1.5B26, 2026-11-01)', () => {
  // Fraction of the commanded swing reached 1, 3 and 6 frames after the command in the original (sdarm_<spring>_0.5);
  // here _TICKS() reaches 150 inside the 151st step.
  it.each([[0.05, [0.04, 0.13, 0.38]], [0.1, [0.16, 0.58, 1.04]], [0.2, [0.47, 1.23, 0.97]], [1, [1, 1, 1]]])('spring %f', async (spring, want) => {
    (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
    const R = await initRapier();
    const sim = new Simulation(R, arm(spring), new KeyState(new EventTarget()));
    try {
      await sim.start();
      const api = sim.api() as Record<string, (n: number) => number>;
      const p = (c: number) => [api._X(c), api._Y(c), api._Z(c)];
      const angle = () => {
        const [a, b, c, d] = [p(0), p(1), p(2), p(4)];
        const u = a.map((_, i) => b[i] - a[i]), w = c.map((_, i) => d[i] - c[i]);
        return Math.acos(u.reduce((s, x, i) => s + x * w[i], 0) / Math.hypot(...u) / Math.hypot(...w));
      };
      const seen: number[] = [];
      for (let f = 1; f <= 220; f++) { sim.step(); seen[f] = angle(); }
      const a0 = seen[150], a1 = seen[220];
      const got = [151, 153, 156].map((f) => (a0 - seen[f]) / (a0 - a1));
      got.forEach((g, i) => expect(Math.abs(g - want[i])).toBeLessThan(0.2));
    } finally {
      await sim.dispose();
    }
  });
});
