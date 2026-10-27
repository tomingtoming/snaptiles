// One running model: Val state, key handling, script and physics stepping.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { assemble, DIR_CODE, type Assembly, type TileInstance } from '../model/assemble';
import { parseRc, type RcModel } from '../rc/parser';
import { evalExpr } from '../rc/expr';
import { PhysicsWorld } from '../physics/world';
import { ScriptRunner, type LuaApi } from '../scripting/lua';
import { RcScript } from '../scripting/rcscript';
import type { KeyState } from '../input/keys';

/** script / key frame rate of the original tool and physics substeps per frame */
export const FRAME_RATE = 30;
export const PHYSICS_SUBSTEPS = 2;

/** sign knobs on the script API, applied to three.js 'YXZ' Euler angles / local angular velocity */
export interface Tune {
  ex: number;
  ey: number;
  ez: number;
  ax: number;
  ay: number;
  az: number;
  wx: number;
  wy: number;
  wz: number;
  wLocal: boolean;
}
/** Measured against the original 1.5B26 (2026-10-27, tools/orig-compare.ts vs the harness runs):
 *  a chip folded 30° down on N reads _EX +0.52, on E _EZ +0.52; a Rudder(30) on S reads _EY +0.52;
 *  _AX/_AY/_AZ = (−_EX, _EY, −_EZ); _WY of a wheel is its spin about its own normal (local frame)
 *  and the yaw rate has the sign of d_EY/dt. _WZ −1 keeps the jet-balanced corpus bike upright, _WX +1 lets the corpus segway (E = −(_AX + _WX·4 …)) balance. */
export const TUNE_DEFAULTS: Tune = { ex: -1, ey: -1, ez: -1, ax: 1, ay: -1, az: 1, wx: 1, wy: -1, wz: -1, wLocal: true };

export interface ValState {
  name: string;
  value: number;
  default: number;
  min: number;
  max: number;
  step: number;
  disp: boolean;
  touched: boolean;
}

export class Simulation {
  model: RcModel;
  vals = new Map<string, ValState>();
  assembly: Assembly | null = null;
  physics: PhysicsWorld;
  lua = new ScriptRunner();
  rcScript: RcScript | null = null;
  out: string[] = [];
  scriptError: string | null = null;
  ticks = 0;
  /** segments drawn by the script this frame: x1 y1 z1 x2 y2 z2 r g b / x1 y1 x2 y2 r g b */
  lines3d: number[] = [];
  lines2d: number[] = [];
  private penColor: [number, number, number] = [1, 1, 1];
  private pen3 = new THREE.Vector3();
  private pen2 = [0, 0];
  private keysPrev = new Set<number>();
  private keysNow = new Set<number>();
  private chipNames = new Map<string, number>();

  constructor(private R: typeof RAPIER, source: string, private keys: KeyState) {
    this.model = parseRc(source);
    this.physics = new PhysicsWorld(R);
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
    const c = this.chipNames.get(name.toUpperCase());
    return c;
  };

  async start(): Promise<void> {
    this.assembly = assemble(this.model, this.env);
    if (!this.assembly) throw new Error('Body section is missing');
    this.chipNames.clear();
    for (const t of this.assembly.tiles) if (t.name) this.chipNames.set(t.name, t.chipIndex);
    this.physics.build(this.assembly, this.env);
    this.ticks = 0;
    await this.loadScript();
  }

  reset(): void {
    if (!this.assembly) return;
    for (const v of this.vals.values()) { v.value = v.default; v.touched = false; }
    this.assembly = assemble(this.model, this.env) ?? this.assembly; // fresh rest poses, nothing detached
    this.physics.build(this.assembly, this.env);
    this.physics.resetCrates();
    this.ticks = 0;
    this.callLua('OnReset');
  }

  private async loadScript(): Promise<void> {
    this.scriptError = null;
    this.rcScript = null;
    const s = this.model.script;
    if (!s) return;
    if (s.lang === 'lua') {
      await this.lua.load(s.source, this.api(), this.luaPrelude(), s.line);
      this.scriptError = this.lua.error;
      this.callLua('OnInit');
    } else {
      try {
        this.rcScript = new RcScript(s.source);
      } catch (e) {
        this.scriptError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  private callLua(fn: string): void {
    if (this.model.script?.lang !== 'lua') return;
    this.pushValsToLua();
    this.lua.call(fn);
    this.pullValsFromLua();
    if (this.lua.error) this.scriptError = this.lua.error;
  }

  private luaPrelude(): string {
    const lines: string[] = [];
    for (const v of this.vals.values()) lines.push(`${v.name} = ${v.value}`);
    for (const [n, i] of this.chipNames) lines.push(`${n} = ${i}`);
    return lines.join('\n');
  }

  private pushValsToLua(): void {
    for (const v of this.vals.values()) this.lua.setNumber(v.name, v.value);
  }
  private pullValsFromLua(): void {
    for (const v of this.vals.values()) {
      const n = this.lua.getNumber(v.name);
      if (n !== undefined && n !== v.value) { v.value = n; v.touched = true; }
    }
  }

  /** One fixed step: keys → vals → script → clamp → physics. */
  step(): void {
    this.keysPrev = this.keysNow;
    this.keysNow = new Set(this.keys.down);
    for (const v of this.vals.values()) v.touched = false;

    for (const k of this.model.keys) {
      if (!this.keysNow.has(k.key)) continue;
      const v = this.vals.get(k.var.toUpperCase());
      if (!v) continue;
      v.value += k.step;
      v.touched = true;
    }

    this.lines3d = [];
    this.lines2d = [];
    this.penColor = [1, 1, 1];
    if (this.model.script?.lang === 'lua' && !this.scriptError) {
      this.pushValsToLua();
      const ok = this.lua.frame();
      this.pullValsFromLua();
      if (!ok) this.scriptError = this.lua.error;
      this.out = this.lua.outLines;
    } else if (this.rcScript && !this.scriptError) {
      try {
        this.rcScript.run(this.api(), this.vals);
        this.out = this.rcScript.outLines;
      } catch (e) {
        this.scriptError = e instanceof Error ? e.message : String(e);
      }
    }

    for (const v of this.vals.values()) {
      if (!v.touched && v.step > 0 && v.value !== v.default) {
        const d = v.default - v.value;
        v.value = Math.abs(d) <= v.step ? v.default : v.value + Math.sign(d) * v.step;
      }
      v.value = Math.max(v.min, Math.min(v.max, v.value));
    }

    // the original runs scripts and key steps at 30 fps; physics takes two 1/60 s steps per frame
    const sub = (globalThis as unknown as { __tune?: { substeps?: number } }).__tune?.substeps ?? PHYSICS_SUBSTEPS;
    this.physics.world.timestep = this.frameDt() / sub;
    for (let i = 0; i < sub; i++) {
      this.physics.applyControls(this.env);
      this.physics.step();
    }
    this.ticks++;
  }

  /** seconds per script frame (tunable through window.__tune.fps for experiments) */
  frameDt(): number {
    return 1 / ((globalThis as unknown as { __tune?: { fps?: number } }).__tune?.fps ?? FRAME_RATE);
  }

  /** yaw of the core's forward (-Z) axis, for the chase camera */
  coreHeading(): number {
    const tb = this.physics.tiles[0];
    if (!tb) return 0;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.physics.pose(tb).quaternion);
    // camera sits behind the model: orbit yaw such that offset = -forward
    return Math.atan2(-f.x, -f.z);
  }

  corePosition(): THREE.Vector3 {
    const tb = this.physics.tiles[0];
    return tb ? this.physics.pose(tb).position : new THREE.Vector3();
  }

  private tileOf(n: number): TileInstance | undefined {
    return this.assembly?.byChip.get(Math.floor(n));
  }
  private bodyOf(n: number): RAPIER.RigidBody | undefined {
    const t = this.tileOf(n);
    return t ? this.physics.byId.get(t.id)?.body : undefined;
  }
  private tbOf(n: number) {
    const t = this.tileOf(n);
    return t ? this.physics.byId.get(t.id) : undefined;
  }
  /** world pose of chip n (tiles welded into a group still report their own pose) */
  private poseOf(n: number) {
    const tb = this.tbOf(n);
    return tb ? this.physics.pose(tb) : undefined;
  }

  /** Script API shared by Lua and legacy Script. */
  api(): LuaApi {
    const self = this;
    const key = (n: number) => (this.keysNow.has(n) ? 1 : 0);
    const keydown = (n: number) => (this.keysNow.has(n) && !this.keysPrev.has(n) ? 1 : 0);
    const keyup = (n: number) => (!this.keysNow.has(n) && this.keysPrev.has(n) ? 1 : 0);
    const pos = (n: number, c: 'x' | 'y' | 'z') => this.poseOf(n)?.position[c] ?? 0;
    const localVel = (n: number, axis: THREE.Vector3) => {
      const tb = this.tbOf(n);
      if (!tb) return 0;
      const pose = this.physics.pose(tb);
      const v = this.physics.velocity(tb, pose);
      return v.dot(axis.clone().applyQuaternion(pose.quaternion));
    };
    const worldAxis = (n: number, local: THREE.Vector3, c: 'x' | 'y' | 'z') => {
      const pose = this.poseOf(n);
      return pose ? local.clone().applyQuaternion(pose.quaternion)[c] : 0;
    };
    const euler = (n: number) => {
      const pose = this.poseOf(n);
      return pose ? new THREE.Euler().setFromQuaternion(pose.quaternion, 'YXZ') : new THREE.Euler();
    };
    const quat = (n: number, c: 'x' | 'y' | 'z' | 'w') => this.poseOf(n)?.quaternion[c] ?? (c === 'w' ? 1 : 0);
    // Sign / frame conventions of the original are undocumented; `window.__tune` lets probes
    // flip them at runtime (see tools/tune-probe.mjs). Defaults are the current best guess.
    // Measured 2026-10-27 by driving the corpus' self-balancing models (unicycle, segway, drum,
    // bike) through tools/tune-probe.mjs + drive-probe.mjs: all four stay upright only with pitch
    // negated and angular velocity taken in the world frame with its sign flipped.
    const g = globalThis as unknown as { __tune?: Partial<Tune> };
    const tune: Tune = { ...TUNE_DEFAULTS, ...(g.__tune ?? {}) };
    g.__tune = tune;
    const wsign = { x: tune.wx, y: tune.wy, z: tune.wz };
    const angvel = (n: number, c: 'x' | 'y' | 'z') => {
      const wt = this.tbOf(n);
      if (wt?.tile.spec.wheel) return c === 'y' ? wt.spin : 0; // kinematic spin, as in the original
      const b = this.bodyOf(n);
      if (!b) return 0;
      const w = b.angvel();
      if (!tune.wLocal) return w[c] * wsign[c];
      const pose = this.poseOf(n)!;
      const local = new THREE.Vector3(w.x, w.y, w.z).applyQuaternion(pose.quaternion.clone().invert());
      return local[c] * wsign[c];
    };
    const attrOf = (n: number, name: string, d = 0) => {
      const t = this.tileOf(n);
      if (!t) return 0;
      if (name === 'angle' && t.type === 'core') return -1;
      const raw = t.node.attrs[name];
      return raw === undefined ? d : evalExpr(raw, this.env);
    };
    const RIGHT = new THREE.Vector3(1, 0, 0);
    const UP = new THREE.Vector3(0, 1, 0);
    const FWD = new THREE.Vector3(0, 0, -1);
    const h = (n: number) => {
      const b = this.bodyOf(n);
      const pose = this.poseOf(n);
      if (!b || !pose) return -100000;
      const p = pose.position;
      const ray = new this.R.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
      // only ground-like things count (collision filter: membership 1, hits group 2), never the model itself
      const hit = this.physics.world.castRay(ray, 10, true, undefined, 0x0001_0002, undefined, b);
      return hit ? hit.timeOfImpact : -100000;
    };
    return {
      _KEY: key,
      _KEYDOWN: keydown,
      _KEYUP: keyup,
      _ANALOG: () => 0,
      _MX: () => 0,
      _MY: () => 0,
      _ML: () => 0,
      _MR: () => 0,
      _MM: () => 0,
      _WIDTH: () => (typeof innerWidth === 'number' ? innerWidth : 640),
      _HEIGHT: () => (typeof innerHeight === 'number' ? innerHeight : 480),
      _FPS: () => FRAME_RATE,
      _BASE: () => 30,
      _DT: () => 1 / FRAME_RATE,
      _TICKS: () => this.ticks,
      _SETTICKS: (v: number) => { this.ticks = Math.floor(v); return 0; },
      _CHIPS: () => this.assembly?.chipCount ?? 0,
      _WEIGHT: () => this.assembly?.tiles.reduce((s, t) => s + t.mass, 0) ?? 0,
      _M: (n: number) => this.tileOf(n)?.mass ?? 0,
      _FUEL: () => 1_000_000,
      _FUELMAX: () => 1_000_000,
      _E: (n: number) => { const t = this.tileOf(n); return t ? this.physics.armCharge.get(t.id) ?? 0 : 0; },
      _T: (n: number) => (this.tileOf(n) ? 10000 : -1),
      _X: (n: number) => pos(n, 'x'),
      _Y: (n: number) => pos(n, 'y'),
      _Z: (n: number) => pos(n, 'z'),
      _H: h,
      _VX: (n: number) => localVel(n, RIGHT),
      _VY: (n: number) => localVel(n, UP),
      _VZ: (n: number) => localVel(n, FWD),
      _VEL: (n: number) => { const tb = this.tbOf(n); if (!tb) return 0; return this.physics.velocity(tb, this.physics.pose(tb)).length(); },
      _WX: (n: number) => angvel(n, 'x'),
      _WY: (n: number) => angvel(n, 'y'),
      _WZ: (n: number) => angvel(n, 'z'),
      _FX: (n: number) => (this.bodyOf(n)?.linvel().x ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _FY: (n: number) => (this.bodyOf(n)?.linvel().y ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _FZ: (n: number) => (this.bodyOf(n)?.linvel().z ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _EX: (n: number) => tune.ex * euler(n).x,
      _EY: (n: number) => tune.ey * euler(n).y,
      _EZ: (n: number) => tune.ez * euler(n).z,
      _AX: (n: number) => tune.ax * euler(n).x,
      _AY: (n: number) => tune.ay * euler(n).y,
      _AZ: (n: number) => tune.az * euler(n).z,
      _XX: (n: number) => worldAxis(n, RIGHT, 'x'),
      _XY: (n: number) => worldAxis(n, RIGHT, 'y'),
      _XZ: (n: number) => worldAxis(n, RIGHT, 'z'),
      _YX: (n: number) => worldAxis(n, UP, 'x'),
      _YY: (n: number) => worldAxis(n, UP, 'y'),
      _YZ: (n: number) => worldAxis(n, UP, 'z'),
      _ZX: (n: number) => worldAxis(n, FWD, 'x'),
      _ZY: (n: number) => worldAxis(n, FWD, 'y'),
      _ZZ: (n: number) => worldAxis(n, FWD, 'z'),
      _QX: (n: number) => quat(n, 'x'),
      _QY: (n: number) => quat(n, 'y'),
      _QZ: (n: number) => quat(n, 'z'),
      _QW: (n: number) => quat(n, 'w'),
      _GX: (n: number) => pos(n, 'x'),
      _GY: (n: number) => pos(n, 'y'),
      _GZ: (n: number) => pos(n, 'z'),
      // a Wheel takes two numbers: the first (hub) reads type 3, the second (the tyre) 4/5 — measured on the original
      _TYPE: (n: number) => { const t = this.tileOf(n); if (!t) return -1; return t.spec.wheel && Math.floor(n) === t.chipIndex - 1 ? 3 : t.spec.code; },
      _DIR: (n: number) => { const t = this.tileOf(n); return t?.dir ? DIR_CODE[t.dir] : 0; },
      _PARENT: (n: number) => this.tileOf(n)?.parent?.chipIndex ?? -1,
      _TOP: (n: number) => { let t = this.tileOf(n); while (t?.parent && !t.detached) t = t.parent; return t ? t.chipIndex : -1; },
      _BYE: (n: number) => { const t = this.tileOf(n); if (t) this.physics.detach(t, true); return 0; },
      _SPLIT: (n: number) => { const t = this.tileOf(n); if (t) this.physics.detach(t, false); return 0; },
      _ANGLE: (n: number) => attrOf(n, 'angle'),
      _POWER: (n: number) => attrOf(n, 'power'),
      _SPRING: (n: number) => attrOf(n, 'spring', 1),
      _DAMPER: (n: number) => attrOf(n, 'damper', 0.5),
      _BRAKE: (n: number) => attrOf(n, 'brake'),
      _COLOR: (n: number) => this.tileOf(n)?.color ?? 0xffffff,
      _OPTION: (n: number) => this.tileOf(n)?.option ?? 0,
      _EFFECT: () => 0,
      _USER1: (n: number) => attrOf(n, 'user1'),
      _USER2: (n: number) => attrOf(n, 'user2'),
      _FACE: () => 0,
      _ZOOM: () => 17.19,
      _PLAYERS: () => 1,
      _PLAYERMYID: () => 0,
      _PLAYERHOSTID: () => 0,
      _TODEG: (r: number) => (r * 180) / Math.PI,
      _TORAD: (d: number) => (d * Math.PI) / 180,
      _RND: () => Math.random(),
      // relative euler angles of chip a as seen from chip b
      _RX: (a: number, b: number) => relEuler(a, b).x,
      _RY: (a: number, b: number) => relEuler(a, b).y,
      _RZ: (a: number, b: number) => relEuler(a, b).z,
      // drawing
      _SETCOLOR: (rgb: number) => {
        const c = Math.max(0, Math.floor(rgb)) & 0xffffff;
        this.penColor = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
        return 0;
      },
      _MOVE3D: (x: number, y: number, z: number) => { this.pen3.set(x, y, z); return 0; },
      _LINE3D: (x: number, y: number, z: number) => {
        this.lines3d.push(this.pen3.x, this.pen3.y, this.pen3.z, x, y, z, ...this.penColor);
        this.pen3.set(x, y, z);
        return 0;
      },
      _MOVE2D: (x: number, y: number) => { this.pen2 = [x, y]; return 0; },
      _LINE2D: (x: number, y: number) => {
        this.lines2d.push(this.pen2[0], this.pen2[1], x, y, ...this.penColor);
        this.pen2 = [x, y];
        return 0;
      },
      // not simulated: network players, CCD camera, objects
      _PLAYERID: () => 0,
      _PLAYERCHIPS: () => this.assembly?.chipCount ?? 0,
      _PLAYERARMS: () => 0,
      _PLAYERCOLOR: () => 0xffffff,
      _PLAYERCRUSHES: () => 0,
      _PLAYERRESETS: () => 0,
      _PLAYERINITS: () => 0,
      _PLAYERYFORCES: () => 0,
      _PLAYERX: () => 0,
      _PLAYERY: () => 0,
      _PLAYERZ: () => 0,
      _PLAYERNAME: () => '',
      _PLAYERNAME2: () => 0,
      _CCD: () => 0,
      _RED: () => 0,
      _GREEN: () => 0,
      _BLUE: () => 0,
      _MOBJ: () => 0,
      _IOBJ: () => 0,
      _OX: () => 0,
      _OY: () => -1000000,
      _OZ: () => 0,
      _I: () => 0,
      _LX: () => 0,
      _LY: () => 0,
      _LZ: () => 0,
      _HAT: () => 0,
    };
    function relEuler(this: void, a: number, b: number): THREE.Euler {
      const pa = self.poseOf(a);
      const pb = self.poseOf(b);
      if (!pa || !pb) return new THREE.Euler();
      const rel = pb.quaternion.clone().invert().multiply(pa.quaternion);
      return new THREE.Euler().setFromQuaternion(rel, 'YXZ');
    }
  }
}
