// Challenges (a SnapTiles extra, not in the original): a fixed course, a goal zone, a budget and a time limit. Build
// any model within the budget and bring its Core into the goal; the run's time and the model's cost are the scores.
// Courses lie toward −Z, where the samples drive under ↑. A run is recorded from its first step, so a record link
// (model + run + challenge) is re-run and checked in the receiver's browser.
import type { Assembly } from '../model/assemble';

/** a static solid: the convex hull of its points (x, y, z) */
export type Solid = [number, number, number][];

export interface Scenario {
  id: string;
  title: string;
  description: string;
  /** cost limit (COSTS per part) */
  budget: number;
  /** seconds */
  timeLimit: number;
  /** its own ground (else the endless flat ground), plus obstacles */
  ground?: Solid[];
  solids: Solid[];
  /** the Core has to enter this box: [x0, x1, y0, y1, z0, z1] */
  goal: [number, number, number, number, number, number];
}

export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => [
  [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
];

/** a slope rising toward −Z from zStart to zTop (height h), then flat at h to zEnd */
const ramp = (x0: number, x1: number, zStart: number, zTop: number, h: number, zEnd: number): Solid => [
  [x0, 0, zStart], [x1, 0, zStart], [x0, 0, zEnd], [x1, 0, zEnd], [x0, h, zTop], [x1, h, zTop], [x0, h, zEnd], [x1, h, zEnd],
];

/** cost per part type; the Core is free and a Cowl (no collision, no mass) costs nothing */
export const COSTS: Record<string, number> = {
  core: 0, chip: 1, frame: 1, rudder: 2, rudderf: 2, trim: 2, trimf: 2, weight: 3, wheel: 5, rlw: 5, jet: 8, arm: 8, cowl: 0,
};

export function modelCost(a: Assembly): number {
  return a.tiles.reduce((sum, t) => sum + (COSTS[t.type] ?? 1), 0);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'sprint',
    title: '100m走',
    description: '平地をまっすぐ100m先のゴールへ。',
    budget: 30,
    timeLimit: 60,
    solids: [],
    goal: [-20, 20, -2, 30, -110, -100],
  },
  {
    id: 'hill',
    title: '坂越え',
    description: '高さ6mまで登る坂（約14°）を越え、台の上のゴールへ。',
    budget: 40,
    timeLimit: 90,
    solids: [ramp(-12, 12, -10, -35, 6, -75)],
    goal: [-12, 12, 5, 30, -70, -58],
  },
  {
    id: 'gap',
    title: '溝越え',
    description: '幅6m・深さ15mの溝を越えて、向こう岸のゴールへ。落ちたら戻れません。',
    budget: 45,
    timeLimit: 60,
    // the banks reach down to the floor of the gap, so nothing falls in under them
    ground: [box(-150, 150, -20, 0, -30, 150), box(-150, 150, -20, 0, -400, -36), box(-150, 150, -20, -15, -36, -30),
      // a wide floor far below: whatever leaves the banks (along the trench, off the sides) stops there
      box(-3000, 3000, -61, -60, -3000, 3000)],
    solids: [],
    goal: [-20, 20, -2, 30, -72, -60],
  },
];

export const scenarioById = (id: string | null | undefined): Scenario | null => SCENARIOS.find((s) => s.id === id) ?? null;

export function inGoal(s: Scenario, p: { x: number; y: number; z: number }): boolean {
  const [x0, x1, y0, y1, z0, z1] = s.goal;
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
}
