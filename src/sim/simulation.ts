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
    this.physics.build(this.assembly, this.env);
    this.ticks = 0;
    this.callLua('OnReset');
  }

  private async loadScript(): Promise<void> {
    this.scriptError = null;
    this.rcScript = null;
    const s = this.model.script;
    if (!s) return;
    if (s.lang === 'lua') {
      await this.lua.load(s.source, this.api(), this.luaPrelude());
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

    this.physics.applyControls(this.env);
    this.physics.step();
    this.ticks++;
  }

  corePosition(): THREE.Vector3 {
    const tb = this.physics.tiles[0];
    if (!tb) return new THREE.Vector3();
    const p = tb.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  private tileOf(n: number): TileInstance | undefined {
    return this.assembly?.byChip.get(Math.floor(n));
  }
  private bodyOf(n: number): RAPIER.RigidBody | undefined {
    const t = this.tileOf(n);
    return t ? this.physics.byId.get(t.id)?.body : undefined;
  }

  /** Script API shared by Lua and legacy Script. */
  api(): LuaApi {
    const key = (n: number) => (this.keysNow.has(n) ? 1 : 0);
    const keydown = (n: number) => (this.keysNow.has(n) && !this.keysPrev.has(n) ? 1 : 0);
    const keyup = (n: number) => (!this.keysNow.has(n) && this.keysPrev.has(n) ? 1 : 0);
    const pos = (n: number, c: 'x' | 'y' | 'z') => this.bodyOf(n)?.translation()[c] ?? 0;
    const localVel = (n: number, axis: THREE.Vector3) => {
      const b = this.bodyOf(n);
      if (!b) return 0;
      const v = b.linvel();
      const r = b.rotation();
      const a = axis.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      return v.x * a.x + v.y * a.y + v.z * a.z;
    };
    const worldAxis = (n: number, local: THREE.Vector3, c: 'x' | 'y' | 'z') => {
      const b = this.bodyOf(n);
      if (!b) return 0;
      const r = b.rotation();
      return local.clone().applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))[c];
    };
    const euler = (n: number) => {
      const b = this.bodyOf(n);
      if (!b) return new THREE.Euler();
      const r = b.rotation();
      return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), 'YXZ');
    };
    const angvel = (n: number, c: 'x' | 'y' | 'z') => this.bodyOf(n)?.angvel()[c] ?? 0;
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
      if (!b) return -100000;
      const p = b.translation();
      const ray = new this.R.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
      const hit = this.physics.world.castRay(ray, 10, true, undefined, undefined, undefined, b);
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
      _WIDTH: () => innerWidth,
      _HEIGHT: () => innerHeight,
      _FPS: () => 60,
      _BASE: () => 30,
      _DT: () => 1 / 60,
      _TICKS: () => this.ticks,
      _SETTICKS: (v: number) => { this.ticks = Math.floor(v); return 0; },
      _CHIPS: () => this.assembly?.chipCount ?? 0,
      _WEIGHT: () => this.assembly?.tiles.reduce((s, t) => s + t.mass, 0) ?? 0,
      _M: (n: number) => this.tileOf(n)?.mass ?? 0,
      _FUEL: () => 1_000_000,
      _FUELMAX: () => 1_000_000,
      _E: () => 0,
      _T: (n: number) => (this.tileOf(n) ? 10000 : -1),
      _X: (n: number) => pos(n, 'x'),
      _Y: (n: number) => pos(n, 'y'),
      _Z: (n: number) => pos(n, 'z'),
      _H: h,
      _VX: (n: number) => localVel(n, RIGHT),
      _VY: (n: number) => localVel(n, UP),
      _VZ: (n: number) => localVel(n, FWD),
      _VEL: (n: number) => { const b = this.bodyOf(n); if (!b) return 0; const v = b.linvel(); return Math.hypot(v.x, v.y, v.z); },
      _WX: (n: number) => angvel(n, 'x'),
      _WY: (n: number) => angvel(n, 'y'),
      _WZ: (n: number) => angvel(n, 'z'),
      _FX: (n: number) => (this.bodyOf(n)?.linvel().x ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _FY: (n: number) => (this.bodyOf(n)?.linvel().y ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _FZ: (n: number) => (this.bodyOf(n)?.linvel().z ?? 0) * (this.tileOf(n)?.mass ?? 0),
      _EX: (n: number) => -euler(n).x,
      _EY: (n: number) => euler(n).y,
      _EZ: (n: number) => -euler(n).z,
      _AX: (n: number) => euler(n).x,
      _AY: (n: number) => euler(n).y,
      _AZ: (n: number) => euler(n).z,
      _XX: (n: number) => worldAxis(n, RIGHT, 'x'),
      _XY: (n: number) => worldAxis(n, RIGHT, 'y'),
      _XZ: (n: number) => worldAxis(n, RIGHT, 'z'),
      _YX: (n: number) => worldAxis(n, UP, 'x'),
      _YY: (n: number) => worldAxis(n, UP, 'y'),
      _YZ: (n: number) => worldAxis(n, UP, 'z'),
      _ZX: (n: number) => worldAxis(n, FWD, 'x'),
      _ZY: (n: number) => worldAxis(n, FWD, 'y'),
      _ZZ: (n: number) => worldAxis(n, FWD, 'z'),
      _QX: (n: number) => this.bodyOf(n)?.rotation().x ?? 0,
      _QY: (n: number) => this.bodyOf(n)?.rotation().y ?? 0,
      _QZ: (n: number) => this.bodyOf(n)?.rotation().z ?? 0,
      _QW: (n: number) => this.bodyOf(n)?.rotation().w ?? 1,
      _GX: (n: number) => pos(n, 'x'),
      _GY: (n: number) => pos(n, 'y'),
      _GZ: (n: number) => pos(n, 'z'),
      _TYPE: (n: number) => this.tileOf(n)?.spec.code ?? -1,
      _DIR: (n: number) => { const t = this.tileOf(n); return t?.dir ? DIR_CODE[t.dir] : 0; },
      _PARENT: (n: number) => this.tileOf(n)?.parent?.chipIndex ?? -1,
      _TOP: () => 0,
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
      _BYE: () => 0,
      _SPLIT: () => 0,
      _FACE: () => 0,
      _ZOOM: () => 17.19,
      _PLAYERS: () => 1,
      _PLAYERMYID: () => 0,
      _PLAYERHOSTID: () => 0,
      _TODEG: (r: number) => (r * 180) / Math.PI,
      _TORAD: (d: number) => (d * Math.PI) / 180,
      _RND: () => Math.random(),
    };
  }
}
