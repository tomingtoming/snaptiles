//! The script API shared by Lua and the legacy Script (the object `Simulation.api()` returns in
//! `src/sim/simulation.ts`), with the TypeScript's sign conventions inlined (`TUNE_DEFAULTS`).
//!
//! Arguments arrive as the JavaScript values wasmoon makes of Lua values ([`Arg`]) and are coerced the way the
//! TypeScript coerces them (`Math.floor(n)`, `String(name)`, `!!v`, `x || 0`); a missing argument is `undefined`.
//!
//! Sign conventions (`Tune` / `TUNE_DEFAULTS`, measured against the original 1.5B26, 2026-10-27, tools/orig-compare.ts
//! vs the harness runs): a chip folded 30° down on N reads _EX +0.52, on E _EZ +0.52; a Rudder(30) on S reads
//! _EY +0.52; _AX/_AY/_AZ = (−_EX, _EY, −_EZ); _WY of a wheel is its spin about its own normal (local frame) and the
//! yaw rate has the sign of d_EY/dt. _WZ −1 keeps the jet-balanced corpus bike upright, _WX +1 lets the corpus segway
//! (E = −(_AX + _WX·4 …)) balance. Defaults: ex −1, ey −1, ez −1, ax +1, ay −1, az +1, wx +1, wy −1, wz −1, local ω.

use super::simulation::SimState;
use crate::js;
use crate::model::{dir_code, Quat, Vec3};
use crate::physics::math::{euler_yxz, from_vector, js_max, js_min};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::sync::OnceLock;

/// A script argument as JavaScript sees it.
#[derive(Clone, Debug, PartialEq)]
pub enum Arg {
    /// `undefined` (Lua nil, or a missing argument)
    Nil,
    Bool(bool),
    Num(f64),
    Str(String),
    /// tables, functions, userdata (an object to JavaScript)
    Other,
}

impl Arg {
    /// `Number(v)`
    pub fn num(&self) -> f64 {
        match self {
            Arg::Nil | Arg::Other => f64::NAN,
            Arg::Bool(b) => f64::from(u8::from(*b)),
            Arg::Num(x) => *x,
            Arg::Str(s) => crate::rc::expr::js_number(s),
        }
    }
    /// `String(v)`
    pub fn text(&self) -> String {
        match self {
            Arg::Nil => "undefined".into(),
            Arg::Bool(b) => b.to_string(),
            Arg::Num(x) => js::number_to_string(*x),
            Arg::Str(s) => s.clone(),
            Arg::Other => "[object Object]".into(),
        }
    }
    /// `!!v`
    pub fn truthy(&self) -> bool {
        match self {
            Arg::Nil => false,
            Arg::Bool(b) => *b,
            Arg::Num(x) => *x != 0.0 && !x.is_nan(),
            Arg::Str(s) => !s.is_empty(),
            Arg::Other => true,
        }
    }
}

/// A script API result.
#[derive(Clone, Debug, PartialEq)]
pub enum Ret {
    Num(f64),
    Str(String),
}

impl Ret {
    pub fn num(&self) -> f64 {
        match self {
            Ret::Num(x) => *x,
            Ret::Str(_) => 0.0,
        }
    }
}

pub type ApiFn = fn(&mut SimState, &[Arg]) -> Ret;

const NIL: Arg = Arg::Nil;
fn arg(a: &[Arg], i: usize) -> &Arg {
    a.get(i).unwrap_or(&NIL)
}
fn n(a: &[Arg], i: usize) -> f64 {
    arg(a, i).num()
}
fn num(x: f64) -> Ret {
    Ret::Num(x)
}
fn b(x: bool) -> Ret {
    Ret::Num(if x { 1.0 } else { 0.0 })
}

const LEFT: Vec3 = Vec3::new(-1.0, 0.0, 0.0);
const BACK: Vec3 = Vec3::new(0.0, 0.0, 1.0);
const UP: Vec3 = Vec3::new(0.0, 1.0, 0.0);
// Tune signs (see the module doc)
const T_EX: f64 = -1.0;
const T_EY: f64 = -1.0;
const T_EZ: f64 = -1.0;
const T_AX: f64 = 1.0;
const T_AY: f64 = -1.0;
const T_AZ: f64 = 1.0;
const T_W: [f64; 3] = [1.0, -1.0, -1.0];

fn dot(a: Vec3, b: Vec3) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
fn comp(v: Vec3, c: usize) -> f64 {
    [v.x, v.y, v.z][c]
}

impl SimState {
    /// tile of chip `Math.floor(n)` (`assembly.byChip.get`)
    pub fn tile_of(&self, a: &Arg) -> Option<usize> {
        let asm = self.world.assembly()?;
        let f = a.num().floor();
        if !(f >= 0.0) || f >= asm.by_chip.len() as f64 {
            return None;
        }
        let t = asm.by_chip[f as usize];
        (t < self.world.tiles.len()).then_some(t)
    }
    /// world pose of chip n (tiles welded into a group still report their own pose)
    pub fn pose_of(&self, a: &Arg) -> Option<crate::physics::TilePose> {
        self.tile_of(a).map(|t| self.world.pose(t))
    }
    fn pos(&self, a: &Arg, c: usize) -> f64 {
        self.pose_of(a).map_or(0.0, |p| comp(p.position, c))
    }
    fn local_vel(&self, a: &Arg, axis: Vec3) -> f64 {
        let Some(t) = self.tile_of(a) else { return 0.0 };
        let pose = self.world.pose(t);
        let v = self.world.velocity(t, &pose);
        dot(v, axis.apply_quat(pose.quaternion))
    }
    fn world_axis(&self, a: &Arg, local: Vec3, c: usize) -> f64 {
        self.pose_of(a).map_or(0.0, |p| comp(local.apply_quat(p.quaternion), c))
    }
    fn euler(&self, a: &Arg) -> [f64; 3] {
        self.pose_of(a).map_or([0.0; 3], |p| euler_yxz(p.quaternion))
    }
    /// Measured on 1.5B26: mirroring x coordinates negates quaternion y/z.
    fn quat(&self, a: &Arg, c: usize) -> f64 {
        let v = self.pose_of(a).map_or(if c == 3 { 1.0 } else { 0.0 }, |p| p.quaternion.to_array()[c]);
        if c == 1 || c == 2 {
            -v
        } else {
            v
        }
    }
    fn angvel(&self, a: &Arg, c: usize) -> f64 {
        let Some(t) = self.tile_of(a) else { return 0.0 };
        let tb = &self.world.tiles[t];
        if self.world.assembly().unwrap().tiles[t].spec.wheel {
            return if c == 1 { tb.spin } else { 0.0 }; // kinematic spin, as in the original
        }
        let w = from_vector(self.world.world.bodies[tb.body].angvel());
        let pose = self.world.pose(t);
        comp(w.apply_quat(pose.quaternion.invert()), c) * T_W[c]
    }
    fn attr_of(&self, a: &Arg, name: &str, d: f64) -> f64 {
        let Some(t) = self.tile_of(a) else { return 0.0 };
        let tile = &self.world.assembly().unwrap().tiles[t];
        if name == "angle" && tile.type_ == "core" {
            return -1.0;
        }
        match tile.attrs.get(name) {
            None => d,
            Some(raw) => {
                let vars = &self.vars;
                crate::rc::eval_expr(raw, &|n: &str| vars.get(n))
            }
        }
    }
    fn mass_of(&self, a: &Arg) -> f64 {
        self.tile_of(a).map_or(0.0, |t| self.world.assembly().unwrap().tiles[t].mass)
    }
    fn linvel_of(&self, a: &Arg) -> Vec3 {
        self.tile_of(a).map_or(Vec3::default(), |t| from_vector(self.world.world.bodies[self.world.tiles[t].body].linvel()))
    }
    pub(crate) fn h(&self, a: &Arg) -> f64 {
        let Some(t) = self.tile_of(a) else { return -100000.0 };
        let p = self.world.pose(t).position;
        // only ground-like things count (collision filter: membership 1, hits group 2), never the model itself
        self.world.cast_ray_ground(p, Vec3::new(0.0, -1.0, 0.0), 10.0, Some(self.world.tiles[t].body)).unwrap_or(-100000.0)
    }
    /// relative euler angles of chip a as seen from chip b
    fn rel_euler(&self, a: &Arg, b: &Arg) -> [f64; 3] {
        match (self.pose_of(a), self.pose_of(b)) {
            (Some(pa), Some(pb)) => euler_yxz(Quat::mul(pb.quaternion.invert(), pa.quaternion)),
            _ => [0.0; 3],
        }
    }
    fn top(&self, a: &Arg) -> f64 {
        let Some(mut t) = self.tile_of(a) else { return -1.0 };
        let tiles = &self.world.assembly().unwrap().tiles;
        while let (Some(p), false) = (tiles[t].parent, tiles[t].detached) {
            t = p;
        }
        tiles[t].chip_index as f64
    }
    fn detach(&mut self, a: &Arg, powerless: bool) {
        if let Some(t) = self.tile_of(a) {
            let SimState { world, vars, .. } = self;
            world.detach(t, powerless, &|n: &str| vars.get(n));
        }
    }
    fn ball_index(&self, a: &Arg) -> Option<usize> {
        let i = a.num();
        (i.fract() == 0.0 && i >= 0.0 && (i as usize) < self.world.balls.len()).then_some(i as usize)
    }
    /// the mass still attached to the core (measured 2026-11-01, harness_weight.rcs: 176.4 → 50.4 kg after _SPLIT
    /// cuts a Chip+Weight off — while _CHIPS keeps counting the split chips; boidbit hovers its body on _WEIGHT)
    pub fn weight(&self) -> f64 {
        let Some(asm) = self.world.assembly() else { return 0.0 };
        asm.tiles.iter().fold(0.0, |s, t| {
            let mut u = t;
            while let (Some(p), false) = (u.parent, u.detached) {
                u = &asm.tiles[p];
            }
            if u.detached {
                s
            } else {
                s + t.mass
            }
        })
    }
    fn chips(&self) -> f64 {
        self.world.assembly().map_or(0.0, |a| a.chip_count as f64)
    }
}

/// every API function by name
pub fn api() -> &'static [(&'static str, ApiFn)] {
    static TABLE: OnceLock<Vec<(&'static str, ApiFn)>> = OnceLock::new();
    TABLE.get_or_init(build)
}

/// one API function by its (upper-case) name
pub fn lookup(name: &str) -> Option<ApiFn> {
    static MAP: OnceLock<HashMap<&'static str, ApiFn>> = OnceLock::new();
    MAP.get_or_init(|| api().iter().copied().collect()).get(name).copied()
}

fn build() -> Vec<(&'static str, ApiFn)> {
    let mut t: Vec<(&'static str, ApiFn)> = Vec::with_capacity(128);
    macro_rules! f {
        ($name:literal, |$s:ident, $a:ident| $body:expr) => {{
            #[allow(unused_variables)]
            fn g($s: &mut SimState, $a: &[Arg]) -> Ret {
                $body
            }
            t.push(($name, g as ApiFn));
        }};
    }
    // keys, input, timing
    f!("_KEY", |s, a| b(crate::sim::keys::key_bit(n(a, 0)).is_some_and(|k| s.keys_now & k != 0)));
    f!("_KEYDOWN", |s, a| b(crate::sim::keys::key_bit(n(a, 0)).is_some_and(|k| s.keys_now & k != 0 && s.keys_prev & k == 0)));
    f!("_KEYUP", |s, a| b(crate::sim::keys::key_bit(n(a, 0)).is_some_and(|k| s.keys_now & k == 0 && s.keys_prev & k != 0)));
    // gamepad axis, +-1000 (the original's range is not measured)
    f!("_ANALOG", |s, a| {
        let i = n(a, 0);
        num(if i.fract() == 0.0 && i >= 0.0 && (i as usize) < s.axes.len() { s.axes[i as usize] * 1000.0 } else { 0.0 })
    });
    f!("_MX", |s, a| num(s.mouse.x));
    f!("_MY", |s, a| num(s.mouse.y));
    f!("_ML", |s, a| num(s.mouse.l));
    f!("_MR", |s, a| num(s.mouse.r));
    f!("_MM", |s, a| num(s.mouse.m));
    f!("_WIDTH", |s, a| num(s.width));
    f!("_HEIGHT", |s, a| num(s.height));
    f!("_FPS", |s, a| num(super::FRAME_RATE));
    f!("_BASE", |s, a| num(30.0));
    f!("_DT", |s, a| num(1.0 / super::FRAME_RATE));
    f!("_TICKS", |s, a| num(s.ticks));
    f!("_SETTICKS", |s, a| {
        s.ticks = n(a, 0).floor();
        num(0.0)
    });
    // model
    f!("_CHIPS", |s, a| num(s.chips()));
    f!("_WEIGHT", |s, a| num(s.weight()));
    f!("_M", |s, a| num(s.mass_of(arg(a, 0))));
    f!("_FUEL", |s, a| num(s.world.fuel_total()));
    f!("_FUELMAX", |s, a| num(s.world.fuel_max_total()));
    // scenario-style attribute access (the subset models use): FUEL/FUELMAX per chip, geometry and regulation
    f!("_GET", |s, a| {
        let Some(t) = s.tile_of(arg(a, 0)) else { return num(0.0) };
        let key = arg(a, 1).text().to_uppercase();
        let tile = &s.world.assembly().unwrap().tiles[t];
        let asm = s.world.assembly().unwrap();
        num(match key.as_str() {
            "FUEL" => s.world.fuel.get(&t).copied().unwrap_or(0.0),
            "FUELMAX" => s.world.fuel_max.get(&t).copied().unwrap_or(0.0),
            "PARENT" => if tile.detached { -1.0 } else { tile.parent.map_or(-1.0, |p| asm.tiles[p].chip_index as f64) },
            "TOP" => {
                let mut r = t;
                while let (Some(p), false) = (asm.tiles[r].parent, asm.tiles[r].detached) {
                    r = p;
                }
                asm.tiles[r].chip_index as f64
            }
            "DIR" => tile.dir.map_or(0.0, |d| dir_code(d) as f64),
            "OPTION" => tile.option,
            _ => s.attr_of(arg(a, 0), &key.to_lowercase(), 0.0),
        })
    });
    f!("_SET", |s, a| {
        let Some(t) = s.tile_of(arg(a, 0)) else { return num(0.0) };
        let key = arg(a, 1).text().to_uppercase();
        let v = n(a, 2);
        if key == "FUEL" {
            let cap = s.world.fuel_max.get(&t).copied().unwrap_or(0.0);
            s.world.fuel.insert(t, js_max(0.0, js_min(cap, v)));
        } else if key == "FUELMAX" {
            s.world.fuel_max.insert(t, js_max(0.0, v));
        }
        num(0.0)
    });
    f!("_SETWIND", |s, a| {
        let c = |i: usize| if arg(a, i).truthy() { n(a, i) } else { 0.0 };
        s.world.wind = Vec3::new(c(0), c(1), c(2));
        num(0.0)
    });
    f!("_GETWIND", |s, a| num(s.world.wind.x)); // Lua multi-return is not modelled; x only
    f!("_ADDBALL", |s, a| {
        let v = [n(a, 0), n(a, 1), n(a, 2), n(a, 3), n(a, 4)];
        // rapier panics on non-finite shapes; the TypeScript would add a broken ball
        if v.iter().any(|x| !x.is_finite()) {
            return num(-1.0);
        }
        num(s.world.add_ball(v[0], v[1], v[2], v[3], v[4]) as f64)
    });
    f!("_SETOBJFIX", |s, a| {
        if let Some(i) = s.ball_index(arg(a, 0)) {
            s.world.set_ball_fixed(i, arg(a, 1).truthy());
        }
        num(0.0)
    });
    f!("_SETOBJCOLOR", |s, a| {
        if let Some(i) = s.ball_index(arg(a, 0)) {
            s.world.balls[i].color = [n(a, 1), n(a, 2), n(a, 3)];
        }
        num(0.0)
    });
    f!("_SETREG", |s, a| {
        s.world.regulations.insert(arg(a, 0).text().to_uppercase(), if arg(a, 1).truthy() { 1.0 } else { 0.0 });
        num(0.0)
    });
    f!("_GETREG", |s, a| num(s.world.regulations.get(&arg(a, 0).text().to_uppercase()).copied().unwrap_or(0.0)));
    f!("_E", |s, a| num(s.tile_of(arg(a, 0)).map_or(0.0, |t| s.world.arm_charge.get(&t).copied().unwrap_or(0.0))));
    f!("_T", |s, a| num(s.tile_of(arg(a, 0)).map_or(-1.0, |t| s.world.assembly().unwrap().tiles[t].durability.unwrap_or(10000.0))));
    // pose: the original is left-handed: W = +x (rest geometry of Basic measured)
    f!("_X", |s, a| num(-s.pos(arg(a, 0), 0)));
    f!("_Y", |s, a| num(s.pos(arg(a, 0), 1)));
    f!("_Z", |s, a| num(s.pos(arg(a, 0), 2)));
    f!("_H", |s, a| num(s.h(arg(a, 0))));
    // W-positive, S-positive like the original (turn and straight runs)
    f!("_VX", |s, a| num(s.local_vel(arg(a, 0), LEFT)));
    f!("_VY", |s, a| num(s.local_vel(arg(a, 0), UP)));
    f!("_VZ", |s, a| num(s.local_vel(arg(a, 0), BACK)));
    f!("_VEL", |s, a| {
        let Some(t) = s.tile_of(arg(a, 0)) else { return num(0.0) };
        let pose = s.world.pose(t);
        num(s.world.velocity(t, &pose).length())
    });
    f!("_WX", |s, a| num(s.angvel(arg(a, 0), 0)));
    f!("_WY", |s, a| num(s.angvel(arg(a, 0), 1)));
    f!("_WZ", |s, a| num(s.angvel(arg(a, 0), 2)));
    f!("_FX", |s, a| num(s.linvel_of(arg(a, 0)).x * s.mass_of(arg(a, 0))));
    f!("_FY", |s, a| num(s.linvel_of(arg(a, 0)).y * s.mass_of(arg(a, 0))));
    f!("_FZ", |s, a| num(s.linvel_of(arg(a, 0)).z * s.mass_of(arg(a, 0))));
    f!("_EX", |s, a| num(T_EX * s.euler(arg(a, 0))[0]));
    f!("_EY", |s, a| num(T_EY * s.euler(arg(a, 0))[1]));
    f!("_EZ", |s, a| num(T_EZ * s.euler(arg(a, 0))[2]));
    f!("_AX", |s, a| num(T_AX * s.euler(arg(a, 0))[0]));
    f!("_AY", |s, a| num(T_AY * s.euler(arg(a, 0))[1]));
    // measured 2026-11-01 (rc_models38.sh): the A* are tilts of the chip's own axes, not Euler angles — an upside-down
    // chip reads _AZ ≈ 0 (its Euler roll is ±π), one turned over about its forward axis reads the roll negated.
    // _AX = asin(−Lz·up) is already the Euler pitch; the roll becomes asin(Lx·up) (tp-2 steers by its flipped body chip)
    f!("_AZ", |s, a| {
        let Some(p) = s.pose_of(arg(a, 0)) else { return num(0.0) };
        let lx = Vec3::new(1.0, 0.0, 0.0).apply_quat(p.quaternion);
        num(T_AZ * lx.y.clamp(-1.0, 1.0).asin())
    });
    // axis vectors in the original's left-handed frame (local x = W, local z = S, world x mirrored); the mirror is
    // measured for _X/_VX/_VZ, these follow by construction and are not measured themselves
    f!("_XX", |s, a| num(-s.world_axis(arg(a, 0), LEFT, 0)));
    f!("_XY", |s, a| num(s.world_axis(arg(a, 0), LEFT, 1)));
    f!("_XZ", |s, a| num(s.world_axis(arg(a, 0), LEFT, 2)));
    f!("_YX", |s, a| num(-s.world_axis(arg(a, 0), UP, 0)));
    f!("_YY", |s, a| num(s.world_axis(arg(a, 0), UP, 1)));
    f!("_YZ", |s, a| num(s.world_axis(arg(a, 0), UP, 2)));
    f!("_ZX", |s, a| num(-s.world_axis(arg(a, 0), BACK, 0)));
    f!("_ZY", |s, a| num(s.world_axis(arg(a, 0), BACK, 1)));
    f!("_ZZ", |s, a| num(s.world_axis(arg(a, 0), BACK, 2)));
    f!("_QX", |s, a| num(s.quat(arg(a, 0), 0)));
    f!("_QY", |s, a| num(s.quat(arg(a, 0), 1)));
    f!("_QZ", |s, a| num(s.quat(arg(a, 0), 2)));
    f!("_QW", |s, a| num(s.quat(arg(a, 0), 3)));
    f!("_GX", |s, a| num(-s.pos(arg(a, 0), 0)));
    f!("_GY", |s, a| num(s.pos(arg(a, 0), 1)));
    f!("_GZ", |s, a| num(s.pos(arg(a, 0), 2)));
    // a Wheel takes two numbers: the first (hub) reads type 3, the second (the tyre) 4/5 — measured on the original
    f!("_TYPE", |s, a| {
        let Some(t) = s.tile_of(arg(a, 0)) else { return num(-1.0) };
        let tile = &s.world.assembly().unwrap().tiles[t];
        num(if tile.spec.wheel && n(a, 0).floor() == tile.chip_index as f64 - 1.0 { 3.0 } else { tile.spec.code as f64 })
    });
    f!("_DIR", |s, a| num(s.tile_of(arg(a, 0)).and_then(|t| s.world.assembly().unwrap().tiles[t].dir).map_or(0.0, |d| dir_code(d) as f64)));
    f!("_PARENT", |s, a| {
        let asm = s.world.assembly();
        num(s.tile_of(arg(a, 0)).and_then(|t| { let tile = &asm.unwrap().tiles[t]; if tile.detached { None } else { tile.parent } }).map_or(-1.0, |p| asm.unwrap().tiles[p].chip_index as f64))
    });
    f!("_TOP", |s, a| num(s.top(arg(a, 0))));
    f!("_BYE", |s, a| {
        s.detach(arg(a, 0), true);
        num(0.0)
    });
    f!("_SPLIT", |s, a| {
        s.detach(arg(a, 0), false);
        num(0.0)
    });
    f!("_ANGLE", |s, a| num(s.attr_of(arg(a, 0), "angle", 0.0)));
    f!("_POWER", |s, a| num(s.attr_of(arg(a, 0), "power", 0.0)));
    f!("_SPRING", |s, a| num(s.attr_of(arg(a, 0), "spring", 1.0)));
    f!("_DAMPER", |s, a| num(s.attr_of(arg(a, 0), "damper", 0.5)));
    f!("_BRAKE", |s, a| num(s.attr_of(arg(a, 0), "brake", 0.0)));
    f!("_COLOR", |s, a| num(s.tile_of(arg(a, 0)).map_or(16777215.0, |t| s.world.assembly().unwrap().tiles[t].color.unwrap_or(16777215.0))));
    f!("_OPTION", |s, a| num(s.tile_of(arg(a, 0)).map_or(0.0, |t| s.world.assembly().unwrap().tiles[t].option)));
    f!("_EFFECT", |s, a| num(0.0));
    f!("_USER1", |s, a| num(s.attr_of(arg(a, 0), "user1", 0.0)));
    f!("_USER2", |s, a| num(s.attr_of(arg(a, 0), "user2", 0.0)));
    f!("_FACE", |s, a| num(0.0));
    f!("_ZOOM", |s, a| {
        if n(a, 0) > 0.0 {
            s.zoom_fov = n(a, 0);
        }
        num(s.zoom_fov)
    });
    f!("_PLAYERS", |s, a| num(1.0));
    f!("_PLAYERMYID", |s, a| num(0.0));
    f!("_PLAYERHOSTID", |s, a| num(0.0));
    f!("_TODEG", |s, a| num((n(a, 0) * 180.0) / PI));
    f!("_TORAD", |s, a| num((n(a, 0) * PI) / 180.0));
    f!("_RND", |s, a| num(crate::sim::random()));
    f!("_RX", |s, a| num(-s.rel_euler(arg(a, 0), arg(a, 1))[0]));
    f!("_RY", |s, a| num(-s.rel_euler(arg(a, 0), arg(a, 1))[1]));
    f!("_RZ", |s, a| num(-s.rel_euler(arg(a, 0), arg(a, 1))[2]));
    // drawing
    f!("_SETCOLOR", |s, a| {
        let c = js::to_int32(js_max(0.0, n(a, 0).floor())) & 0xffffff;
        s.pen_color = [((c >> 16) & 255) as f64 / 255.0, ((c >> 8) & 255) as f64 / 255.0, (c & 255) as f64 / 255.0];
        num(0.0)
    });
    f!("_MOVE3D", |s, a| {
        s.pen3 = [n(a, 0), n(a, 1), n(a, 2)];
        num(0.0)
    });
    f!("_LINE3D", |s, a| {
        let p = [n(a, 0), n(a, 1), n(a, 2)];
        let (pen, c) = (s.pen3, s.pen_color);
        s.lines3d.extend_from_slice(&[pen[0], pen[1], pen[2], p[0], p[1], p[2], c[0], c[1], c[2]]);
        s.pen3 = p;
        num(0.0)
    });
    f!("_MOVE2D", |s, a| {
        s.pen2 = [n(a, 0), n(a, 1)];
        num(0.0)
    });
    f!("_LINE2D", |s, a| {
        let p = [n(a, 0), n(a, 1)];
        let (pen, c) = (s.pen2, s.pen_color);
        s.lines2d.extend_from_slice(&[pen[0], pen[1], p[0], p[1], c[0], c[1], c[2]]);
        s.pen2 = p;
        num(0.0)
    });
    // not simulated: network players, CCD camera, objects
    f!("_PLAYERID", |s, a| num(0.0));
    f!("_PLAYERCHIPS", |s, a| num(s.chips()));
    f!("_PLAYERARMS", |s, a| num(0.0));
    f!("_PLAYERCOLOR", |s, a| num(16777215.0));
    f!("_PLAYERCRUSHES", |s, a| num(0.0));
    f!("_PLAYERRESETS", |s, a| num(0.0));
    f!("_PLAYERINITS", |s, a| num(0.0));
    f!("_PLAYERYFORCES", |s, a| num(0.0));
    f!("_PLAYERX", |s, a| num(0.0));
    f!("_PLAYERY", |s, a| num(0.0));
    f!("_PLAYERZ", |s, a| num(0.0));
    f!("_PLAYERNAME", |s, a| Ret::Str(String::new()));
    f!("_PLAYERNAME2", |s, a| num(0.0));
    f!("_CCD", |s, a| num(0.0));
    f!("_RED", |s, a| num(0.0));
    f!("_GREEN", |s, a| num(0.0));
    f!("_BLUE", |s, a| num(0.0));
    f!("_MOBJ", |s, a| num(0.0));
    f!("_IOBJ", |s, a| num(0.0));
    f!("_OX", |s, a| num(0.0));
    f!("_OY", |s, a| num(-1000000.0));
    f!("_OZ", |s, a| num(0.0));
    f!("_I", |s, a| num(0.0));
    f!("_LX", |s, a| num(0.0));
    f!("_LY", |s, a| num(0.0));
    f!("_LZ", |s, a| num(0.0));
    f!("_HAT", |s, a| num(0.0));
    t
}
