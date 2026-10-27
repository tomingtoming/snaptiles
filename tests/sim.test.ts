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

describe('brakes and lifecycle callbacks', () => {
  it('BRAKE stops the car sample', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const sim = new Simulation(R, CAR, keys);
    await sim.start();
    keys.press(0);
    for (let i = 0; i < 90; i++) sim.step();
    keys.release(0);
    const api = sim.api();
    const vFast = api._VEL(0) as number;
    expect(vFast).toBeGreaterThan(5);
    keys.press(4); // Z = BRAKE
    for (let i = 0; i < 60; i++) sim.step();
    expect(api._VEL(0) as number).toBeLessThan(vFast * 0.3);
    await sim.lua.dispose();
  });

  it('OnInit runs once at load and OnReset on reset', async () => {
    const R = await initRapier();
    const sim = new Simulation(R, `
      Val { } Key { }
      Body { Core(){ } }
      Lua { inits = 0; resets = 0; function OnInit() inits = inits + 1 end function OnReset() resets = resets + 1 end function OnFrame() end }
    `, fakeKeys());
    await sim.start();
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.lua.getNumber('inits')).toBe(1);
    expect(sim.lua.getNumber('resets')).toBe(0);
    sim.reset();
    expect(sim.lua.getNumber('resets')).toBe(1);
    expect(sim.lua.getNumber('inits')).toBe(1);
    await sim.lua.dispose();
  });
});

import { WALKER } from '../src/samples/walker';
import { TANK } from '../src/samples/tank';

describe('walker and tank samples', () => {
  it('the walker crawls north on ↑ and stays upright', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const sim = new Simulation(R, WALKER, keys);
    await sim.start();
    for (let i = 0; i < 30; i++) sim.step();
    const z0 = sim.corePosition().z;
    keys.press(0);
    for (let i = 0; i < 180; i++) sim.step(); // 6 s
    // one-leg-at-a-time crawl with the instant (teleporting) servo: ~1.3 m in 6 s
    expect(sim.corePosition().z).toBeLessThan(z0 - 0.8);
    const q = sim.physics.pose(sim.physics.tiles[0]).quaternion;
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.9); // up vector still up
    await sim.lua.dispose();
  });

  it('the tank turns its turret with D and fires with Z', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const sim = new Simulation(R, TANK, keys);
    await sim.start();
    for (let i = 0; i < 160; i++) sim.step();
    keys.press(9); // D
    for (let i = 0; i < 30; i++) sim.step();
    keys.release(9);
    expect(sim.vals.get('TURRET')!.value).toBeGreaterThan(60);
    keys.press(4); // Z
    sim.step();
    expect(sim.physics.projectiles.length).toBe(1);
    await sim.lua.dispose();
  });
});

import { PLANE } from '../src/samples/plane';

describe('plane sample', () => {
  // Skipped 2026-10-27: with the measured 0.6 m tile the sample no longer rotates; the aero model is a
  // guess (per-tile lift slope) and is next to be measured against the original (Data/plane.txt).
  it('takes off when ↓ (pull up) is held at full throttle', async () => {
    const R = await initRapier();
    const keys = fakeKeys();
    const sim = new Simulation(R, PLANE, keys);
    await sim.start();
    for (let i = 0; i < 30; i++) sim.step();
    const y0 = sim.corePosition().y;
    keys.press(4); // Z throttle
    keys.press(1); // ↓ pull up
    let maxY = y0;
    for (let i = 0; i < 240; i++) {
      sim.step();
      maxY = Math.max(maxY, sim.corePosition().y);
    }
    expect(maxY).toBeGreaterThan(y0 + 4);
    expect(sim.scriptError).toBeNull();
    await sim.lua.dispose();
  });
});
