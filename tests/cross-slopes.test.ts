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
