// A running model on the Rust core (core/, built with Emscripten into core/pkg): the same surface the page and the
// probes use on `Simulation`. The model and its assembly for drawing come from the TypeScript parser and assembler
// (identical to the Rust ones, checked by the stage-1 oracle); bodies, Vals, keys and the script run in the core.
// Per frame the core writes one flat f64 state buffer (layout in core/src/state.rs, indices generated into core-layout.ts) that this class decodes from
// HEAPF64 without per-value calls. The module is loaded on first use.
import * as THREE from 'three';
import { assemble, type Assembly, type TileInstance } from '../model/assemble';
import { parseRc, type RcModel } from '../rc/parser';
import type { KeyState } from '../input/keys';
import type { SnapTilesCoreModule } from '../../core/pkg/snaptiles_core.js';
import { FRAME_RATE, type BodyView, type PhysicsView, type Pose, type SimView, type TileBodyView, type ValState } from './sim-view';

// the state buffer layout, separator, key count and API names are generated from the core (core/tests/bindings.rs)
import {
  BALL, BALL_STRIDE, CRATE, CRATE_STRIDE, HEADER, HEADER_LENGTH, KEY_COUNT, LAYOUT_VERSION, RECORD_SEP, SHELL, SHELL_STRIDE, TEXT_SEP,
  TILE, TILE_STRIDE, type ApiName,
} from './core-layout';
import { Recording, type Command, type FrameInput } from './replay';
import { box, entersBrakingGate, inBox, MissionProgress, type Scenario, type Solid } from '../challenge/scenarios';

let corePromise: Promise<SnapTilesCoreModule> | null = null;
/** load (once) and instantiate the Emscripten module */
export function loadRustCore(): Promise<SnapTilesCoreModule> {
  corePromise ??= import('../../core/pkg/snaptiles_core.js').then((m) => m.default());
  corePromise.catch(() => { corePromise = null; });
  return corePromise;
}

interface V3 { x: number; y: number; z: number }
interface Q4 { x: number; y: number; z: number; w: number }

class RustBody implements BodyView {
  handle = -1;
  readonly lin: V3 = { x: 0, y: 0, z: 0 };
  constructor(private owner: RustSimulation, private tileIndex: number) {}
  mass(): number { return this.owner.tileBodyMass(this.tileIndex); }
  linvel(): V3 { return { ...this.lin }; }
}

class RustTileBody implements TileBodyView {
  body: RustBody;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  spin = 0;
  spinAngle = 0;
  jetPower = 0;
  constructor(public tile: TileInstance, owner: RustSimulation, index: number) {
    this.body = new RustBody(owner, index);
  }
}

/** a free body read from the buffer (balls, crates, shells) */
class RustFreeBody {
  readonly t: V3 = { x: 0, y: 0, z: 0 };
  readonly r: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  readonly v: V3 = { x: 0, y: 0, z: 0 };
  translation(): V3 { return { ...this.t }; }
  rotation(): Q4 { return { ...this.r }; }
  linvel(): V3 { return { ...this.v }; }
}

/** wind the page sets with `wind.set(x, y, z)` (J key) is sent to the core; the core's value (also `_SETWIND`) is
 *  copied back after every step */
class RustWind extends THREE.Vector3 {
  onSet: ((x: number, y: number, z: number) => void) | null = null;
  override set(x: number, y: number, z: number): this {
    super.set(x, y, z);
    this.onSet?.(x, y, z);
    return this;
  }
}

class RustPhysics implements PhysicsView {
  tiles: RustTileBody[] = [];
  balls: { body: RustFreeBody; radius: number; color: [number, number, number]; fixed: boolean }[] = [];
  crates: RustFreeBody[] = [];
  projectiles: { body: RustFreeBody }[] = [];
  wind = new RustWind();
  /** stands in for the rapier world the TypeScript core frees on dispose (probes wrap `world.free`) */
  world: { free(): void };
  constructor(private owner: RustSimulation, free: () => void) {
    this.world = { free };
  }
  pose(tb: TileBodyView, out?: Pose): Pose {
    const t = tb as RustTileBody;
    const position = (out?.position ?? new THREE.Vector3()).copy(t.position);
    const quaternion = (out?.quaternion ?? new THREE.Quaternion()).copy(t.quaternion);
    return { position, quaternion };
  }
  velocity(tb: TileBodyView): THREE.Vector3 {
    return (tb as RustTileBody).vel.clone();
  }
  addBall(radius: number, x: number, y: number, z: number, gravity: number): number {
    return this.owner.addBall(radius, x, y, z, gravity);
  }
}

export interface Breakpoint {
  line: number;
  condition?: string;
  /** stop from this pass on (1: every pass) */
  after?: number;
}

/** the model's Lua syntax (compiled, not run): `line N: message`, a parse error, or '' when it compiles */
export async function checkSource(source: string): Promise<string> {
  const m = await loadRustCore();
  const bytes = new TextEncoder().encode(source);
  const ptr = m._malloc(Math.max(1, bytes.length));
  m.HEAPU8.set(bytes, ptr);
  const out = m.UTF8ToString(m._core_check(ptr, bytes.length));
  m._free(ptr);
  return out;
}

export interface SimOptions {
  scenario?: Scenario | null;
  bare?: boolean;
}

export class RustSimulation implements SimView {
  readonly core = 'rust' as const;
  model: RcModel;
  vals = new Map<string, ValState>();
  assembly: Assembly | null = null;
  physics: RustPhysics;
  out: string[] = [];
  scriptError: string | null = null;
  ticks = 0;
  checkpointPassed = false;
  groundRange?: number;
  readonly missionProgress: MissionProgress | null;
  lines3d: number[] = [];
  lines2d: number[] = [];
  zoomFov = 17.19;
  private chipNames = new Map<string, number>();
  private m: SnapTilesCoreModule | null = null;
  private id = -1;
  private valOrder: (ValState | undefined)[] = [];
  private outGen = 0;
  private errorGen = 0;
  private disposed = false;
  /** every step's inputs and the page's commands since the start: a replay, a rewind or a share link repeat it */
  recording = new Recording();
  /** while set and not exhausted, steps take their inputs and commands from it instead of the keys */
  player: Recording | null = null;
  /** steps since the start (`ticks` restarts at a reset, this does not) */
  frame = 0;
  /** the breakpoint snapshot of the last step, if one was hit: its file line and the locals there */
  breakHit: { line: number; locals: [string, string][] } | null = null;
  /** the source whose Lua block runs now (`source` until a live Lua edit replaces the block) */
  currentSource: string;
  /** the result of the last console line (`evalLua`) */
  lastEval: { ok: boolean; text: string } | null = null;

  readonly scenario: Scenario | null;
  /** bare ground: no course blocks or crates (tests, measurements; the page's `?bare`) */
  readonly bare: boolean;

  /** a challenge's course replaces the default course (and, when it brings one, the ground) */
  constructor(readonly source: string, private keys: KeyState, options: SimOptions = {}) {
    this.scenario = options.scenario ?? null;
    this.missionProgress = this.scenario?.mission ? new MissionProgress(this.scenario) : null;
    this.currentSource = source;
    this.bare = options.bare ?? false;
    this.model = parseRc(source);
    this.physics = new RustPhysics(this, () => this.freeCore());
    this.physics.wind.onSet = (x, y, z) => this.command({ frame: this.frame, kind: 'wind', args: [x || 0, y || 0, z || 0] });
    for (const v of this.model.vals) {
      this.vals.set(v.name.toUpperCase(), {
        name: v.name.toUpperCase(),
        value: v.default,
        default: v.default,
        min: v.min,
        max: v.max,
        step: Math.abs(v.step),
        disp: v.disp === undefined ? true : v.disp !== 0,
        touched: false,
      });
    }
  }

  env = (name: string): number | undefined => {
    const v = this.vals.get(name.toUpperCase());
    if (v) return v.value;
    return this.chipNames.get(name.toUpperCase());
  };

  async start(): Promise<void> {
    this.assembly = assemble(this.model, this.env);
    if (!this.assembly) throw new Error('Body section is missing');
    this.chipNames.clear();
    for (const t of this.assembly.tiles) if (t.name) this.chipNames.set(t.name, t.chipIndex);
    const m = await loadRustCore();
    if (this.disposed) return;
    this.m = m;
    this.id = m._core_create();
    const bytes = new TextEncoder().encode(this.source);
    const ptr = m._malloc(Math.max(1, bytes.length));
    m.HEAPU8.set(bytes, ptr);
    const sc = this.scenario;
    const code = m._core_load(this.id, ptr, bytes.length, (this.bare || sc ? 1 : 0) | (sc?.ground ? 2 : 0));
    m._free(ptr);
    if (code !== 0) throw new Error(m.UTF8ToString(m._core_error(this.id)) || 'model failed to load');
    const solids = [...(sc?.ground ?? []), ...(sc?.solids ?? [])];
    const addSolid = (solid: Solid, index: number, grip = 1) => {
      const at = m._malloc(solid.length * 24);
      m.HEAPF64.set(solid.flat(), at / 8);
      const rejected = grip === 1 ? m._core_add_solid(this.id, at, solid.length) : m._core_add_surface(this.id, at, solid.length, grip);
      m._free(at);
      if (rejected) {
        this.freeCore();
        throw new Error(`${sc!.title}の地形を読み込めませんでした（衝突形状 ${index + 1}）`);
      }
    };
    solids.forEach((points, i) => addSolid(points, i));
    sc?.surfaces?.forEach((surface, i) => addSolid(box(...surface.bounds), solids.length + i, surface.grip));
    const names = m.UTF8ToString(m._core_val_names(this.id));
    this.valOrder = (names ? names.split(TEXT_SEP) : []).map((n) => this.vals.get(n));
    this.buildTiles();
    this.ticks = 0;
    this.read();
  }

  private buildTiles(): void {
    this.physics.tiles = (this.assembly?.tiles ?? []).map((t, i) => new RustTileBody(t, this, i));
  }

  /** true while the steps come from `player` */
  get replaying(): boolean {
    return !!this.player && this.frame < this.player.frames;
  }

  /** a page command (reset, ball, wind): recorded; one issued during a replay ends the replay there */
  private command(c: Command): number {
    // a command lands between frames in the recording; mid-frame it would land inside one, which a replay cannot repeat
    if (this.midFrame) {
      const why = 'フレームの途中で止まっています。続行（またはこのフレームを最後まで）してから使ってください';
      if (c.kind === 'script') this.lastScriptError = why;
      if (c.kind === 'eval') this.lastEval = { ok: false, text: why };
      return -1;
    }
    if (this.replaying) this.player = null;
    return this.apply(c);
  }

  private apply(c: Command): number {
    if (!this.m || this.id < 0) return -1;
    this.recording.commands.push({ ...c, frame: this.frame } as Command);
    if (c.kind === 'script') {
      const err = this.callText(this.m._core_reload_script, c.text);
      if (!err) this.currentSource = c.text;
      this.lastScriptError = err || null;
      this.read();
      return err ? -1 : 0;
    }
    if (c.kind === 'eval') {
      const r = this.callText(this.m._core_eval, c.text);
      this.lastEval = { ok: r.startsWith('o'), text: r.slice(1) };
      this.read();
      return 0;
    }
    if (c.kind === 'reset') {
      this.resetCore();
      return 0;
    }
    if (c.kind === 'wind') {
      this.m._core_set_wind(this.id, c.args[0], c.args[1], c.args[2]);
      this.read();
      return 0;
    }
    const i = this.m._core_add_ball(this.id, ...c.args);
    this.read();
    return i;
  }

  reset(): void {
    this.command({ frame: this.frame, kind: 'reset' });
  }

  private resetCore(): void {
    if (!this.assembly || !this.m || this.id < 0) return;
    this.m._core_reset(this.id);
    this.read(); // default Vals back from the core
    this.assembly = assemble(this.model, this.env) ?? this.assembly; // fresh rest poses, nothing detached
    this.buildTiles();
    this.read();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.world.free();
  }

  private freeCore(): void {
    if (this.m && this.id >= 0) this.m._core_free(this.id);
    this.id = -1;
  }

  /** the live input: held keys, pointer, view size and gamepad axes */
  private liveInput(): FrameInput {
    let keys = 0;
    for (let n = 0; n < KEY_COUNT; n++) if (this.keys.isDown(n)) keys |= 1 << n;
    const ms = this.keys.mouse;
    return {
      keys, mx: ms.x, my: ms.y, ml: ms.l, mr: ms.r, mm: ms.m,
      width: typeof innerWidth === 'number' ? innerWidth : 640,
      height: typeof innerHeight === 'number' ? innerHeight : 480,
      axes: [0, 1, 2, 3, 4, 5].map((i) => this.keys.axes[i] ?? 0),
    };
  }

  private pushInput(input: FrameInput = this.liveInput()): void {
    if (!this.m || this.id < 0) return;
    this.m._core_set_input(this.id, input.keys, input.mx, input.my, input.ml, input.mr, input.mm, input.width, input.height);
    const a = input.axes;
    this.m._core_set_axes(this.id, a[0], a[1], a[2], a[3], a[4], a[5]);
  }

  /** true while the frame's script is suspended at a breakpoint or a line step (the next step resumes it) */
  midFrame = false;

  /** One fixed step in the core: keys → vals → script → clamp → physics (inputs from `player` while replaying). A
   *  breakpoint suspends it mid-frame; the next step resumes the script there and completes the frame. */
  step(): void {
    if (!this.m || this.id < 0) return;
    if (!this.midFrame) this.beginFrame();
    this.m._core_step(this.id, 1);
    this.afterCore();
  }

  /** run the script to its next line and stop there (a new frame starts if none is under way) */
  stepLine(): void {
    if (!this.m || this.id < 0) return;
    if (!this.midFrame) this.beginFrame();
    this.m._core_step_line(this.id);
    this.afterCore();
  }

  /** a frame's inputs and commands, recorded once at its start */
  private beginFrame(): void {
    let input: FrameInput;
    if (this.replaying) {
      for (const c of this.player!.commandsAt(this.frame)) this.apply(c);
      input = this.player!.inputs[this.frame];
    } else input = this.liveInput();
    this.pushInput(input);
    this.recording.inputs.push(input);
  }

  private afterCore(): void {
    const m = this.m!;
    const test = this.scenario?.brakingTest;
    const before = test && !this.checkpointPassed ? this.physics.tiles[0]?.position.clone() : undefined;
    this.read();
    if (!this.midFrame) {
      this.frame++;
      const progress = this.missionProgress;
      const core = this.physics.tiles[0];
      if (progress?.scenario.mission?.hold.kind === 'clearance') this.groundRange = m._core_ground_range(this.id, 0);
      if (progress && progress.clearedAt === null && core && this.frame <= progress.scenario.timeLimit * FRAME_RATE) {
        progress.step(this.frame, core, this.coreVelocity(), this.groundRange);
      }
      if (!this.checkpointPassed && this.scenario?.checkpoint) {
        this.checkpointPassed = test
          ? !!before && entersBrakingGate(this.scenario.checkpoint, before, core.position, -core.vel.z * 3.6, test.entryKmh)
          : inBox(this.scenario.checkpoint, this.corePosition());
      }
    }
    const hit = m.UTF8ToString(m._core_break(this.id));
    this.breakHit = hit ? parseBreak(hit) : null;
  }

  /** the reason a live Lua edit was refused, or its block's error (null after one that took) */
  lastScriptError: string | null = null;

  /** a core call that takes one UTF-8 text and returns a text */
  private callText(fn: (id: number, ptr: number, len: number) => number, text: string): string {
    const m = this.m!;
    const bytes = new TextEncoder().encode(text);
    const ptr = m._malloc(Math.max(1, bytes.length));
    m.HEAPU8.set(bytes, ptr);
    const out = m.UTF8ToString(fn(this.id, ptr, bytes.length));
    m._free(ptr);
    return out;
  }

  /** replace the running Lua block with the one in `source` (recorded, so a rewind or replay repeats it); returns the
   *  reason when refused (the rest of the source changed, or the new block does not load) */
  reloadScript(source: string): string | null {
    this.command({ frame: this.frame, kind: 'script', text: source });
    return this.lastScriptError;
  }

  /** evaluate a console line in the running block (recorded like a command) */
  evalLua(code: string): { ok: boolean; text: string } {
    this.command({ frame: this.frame, kind: 'eval', text: code });
    return this.lastEval ?? { ok: false, text: 'コアがありません' };
  }

  /** the Lua block's own globals and their values (sorted by name) */
  luaWatch(): [string, string][] {
    if (!this.m || this.id < 0) return [];
    const s = this.m.UTF8ToString(this.m._core_lua_watch(this.id));
    return s ? s.split(RECORD_SEP).map((r) => { const i = r.indexOf(TEXT_SEP); return [r.slice(0, i), r.slice(i + 1)] as [string, string]; }) : [];
  }

  /** where the Lua block records its locals: a file line, an optional Lua condition (the line's locals and the globals)
   *  and the pass from which it stops (a step always completes) */
  setBreakpoints(list: Breakpoint[]): void {
    if (!this.m || this.id < 0) return;
    const bytes = new TextEncoder().encode(list.map((b) => [b.line, b.after ?? 1, b.condition ?? ''].join(TEXT_SEP)).join(RECORD_SEP));
    const ptr = this.m._malloc(Math.max(1, bytes.length));
    this.m.HEAPU8.set(bytes, ptr);
    this.m._core_set_breakpoints(this.id, ptr, bytes.length);
    this.m._free(ptr);
  }

  /** decode the state buffer */
  private read(): void {
    const m = this.m;
    if (!m || this.id < 0) return;
    const len = m._core_state_len(this.id);
    if (len < HEADER_LENGTH) return;
    const h = m.HEAPF64;
    let o = m._core_state_ptr(this.id) / 8;
    const at = (slot: number) => h[o + slot];
    if (at(HEADER.VERSION) !== LAYOUT_VERSION) throw new Error(`core state layout ${at(HEADER.VERSION)} (expected ${LAYOUT_VERSION}); rebuild core/pkg`);
    const nTiles = at(HEADER.TILES), nBalls = at(HEADER.BALLS), nCrates = at(HEADER.CRATES), nShells = at(HEADER.SHELLS), nVals = at(HEADER.VALS);
    const n3 = at(HEADER.LINES3D), n2 = at(HEADER.LINES2D);
    this.ticks = at(HEADER.TICKS);
    this.zoomFov = at(HEADER.ZOOM);
    const wind = this.physics.wind;
    wind.x = at(HEADER.WIND_X); wind.y = at(HEADER.WIND_Y); wind.z = at(HEADER.WIND_Z);
    const outGen = at(HEADER.OUT_GENERATION), outRows = at(HEADER.OUT_ROWS), errorGen = at(HEADER.ERROR_GENERATION), hasError = at(HEADER.HAS_ERROR);
    this.midFrame = at(HEADER.MID_FRAME) !== 0;
    if (outGen !== this.outGen) {
      this.outGen = outGen;
      const s = m.UTF8ToString(m._core_out(this.id));
      this.out = outRows > 0 ? s.split(TEXT_SEP) : [];
    }
    if (errorGen !== this.errorGen) {
      this.errorGen = errorGen;
      this.scriptError = hasError ? m.UTF8ToString(m._core_error(this.id)) : null;
    }
    o += HEADER_LENGTH;
    const tiles = this.physics.tiles;
    if (tiles.length !== nTiles) throw new Error(`core has ${nTiles} tiles, the assembly ${tiles.length}`);
    for (let i = 0; i < nTiles; i++, o += TILE_STRIDE) {
      const t = tiles[i];
      t.position.set(at(TILE.PX), at(TILE.PY), at(TILE.PZ));
      t.quaternion.set(at(TILE.QX), at(TILE.QY), at(TILE.QZ), at(TILE.QW));
      t.vel.set(at(TILE.VX), at(TILE.VY), at(TILE.VZ));
      const lin = t.body.lin;
      lin.x = at(TILE.BVX); lin.y = at(TILE.BVY); lin.z = at(TILE.BVZ);
      t.spin = at(TILE.SPIN);
      t.spinAngle = at(TILE.SPIN_ANGLE);
      t.jetPower = at(TILE.JET_POWER);
      t.body.handle = at(TILE.BODY);
    }
    const balls = this.physics.balls;
    balls.length = Math.min(balls.length, nBalls);
    for (let i = 0; i < nBalls; i++, o += BALL_STRIDE) {
      const b = balls[i] ?? (balls[i] = { body: new RustFreeBody(), radius: 0, color: [1, 0, 1], fixed: false });
      setPose(b.body, h, o, BALL);
      b.color[0] = at(BALL.R); b.color[1] = at(BALL.G); b.color[2] = at(BALL.B);
      b.radius = at(BALL.RADIUS);
      b.fixed = at(BALL.FIXED) !== 0;
    }
    const crates = this.physics.crates;
    crates.length = Math.min(crates.length, nCrates);
    for (let i = 0; i < nCrates; i++, o += CRATE_STRIDE) {
      const c = crates[i] ?? (crates[i] = new RustFreeBody());
      setPose(c, h, o, CRATE);
      c.v.x = at(CRATE.VX); c.v.y = at(CRATE.VY); c.v.z = at(CRATE.VZ);
    }
    const shells = this.physics.projectiles;
    shells.length = Math.min(shells.length, nShells);
    for (let i = 0; i < nShells; i++, o += SHELL_STRIDE) {
      const s = shells[i] ?? (shells[i] = { body: new RustFreeBody() });
      s.body.t.x = at(SHELL.PX); s.body.t.y = at(SHELL.PY); s.body.t.z = at(SHELL.PZ);
    }
    for (let i = 0; i < nVals; i++) {
      const v = this.valOrder[i];
      if (v) v.value = at(i);
    }
    o += nVals;
    this.lines3d = n3 > 0 ? Array.from(h.subarray(o, o + n3)) : [];
    o += n3;
    this.lines2d = n2 > 0 ? Array.from(h.subarray(o, o + n2)) : [];
  }

  addBall(radius: number, x: number, y: number, z: number, gravity: number): number {
    return this.command({ frame: this.frame, kind: 'ball', args: [radius, x, y, z, gravity] });
  }

  tileBodyMass(tile: number): number {
    return this.m && this.id >= 0 ? this.m._core_tile_body_mass(this.id, tile) : 0;
  }

  /** seconds per script frame */
  frameDt(): number {
    return 1 / FRAME_RATE;
  }

  /** yaw of the core's forward (-Z) axis */
  coreHeading(): number {
    const tb = this.physics.tiles[0];
    if (!tb) return 0;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(tb.quaternion);
    return Math.atan2(-f.x, -f.z);
  }

  corePosition(): THREE.Vector3 {
    const tb = this.physics.tiles[0];
    return tb ? tb.position.clone() : new THREE.Vector3();
  }

  /** mass-weighted centre of every tile (the original's chase camera target) */
  modelCenter(): THREE.Vector3 {
    const c = new THREE.Vector3();
    let m = 0;
    for (const tb of this.physics.tiles) {
      const w = tb.tile.mass || 1;
      c.addScaledVector(tb.position, w);
      m += w;
    }
    return m > 0 ? c.divideScalar(m) : this.corePosition();
  }

  coreVelocity(): THREE.Vector3 {
    const v = this.physics.tiles[0]?.body.lin;
    return v ? new THREE.Vector3(v.x, v.y, v.z) : new THREE.Vector3();
  }

  /** one script API call (probes, tests, tools; never per frame): numbers and strings in, a number or a string out */
  apiValue(name: ApiName, ...args: (number | string)[]): number | string {
    const m = this.m;
    if (!m || this.id < 0) return 0;
    this.pushInput();
    const put = (text: string): [number, number] => {
      const bytes = new TextEncoder().encode(text);
      const ptr = m._malloc(Math.max(1, bytes.length));
      m.HEAPU8.set(bytes, ptr);
      return [ptr, bytes.length];
    };
    const [namePtr, nameLen] = put(name);
    const [argsPtr, argsLen] = put(args.map((a) => (typeof a === 'string' ? `s${a}` : `n${a}`)).join(TEXT_SEP));
    const r = m.UTF8ToString(m._core_api(this.id, namePtr, nameLen, argsPtr, argsLen));
    m._free(namePtr);
    m._free(argsPtr);
    this.read();
    return r.startsWith('s') ? r.slice(1) : Number(r.slice(1));
  }

  /** the script API as an object (`api()._GET(0, 'ANGLE')`): numbers and strings in, numbers out (a text result is NaN;
   *  `apiValue` keeps it) */
  api(): Record<ApiName, (...args: (number | string)[]) => number> {
    return new Proxy({} as Record<ApiName, (...args: (number | string)[]) => number>, {
      get: (_t, name) => (...args: (number | string)[]) => {
        if (typeof name !== 'string') return 0;
        const r = this.apiValue(name as ApiName, ...args);
        return typeof r === 'number' ? r : Number.NaN;
      },
    });
  }
}

/** pose of a ball or crate record (both start with PX..QW) */
function setPose(b: RustFreeBody, h: Float64Array, o: number, r: typeof BALL | typeof CRATE): void {
  b.t.x = h[o + r.PX]; b.t.y = h[o + r.PY]; b.t.z = h[o + r.PZ];
  b.r.x = h[o + r.QX]; b.r.y = h[o + r.QY]; b.r.z = h[o + r.QZ]; b.r.w = h[o + r.QW];
}

/** `line US name RS value US ...` (core_break) */
function parseBreak(s: string): { line: number; locals: [string, string][] } {
  const [line, ...rest] = s.split(TEXT_SEP);
  return { line: Number(line), locals: rest.map((r) => { const i = r.indexOf(RECORD_SEP); return [r.slice(0, i), r.slice(i + 1)] as [string, string]; }) };
}
