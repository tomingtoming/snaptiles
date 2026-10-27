import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TILE, TILE_T, assemblyBottom, attr, refreshJointFrames, type Assembly, type TileInstance, type ValEnv } from '../model/assemble';
import { exprIsConstant } from '../rc/expr';
import { COURSE } from '../model/course';

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
  /** wheels with a variable angle: the rim body and its fold joint (otherwise the rim is welded) */
  rim: RAPIER.RigidBody | null;
  rimJoint: RAPIER.RevoluteImpulseJoint | null;
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
/** compliant joints (spring<1): N·m/rad at spring=1 and N·m·s/rad at damper=1 — guesses */
export const SPRING_STIFFNESS = 4000;
export const SPRING_DAMPING = 400;

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

export interface BuildOptions {
  /** rest poses are already world poses (rebuild after a detach): do not lift onto the ground */
  inPlace?: boolean;
  /** per tile id, velocities to restore on the bodies that start a group */
  velocities?: Map<number, { lin: THREE.Vector3; ang: THREE.Vector3 }>;
}

export interface Projectile {
  body: RAPIER.RigidBody;
  born: number; // tick
  energy: number;
}

/** Arm: charge per step (spec says 2500 per 30 fps frame), muzzle speed and shell mass are guesses */
export const ARM_CHARGE_PER_STEP = 2500 / 2;
export const ARM_MUZZLE_SPEED = 80;
export const ARM_SHELL_MASS = 2;
export const ARM_SHELL_LIFE = 4 * 60;
export const ARM_ARMED_AFTER_TICK = 150 * 2;
const SHELL_GROUP = 0x0004_0002; // membership 4, collides with ground only

export class PhysicsWorld {
  world: RAPIER.World;
  tiles: TileBody[] = [];
  byId = new Map<number, TileBody>();
  readonly dt = 1 / 60;
  tick = 0;
  projectiles: Projectile[] = [];
  armCharge = new Map<number, number>(); // tile id → energy
  private assembly: Assembly | null = null;
  private env: ValEnv = () => undefined;

  /**
   * _BYE / _SPLIT: cut a tile (and its subtree) loose. Every tile's current world pose
   * becomes its new rest pose and the world is rebuilt in place with velocities kept.
   */
  detach(tile: TileInstance, powerless: boolean): void {
    if (!this.assembly || !tile.parent || tile.detached) return;
    const velocities = new Map<number, { lin: THREE.Vector3; ang: THREE.Vector3 }>();
    for (const tb of this.tiles) {
      const pose = this.pose(tb);
      tb.tile.position.copy(pose.position);
      tb.tile.quaternion.copy(pose.quaternion);
      const l = tb.body.linvel();
      const w = tb.body.angvel();
      velocities.set(tb.tile.id, { lin: new THREE.Vector3(l.x, l.y, l.z), ang: new THREE.Vector3(w.x, w.y, w.z) });
    }
    // joint anchors/axes live in the model frame: recompute them from the new poses
    for (const tb of this.tiles) refreshJointFrames(tb.tile);
    tile.detached = true;
    if (powerless) {
      const mark = (t: TileInstance) => { t.powerless = true; t.children.forEach(mark); };
      mark(tile);
    }
    const charges = new Map(this.armCharge);
    const shells = this.projectiles;
    const tick = this.tick;
    this.projectiles = [];
    this.build(this.assembly, this.env, new THREE.Vector3(), { inPlace: true, velocities });
    this.armCharge = charges;
    this.projectiles = shells;
    this.tick = tick;
  }

  constructor(private R: typeof RAPIER, opts: PhysicsOptions = {}) {
    this.world = new R.World({ x: 0, y: opts.gravity ?? -9.8, z: 0 });
    this.world.timestep = this.dt;
    this.world.numSolverIterations = 8;
    const groundDesc = R.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(1.0).setCollisionGroups(GROUND_GROUP);
    this.world.createCollider(groundDesc);
    for (const b of COURSE) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rotX ?? 0, b.rotY ?? 0, 0, 'YXZ'));
      const cd = R.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2)
        .setTranslation(...b.pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(1.0)
        .setCollisionGroups(GROUND_GROUP);
      this.world.createCollider(cd);
    }
  }

  clear(): void {
    for (const t of this.tiles) {
      if (t.joint) this.world.removeImpulseJoint(t.joint, true);
      if (t.rimJoint) this.world.removeImpulseJoint(t.rimJoint, true);
    }
    const seen = new Set<number>();
    for (const t of this.tiles) {
      if (t.rim) this.world.removeRigidBody(t.rim);
      if (seen.has(t.body.handle)) continue;
      seen.add(t.body.handle);
      this.world.removeRigidBody(t.body);
    }
    this.tiles = [];
    this.byId.clear();
    this.tick = 0;
    for (const p of this.projectiles) this.world.removeRigidBody(p.body);
    this.projectiles = [];
    this.armCharge.clear();
  }

  /** Arm: charge every step; fire a shell along the tile normal when power reaches option. */
  private updateArm(tb: TileBody, pose: Pose, normal: THREE.Vector3, env: ValEnv): void {
    const tile = tb.tile;
    const option = Math.max(0, tile.option);
    const charge = Math.min(option || Infinity, (this.armCharge.get(tile.id) ?? 0) + ARM_CHARGE_PER_STEP);
    this.armCharge.set(tile.id, charge);
    const power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
    if (option <= 0 || power < option || charge < option || this.tick < ARM_ARMED_AFTER_TICK) return;
    this.armCharge.set(tile.id, 0);
    const R = this.R;
    const v = this.velocity(tb, pose);
    const muzzle = pose.position.clone().add(normal.clone().multiplyScalar(0.6));
    const vel = v.clone().add(normal.clone().multiplyScalar(ARM_MUZZLE_SPEED));
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(muzzle.x, muzzle.y, muzzle.z).setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true),
    );
    this.world.createCollider(R.ColliderDesc.ball(0.15).setMass(ARM_SHELL_MASS).setCollisionGroups(SHELL_GROUP), body);
    this.projectiles.push({ body, born: this.tick, energy: option });
    const recoil = normal.clone().multiplyScalar(-ARM_SHELL_MASS * ARM_MUZZLE_SPEED);
    tb.body.applyImpulseAtPoint({ x: recoil.x, y: recoil.y, z: recoil.z }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
  }

  private cullProjectiles(): void {
    this.projectiles = this.projectiles.filter((p) => {
      const t = p.body.translation();
      const dead = this.tick - p.born > ARM_SHELL_LIFE || t.y < 0.16;
      if (dead) this.world.removeRigidBody(p.body);
      return !dead;
    });
  }

  build(a: Assembly, env: ValEnv, spawn = new THREE.Vector3(0, 0, 0), opts: BuildOptions = {}): void {
    this.clear();
    const R = this.R;
    const lift = opts.inPlace ? 0 : -assemblyBottom(a) + 0.02;
    const offset = spawn.clone().add(new THREE.Vector3(0, lift, 0));
    this.assembly = a;
    this.env = env;

    for (const tile of a.tiles) {
      const parentTb = tile.parent && !tile.detached ? this.byId.get(tile.parent.id)! : null;
      const angleExpr = tile.node.attrs.angle ?? '';
      const angleAnimated = !!parentTb && !exprIsConstant(angleExpr) && tile.spec.joint !== 'fixed';
      const animated = angleAnimated && tile.spec.joint !== 'wheel';
      // spring < 1 asks for a compliant connection (suspension); default spring=1 is rigid
      const springVal = tile.node.attrs.spring !== undefined ? attr(tile.node, 'spring', env, 1) : 1;
      const compliant = !!parentTb && !animated && tile.spec.joint !== 'wheel' && tile.spec.joint !== 'fixed' && springVal < 1;
      const startsGroup = !parentTb || tile.spec.joint === 'wheel' || animated || compliant;

      // Wheel = rim (a plate folded like a chip) + rotor (the disc). The rim is welded to the
      // parent, or gets its own fold joint when the angle is a variable.
      let rim: RAPIER.RigidBody | null = null;
      let rimJoint: RAPIER.RevoluteImpulseJoint | null = null;
      let rotorParent = parentTb?.body ?? null;
      if (tile.spec.wheel && parentTb) {
        const rimQuat = parentTb.bodyRestQuat;
        const rimRel = rimQuat.clone().invert().multiply(tile.quaternion);
        if (angleAnimated) {
          const p = tile.position.clone().add(offset);
          const rb = R.RigidBodyDesc.dynamic()
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: rimQuat.x, y: rimQuat.y, z: rimQuat.z, w: rimQuat.w })
            .setCcdEnabled(true);
          rim = this.world.createRigidBody(rb);
          // the rim is a hub well inside the disc so it never touches the ground
          const cd = R.ColliderDesc.cuboid(TILE / 4, TILE_T / 2, TILE / 4)
            .setMass(42.41)
            .setFriction(tile.spec.friction)
            .setCollisionGroups(MODEL_GROUP)
            .setRotation({ x: rimRel.x, y: rimRel.y, z: rimRel.z, w: rimRel.w });
          this.world.createCollider(cd, rim);
          const anchorW = tile.rimAnchor.clone().add(offset);
          const jd = R.JointData.revolute(toLocal(parentTb.body, anchorW), toLocal(rim, anchorW), toLocalDir(parentTb.body, tile.rimAxis));
          rimJoint = this.world.createImpulseJoint(jd, parentTb.body, rim, true) as RAPIER.RevoluteImpulseJoint;
          rimJoint.setLimits(0, 0);
          rotorParent = rim;
        } else {
          const rimPos = tile.position.clone().sub(parentTb.bodyRestPos).applyQuaternion(rimQuat.clone().invert());
          const cd = R.ColliderDesc.cuboid(TILE / 4, TILE_T / 2, TILE / 4)
            .setMass(42.41)
            .setFriction(tile.spec.friction)
            .setCollisionGroups(MODEL_GROUP)
            .setTranslation(rimPos.x, rimPos.y, rimPos.z)
            .setRotation({ x: rimRel.x, y: rimRel.y, z: rimRel.z, w: rimRel.w });
          this.world.createCollider(cd, parentTb.body);
        }
      }

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
        const v = opts.velocities?.get(tile.id);
        if (v) {
          body.setLinvel({ x: v.lin.x, y: v.lin.y, z: v.lin.z }, true);
          body.setAngvel({ x: v.ang.x, y: v.ang.y, z: v.ang.z }, true);
        }
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
      const mass = tile.spec.wheel ? 36.76 : tile.mass;
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
      if (startsGroup && parentTb && rotorParent) {
        const anchorW = tile.anchor.clone().add(offset);
        const axisW = tile.axis.clone().normalize();
        // Both bodies share the same rest orientation, so rapier's single joint axis has the
        // same coordinates in both local frames and the joint measures 0 at the rest pose.
        const jd = R.JointData.revolute(toLocal(rotorParent, anchorW), toLocal(body, anchorW), toLocalDir(rotorParent, axisW));
        joint = this.world.createImpulseJoint(jd, rotorParent, body, true) as RAPIER.RevoluteImpulseJoint;
        if (animated) joint.setLimits(0, 0);
        if (compliant) {
          const damper = tile.node.attrs.damper !== undefined ? attr(tile.node, 'damper', env, 0.5) : attr(tile.node, 'dumper', env, 0.5);
          joint.configureMotorModel(R.MotorModel.ForceBased);
          joint.configureMotorPosition(0, SPRING_STIFFNESS * Math.max(0.02, springVal), SPRING_DAMPING * Math.max(0.05, damper));
          joint.setLimits(-Math.PI / 3, Math.PI / 3);
        }
      }
      const restAngle = angleAnimated ? attr(tile.node, 'angle', env, 0) : 0;
      const tb: TileBody = { tile, body, groupRoot, relPos, relQuat, joint, animated, rim, rimJoint, bodyRestQuat, bodyRestPos, restAngle };
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
          const power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
          const brake = attr(tile.node, 'brake', env, 0);
          const parentBody = tb.rim ?? this.byId.get(tile.parent.id)!.body;
          if (tb.rimJoint) {
            const a = (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG;
            tb.rimJoint.setLimits(a, a);
          }
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

      if (tile.type === 'arm') this.updateArm(tb, pose, normal, env);

      if (tile.spec.jet) {
        const power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
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
    if (this.projectiles.length) this.cullProjectiles();
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
