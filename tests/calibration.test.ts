import { describe, it, expect } from 'vitest';
import { Quaternion } from 'three';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';

describe('original orientation calibration (1.5B26, 2026-10-28)', () => {
  it('matches single-axis and compound quaternion / relative-angle measurements', async () => {
    const sim = new Simulation(await initRapier(), `Val {} Key {} Body { Core(){
      N:Chip(angle=30){} S:Rudder(angle=30){} E:Trim(angle=30){}
      W:Chip(angle=20){ N:Rudder(angle=40){ E:Trim(angle=15){} } }
    } }`, new KeyState(new EventTarget()));
    await sim.start();
    const api = sim.api() as Record<string, (...args: number[]) => number>;
    // Original first-frame CSV; tolerance covers the original's tiny initial settling.
    const expected = [
      [1, -.2588190734, 0, 0, .9659258127, .5235981142, 0, 0],
      [2, 0, .2588190734, 0, .9659258127, 0, .5235982472, 0],
      [3, .2588190734, 0, 0, .9659258127, -.5235995816, 0, 0],
      [4, 0, 0, -.1736480892, .9848078489, 0, 0, -.3490660503],
      [5, .0593909100, .3368241191, -.1631758660, .9254165888, -.2216572095, .6676862973, -.2719115898],
      [6, .1796742678, .3126437366, -.2057444304, .9097473621, -.4730085358, .5895209064, -.2987421611],
    ];
    try {
      for (const [chip, ...values] of expected) {
        const actual = ['_QX','_QY','_QZ','_QW'].map(k => api[k](chip))
          .concat(['_RX','_RY','_RZ'].map(k => api[k](chip, 0)));
        actual.forEach((value, i) => expect(Math.abs(value-values[i])).toBeLessThan(0.00001));
      }
    } finally { await sim.lua.dispose(); sim.physics.world.free(); }
  });

});

describe('original spawn-height differences (1.5B26, 2026-10-28)', () => {
  // H(core) minus H(core-only), measured at frame one. Gravity and terrain cancel in the difference.
  it.each([
    ['flat', 'N:Chip(){ N:Chip(){ N:Chip(){} } }', 1.7999992370605],
    ['tall', 'N:Chip(angle=90){ N:Chip(){ N:Chip(){} } }', 1.5297012329101],
    ['diagonal', 'N:Chip(){ E:Chip(){ N:Chip(){} } }', 1.3416404724121],
    ['cowl', 'N:Cowl(){ N:Cowl(){ N:Cowl(){ N:Cowl(){ N:Cowl(){} } } } }', 3],
    ['ghost frame', 'N:Frame(option=1){ N:Frame(option=1){ N:Frame(option=1){} } }', 1.799991607666],
  ])('%s matches the original relative height', async (_name, body, measured) => {
    const R=await initRapier();
    const base=new Simulation(R,'Val {} Key {} Body { Core(){} }',new KeyState(new EventTarget()));
    const model=new Simulation(R,`Val {} Key {} Body { Core(){ ${body} } }`,new KeyState(new EventTarget()));
    try {
      await base.start(); await model.start();
      expect(Math.abs(model.corePosition().y-base.corePosition().y-measured)).toBeLessThan(0.00001);
    } finally { await base.lua.dispose();await model.lua.dispose();base.physics.world.free();model.physics.world.free(); }
  });
});


describe('loaded wheel fold (1.5B26, 2026-10-28)', () => {
  it('reaches a 30 degree change within one frame and holds its load', async () => {
    const sim = new Simulation(await initRapier(), `
      Val { A(default=90,min=-180,max=180) } Key {}
      Body { Core(){ W:Weight(option=8){} E:Weight(option=8){}
        N:Chip(angle=-90){ N:Chip(){ N:Wheel(angle=A){ N:Weight(option=4){} } } }
      } }
      Lua { function OnFrame() if _TICKS()>=120 then A=60 end end }
    `, new KeyState(new EventTarget()));
    try {
      await sim.start();
      const rim = sim.physics.tiles.find(t => t.rimJoint)!;
      const parent = sim.physics.byId.get(rim.tile.parent!.id)!;
      const axis = rim.tile.rimAxis.clone().applyQuaternion(parent.bodyRestQuat.clone().invert());
      for (let frame = 1; frame <= 240; frame++) {
        sim.step();
        if (frame < 121) continue;
        const pr = parent.body.rotation(), cr = rim.body.rotation();
        const q = new Quaternion(pr.x, pr.y, pr.z, pr.w).invert()
          .multiply(new Quaternion(cr.x, cr.y, cr.z, cr.w));
        const angle = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
        // Original fold: 60.30 degrees at frame 121, 59.01 at 122, settling near 60.06.
        // This joint measures displacement relative to its initial 90 degree fold.
        const error = angle + Math.PI / 6;
        expect(Math.abs(Math.atan2(Math.sin(error), Math.cos(error)))).toBeLessThan(2 * Math.PI / 180);
      }
      expect(sim.scriptError).toBeNull();
    } finally { await sim.lua.dispose(); sim.physics.world.free(); }
  });
});
