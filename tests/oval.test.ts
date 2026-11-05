import { expect, it } from 'vitest';
import { scenarioById } from '../src/challenge/scenarios';
import { KeyState } from '../src/input/keys';
import { CAR } from '../src/samples/car';
import { RustSimulation } from '../src/sim/rust-simulation';

it.each(['banked-oval', 'oval-lap'])('completes a clockwise lap of %s using the stock car controls', async id => {
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(CAR, keys, { scenario: scenarioById(id) });
  const targets = [[0, -18], [0, -36]];
  for (const direction of [1, -1]) {
    for (let i = 1; i <= 12; i++) {
      const angle = i * Math.PI / 12;
      targets.push([24 - direction * 24 * Math.cos(angle), -direction * (36 + 24 * Math.sin(angle))]);
    }
    const x = direction === 1 ? 48 : 0;
    for (const z of (direction === 1 ? [-18, 0, 18, 36] : [18, 0, -8])) targets.push([x, z]);
  }
  const hold = (key: number, down: boolean) => down ? keys.press(key) : keys.release(key);
  let target = 0, worstOffset = 0;
  try {
    await sim.start();
    while (target < targets.length && sim.frame < 2600) {
      const { x, z } = sim.corePosition(), v = sim.coreVelocity();
      const [tx, tz] = targets[target];
      const yaw = Math.atan2(v.x, -v.z);
      const desired = Math.atan2(tx - x, z - tz);
      const error = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
      const steer = Math.max(-24, Math.min(24, error * 65));
      const handle = sim.env('HANDLE') ?? 0;
      hold(0, sim.frame > 40 && Math.hypot(v.x, v.z) < 6);
      hold(2, steer < handle - 1);
      hold(3, steer > handle + 1);
      worstOffset = Math.max(worstOffset, Math.abs(Math.hypot(x - 24, Math.max(0, Math.abs(z) - 36)) - 24));
      if (Math.hypot(tx - x, tz - z) < 4) target++;
      sim.step();
    }
    expect(target).toBe(targets.length);
    if (id === 'oval-lap') expect(sim.ringsPassed).toBe(8);
    expect(worstOffset).toBeLessThan(6);
  } finally { await sim.dispose(); }
});
