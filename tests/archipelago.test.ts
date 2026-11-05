import { expect, it } from 'vitest';
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

it.each([[-30, -30, 13], [30, -75, 10], [-30, -120, 8], [45, -120, 2.65], [0, -60, 0.9964], [0, 0, 0]])(
  'reads the collision terrain at (%i,%i) beneath the map', async (x, z, height) => {
    const sea = scenarioById('three-islands')!;
    // Place the probe above each surveyed point; the production colliders are translated together.
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
