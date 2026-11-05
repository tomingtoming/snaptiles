import { expect, it } from 'vitest';
import { entersBrakingGate, scenarioById } from '../src/challenge/scenarios';

it('measures speed at the entry line, in the marked direction', () => {
  const course = scenarioById('braking-box')!;
  const gate = course.checkpoint!, min = course.brakingTest!.entryKmh;
  const at = (z: number, x = 0, y = 1) => ({ x, y, z });
  const crosses = (before: ReturnType<typeof at>, after: ReturnType<typeof at>, speed: number) =>
    entersBrakingGate(gate, before, after, speed, min);
  expect(crosses(at(-27), at(-28), min)).toBe(true);
  expect(crosses(at(-27), at(-29), min - 0.1)).toBe(false);
  expect(crosses(at(-29), at(-30), min + 5)).toBe(false);
  expect(crosses(at(-29), at(-27), min + 5)).toBe(false);
  expect(crosses(at(-20), at(-40), min + 5)).toBe(true);
  expect(crosses(at(-20, 15), at(-40, 0), min + 5)).toBe(false);
  expect(crosses(at(-27, 0, 4), at(-29, 0, 4), min + 5)).toBe(false);
});
