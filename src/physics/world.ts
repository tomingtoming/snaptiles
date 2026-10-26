import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TILE, TILE_T, assemblyBottom, attr, type Assembly, type TileInstance, type ValEnv } from '../model/assemble';

export interface TileBody {
  tile: TileInstance;
  body: RAPIER.RigidBody;
  joint: RAPIER.RevoluteImpulseJoint | null;
}

export interface PhysicsOptions {
  gravity?: number;
}

/** power → torque scale for wheels: spec only says "TRQ≈1000" drives a car. */
export const WHEEL_TORQUE_PER_POWER = 0.08; // N·m per power unit
/** spec: 6 power = 1 N */
export const JET_NEWTON_PER_POWER = 1 / 6;
/** hinge position motor: spring 0..1 → stiffness, damper 0..1 → damping */
export const HINGE_STIFFNESS = 6000;
export const HINGE_DAMPING = 400;
export const AIR_DRAG = 0.9; // N per (m/s)² per unit drag coefficient of a tile

// Tiles of a model never collide with each other (only with the ground / objects).
const MODEL_GROUP = 0x0001_0002; // membership 1, filter 2
const GROUND_GROUP = 0x0002_0001; // membership 2, filter 1

let ready: Promise<typeof RAPIER> | null = null;
export function initRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export class PhysicsWorld {
  world: RAPIER.World;
  tiles: TileBody[] = [];
  byId = new Map<number, TileBody>();
  readonly dt = 1 / 60;
  tick = 0;
  private tmpQ = new THREE.Quaternion();

  constructor(private R: typeof RAPIER, opts: PhysicsOptions = {}) {
    this.world = new R.World({ x: 0, y: opts.gravity ?? -9.8, z: 0 });
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 12;
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
    const bodyOf = new Map<number, RAPIER.RigidBody>();

    for (const tile of a.tiles) {
      const p = tile.position.clone().add(offset);
      const q = tile.quaternion;

      if (tile.spec.merge && tile.parent) {
        // Cowl: massless decoration glued to the parent body
        const parentBody = bodyOf.get(tile.parent.id)!;
        bodyOf.set(tile.id, parentBody);
        const tb: TileBody = { tile, body: parentBody, joint: null };
        this.tiles.push(tb);
        this.byId.set(tile.id, tb);
        continue;
      }

      const rb = R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinearDamping(0.02)
        .setAngularDamping(0.05)
        .setCcdEnabled(true);
      const body = this.world.createRigidBody(rb);
      const mass = Math.max(0.5, tile.mass);
      if (tile.spec.wheel) {
        const r = TILE / 2;
        const cd = R.ColliderDesc.cylinder(TILE_T / 2, r).setMass(mass).setFriction(tile.spec.friction).setCollisionGroups(MODEL_GROUP);
        this.world.createCollider(cd, body); // cylinder axis = local Y = tile normal
      } else {
        const cd = R.ColliderDesc.cuboid(TILE / 2, TILE_T / 2, TILE / 2).setMass(mass).setFriction(tile.spec.friction).setCollisionGroups(MODEL_GROUP);
        if (tile.ghost) cd.setSensor(true);
        this.world.createCollider(cd, body);
      }
      bodyOf.set(tile.id, body);

      let joint: RAPIER.RevoluteImpulseJoint | null = null;
      if (tile.parent) {
        const parentBody = bodyOf.get(tile.parent.id)!;
        const anchorW = tile.anchor.clone().add(offset);
        const axisW = tile.axis.clone().normalize();
        // The child's rest rotation relative to the parent is purely about the joint axis,
        // so the axis has the same local coordinates in both bodies and the measured joint
        // angle at rest equals the assembled angle.
        const jd = R.JointData.revolute(toLocal(parentBody, anchorW), toLocal(body, anchorW), toLocalDir(parentBody, axisW));
        joint = this.world.createImpulseJoint(jd, parentBody, body, true) as RAPIER.RevoluteImpulseJoint;
        if (tile.spec.joint !== 'wheel') {
          // Hinges hold their angle as a hard limit (rigid chips); the motor adds
          // the spring/damper feel on top. Rudder/Trim steer by moving the limits.
          const a = attr(tile.node, 'angle', env, 0) * (Math.PI / 180);
          joint.setLimits(a, a);
          const spring = clamp01(attr(tile.node, 'spring', env, 1));
          const damper = clamp01(attr(tile.node, 'damper', env, 0.5));
          joint.configureMotorModel(R.MotorModel.ForceBased);
          joint.configureMotorPosition(a, HINGE_STIFFNESS * (0.05 + spring), HINGE_DAMPING * (0.1 + damper));
        } else {
          // light rolling resistance so a free wheel does not spin forever
          body.setAngularDamping(0.2);
        }
      }
      const tb: TileBody = { tile, body, joint };
      this.tiles.push(tb);
      this.byId.set(tile.id, tb);
    }
  }

  /** Drive joints toward attribute values, apply wheel torque, jets and air drag. */
  applyControls(env: ValEnv): void {
    const DEG = Math.PI / 180;
    for (const tb of this.tiles) {
      const { tile, joint, body } = tb;
      if (tile.spec.merge) continue;
      const rot = body.rotation();
      const q = this.tmpQ.set(rot.x, rot.y, rot.z, rot.w);

      if (joint && tile.parent) {
        if (tile.spec.joint === 'wheel') {
          const power = attr(tile.node, 'power', env, 0);
          const brake = attr(tile.node, 'brake', env, 0);
          const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
          const parentBody = this.byId.get(tile.parent.id)!.body;
          let torque = power * WHEEL_TORQUE_PER_POWER;
          if (brake > 0) {
            const w = body.angvel();
            const pw = parentBody.angvel();
            const rel = (w.x - pw.x) * axis.x + (w.y - pw.y) * axis.y + (w.z - pw.z) * axis.z;
            torque -= rel * brake * 2;
          }
          if (torque !== 0) {
            const t = axis.clone().multiplyScalar(torque);
            body.addTorque({ x: t.x, y: t.y, z: t.z }, true);
            if (!tile.spec.noReaction) parentBody.addTorque({ x: -t.x, y: -t.y, z: -t.z }, true);
          }
        } else {
          const a = attr(tile.node, 'angle', env, 0) * DEG;
          if (tile.spec.joint === 'yaw' || tile.spec.joint === 'roll') {
            // steerable joints: slew the hard limit toward the requested angle
            joint.setLimits(a, a);
          }
          const spring = clamp01(attr(tile.node, 'spring', env, 1));
          const damper = clamp01(attr(tile.node, 'damper', env, 0.5));
          joint.configureMotorPosition(a, HINGE_STIFFNESS * (0.05 + spring), HINGE_DAMPING * (0.1 + damper));
        }
      }

      if (tile.spec.jet) {
        const power = attr(tile.node, 'power', env, 0);
        if (power !== 0) {
          const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(power * JET_NEWTON_PER_POWER);
          body.addForce({ x: n.x, y: n.y, z: n.z }, true);
        }
      }

      if (tile.spec.drag > 0) {
        // quadratic drag along the tile normal only (plates slip edge-on)
        const v = body.linvel();
        const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const vn = v.x * n.x + v.y * n.y + v.z * n.z;
        const f = -AIR_DRAG * tile.spec.drag * vn * Math.abs(vn);
        if (Math.abs(f) > 1e-6) body.addForce({ x: n.x * f, y: n.y * f, z: n.z * f }, true);
      }
    }
  }

  step(): void {
    this.world.step();
    this.tick++;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
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
