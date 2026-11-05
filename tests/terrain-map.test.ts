import { expect, it } from 'vitest';
import { contourPaths, gateAltitudeGuide } from '../src/challenge/terrain-map';
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

it('distinguishes the gate altitude from horizontal distance at both inclusive boundaries', () => {
  expect(gateAltitudeGuide(2.5, 32, 65)).toBe('あと30m上昇');
  expect(gateAltitudeGuide(31.9, 32, 65)).toBe('あと1m上昇');
  expect(gateAltitudeGuide(32, 32, 65)).toBe('高度は範囲内');
  expect(gateAltitudeGuide(65, 32, 65)).toBe('高度は範囲内');
  expect(gateAltitudeGuide(65.1, 32, 65)).toBe('あと1m下降');
});
