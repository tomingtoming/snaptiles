import { expect, it } from 'vitest';
import { scenarioById, type Scenario } from '../src/challenge/scenarios';
import { KeyState } from '../src/input/keys';
import { RustSimulation } from '../src/sim/rust-simulation';

const inlet = scenarioById('tidal-inlet')!;

async function release(part: string, water: Scenario['water']) {
  const arms = part ? ['N', 'S', 'E', 'W'].map(d => d + ':' + part + '{}').join(' ') : '';
  const model = 'Val {}\nKey {}\nBody { Core(){' + arms + '} }';
  const sim = new RustSimulation(model, new KeyState(new EventTarget()), { scenario: { ...inlet, ground: [], water } });
  try {
    await sim.start();
    for (let i = 0; i < 19; i++) sim.step();
    const before = sim.corePosition().y;
    sim.step();
    return (sim.corePosition().y - before) * 30;
  } finally {
    await sim.dispose();
  }
}

it.each([
  ['', 0.841], ['Chip()', 0.841], ['Frame()', 1.428], ['Weight()', -1.492], ['Weight(option=3)', -3.027],
])('tracks the original deep-water release at frame 20 for %s', async (part, measured) => {
  const speed = await release(String(part), [-10, 10, -10, 10, 20]);
  expect(Math.abs(speed - Number(measured))).toBeLessThan(0.3);
});

it('keeps the dry trajectory outside the lake footprint and above its surface', async () => {
  const dry = await release('', undefined);
  expect(await release('', [10, 20, -10, 10, 20])).toBe(dry);
  expect(await release('', [-10, 10, -10, 10, -20])).toBe(dry);
});
