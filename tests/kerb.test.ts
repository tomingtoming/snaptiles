import { describe, it, expect } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

// The original's default Basic car driving itself at Engine 2500 (tools/orig-harness/basic_drive_2500.txt).
const BASIC = `Val {
  Brake(default=0,min=0,max=80,step=80)
  HBrake(default=0,min=0,max=100,step=100)
  Handle(default=0,min=-20,max=20,step=5)
  Engine(default=2500,min=-2500,max=2500,step=0)
}
Key { }
Body { Core(){
  N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90,brake=Brake){} } E:Frame(){ E:Wheel(angle=90,brake=Brake){} } } }
  S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine,brake=HBrake){} } E:Frame(){ E:Wheel(angle=90,power=-Engine,brake=HBrake){} } }
} }`;

describe('kerbs lower than the tyre radius (original 1.5B26, 2026-10-31)', () => {
  // Original, step face 6 m ahead, hit at 6.9 m/s: speed loss 17/60/79%, every wheel past the edge
  // 0.7/0.8/1.1 s after the hit, pitch at most 0.12/0.40/0.53 rad (docs/measured.md, kerb section).
  it.each([[0.10, 17, 0.12], [0.20, 60, 0.40], [0.25, 79, 0.53]])('climbs a %f m kerb like the original', async (h, loss, pitch) => {
    (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
    const R = await initRapier();
    const sim = new Simulation(R, BASIC, new KeyState(new EventTarget()));
    try {
      await sim.start();
      sim.physics.world.createCollider(R.ColliderDesc.cuboid(10, h / 2, 15).setTranslation(0, h / 2, 21).setFriction(1).setCollisionGroups(0x0002_0007));
      const api = sim.api() as Record<string, (n: number) => number>;
      const wheels = sim.assembly!.tiles.filter((t) => t.spec.wheel).map((t) => t.chipIndex);
      let hit = -1, over = -1, v0 = 0, vmin = Infinity, maxPitch = 0;
      for (let n = 0; n < 300 && over < 0; n++) {
        sim.step();
        const zs = wheels.map((w) => api._Z(w)), v = Math.hypot(api._VX(0), api._VZ(0));
        if (hit < 0 && Math.max(...zs) > 5.68) { hit = n; v0 = v; }
        if (hit >= 0) { vmin = Math.min(vmin, v); maxPitch = Math.max(maxPitch, Math.abs(api._EX(0))); }
        if (hit >= 0 && Math.min(...zs) > 6.6) over = n;
      }
      expect(hit).toBeGreaterThan(0);
      expect(over - hit).toBeLessThan(1.5 * 30);
      expect(Math.abs(100 * (1 - vmin / v0) - loss)).toBeLessThan(15);
      expect(maxPitch).toBeLessThan(pitch + 0.15);
    } finally { await sim.dispose(); (globalThis as unknown as { __tune?: unknown }).__tune = undefined; }
  }, 60000);
});
