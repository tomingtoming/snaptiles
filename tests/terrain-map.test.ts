import { expect, it } from 'vitest';
import { contourPaths } from '../src/challenge/terrain-map';
import { scenarioById, type Solid } from '../src/challenge/scenarios';

it('joins neighbouring slope triangles at the same elevation', () => {
  const slope: Solid = [[0, 0, 0], [10, 0, 0], [0, 50, 10], [10, 0, 0], [10, 50, 10], [0, 50, 10]];
  const paths = contourPaths(slope, 25);
  expect(paths.get(25)).toBe('M5.00 5.00L0.00 5.00M10.00 5.00L5.00 5.00');
  expect(paths.get(50)).toBe('M10.00 10.00L0.00 10.00');
  expect(contourPaths([[0, 0, 0], [10, 0, 0], [0, 25, 10]], 25).size).toBe(0);
});

it('draws the five positive contour levels of the highlands', () => {
  const s = scenarioById('highlands')!;
  const levels = [...contourPaths(s.terrainFaces!, s.contourInterval!).keys()];
  expect(levels.filter(n => n > 0).sort((a, b) => a - b)).toEqual([25, 50, 75, 100, 125]);
});
