//! `PhysicsWorld` (port of `src/physics/world.ts`): bodies per rigid group, joints, colliders, the ground and course,
//! balls, crates, fuel and regulations, `applyControls` and `step`. Servos are in `servo.rs`, wheels, tyre loads and
//! kerbs in `wheel.rs`, Arms and shells in `arm.rs`.
//!
//! Tiles whose angle never changes are welded into their parent's rigid body (one body = one rigid group). Only wheels
//! and tiles whose angle is an expression (steering, control surfaces) get a joint. That is what makes the chips rigid.
//!
//! Rust ownership: the world owns the [`Assembly`] it was built from (the TypeScript mutates the shared instance:
//! poses on detach, `detached`, `powerless`, `durability`); read it back with [`World::assembly`]. The Val environment
//! is passed to every call that evaluates attributes (`build`, `apply_controls`, `step` — a shell hit can detach and
//! rebuild — and `detach`) instead of being stored. `tiles[i]` belongs to `assembly.tiles[i]` (the TypeScript `byId`
//! is the identity).

use super::math::*;
use crate::model::{Assembly, JointKind, Quat, TileInstance, Vec3, COURSE, CRATES, TILE, TILE_T};
use crate::rc::{eval_expr, expr_is_constant, Env};
use rapier3d::prelude::{
    ActiveHooks, CoefficientCombineRule, ColliderBuilder, ColliderHandle, FixedJointBuilder, Group, ImpulseJointHandle,
    InteractionGroups, InteractionTestMode, MotorModel, PairFilterContext, PhysicsHooks, QueryFilter, Ray,
    RevoluteJointBuilder, RigidBodyBuilder, RigidBodyHandle, RigidBodyType, SolverFlags,
};
use std::collections::{HashMap, HashSet};

pub use rapier3d::prelude::PhysicsWorld as RapierWorld;

const DEG: f64 = std::f64::consts::PI / 180.0;

/// power → torque scale for wheels: spec only says "TRQ≈1000" drives a car.
pub const WHEEL_TORQUE_PER_POWER: f64 = 0.13; // N·m per power unit (measured: Basic car with all four wheels at power 2500 accelerates at 8.5 m/s²; attributes bound to a Val ignore _SET, so the first runs only drove the two front wheels)
/// motor torque falls linearly with the wheel's spin: T = k·power·(1 − ω/WHEEL_SPIN_FADE)
/// (measured on the original 1.5B26: Basic car at power 2500, a/a0 = 0.877 at ω≈22 rad/s, 0.62 at ω≈69;
/// no hard speed cap and no measurable air/rolling drag while coasting at 22 m/s)
pub const WHEEL_SPIN_FADE: f64 = 180.0; // rad/s at which the torque would reach zero
/// rapier solver: one substep with 16 internal PGS iterations. Sixteen substeps (the old setting) fed energy
/// into impacts — the Basic car rebounded off a wall at −7.6 m/s (the original stops dead) and standing corpus
/// models toppled on landing — and the rebound grew with the substep count. Joint chains still need the 16
/// iterations: 8 let the 3-wheeler's chain sag 0.4 m under its own weight.
pub const SOLVER_ITERATIONS: usize = 1;
pub const PGS_ITERATIONS: usize = 48;
/// brake: deceleration in g per brake unit and its cap (measured on the original, 4-wheel car)
pub const BRAKE_G_PER_UNIT: f64 = 0.022;
pub const BRAKE_G_MAX: f64 = 0.8;
/// lateral grip: fraction of the sideways contact velocity removed per step (1 = dead stop)
pub const TYRE_LATERAL_GAIN: f64 = 0.25;
/// drive and lateral tyre force share one friction circle of radius mu*load (measured, see driveWheel)
pub const TYRE_FRICTION_CIRCLE: bool = true;
/// lateral grip per wheel as a fraction of its load. Measured on the original (steered Basic-layout car,
/// 10 and 20 deg, 468 kg and 871 kg): the lateral acceleration tops out at 1.05-1.13 g with little drive
/// (docs/measured.md); 1.2 of the dynamic load reproduces 1.08 / 0.85 / 0.97 g in the three reference turns
pub const TYRE_LATERAL_MU: f64 = 1.2;
/// which force wins inside the ellipse when both saturate (see driveWheel)
pub const TYRE_LATERAL_FIRST: bool = false;
/// fraction of the lateral grip a wheel keeps when its drive saturates the circle (0 = pure circle)
pub const TYRE_LATERAL_FLOOR: f64 = 0.0;
/// wheels slide and spin up when the motor exceeds the grip (measured: powered wheels at 135-155 rad/s at power
/// 5000 while rolling would be 25-100, 315-390 at 10000); false: kinematic spin v/r with a capped force
pub const WHEEL_SPIN_DYNAMICS: bool = true;
/// fade zero point per unit of power above 2500 (rad/s per power): the sliding-wheel equilibria 135 rad/s at
/// 5000 and 376 at 10000 both fit ω0 = power / 20.6 with no extra spin drag
pub const WHEEL_SPIN_PER_POWER: f64 = 1.0 / 20.6;
/// 2026-11-01: a rolling wheel's fade zero point also grows with power (car1 drives each wheel at 10000–20000 and
/// keeps accelerating past 180 rad/s); the 180 rad/s regime was measured at power 1000 and 2500 only
pub const ROLL_FADE_SCALES: bool = true;
/// wheel inertia as a fraction of ½mr² with m the hub+tyre mass: the air spin-up at power 10000 (34→207 rad/s in
/// 12 frames) and the sliding spin-up on the ground both fit ≈ 0.7
pub const WHEEL_INERTIA_SCALE: f64 = 0.5;
/// the motor torque reacts on the chassis (Wheel); RLW is the reactionless one
pub const WHEEL_REACTION: bool = true;
/// the reaction while the tyre touches the ground, as a fraction of the motor torque. In the original a car
/// flooring it barely pitches (corpus car2: 0.01 rad); at full strength SnapTiles' car2 reared up and flipped,
/// segway ran away and the Basic car wheelied over ramp crests. Turning it off fixes those but costs the
/// steady-turn references (they lean on its rear load transfer: speed error 10.7 → 14.5%); a quarter keeps
/// the fixes at 12.4% (2026-10-31, docs/measured.md tier 3). The airborne reaction (spawn-drop pitch) is full.
pub const WHEEL_REACTION_GROUND: bool = true;
pub const WHEEL_REACTION_GROUND_SCALE: f64 = 0.25;
/// spin drag on a sliding wheel (N·m·s); 0 once the fade zero point scales with power
pub const WHEEL_SPIN_DRAG: f64 = 0.0;
/// the tyre still grips this far above the ground (the unsprung front lifts a few cm under power)
pub const TYRE_CONTACT_MARGIN: f64 = 0.1;
/// a kerb edge (a ground edge or corner the tyre touches, rather than a face) is a spring-damper, not a rigid contact:
/// the rigid frictionless sphere either kicked the car into a wheelie or stopped it dead, while the original
/// rolls up 0.10–0.25 m kerbs losing 17–79% of 6.9 m/s (measured 2026-10-31, docs/measured.md kerb section)
pub const TYRE_SOFT_KERB: bool = true;
/// soft kerb stiffness: the wheel's static load sags it this far; damping as a ratio of critical
pub const KERB_SAG: f64 = 0.02;
pub const KERB_DAMPING: f64 = 0.3;
/// load the tyre forces may transmit: μ × (model weight / number of wheels)
pub const TYRE_LOAD_SHARE: f64 = 1.0;
/// per-wheel load from the static lever rule about the centre of mass (false: total mass / wheel count);
/// only the fallback before the tyre has measured a contact force (TYRE_DYNAMIC_LOAD)
pub const TYRE_STATIC_LOAD: bool = true;
/// spawn the model falling from the original's height (false: place it 2 cm above the ground)
pub const SPAWN_DROP: bool = true;
/// use the normal force the tyre collider actually carried (contact impulses of the last step, smoothed) instead
/// of the static lever rule: load transfer under acceleration, braking and cornering. Measured: the corpus bike
/// reaches 14.4 m/s in 3 s at power 5000 on a rear wheel whose static share could not carry that drive, while the
/// steered car's powered (leading) axle saturates at 1030 N per wheel on ~990 N of contact load
pub const TYRE_DYNAMIC_LOAD: bool = true;
pub const TYRE_LOAD_SMOOTH: f64 = 0.3;
/// dynamic load used for grip is capped at this multiple of the wheel's static share (the touchdown spike must still
/// shove the car with the wheels' stored momentum, measured ~1000 N·s, but not explode)
pub const TYRE_LOAD_CAP: f64 = 30.0;
/// sustained grip load cap as a multiple of the static share. 2026-11-01: 3 — the corpus car1 runs its Trim wings
/// at 45→26° (measured in the original while driving) and Trim plates feel the same aero as Chips (rollt_*), so
/// its constant 12.5 m/s² to 65 m/s needs the wings' downforce as grip (1.5 stalled it at 32 m/s)
pub const TYRE_LOAD_CAP_SUSTAINED: f64 = 3.0;
/// steps after a touchdown during which the full impact load (TYRE_LOAD_CAP) may be used for grip
pub const TYRE_TOUCHDOWN_STEPS: u32 = 40;
/// spec: 6 power = 1 N
pub const JET_NEWTON_PER_POWER: f64 = 1.0 / 6.0; // measured 2026-11-01 (rc_models37.sh): two flat Jets lifting a 98.7 kg core leave the ground at power 3000 each but not 2800 (1/6 N per power: 2904), and climb slowly at 0.163 N/power before the plates' drag grows; the 2026-10-28 0.145 came from a jet-pushed wheeled car whose mass was underestimated. tp-2 hovers on 6 power per newton
/// plate aero (per 1 m² tile): broadside drag N per (m/s)², and the lift slope N per (m/s)² per sin α.
/// ½ρ·Cd≈0.7 and ½ρ·2π≈3.8 for air; the original's numbers are unknown. (Only the 'pow' law is ported.)
pub const AIR_DRAG: f64 = 0.7;
/// isotropic drag per tile: N per (m/s)² per unit coefficient (a guess; 20 chips ≈ 1.8 kN at 30 m/s)
pub const ISO_DRAG: f64 = 0.0; // 0 = off: it kept tonbo and the plane sample from taking off; kept as an experiment knob
pub const LIFT_SLOPE: f64 = 3.8;
/// plate normal force per chip = v² · (AERO_K·sin^AERO_P α + AERO_K2·sin^AERO_P2 α), α = angle to the airflow.
/// Measured on the original with a jet-pushed rolling car (drag per chip / v²: 0.22 at 15°, 1.2 at 30°,
/// 2.85 at 45°, ≈4 at 50°; at 60–90° the car stalls near 1–3 m/s). The second term is the steep rise
/// toward broadside that the original's readme mentions.
pub const AERO_K: f64 = 6.7;
pub const AERO_P: f64 = 1.5;
pub const AERO_K2: f64 = 9.3;
pub const AERO_P2: f64 = 8.0;
/// tyre friction coefficient (rapier combines with the ground's 1.0 by averaging)
pub const WHEEL_FRICTION: f64 = 1.1; // measured against the dynamic (contact) load: the Basic layout drives S-first, so its powered axle leads and unloads to ~990 N under acceleration where it saturates at 1030 N; corpus bike unsaturated at power 5000
/// max servo slew of an animated joint, degrees per physics step (60 Hz) — 6°/step = 360°/s
/// measured 2026-10-27: the original applies a commanded joint angle within one frame (a Rudder reads
/// 60° one frame after the Val changes), so the servo is instant by default (deg per physics step)
pub const SERVO_RATE: f64 = 180.0;
/// Apply commanded poses kinematically, then balance the component mass pose.
/// Fixed frames retain the result; contact impulses remain the solver’s responsibility.
pub const SERVO_TELEPORT: bool = true;
/// measured 2026-11-01 (arm_<spring>_<damper>: an unloaded arm standing on a heavy base, commanded 30°): an animated
/// joint with spring < 1 follows its command like a damped spring, ω = 15.5·spring^1.5 rad per 30 fps frame
/// (spring 0.05 takes ~16 frames, 0.1 ~6, 0.2 ~2, 0.5 and 1 one frame), damping ratio 0.6 for damper ≥ 0.5 and
/// about 0.25 at damper 0–0.1. A heavier arm is ~20% slower; the law here ignores that.
pub const SPRING_SERVO_W: f64 = 15.5;
pub const SPRING_SERVO_P: f64 = 1.5;
/// joints with spring < 1 are torsion springs (knob springJoints). Measured 2026-11-01 (sag_v/sag_c: an arm at 45°
/// with a Weight at its tip, 1913 N·m): static sag 0.8/1.4/3.7/14.7° at spring 0.5/0.2/0.1/0.05 and collapse at
/// 0.02 → stiffness ≈ SPRING_K·spring^SPRING_K_P N·m/rad. Damping ratio from damper as in SPRING_SERVO_*.
pub const SPRING_JOINTS: bool = true;
/// measured 2026-11-01 (rc_models34.sh: a horizontal wheel on a weighted base carrying two Trims or two Weights,
/// power 5000/20000/60000): a wheel with chips on it spins them up in the air and settles at 26/44/64 rad/s
/// (two Weights at 20000: 20.5). Fit: I·dω/dt = ROTOR_TORQUE·power − ROTOR_DRAG·m^ROTOR_DRAG_M·ω^ROTOR_DRAG_N,
/// I = Σ m·d² of the carried chips, m their mass (steady speeds within 2%). RLW and Wheel spin alike.
pub const ROTOR: bool = true;
/// a wheel spins about its plate normal (the renderer's SPIN_AXIS)
pub const ROTOR_AXIS: Vec3 = Vec3::new(0.0, 1.0, 0.0);
pub const ROTOR_TORQUE: f64 = 0.111;
pub const ROTOR_DRAG: f64 = 1.6e-4;
pub const ROTOR_DRAG_M: f64 = 1.56;
pub const ROTOR_DRAG_N: f64 = 2.74;
pub const SPRING_K: f64 = 3.7e6;
pub const SPRING_K_P: f64 = 2.0;
/// A spring joint gives more when what it carries beyond it is light (measured 2026-11-02, `rc_models44.sh`: a bridge
/// whose two spring joints carry the same torque — the one with the body beyond it sags like SPRING_K, the one with only
/// a leg and foot beyond it 2.4–2.8× more; `rc_models43.sh` legs likewise). Stiffness × clamp((I/REF)^P, FLOOR, 1) with
/// I the subtree's inertia about the joint axis: REF 300 kg·m² (the cantilevered arm SPRING_K was fitted on is above
/// it), P 0.31, FLOOR 0.32 (legs of 9 and 19 kg·m² both need ≈ 0.32, a two-Frame leg of 33 kg·m² ≈ 0.5)
pub const SPRING_K_INERTIA_REF: f64 = 300.0;
pub const SPRING_K_INERTIA_P: f64 = 0.31;
pub const SPRING_K_INERTIA_FLOOR: f64 = 0.32;
/// A spring joint whose subtree stands on the ground while the rest of the model does not (a stance leg while the
/// other foot is up) swings the rest of the model, not its subtree: it is damped over that inertia too, at this ratio
/// whatever its damper (measured 2026-11-02, `rc_models42.sh`: the original's legs take a landing without rebound and
/// damper 0, 0.5 and 1 settle alike). Fitted on the corpus: Talon under Up walks like the original (1.60 → 0.11), no
/// other run changes by more than 0.15; the commanded step response (arm in the air) is untouched.
pub const SPRING_ZETA_LOAD: f64 = 0.3;
/// damping ratio of a spring joint at damper 0 and at damper ≥ 0.5 (0.5 and 1 run identically in the original)
pub const SPRING_ZETA: [f64; 2] = [0.1, 0.4]; // lower than the fit: rapier's implicit motor adds damping

/// Static terrain whose collider friction also scales the custom tyre force.
pub(crate) const SURFACE_GRIP_TAG: u128 = 0x5354_4752;

/// Tiles of a model never collide with each other (only with the ground / objects). rapier3d-compat packs a group
/// pair as `memberships << 16 | filter`; these are the same pairs.
pub const MODEL_GROUP: u32 = 0x0001_0002; // membership 1, filter 2
pub const GROUND_GROUP: u32 = 0x0002_0007; // membership 2, collides with models, other ground-like things and shells
pub const SHELL_GROUP: u32 = 0x0004_0002; // membership 4, collides with ground only

/// `setCollisionGroups(u32)` of rapier3d-compat
pub fn groups(packed: u32) -> InteractionGroups {
    InteractionGroups::new(Group::from_bits_retain(packed >> 16), Group::from_bits_retain(packed & 0xffff), InteractionTestMode::And)
}

/// Arm: charge per step (spec says 2500 per 30 fps frame); muzzle speed 300 m/s from the original's readme
/// (15B13: "150 → 300 m/s"); the shell mass is a guess. Shells hit every chip as a sphere of radius
/// ARM_HIT_RADIUS around its centre (readme 15B11: all chips are spheres r = 0.3 for shell hits, own chips
/// included) and take ARM_DAMAGE_PER_ENERGY × energy / chip mass off its durability (`_T`, 0..10000)
pub const ARM_CHARGE_PER_STEP: f64 = 5000.0 / 2.0; // measured: shots every 11 / 21 frames at option 50000 / 100000
pub const ARM_MUZZLE_SPEED: f64 = 300.0;
pub const ARM_HIT_RADIUS: f64 = 0.3;
/// durability taken per hit = this × energy / chip mass: measured 5000 off a 25.2 kg Chip at option 50000
pub const ARM_DAMAGE_PER_ENERGY: f64 = 2.52;
/// recoil impulse per unit of shot energy (N·s): measured +0.42 m/s per shot on a 518 kg car at option 50000
pub const ARM_RECOIL_PER_ENERGY: f64 = 0.0043; // and +1.7 m/s per shot at 200000: linear in energy
pub const ARM_DESTROY_DETACH: bool = true;

/// Fuel (readme 15B24/B25, measured 2026-10-28 with regulation E off): capacities per chip Core 2,000,000,
/// Chip-type 1,000,000, Frame-type 500,000, Weight 6,000,000 × option, others 0. A wheel burns 0.025 × |power|
/// per 30 fps frame whatever its speed or load (two wheels at 2500: 125/frame), an Arm burns its charge
/// (5000/frame while charging), a Jet FUEL_PER_POWER_JET × |power|. Regulation E on (the default) is the
/// "high-efficiency fuel": nothing is consumed. Fuel is drawn from the whole model, Weights first.
pub fn fuel_capacity(type_: &str) -> f64 {
    match type_ {
        "core" => 2_000_000.0,
        "chip" | "rudder" | "trim" => 1_000_000.0,
        "frame" | "rudderf" | "trimf" => 500_000.0,
        "weight" => 6_000_000.0,
        _ => 0.0,
    }
}
pub const FUEL_PER_POWER_WHEEL: f64 = 0.025;
pub const FUEL_PER_POWER_JET: f64 = 0.1; // measured: a jet at 10000 burns 1000 per frame (the readme's efficiency 10); wheels burn power/40, not /30
pub const FUEL_PER_ARM_CHARGE: f64 = 1.0;
pub const REGULATION_DEFAULTS: [(&str, f64); 8] = [("G", 1.0), ("A", 1.0), ("T", 1.0), ("J", 0.0), ("U", 0.0), ("C", 1.0), ("S", 1.0), ("E", 1.0)];
pub const ARM_SHELL_MASS: f64 = 2.0;
pub const ARM_SHELL_LIFE: u64 = 4 * 60;
pub const ARM_ARMED_AFTER_TICK: u64 = 150 * 2;

/// Wheel/RLW radius: 0.30/0.45/0.60 m, measured against 1.5B26 on 2026-10-27.
pub fn wheel_radius(option: f64) -> f64 {
    // measured 2026-10-27: option 1 rolls at 0.45 m, option 2 at 0.60 m (1.5× and 2× option 0)
    WHEEL_RADIUS0 * if option >= 2.0 { 2.0 } else if option >= 1.0 { 1.5 } else { 1.0 }
}
/// measured: the Basic car (option 0) rolls at v/ω = 0.30 m in the original
pub const WHEEL_RADIUS0: f64 = 0.3;

/// An attribute of a tile, or `d` when absent (`attr(tile.node, …)`).
pub fn tile_attr(t: &TileInstance, name: &str, env: Env, d: f64) -> f64 {
    t.attrs.get(name).map_or(d, |raw| eval_expr(raw, env))
}

/// World pose of a tile
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilePose {
    pub position: Vec3,
    pub quaternion: Quat,
}

/// Per-tile physics state (`TileBody`). `tile` is the index into the assembly's tiles (= the tile id).
#[derive(Clone, Debug)]
pub struct TileBody {
    pub tile: usize,
    pub body: RigidBodyHandle,
    /// the tile that owns `body` (itself when this tile starts a group)
    pub group_root: usize,
    /// rest transform of this tile relative to the group root
    pub rel_pos: Vec3,
    pub rel_quat: Quat,
    pub joint: Option<ImpulseJointHandle>,
    /// `joint` is a fixed joint (a servo); otherwise a revolute joint (a spring joint)
    pub joint_fixed: bool,
    pub animated: bool,
    /// wheels with a variable angle: the rim body and its fold joint (otherwise the rim is welded)
    pub rim: Option<RigidBodyHandle>,
    pub rim_joint: Option<ImpulseJointHandle>,
    /// rest orientation of `body` (model frame). Every body in a joint chain shares its
    /// parent's orientation so rapier's single joint axis means the same thing in both.
    pub body_rest_quat: Quat,
    pub body_rest_pos: Vec3,
    /// assembled angle (deg) of an animated joint; the joint measures 0 there
    pub rest_angle: f64,
    /// last applied jet power (for the exhaust glow)
    pub jet_power: f64,
    /// current servo angle (rad, joint frame) of an animated joint
    pub servo_angle: f64,
    /// angular velocity (rad/s) of the spring-limited command of an animated joint with spring < 1
    pub servo_vel: f64,
    /// spring < 1: a revolute joint held by a position motor (SPRING_K·spring²), and the inertia it swings
    pub springy: bool,
    pub spring_inertia: f64,
    /// spring joints: the rest of the model's inertia about the axis, and which tiles are in the subtree
    pub spring_inertia_rest: f64,
    pub spring_subtree: Vec<bool>,
    /// a wheel carrying chips is a rotor: they turn with its spin (`rotor_of` on each of them: the wheel's tile
    /// index); its inertia and the mass that sets its air drag
    pub rotor_of: Option<usize>,
    pub rotor_inertia: f64,
    pub rotor_mass: f64,
    /// wheels: kinematic spin about the rim normal (rad/s, + in the +power direction) and the
    /// accumulated angle for rendering. The tyre is not a spinning body (measured: the original's
    /// wheel does not spin up in the air and reads _WY = v/r while rolling).
    pub spin: f64,
    pub spin_angle: f64,
    /// wheels: ground contact point of the last step (None in the air) and the static load (N) this wheel
    /// carries, distributed over the touching wheels by the lever rule about the model's centre of mass
    pub contact_point: Option<Vec3>,
    pub load: f64,
    /// the tyre collider (wheels) and the smoothed normal force it measured in the last steps
    pub collider: Option<ColliderHandle>,
    pub contact_force: f64,
    /// soft kerb force the tyre carried this step (counts toward its load)
    pub kerb_force: f64,
    /// the wheel's static share of the weight (lever rule), kept for capping the grip load
    pub static_load: f64,
    /// steps since this tyre last (re)gained ground contact: a touchdown may use the full impact load for a while
    pub contact_age: u32,
    /// wheels: the tyre is sliding against the ground (drive or brake beyond the grip), spin then integrates
    pub slipping: bool,
    /// revolute axis in the parent body's local frame (for measuring the current joint angle)
    pub joint_axis_local: Option<Vec3>,
    pub joint_anchor_local: Option<Vec3>,
}

#[derive(Clone, Debug)]
pub struct Projectile {
    pub body: RigidBodyHandle,
    /// tick
    pub born: u64,
    pub energy: f64,
    /// position at the previous step, for the swept hit test against chip spheres
    pub prev: Vec3,
}

#[derive(Clone, Debug)]
pub struct Ball {
    pub body: RigidBodyHandle,
    pub radius: f64,
    pub color: [f64; 3],
    pub fixed: bool,
}

#[derive(Clone, Debug, Default)]
pub struct BuildOptions {
    /// rest poses are already world poses (rebuild after a detach): do not lift onto the ground
    pub in_place: bool,
    /// per tile id, (linear, angular) velocities to restore on the bodies that start a group
    pub velocities: Option<HashMap<usize, (Vec3, Vec3)>>,
}

#[derive(Clone, Copy, Debug)]
pub struct PhysicsOptions {
    pub gravity: f64,
    /// bare ground for measurements (the TypeScript's `__tune.noCourse`): no course blocks, no crates
    pub no_course: bool,
    /// no ground at all (terrain probes build their own, `src/bin/terrain.rs`)
    pub no_ground: bool,
}

impl Default for PhysicsOptions {
    fn default() -> Self {
        PhysicsOptions { gravity: -9.8, no_course: false, no_ground: false }
    }
}

/// Soft kerbs: the tyre/ground pairs this step handles with a spring are left out of the solver (rapier3d-compat:
/// `filterContactPair` returning `SolverFlags.EMPTY`; here `Some(SolverFlags::empty())` — contacts are still
/// computed, as in the TypeScript, but not solved).
struct KerbHooks<'a> {
    pairs: &'a HashSet<(ColliderHandle, ColliderHandle)>,
}

impl PhysicsHooks for KerbHooks<'_> {
    fn filter_contact_pair(&self, c: &PairFilterContext) -> Option<SolverFlags> {
        if self.pairs.contains(&(c.collider1, c.collider2)) || self.pairs.contains(&(c.collider2, c.collider1)) {
            Some(SolverFlags::empty())
        } else {
            Some(SolverFlags::COMPUTE_RIGID_IMPULSES)
        }
    }
    fn filter_intersection_pair(&self, _: &PairFilterContext) -> bool {
        true
    }
}

pub struct World {
    pub world: RapierWorld,
    pub tiles: Vec<TileBody>,
    pub dt: f64,
    pub tick: u64,
    /// mass of the assembled model (tyre load estimate)
    pub total_mass: f64,
    pub projectiles: Vec<Projectile>,
    /// tile id → energy
    pub arm_charge: HashMap<usize, f64>,
    /// fuel per tile id and the regulation switches (letters of the original's HUD row)
    pub fuel: HashMap<usize, f64>,
    pub fuel_max: HashMap<usize, f64>,
    pub regulations: HashMap<String, f64>,
    /// balls added by the player (the original's default scenario: H drops a magenta ball of radius 0.6 and
    /// specific gravity 0.3 at x = 2, 6 m up; they survive a reset) and the wind the same scenario cycles with J
    pub balls: Vec<Ball>,
    pub wind: Vec3,
    /// Optional authored lake: xmin, xmax, zmin, zmax, surface elevation.
    pub water: Option<[f64; 5]>,
    /// Positive on measured towing ranges. Zero keeps the original inlet replay physics.
    pub water_horizontal_drag: f64,
    /// knockable crates (course props), reset with the model
    pub crates: Vec<RigidBodyHandle>,
    pub(crate) assembly: Option<Assembly>,
    /// tyre/ground pairs this step handles as soft kerbs
    pub(crate) kerb_pairs: HashSet<(ColliderHandle, ColliderHandle)>,
}

impl World {
    pub fn new(opts: PhysicsOptions) -> World {
        let mut world = RapierWorld::default();
        world.gravity = rapier3d::math::Vector::new(0.0, opts.gravity as f32, 0.0);
        world.integration_parameters.dt = (1.0f64 / 60.0) as f32;
        world.integration_parameters.num_solver_iterations = SOLVER_ITERATIONS;
        world.integration_parameters.num_internal_pgs_iterations = PGS_ITERATIONS;
        // effectively endless: planes cover kilometres (a 4 km slab let them fly off the world and fall through)
        if !opts.no_ground {
            world.insert_collider(
                ColliderBuilder::cuboid(100000.0, 1.0, 100000.0)
                    .translation(to_vector(Vec3::new(0.0, -1.0, 0.0)))
                    .friction(1.0)
                    .collision_groups(groups(GROUND_GROUP)),
                None,
            );
        }
        let mut crates = Vec::new();
        if !opts.no_course {
            for b in COURSE.iter() {
                let q = quat_from_euler_yxz(b.rot_x.unwrap_or(0.0), b.rot_y.unwrap_or(0.0), 0.0);
                let cd = ColliderBuilder::cuboid((b.size[0] / 2.0) as f32, (b.size[1] / 2.0) as f32, (b.size[2] / 2.0) as f32)
                    .position(rapier3d::math::Pose::from_parts(to_vector(Vec3::new(b.pos[0], b.pos[1], b.pos[2])), to_rotation(q)))
                    .friction(1.0)
                    .collision_groups(groups(GROUND_GROUP));
                world.insert_collider(cd, None);
            }
            for c in CRATES.iter() {
                let body = world.insert_body(
                    RigidBodyBuilder::dynamic().translation(to_vector(Vec3::new(c.pos[0], c.pos[1], c.pos[2]))).linear_damping(0.1).angular_damping(0.2),
                );
                let h = (c.size / 2.0) as f32;
                world.insert_collider(ColliderBuilder::cuboid(h, h, h).mass(12.0).friction(0.8).collision_groups(groups(GROUND_GROUP)), Some(body));
                crates.push(body);
            }
        }
        World {
            world,
            tiles: Vec::new(),
            dt: 1.0 / 60.0,
            tick: 0,
            total_mass: 0.0,
            projectiles: Vec::new(),
            arm_charge: HashMap::new(),
            fuel: HashMap::new(),
            fuel_max: HashMap::new(),
            regulations: REGULATION_DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            balls: Vec::new(),
            wind: Vec3::default(),
            water: None,
            water_horizontal_drag: 0.0,
            crates,
            assembly: None,
            kerb_pairs: HashSet::new(),
        }
    }

    /// The assembly the world was built from, with the state physics keeps on it (`detached`, `powerless`,
    /// `durability`, world poses after a detach).
    pub fn assembly(&self) -> Option<&Assembly> {
        self.assembly.as_ref()
    }
    pub(crate) fn a(&self) -> &Assembly {
        self.assembly.as_ref().expect("world not built")
    }
    pub(crate) fn tile(&self, i: usize) -> &TileInstance {
        &self.a().tiles[i]
    }

    /// total fuel / capacity of the model
    pub fn fuel_total(&self) -> f64 {
        self.sum_fuel(&self.fuel)
    }
    pub fn fuel_max_total(&self) -> f64 {
        self.sum_fuel(&self.fuel_max)
    }
    /// sums in tile order (the TypeScript Map's insertion order)
    fn sum_fuel(&self, m: &HashMap<usize, f64>) -> f64 {
        let n = self.assembly.as_ref().map_or(0, |a| a.tiles.len());
        (0..n).fold(0.0, |t, i| t + m.get(&i).copied().unwrap_or(0.0))
    }

    /// burn `amount` (units per 30 fps frame, already scaled to the step) if regulation E is off; returns the
    /// fraction of the demand that could be met (0 when the tanks are dry)
    pub fn use_fuel(&mut self, amount: f64) -> f64 {
        if self.regulations.get("E").copied().unwrap_or(0.0) != 0.0 || amount <= 0.0 {
            return 1.0;
        }
        let total = self.fuel_total();
        if total <= 0.0 {
            return 0.0;
        }
        let take = js_min(amount, total);
        // Weights first, then every other chip in proportion to what it holds
        let mut left = take;
        let fuel_of = |w: &World, i: usize| w.fuel.get(&i).copied().unwrap_or(0.0);
        let weights: Vec<usize> = (0..self.tiles.len()).filter(|&i| self.tile(self.tiles[i].tile).type_ == "weight" && fuel_of(self, self.tiles[i].tile) > 0.0).map(|i| self.tiles[i].tile).collect();
        let wsum = weights.iter().fold(0.0, |a, &t| a + fuel_of(self, t));
        if wsum > 0.0 {
            let w = js_min(left, wsum);
            for &t in &weights {
                let f = fuel_of(self, t);
                self.fuel.insert(t, f - (w * f) / wsum);
            }
            left -= w;
        }
        if left > 0.0 {
            let others: Vec<usize> = (0..self.tiles.len()).filter(|&i| self.tile(self.tiles[i].tile).type_ != "weight" && fuel_of(self, self.tiles[i].tile) > 0.0).map(|i| self.tiles[i].tile).collect();
            let osum = others.iter().fold(0.0, |a, &t| a + fuel_of(self, t));
            if osum > 0.0 {
                for &t in &others {
                    let f = fuel_of(self, t);
                    self.fuel.insert(t, f - (left * f) / osum);
                }
            }
        }
        take / amount
    }

    /// _BYE / _SPLIT: cut a tile (and its subtree) loose. Every tile's current world pose
    /// becomes its new rest pose and the world is rebuilt in place with velocities kept.
    pub fn detach(&mut self, tile: usize, powerless: bool, env: Env) {
        let Some(a) = self.assembly.as_ref() else { return };
        if a.tiles[tile].parent.is_none() || a.tiles[tile].detached {
            return;
        }
        let mut velocities = HashMap::new();
        let mut previous_com = HashMap::new();
        let mut poses = Vec::with_capacity(self.tiles.len());
        for i in 0..self.tiles.len() {
            let pose = self.pose(i);
            let b = &self.world.bodies[self.tiles[i].body];
            velocities.insert(self.tiles[i].tile, (from_vector(b.linvel()), from_vector(b.angvel())));
            previous_com.insert(self.tiles[i].tile, from_vector(b.center_of_mass()));
            poses.push((self.tiles[i].tile, pose));
        }
        let mut a = self.assembly.take().unwrap();
        for (t, pose) in poses {
            a.tiles[t].position = pose.position;
            a.tiles[t].quaternion = pose.quaternion;
        }
        // joint anchors/axes live in the model frame: recompute them from the new poses
        for i in 0..self.tiles.len() {
            crate::model::refresh_joint_frames(&mut a.tiles, self.tiles[i].tile);
        }
        a.tiles[tile].detached = true;
        if powerless {
            let mut stack = vec![tile];
            while let Some(t) = stack.pop() {
                a.tiles[t].powerless = true;
                stack.extend(a.tiles[t].children.iter().copied());
            }
        }
        let charges = self.arm_charge.clone();
        let shells = std::mem::take(&mut self.projectiles);
        let tick = self.tick;
        self.build(a, env, Vec3::default(), BuildOptions { in_place: true, velocities: Some(velocities.clone()) });
        // Splitting changes each rigid body's COM. Keep the velocity field, not
        // just the old COM velocity, or spinning fragments lose tangential speed.
        let mut seen = HashSet::new();
        for tb in &self.tiles {
            if !seen.insert(tb.body) { continue; }
            let body = &mut self.world.bodies[tb.body];
            body.recompute_mass_properties_from_colliders(&self.world.colliders);
            let (v, w) = velocities[&tb.tile];
            let offset = from_vector(body.center_of_mass()).sub(previous_com[&tb.tile]);
            body.set_linvel(to_vector(v.add(Vec3::cross(w, offset))), true);
        }
        self.arm_charge = charges;
        self.projectiles = shells;
        self.tick = tick;
    }

    pub fn add_ball(&mut self, radius: f64, x: f64, y: f64, z: f64, gravity: f64) -> usize {
        let body = self.world.insert_body(RigidBodyBuilder::dynamic().translation(to_vector(Vec3::new(x, y, z))).linear_damping(0.05).angular_damping(0.1));
        let mass = gravity * 1000.0 * (4.0 / 3.0) * std::f64::consts::PI * radius.powi(3); // specific gravity against water
        self.world.insert_collider(
            ColliderBuilder::ball(radius as f32).mass(js_max(1.0, mass) as f32).friction(0.6).restitution(0.3).collision_groups(groups(GROUND_GROUP)),
            Some(body),
        );
        self.balls.push(Ball { body, radius, color: [1.0, 0.0, 1.0], fixed: false });
        self.balls.len() - 1
    }
    pub fn set_ball_fixed(&mut self, i: usize, fixed: bool) {
        let Some(b) = self.balls.get_mut(i) else { return };
        b.fixed = fixed;
        let h = b.body;
        if let Some(body) = self.world.bodies.get_mut(h) {
            body.set_body_type(if fixed { RigidBodyType::Fixed } else { RigidBodyType::Dynamic }, true);
        }
    }
    pub fn clear_balls(&mut self) {
        for b in std::mem::take(&mut self.balls) {
            self.world.remove_body(b.body);
        }
    }

    pub fn reset_crates(&mut self) {
        for (i, &h) in self.crates.iter().enumerate() {
            let c = CRATES[i];
            if let Some(b) = self.world.bodies.get_mut(h) {
                b.set_translation(to_vector(Vec3::new(c.pos[0], c.pos[1], c.pos[2])), true);
                b.set_rotation(to_rotation_normalized(Quat::IDENTITY), true);
                b.set_linvel(rapier3d::math::Vector::ZERO, true);
                b.set_angvel(rapier3d::math::Vector::ZERO, true);
            }
        }
    }

    pub fn clear(&mut self) {
        for t in &self.tiles {
            if let Some(j) = t.joint {
                self.world.impulse_joints.remove(j, true);
            }
            if let Some(j) = t.rim_joint {
                self.world.impulse_joints.remove(j, true);
            }
        }
        let mut seen = HashSet::new();
        let tiles = std::mem::take(&mut self.tiles);
        for t in &tiles {
            if let Some(rim) = t.rim {
                if seen.insert(rim) {
                    self.world.remove_body(rim);
                }
            }
            if !seen.insert(t.body) {
                continue;
            }
            self.world.remove_body(t.body);
        }
        self.tick = 0;
        for p in std::mem::take(&mut self.projectiles) {
            self.world.remove_body(p.body);
        }
        self.arm_charge.clear();
    }

    fn to_local(&self, body: RigidBodyHandle, world_point: Vec3) -> Vec3 {
        let b = &self.world.bodies[body];
        let t = from_vector(b.translation());
        let inv = from_rotation(*b.rotation()).invert();
        world_point.sub(t).apply_quat(inv)
    }
    fn to_local_dir(&self, body: RigidBodyHandle, world_dir: Vec3) -> Vec3 {
        let inv = from_rotation(*self.world.bodies[body].rotation()).invert();
        world_dir.apply_quat(inv).normalize()
    }

    /// Build the bodies, colliders and joints of `a` (rest poses with the Val values `env` gives) at `spawn`.
    pub fn build(&mut self, a: Assembly, env: Env, spawn: Vec3, opts: BuildOptions) {
        self.clear();
        // Original 1.5B26: spawn-height differences equal the maximum 3D distance from core to tile centre,
        // including Cowl and non-colliding Frame. Flat/tall/diagonal probes distinguish this from z reach.
        // The existing 1 m base offset is retained; these measurements establish the relative height.
        // The model falls from there; powered wheels spin up during the fall. (SPAWN_DROP)
        let reach = a.tiles.iter().fold(0.0, |m, t| js_max(m, t.position.distance_to(a.tiles[0].position)));
        let lift = if opts.in_place { 0.0 } else { 1.0 + reach - a.tiles[0].position.y };
        let offset = spawn.add(Vec3::new(0.0, lift, 0.0));
        self.total_mass = a.tiles.iter().fold(0.0, |m, t| m + t.mass);
        if !opts.in_place {
            // a fresh model: full tanks (a detach rebuild keeps what was left)
            self.fuel.clear();
            self.fuel_max.clear();
            for t in &a.tiles {
                let cap = fuel_capacity(&t.type_) * if t.type_ == "weight" { js_max(1.0, js_min(8.0, if t.option == 0.0 || t.option.is_nan() { 1.0 } else { t.option })) } else { 1.0 };
                self.fuel.insert(t.id, cap);
                self.fuel_max.insert(t.id, cap);
            }
        }
        let identity = to_rotation(Quat::IDENTITY);
        let pose_of = |p: Vec3, q: Quat| rapier3d::math::Pose::from_parts(to_vector(p), to_rotation(q));

        for tile in &a.tiles {
            let parent_tb = match tile.parent {
                Some(p) if !tile.detached => Some(self.tiles[p].clone()),
                _ => None,
            };
            let angle_expr = tile.attrs.get("angle").unwrap_or("");
            let angle_animated = parent_tb.is_some() && !expr_is_constant(angle_expr) && tile.spec.joint != JointKind::Fixed;
            let animated = angle_animated && tile.spec.joint != JointKind::Wheel;
            // spring < 1 asks for a compliant connection (suspension); default spring=1 is rigid
            let spring_val = if tile.attrs.get("spring").is_some() { tile_attr(tile, "spring", env, 1.0) } else { 1.0 };
            // measured 2026-11-01 (sag_v/sag_c): a joint with spring < 1 gives under load like a torsion spring of
            // SPRING_K·spring² N·m/rad, whether its angle is a Val or a literal (the 2026-10-27 "no sag" probe had its
            // arm lying on the ground). Such joints are revolute joints with a position motor, not welds or servos.
            let spring_expr = tile.attrs.get("spring");
            let springy = SPRING_JOINTS
                && parent_tb.is_some()
                && tile.spec.joint != JointKind::Wheel
                && tile.spec.joint != JointKind::Fixed
                && spring_expr.is_some_and(|e| !expr_is_constant(e) || spring_val < 1.0);
            let compliant = springy && !animated;
            let starts_group = parent_tb.is_none() || animated || compliant;

            // Wheel = rim (a plate folded like a chip) + rotor (the disc). The rim is welded to the
            // parent, or gets its own fold joint when the angle is a variable.
            let mut rim = None;
            let mut rim_joint = None;
            if let (true, Some(ptb)) = (tile.spec.wheel, parent_tb.as_ref()) {
                let rim_quat = ptb.body_rest_quat;
                if angle_animated {
                    let p = tile.position.add(offset);
                    let rb = self.world.insert_body(RigidBodyBuilder::dynamic().pose(pose_of(p, rim_quat)).ccd_enabled(true));
                    rim = Some(rb);
                    let anchor_w = tile.rim_anchor.add(offset);
                    // Equal revolute limits drifted by 85 degrees under walker loads.
                    // A fixed frame holds the commanded fold without guessed motor constants.
                    let jd = FixedJointBuilder::new()
                        .local_frame1(rapier3d::math::Pose::from_parts(to_vector(self.to_local(ptb.body, anchor_w)), identity))
                        .local_frame2(rapier3d::math::Pose::from_parts(to_vector(self.to_local(rb, anchor_w)), identity));
                    rim_joint = Some(self.world.impulse_joints.insert(ptb.body, rb, jd, true));
                }
            }

            let (body, group_root, body_rest_quat, body_rest_pos);
            if starts_group {
                body_rest_quat = parent_tb.as_ref().map_or(tile.quaternion, |p| p.body_rest_quat);
                body_rest_pos = tile.position;
                let p = body_rest_pos.add(offset);
                let rb = RigidBodyBuilder::dynamic()
                    .pose(pose_of(p, body_rest_quat))
                    // the original shows no measurable drag coasting at 22 m/s; damping only steals speed
                    .linear_damping(0.0)
                    .angular_damping(if tile.spec.wheel { 0.0 } else { 0.05 })
                    .ccd_enabled(true);
                body = self.world.insert_body(rb);
                if let Some((lin, ang)) = opts.velocities.as_ref().and_then(|v| v.get(&tile.id)) {
                    let b = self.world.bodies.get_mut(body).unwrap();
                    b.set_linvel(to_vector(*lin), true);
                    b.set_angvel(to_vector(*ang), true);
                }
                group_root = tile.id;
            } else if let Some(rb) = rim {
                body = rb;
                group_root = tile.id;
                body_rest_quat = parent_tb.as_ref().unwrap().body_rest_quat;
                body_rest_pos = tile.position;
            } else {
                let p = parent_tb.as_ref().unwrap();
                body = p.body;
                group_root = p.group_root;
                body_rest_quat = p.body_rest_quat;
                body_rest_pos = p.body_rest_pos;
            }
            let inv_q = body_rest_quat.invert();
            let rel_quat = Quat::mul(inv_q, tile.quaternion);
            let rel_pos = tile.position.sub(body_rest_pos).apply_quat(inv_q);

            // collider
            let mut collider = None;
            let mass = tile.mass;
            if mass > 0.0 || tile.spec.collides {
                // the tyre is a sphere: a frictionless cylinder lying on the ground made the chassis wander and roll
                // (edge contacts), a ball reproduces the original's straight-line run within a few percent
                let cd = if tile.spec.wheel {
                    ColliderBuilder::ball(wheel_radius(tile.option) as f32)
                } else {
                    ColliderBuilder::cuboid((TILE / 2.0) as f32, (TILE_T / 2.0) as f32, (TILE / 2.0) as f32)
                };
                // a tyre is frictionless (it only carries load); grip comes from drive_wheel()
                let mut cd = cd
                    .mass(js_max(0.1, mass) as f32)
                    .user_data(super::impact::MODEL_COLLIDER_TAG | tile.id as u128)
                    .friction(if tile.spec.wheel { 0.0 } else { tile.spec.friction as f32 })
                    .collision_groups(groups(MODEL_GROUP))
                    // rapier averages friction by default, so a chip's 0.02 against the ground's 1.0 would act as 0.5:
                    // the tile's own coefficient is the measured one, let it rule
                    .friction_combine_rule(CoefficientCombineRule::Min)
                    .position(pose_of(rel_pos, rel_quat));
                if tile.ghost || !tile.spec.collides {
                    cd = cd.sensor(true);
                }
                if tile.spec.wheel {
                    cd = cd.active_hooks(ActiveHooks::FILTER_CONTACT_PAIRS); // soft kerbs (kerb_springs)
                }
                let col = self.world.insert_collider(cd, Some(body));
                if tile.spec.wheel {
                    collider = Some(col);
                }
            }

            let mut joint = None;
            let mut joint_fixed = false;
            let mut joint_axis_local = None;
            let mut joint_anchor_local = None;
            if let (true, Some(ptb)) = (starts_group, parent_tb.as_ref()) {
                let anchor_w = tile.anchor.add(offset);
                let axis_w = tile.axis.normalize();
                // Both bodies share the same rest orientation, so rapier's single joint axis has the
                // same coordinates in both local frames and the joint measures 0 at the rest pose.
                let axis_l = self.to_local_dir(ptb.body, axis_w);
                // (the TypeScript passes the f64 vectors to rapier: they round to f32 there; keep the rounded value
                // like `RevoluteImpulseJoint` reads back nothing — jointAxisLocal holds the f64 one)
                joint_axis_local = Some(axis_l);
                let anch_l = self.to_local(ptb.body, anchor_w);
                joint_anchor_local = Some(anch_l);
                let split_servo = animated && !springy;
                let handle = if split_servo {
                    joint_fixed = true;
                    let jd = FixedJointBuilder::new()
                        .local_frame1(rapier3d::math::Pose::from_parts(to_vector(anch_l), identity))
                        .local_frame2(rapier3d::math::Pose::from_parts(to_vector(self.to_local(body, anchor_w)), identity));
                    self.world.impulse_joints.insert(ptb.body, body, jd, true)
                } else {
                    let mut jd = RevoluteJointBuilder::new(to_vector(axis_l)).local_anchor1(to_vector(anch_l)).local_anchor2(to_vector(self.to_local(body, anchor_w)));
                    if springy {
                        jd = jd.motor_model(MotorModel::ForceBased); // gains set every step (spring_motor)
                    }
                    self.world.impulse_joints.insert(ptb.body, body, jd, true)
                };
                joint = Some(handle);
            }
            let rest_angle = if angle_animated { tile_attr(tile, "angle", env, 0.0) } else { 0.0 };
            self.tiles.push(TileBody {
                tile: tile.id,
                body,
                group_root,
                rel_pos,
                rel_quat,
                joint,
                joint_fixed,
                animated,
                springy,
                spring_inertia: 0.0,
                spring_inertia_rest: 0.0,
                spring_subtree: Vec::new(),
                rotor_of: None,
                rotor_inertia: 0.0,
                rotor_mass: 0.0,
                rim,
                rim_joint,
                body_rest_quat,
                body_rest_pos,
                rest_angle,
                jet_power: 0.0,
                servo_angle: 0.0,
                servo_vel: 0.0,
                spin: 0.0,
                spin_angle: 0.0,
                contact_point: None,
                load: 0.0,
                collider,
                contact_force: 0.0,
                kerb_force: 0.0,
                static_load: 0.0,
                contact_age: 0,
                slipping: false,
                joint_axis_local,
                joint_anchor_local,
            });
        }
        // a spring joint's damping needs the inertia it swings: the subtree beyond it about its axis
        for i in 0..self.tiles.len() {
            if !self.tiles[i].springy {
                continue;
            }
            let t0 = &a.tiles[self.tiles[i].tile];
            let (anchor, n) = (t0.anchor, t0.axis.normalize());
            let mut inertia = 0.0;
            let mut total = 0.0;
            let mut subtree = vec![false; a.tiles.len()];
            for t in &a.tiles {
                let r = t.position.sub(anchor);
                let r = r.sub(n.scale(r.dot(n)));
                total += t.mass * (r.length_sq() + (TILE * TILE) / 12.0);
                let mut p = Some(t.id);
                while let Some(pi) = p {
                    if pi == t0.id {
                        break;
                    }
                    p = a.tiles[pi].parent;
                }
                if p.is_none() {
                    continue;
                }
                subtree[t.id] = true;
                let r = t.position.sub(anchor);
                let r = r.sub(n.scale(r.dot(n)));
                inertia += t.mass * (r.length_sq() + (TILE * TILE) / 12.0);
            }
            self.tiles[i].spring_inertia = inertia;
            self.tiles[i].spring_inertia_rest = js_max(0.0, total - inertia);
            self.tiles[i].spring_subtree = subtree;
        }
        if ROTOR {
            for wi in 0..self.tiles.len() {
                let w = &a.tiles[self.tiles[wi].tile];
                if !(w.spec.wheel && w.parent.is_some()) {
                    continue;
                }
                let n = w.axis.normalize();
                let (mut inertia, mut m) = (0.0, 0.0);
                for ti in 0..self.tiles.len() {
                    if ti == wi {
                        continue;
                    }
                    let t = &a.tiles[self.tiles[ti].tile];
                    let mut p = t.parent;
                    while let Some(pi) = p {
                        if pi == w.id || a.tiles[pi].detached {
                            break;
                        }
                        p = a.tiles[pi].parent;
                    }
                    if p != Some(w.id) {
                        continue;
                    }
                    if self.tiles[ti].rotor_of.is_none() {
                        self.tiles[ti].rotor_of = Some(wi); // the nearest rotor wins (rotors on rotors turn with the inner one only)
                    }
                    let r = t.position.sub(w.position);
                    let r = r.sub(n.scale(r.dot(n)));
                    inertia += t.mass * (r.length_sq() + (TILE * TILE) / 12.0);
                    m += t.mass;
                }
                self.tiles[wi].rotor_inertia = inertia;
                self.tiles[wi].rotor_mass = m;
            }
        }
        // the rotor turns its chips outside the solver, which suits blades but not a wheel that carries most of the model
        // (2leg1 and 4leg2 hang their legs on a "head wheel" their Lua holds still): those stay rigid
        let total = self.tiles.iter().fold(0.0, |s, t| s + a.tiles[t.tile].mass);
        for wi in 0..self.tiles.len() {
            let wm = a.tiles[self.tiles[wi].tile].mass;
            if self.tiles[wi].rotor_inertia > 0.0 && self.tiles[wi].rotor_mass > 0.5 * (total - wm) {
                self.tiles[wi].rotor_inertia = 0.0;
                self.tiles[wi].rotor_mass = 0.0;
                for t in self.tiles.iter_mut() {
                    if t.rotor_of == Some(wi) {
                        t.rotor_of = None;
                    }
                }
            }
        }
        self.assembly = Some(a);
    }

    pub(crate) fn component_root(&self, mut tile: usize) -> usize {
        let a = self.a();
        while let (Some(p), false) = (a.tiles[tile].parent, a.tiles[tile].detached) {
            tile = p;
        }
        tile
    }

    /// world pose of a tile (its group body pose composed with the rest offset)
    pub fn pose(&self, i: usize) -> TilePose {
        let tb = &self.tiles[i];
        let b = &self.world.bodies[tb.body];
        let t = from_vector(b.translation());
        let r = from_rotation(*b.rotation());
        let mut p = tb.rel_pos.apply_quat(r).add(t);
        let mut q = Quat::mul(r, tb.rel_quat);
        if let Some(wi) = tb.rotor_of {
            // carried by a rotor: turned about the wheel's axis through its hub by the wheel's spin angle
            let w = self.pose(wi);
            let spin = Quat::from_axis_angle(ROTOR_AXIS.apply_quat(w.quaternion), -self.tiles[wi].spin_angle); // +power turns a rotor clockwise about its normal (measured)
            p = p.sub(w.position).apply_quat(spin).add(w.position);
            q = Quat::mul(spin, q);
        }
        TilePose { position: p, quaternion: q }
    }

    /// velocity of a tile's center
    pub fn velocity(&self, i: usize, pose: &TilePose) -> Vec3 {
        let tb = &self.tiles[i];
        let b = &self.world.bodies[tb.body];
        let v = from_vector(b.linvel());
        let w = from_vector(b.angvel());
        let c = from_vector(b.translation());
        let r = pose.position.sub(c);
        let mut out = Vec3::cross(w, r).add(v);
        if let Some(wi) = tb.rotor_of {
            let hub = self.pose(wi);
            let n = ROTOR_AXIS.apply_quat(hub.quaternion);
            out = out.add(Vec3::cross(n.scale(-self.tiles[wi].spin), pose.position.sub(hub.position)));
        }
        out
    }

    /// Drive joints toward attribute values, apply wheel torque, jets and air drag.
    pub fn apply_controls(&mut self, env: Env) {
        let mut seen = HashSet::new();
        for i in 0..self.tiles.len() {
            let h = self.tiles[i].body;
            if !seen.insert(h) {
                continue;
            }
            // forces/torques accumulate across steps in rapier; start every step from zero
            let b = self.world.bodies.get_mut(h).unwrap();
            b.reset_forces(false);
            b.reset_torques(false);
        }
        // simultaneous servos (default): balance the component's mass pose after all commanded poses are applied
        let grounded = if self.tiles.iter().any(|t| t.springy) { self.grounded_tiles() } else { Vec::new() };
        let mass_before = self.servo_mass_points();
        let anchors = self.servo_contact_anchors();
        let mut changed_roots: Vec<usize> = Vec::new();
        for i in 0..self.tiles.len() {
            let (joint, springy, animated) = (self.tiles[i].joint, self.tiles[i].springy, self.tiles[i].animated);
            if springy && joint.is_some() {
                self.spring_motor(i, env, &grounded);
                continue;
            }
            let tile = self.tile(self.tiles[i].tile);
            if joint.is_none() || tile.parent.is_none() || tile.spec.wheel || !animated {
                continue;
            }
            // servo: the commanded angle is reached at a bounded rate (SERVO_RATE deg per physics step) instead of
            // instantly — instant jumps of a leg joint pump energy through the hard limits and launch walkers
            let rate = SERVO_RATE * DEG;
            let target = crate::model::joint_sign(tile.spec.joint, tile.dir) * (tile_attr(tile, "angle", env, 0.0) - self.tiles[i].rest_angle) * DEG;
            let mut d = target - self.tiles[i].servo_angle;
            let spring_val = if tile.attrs.get("spring").is_some() { tile_attr(tile, "spring", env, 1.0) } else { 1.0 };
            let spring_w = SPRING_SERVO_W * js_max(0.0, spring_val).powf(SPRING_SERVO_P) * 30.0; // rad/s
            if spring_val < 1.0 && spring_w * self.dt < 2.0 {
                // damped spring toward the command (sub-stepped: ω·dt approaches 1 near spring 0.5). Only reachable
                // with SPRING_JOINTS off: a joint with spring < 1 is a spring joint and was handled above.
                let damper = if tile.attrs.get("damper").is_some() { tile_attr(tile, "damper", env, 0.5) } else { tile_attr(tile, "dumper", env, 0.5) };
                let zeta = 0.25 + 0.7 * js_min(0.5, js_max(0.0, damper));
                let (mut a, mut v) = (self.tiles[i].servo_angle, self.tiles[i].servo_vel);
                let n = 8;
                let h = self.dt / n as f64;
                // the spring pulls the short way round: a motor-style model that commands "current + 20°" sees its
                // target wrap from +170° to −170° (G.txt: legs that read _RY and keep chasing)
                let goal = a + (target - a).sin().atan2((target - a).cos());
                for _ in 0..n {
                    v += h * (spring_w * spring_w * (goal - a) - 2.0 * zeta * spring_w * v);
                    a += h * v;
                }
                if (goal - a).abs() < 1e-6 && v.abs() < 1e-4 {
                    a = goal;
                    v = 0.0;
                }
                self.tiles[i].servo_vel = v;
                d = a - self.tiles[i].servo_angle;
            } else {
                self.tiles[i].servo_vel = 0.0;
            }
            if d.abs() > 1e-8 {
                let root = self.component_root(self.tiles[i].tile);
                if !changed_roots.contains(&root) {
                    changed_roots.push(root);
                }
            }
            self.tiles[i].servo_angle += clamp(d, -rate, rate);
            if self.tiles[i].joint_fixed {
                if let Some(axis) = self.tiles[i].joint_axis_local {
                    // Change the pose only when the command changes; retain the angle with a bilateral constraint.
                    if SERVO_TELEPORT && d.abs() > 1e-8 {
                        self.servo_teleport(i);
                    }
                    // rapier3d-compat `setFrameX1(q)`: the rotation of the joint's first local frame
                    let q = to_rotation(Quat::from_axis_angle(axis, self.tiles[i].servo_angle));
                    if let Some(j) = self.world.impulse_joints.get_mut(joint.unwrap(), true) {
                        j.data.local_frame1.rotation = q;
                    }
                }
            }
            // (the revolute-joint servo variants — teleport with limits, velocity / acceleration motors, soft
            // servos — only run with probe knobs: an animated joint without a spring is always a fixed joint)
        }
        self.balance_servo_pose(&changed_roots, &mass_before);
        self.anchor_servo_tangents(&changed_roots, &anchors);
        self.distribute_loads();
        let up = Vec3::new(0.0, 1.0, 0.0);
        for i in 0..self.tiles.len() {
            let pose = self.pose(i);
            let normal = up.apply_quat(pose.quaternion);
            let (is_wheel, has_parent, is_arm, is_jet, drag) = {
                let t = self.tile(self.tiles[i].tile);
                (t.spec.wheel, t.parent.is_some(), t.type_ == "arm", t.spec.jet, t.spec.drag)
            };
            if is_wheel && has_parent {
                self.drive_wheel(i, &pose, normal, env);
            }
            if is_arm {
                self.update_arm(i, &pose, env);
            }
            let body = self.tiles[i].body;

            if let Some([xmin, xmax, zmin, zmax, level]) = self.water {
                let p = pose.position;
                if p.x >= xmin && p.x <= xmax && p.z >= zmin && p.z <= zmax && p.y < level {
                    let t = self.tile(self.tiles[i].tile);
                    // Original deep-water release: Core/Chip +5.6 m/s² initially, +0.841 m/s terminal.
                    // A Frame displaces half as much as a Chip; ballast increases mass without displacement.
                    let displaced = t.spec.mass.min(25.2);
                    let fraction = ((level - p.y) / 0.7).min(1.0);
                    let v = self.velocity(i, &pose);
                    let cap = t.mass / (2.0 * self.dt);
                    let buoyancy = Vec3::new(0.0, 15.4 * displaced, 0.0);
                    let force = if self.water_horizontal_drag > 0.0 {
                        let horizontal = (self.water_horizontal_drag * drag * v.x.hypot(v.z)).min(cap);
                        let vertical = (200.0 * drag * v.y.abs()).min(cap);
                        buoyancy.add(Vec3::new(-horizontal * v.x, -vertical * v.y, -horizontal * v.z))
                    } else {
                        buoyancy.add_scaled(v, -(200.0 * drag * v.length()).min(cap))
                    }.scale(fraction);
                    self.world.bodies.get_mut(body).unwrap().add_force_at_point(to_vector(force), to_vector(p), true);
                }
            }

            if is_jet {
                let t = self.tile(self.tiles[i].tile);
                let mut power = if t.powerless { 0.0 } else { tile_attr(t, "power", env, 0.0) };
                let option = t.option;
                if power != 0.0 {
                    power *= self.use_fuel(FUEL_PER_POWER_JET * power.abs() * self.dt * 30.0);
                }
                self.tiles[i].jet_power = power;
                if power != 0.0 {
                    // option 1 = balloon (wikiwiki: 1 hydrogen, 2 air): buoyancy straight up, whatever the tilt;
                    // the airship model mounts them at angle -90/0/90 and lifts with 10,000-50,000
                    // measured 2026-11-01 (rc_models40.sh): option 2 (air) gives no force at all in the air; option 1 lifts
                    if option == 2.0 {
                        power = 0.0;
                    }
                    let balloon = option == 1.0;
                    let f = if balloon { Vec3::new(0.0, power * JET_NEWTON_PER_POWER, 0.0) } else { normal.scale(power * JET_NEWTON_PER_POWER) };
                    self.world.bodies.get_mut(body).unwrap().add_force_at_point(to_vector(f), to_vector(pose.position), true);
                }
            }

            if drag > 0.0 {
                let v = self.velocity(i, &pose).sub(self.wind); // air speed: the wind the scenario sets
                // isotropic air resistance per tile (the reference table lists a per-type coefficient:
                // Chip 1, Weight 1, Arm 0.7, Wheel 0.05, Frame/Jet 0) — caps top speeds
                let vl = v.length();
                let mut fair = Vec3::default();
                if vl > 0.5 {
                    let iso = -ISO_DRAG * drag * vl;
                    fair = fair.add_scaled(v, iso);
                }
                // plate normal force (lift at angle of attack, broadside drag)
                let vn = v.dot(normal);
                let speed = v.length();
                // measured 2026-10-28 on the original (ballasted sled, 2-chip plate, 3333 N): the plate's normal
                // force grows like v²·sin^1.3(α) — ≈1.2 N/(m/s)² per chip at 30°, 3.9 at 60°, small at 15°, and
                // flat plates feel nothing up to 40 m/s; a 3-plate sled lifts off at 40 m/s with 9° of pitch
                // (AERO_MODEL 'pow', the default law; 'quad', 'newton', 'slope' and 'none' were probe knobs)
                let sin_a = if speed > 1e-6 { vn.abs() / speed } else { 0.0 };
                let mag = speed * speed * (AERO_K * sin_a.powf(AERO_P) + AERO_K2 * sin_a.powf(AERO_P2));
                let f = -js_sign(vn) * drag * mag;
                if f.abs() > 1e-4 {
                    fair = fair.add_scaled(normal, f);
                }
                if fair.length_sq() > 0.0 {
                    self.world.bodies.get_mut(body).unwrap().add_force_at_point(to_vector(fair), to_vector(pose.position), true);
                    if let Some(wi) = self.tiles[i].rotor_of {
                        // the air's drag on a rotor's chips brakes the rotor (ROTOR_DRAG), not the body: take its moment about
                        // the rotor axis back off the body, keeping lift and the tilting moments of cyclic pitch
                        let hub = self.pose(wi);
                        let n = ROTOR_AXIS.apply_quat(hub.quaternion);
                        let along = Vec3::cross(pose.position.sub(hub.position), fair).dot(n);
                        self.world.bodies.get_mut(body).unwrap().add_torque(to_vector(Vec3::new(-n.x * along, -n.y * along, -n.z * along)), true);
                    }
                }
            }
        }
    }

    /// One physics step of `dt`: soft kerbs, the solver (with the kerb filter hook), tyre loads, shells.
    pub fn step(&mut self, env: Env) {
        self.kerb_springs();
        let before_impact = self.impact_snapshot();
        let Self { world, kerb_pairs, .. } = self;
        world.step_with_events(&KerbHooks { pairs: kerb_pairs }, &());
        self.measure_tyre_loads();
        if let Some(before) = before_impact { self.break_impact_joints(before, env); }
        self.tick += 1;
        if !self.projectiles.is_empty() {
            self.cull_projectiles(env);
        }
    }

    /// Rays against the ground-like colliders the way the script API's `_H` casts them (membership 1, hits group 2,
    /// never `exclude`): the time of impact, if any.
    pub fn cast_ray_ground(&self, origin: Vec3, dir: Vec3, max_toi: f64, exclude: Option<RigidBodyHandle>) -> Option<f64> {
        let mut filter = QueryFilter::new().groups(groups(MODEL_GROUP));
        if let Some(b) = exclude {
            filter = filter.exclude_rigid_body(b);
        }
        self.world.cast_ray(&Ray::new(to_vector(origin), to_vector(dir)), max_toi as f32, true, filter).map(|(_, toi)| toi as f64)
    }
}
