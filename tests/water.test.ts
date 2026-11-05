import { RAFT } from '../src/samples/raft';
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

it.each([[0, -1], [1, 1], [2, -1], [3, 1]])('keeps the raft upright with control %i', async (control, direction) => {
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(RAFT, keys, { scenario: scenarioById('inlet-float') });
  try {
    await sim.start();
    for (let i = 0; i < 90; i++) sim.step();
    if (control >= 2) keys.press(0);
    keys.press(control);
    for (let i = 0; i < 270; i++) {
      sim.step();
      const q = sim.physics.tiles[0].quaternion;
      expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.90);
    }
    const p = sim.corePosition();
    expect((control >= 2 ? p.x : p.z) * direction).toBeGreaterThan(2);
  } finally { await sim.dispose(); }
});

it.each([[0, 0.006], [1200, 3.239], [2400, 6.046], [3600, 8.386]])(
  'reproduces the measured towing speed at frame 180, thrust %i', async (power, original) => {
    const control = 'ticks=(ticks or 0)+1\n if ticks>=90 then THRUST=' + power + ' end\n  PORT = THRUST + TURN';
    const sim = new RustSimulation(RAFT.replace('PORT = THRUST + TURN', control), new KeyState(new EventTarget()), { scenario: scenarioById('tow-basin') });
    try {
      await sim.start();
      for (let frame = 0; frame < 180; frame++) sim.step();
      expect(Math.abs(-sim.coreVelocity().z - original)).toBeLessThan(power === 0 ? 0.02 : 0.45);
    } finally { await sim.dispose(); }
  },
);

it.each([0, 45, 90])('keeps the raft upright for 150 m when thrust begins at frame %i', async delay => {
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(RAFT, keys, { scenario: scenarioById('tow-basin') });
  try {
    await sim.start();
    while (sim.frame < 660 && sim.corePosition().z > -150) {
      if (sim.frame === delay) keys.press(0);
      sim.step();
      const q = sim.physics.tiles[0].quaternion;
      expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.95);
    }
    expect(sim.corePosition().z).toBeLessThanOrEqual(-150);
    expect(Math.abs(-sim.coreVelocity().z - 10.969)).toBeLessThan(0.7);
  } finally { await sim.dispose(); }
});

it('measures every station once, reproduces the log on a replay and restarts timing on reset', async () => {
  const scenario = scenarioById('tow-basin');
  const keys = new KeyState(new EventTarget());
  const live = new RustSimulation(RAFT, keys, { scenario });
  const replay = new RustSimulation(RAFT, new KeyState(new EventTarget()), { scenario });
  try {
    await live.start();
    keys.press(0);
    const finish = () => {
      for (let i = 0; i < 700 && live.waterPasses.size < 6; i++) live.step();
      return [...live.waterPasses];
    };
    const first = finish();
    expect(first.map(([distance]) => distance)).toEqual([25, 50, 75, 100, 125, 150]);
    for (let i = 1; i < first.length; i++) {
      expect(first[i][1].seconds).toBeGreaterThan(first[i - 1][1].seconds);
      expect(first[i][1].speedKmh).toBeGreaterThan(34);
    }
    await replay.start();
    replay.player = live.recording;
    while (replay.frame < live.frame) replay.step();
    expect([...replay.waterPasses]).toEqual(first);
    live.reset();
    expect(live.waterPasses.size).toBe(0);
    const second = finish();
    expect(second.length).toBe(6);
    expect(second[0][1].seconds).toBeLessThan(6);
  } finally { await live.dispose(); await replay.dispose(); }
});
