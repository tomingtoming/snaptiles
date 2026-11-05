// Challenges (a SnapTiles extra, not in the original): a fixed course, a goal zone, a budget and a time limit. Build
// any model within the budget and bring its Core into the goal; the run's time and the model's cost are the scores.
// Courses lie toward −Z, where the samples drive under ↑. A run is recorded from its first step, so a record link
// (model + run + challenge) is re-run and checked in the receiver's browser.
import { hoverModel } from '../samples/hover';
import type { Assembly } from '../model/assemble';
import { FRAME_RATE } from '../sim/sim-view';

/** a static solid: the convex hull of its points (x, y, z) */
export type Solid = [number, number, number][];

export interface Scenario {
  id: string;
  title: string;
  freeDrive?: boolean;
  description: string;
  /** cost limit (COSTS per part) */
  budget: number;
  /** seconds */
  timeLimit: number;
  /** its own ground (else the endless flat ground), plus obstacles */
  ground?: Solid[];
  terrainBounds?: [number, number, number, number]; // x min/max, z min/max of the driving area
  compareRoad?: { id: string; label: string };
  brakeLine?: number; // z of the common braking reference, measured toward north
  runway?: { width: number; north: number; south: number };
  terrainColorRange?: [number, number]; // elevations of the low and high ground colours
  terrainFaces?: Solid; // exposed triangles of a continuous terrain, in draw order
  /** Rectangular road surfaces. Bounds use the same x/y/z pairs as box(). */
  surfaces?: { bounds: [number, number, number, number, number, number]; grip: number; color: number }[];
  solids: Solid[];
  /** the Core has to enter this box: [x0, x1, y0, y1, z0, z1] (challenges) */
  goal?: [number, number, number, number, number, number];
  checkpoint?: Scenario['goal'];
  showGateAltitude?: boolean;
  /** a mission (a Lua lesson): its starting model, and the state the model has to hold for `seconds` */
  mission?: {
    starter: string;
    hold:
      | { kind: 'upright'; maxTilt: number; seconds: number }
      | { kind: 'altitude'; min: number; max: number; seconds: number }
      | { kind: 'clearance'; min: number; max: number; minSpeed: number; seconds: number }
      | { kind: 'speed'; min: number; max: number; seconds: number }
      /** the Core inside the goal box, nearly still */
      | { kind: 'stop'; maxSpeed: number; seconds: number }
      /** the Core inside the goal box (a strip), moving */
      | { kind: 'lane'; minSpeed: number; seconds: number };
    /** a box the Core has to pass through before the hold counts */
    via?: [number, number, number, number, number, number];
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
  return typesCost(a.tiles.map(t => t.type));
}

/** the cost of parts of these types (lower case, as the assembly names them) */
export function typesCost(types: string[]): number {
  return types.reduce((sum, t) => sum + (COSTS[t] ?? 1), 0);
}

/** the cost per part type, largest first: "Wheel 4×5=20 · Chip 2×1=2" (the Core and Cowls cost nothing and are left out) */
export function costBreakdown(a: Assembly): string {
  const count = new Map<string, number>();
  for (const t of a.tiles) count.set(t.type, (count.get(t.type) ?? 0) + 1);
  const label = (type: string) => TYPE_LABELS[type] ?? type;
  return [...count].map(([type, n]) => ({ type, n, total: n * (COSTS[type] ?? 1) }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type))
    .map(r => `${label(r.type)} ${r.n}×${COSTS[r.type] ?? 1}=${r.total}`)
    .join(' · ');
}

const TYPE_LABELS: Record<string, string> = {
  chip: 'Chip', frame: 'Frame', rudder: 'Rudder', rudderf: 'RudderF', trim: 'Trim', trimf: 'TrimF', weight: 'Weight', wheel: 'Wheel',
  rlw: 'RLW', jet: 'Jet', arm: 'Arm', cowl: 'Cowl', core: 'Core',
};

/** An original pass between two ridges. Each triangle has its own convex collider so
 * a hull across an entire valley cannot bridge the hollow. Coordinates are in metres. */
function mountainPass(runway = 0): Pick<Scenario, 'ground' | 'terrainFaces' | 'terrainBounds'> {
  const xs = [-70, -32, -12, 0, 12, 32, 70];
  const zs = [35, 0, -12, -32, -55, -74, -100, -130].map(z => z < 0 ? z - runway : z);
  const heights = [
    [0, 0, 0, 0, 0, 0, 0],
    [1, 1, 0, 0, 0, 1, 1],
    [3, 2, 0, 0, 0, 4, 3],
    [7, 10, 4, 2, 4, 12, 8],
    [9, 17, 8, 6, 8, 20, 10],
    [6, 12, 5, 3, 4, 14, 8],
    [2, 4, 0, 0, 0, 5, 3],
    [0, 0, 0, 0, 0, 0, 0],
  ];
  return heightfield(xs, zs, heights);
}

/** xs increase and zs decrease so the top triangles face upwards. Render faces
 * and convex ground prisms share the same samples and diagonal in every cell. */
function heightfield(xs: number[], zs: number[], heights: number[][]): Pick<Scenario, 'ground' | 'terrainFaces' | 'terrainBounds'> {
  // A very thin convex hull at this width gives an unreliable running surface.
  const ground = [box(-3000, 3000, -104, -4, -3000, 3000)];
  const vertex = (row: number, col: number): Solid[number] => [xs[col], heights[row][col], zs[row]];
  // Only the exposed faces are drawn; internal prism walls meet exactly at the riding surface.
  const terrainFaces: Solid = [
    [-3000, -4, 3000], [3000, -4, 3000], [-3000, -4, -3000],
    [3000, -4, 3000], [3000, -4, -3000], [-3000, -4, -3000],
  ];
  // Widen the perimeter on its outward axes. Neighbouring slopes share their outer
  // vertices, including at corners, and meet the surrounding plain at y = -4.
  function foot([x, , z]: Solid[number]): Solid[number] {
    const outerX = x === xs[0] ? x - 65 : x === xs[xs.length - 1] ? x + 65 : x;
    const outerZ = z === zs[0] ? z + 45 : z === zs[zs.length - 1] ? z - 45 : z;
    return [outerX, -4, outerZ];
  }
  function shoulder(a: Solid[number], b: Solid[number]): void {
    const lowA = foot(a), lowB = foot(b);
    ground.push(triangle(a, lowA, b), triangle(b, lowA, lowB));
  }
  function triangle(...top: Solid): Solid {
    terrainFaces.push(...top);
    return [...top, ...top.map(([x, , z]): Solid[number] => [x, -4, z])];
  }
  for (let row = 1; row < zs.length; row++) {
    for (let col = 1; col < xs.length; col++) {
      const a = vertex(row - 1, col - 1), b = vertex(row - 1, col);
      const c = vertex(row, col - 1), d = vertex(row, col);
      ground.push(triangle(a, b, c), triangle(b, d, c));
      if (row === 1) shoulder(a, b);
      if (row === zs.length - 1) shoulder(d, c);
      if (col === 1) shoulder(c, a);
      if (col === xs.length - 1) shoulder(b, d);
    }
  }
  return { ground, terrainFaces, terrainBounds: [xs[0], xs[xs.length - 1], zs[zs.length - 1], zs[0]] };
}

const pass = mountainPass();
/** Six transverse humps. The left side barely ripples; the right side reaches
 * axle height. A long flat entry and runout allow a repeatable approach. */
function washboard(): Pick<Scenario, 'ground' | 'terrainFaces' | 'terrainBounds'> {
  const xs = [-22, -8, 0, 8, 22];
  const zs = [18, 0, -12];
  const flat = xs.map(() => 0);
  const crest = [0.12, 0.12, 0.32, 0.55, 0.55];
  const heights = [flat, flat, flat];
  for (let hump = 0; hump < 6; hump++) {
    zs.push(-15 - hump * 6, -18 - hump * 6);
    heights.push(crest, flat);
  }
  zs.push(-80);
  heights.push(flat);
  return heightfield(xs, zs, heights);
}

/** A kilometre-wide original plateau. Four rounded massifs flank a winding
 * valley. The central strip is kept level for takeoff. Round the authored
 * samples to decimetres before passing them to either physics or rendering. */
function highlands(): Pick<Scenario, 'ground' | 'terrainFaces' | 'terrainBounds'> {
  const grid = Array.from({ length: 21 }, (_, i) => (i - 10) * 50);
  const xs = [...grid, -25, 25].sort((a, b) => a - b);
  const zs = [...grid].reverse();
  const peaks = [
    { x: -265, z: -250, height: 118, width: 125, depth: 160 },
    { x: 210, z: -310, height: 98, width: 135, depth: 110 },
    { x: 290, z: 145, height: 86, width: 110, depth: 170 },
    { x: -225, z: 285, height: 64, width: 145, depth: 115 },
  ];
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const heights = zs.map(z => xs.map(x => {
    let h = 9 + 5 * Math.sin((x + z) / 92);
    for (const peak of peaks) {
      const dx = (x - peak.x) / peak.width, dz = (z - peak.z) / peak.depth;
      h += peak.height * Math.exp(-dx * dx - dz * dz);
    }
    const valley = clamp((Math.abs(x - 75 * Math.sin(z / 150)) - 20) / 95);
    h *= 0.25 + 0.75 * valley;
    const runway = clamp(Math.max(Math.abs(x) - 25, -155 - z, z - 55) / 70);
    const edge = clamp((500 - Math.max(Math.abs(x), Math.abs(z))) / 100);
    return Math.round(h * runway * edge * 10) / 10;
  }));
  return heightfield(xs, zs, heights);
}

const GRASS_RUNWAY = { width: 12, north: -112, south: 8 };

function brakeTrack(normal: boolean): Scenario {
  const dry = { grip: 1, color: 0x81888a }, slick = { grip: 0.18, color: 0x90c4d1 };
  return {
    id: normal ? 'brake-track-normal' : 'brake-track',
    compareRoad: normal ? { id: 'brake-track', label: '低グリップで試す' } : { id: 'brake-track-normal', label: '通常路で試す' },
    brakeLine: -36,
    title: normal ? '制動試験路・通常路' : '制動試験路',
    description: '青い帯は低グリップ路、両脇は通常路。白い横線でブレーキをかけ、5m刻みの目盛りで停止位置を比べられます。',
    freeDrive: true,
    budget: Infinity,
    timeLimit: Infinity,
    ground: [box(-1000, 1000, -81, -1, -1000, 1000)],
    terrainBounds: [-32, 32, -150, 20],
    surfaces: [
      { bounds: [-32, 32, -1, 0, -30, 20], grip: 1, color: 0x81888a },
      { bounds: [-32, -7, -1, 0, -120, -30], ...(normal ? slick : dry) },
      { bounds: [-7, 7, -1, 0, -120, -30], ...(normal ? dry : slick) },
      { bounds: [7, 32, -1, 0, -120, -30], grip: 1, color: 0x81888a },
      { bounds: [-32, 32, -1, 0, -150, -120], grip: 1, color: 0x81888a },
    ],
    solids: [],
  };
}

const normalBrakeTrack = brakeTrack(true);
export const FREE_DRIVES: Scenario[] = [
  brakeTrack(false),
  {
    ...highlands(),
    id: 'highlands',
    runway: GRASS_RUNWAY,
    title: '四峰高原',
    description: '1km四方の高原。中央の平地から飛び立つか、四つの山の間の谷筋を走れます。',
    freeDrive: true,
    terrainColorRange: [4, 105],
    budget: Infinity,
    timeLimit: Infinity,
    solids: [],
  },
  {
    ...pass,
    id: 'mountain-drive',
    title: '峠の自由走行',
    description: '今の機体で尾根や谷を自由に走れます。',
    freeDrive: true,
    budget: Infinity,
    timeLimit: Infinity,
    solids: [],
  },
  {
    ...washboard(),
    terrainColorRange: [0, 0.5],
    id: 'washboard',
    title: '波状路',
    description: '前方に6本の起伏。左は12cm、中央は32cm、右は55cm。車輪や足回りを試せます。',
    freeDrive: true,
    budget: Infinity,
    timeLimit: Infinity,
    solids: [],
  },
];

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
  {
    id: 'mountain-pass',
    title: '峠越え',
    description: '二つの尾根の間を登り、峠を下った先の緑のゴールへ。',
    budget: 45,
    timeLimit: 90,
    ...pass,
    solids: [],
    goal: [-10, 10, 0, 6, -116, -103],
  },
  {
    ...pass,
    id: 'ridge-turn',
    title: '峠の切り返し',
    description: '左手の黄色い中間地点を通り、峠を越えて右手の緑のゴールへ。',
    budget: 45,
    timeLimit: 100,
    solids: [],
    checkpoint: [-16, -3, 0, 12, -42, -26],
    goal: [4, 20, 0, 8, -114, -91],
  },
  {
    ...mountainPass(120),
    id: 'pass-flyover',
    runway: GRASS_RUNWAY,
    showGateAltitude: true,
    title: '峠の空路',
    description: '滑走路を離陸して、峠の黄色い空域から緑のゴールへ。標準のplaneはZで加速、↓で上昇。',
    budget: 100,
    timeLimit: 60,
    solids: [],
    checkpoint: [-18, 18, 8, 26, -184, -167],
    goal: [-24, 24, 14, 38, -261, -236],
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

const LANE_LESSON = `// ミッション：走りながら横へ5m移り、緑の帯（_X が5の所）の中を10秒走ろう
// _X(0) は左右の位置（スタートは0）。ハンドルを切ると曲がり、横の速さ vx が付く。行き過ぎないよう vx でも戻す。
Val { ENGINE(default=0,min=-1000,max=1000) HANDLE(default=0,min=-30,max=30) }
Key { }
Body
{
  Core(){
    N:Chip(){
      N:Chip(){
        W:Chip(){ W:Rudder(angle=HANDLE){ W:Frame(angle=90){ W:Wheel(power=-ENGINE) } } }
        E:Chip(){ E:Rudder(angle=HANDLE){ E:Frame(angle=90){ E:Wheel(power=ENGINE) } } }
      }
    }
    S:Chip(){
      S:Chip(){
        W:Chip(){ W:Frame(angle=90){ W:Wheel(power=-ENGINE) } }
        E:Chip(){ E:Frame(angle=90){ E:Wheel(power=ENGINE) } }
      }
    }
  }
}
Lua {
lastX = 0
function OnFrame()
  local x = _X(0)                -- 左右の位置
  local vx = (x - lastX) * 30    -- 横の速さ（前のフレームとの差 × 30）
  lastX = x
  ENGINE = 300
  HANDLE = 0                     -- ここを書こう（ヒント：HANDLE = (x − 5) × 数 ＋ vx × 数）
  out(0, "左右の位置 ", x)
end
}
`;

/** missions: Lua lessons, easiest first; the starting model is loaded into the editor */
export const MISSIONS: Scenario[] = [
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
  {
    id: 'shuttle',
    title: '行って帰る',
    description: '30m先の黄色い範囲まで行き、スタートの緑の範囲へ戻って3秒止まる。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    goal: [-10, 10, -2, 6, -2, 2],
    mission: {
      starter: CAR_LESSON('30m先まで行って、スタートへ戻って止まろう', '今の式は30m先で止まるだけ。着いたことを変数に覚えておき、帰りは目標を0にしよう。変数は次のフレームにも残る。', '  ENGINE = (z + 30) * 40 + vz * 150   -- ここを書き足そう（ヒント：if z < -29 then back = true end、目標を back で切り替える）'),
      via: [-10, 10, -2, 6, -32, -28],
      hold: { kind: 'stop', maxSpeed: 0.3, seconds: 3 },
      hint: '着いたかどうかを変数に覚えて、目標を切り替える（状態を持つプログラム）',
    },
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
    ...pass,
    id: 'terrain-hover',
    title: '斜面に沿って飛ぶ',
    description: '自動で前進するホバー機で、緑の区間を飛びながら地面から2.5〜4.5mの高さを4秒保とう。',
    budget: 999,
    timeLimit: 45,
    solids: [],
    goal: [-20, 20, -4, 25, -82, -30],
    mission: {
      starter: hoverModel('ミッション：斜面からの高さを保とう。Luaで高さの測り方を選ぶ。', 4,
        'FWD = clamp((5 + _VZ(0)) * 0.6, -1, 1)  -- 前進速度を保つ\n    local h = _Y(0)  -- ここを変更：斜面の真下までの距離を測ろう'),
      hold: { kind: 'clearance', min: 2.5, max: 4.5, minSpeed: 2, seconds: 4 },
      hint: '_Y(0)は標高、_H(0)は真下の地面までの距離',
    },
  },
  {
    id: 'lane',
    title: '線に乗り換える',
    description: '走りながら横へ5m（_X が5の所）移って緑の帯に入り、帯の中を10秒走り続ける。',
    budget: 999,
    timeLimit: 40,
    solids: [],
    goal: [-6, -4, -2, 6, -2000, 50],
    mission: {
      starter: LANE_LESSON,
      hold: { kind: 'lane', minSpeed: 4, seconds: 10 },
      hint: '目標の線との差（x − 5）と横の速さ（vx）からハンドルを決める（符号も試そう）',
    },
  },
  {
    id: 'balance',
    title: 'セグウェイを立たせる',
    description: '傾きを見て車輪を回し、倒れずに10秒立ち続ける。',
    budget: 999,
    timeLimit: 60,
    solids: [],
    mission: { starter: SEGWAY, hold: { kind: 'upright', maxTilt: 0.35, seconds: 10 }, hint: '傾き（_EX）と傾く速さ（_WX）から ENGINE を決める（PD制御）' },
  },
];

export const scenarioById = (id: string | null | undefined): Scenario | null => [normalBrakeTrack, ...FREE_DRIVES, ...SCENARIOS, ...MISSIONS].find((s) => s.id === id) ?? null;

/** whether the model holds a mission's state this frame: the Core's tilt from upright, its height, its speed, or it
 *  standing still in the goal box */
export function holds(
  s: Scenario,
  core: { position: { x: number; y: number; z: number }; quaternion: { x: number; z: number } },
  velocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  clearance?: number,
): boolean {
  const h = s.mission?.hold;
  if (!h) return false;
  if (h.kind === 'clearance') {
    return clearance !== undefined && clearance >= h.min && clearance <= h.max
      && inGoal(s, core.position) && Math.hypot(velocity.x, velocity.z) >= h.minSpeed;
  }
  if (h.kind === 'altitude') return core.position.y >= h.min && core.position.y <= h.max;
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (h.kind === 'speed') return speed >= h.min && speed <= h.max;
  if (h.kind === 'stop') return inGoal(s, core.position) && speed <= h.maxSpeed;
  if (h.kind === 'lane') return inGoal(s, core.position) && speed >= h.minSpeed;
  const q = core.quaternion;
  return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) <= h.maxTilt;
}

export function inGoal(s: Scenario, p: { x: number; y: number; z: number }): boolean {
  return !!s.goal && inBox(s.goal, p);
}

export function inBox([x0, x1, y0, y1, z0, z1]: number[], p: { x: number; y: number; z: number }): boolean {
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
}

/** a mission's progress, one call per frame: whether the Core has passed `via` (when the mission has one), and how many
 *  frames in a row it has held the state since */
export class MissionProgress {
  held = 0;
  /** the frame the Core first entered `via`, or null */
  visitedAt: number | null = null;
  constructor(readonly scenario: Scenario) {}
  /** this frame's state; true once the hold has lasted long enough */
  step(frame: number, core: { position: { x: number; y: number; z: number }; quaternion: { x: number; z: number } }, velocity: { x: number; y: number; z: number }, clearance?: number): boolean {
    const m = this.scenario.mission!;
    if (m.via && this.visitedAt === null && inBox(m.via, core.position)) this.visitedAt = frame;
    const ready = !m.via || this.visitedAt !== null;
    this.held = ready && holds(this.scenario, core, velocity, clearance) ? this.held + 1 : 0;
    return this.held >= m.hold.seconds * FRAME_RATE;
  }
  /** a re-run to `frame`: the hold starts over, a pass through `via` after that frame is undone */
  rewind(frame: number): void {
    this.held = 0;
    if (this.visitedAt !== null && this.visitedAt >= frame) this.visitedAt = null;
  }
}
