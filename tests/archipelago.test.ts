import { expect, it } from 'vitest';
import { chartHeight } from '../src/challenge/scenarios';
import { aboveLevel } from '../src/challenge/terrain-map';
import { scenarioById, type Solid } from '../src/challenge/scenarios';
import { KeyState } from '../src/input/keys';
import { RustSimulation } from '../src/sim/rust-simulation';

it('cuts a shoreline through triangle edges, including vertices exactly at water level', () => {
  const face: Solid = [[0, 0, 0], [4, 4, 0], [0, 0, 4]];
  expect(aboveLevel(face, 2)).toBe('2,0 4,0 2,2');
  expect(aboveLevel(face, 4)).toBe('');
  expect(aboveLevel(face, 0)).toBe('0,0 4,0 0,4');
});

const islandSamples = [[-30, -30, 13], [30, -75, 10], [-30, -120, 8], [45, -120, 2.65], [0, -60, 0.9964], [0, 0, 0]];
const canyonSamples = [[0, -112, 0], [36, -240, 6], [-12, -240, 76], [84, -240, 68], [-24, -360, 3]];
it.each([
  ...islandSamples.map(point => ['three-islands', ...point] as const),
  ...canyonSamples.map(point => ['canyon-airfield', ...point] as const),
])(
  'reads the collision terrain of %s at (%i,%i) beneath the map', async (id, x, z, height) => {
    const sea = scenarioById(id)!;
    // Place the probe above each surveyed point; the production colliders are translated together.
    expect(chartHeight(sea.terrainFaces!, x, z)).toBeCloseTo(height, 2);
    const ground = sea.ground!.map(solid => solid.map(([px, y, pz]): Solid[number] => [px - x, y - height, pz - z]));
    const sim = new RustSimulation('Val {}\nKey {}\nBody { Core(){} }', new KeyState(new EventTarget()), {
      scenario: { ...sea, ground, water: undefined },
    });
    try {
      await sim.start();
      sim.step();
      const measured = sim.corePosition().y - Number(sim.api()._H(0)) + height;
      expect(measured).toBeCloseTo(height, 2);
    } finally { await sim.dispose(); }
  },
);
