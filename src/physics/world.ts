import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { DIR_VEC, TILE, TILE_T, assemblyBottom, attr, jointSign, refreshJointFrames, type Assembly, type TileInstance, type ValEnv } from '../model/assemble';
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
  /** wheels: kinematic spin about the rim normal (rad/s, + in the +power direction) and the
   *  accumulated angle for rendering. The tyre is not a spinning body (measured: the original's
   *  wheel does not spin up in the air and reads _WY = v/r while rolling). */
  spin: number;
  spinAngle: number;
  /** wheels: ground contact point of the last step (null in the air) and the static load (N) this wheel
   *  carries, distributed over the touching wheels by the lever rule about the model's centre of mass */
  contactPoint: THREE.Vector3 | null;
  load: number;
  /** the tyre collider (wheels) and the smoothed normal force it measured in the last steps */
  collider: import('@dimforge/rapier3d-compat').Collider | null;
  contactForce: number;
  /** wheels: the tyre is sliding against the ground (drive or brake beyond the grip), spin then integrates */
  slipping: boolean;
  /** revolute axis in the parent body's local frame (for measuring the current joint angle) */
  jointAxisLocal: THREE.Vector3 | null;
  jointAnchorLocal: THREE.Vector3 | null;
}

export interface PhysicsOptions {
  gravity?: number;
}

/** power → torque scale for wheels: spec only says "TRQ≈1000" drives a car. */
export const WHEEL_TORQUE_PER_POWER = 0.13; // N·m per power unit (measured: Basic car with all four wheels at power 2500 accelerates at 8.5 m/s²; attributes bound to a Val ignore _SET, so the first runs only drove the two front wheels)
/** motor torque falls linearly with the wheel's spin: T = k·power·(1 − ω/WHEEL_SPIN_FADE)
 *  (measured on the original 1.5B26: Basic car at power 2500, a/a0 = 0.877 at ω≈22 rad/s, 0.62 at ω≈69;
 *  no hard speed cap and no measurable air/rolling drag while coasting at 22 m/s) */
export const WHEEL_SPIN_FADE = 180; // rad/s at which the torque would reach zero
/** rapier velocity-solver iterations per step (joint chains sag less with more) */
export const SOLVER_ITERATIONS = 16; // 8 let the 3-wheeler's joint chain sag 0.4 m under its own weight; 32 settles it at the original's height
/** brake: deceleration in g per brake unit and its cap (measured on the original, 4-wheel car) */
export const BRAKE_G_PER_UNIT = 0.022;
export const BRAKE_G_MAX = 0.8;
/** lateral grip: fraction of the sideways contact velocity removed per step (1 = dead stop) */
export const TYRE_LATERAL_GAIN = 0.25;
/** drive and lateral tyre force share one friction circle of radius mu*load (measured, see driveWheel) */
export const TYRE_FRICTION_CIRCLE = true;
/** lateral grip per wheel as a fraction of its load. Measured on the original (steered Basic-layout car,
 *  10 and 20 deg, 468 kg and 871 kg): the lateral acceleration tops out at 1.05-1.13 g with little drive
 *  (docs/measured.md); 1.2 of the dynamic load reproduces 1.08 / 0.85 / 0.97 g in the three reference turns */
export const TYRE_LATERAL_MU = 1.2;
/** which force wins inside the ellipse when both saturate (see driveWheel) */
export const TYRE_LATERAL_FIRST = false;
/** wheels slide and spin up when the motor exceeds the grip (measured: powered wheels at 135-155 rad/s at power
 *  5000 while rolling would be 25-100, 315-390 at 10000); false: kinematic spin v/r with a capped force */
export const WHEEL_SPIN_DYNAMICS = true;
/** fade zero point per unit of power above 2500 (rad/s per power): the sliding-wheel equilibria 135 rad/s at
 *  5000 and 376 at 10000 both fit ω0 = power / 20.6 with no extra spin drag */
export const WHEEL_SPIN_PER_POWER = 1 / 20.6;
/** wheel inertia as a fraction of ½mr² with m the hub+tyre mass: the air spin-up at power 10000 (34→207 rad/s in
 *  12 frames) and the sliding spin-up on the ground both fit ≈ 0.7 */
export const WHEEL_INERTIA_SCALE = 0.7;
/** the motor torque reacts on the chassis (Wheel); RLW is the reactionless one */
export const WHEEL_REACTION = true;
/** spin drag on a sliding wheel (N·m·s); 0 once the fade zero point scales with power */
export const WHEEL_SPIN_DRAG = 0;
/** the tyre still grips this far above the ground (the unsprung front lifts a few cm under power) */
export const TYRE_CONTACT_MARGIN = 0.1;
/** load the tyre forces may transmit: μ × (model weight / number of wheels) */
export const TYRE_LOAD_SHARE = 1;
/** per-wheel load from the static lever rule about the centre of mass (false: total mass / wheel count);
 *  only the fallback before the tyre has measured a contact force (TYRE_DYNAMIC_LOAD) */
export const TYRE_STATIC_LOAD = true;
/** spawn the model falling from the original's height (false: place it 2 cm above the ground) */
export const SPAWN_DROP = true;
/** use the normal force the tyre collider actually carried (contact impulses of the last step, smoothed) instead
 *  of the static lever rule: load transfer under acceleration, braking and cornering. Measured: the corpus bike
 *  reaches 14.4 m/s in 3 s at power 5000 on a rear wheel whose static share could not carry that drive, while the
 *  steered car's powered (leading) axle saturates at 1030 N per wheel on ~990 N of contact load */
export const TYRE_DYNAMIC_LOAD = true;
export const TYRE_LOAD_SMOOTH = 0.3;
/** dynamic load used for grip is capped at this multiple of the wheel's static share */
export const TYRE_LOAD_CAP = 3;
/** spec: 6 power = 1 N */
export const JET_NEWTON_PER_POWER = 0.145; // measured 2026-10-28: a 530 kg wheeled car pushed by a jet at power 10000 accelerates at 2.74 m/s² (1452 N); the same at 5000 (1.38 m/s²); wheel option makes no difference
/** plate aero (per 1 m² tile): broadside drag N per (m/s)², and the lift slope N per (m/s)² per sin α.
 *  ½ρ·Cd≈0.7 and ½ρ·2π≈3.8 for air; the original's numbers are unknown. */
export const AIR_DRAG = 0.7;
/** isotropic drag per tile: N per (m/s)² per unit coefficient (a guess; 20 chips ≈ 1.8 kN at 30 m/s) */
export const ISO_DRAG = 0; // 0 = off: it kept tonbo and the plane sample from taking off; kept as an experiment knob
export const LIFT_SLOPE = 3.8;
/** which plate aero law to use: 'quad' | 'newton' | 'slope' (probe with window.__tune.aero) */
export const AERO_MODEL = 'pow';
/** plate normal force per chip = v² · (AERO_K·sin^AERO_P α + AERO_K2·sin^AERO_P2 α), α = angle to the airflow.
 *  Measured on the original with a jet-pushed rolling car (drag per chip / v²: 0.22 at 15°, 1.2 at 30°,
 *  2.85 at 45°, ≈4 at 50°; at 60–90° the car stalls near 1–3 m/s). The second term is the steep rise
 *  toward broadside that the original's readme mentions. */
export const AERO_K = 6.7;
export const AERO_P = 1.5;
export const AERO_K2 = 9.3;
export const AERO_P2 = 8;
/** compliant joints (spring<1): N·m/rad at spring=1 and N·m·s/rad at damper=1 — guesses */
/** tyre friction coefficient (rapier combines with the ground's 1.0 by averaging) */
export const WHEEL_FRICTION = 1.1; // measured against the dynamic (contact) load: the Basic layout drives S-first, so its powered axle leads and unloads to ~990 N under acceleration where it saturates at 1030 N; corpus bike unsaturated at power 5000
/** max servo slew of an animated joint, degrees per physics step (60 Hz) — 6°/step = 360°/s */
/** measured 2026-10-27: the original applies a commanded joint angle within one frame (a Rudder reads
 *  60° one frame after the Val changes), so the servo is instant by default (deg per physics step) */
export const SERVO_RATE = 180;
/** apply servo angles by rigidly turning both sides about the hinge (momentum-free, inertia-weighted)
 *  instead of through rapier joint limits, which take ~10 frames to catch up and chatter under load */
export const SERVO_TELEPORT = true;
/** extra inertia factor (× mass) for a grounded body a servo would drag along the ground */
export const SERVO_HOLD = 1000;
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
  /** position at the previous step, for the swept hit test against chip spheres */
  prev: THREE.Vector3;
}

/** Arm: charge per step (spec says 2500 per 30 fps frame); muzzle speed 300 m/s from the original's readme
 *  (15B13: "150 → 300 m/s"); the shell mass is a guess. Shells hit every chip as a sphere of radius
 *  ARM_HIT_RADIUS around its centre (readme 15B11: all chips are spheres r = 0.3 for shell hits, own chips
 *  included) and take ARM_DAMAGE_PER_ENERGY × energy / chip mass off its durability (`_T`, 0..10000) */
export const ARM_CHARGE_PER_STEP = 5000 / 2; // measured: shots every 11 / 21 frames at option 50000 / 100000
export const ARM_MUZZLE_SPEED = 300;
export const ARM_HIT_RADIUS = 0.3;
/** durability taken per hit = this × energy / chip mass: measured 5000 off a 25.2 kg Chip at option 50000 */
export const ARM_DAMAGE_PER_ENERGY = 2.52;
/** recoil impulse per unit of shot energy (N·s): measured +0.42 m/s per shot on a 518 kg car at option 50000 */
export const ARM_RECOIL_PER_ENERGY = 0.0043; // and +1.7 m/s per shot at 200000: linear in energy
export const ARM_DESTROY_DETACH = true;

/** Fuel (readme 15B24/B25, measured 2026-10-28 with regulation E off): capacities per chip Core 2,000,000,
 *  Chip-type 1,000,000, Frame-type 500,000, Weight 6,000,000 × option, others 0. A wheel burns 0.025 × |power|
 *  per 30 fps frame whatever its speed or load (two wheels at 2500: 125/frame), an Arm burns its charge
 *  (5000/frame while charging), a Jet FUEL_PER_POWER_JET × |power|. Regulation E on (the default) is the
 *  "high-efficiency fuel": nothing is consumed. Fuel is drawn from the whole model, Weights first. */
export const FUEL_CAPACITY: Record<string, number> = { core: 2_000_000, chip: 1_000_000, rudder: 1_000_000, trim: 1_000_000, frame: 500_000, rudderf: 500_000, trimf: 500_000, weight: 6_000_000 };
export const FUEL_PER_POWER_WHEEL = 0.025;
export const FUEL_PER_POWER_JET = 0.1; // measured: a jet at 10000 burns 1000 per frame (the readme's efficiency 10); wheels burn power/40, not /30
export const FUEL_PER_ARM_CHARGE = 1;
export const REGULATION_DEFAULTS: Record<string, number> = { G: 1, A: 1, T: 1, J: 0, U: 0, C: 1, S: 1, E: 1 };
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
  /** mass of the assembled model (tyre load estimate) */
  totalMass = 0;
  projectiles: Projectile[] = [];
  armCharge = new Map<number, number>(); // tile id → energy
  /** fuel per tile id and the regulation switches (letters of the original's HUD row) */
  fuel = new Map<number, number>();
  fuelMax = new Map<number, number>();
  regulations: Record<string, number> = { ...REGULATION_DEFAULTS, ...((globalThis as unknown as { __tune?: { regulations?: Record<string, number> } }).__tune?.regulations ?? {}) };

  /** total fuel / capacity of the model */
  fuelTotal(): number { let t = 0; for (const v of this.fuel.values()) t += v; return t; }
  fuelMaxTotal(): number { let t = 0; for (const v of this.fuelMax.values()) t += v; return t; }

  /** burn `amount` (units per 30 fps frame, already scaled to the step) if regulation E is off; returns the
   *  fraction of the demand that could be met (0 when the tanks are dry) */
  useFuel(amount: number): number {
    if (this.regulations.E || amount <= 0) return 1;
    let total = this.fuelTotal();
    if (total <= 0) return 0;
    const take = Math.min(amount, total);
    // Weights first, then every other chip in proportion to what it holds
    let left = take;
    const weights = this.tiles.filter((t) => t.tile.type === 'weight' && (this.fuel.get(t.tile.id) ?? 0) > 0);
    const wsum = weights.reduce((a, t) => a + (this.fuel.get(t.tile.id) ?? 0), 0);
    if (wsum > 0) {
      const w = Math.min(left, wsum);
      for (const t of weights) { const f = this.fuel.get(t.tile.id)!; this.fuel.set(t.tile.id, f - (w * f) / wsum); }
      left -= w;
    }
    if (left > 0) {
      const others = this.tiles.filter((t) => t.tile.type !== 'weight' && (this.fuel.get(t.tile.id) ?? 0) > 0);
      const osum = others.reduce((a, t) => a + (this.fuel.get(t.tile.id) ?? 0), 0);
      if (osum > 0) for (const t of others) { const f = this.fuel.get(t.tile.id)!; this.fuel.set(t.tile.id, f - (left * f) / osum); }
    }
    return take / amount;
  }
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
    const tune = (globalThis as unknown as { __tune?: { solverIterations?: number; pgsIterations?: number } }).__tune;
    this.world.numSolverIterations = tune?.solverIterations ?? SOLVER_ITERATIONS;
    if (tune?.pgsIterations) this.world.integrationParameters.numInternalPgsIterations = tune.pgsIterations;
    const groundDesc = R.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(1.0).setCollisionGroups(GROUND_GROUP);
    this.world.createCollider(groundDesc);
    const noCourse = (globalThis as unknown as { __tune?: { noCourse?: boolean } }).__tune?.noCourse ?? false; // bare ground for measurements
    for (const b of noCourse ? [] : COURSE) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rotX ?? 0, b.rotY ?? 0, 0, 'YXZ'));
      const cd = R.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2)
        .setTranslation(...b.pos)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(1.0)
        .setCollisionGroups(GROUND_GROUP);
      this.world.createCollider(cd);
    }
    for (const c of noCourse ? [] : CRATES) {
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
      if (t.rim && !seen.has(t.rim.handle)) {
        seen.add(t.rim.handle);
        this.world.removeRigidBody(t.rim);
      }
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
    const have = this.armCharge.get(tile.id) ?? 0;
    const want = Math.min(ARM_CHARGE_PER_STEP, Math.max(0, (option || Infinity) - have));
    const charge = have + want * this.useFuel(FUEL_PER_ARM_CHARGE * want);
    this.armCharge.set(tile.id, charge);
    const power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
    if (option <= 0 || power < option || charge < option || this.tick < ARM_ARMED_AFTER_TICK) return;
    this.armCharge.set(tile.id, 0);
    const R = this.R;
    const v = this.velocity(tb, pose);
    // the shell leaves along the Arm's own forward edge (away from the chip it hangs on), not its normal:
    // measured on the original, an Arm standing on an upright column recoils vertically, and the readme
    // forbids attaching chips in the firing direction
    const fwd = DIR_VEC[tile.dir ?? 'N'].clone().applyQuaternion(pose.quaternion);
    void normal;
    const muzzle = pose.position.clone().add(fwd.clone().multiplyScalar(0.6));
    const vel = v.clone().add(fwd.clone().multiplyScalar(ARM_MUZZLE_SPEED));
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(muzzle.x, muzzle.y, muzzle.z).setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true),
    );
    // the shell's momentum is the measured recoil impulse (its mass follows from the muzzle speed)
    const impulse = ARM_RECOIL_PER_ENERGY * option;
    // a sensor: the shell never bounces, chip hits and the ground hit are swept tests in cullProjectiles
    this.world.createCollider(R.ColliderDesc.ball(0.15).setMass(Math.max(0.01, impulse / ARM_MUZZLE_SPEED)).setCollisionGroups(SHELL_GROUP).setSensor(true), body);
    this.projectiles.push({ body, born: this.tick, energy: option, prev: muzzle.clone() });
    const recoil = fwd.clone().multiplyScalar(-impulse);
    tb.body.applyImpulseAtPoint({ x: recoil.x, y: recoil.y, z: recoil.z }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
  }

  private cullProjectiles(): void {
    const hitTargets = this.tiles.filter((tb) => (tb.tile.durability ?? 10000) >= 0);
    this.projectiles = this.projectiles.filter((p) => {
      const t = p.body.translation();
      const cur = new THREE.Vector3(t.x, t.y, t.z);
      let dead = this.tick - p.born > ARM_SHELL_LIFE || t.y < -1;
      if (!dead) {
        // swept sphere test against every chip centre (closest chip along the path wins); the ground (and
        // course) is hit by a ray along the same path - shells skim the ground when an Arm lies flat on it
        const seg = cur.clone().sub(p.prev);
        const len2 = seg.lengthSq();
        let best: TileBody | null = null;
        let bestS = Infinity;
        if (len2 > 0) {
          const len = Math.sqrt(len2);
          const ray = new this.R.Ray({ x: p.prev.x, y: p.prev.y, z: p.prev.z }, { x: seg.x / len, y: seg.y / len, z: seg.z / len });
          const g = this.world.castRay(ray, len, true, undefined, 0x0004_0002);
          if (g) { bestS = g.timeOfImpact / len; dead = true; }
        }
        for (const tb of hitTargets) {
          const c = this.pose(tb).position;
          const w = c.clone().sub(p.prev);
          const sParam = len2 > 0 ? Math.max(0, Math.min(1, w.dot(seg) / len2)) : 0;
          const d2 = w.clone().sub(seg.clone().multiplyScalar(sParam)).lengthSq();
          if (d2 <= ARM_HIT_RADIUS * ARM_HIT_RADIUS && sParam < bestS) { best = tb; bestS = sParam; }
        }
        if (best) {
          dead = true;
          best.tile.durability = (best.tile.durability ?? 10000) - (ARM_DAMAGE_PER_ENERGY * p.energy) / Math.max(1, best.tile.mass);
          const m = p.body.mass();
          const lv = p.body.linvel();
          const hitAt = this.pose(best).position;
          if (best.tile.durability <= 0) {
            // measured: the destroyed chip reads _T −1, comes loose and flies off with the shell's momentum
            // (a Chip hit at option 200000 leaves at ~50 m/s along the shot)
            best.tile.durability = -1;
            if (ARM_DESTROY_DETACH && best.tile.parent) this.detach(best.tile, true);
          }
          const tb = this.byId.get(best.tile.id) ?? best;
          tb.body.applyImpulseAtPoint({ x: m * lv.x, y: m * lv.y, z: m * lv.z }, { x: hitAt.x, y: hitAt.y, z: hitAt.z }, true);
          dead = true;
        }
      }
      if (dead) this.world.removeRigidBody(p.body);
      else p.prev.copy(cur);
      return !dead;
    });
  }

  build(a: Assembly, env: ValEnv, spawn = new THREE.Vector3(0, 0, 0), opts: BuildOptions = {}): void {
    this.clear();
    const R = this.R;
    // measured on the original: the core spawns 1.0 m + the model's reach along z (tile centres) above the ground
    // and the model falls from there (core only 1.03, one chip 1.63, three chips in a row 2.83, the Basic
    // car 2.37); the wheels of a powered car spin up during the fall and the landing pitches it
    const drop = (globalThis as unknown as { __tune?: { spawnDrop?: boolean } }).__tune?.spawnDrop ?? SPAWN_DROP;
    const reach = a.tiles.reduce((m, t) => Math.max(m, Math.abs(t.position.z - a.tiles[0].position.z)), 0);
    const lift = opts.inPlace ? 0 : drop ? 1.0 + reach - a.tiles[0].position.y : -assemblyBottom(a) + 0.02;
    const offset = spawn.clone().add(new THREE.Vector3(0, lift, 0));
    this.assembly = a;
    this.env = env;
    this.totalMass = a.tiles.reduce((m, t) => m + t.mass, 0);
    if (!opts.inPlace) {
      // a fresh model: full tanks (a detach rebuild keeps what was left)
      this.fuel.clear();
      this.fuelMax.clear();
      for (const t of a.tiles) {
        const cap = (FUEL_CAPACITY[t.type] ?? 0) * (t.type === 'weight' ? Math.max(1, Math.min(8, t.option || 1)) : 1);
        this.fuel.set(t.id, cap);
        this.fuelMax.set(t.id, cap);
      }
    }
    const tyreColliders = new Map<number, import('@dimforge/rapier3d-compat').Collider>();

    for (const tile of a.tiles) {
      const parentTb = tile.parent && !tile.detached ? this.byId.get(tile.parent.id)! : null;
      const angleExpr = tile.node.attrs.angle ?? '';
      const angleAnimated = !!parentTb && !exprIsConstant(angleExpr) && tile.spec.joint !== 'fixed';
      const animated = angleAnimated && tile.spec.joint !== 'wheel';
      // spring < 1 asks for a compliant connection (suspension); default spring=1 is rigid
      const springVal = tile.node.attrs.spring !== undefined ? attr(tile.node, 'spring', env, 1) : 1;
      // measured 2026-10-27: a Frame(spring=0.1) holding a 4× Weight at 1.2 m sags only 0.1° in the original
      // (spring=0.5: none) — spring joints are rigid for practical purposes, so they are welded unless asked
      const noSpring = !((globalThis as unknown as { __tune?: { springJoints?: boolean } }).__tune?.springJoints ?? false);
      const compliant = !noSpring && !!parentTb && !animated && tile.spec.joint !== 'wheel' && tile.spec.joint !== 'fixed' && springVal < 1;
      const startsGroup = !parentTb || animated || compliant;

      // Wheel = rim (a plate folded like a chip) + rotor (the disc). The rim is welded to the
      // parent, or gets its own fold joint when the angle is a variable.
      let rim: RAPIER.RigidBody | null = null;
      let rimJoint: RAPIER.RevoluteImpulseJoint | null = null;
      if (tile.spec.wheel && parentTb) {
        const rimQuat = parentTb.bodyRestQuat;
        if (angleAnimated) {
          const p = tile.position.clone().add(offset);
          const rb = R.RigidBodyDesc.dynamic()
            .setTranslation(p.x, p.y, p.z)
            .setRotation({ x: rimQuat.x, y: rimQuat.y, z: rimQuat.z, w: rimQuat.w })
            .setCcdEnabled(true);
          rim = this.world.createRigidBody(rb);
          const anchorW = tile.rimAnchor.clone().add(offset);
          const jd = R.JointData.revolute(toLocal(parentTb.body, anchorW), toLocal(rim, anchorW), toLocalDir(parentTb.body, tile.rimAxis));
          rimJoint = this.world.createImpulseJoint(jd, parentTb.body, rim, true) as RAPIER.RevoluteImpulseJoint;
          rimJoint.setLimits(0, 0);
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
      } else if (rim) {
        body = rim;
        groupRoot = tile;
        bodyRestQuat = parentTb!.bodyRestQuat.clone();
        bodyRestPos = tile.position.clone();
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
        // the tyre is a sphere: a frictionless cylinder lying on the ground made the chassis wander and roll
        // (edge contacts), a ball reproduces the original's straight-line run within a few percent
        const tyreCylinder = (globalThis as unknown as { __tune?: { tyreCylinder?: boolean } }).__tune?.tyreCylinder ?? false;
        const cd = tile.spec.wheel
          ? tyreCylinder ? R.ColliderDesc.cylinder(TILE_T / 2, wheelRadius(tile.option)) : R.ColliderDesc.ball(wheelRadius(tile.option))
          : R.ColliderDesc.cuboid(TILE / 2, TILE_T / 2, TILE / 2);
        // a tyre is a frictionless cylinder (it only carries load); grip comes from driveWheel()
        const frictionScale = (globalThis as unknown as { __tune?: { frictionScale?: number } }).__tune?.frictionScale ?? 1;
        cd.setMass(Math.max(0.1, mass)).setFriction(tile.spec.wheel ? 0 : tile.spec.friction * frictionScale).setCollisionGroups(MODEL_GROUP);
        // rapier averages friction by default, so a chip's 0.02 against the ground's 1.0 would act as 0.5:
        // the tile's own coefficient is the measured one, let it rule
        cd.setFrictionCombineRule(R.CoefficientCombineRule.Min);
        cd.setTranslation(relPos.x, relPos.y, relPos.z).setRotation({ x: relQuat.x, y: relQuat.y, z: relQuat.z, w: relQuat.w });
        if (tile.ghost || !tile.spec.collides) cd.setSensor(true);
        const col = this.world.createCollider(cd, body);
        if (tile.spec.wheel) tyreColliders.set(tile.id, col);
      }

      let joint: RAPIER.RevoluteImpulseJoint | null = null;
      let jointAxisLocal: THREE.Vector3 | null = null;
      let jointAnchorLocal: THREE.Vector3 | null = null;
      if (startsGroup && parentTb) {
        const anchorW = tile.anchor.clone().add(offset);
        const axisW = tile.axis.clone().normalize();
        // Both bodies share the same rest orientation, so rapier's single joint axis has the
        // same coordinates in both local frames and the joint measures 0 at the rest pose.
        const axisL = toLocalDir(parentTb.body, axisW);
        jointAxisLocal = new THREE.Vector3(axisL.x, axisL.y, axisL.z);
        const anchL = toLocal(parentTb.body, anchorW);
        jointAnchorLocal = new THREE.Vector3(anchL.x, anchL.y, anchL.z);
        const jd = R.JointData.revolute(toLocal(parentTb.body, anchorW), toLocal(body, anchorW), axisL);
        joint = this.world.createImpulseJoint(jd, parentTb.body, body, true) as RAPIER.RevoluteImpulseJoint;
        if (animated) joint.setLimits(0, 0);
        if (compliant) {
          const damper = tile.node.attrs.damper !== undefined ? attr(tile.node, 'damper', env, 0.5) : attr(tile.node, 'dumper', env, 0.5);
          joint.configureMotorModel(R.MotorModel.ForceBased);
          joint.configureMotorPosition(0, SPRING_STIFFNESS * Math.max(0.02, springVal), SPRING_DAMPING * Math.max(0.05, damper));
          joint.setLimits(-SPRING_TRAVEL, SPRING_TRAVEL);
        }
      }
      const restAngle = angleAnimated ? attr(tile.node, 'angle', env, 0) : 0;
      const tb: TileBody = { tile, body, groupRoot, relPos, relQuat, joint, animated, rim, rimJoint, bodyRestQuat, bodyRestPos, restAngle, jetPower: 0, servoAngle: 0, spin: 0, spinAngle: 0, contactPoint: null, load: 0, collider: null, contactForce: 0, slipping: false, jointAxisLocal, jointAnchorLocal };
      tb.collider = tyreColliders.get(tile.id) ?? null;
      this.tiles.push(tb);
      this.byId.set(tile.id, tb);
    }
  }

  /** does any collider of this body currently touch a ground-group collider? */
  private touchesGround(b: RAPIER.RigidBody): boolean {
    for (let i = 0; i < b.numColliders(); i++) {
      const c = b.collider(i);
      let hit = false;
      this.world.contactPairsWith(c, (other) => {
        if (hit) return;
        const ob = other.parent();
        if (ob && ob.isDynamic()) return; // another part of a model, not the ground
        const pair = this.world.contactPair(c, other, () => { hit = true; });
        void pair;
      });
      if (hit) return true;
    }
    return false;
  }

  /** current angle of an animated joint, measured from the two bodies' rotations (rad) */
  private jointAngle(tb: TileBody): number {
    const pb = this.byId.get(tb.tile.parent!.id)!.body;
    const pr = pb.rotation();
    const cr = tb.body.rotation();
    const qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const qc = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);
    const qrel = qp.clone().invert().multiply(qc);
    const ax = tb.jointAxisLocal!;
    let cur = 2 * Math.atan2(qrel.x * ax.x + qrel.y * ax.y + qrel.z * ax.z, qrel.w);
    if (cur > Math.PI) cur -= 2 * Math.PI;
    if (cur < -Math.PI) cur += 2 * Math.PI;
    return cur;
  }

  /** rigidly rotate a joint's whole subtree about its hinge so the joint reads its commanded angle */
  private servoTeleport(tb: TileBody): void {
    const delta = tb.servoAngle - this.jointAngle(tb);
    if (Math.abs(delta) < 1e-4) return;
    const pb = this.byId.get(tb.tile.parent!.id)!.body;
    const pr = pb.rotation();
    const pt = pb.translation();
    const qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const axisW = tb.jointAxisLocal!.clone().applyQuaternion(qp).normalize();
    const anchorW = tb.jointAnchorLocal!.clone().applyQuaternion(qp).add(new THREE.Vector3(pt.x, pt.y, pt.z));
    // bodies on the child side (the joint's subtree) and on the parent side (the rest of the model)
    const sub = new Map<number, RAPIER.RigidBody>();
    const visit = (t: TileInstance) => {
      const b = this.byId.get(t.id)?.body;
      if (b && b !== pb) sub.set(b.handle, b);
      for (const c of t.children) if (!c.detached) visit(c);
    };
    visit(tb.tile);
    const rest = new Map<number, RAPIER.RigidBody>();
    for (const t of this.tiles) if (!sub.has(t.body.handle)) rest.set(t.body.handle, t.body);
    // the hinge turns both sides, each by a share inverse to its moment of inertia about the hinge
    // (measured: snapping a loaded arm 45° pitched the light core 31° and the weights only 14°)
    // a body standing on the ground whose motion under this rotation would be tangential (a planted
    // foot swept by a hip) is held by friction: count it as very heavy so the other side moves instead;
    // a body the rotation would lift (the core of a snapping arm) is free
    const UP = new THREE.Vector3(0, 1, 0);
    const inertia = (bodies: Map<number, RAPIER.RigidBody>, sgn: number) => {
      let I = 0;
      for (const b of bodies.values()) {
        const bt = b.translation();
        const d = new THREE.Vector3(bt.x, bt.y, bt.z).sub(anchorW);
        const perp = d.clone().sub(axisW.clone().multiplyScalar(d.dot(axisW)));
        let m = b.mass() * (perp.lengthSq() + 0.03);
        if (this.touchesGround(b)) {
          const motion = axisW.clone().cross(d).multiplyScalar(sgn); // where this side would actually go
          const len = motion.length();
          if (len > 1e-6) {
            const vertical = motion.dot(UP) / len; // + would lift it off the ground, − push it in
            const tangential = motion.clone().sub(UP.clone().multiplyScalar(motion.dot(UP))).length() / len;
            const hold = vertical < -0.3 ? 1 : tangential * tangential;
            m += b.mass() * ((globalThis as unknown as { __tune?: { servoHold?: number } }).__tune?.servoHold ?? SERVO_HOLD) * hold;
          }
        }
        I += m;
      }
      return I;
    };
    const Is = inertia(sub, Math.sign(delta));
    const Ir = inertia(rest, -Math.sign(delta));
    const shareSub = Ir / (Is + Ir);
    const turn = (bodies: Map<number, RAPIER.RigidBody>, angle: number) => {
      if (Math.abs(angle) < 1e-6) return;
      const rot = new THREE.Quaternion().setFromAxisAngle(axisW, angle);
      for (const b of bodies.values()) {
        const bt = b.translation();
        const br = b.rotation();
        const p = new THREE.Vector3(bt.x, bt.y, bt.z).sub(anchorW).applyQuaternion(rot).add(anchorW);
        const q = rot.clone().multiply(new THREE.Quaternion(br.x, br.y, br.z, br.w));
        b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
        b.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
    };
    const split = (globalThis as unknown as { __tune?: { servoSplit?: boolean } }).__tune?.servoSplit ?? true;
    if (split) {
      turn(sub, delta * shareSub);
      turn(rest, -delta * (1 - shareSub));
    } else turn(sub, delta);
  }

  /**
   * Contact-force wheel (measured against the original): the tyre is not a spinning body. A ray
   * from the hub, down within the wheel plane, finds the ground; the push is power × 0.066 / r
   * (fading linearly with the kinematic spin v/r, zero at 180 rad/s), the brake damps the rolling
   * speed, sideways slip is damped like a tyre with a friction limit. Spin is v/r while rolling and
   * decays in the air.
   */
  private driveWheel(tb: TileBody, pose: Pose, normal: THREE.Vector3, env: ValEnv): void {
    const { tile } = tb;
    // a wheel on a folding rim applies its tyre forces to the chassis the rim hangs from: the rim body
    // is light and its hard-limited joint would otherwise chatter under the grip forces
    let body = tb.rim && tile.parent ? (this.byId.get(tile.parent.id)?.body ?? tb.body) : tb.body;
    if ((globalThis as unknown as { __tune?: { tyreToRoot?: boolean } }).__tune?.tyreToRoot) {
      let t = tile;
      while (t.parent && !t.detached) t = t.parent;
      body = this.byId.get(t.id)?.body ?? body;
    }
    const DEG = Math.PI / 180;
    let power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
    if (power !== 0) power *= this.useFuel(FUEL_PER_POWER_WHEEL * Math.abs(power) * this.dt * 30);
    const brake = attr(tile.node, 'brake', env, 0);
    if (tb.rimJoint) {
      const a = jointSign('wheel', tile.dir) * (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG; // rim fold
      tb.rimJoint.setLimits(a, a);
    }
    const r = wheelRadius(tile.option);
    // down, projected into the wheel plane
    const d = new THREE.Vector3(0, -1, 0).addScaledVector(normal, normal.y);
    let contact = false;
    if (d.lengthSq() > 0.09) {
      d.normalize();
      const o = pose.position;
      const ray = new this.R.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z });
      const hit = this.world.castRayAndGetNormal(ray, r + TYRE_CONTACT_MARGIN, true, undefined, 0x0001_0002, undefined, body);
      if (hit) {
        contact = true;
        const P = o.clone().addScaledVector(d, hit.timeOfImpact);
        const g = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        // rolling direction for +power and the lateral direction, both in the ground plane
        const f = new THREE.Vector3().crossVectors(g, normal);
        if (f.lengthSq() < 1e-6) return;
        f.normalize();
        const l = new THREE.Vector3().crossVectors(f, g).normalize();
        const c = body.translation();
        const lv = body.linvel();
        const av = body.angvel();
        const vP = new THREE.Vector3(lv.x, lv.y, lv.z).add(new THREE.Vector3(av.x, av.y, av.z).cross(P.clone().sub(new THREE.Vector3(c.x, c.y, c.z))));
        const vf = vP.dot(f);
        const vl = vP.dot(l);
        const k = (globalThis as unknown as { __tune?: { wheelTorque?: number } }).__tune?.wheelTorque ?? WHEEL_TORQUE_PER_POWER;
        const wheels = this.assembly ? this.assembly.tiles.filter((t) => t.spec.wheel).length : 1;
        tb.contactPoint = P;
        const load = (((globalThis as unknown as { __tune?: { tyreStaticLoad?: boolean } }).__tune?.tyreStaticLoad ?? TYRE_STATIC_LOAD) && tb.load > 0 ? tb.load : (this.totalMass * 9.8) / Math.max(1, wheels)) * TYRE_LOAD_SHARE;
        // motor torque: k·power·(1 − spin/ω0). Measured: at power 1000 and 2500 the push fades linearly to zero at
        // 180 rad/s; a sliding wheel at power 5000/10000 settles near 135/375 rad/s against ~1030 N of ground
        // force, which only fits if the fade's zero point grows with power above ~3700 (ω0 = power/20.6)
        const w0 = Math.max(WHEEL_SPIN_FADE, Math.abs(power) * WHEEL_SPIN_PER_POWER);
        let tau = power !== 0 ? power * k * (1 - (Math.sign(power) * tb.spin) / w0) : 0;
        if (brake > 0) {
          // measured: a 530 kg car with brake=10 on four wheels sheds 2.2 m/s² (0.22 g), brake=50 7.7 m/s²
          // (0.78 g) at any speed — Coulomb, ≈0.022 g per brake unit, saturating near 0.8 g
          const frac = Math.min(BRAKE_G_PER_UNIT * brake, BRAKE_G_MAX);
          const ramp = Math.min(1, Math.abs(vf) / 0.5); // no chatter at rest
          tau -= Math.sign(vf) * frac * load * ramp * r;
        }
        const mu = (globalThis as unknown as { __tune?: { wheelFriction?: number } }).__tune?.wheelFriction ?? WHEEL_FRICTION;
        const limit = mu * load;
        const wheelSpin = (globalThis as unknown as { __tune?: { wheelSpin?: boolean } }).__tune?.wheelSpin ?? WHEEL_SPIN_DYNAMICS;
        let Ff = tau / r;
        if (!wheelSpin) {
          tb.spin = vf / r;
          Ff = Math.max(-limit, Math.min(limit, Ff));
        } else {
          // rolling: the ground force is the motor's, the spin follows the road. Sliding (the motor asks for more
          // than the grip): kinetic friction at the grip limit against the slip, and the wheel spins up with its
          // own inertia ½mr² until motor torque, ground reaction and a spin drag balance (measured 135/375 rad/s)
          const slip = tb.spin * r - vf;
          // a wheel that lands spinning (or stops spinning) far from the road speed slides first
          if (!tb.slipping && Math.abs(Ff) <= limit && Math.abs(slip) < 0.5) {
            tb.spin = vf / r;
          } else {
            if (!tb.slipping) tb.slipping = true;
            const dir = Math.abs(slip) > 0.1 ? Math.sign(slip) : Math.sign(Ff);
            Ff = dir * limit;
            const I = WHEEL_INERTIA_SCALE * 0.5 * tile.mass * r * r;
            const spinNext = tb.spin + (this.dt * (tau - Ff * r - WHEEL_SPIN_DRAG * tb.spin)) / I;
            const slipNext = spinNext * r - vf;
            if ((Math.abs(slip) > 0.1 && slip * slipNext < 0) || (Math.abs(slipNext) < 0.05 && Math.abs(tau / r) <= limit)) {
              // the slip closed: back to rolling
              tb.slipping = false;
              tb.spin = vf / r;
              Ff = Math.max(-limit, Math.min(limit, tau / r));
            } else tb.spin = spinNext;
          }
        }
        // the motor (and brake) torque acts between wheel and chassis: its reaction pitches the body (measured:
        // a car at power 10000 pitches 0.7 rad nose-up while still falling after spawn; RLW has no reaction)
        if (!tile.spec.noReaction && WHEEL_REACTION) {
          const T = normal.clone().multiplyScalar(tau);
          body.addTorque({ x: T.x, y: T.y, z: T.z }, true);
        }
        const lateralGain = (globalThis as unknown as { __tune?: { tyreLateral?: number } }).__tune?.tyreLateral ?? TYRE_LATERAL_GAIN;
        let Fl = (-lateralGain * vl * (load / 9.8)) / this.dt;
        // friction circle, drive first (measured on the original, steered car at steer 10/20 deg: the lateral
        // acceleration tops out near 1.1 g with little drive, 0.9-1.0 g with rear drive at 0.7 of the cap, and
        // the rear axle slides freely once its drive saturates - the car then drifts along the front wheels)
        const circle = (globalThis as unknown as { __tune?: { frictionCircle?: boolean } }).__tune?.frictionCircle ?? TYRE_FRICTION_CIRCLE;
        const muL = (globalThis as unknown as { __tune?: { tyreLateralMu?: number } }).__tune?.tyreLateralMu ?? TYRE_LATERAL_MU;
        const lateralFirst = (globalThis as unknown as { __tune?: { tyreLateralFirst?: boolean } }).__tune?.tyreLateralFirst ?? TYRE_LATERAL_FIRST;
        if (circle && lateralFirst) {
          // lateral grip first, the drive gets what is left of the ellipse
          Fl = Math.max(-muL * load, Math.min(muL * load, Fl));
          const driveLimit = limit * Math.sqrt(Math.max(0, 1 - (Fl / (muL * load)) * (Fl / (muL * load))));
          Ff = Math.max(-driveLimit, Math.min(driveLimit, Ff));
        } else {
          const lateralLimit = muL * load * (circle ? Math.sqrt(Math.max(0, 1 - (Ff / limit) * (Ff / limit))) : 1);
          Fl = Math.max(-lateralLimit, Math.min(lateralLimit, Fl));
        }
        const F = f.clone().multiplyScalar(Ff).addScaledVector(l, Fl);
        if ((globalThis as unknown as { __tune?: { debugWheels?: boolean } }).__tune?.debugWheels) console.log('wheel', tile.chipIndex, 'toi', hit.timeOfImpact.toFixed(3), 'n', normal.toArray().map((x) => x.toFixed(2)).join(','), 'f', f.toArray().map((x) => x.toFixed(2)).join(','), 'vf', vf.toFixed(3), 'power', power, 'Ff', Ff.toFixed(1), 'Fl', Fl.toFixed(1), 'spin', tb.spin.toFixed(2), 'bodyv', [body.linvel().x, body.linvel().y, body.linvel().z].map((x) => x.toFixed(2)).join(','), 'mass', body.mass().toFixed(0), 'load', load.toFixed(0), 'brake', brake, 'P', P.toArray().map((x) => x.toFixed(2)).join(','));
        // applied at the contact patch: the ground force below the hub is what pitches a segway's body back
        // when its wheels drive forward (self-balancers need it); the chassis rocking seen earlier came
        // from the cylinder tyre, not from this moment
        const at = (globalThis as unknown as { __tune?: { tyreAtHub?: boolean } }).__tune?.tyreAtHub ? o : P;
        body.addForceAtPoint({ x: F.x, y: F.y, z: F.z }, { x: at.x, y: at.y, z: at.z }, true);
      }
    }
    if (!contact) {
      tb.contactPoint = null;
      tb.slipping = false;
      // in the air a powered wheel spins up against the motor's fade (measured: 34→207 rad/s over the first
      // 12 frames of the spawn drop at power 10000; a flipped car's wheels pass 1200 rad/s at 20000)
      const airSpin = (globalThis as unknown as { __tune?: { wheelSpin?: boolean } }).__tune?.wheelSpin ?? WHEEL_SPIN_DYNAMICS;
      if (airSpin && power !== 0) {
        const w0 = Math.max(WHEEL_SPIN_FADE, Math.abs(power) * WHEEL_SPIN_PER_POWER);
        const k = (globalThis as unknown as { __tune?: { wheelTorque?: number } }).__tune?.wheelTorque ?? WHEEL_TORQUE_PER_POWER;
        const tau = power * k * (1 - (Math.sign(power) * tb.spin) / w0);
        tb.spin += (this.dt * tau) / (WHEEL_INERTIA_SCALE * 0.5 * tile.mass * r * r);
        if (!tile.spec.noReaction && WHEEL_REACTION) {
          const T = normal.clone().multiplyScalar(tau);
          body.addTorque({ x: T.x, y: T.y, z: T.z }, true);
        }
      } else tb.spin *= 0.9; if ((globalThis as unknown as { __tune?: { debugWheels?: boolean } }).__tune?.debugWheels) console.log('wheel', tile.chipIndex, 'no contact; d', d.toArray().map((x) => x.toFixed(2)).join(','), 'y', pose.position.y.toFixed(3)); }
    tb.spinAngle += tb.spin * this.dt;
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

  /** Static load of each touching wheel: minimum-norm solution of weight and moment balance about the
   *  centre of mass over the contact points of the last step (lever rule for two axles, equal shares for a
   *  symmetric four), negatives clamped and the rest rescaled to the full weight. Wheels in the air get 0. */
  distributeLoads(): void {
    const wheels = this.tiles.filter((t) => t.tile.spec.wheel && t.contactPoint);
    for (const t of this.tiles) if (t.tile.spec.wheel) t.load = 0;
    if (wheels.length === 0) return;
    const W = this.totalMass * 9.8;
    if (wheels.length === 1) { wheels[0].load = W; return; }
    let cx = 0, cz = 0, m = 0;
    for (const tb of this.tiles) {
      const p = this.pose(tb).position;
      cx += p.x * tb.tile.mass; cz += p.z * tb.tile.mass; m += tb.tile.mass;
    }
    cx /= m; cz /= m;
    // rows: sum N = W, sum N·(x−cx) = 0, sum N·(z−cz) = 0; min-norm N = Aᵀ(AAᵀ+εI)⁻¹ b
    // lever arms from the current hub positions (the contact points are one step old, which at speed
    // shifts them all backwards relative to the centre of mass and loads the rear axle too much)
    const hubs = wheels.map((w) => this.pose(w).position);
    const xs = hubs.map((h) => h.x - cx);
    const zs = hubs.map((h) => h.z - cz);
    const n = wheels.length;
    const eps = 1e-4 * n;
    const M = [
      [n + eps, xs.reduce((a, b) => a + b, 0), zs.reduce((a, b) => a + b, 0)],
      [xs.reduce((a, b) => a + b, 0), xs.reduce((a, b) => a + b * b, 0) + eps, xs.reduce((a, b, i) => a + b * zs[i], 0)],
      [zs.reduce((a, b) => a + b, 0), xs.reduce((a, b, i) => a + b * zs[i], 0), zs.reduce((a, b) => a + b * b, 0) + eps],
    ];
    const b = [W, 0, 0];
    // solve M y = b (3×3, Gaussian elimination)
    for (let i = 0; i < 3; i++) {
      let piv = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      [M[i], M[piv]] = [M[piv], M[i]]; [b[i], b[piv]] = [b[piv], b[i]];
      for (let r = i + 1; r < 3; r++) {
        const f = M[r][i] / M[i][i];
        for (let c = i; c < 3; c++) M[r][c] -= f * M[i][c];
        b[r] -= f * b[i];
      }
    }
    const y = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { let acc = b[i]; for (let c = i + 1; c < 3; c++) acc -= M[i][c] * y[c]; y[i] = acc / M[i][i]; }
    let sum = 0;
    wheels.forEach((w, i) => { w.load = Math.max(0, y[0] + y[1] * xs[i] + y[2] * zs[i]); sum += w.load; });
    if (sum > 0) for (const w of wheels) w.load *= W / sum;
    const dynamic = (globalThis as unknown as { __tune?: { tyreDynamicLoad?: boolean } }).__tune?.tyreDynamicLoad ?? TYRE_DYNAMIC_LOAD;
    // the landing impact spikes the contact force for a frame; the grip must not eat a spinning wheel's
    // momentum in one step (measured: the original's wheels keep spinning for ~15 frames after touchdown)
    if (dynamic) for (const w of wheels) if (w.contactForce > 0) w.load = Math.min(w.contactForce, TYRE_LOAD_CAP * w.load);
  }

  /** normal force each tyre carried in the step just taken (sum of contact impulses / dt), smoothed */
  measureTyreLoads(): void {
    for (const tb of this.tiles) {
      if (!tb.tile.spec.wheel || !tb.collider) continue;
      let impulse = 0;
      this.world.contactPairsWith(tb.collider, (other) => {
        this.world.contactPair(tb.collider!, other, (m) => {
          for (let i = 0; i < m.numContacts(); i++) impulse += Math.abs(m.contactImpulse(i));
        });
      });
      const f = impulse / this.dt;
      tb.contactForce = f > 0 ? (tb.contactForce > 0 ? tb.contactForce + TYRE_LOAD_SMOOTH * (f - tb.contactForce) : f) : 0;
    }
  }

  /** Drive joints toward attribute values, apply wheel torque, jets and air drag. */
  applyControls(env: ValEnv): void {
    const DEG = Math.PI / 180;
    this.distributeLoads();
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

      if (tile.spec.wheel && tile.parent) {
        this.driveWheel(tb, pose, normal, env);
      } else if (joint && tile.parent) {
        if (tb.animated) {
          // servo: the commanded angle is reached at a bounded rate (window.__tune.servoRate
          // deg per physics step) instead of instantly — instant jumps of a leg joint pump
          // energy through the hard limits and launch walkers
          const rate = ((globalThis as unknown as { __tune?: { servoRate?: number } }).__tune?.servoRate ?? SERVO_RATE) * DEG;
          const target = jointSign(tile.spec.joint, tile.dir) * (attr(tile.node, 'angle', env, 0) - tb.restAngle) * DEG;
          const d = target - tb.servoAngle;
          tb.servoAngle += Math.max(-rate, Math.min(rate, d));
          if ((globalThis as unknown as { __tune?: { debugServo?: boolean } }).__tune?.debugServo) console.log('servo', tile.type, tile.chipIndex, 'rate', (rate / DEG).toFixed(1), 'target', (target / DEG).toFixed(1), 'servo', (tb.servoAngle / DEG).toFixed(1));
          const soft = (globalThis as unknown as { __tune?: { softServo?: number } }).__tune?.softServo ?? SOFT_SERVO;
          const accel = (globalThis as unknown as { __tune?: { servoAccel?: number; servoAccelDamp?: number; servoMaxForce?: number } }).__tune;
          const vel = (globalThis as unknown as { __tune?: { servoVel?: number } }).__tune?.servoVel;
          const teleport = (globalThis as unknown as { __tune?: { servoTeleport?: boolean } }).__tune?.servoTeleport ?? SERVO_TELEPORT;
          if (teleport && tb.jointAxisLocal && tb.jointAnchorLocal && tile.parent) {
            // the original sets a commanded angle instantly, without giving the moved chips any momentum
            // (a Rudder reaches 60° in one frame, a loaded hinge snaps and the load then swings from rest):
            // rotate the whole subtree rigidly about the hinge by the remaining angle, keep velocities,
            // and let the solver sort out contacts; limits hold the angle afterwards
            this.servoTeleport(tb);
            joint.setLimits(tb.servoAngle, tb.servoAngle);
          } else if (vel && tb.jointAxisLocal && tile.parent) {
            // velocity motor: ask the solver for the angular velocity that closes the remaining angle in
            // `vel` steps (1 = this step), with a huge force budget; limits hold the target afterwards
            const pb = this.byId.get(tile.parent.id)!.body;
            const pr = pb.rotation();
            const cr = body.rotation();
            const qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
            const qc = new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w);
            const qrel = qp.clone().invert().multiply(qc);
            const ax = tb.jointAxisLocal;
            let cur = 2 * Math.atan2(qrel.x * ax.x + qrel.y * ax.y + qrel.z * ax.z, qrel.w);
            if (cur > Math.PI) cur -= 2 * Math.PI;
            if (cur < -Math.PI) cur += 2 * Math.PI;
            const want = (tb.servoAngle - cur) / (this.dt * vel);
            const tv = (globalThis as unknown as { __tune?: { servoForceBased?: number } }).__tune?.servoForceBased;
            joint.configureMotorModel(tv ? this.R.MotorModel.ForceBased : this.R.MotorModel.AccelerationBased);
            joint.setMotorMaxForce(1e12);
            joint.configureMotorVelocity(want, tv ?? 1.0);
            if (!(globalThis as unknown as { __tune?: { servoNoLimits?: boolean } }).__tune?.servoNoLimits) joint.setLimits(tb.servoAngle - SERVO_BAND, tb.servoAngle + SERVO_BAND);
            else joint.setLimits(-1e9, 1e9);
            if ((globalThis as unknown as { __tune?: { debugServo?: boolean } }).__tune?.debugServo) console.log('servoVel', tile.chipIndex, 'cur', (cur / DEG).toFixed(1), 'want', want.toFixed(2));
          } else if (accel?.servoAccel) {
            // acceleration-based position motor: mass-independent, converges within a step or two
            // (the original sets a commanded angle instantly: a Rudder reaches 60° in one frame)
            joint.configureMotorModel(this.R.MotorModel.AccelerationBased);
            joint.setMotorMaxForce(accel.servoMaxForce ?? 1e12);
            joint.configureMotorPosition(tb.servoAngle, accel.servoAccel, accel.servoAccelDamp ?? accel.servoAccel / 10);
            joint.setLimits(tb.servoAngle - SERVO_BAND, tb.servoAngle + SERVO_BAND);
          } else if (soft > 0) {
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
        let power = tile.powerless ? 0 : attr(tile.node, 'power', env, 0);
        if (power !== 0) power *= this.useFuel(FUEL_PER_POWER_JET * Math.abs(power) * this.dt * 30);
        tb.jetPower = power;
        if (power !== 0) {
          // option 1/2 = balloon (wikiwiki: 1 hydrogen, 2 air): buoyancy straight up, whatever the tilt;
          // the airship model mounts them at angle -90/0/90 and lifts with 10,000-50,000
          const balloon = tile.option === 1 || tile.option === 2;
          const f = balloon
            ? new THREE.Vector3(0, power * JET_NEWTON_PER_POWER, 0)
            : normal.clone().multiplyScalar(power * JET_NEWTON_PER_POWER);
          body.addForceAtPoint({ x: f.x, y: f.y, z: f.z }, { x: pose.position.x, y: pose.position.y, z: pose.position.z }, true);
          if ((globalThis as unknown as { __tune?: { debugJets?: boolean } }).__tune?.debugJets) console.log('jet', tile.chipIndex, 'power', power.toFixed(0), 'normal', normal.toArray().map((x) => x.toFixed(2)).join(','), 'F', f.toArray().map((x) => x.toFixed(0)).join(','), 'y', pose.position.y.toFixed(2));
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
        else if (aero === 'slope') mag = Math.min(LIFT_SLOPE * speed * Math.abs(vn), AIR_DRAG * speed * speed);
        else {
          // measured 2026-10-28 on the original (ballasted sled, 2-chip plate, 3333 N): the plate's normal
          // force grows like v²·sin^1.3(α) — ≈1.2 N/(m/s)² per chip at 30°, 3.9 at 60°, small at 15°, and
          // flat plates feel nothing up to 40 m/s; a 3-plate sled lifts off at 40 m/s with 9° of pitch
          const sinA = speed > 1e-6 ? Math.abs(vn) / speed : 0;
          mag = speed * speed * (AERO_K * Math.pow(sinA, AERO_P) + AERO_K2 * Math.pow(sinA, AERO_P2));
        }
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
    this.measureTyreLoads();
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
