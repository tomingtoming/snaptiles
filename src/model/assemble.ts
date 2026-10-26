// Turns a parsed .rc body tree into a flat list of tile instances with rest
// transforms and joint descriptions. Conventions (docs/spec/rc-format.md):
//
//   world: +X east, +Y up, +Z south  →  N = -Z, S = +Z, E = +X, W = -X
//   a tile is a square plate of edge TILE and thickness TILE_T (side length is
//   not documented anywhere; 1 m is an assumption)
//   child tile center = parent center + dir * TILE (edge to edge)
//   Chip/Frame/Weight/Jet/Arm: fold about the shared edge (hinge)
//   Rudder: rotate about the parent's normal (yaw) at the shared edge
//   Trim:   rotate about the connection axis (roll)
//   Wheel:  disc in the tile plane, spinning about its own normal
//
// Everything type-specific is in TYPES so it can be corrected against the
// spec without touching physics or rendering.

import * as THREE from 'three';
import type { ChipNode, RcModel } from '../rc/parser';
import { evalExpr } from '../rc/expr';

export const TILE = 1;
export const TILE_T = 0.1;

export type JointKind = 'hinge' | 'yaw' | 'roll' | 'wheel' | 'fixed';

export interface TypeSpec {
  joint: JointKind;
  collides: boolean;
  mass: number; // kg, from the public reference table
  /** _TYPE() code */
  code: number;
  /** glued to the parent body (Cowl) */
  merge?: boolean;
  jet?: boolean;
  wheel?: boolean;
  /** true for Frame-like tiles that become ghosts with option=1 */
  ghostable?: boolean;
  /** reaction-less wheel */
  noReaction?: boolean;
  drag: number;
  friction: number;
}

export const TYPES: Record<string, TypeSpec> = {
  core: { joint: 'fixed', collides: true, mass: 25.2, code: 0, drag: 1, friction: 0.6 },
  chip: { joint: 'hinge', collides: true, mass: 25.2, code: 1, drag: 1, friction: 0.6 },
  frame: { joint: 'hinge', collides: true, mass: 12.6, code: 33, ghostable: true, drag: 0, friction: 0.8 },
  rudder: { joint: 'yaw', collides: true, mass: 25.2, code: 2, drag: 1, friction: 0.6 },
  rudderf: { joint: 'yaw', collides: true, mass: 12.6, code: 34, ghostable: true, drag: 0, friction: 0.8 },
  trim: { joint: 'roll', collides: true, mass: 25.2, code: 6, drag: 1, friction: 0.6 },
  trimf: { joint: 'roll', collides: true, mass: 12.6, code: 35, ghostable: true, drag: 0, friction: 0.8 },
  wheel: { joint: 'wheel', collides: true, mass: 42.41 + 36.76, code: 4, wheel: true, drag: 0.05, friction: 1.4 },
  rlw: { joint: 'wheel', collides: true, mass: 42.41 + 36.76, code: 5, wheel: true, noReaction: true, drag: 0.05, friction: 1.4 },
  jet: { joint: 'hinge', collides: true, mass: 36.76, code: 7, jet: true, drag: 0, friction: 0.6 },
  weight: { joint: 'hinge', collides: true, mass: 100.8, code: 8, drag: 1, friction: 1.0 },
  cowl: { joint: 'fixed', collides: false, mass: 0, code: 9, merge: true, drag: 0, friction: 0 },
  arm: { joint: 'hinge', collides: true, mass: 50.4, code: 10, drag: 0.7, friction: 0.6 },
};

export const DIR_VEC: Record<'N' | 'S' | 'E' | 'W', THREE.Vector3> = {
  N: new THREE.Vector3(0, 0, -1),
  S: new THREE.Vector3(0, 0, 1),
  E: new THREE.Vector3(1, 0, 0),
  W: new THREE.Vector3(-1, 0, 0),
};
export const DIR_CODE: Record<'N' | 'S' | 'E' | 'W', number> = { S: 0, W: 1, N: 2, E: 3 };

export interface TileInstance {
  id: number; // index in assembly.tiles
  /** chip number as seen by scripts (wheels occupy two numbers: rim, rotor) */
  chipIndex: number;
  node: ChipNode;
  type: string;
  spec: TypeSpec;
  parent: TileInstance | null;
  dir: 'N' | 'S' | 'E' | 'W' | null;
  name: string | null;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** joint anchor and axis in model frame at rest */
  anchor: THREE.Vector3;
  axis: THREE.Vector3;
  dirAxis: THREE.Vector3;
  color: number | null;
  ghost: boolean;
  mass: number;
  option: number;
  children: TileInstance[];
}

export interface Assembly {
  tiles: TileInstance[];
  roots: TileInstance[];
  /** chip number → tile */
  byChip: Map<number, TileInstance>;
  chipCount: number;
}

export type ValEnv = (name: string) => number | undefined;

function parseColor(raw: string | undefined, env: ValEnv): number | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, '');
  const m = /^#([0-9a-fA-F]{1,6})$/.exec(s);
  if (m) return parseInt(m[1], 16);
  const v = evalExpr(s, env);
  return Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, Math.floor(v))) : null;
}

export function attr(node: ChipNode, name: string, env: ValEnv, d = 0): number {
  const raw = node.attrs[name];
  return raw === undefined ? d : evalExpr(raw, env);
}

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

function childPose(spec: TypeSpec, dir: 'N' | 'S' | 'E' | 'W', angleDeg: number) {
  const d = DIR_VEC[dir];
  const hingeAxis = new THREE.Vector3().crossVectors(UP, d).normalize(); // lies in the plate, ⟂ dir
  const q = new THREE.Quaternion();
  const half = d.clone().multiplyScalar(TILE / 2);
  let pos: THREE.Vector3;
  let axis: THREE.Vector3;
  let anchor: THREE.Vector3;
  switch (spec.joint) {
    case 'hinge':
    case 'fixed':
      q.setFromAxisAngle(hingeAxis, angleDeg * DEG);
      pos = half.clone().add(half.clone().applyQuaternion(q));
      axis = hingeAxis;
      anchor = half;
      break;
    case 'yaw':
      q.setFromAxisAngle(UP, angleDeg * DEG);
      pos = half.clone().add(half.clone().applyQuaternion(q));
      axis = UP.clone();
      anchor = half;
      break;
    case 'roll':
      q.setFromAxisAngle(d, angleDeg * DEG);
      pos = d.clone().multiplyScalar(TILE);
      axis = d.clone();
      anchor = half;
      break;
    case 'wheel':
      pos = d.clone().multiplyScalar(TILE);
      axis = UP.clone(); // spins about its own normal
      anchor = pos.clone();
      break;
  }
  return { q, pos, axis, anchor };
}

export function assemble(model: RcModel, env: ValEnv): Assembly | null {
  if (!model.body) return null;
  const tiles: TileInstance[] = [];
  const byChip = new Map<number, TileInstance>();
  let chipIndex = 0;

  const visit = (node: ChipNode, parent: TileInstance | null): TileInstance => {
    const typeKey = node.type.toLowerCase();
    const spec = TYPES[typeKey] ?? TYPES.chip;
    const option = attr(node, 'option', env, 0);
    const inst: TileInstance = {
      id: tiles.length,
      chipIndex,
      node,
      type: typeKey,
      spec,
      parent,
      dir: node.dir,
      name: node.attrs.name ? node.attrs.name.replace(/\s+/g, '').toUpperCase() : null,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      anchor: new THREE.Vector3(),
      axis: new THREE.Vector3(0, 0, 1),
      dirAxis: new THREE.Vector3(0, 0, -1),
      color: parseColor(node.attrs.color, env),
      ghost: !!spec.ghostable && option === 1,
      mass: spec.mass * (typeKey === 'weight' ? Math.max(1, Math.min(8, option || 1)) : 1),
      option,
      children: [],
    };
    byChip.set(chipIndex, inst);
    if (spec.wheel) {
      chipIndex++; // rim
      byChip.set(chipIndex, inst); // rotor (what `name` refers to)
      inst.chipIndex = chipIndex;
    }
    chipIndex++;

    if (parent && node.dir) {
      const angle = spec.joint === 'wheel' ? 0 : attr(node, 'angle', env, 0);
      const { q, pos, axis, anchor } = childPose(spec, node.dir, angle);
      inst.quaternion.copy(parent.quaternion).multiply(q);
      inst.position.copy(parent.position).add(pos.clone().applyQuaternion(parent.quaternion));
      inst.anchor.copy(parent.position).add(anchor.clone().applyQuaternion(parent.quaternion));
      inst.axis.copy(axis).applyQuaternion(parent.quaternion).normalize();
      inst.dirAxis.copy(DIR_VEC[node.dir]).applyQuaternion(parent.quaternion);
      parent.children.push(inst);
    } else if (parent) {
      inst.quaternion.copy(parent.quaternion);
      inst.position.copy(parent.position).add(new THREE.Vector3(0, TILE_T * 2, 0));
      parent.children.push(inst);
    }
    tiles.push(inst);
    for (const c of node.children) visit(c, inst);
    return inst;
  };

  const roots = [visit(model.body, null)];
  return { tiles, roots, byChip, chipCount: chipIndex };
}

/** Lowest point of the assembly (model frame), used to drop it onto the ground. */
export function assemblyBottom(a: Assembly): number {
  let min = Infinity;
  const r = Math.hypot(TILE / 2, TILE / 2, TILE_T / 2);
  for (const t of a.tiles) min = Math.min(min, t.position.y - r);
  return min;
}
