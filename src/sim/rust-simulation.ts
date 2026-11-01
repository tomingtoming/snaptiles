// A running model on the Rust core (core/, built with Emscripten into core/pkg): the same surface the page and the
// probes use on `Simulation`. The model and its assembly for drawing come from the TypeScript parser and assembler
// (identical to the Rust ones, checked by the stage-1 oracle); bodies, Vals, keys and the script run in the core.
// Per frame the core writes one flat f64 state buffer (layout in core/src/state.rs) that this class decodes from
// HEAPF64 without per-value calls. The module is loaded on first use, so the TypeScript core never downloads it.
import * as THREE from 'three';
import { assemble, type Assembly, type TileInstance } from '../model/assemble';
import { parseRc, type RcModel } from '../rc/parser';
import type { Pose } from '../physics/world';
import type { KeyState } from '../input/keys';
import type { SnapTilesCoreModule } from '../../core/pkg/snaptiles_core.js';
import type { ValState } from './simulation';
import { FRAME_RATE, type BodyView, type PhysicsView, type SimView, type TileBodyView } from './sim-view';

// ---- state buffer layout (core/src/state.rs) ----
const LAYOUT_VERSION = 1;
const HEADER = 20;
const TILE_STRIDE = 17;
const BALL_STRIDE = 12;
const CRATE_STRIDE = 10;
const SHELL_STRIDE = 3;
const KEY_COUNT = 17;
const SEP = '\u001f';

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

export class RustSimulation implements SimView {
  readonly core = 'rust' as const;
  model: RcModel;
  vals = new Map<string, ValState>();
  assembly: Assembly | null = null;
  physics: RustPhysics;
  out: string[] = [];
  scriptError: string | null = null;
  ticks = 0;
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

  constructor(private source: string, private keys: KeyState) {
    this.model = parseRc(source);
    this.physics = new RustPhysics(this, () => this.freeCore());
    this.physics.wind.onSet = (x, y, z) => { if (this.m && this.id >= 0) { this.m._core_set_wind(this.id, x || 0, y || 0, z || 0); this.read(); } };
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
    const noCourse = (globalThis as unknown as { __tune?: { noCourse?: boolean } }).__tune?.noCourse ?? false;
    const code = m._core_load(this.id, ptr, bytes.length, noCourse ? 1 : 0);
    m._free(ptr);
    if (code !== 0) throw new Error(m.UTF8ToString(m._core_error(this.id)) || 'model failed to load');
    const names = m.UTF8ToString(m._core_val_names(this.id));
    this.valOrder = (names ? names.split(SEP) : []).map((n) => this.vals.get(n));
    this.buildTiles();
    this.ticks = 0;
    this.read();
  }

  private buildTiles(): void {
    this.physics.tiles = (this.assembly?.tiles ?? []).map((t, i) => new RustTileBody(t, this, i));
  }

  reset(): void {
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

  private pushInput(): void {
    if (!this.m || this.id < 0) return;
    let mask = 0;
    for (let n = 0; n < KEY_COUNT; n++) if (this.keys.isDown(n)) mask |= 1 << n;
    const ms = this.keys.mouse;
    const w = typeof innerWidth === 'number' ? innerWidth : 640;
    const h = typeof innerHeight === 'number' ? innerHeight : 480;
    this.m._core_set_input(this.id, mask, ms.x, ms.y, ms.l, ms.r, ms.m, w, h);
    const a = this.keys.axes;
    this.m._core_set_axes(this.id, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0, a[4] ?? 0, a[5] ?? 0);
  }

  /** One fixed step in the core: keys → vals → script → clamp → physics. */
  step(): void {
    if (!this.m || this.id < 0) return;
    this.pushInput();
    this.m._core_step(this.id, 1);
    this.read();
  }

  /** decode the state buffer */
  private read(): void {
    const m = this.m;
    if (!m || this.id < 0) return;
    const len = m._core_state_len(this.id);
    if (len < HEADER) return;
    const h = m.HEAPF64;
    let o = m._core_state_ptr(this.id) / 8;
    if (h[o] !== LAYOUT_VERSION) throw new Error(`core state layout ${h[o]} (expected ${LAYOUT_VERSION}); rebuild core/pkg`);
    const nTiles = h[o + 1], nBalls = h[o + 2], nCrates = h[o + 3], nShells = h[o + 4], nVals = h[o + 5];
    const n3 = h[o + 6], n2 = h[o + 7];
    this.ticks = h[o + 8];
    this.zoomFov = h[o + 9];
    const wind = this.physics.wind;
    wind.x = h[o + 10]; wind.y = h[o + 11]; wind.z = h[o + 12];
    const outGen = h[o + 13], outRows = h[o + 14], errorGen = h[o + 15], hasError = h[o + 16];
    if (outGen !== this.outGen) {
      this.outGen = outGen;
      const s = m.UTF8ToString(m._core_out(this.id));
      this.out = outRows > 0 ? s.split(SEP) : [];
    }
    if (errorGen !== this.errorGen) {
      this.errorGen = errorGen;
      this.scriptError = hasError ? m.UTF8ToString(m._core_error(this.id)) : null;
    }
    o += HEADER;
    const tiles = this.physics.tiles;
    if (tiles.length !== nTiles) throw new Error(`core has ${nTiles} tiles, the assembly ${tiles.length}`);
    for (let i = 0; i < nTiles; i++, o += TILE_STRIDE) {
      const t = tiles[i];
      t.position.set(h[o], h[o + 1], h[o + 2]);
      t.quaternion.set(h[o + 3], h[o + 4], h[o + 5], h[o + 6]);
      t.vel.set(h[o + 7], h[o + 8], h[o + 9]);
      const lin = t.body.lin;
      lin.x = h[o + 10]; lin.y = h[o + 11]; lin.z = h[o + 12];
      t.spin = h[o + 13];
      t.spinAngle = h[o + 14];
      t.jetPower = h[o + 15];
      t.body.handle = h[o + 16];
    }
    const balls = this.physics.balls;
    balls.length = Math.min(balls.length, nBalls);
    for (let i = 0; i < nBalls; i++, o += BALL_STRIDE) {
      const b = balls[i] ?? (balls[i] = { body: new RustFreeBody(), radius: 0, color: [1, 0, 1], fixed: false });
      setBody(b.body, h, o, false);
      b.color[0] = h[o + 7]; b.color[1] = h[o + 8]; b.color[2] = h[o + 9];
      b.radius = h[o + 10];
      b.fixed = h[o + 11] !== 0;
    }
    const crates = this.physics.crates;
    crates.length = Math.min(crates.length, nCrates);
    for (let i = 0; i < nCrates; i++, o += CRATE_STRIDE) setBody(crates[i] ?? (crates[i] = new RustFreeBody()), h, o, true);
    const shells = this.physics.projectiles;
    shells.length = Math.min(shells.length, nShells);
    for (let i = 0; i < nShells; i++, o += SHELL_STRIDE) {
      const s = shells[i] ?? (shells[i] = { body: new RustFreeBody() });
      s.body.t.x = h[o]; s.body.t.y = h[o + 1]; s.body.t.z = h[o + 2];
    }
    for (let i = 0; i < nVals; i++) {
      const v = this.valOrder[i];
      if (v) v.value = h[o + i];
    }
    o += nVals;
    this.lines3d = n3 > 0 ? Array.from(h.subarray(o, o + n3)) : [];
    o += n3;
    this.lines2d = n2 > 0 ? Array.from(h.subarray(o, o + n2)) : [];
  }

  addBall(radius: number, x: number, y: number, z: number, gravity: number): number {
    if (!this.m || this.id < 0) return -1;
    const i = this.m._core_add_ball(this.id, radius, x, y, z, gravity);
    this.read();
    return i;
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

  /** the script API for probes and tests (`api()._KEY(0)`): numeric arguments only, one core call each */
  api(): Record<string, (...args: number[]) => number> {
    return new Proxy({}, {
      get: (_t, name) => (...args: number[]) => {
        const m = this.m;
        if (!m || this.id < 0 || typeof name !== 'string') return 0;
        this.pushInput();
        const bytes = new TextEncoder().encode(name);
        const ptr = m._malloc(Math.max(1, bytes.length));
        m.HEAPU8.set(bytes, ptr);
        const a = args.map(Number);
        const r = m._core_api(this.id, ptr, bytes.length, Math.min(6, a.length), a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0, a[4] ?? 0, a[5] ?? 0);
        m._free(ptr);
        this.read();
        return r;
      },
    });
  }
}

function setBody(b: RustFreeBody, h: Float64Array, o: number, withVel: boolean): void {
  b.t.x = h[o]; b.t.y = h[o + 1]; b.t.z = h[o + 2];
  b.r.x = h[o + 3]; b.r.y = h[o + 4]; b.r.z = h[o + 5]; b.r.w = h[o + 6];
  if (withVel) { b.v.x = h[o + 7]; b.v.y = h[o + 8]; b.v.z = h[o + 9]; }
}
