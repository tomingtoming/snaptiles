import { describe, expect, it } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';
import { MISSIONS, holds } from '../src/challenge/scenarios';

// Every mission fails with its starting model and clears with a short solution, so a physics change cannot leave a
// lesson unsolvable (or solved without any Lua).
const SOLUTIONS: Record<string, [string, string]> = {
  balance: ['ENGINE = 0 ', 'ENGINE = 20000 * tilt - 2000 * spin '],
  hover: ['local power = 7300 ', 'local power = 7300 + (3 - h) * 6000 - vy * 4000 '],
};

async function framesToClear(source: string, mission: (typeof MISSIONS)[number]): Promise<number> {
  const sim = new RustSimulation(source, new KeyState(new EventTarget()), { scenario: mission });
  try {
    await sim.start();
    const need = mission.mission!.hold.seconds * 30;
    let held = 0;
    for (let f = 0; f < mission.timeLimit * 30; f++) {
      sim.step();
      const core = sim.physics.tiles[0];
      held = holds(mission, { position: core.position, quaternion: core.quaternion }) ? held + 1 : 0;
      if (held >= need) return sim.frame;
      expect(sim.scriptError).toBeNull();
    }
    return -1;
  } finally { await sim.dispose(); }
}

describe('missions', () => {
  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s fails as given and clears with a solution', async (id, mission) => {
    const [from, to] = SOLUTIONS[id];
    const starter = mission.mission!.starter;
    expect(starter).toContain(from);
    expect(await framesToClear(starter, mission)).toBe(-1);
    const cleared = await framesToClear(starter.replace(from, to), mission);
    expect(cleared).toBeGreaterThan(0);
    expect(cleared).toBeLessThan(mission.timeLimit * 30);
  }, 60000);
});
