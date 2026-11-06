import { expect, it } from 'vitest';
import { box, type Scenario } from '../src/challenge/scenarios';
import { KeyState } from '../src/input/keys';
import { RustSimulation } from '../src/sim/rust-simulation';
import { decodeRecording, encodeRecording } from '../src/sim/replay';

const model = `Val {}\nKey {}\nBody { Core(){ N:Weight(angle=90,option=8){ N:Weight(option=8){} } S:Weight(option=8){} } }\nLua { function OnFrame() end }`;
const scenario: Scenario = {
  id: 'crash-test', title: 'Crash test', description: '', budget: 1000, timeLimit: 100,
  ground: [box(-1000, 1000, -301, -300, -1000, 1000)], solids: [],
};
const make = () => new RustSimulation(model, new KeyState(new EventTarget()), { scenario });
const parents = (s: RustSimulation) => s.physics.tiles.map(t => s.api()._PARENT(t.tile.chipIndex));
const snapshot = (s: RustSimulation) => JSON.stringify(s.physics.tiles.map(t => [
  ...t.position.toArray(), ...t.quaternion.toArray(), s.api()._PARENT(t.tile.chipIndex), s.api()._T(t.tile.chipIndex),
]));

it('replays a collision breakup exactly and resets its connections', async () => {
  const live = make(), replay = make();
  try {
    await live.start();
    const original = parents(live), trace: string[] = [];
    let broken = false;
    for (let f = 0; f < 700; f++) {
      live.step();
      if (parents(live).some((p, i) => i > 0 && p === -1)) broken = true;
      trace.push(snapshot(live));
    }
    expect(broken).toBe(true);
    expect(live.physics.tiles.every(t => live.api()._T(t.tile.chipIndex) === 10000)).toBe(true);
    await replay.start();
    replay.player = await decodeRecording(await encodeRecording(live.recording));
    for (const expected of trace) { replay.step(); expect(snapshot(replay)).toBe(expected); }
    live.reset();
    expect(parents(live)).toEqual(original);
  } finally { await live.dispose(); await replay.dispose(); }
}, 30000);

it('honors Unbreakable in the browser core for the same impact', async () => {
  const sim = make();
  try {
    await sim.start();
    expect(sim.evalLua('_SETREG("U",1)').ok).toBe(true);
    const original = parents(sim);
    for (let i = 0; i < 700; i++) sim.step();
    expect(parents(sim)).toEqual(original);
  } finally { await sim.dispose(); }
}, 30000);
