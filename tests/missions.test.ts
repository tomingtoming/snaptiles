import { describe, expect, it } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';
import { MISSIONS, MissionProgress } from '../src/challenge/scenarios';

// Every mission fails with its starting model and clears with a short solution, so a physics change cannot leave a
// lesson unsolvable (or solved without any Lua).
const SOLUTIONS: Record<string, [string, string]> = {
  balance: ['ENGINE = 0 ', 'ENGINE = 20000 * tilt - 2000 * spin '],
  hover: ['local power = 7300 ', 'local power = 7300 + (3 - h) * 6000 - vy * 4000 '],
  'terrain-hover': ['local h = _Y(0)', 'local h = _H(0)'],
  cruise: ['ENGINE = 300 ', 'ENGINE = (10 - speed) * 300 '],
  stop: ['ENGINE = 300 ', 'ENGINE = (z + 50) * 40 + vz * 150 '],
  shuttle: ['ENGINE = (z + 30) * 40 + vz * 150 ', 'if z < -29 then back = true end  ENGINE = (z - (back and 0 or -30)) * 40 + vz * 150 '],
  lane: ['HANDLE = 0 ', 'HANDLE = (x - 5) * 3 + vx * 6 '],
};

async function framesToClear(source: string, mission: (typeof MISSIONS)[number]): Promise<number> {
  const sim = new RustSimulation(source, new KeyState(new EventTarget()), { scenario: mission });
  try {
    await sim.start();
    const progress = new MissionProgress(mission);
    for (let f = 0; f < mission.timeLimit * 30; f++) {
      sim.step();
      const core = sim.physics.tiles[0];
      const clearance = mission.mission?.hold.kind === 'clearance' ? Number(sim.apiValue('_H', 0)) : undefined;
      if (progress.step(sim.frame, { position: core.position, quaternion: core.quaternion }, sim.coreVelocity(), clearance)) return sim.frame;
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
