import { describe, expect, it } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';
import { CAR } from '../src/samples/car';

// a KeyState that never sees DOM events; tests press keys directly
const fakeKeys = () => new KeyState(new EventTarget());

describe('Simulation (rapier in node, no browser)', () => {
  it('drives the car sample forward when ↑ (key 0) is held', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const sim = new Simulation(R, CAR, keys);
    await sim.start();
    for (let i = 0; i < 30; i++) sim.step(); // settle
    const z0 = sim.corePosition().z;
    keys.press(0);
    for (let i = 0; i < 90; i++) sim.step(); // 3 s at 30 fps
    expect(sim.vals.get('ENGINE')!.value).toBeGreaterThan(1000);
    expect(sim.corePosition().z).toBeLessThan(z0 - 5); // north is -Z
    expect(sim.scriptError).toBeNull();
    expect(sim.out[0]).toMatch(/km\/h/);
    await sim.lua.dispose();
  });

  it('_KEYDOWN fires once per press and Val steps return to default', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const src = `
      Val { X(default=0, min=0, max=100, step=5) }
      Key { 4:X(step=10) }
      Body { Core(){ } }
      Lua { down = 0; function OnFrame() if _KEYDOWN(4) > 0 then down = down + 1 end end }
    `;
    const sim = new Simulation(R, src, keys);
    await sim.start();
    keys.press(4);
    sim.step();
    sim.step();
    keys.release(4);
    sim.step();
    expect(sim.lua.getNumber('down')).toBe(1);
    expect(sim.vals.get('X')!.value).toBe(15); // 2 frames × 10, then one return step of 5
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.vals.get('X')!.value).toBe(0);
    await sim.lua.dispose();
  });
});
