import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TILE, TILE_T, assemblyBottom, attr, type Assembly, type TileInstance, type ValEnv } from '../model/assemble';
import { exprIsConstant } from '../rc/expr';

/**
 * Tiles whose angle never changes are welded into their parent's rigid body
 * (one body = one rigid group). Only wheels and tiles whose angle is an
 * expression (steering, control surfaces) get a joint. That is what makes
 * the chips rigid.
 */
export interface TileBody {
  tile: TileInstance;
  body: RAPIER.RigidBody;
  /** the tile that owns `body` (itself when this tile starts a group) */
  groupRoot: TileInstance;
  /** rest transform of this tile relative to the group root */
  relPos: THREE.Vector3;
  relQuat: THREE.Quaternion;
  joint: RAPIER.RevoluteImpulseJoint | null;
  animated: boolean;
  /** rest orientation of `body` (model frame). Every body in a joint chain shares its
   *  parent's orientation so rapier's single joint axis means the same thing in both. */
  bodyRestQuat: THREE.Quaternion;
  bodyRestPos: THREE.Vector3;
  /** assembled angle (deg) of an animated joint; the joint measures 0 there */
  restAngle: number;
}

export interface PhysicsOptions {
  gravity?: number;
}

/** power → torque scale for wheels: spec only says "TRQ≈1000" drives a car. */
export const WHEEL_TORQUE_PER_POWER = 0.25; // N·m per power unit
/** spec: 6 power = 1 N */
export const JET_NEWTON_PER_POWER = 1 / 6;
/** flat-plate aero: N per (m/s)² of normal velocity, per unit drag coefficient of a tile */
export const AIR_DRAG = 0.9;

// Tiles of a model never collide with each other (only with the ground / objects).
const MODEL_GROUP = 0x0001_0002; // membership 1, filter 2
const GROUND_GROUP = 0x0002_0001; // membership 2, filter 1

let ready: Promise<typeof RAPIER> | null = null;
export function initRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export interface Pose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export class PhysicsWorld {
  world: RAPIER.World;
  tiles: TileBody[] = [];
  byId = new Map<number, TileBody>();
  readonly dt = 1 / 60;
  tick = 0;

  constructor(private R: typeof RAPIER, opts: PhysicsOptions = {}) {
    this.world = new R.World({ x: 0, y: opts.gravity ?? -9.8, z: 0 });
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 8;
    const groundDesc = R.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(1.0).setCollisionGroups(GROUND_GROUP);
    this.world.createCollider(groundDesc);
  }

  clear(): void {
    for (const t of this.tiles) if (t.joint) this.world.removeImpulseJoint(t.joint, true);
    const seen = new Set<number>();
    for (const t of this.tiles) {
      if (seen.has(t.body.handle)) continue;
      seen.add(t.body.handle);
      this.world.removeRigidBody(t.body);
    }
    this.tiles = [];
    this.byId.clear();
    this.tick = 0;
  }

  build(a: Assembly, env: ValEnv, spawn = new THREE.Vector3(0, 0, 0)): void {
    this.clear();
    const R = this.R;
    const lift = -assemblyBottom(a) + 0.02;
    const offset = spawn.clone().add(new THREE.Vector3(0, lift, 0));

    for (const tile of a.tiles) {
      const parentTb = tile.parent ? this.byId.get(tile.parent.id)! : null;
      const angleExpr = tile.node.attrs.angle ?? '';
      const animated = !!tile.parent && !exprIsConstant(angleExpr) && tile.spec.joint !== 'wheel' && tile.spec.joint !== 'fixed';
      const startsGroup = !parentTb || tile.spec.joint === 'wheel' || animated;

      let body: RAPIER.RigidBody;
      let groupRoot: TileInstance;
      let bodyRestQuat: THREE.Quaternion;
      let bodyRestPos: THREE.Vector3;
      if (startsGroup) {
        bodyRestQuat = parentTb ? parentTb.bodyRestQuat.clone() : tile.quaternion.clone();
        bodyRestPos = tile.position.clone();
        const p = bodyRestPos.clone().add(offset);
        const q = bodyRestQuat;
        const rb = R.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinearDamping(0.02)
          .setAngularDamping(tile.spec.wheel ? 0.2 : 0.05)
          .setCcdEnabled(true);
        body = this.world.createRigidBody(rb);
        groupRoot = tile;
      } else {
        body = parentTb!.body;
        groupRoot = parentTb!.groupRoot;
        bodyRestQuat = parentTb!.bodyRestQuat;
        bodyRestPos = parentTb!.bodyRestPos;
      }
      const invQ = bodyRestQuat.clone().invert();
      const relQuat = invQ.clone().multiply(tile.quaternion);
      const relPos = tile.position.clone().sub(bodyRestPos).applyQuaternion(invQ);

      // collider
      const mass = tile.mass;
      if (mass > 0 || tile.spec.collides) {
        const cd = tile.spec.wheel
          ? R.ColliderDesc.cylinder(TILE_T / 2, TILE / 2)
          : R.ColliderDesc.cuboid(TILE / 2, TILE_T / 2, TILE / 2);
        cd.setMass(Math.max(0.1, mass)).setFriction(tile.spec.friction).setCollisionGroups(MODEL_GROUP);
        cd.setTranslation(relPos.x, relPos.y, relPos.z).setRotation({ x: relQuat.x, y: relQuat.y, z: relQuat.z, w: relQuat.w });
        if (tile.ghost || !tile.spec.collides) cd.setSensor(true);
        this.world.createCollider(cd, body);
      }

      let joint: RAPIER.RevoluteImpulseJoint | null = null;
      if (startsGroup && parentTb) {
        const anchorW = tile.anchor.clone().add(offset);
        const axisW = tile.axis.clone().normalize();
        // Both bodies share the same rest orientation, so rapier's single joint axis has the
        // same coordinates in both local frames and the joint measures 0 at the rest pose.
        const jd = R.JointData.revolute(toLocal(parentTb.body, anchorW), toLocal(body, anchorW), toLocalDir(parentTb.body, axisW));
        joint = this.world.createImpulseJoint(jd, parentTb.body, body, true) as RAPIER.RevoluteImpulseJoint;
        if (animated) joint.setLimits(0, 0);
      }
      const restAngle = animated ? attr(tile.node, 'angle', env, 0) : 0;
      const tb: TileBody = { tile, body, groupRoot, relPos, relQuat, joint, animated, bodyRestQuat, bodyRestPos, restAngle };
      this.tiles.push(tb);
      this.byId.set(tile.id, tb);
    }
  }

  /** world pose of a tile (its group body pose composed with the rest offset) */
  pose(tb: TileBody, out?: Pose): Pose {
    const t = tb.body.translation();
    const r = tb.body.rotation();
    const q = (out?.quaternion ?? new THREE.Quaternion()).set(r.x, r.y, r.z, r.w);
    const p = (out?.position ?? new THREE.Vector3()).copy(tb.relPos).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    q.multiply(tb.relQuat);
    return { position: p, quaternion: q };
  }

  /** velocity of a tile's center */
  velocity(tb: TileBody, pose: Pose): THREE.Vector3 {
    const v = tb.body.linvel();
    const w = tb.body.angvel();
    const c = tb.body.translation();
    const r = pose.position.clone().sub(new THREE.Vector3(c.x, c.y, c.z));
    return new THREE.Vector3(w.x, w.y, w.z).cross(r).add(new THREE.Vector3(v.x, v.y, v.z));
  }

  /** Drive joints toward attribute values, apply wheel torque, jets and air drag. */
  applyControls(env: ValEnv): void {
    const DEG = Math.PI / 180;
    const seen = new Set<number>();
    for (const tb of this.tiles) {
      if (seen.has(tb.body.handle)) continue;
      seen.add(tb.body.handle);
      // forces/torques accumulate across steps in rapier; start every step from zero
      tb.body.resetForces(false);
      tb.body.resetTorques(false);
    }
    const UP = new THREE.Vector3(0, 1, 0);
    for (const tb of this.tiles) {
      const { tile, joint, body } = tb;
      const pose = this.pose(tb);
      const normal = UP.clone().applyQuaternion(pose.quaternion);

      if (joint && tile.parent) {
        if (tile.spec.joint === 'wheel') {
          const power = attr(tile.node, 'power', env, 0);
          const brake = attr(tile.node, 'brake', env, 0);
          const parentBody = this.byId.get(tile.parent.id)!.body;
          let torque = power * WHEEL_TORQUE_PER_POWER;
          if (brake > 0) {
            const w = body.angvel();
            const pw = parentBody.angvel();
            const rel = (w.x - pw.x) * normal.x + (w.y - pw.y) * normal.y + (w.z - pw.z) * normal.z;
            torque -= rel * brake * 2;
          }
          if (torque !== 0) {
            const t = normal.clone().multiplyScalar(torque);
            body.addTorque({ x: t.x, y: t.y, z: t.z }, true);
            if (!tile.spec.noReaction) parentBody.addTorque({ x: -t.x, y: -t.y, z: -t.z }, true);
          }
        } else if (tb.animated) {
          const a = (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG;
          joint.setLimits(a, a);
        }
      }

      if (tile.spec.jet) {
        const power = attr(tile.node, 'power', env, 0);
        if (power !== 0) {
          const f = normal.clone().multiplyScalar(power * JET_NEWTON_PER_POWER);
          body.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
        }
      }

      if (tile.spec.drag > 0) {
        // quadratic drag along the tile normal only (plates slip edge-on) → also the lift model
        const v = this.velocity(tb, pose);
        const vn = v.dot(normal);
        const f = -AIR_DRAG * tile.spec.drag * vn * Math.abs(vn);
        if (Math.abs(f) > 1e-4) {
          body.addForceAtPoint(
            { x: normal.x * f, y: normal.y * f, z: normal.z * f },
            { x: pose.position.x, y: pose.position.y, z: pose.position.z },
            true,
          );
        }
      }
    }
  }

  step(): void {
    this.world.step();
    this.tick++;
  }
}

function toLocal(body: RAPIER.RigidBody, worldPoint: THREE.Vector3) {
  const t = body.translation();
  const r = body.rotation();
  const inv = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
  const v = worldPoint.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(inv);
  return { x: v.x, y: v.y, z: v.z };
}

function toLocalDir(body: RAPIER.RigidBody, worldDir: THREE.Vector3) {
  const r = body.rotation();
  const inv = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
  const v = worldDir.clone().applyQuaternion(inv).normalize();
  return { x: v.x, y: v.y, z: v.z };
}
