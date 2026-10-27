import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TILE, TILE_T, assemblyBottom, attr, jointSign, refreshJointFrames, type Assembly, type TileInstance, type ValEnv } from '../model/assemble';
import { exprIsConstant } from '../rc/expr';
import { COURSE, CRATES } from '../model/course';

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
  /** last applied jet power (for the exhaust glow) */
  jetPower: number;
  /** current servo angle (rad, joint frame) of an animated joint */
  servoAngle: number;
}

export interface PhysicsOptions {
  gravity?: number;
}

/** power → torque scale for wheels: spec only says "TRQ≈1000" drives a car. */
export const WHEEL_TORQUE_PER_POWER = 0.066; // N·m per power unit (measured: Basic car, 4 wheels, a0 = 4.89 m/s² at power 2500)
/** motor torque falls linearly with the wheel's spin: T = k·power·(1 − ω/WHEEL_SPIN_FADE)
 *  (measured on the original 1.5B26: Basic car at power 2500, a/a0 = 0.877 at ω≈22 rad/s, 0.62 at ω≈69;
 *  no hard speed cap and no measurable air/rolling drag while coasting at 22 m/s) */
export const WHEEL_SPIN_FADE = 180; // rad/s at which the torque would reach zero
export const WHEEL_SPIN_INERTIA = 0.3; // kg·m² about every axis of the rotor (guess; the original's wheel-in-air spin-up is being measured)
/** spec: 6 power = 1 N */
export const JET_NEWTON_PER_POWER = 1 / 6;
/** plate aero (per 1 m² tile): broadside drag N per (m/s)², and the lift slope N per (m/s)² per sin α.
 *  ½ρ·Cd≈0.7 and ½ρ·2π≈3.8 for air; the original's numbers are unknown. */
export const AIR_DRAG = 0.7;
/** isotropic drag per tile: N per (m/s)² per unit coefficient (a guess; 20 chips ≈ 1.8 kN at 30 m/s) */
export const ISO_DRAG = 0; // 0 = off: it kept tonbo and the plane sample from taking off; kept as an experiment knob
export const LIFT_SLOPE = 3.8;
/** which plate aero law to use: 'quad' | 'newton' | 'slope' (probe with window.__tune.aero) */
export const AERO_MODEL = 'slope';
/** compliant joints (spring<1): N·m/rad at spring=1 and N·m·s/rad at damper=1 — guesses */
/** tyre friction coefficient (rapier combines with the ground's 1.0 by averaging) */
export const WHEEL_FRICTION = 1.4;
/** max servo slew of an animated joint, degrees per physics step (60 Hz) — 6°/step = 360°/s */
export const SERVO_RATE = 6;
/** servo stiffness (N·m/rad at spring=1) when > 0; 0 = infinitely stiff (hard limits). Probe knob: window.__tune.softServo */
export const SOFT_SERVO = 0;
export const SERVO_BAND = (20 * Math.PI) / 180;
export const SPRING_STIFFNESS = 4000;
export const SPRING_DAMPING = 400;
/** compliant joints may flex this far either way; beyond it the connection is rigid */
export const SPRING_TRAVEL = (8 * Math.PI) / 180;

// Tiles of a model never collide with each other (only with the ground / objects).
const MODEL_GROUP = 0x0001_0002; // membership 1, filter 2
const GROUND_GROUP = 0x0002_0007; // membership 2, collides with models, other ground-like things and shells

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
    for (const c of CRATES) {
      const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...c.pos).setLinearDamping(0.1).setAngularDamping(0.2));
      const cd = R.ColliderDesc.cuboid(c.size / 2, c.size / 2, c.size / 2).setMass(12).setFriction(0.8).setCollisionGroups(GROUND_GROUP);
      this.world.createCollider(cd, body);
      this.crates.push(body);
    }
  }

  /** knockable crates (course props), reset with the model */
  crates: RAPIER.RigidBody[] = [];
  resetCrates(): void {
    this.crates.forEach((b, i) => {
      const c = CRATES[i];
      b.setTranslation({ x: c.pos[0], y: c.pos[1], z: c.pos[2] }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
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
      const noSpring = (globalThis as unknown as { __tune?: { noSpring?: boolean } }).__tune?.noSpring ?? false;
      const compliant = !noSpring && !!parentTb && !animated && tile.spec.joint !== 'wheel' && tile.spec.joint !== 'fixed' && springVal < 1;
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
          // the original shows no measurable drag coasting at 22 m/s; damping only steals speed
          .setLinearDamping(0)
          .setAngularDamping(tile.spec.wheel ? 0 : 0.05)
          .setCcdEnabled(!(globalThis as unknown as { __tune?: { noCcd?: boolean } }).__tune?.noCcd);
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
          ? R.ColliderDesc.cylinder(TILE_T / 2, wheelRadius(tile.option))
          : R.ColliderDesc.cuboid(TILE / 2, TILE_T / 2, TILE / 2);
        if (tile.spec.wheel) {
          // rotor: full mass for translation but a small spin inertia — the original's cars accelerate
          // as if the wheels had none (Basic car: m·a matches the motor torque / radius)
          cd.setMassProperties(mass, { x: 0, y: 0, z: 0 }, { x: WHEEL_SPIN_INERTIA, y: WHEEL_SPIN_INERTIA, z: WHEEL_SPIN_INERTIA }, { x: 0, y: 0, z: 0, w: 1 });
        } else cd.setMass(Math.max(0.1, mass));
        cd.setFriction(tile.spec.wheel ? ((globalThis as unknown as { __tune?: { wheelFriction?: number } }).__tune?.wheelFriction ?? WHEEL_FRICTION) : tile.spec.friction).setCollisionGroups(MODEL_GROUP);
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
          joint.setLimits(-SPRING_TRAVEL, SPRING_TRAVEL);
        }
      }
      const restAngle = angleAnimated ? attr(tile.node, 'angle', env, 0) : 0;
      const tb: TileBody = { tile, body, groupRoot, relPos, relQuat, joint, animated, rim, rimJoint, bodyRestQuat, bodyRestPos, restAngle, jetPower: 0, servoAngle: 0 };
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
          // reaction goes to the body the rim hangs from (not the rim itself: a steady torque
          // against the rim joint's hard limits pumps energy into the solver and lifts the car)
          const parentBody = this.byId.get(tile.parent.id)!.body;
          if (tb.rimJoint) {
            const a = jointSign('wheel', tile.dir) * (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG; // rim fold
            tb.rimJoint.setLimits(a, a);
          }
          const w = body.angvel();
          const pw = parentBody.angvel();
          const rel = (w.x - pw.x) * normal.x + (w.y - pw.y) * normal.y + (w.z - pw.z) * normal.z; // spin about the rim normal
          let torque = power * ((globalThis as unknown as { __tune?: { wheelTorque?: number } }).__tune?.wheelTorque ?? WHEEL_TORQUE_PER_POWER);
          if (power !== 0) {
            const along = Math.sign(power) * rel; // spin in the driven direction
            torque *= Math.max(0, 1 - Math.max(0, along) / WHEEL_SPIN_FADE);
          }
          if (brake > 0) torque -= rel * brake * 2;
          if (torque !== 0) {
            const t = normal.clone().multiplyScalar(torque);
            body.addTorque({ x: t.x, y: t.y, z: t.z }, true);
            const noReaction = (globalThis as unknown as { __tune?: { noReaction?: boolean } }).__tune?.noReaction ?? false;
            if (!tile.spec.noReaction && !noReaction) parentBody.addTorque({ x: -t.x, y: -t.y, z: -t.z }, true);
          }
        } else if (tb.animated) {
          // servo: the commanded angle is reached at a bounded rate (window.__tune.servoRate
          // deg per physics step) instead of instantly — instant jumps of a leg joint pump
          // energy through the hard limits and launch walkers
          const rate = ((globalThis as unknown as { __tune?: { servoRate?: number } }).__tune?.servoRate ?? SERVO_RATE) * DEG;
          const target = jointSign(tile.spec.joint, tile.dir) * (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG;
          const d = target - tb.servoAngle;
          tb.servoAngle += Math.max(-rate, Math.min(rate, d));
          const soft = (globalThis as unknown as { __tune?: { softServo?: number } }).__tune?.softServo ?? SOFT_SERVO;
          if (soft > 0) {
            // finite-strength servo: a position motor (stiffness ∝ spring) with a safety band of limits
            const spring = tile.node.attrs.spring !== undefined ? Math.max(0.05, attr(tile.node, 'spring', env, 1)) : 1;
            joint.configureMotorModel(this.R.MotorModel.ForceBased);
            joint.configureMotorPosition(tb.servoAngle, soft * spring, soft * 0.08);
            joint.setLimits(tb.servoAngle - SERVO_BAND, tb.servoAngle + SERVO_BAND);
          } else {
            joint.setLimits(tb.servoAngle, tb.servoAngle);
          }
        }
      }

      if (tile.type === 'arm') this.updateArm(tb, pose, normal, env);

      if (tile.spec.jet) {
        const power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
        tb.jetPower = power;
        if (power !== 0) {
          // option 1/2 = balloon (wikiwiki: 1 hydrogen, 2 air): buoyancy straight up, whatever the tilt;
          // the airship model mounts them at angle -90/0/90 and lifts with 10,000-50,000
          const balloon = tile.option === 1 || tile.option === 2;
          const f = balloon
            ? new THREE.Vector3(0, power * JET_NEWTON_PER_POWER, 0)
            : normal.clone().multiplyScalar(power * JET_NEWTON_PER_POWER);
          body.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
        }
      }

      if (tile.spec.drag > 0) {
        const v = this.velocity(tb, pose);
        // isotropic air resistance per tile (the reference table lists a per-type coefficient:
        // Chip 1, Weight 1, Arm 0.7, Wheel 0.05, Frame/Jet 0) — caps top speeds
        const vl = v.length();
        if (vl > 0.5) {
          const iso = -ISO_DRAG * tile.spec.drag * vl;
          body.addForceAtPoint({ x: v.x * iso, y: v.y * iso, z: v.z * iso }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
        }
        // plate normal force (lift at angle of attack, broadside drag)
        const vn = v.dot(normal);
        // Thin plate: normal force rises with the angle of attack (lift slope LIFT_SLOPE per
        // sin α) and saturates at the broadside drag (AIR_DRAG per v²). Edge-on plates feel nothing.
        const speed = v.length();
        const aero = (globalThis as unknown as { __tune?: { aero?: string } }).__tune?.aero ?? AERO_MODEL;
        let mag: number;
        if (aero === 'quad') mag = 0.9 * vn * vn; // original guess: v_n·|v_n|
        else if (aero === 'newton') mag = 0.9 * speed * Math.abs(vn);
        else mag = Math.min(LIFT_SLOPE * speed * Math.abs(vn), AIR_DRAG * speed * speed);
        const f = -Math.sign(vn) * tile.spec.drag * mag;
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

/** rotor radius per Wheel option (0/1/2). Only the ordering is documented; sizes are guesses,
 *  chosen so the tyre reaches beyond the corners of the rim plate (half-diagonal 0.71). */
export function wheelRadius(option: number): number {
  const tune = (globalThis as unknown as { __tune?: { wheelRadius?: number } }).__tune?.wheelRadius;
  const base = tune ?? WHEEL_RADIUS0;
  // measured 2026-10-27: option 1 rolls at 0.45 m, option 2 at 0.60 m (1.5× and 2× option 0)
  return base * (option >= 2 ? 2 : option >= 1 ? 1.5 : 1);
}
/** measured: the Basic car (option 0) rolls at v/ω = 0.30 m in the original */
export const WHEEL_RADIUS0 = 0.3;
