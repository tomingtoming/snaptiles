import { describe, expect, it } from 'vitest';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';
import { HOVER } from '../src/samples/hover';

const fakeKeys = () => new KeyState(new EventTarget());
const run = async (src: string) => {
  const R = await initRapier();
  const keys = fakeKeys();
  const sim = new Simulation(R, src, keys);
  await sim.start();
  return { sim, keys };
};

describe('physics behaviours measured against the corpus', () => {
  it('an Arm charges, fires a shell when power reaches option, and recoils', async () => {
    const { sim, keys } = await run(`
      Val { P(default=0, min=0, max=100000, step=100000) }
      Key { 4:P(step=100000) }
      Body { Core(){ W:Weight(){} E:Weight(){} S:Chip(){} N:Chip(angle=-90){ N:Arm(angle=180, power=P, option=30000, name=GUN){} } } }
      Lua { function OnFrame() E = _E(GUN) end }
    `);
    for (let i = 0; i < 160; i++) sim.step(); // > 150 frames: armed and charged
    expect(sim.lua.getNumber('E')).toBe(30000);
    keys.press(4);
    sim.step();
    expect(sim.physics.projectiles.length).toBe(1);
    const v = sim.physics.projectiles[0].body.linvel();
    expect(v.z).toBeLessThan(-50); // fired north
    sim.step(); // the script reads the charge at the start of the next frame
    expect(sim.lua.getNumber('E')).toBeLessThan(5000); // charge spent
    await sim.lua.dispose();
  });

  it('_BYE cuts a subtree loose: _TOP changes and the piece falls away', async () => {
    const { sim } = await run(`
      Val { }
      Key { }
      Body { Core(){ W:Chip(angle=90){ W:Wheel(){} } E:Chip(angle=90){ E:Wheel(){} } N:Chip(name=NOSE){ N:Chip(){ N:Chip(){ } } } } }
      Lua { function OnFrame() TOP = _TOP(NOSE + 2) if _TICKS() == 20 then x = _BYE(NOSE) end end }
    `);
    for (let i = 0; i < 19; i++) sim.step();
    expect(sim.lua.getNumber('TOP')).toBe(0);
    for (let i = 0; i < 40; i++) sim.step();
    // chip numbers: Core 0, W chip 1, W wheel 2+3, E chip 4, E wheel 5+6, NOSE 7
    expect(sim.lua.getNumber('TOP')).toBe(7); // NOSE is now its own root
    const nose = sim.assembly!.byChip.get(7)!;
    expect(nose.detached).toBe(true);
    expect(sim.physics.byId.get(nose.id)!.body.handle).not.toBe(sim.physics.tiles[0].body.handle);
    await sim.lua.dispose();
  });

  it('a balloon jet (option 1) lifts regardless of its tilt', async () => {
    const { sim } = await run(`
      Val { }
      Key { }
      Body { Core(){ N:Jet(angle=-90, power=60000, option=1){} } }
    `);
    const y0 = sim.corePosition().y;
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.corePosition().y).toBeGreaterThan(y0 + 2);
    await sim.lua.dispose();
  });

  it('the hover sample holds about 3 m with its Lua attitude controller', async () => {
    const { sim } = await run(HOVER);
    for (let i = 0; i < 150; i++) sim.step(); // 5 s
    const y = sim.corePosition().y;
    expect(y).toBeGreaterThan(2.3);
    expect(y).toBeLessThan(3.8);
    expect(sim.scriptError).toBeNull();
    await sim.lua.dispose();
  });
});
