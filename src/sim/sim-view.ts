// The part of a running model the page reads and drives: main.ts (loop, HUD, overlay, sound, keys), scene.ts (sync)
// and the probes. Both cores implement it: `Simulation` (TypeScript: rapier3d-compat + wasmoon) and `RustSimulation`
// (core/ built with Emscripten).
import type * as THREE from 'three';
import type { Assembly, TileInstance, ValEnv } from '../model/assemble';
import type { RcModel } from '../rc/parser';
import type { Pose } from '../physics/world';
import type { ValState } from './simulation';

export type CoreKind = 'ts' | 'rust';

interface Vec3Like { x: number; y: number; z: number }
interface QuatLike { x: number; y: number; z: number; w: number }

export interface BodyView {
  readonly handle: number;
  mass(): number;
  linvel(): Vec3Like;
}

export interface TileBodyView {
  tile: TileInstance;
  body: BodyView;
  /** wheels: kinematic spin (rad/s) and its accumulated angle; jets: last applied power */
  spin: number;
  spinAngle: number;
  jetPower: number;
}

export interface PhysicsView {
  tiles: TileBodyView[];
  pose(tb: TileBodyView, out?: Pose): Pose;
  velocity(tb: TileBodyView, pose: Pose): THREE.Vector3;
  balls: { body: { translation(): Vec3Like; rotation(): QuatLike }; radius: number; color: [number, number, number] }[];
  crates: { translation(): Vec3Like; rotation(): QuatLike; linvel(): Vec3Like }[];
  projectiles: { body: { translation(): Vec3Like } }[];
  wind: THREE.Vector3;
  addBall(radius: number, x: number, y: number, z: number, gravity: number): number;
}

export interface SimView {
  readonly model: RcModel;
  vals: Map<string, ValState>;
  assembly: Assembly | null;
  physics: PhysicsView;
  out: string[];
  scriptError: string | null;
  ticks: number;
  lines3d: number[];
  lines2d: number[];
  zoomFov: number;
  env: ValEnv;
  start(): Promise<void>;
  reset(): void;
  step(): void;
  dispose(): Promise<void>;
  frameDt(): number;
  corePosition(): THREE.Vector3;
  modelCenter(): THREE.Vector3;
  coreVelocity(): THREE.Vector3;
}
