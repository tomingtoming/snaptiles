import { expect, it } from 'vitest';
import { advanceRings, type CourseRing } from '../src/challenge/rings';

const ring = (z: number): CourseRing => ({ center: [0, 4, z], radius: 3, heading: 0 });
const p = (x: number, y: number, z: number) => ({ x, y, z });

it('counts the circular opening, in the forward direction, including a fast crossing', () => {
  const course = [ring(0)];
  expect(advanceRings(course, 0, p(0, 4, 40), p(0, 4, -40))).toBe(1);
  expect(advanceRings(course, 0, p(3, 4, 1), p(3, 4, 0))).toBe(1);
  expect(advanceRings(course, 0, p(2.5, 6.5, 1), p(2.5, 6.5, -1))).toBe(0);
  expect(advanceRings(course, 0, p(0, 4, -5), p(0, 4, 5))).toBe(0);
});

it('requires each ring in order even when one step crosses several planes', () => {
  expect(advanceRings([ring(0), ring(-10)], 0, p(0, 4, 4), p(0, 4, -20))).toBe(2);
  expect(advanceRings([ring(-10), ring(0)], 0, p(0, 4, 4), p(0, 4, -20))).toBe(1);
  expect(advanceRings([ring(0), ring(-10)], 0, p(0, 4, -5), p(0, 4, -20))).toBe(0);
});

it('turns the crossing plane with the ring heading', () => {
  const course = [{ ...ring(0), heading: 90 }];
  expect(advanceRings(course, 0, p(-4, 4, 1), p(4, 4, 1))).toBe(1);
  expect(advanceRings(course, 0, p(4, 4, 1), p(-4, 4, 1))).toBe(0);
});

it('counts a surface buoy gate only inside its width, height and forward direction', () => {
  const water: CourseRing[] = [{ center: [0, 3, 0], heading: 0, radius: 6, halfHeight: 1 }];
  expect(advanceRings(water, 0, p(6, 4, 5), p(6, 4, -5))).toBe(1);
  expect(advanceRings(water, 0, p(6.1, 3, 5), p(6.1, 3, -5))).toBe(0);
  expect(advanceRings(water, 0, p(0, 4.1, 5), p(0, 4.1, -5))).toBe(0);
  expect(advanceRings(water, 0, p(0, 1.9, 5), p(0, 1.9, -5))).toBe(0);
  expect(advanceRings(water, 0, p(0, 3, -5), p(0, 3, 5))).toBe(0);
});
