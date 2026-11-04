import { describe, expect, it } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';

// Round trip of the state buffer: everything the page decodes from HEAPF64 (src/sim/core-layout.ts, generated from
// core/src/state.rs) is checked against the same quantity read through the core's script API or set by the page.
const MODEL = `Val { ENGINE(default=0,min=-500,max=500) }
Key {}
Body { Core(){ N:Chip(){ N:Wheel(angle=90,power=ENGINE){} } E:Jet(power=ENGINE){} } }
Lua {
function OnFrame()
  ENGINE = 123
  out(0, "tick ", _TICKS())
  out(1, "second row")
  _ZOOM(30)
  _MOVE3D(0, 1, 2) _LINE3D(3, 4, 5)
  _MOVE2D(10, 20) _LINE2D(30, 40)
end
}
`;

describe('the decoded state buffer agrees with the core', () => {
  it('tiles, header, Vals, out rows, lines, balls and wind', async () => {
    const sim = new RustSimulation(MODEL, new KeyState(new EventTarget()), { bare: true });
    try {
      await sim.start();
      for (let i = 0; i < 20; i++) sim.step();
      const api = sim.api();
      expect(sim.ticks).toBe(api._TICKS());
      expect(sim.physics.tiles.length).toBe(sim.assembly!.tiles.length);
      for (const tb of sim.physics.tiles) {
        // the API mirrors x (the original's W is +x)
        const c = tb.tile.chipIndex;
        expect(tb.position.x).toBeCloseTo(-api._X(c), 9);
        expect(tb.position.y).toBeCloseTo(api._Y(c), 9);
        expect(tb.position.z).toBeCloseTo(api._Z(c), 9);
        expect(tb.quaternion.length()).toBeCloseTo(1, 6); // rapier runs in f32
      }
      const wheel = sim.physics.tiles.find((t) => t.tile.spec.wheel)!;
      expect(wheel.spin).toBeCloseTo(api._WY(wheel.tile.chipIndex), 6);
      expect(sim.env('ENGINE')).toBe(123);
      expect(sim.out).toEqual([`tick  ${api._TICKS() - 1}`, 'second row']); // out() joins its arguments with a space
      expect(sim.zoomFov).toBe(30);
      expect(sim.lines3d.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(sim.lines3d.length).toBe(9);
      expect(sim.lines2d.slice(0, 4)).toEqual([10, 20, 30, 40]);
      expect(sim.lines2d.length).toBe(7);
      sim.physics.wind.set(5, 0, -2);
      sim.step();
      expect(api._GETWIND()).toBe(5);
      expect(sim.physics.wind.toArray()).toEqual([5, 0, -2]);
      sim.physics.addBall(0.6, 2, 6, 0, 0.3);
      sim.step();
      expect(sim.physics.balls.length).toBe(1);
      expect(sim.physics.balls[0].radius).toBe(0.6);
      expect(sim.physics.balls[0].body.translation().y).toBeLessThan(6);
    } finally {
      await sim.dispose();
    }
  }, 20000);
});
