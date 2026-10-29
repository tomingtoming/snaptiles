import {describe, it, expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {initRapier} from '../src/physics/world';
import {Simulation} from '../src/sim/simulation';
import {KeyState} from '../src/input/keys';

// Use the same document operations as the blank-car GUI workflow, not a hand-written final model.
function buildCar(): string {
  const d = new ModelDocument('Body { Core(){} }');
  const wheel = (parent: number, dir: 'E' | 'W', index: number, first = false) => {
    d.add(parent, dir, 'Wheel'); d.angle(index, 90);
    if (first) d.addPowerControl(index, 800);
    else d.power(index, dir === 'W' ? '-ST_POWER_1' : 'ST_POWER_1');
  };
  wheel(0, 'E', 1, true); wheel(0, 'W', 2);
  d.add(0, 'N', 'Rudder'); d.addSteeringControl(3); d.add(3, 'N', 'Chip');
  wheel(4, 'E', 5); wheel(4, 'W', 6);
  return d.text;
}

describe('constructed vehicle driving outcomes', () => {
  it('travels straight and physically turns in opposite directions under generated controls', async () => {
    const R = await initRapier(), source = buildCar();
    const results: {dx:number; dz:number; yaw:number}[] = [];
    for (const steering of [null, 2, 3]) {
      const keys = new KeyState(new EventTarget()), sim = new Simulation(R, source, keys);
      try {
        await sim.start();
        const advance = (seconds: number) => { for (let i=0;i<Math.round(seconds/sim.frameDt());i++) sim.step(); };
        advance(2); const start = sim.corePosition().clone(), heading = sim.coreHeading();
        keys.press(0); if (steering !== null) keys.press(steering); advance(2);
        const end = sim.corePosition(), delta = sim.coreHeading() - heading;
        results.push({dx:end.x-start.x,dz:end.z-start.z,yaw:Math.atan2(Math.sin(delta),Math.cos(delta))});
        expect(end.y).toBeGreaterThan(0.1); expect(end.y).toBeLessThan(1.5);
        keys.clear(); advance(0.1);
        expect(sim.env('ST_POWER_1')).toBe(0); expect(sim.env('ST_STEER_1')).toBe(0);
      } finally { await sim.dispose(); }
    }
    const [straight,left,right] = results;
    expect(straight.dz).toBeLessThan(-5); expect(Math.abs(straight.dx)).toBeLessThan(0.5);
    expect(Math.abs(straight.yaw)).toBeLessThan(0.1);
    expect(left.dx).toBeLessThan(-1); expect(right.dx).toBeGreaterThan(1);
    expect(left.dz).toBeLessThan(-2); expect(right.dz).toBeLessThan(-2);
    expect(left.yaw).toBeGreaterThan(0.5); expect(right.yaw).toBeLessThan(-0.5);
  });
});
