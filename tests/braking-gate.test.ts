import { expect, it } from 'vitest';
import { crossesBrakingGate, scenarioById } from '../src/challenge/scenarios';

it('crosses the entry line in the marked direction', () => {
  const course = scenarioById('braking-box')!;
  const gate = course.checkpoint!;
  const at = (z: number, x = 0, y = 1) => ({ x, y, z });
  const crosses = (before: ReturnType<typeof at>, after: ReturnType<typeof at>) =>
    crossesBrakingGate(gate, before, after);
  expect(crosses(at(-27), at(-28))).toBe(true);
  expect(crosses(at(-29), at(-30))).toBe(false);
  expect(crosses(at(-29), at(-27))).toBe(false);
  expect(crosses(at(-20), at(-40))).toBe(true);
  expect(crosses(at(-20, 15), at(-40, 0))).toBe(false);
  expect(crosses(at(-27, 0, 4), at(-29, 0, 4))).toBe(false);
});
