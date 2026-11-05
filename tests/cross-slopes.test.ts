import { expect, it } from 'vitest';
import { scenarioById } from '../src/challenge/scenarios';
import { KeyState } from '../src/input/keys';
import { CAR } from '../src/samples/car';
import { RustSimulation } from '../src/sim/rust-simulation';

it('the car follows three alternating cross slopes and returns level on the runout', async () => {
  const drive = [
    'local x = _X(0)',
    'local vx = (x - (lastX or x)) * 30',
    'lastX = x',
    'ENGINE = (7 + _VZ(0)) * 250',
    'HANDLE = math.max(-22, math.min(22, x * 2 + vx * 5))',
  ].join('\n');
  const model = CAR.replace('out(0, "km/h", v * 3.6)', drive);
  const sim = new RustSimulation(model, new KeyState(new EventTarget()), { scenario: scenarioById('cross-slopes') });
  try {
    await sim.start();
    for (const [z, slope] of [[-38, 7], [-73, -10], [-108, 12], [-143, 0]]) {
      while (sim.corePosition().z > z && sim.frame < 1500) sim.step();
      const core = sim.physics.tiles[0], q = core.quaternion;
      const roll = Math.asin(2 * (q.w * q.z + q.x * q.y)) * 180 / Math.PI;
      expect(core.position.z).toBeLessThanOrEqual(z);
      expect(Math.abs(core.position.x)).toBeLessThan(2);
      expect(Math.abs(roll - slope)).toBeLessThan(1);
    }
  } finally { await sim.dispose(); }
});

it.each([false, true])('stock car traverses the slalom using steering: %s', async steer => {
  const course = scenarioById('banked-slalom')!;
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(CAR, keys, { scenario: course });
  const press = (n: number, on: boolean) => { if (on) keys.press(n); else keys.release(n); };
  try {
    await sim.start();
    while (sim.frame < 1000 && sim.corePosition().z > -135) {
      const next = course.rings![sim.ringsPassed];
      if (!next) break;
      const { x } = sim.corePosition(), v = sim.coreVelocity();
      const wanted = steer ? Math.max(-22, Math.min(22, (next.center[0] - x) * 2.2 - v.x * 4)) : 0;
      const handle = sim.env('HANDLE');
      press(0, sim.frame > 45 && -v.z < 7);
      press(2, wanted < handle - 1.5);
      press(3, wanted > handle + 1.5);
      sim.step();
    }
    expect(sim.ringsPassed).toBe(steer ? 3 : 0);
  } finally { await sim.dispose(); }
});
