//! Turns a parsed .rc body tree into a flat list of tile instances with rest transforms and joint descriptions
//! (port of `src/model/assemble.ts`). Conventions (docs/spec/rc-format.md):
//!
//! ```text
//!   world: +X east, +Y up, +Z south  →  N = -Z, S = +Z, E = +X, W = -X
//!   a tile is a square plate of edge TILE and thickness TILE_T
//!   child tile center = parent center + dir * TILE (edge to edge)
//!   Chip/Frame/Weight/Jet/Arm: fold about the shared edge (hinge)
//!   Rudder: rotate about the parent's normal (yaw) at the shared edge
//!   Trim:   rotate about the connection axis (roll)
//!   Wheel:  disc in the tile plane, spinning about its own normal
//! ```
//!
//! Everything type-specific is in [`TYPES`] so it can be corrected against the spec without touching physics or
//! rendering. The vector and quaternion operations reproduce three.js's formulas and operation order in f64, so
//! poses match the TypeScript to rounding.

use crate::rc::{eval_expr, ChipNode, Dir, Env, RcModel};
use std::fmt;

// Measured against the original 1.5B26 (2026-10-27): chip centers are 0.6 m apart, wheel option 0 rolls at
// v/ω = 0.30 m, a 90°-folded wheel hangs 0.3 m below and 0.3 m beyond its hinge.
pub const TILE: f64 = 0.6;
/// a chip lying flat rests with its center 0.015 m above the ground (measured)
pub const TILE_T: f64 = 0.03;

const DEG: f64 = std::f64::consts::PI / 180.0;

// ---------------------------------------------------------------------------------------------------------------
// three.js math, same formulas and order

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Vec3 { x, y, z }
    }
    pub fn add(self, v: Vec3) -> Vec3 {
        Vec3::new(self.x + v.x, self.y + v.y, self.z + v.z)
    }
    pub fn sub(self, v: Vec3) -> Vec3 {
        Vec3::new(self.x - v.x, self.y - v.y, self.z - v.z)
    }
    pub fn scale(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }
    pub fn length(self) -> f64 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }
    /// `divideScalar(length || 1)` = `multiplyScalar(1 / (length || 1))`
    pub fn normalize(self) -> Vec3 {
        let l = self.length();
        self.scale(1.0 / if l == 0.0 || l.is_nan() { 1.0 } else { l })
    }
    pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
        Vec3::new(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
    }
    /// `Vector3.applyQuaternion` (q assumed unit)
    pub fn apply_quat(self, q: Quat) -> Vec3 {
        let (vx, vy, vz) = (self.x, self.y, self.z);
        let tx = 2.0 * (q.y * vz - q.z * vy);
        let ty = 2.0 * (q.z * vx - q.x * vz);
        let tz = 2.0 * (q.x * vy - q.y * vx);
        Vec3::new(
            vx + q.w * tx + q.y * tz - q.z * ty,
            vy + q.w * ty + q.z * tx - q.x * tz,
            vz + q.w * tz + q.x * ty - q.y * tx,
        )
    }
    pub fn to_array(self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Default for Quat {
    fn default() -> Self {
        Quat::IDENTITY
    }
}

impl Quat {
    pub const IDENTITY: Quat = Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };
    pub fn from_axis_angle(axis: Vec3, angle: f64) -> Quat {
        let half = angle / 2.0;
        let s = half.sin();
        Quat { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: half.cos() }
    }
    /// `multiplyQuaternions(a, b)`: `a.multiply(b)` = a·b, `b.premultiply(a)` = a·b
    pub fn mul(a: Quat, b: Quat) -> Quat {
        Quat {
            x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
            y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
            z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        }
    }
    /// `invert()` is the conjugate in three.js
    pub fn invert(self) -> Quat {
        Quat { x: -self.x, y: -self.y, z: -self.z, w: self.w }
    }
    pub fn to_array(self) -> [f64; 4] {
        [self.x, self.y, self.z, self.w]
    }
}

const UP: Vec3 = Vec3::new(0.0, 1.0, 0.0);

// ---------------------------------------------------------------------------------------------------------------
// type table and sign conventions

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JointKind {
    Hinge,
    Yaw,
    Roll,
    Wheel,
    Fixed,
}

/// Sign between a fold `angle` and the right-handed rotation about hingeAxis = cross(up, dir), per attachment
/// direction (indexed N, S, E, W). +1 means a positive angle folds the child DOWN. (A mutable table in the
/// TypeScript so the convention can be probed against the corpus with tools/foldsign.ts.)
pub const FOLD_SIGN: [f64; 4] = [1.0, 1.0, 1.0, 1.0];

pub fn fold_sign(d: Dir) -> f64 {
    FOLD_SIGN[match d {
        Dir::N => 0,
        Dir::S => 1,
        Dir::E => 2,
        Dir::W => 3,
    }]
}

/// Same for Trim (roll about dir), Rudder (yaw about the parent normal) and the Wheel rim fold.
/// Measured 2026-10-27 with tools/foldsign.ts over 16 corpus vehicles: of 64 sign combinations, fold +1 everywhere
/// (positive folds DOWN), Trim +1, Rudder -1, wheel rim +1 puts 32/42 wheels on the ground plane (bike, segway,
/// car1, car2, 3wheel, 6leg, tatikoma all perfect); the next best combination scores 29.
pub struct JointSign {
    pub trim: f64,
    pub rudder: f64,
    pub wheel: f64,
}
pub const JOINT_SIGN: JointSign = JointSign { trim: 1.0, rudder: -1.0, wheel: 1.0 };

/// sign between an `angle` attribute and the joint's right-handed rotation about its axis
pub fn joint_sign(kind: JointKind, dir: Option<Dir>) -> f64 {
    match kind {
        JointKind::Hinge | JointKind::Fixed => fold_sign(dir.unwrap_or(Dir::N)),
        JointKind::Roll => JOINT_SIGN.trim,
        JointKind::Yaw => JOINT_SIGN.rudder,
        JointKind::Wheel => JOINT_SIGN.wheel,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TypeSpec {
    pub joint: JointKind,
    pub collides: bool,
    /// kg, from the public reference table
    pub mass: f64,
    /// `_TYPE()` code
    pub code: i32,
    /// glued to the parent body (Cowl)
    pub merge: bool,
    pub jet: bool,
    pub wheel: bool,
    /// true for Frame-like tiles that become ghosts with option=1
    pub ghostable: bool,
    /// reaction-less wheel
    pub no_reaction: bool,
    pub drag: f64,
    pub friction: f64,
}

const fn spec(joint: JointKind, mass: f64, code: i32, drag: f64, friction: f64) -> TypeSpec {
    TypeSpec {
        joint,
        collides: true,
        mass,
        code,
        merge: false,
        jet: false,
        wheel: false,
        ghostable: false,
        no_reaction: false,
        drag,
        friction,
    }
}

const fn ghostable(s: TypeSpec) -> TypeSpec {
    TypeSpec { ghostable: true, ..s }
}

const WHEEL_MASS: f64 = 42.41 + 36.76;

// friction: measured 2026-10-28 on the original with a stand-up jet (1452 N) pushing plates along the ground:
// Chip plates slide with no measurable friction (7.8 m/s² for 7.7 available), Frame plates ≈ 0.1, Weight plates do
// not move at all (μ ≥ 0.3). The earlier 0.23 for chips came from a sled whose hanging jet dragged on the ground.
pub static TYPES: [(&str, TypeSpec); 13] = {
    use JointKind::*;
    [
        ("core", spec(Fixed, 25.2, 0, 1.0, 0.02)),
        ("chip", spec(Hinge, 25.2, 1, 1.0, 0.02)),
        ("frame", ghostable(spec(Hinge, 12.6, 33, 0.0, 0.1))),
        ("rudder", spec(Yaw, 25.2, 2, 1.0, 0.02)),
        ("rudderf", ghostable(spec(Yaw, 12.6, 34, 0.0, 0.1))),
        ("trim", spec(Roll, 25.2, 6, 1.0, 0.02)),
        ("trimf", ghostable(spec(Roll, 12.6, 35, 0.0, 0.1))),
        ("wheel", TypeSpec { wheel: true, ..spec(Wheel, WHEEL_MASS, 4, 0.05, 1.4) }),
        ("rlw", TypeSpec { wheel: true, no_reaction: true, ..spec(Wheel, WHEEL_MASS, 5, 0.05, 1.4) }),
        ("jet", TypeSpec { jet: true, ..spec(Hinge, 36.76, 7, 0.0, 0.02) }),
        ("weight", spec(Hinge, 100.8, 8, 1.0, 0.4)),
        ("cowl", TypeSpec { collides: false, merge: true, ..spec(Fixed, 0.0, 9, 0.0, 0.0) }),
        ("arm", spec(Hinge, 50.4, 10, 0.7, 0.02)),
    ]
};

/// Spec for a lower-case type key.
pub fn type_spec(key: &str) -> Option<&'static TypeSpec> {
    TYPES.iter().find(|(k, _)| *k == key).map(|(_, s)| s)
}

pub fn dir_vec(d: Dir) -> Vec3 {
    match d {
        Dir::N => Vec3::new(0.0, 0.0, -1.0),
        Dir::S => Vec3::new(0.0, 0.0, 1.0),
        Dir::E => Vec3::new(1.0, 0.0, 0.0),
        Dir::W => Vec3::new(-1.0, 0.0, 0.0),
    }
}

/// `DIR_CODE`
pub fn dir_code(d: Dir) -> i32 {
    match d {
        Dir::S => 0,
        Dir::W => 1,
        Dir::N => 2,
        Dir::E => 3,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// tiles

/// The joint frames expressed in the parent's rest frame (to refresh after motion).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocalFrames {
    pub anchor: Vec3,
    pub axis: Vec3,
    pub rim_anchor: Vec3,
    pub rim_axis: Vec3,
    pub dir_axis: Vec3,
}

#[derive(Clone, Debug)]
pub struct TileInstance {
    /// index in `Assembly::tiles`
    pub id: usize,
    /// chip number as seen by scripts (wheels occupy two numbers: rim, rotor)
    pub chip_index: usize,
    /// lower-case type key
    pub type_: String,
    pub spec: &'static TypeSpec,
    /// the node's raw attribute expressions and source line
    pub attrs: crate::rc::Attrs,
    pub line: usize,
    pub parent: Option<usize>,
    pub dir: Option<Dir>,
    /// Arm-shell durability (`_T`): 10000 fresh, −1 destroyed; lives on the instance so a detach rebuild keeps it
    pub durability: Option<f64>,
    pub name: Option<String>,
    pub position: Vec3,
    pub quaternion: Quat,
    /// joint anchor and axis in model frame at rest
    pub anchor: Vec3,
    pub axis: Vec3,
    /// wheels: the rim's hinge (fold) axis and anchor; `axis`/`anchor` are then the rotor spin
    pub rim_axis: Vec3,
    pub rim_anchor: Vec3,
    pub dir_axis: Vec3,
    pub local: Option<LocalFrames>,
    pub color: Option<f64>,
    /// raw color / effect expressions (re-evaluated every frame when not constant)
    pub color_expr: Option<String>,
    pub effect_expr: Option<String>,
    pub ghost: bool,
    pub mass: f64,
    pub option: f64,
    pub children: Vec<usize>,
    /// cut loose from its parent by _BYE/_SPLIT (becomes the root of its own system)
    pub detached: bool,
    /// _BYE: the cut system's power is forced to 0
    pub powerless: bool,
}

#[derive(Clone, Debug)]
pub struct Assembly {
    pub tiles: Vec<TileInstance>,
    pub roots: Vec<usize>,
    /// chip number → tile index (chips are numbered 0..chip_count)
    pub by_chip: Vec<usize>,
    pub chip_count: usize,
}

/// An unknown chip type (the TypeScript throws an `Error` with this message).
#[derive(Clone, Debug, PartialEq)]
pub struct AssembleError(pub String);

impl fmt::Display for AssembleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AssembleError {}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

fn parse_color(raw: Option<&str>, env: Env) -> Option<f64> {
    let raw = raw.filter(|r| !r.is_empty())?;
    let s = crate::rc::expr::js_strip_spaces(raw);
    if let Some(h) = s.strip_prefix('#') {
        if (1..=6).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(crate::rc::expr::parse_hex(h));
        }
    }
    let v = eval_expr(&s, env);
    v.is_finite().then(|| js_max(0.0, js_min(0xffffff as f64, v.floor())))
}

/// An attribute's value, or `d` when absent.
pub fn attr(node: &ChipNode, name: &str, env: Env, d: f64) -> f64 {
    node.attrs.get(name).map_or(d, |raw| eval_expr(raw, env))
}

struct ChildPose {
    q: Quat,
    pos: Vec3,
    axis: Vec3,
    anchor: Vec3,
}

fn child_pose(spec: &TypeSpec, dir: Dir, angle_deg: f64) -> ChildPose {
    let d = dir_vec(dir);
    let hinge_axis = Vec3::cross(UP, d).normalize(); // lies in the plate, ⟂ dir
    let half = d.scale(TILE / 2.0);
    // Fold sign: a positive angle folds the child DOWN (FOLD_SIGN +1 on every edge; the assembled poses of 97
    // corpus models match the original's first frame, docs/measured.md difference hunt tier 2).
    match spec.joint {
        JointKind::Hinge | JointKind::Fixed => {
            let q = Quat::from_axis_angle(hinge_axis, fold_sign(dir) * angle_deg * DEG);
            ChildPose { q, pos: half.add(half.apply_quat(q)), axis: hinge_axis, anchor: half }
        }
        JointKind::Yaw => {
            let q = Quat::from_axis_angle(UP, JOINT_SIGN.rudder * angle_deg * DEG);
            ChildPose { q, pos: half.add(half.apply_quat(q)), axis: UP, anchor: half }
        }
        JointKind::Roll => {
            let q = Quat::from_axis_angle(d, JOINT_SIGN.trim * angle_deg * DEG);
            ChildPose { q, pos: d.scale(TILE), axis: d, anchor: half }
        }
        JointKind::Wheel => {
            // the rim folds about the shared edge like a chip (Wheel(angle=90) stands the disc up);
            // the rotor then spins about the rim's normal — set by the caller
            let q = Quat::from_axis_angle(hinge_axis, JOINT_SIGN.wheel * angle_deg * DEG);
            ChildPose { q, pos: half.add(half.apply_quat(q)), axis: hinge_axis, anchor: half }
        }
    }
}

struct Builder<'a> {
    env: Env<'a>,
    tiles: Vec<TileInstance>,
    by_chip: Vec<usize>,
    chip_index: usize,
}

impl Builder<'_> {
    fn visit(&mut self, node: &ChipNode, parent: Option<usize>) -> Result<usize, AssembleError> {
        let env = self.env;
        let type_key = node.type_.to_lowercase();
        let spec = type_spec(&type_key).ok_or_else(|| {
            AssembleError(format!(
                "未対応の部品「{}」です (line {})。ソースで部品名を確認してください。",
                node.type_, node.line
            ))
        })?;
        let option = attr(node, "option", env, 0.0);
        let id = self.tiles.len();
        let weight_factor = if type_key == "weight" {
            let o = if option == 0.0 || option.is_nan() { 1.0 } else { option }; // `option || 1`
            js_max(1.0, js_min(8.0, o))
        } else {
            1.0
        };
        let mut inst = TileInstance {
            id,
            chip_index: self.chip_index,
            type_: type_key,
            spec,
            attrs: node.attrs.clone(),
            line: node.line,
            parent,
            dir: node.dir,
            durability: None,
            name: node
                .attrs
                .get("name")
                .filter(|n| !n.is_empty())
                .map(|n| crate::rc::expr::js_strip_spaces(n).to_uppercase()),
            position: Vec3::default(),
            quaternion: Quat::IDENTITY,
            anchor: Vec3::default(),
            axis: Vec3::new(0.0, 0.0, 1.0),
            rim_axis: Vec3::new(0.0, 0.0, 1.0),
            rim_anchor: Vec3::default(),
            dir_axis: Vec3::new(0.0, 0.0, -1.0),
            local: None,
            color: parse_color(node.attrs.get("color"), env),
            color_expr: node.attrs.get("color").map(str::to_string),
            effect_expr: node.attrs.get("effect").map(str::to_string),
            ghost: spec.ghostable && option == 1.0,
            mass: spec.mass * weight_factor,
            option,
            children: Vec::new(),
            detached: false,
            powerless: false,
        };
        self.by_chip.push(id);
        if spec.wheel {
            self.chip_index += 1; // rim
            self.by_chip.push(id); // rotor (what `name` refers to)
            inst.chip_index = self.chip_index;
        }
        self.chip_index += 1;

        if let Some(p) = parent {
            let (pp, pq) = (self.tiles[p].position, self.tiles[p].quaternion);
            if let Some(dir) = node.dir {
                let angle = attr(node, "angle", env, 0.0);
                let ChildPose { q, pos, axis, anchor } = child_pose(spec, dir, angle);
                inst.quaternion = Quat::mul(pq, q);
                inst.position = pp.add(pos.apply_quat(pq));
                inst.anchor = pp.add(anchor.apply_quat(pq));
                inst.axis = axis.apply_quat(pq).normalize();
                if spec.wheel {
                    inst.rim_axis = inst.axis;
                    inst.rim_anchor = inst.anchor;
                    inst.axis = UP.apply_quat(inst.quaternion).normalize();
                    inst.anchor = inst.position;
                }
                inst.dir_axis = dir_vec(dir).apply_quat(pq);
                let inv = pq.invert();
                let to_local = |v: Vec3| v.sub(pp).apply_quat(inv);
                let to_local_dir = |v: Vec3| v.apply_quat(inv);
                inst.local = Some(LocalFrames {
                    anchor: to_local(inst.anchor),
                    axis: to_local_dir(inst.axis),
                    rim_anchor: to_local(inst.rim_anchor),
                    rim_axis: to_local_dir(inst.rim_axis),
                    dir_axis: to_local_dir(inst.dir_axis),
                });
            } else {
                inst.quaternion = pq;
                inst.position = pp.add(Vec3::new(0.0, TILE_T * 2.0, 0.0));
            }
            self.tiles[p].children.push(id);
        }
        self.tiles.push(inst);
        for c in &node.children {
            self.visit(c, Some(id))?;
        }
        Ok(id)
    }
}

/// Assemble the model's bodies at rest with the Val values `env` gives. `Ok(None)` when there is no Body.
pub fn assemble(model: &RcModel, env: Env) -> Result<Option<Assembly>, AssembleError> {
    if model.body().is_none() {
        return Ok(None);
    }
    let mut b = Builder { env, tiles: Vec::new(), by_chip: Vec::new(), chip_index: 0 };
    let mut roots = Vec::with_capacity(model.bodies.len());
    for body in &model.bodies {
        roots.push(b.visit(body, None)?);
    }
    Ok(Some(Assembly { tiles: b.tiles, roots, chip_count: b.chip_index, by_chip: b.by_chip }))
}

/// Recompute tile `i`'s world-frame joint anchors/axes from its parent's current pose.
pub fn refresh_joint_frames(tiles: &mut [TileInstance], i: usize) {
    let (Some(p), Some(l)) = (tiles[i].parent, tiles[i].local) else { return };
    let (pp, pq) = (tiles[p].position, tiles[p].quaternion);
    let t = &mut tiles[i];
    t.anchor = l.anchor.apply_quat(pq).add(pp);
    t.axis = l.axis.apply_quat(pq);
    t.rim_anchor = l.rim_anchor.apply_quat(pq).add(pp);
    t.rim_axis = l.rim_axis.apply_quat(pq);
    t.dir_axis = l.dir_axis.apply_quat(pq);
}

/// Lowest point of the assembly (model frame), used to drop it onto the ground.
pub fn assembly_bottom(a: &Assembly) -> f64 {
    let r = (TILE / 2.0).hypot(TILE / 2.0).hypot(TILE_T / 2.0);
    a.tiles.iter().fold(f64::INFINITY, |m, t| js_min(m, t.position.y - r))
}
