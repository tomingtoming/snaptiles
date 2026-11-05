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
  /** the Core has to enter this box: [x0, x1, y0, y1, z0, z1] (challenges) */
  goal?: [number, number, number, number, number, number];
  /** a mission (a Lua lesson): its starting model, and the state the model has to hold for `seconds` */
  mission?: {
    starter: string;
    hold:
      | { kind: 'upright'; maxTilt: number; seconds: number }
      | { kind: 'altitude'; min: number; max: number; seconds: number }
      | { kind: 'speed'; min: number; max: number; seconds: number }
      /** the Core inside the goal box, nearly still */
      | { kind: 'stop'; maxSpeed: number; seconds: number };
    hint: string;
  };
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

const SEGWAY = `// ミッション：セグウェイを倒さずに10秒立たせよう（Luaで車輪を回す）
// _EX(0) は前後の傾き（ラジアン）、_WX(0) はその傾きが変わる速さ。傾いた側へ車輪を回すと、体の下に車輪が戻って立ち直る。
Val { ENGINE(default=0,min=-8000,max=8000) }
Key { }
Body { Core(){ W:Wheel(angle=90,power=-ENGINE){ } E:Wheel(angle=90,power=ENGINE){ } N:Chip(angle=-90){ N:Chip(){ N:Weight(){ } } } } }
Lua {
function OnFrame()
  local tilt = _EX(0)  -- 傾き
  local spin = _WX(0)  -- 傾く速さ
  ENGINE = 0           -- ここを書こう（ヒント：ENGINE = 傾き × 大きな数 ＋ 傾く速さ × 数。符号も試そう）
  out(0, "傾き ", tilt)
end
}
`;

const HOVER_LESSON = `// ミッション：ホバーを高さ2.5〜3.5mに10秒保とう（Luaで4つのジェットの出力を決める）
// _H(0) は地面からの高さ、_VY(0) は上下の速さ。高さが足りなければ強く、上がりすぎたら弱く。
Val
{
  J_FL(default=0, min=0, max=60000, disp=0)
  J_FR(default=0, min=0, max=60000, disp=0)
  J_RL(default=0, min=0, max=60000, disp=0)
  J_RR(default=0, min=0, max=60000, disp=0)
}
Key { }
Body
{
  Core(color=#f2b705){
    N:Chip(color=#d8d8d8){
      W:Chip(color=#d8d8d8){ W:Jet(power=J_FL, color=#ff6a3d){ } }
      E:Chip(color=#d8d8d8){ E:Jet(power=J_FR, color=#ff6a3d){ } }
    }
    S:Chip(color=#d8d8d8){
      W:Chip(color=#d8d8d8){ W:Jet(power=J_RL, color=#ff6a3d){ } }
      E:Chip(color=#d8d8d8){ E:Jet(power=J_RR, color=#ff6a3d){ } }
    }
  }
}
Lua
{
function OnFrame()
  local h = _H(0)    -- 高さ
  local vy = _VY(0)  -- 上下の速さ
  local power = 7300 -- 浮いていられる出力の目安。ここを高さと速さで変えよう（ヒント：7300 ＋ (3 − 高さ) × 数 − 速さ × 数）
  J_FL = power J_FR = power J_RL = power J_RR = power
  out(0, "高さ ", h)
end
}
`;

const CAR_LESSON = (title: string, note: string, line: string) => `// ミッション：${title}
// ${note}
Val { ENGINE(default=0,min=-1000,max=1000) }
Key { }
Body { Core(){ N:Chip(){ W:Wheel(angle=90,power=-ENGINE){ } E:Wheel(angle=90,power=ENGINE){ } } S:Chip(){ W:Wheel(angle=90,power=-ENGINE){ } E:Wheel(angle=90,power=ENGINE){ } } } }
Lua {
lastZ = 0
function OnFrame()
  local speed = _VEL(0)          -- 速さ（m/s）
  local z = _Z(0)                -- 前後の位置（前へ進むと減る。スタートは0）
  local vz = (z - lastZ) * 30    -- 前後の速度（前のフレームとの差 × 30）
  lastZ = z
${line}
  out(0, "速さ ", speed, "  位置 ", z)
end
}
`;

/** missions: Lua lessons on a bare field; the starting model is loaded into the editor */
export const MISSIONS: Scenario[] = [
  {
    id: 'balance',
    title: 'セグウェイを立たせる',
    description: '傾きを見て車輪を回し、倒れずに10秒立ち続ける。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    mission: { starter: SEGWAY, hold: { kind: 'upright', maxTilt: 0.35, seconds: 10 }, hint: '傾き（_EX）と傾く速さ（_WX）から ENGINE を決める（PD制御）' },
  },
  {
    id: 'hover',
    title: 'ホバーで高さを保つ',
    description: '4つのジェットの出力を決めて、高さ2.5〜3.5mに10秒とどまる。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    mission: { starter: HOVER_LESSON, hold: { kind: 'altitude', min: 2.5, max: 3.5, seconds: 10 }, hint: '高さ（_H）と上下の速さ（_VY）から出力を決める' },
  },
  {
    id: 'cruise',
    title: '速さを保つ',
    description: '車を秒速9〜11mで10秒走らせ続ける（出しっぱなしでは速くなりすぎる）。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    mission: {
      starter: CAR_LESSON('速さを秒速10m前後に10秒保とう', '出力を一定にすると、どんどん速くなる。速さを見て出力を変えよう。', '  ENGINE = 300                   -- ここを書こう（ヒント：ENGINE = (10 − 速さ) × 数）'),
      hold: { kind: 'speed', min: 9, max: 11, seconds: 10 },
      hint: '目標との差（10 − 速さ）に比例して出力を決める（P制御）',
    },
  },
  {
    id: 'stop',
    title: '決めた所で止まる',
    description: '50m先の緑の範囲で止まり、3秒じっとしている。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    goal: [-10, 10, -2, 6, -52, -48],
    mission: {
      starter: CAR_LESSON('50m先の緑の範囲でぴたりと止まろう', '残りの距離は z + 50（止まる所で0）。近づいたら弱め、行き過ぎたら戻る。速度 vz でブレーキをかけると行き過ぎない。', '  ENGINE = 300                   -- ここを書こう（ヒント：ENGINE = (z + 50) × 数 ＋ vz × 数）'),
      hold: { kind: 'stop', maxSpeed: 0.3, seconds: 3 },
      hint: '残りの距離（z + 50）と速度（vz）から出力を決める（PD制御）',
    },
  },
];

export const scenarioById = (id: string | null | undefined): Scenario | null => [...SCENARIOS, ...MISSIONS].find((s) => s.id === id) ?? null;

/** whether the model holds a mission's state this frame: the Core's tilt from upright, its height, its speed, or it
 *  standing still in the goal box */
export function holds(
  s: Scenario,
  core: { position: { x: number; y: number; z: number }; quaternion: { x: number; z: number } },
  velocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): boolean {
  const h = s.mission?.hold;
  if (!h) return false;
  if (h.kind === 'altitude') return core.position.y >= h.min && core.position.y <= h.max;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (h.kind === 'speed') return speed >= h.min && speed <= h.max;
  if (h.kind === 'stop') return inGoal(s, core.position) && speed <= h.maxSpeed;
  const q = core.quaternion;
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) <= h.maxTilt;
}

export function inGoal(s: Scenario, p: { x: number; y: number; z: number }): boolean {
  if (!s.goal) return false;
  const [x0, x1, y0, y1, z0, z1] = s.goal;
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
}
