//! The per-frame state buffer the page reads straight out of module memory (`HEAPF64`), one flat `f64` array per
//! simulation, rewritten after every step and command. `src/sim/rust-simulation.ts` decodes it; keep both in step
//! (bump [`LAYOUT_VERSION`] when the layout changes). The slot names are the `layout!` lists below; `tests/bindings.rs`
//! generates the page's `src/sim/core-layout.ts` from them, so the decoder cannot drift from this file.
//!
//! ```text
//! header (HEADER = 20 slots)
//!   0  LAYOUT_VERSION
//!   1  tiles      number of tile records (= assembly tiles, in assembly order)
//!   2  balls      number of ball records
//!   3  crates     number of crate records
//!   4  shells     number of shell (projectile) records
//!   5  vals       number of Val values (declaration order, upper-case names de-duplicated as the TS `vals` Map)
//!   6  lines3d    number of floats in the 3D line list (9 per segment)
//!   7  lines2d    number of floats in the 2D line list (7 per segment)
//!   8  ticks      `_TICKS`
//!   9  zoom       `_ZOOM` field of view (degrees)
//!  10  wind x, 11 wind y, 12 wind z
//!  13  out generation   bumped whenever the `out()` rows change (fetch them with `core_out`)
//!  14  out rows         number of `out()` rows
//!  15  error generation bumped whenever the script error changes (fetch it with `core_error`)
//!  16  has error        1 when the model has a script error
//!  17  model generation bumped when the bodies are rebuilt (start, reset, a detach): body handles may change
//!  18  mid frame: 1 while the frame's script is suspended at a breakpoint or a line step (version 2)
//!  19  spare (0)
//! tiles, TILE_STRIDE = 17 each
//!   px py pz  qx qy qz qw     pose as `World::pose` (group body ∘ rest offset, rotor-turned)
//!   vx vy vz                  velocity of the tile's centre (`World::velocity`)
//!   bvx bvy bvz               linear velocity of the tile's rigid body (`body.linvel()`)
//!   spin spinAngle jetPower   wheels: kinematic spin (rad/s) and its angle; jets: last applied power
//!   body                      index of the tile's rigid body (identical for tiles welded into one group)
//! balls, BALL_STRIDE = 12 each: px py pz qx qy qz qw r g b radius fixed
//! crates, CRATE_STRIDE = 10 each: px py pz qx qy qz qw vx vy vz
//! shells, SHELL_STRIDE = 3 each: px py pz
//! vals: one value each
//! lines3d: x1 y1 z1 x2 y2 z2 r g b per segment
//! lines2d: x1 y1 x2 y2 r g b per segment
//! ```

use crate::physics::math::{from_rotation, from_vector};
use crate::Simulation;

pub const LAYOUT_VERSION: f64 = 2.0;

/// One record layout: a module of slot indices plus the names in order (its length is the stride). The page's
/// decoder reads the same indices from `src/sim/core-layout.ts`, which `tests/bindings.rs` generates from these.
macro_rules! layout {
    ($module:ident, $names:ident, $stride:ident: $($field:ident),+ $(,)?) => {
        #[allow(dead_code)]
        pub mod $module {
            layout!(@index 0usize; $($field),+);
        }
        pub const $names: &[&str] = &[$(stringify!($field)),+];
        pub const $stride: usize = $names.len();
    };
    (@index $n:expr; $field:ident $(, $rest:ident)*) => {
        pub const $field: usize = $n;
        layout!(@index $n + 1; $($rest),*);
    };
    (@index $n:expr;) => {};
}

layout!(header, HEADER_FIELDS, HEADER:
    VERSION, TILES, BALLS, CRATES, SHELLS, VALS, LINES3D, LINES2D, TICKS, ZOOM, WIND_X, WIND_Y, WIND_Z,
    OUT_GENERATION, OUT_ROWS, ERROR_GENERATION, HAS_ERROR, MODEL_GENERATION, MID_FRAME, SPARE_19);
layout!(tile, TILE_FIELDS, TILE_STRIDE:
    PX, PY, PZ, QX, QY, QZ, QW, VX, VY, VZ, BVX, BVY, BVZ, SPIN, SPIN_ANGLE, JET_POWER, BODY);
layout!(ball, BALL_FIELDS, BALL_STRIDE: PX, PY, PZ, QX, QY, QZ, QW, R, G, B, RADIUS, FIXED);
layout!(krate, CRATE_FIELDS, CRATE_STRIDE: PX, PY, PZ, QX, QY, QZ, QW, VX, VY, VZ);
layout!(shell, SHELL_FIELDS, SHELL_STRIDE: PX, PY, PZ);

/// generations the header carries (kept by the caller between writes)
#[derive(Default, Clone, Debug)]
pub struct Generations {
    pub out: u64,
    pub error: u64,
    pub model: u64,
}

/// Rewrite `buf` from `sim`.
pub fn write_state(sim: &Simulation, gens: &Generations, buf: &mut Vec<f64>) {
    buf.clear();
    let s = sim.state();
    let w = &s.world;
    let n_vals = s.vars.vals.len();
    buf.resize(HEADER, 0.0);
    buf[header::VERSION] = LAYOUT_VERSION;
    buf[header::TILES] = w.tiles.len() as f64;
    buf[header::BALLS] = w.balls.len() as f64;
    buf[header::CRATES] = w.crates.len() as f64;
    buf[header::SHELLS] = w.projectiles.len() as f64;
    buf[header::VALS] = n_vals as f64;
    buf[header::LINES3D] = s.lines3d.len() as f64;
    buf[header::LINES2D] = s.lines2d.len() as f64;
    buf[header::TICKS] = s.ticks;
    buf[header::ZOOM] = s.zoom_fov;
    buf[header::WIND_X] = w.wind.x;
    buf[header::WIND_Y] = w.wind.y;
    buf[header::WIND_Z] = w.wind.z;
    buf[header::OUT_GENERATION] = gens.out as f64;
    buf[header::OUT_ROWS] = sim.out.len() as f64;
    buf[header::ERROR_GENERATION] = gens.error as f64;
    buf[header::HAS_ERROR] = if sim.script_error.is_some() { 1.0 } else { 0.0 };
    buf[header::MODEL_GENERATION] = gens.model as f64;
    buf[header::MID_FRAME] = if sim.mid_frame() { 1.0 } else { 0.0 };
    buf.reserve(w.tiles.len() * TILE_STRIDE + w.balls.len() * BALL_STRIDE + w.crates.len() * CRATE_STRIDE + w.projectiles.len() * SHELL_STRIDE + n_vals + s.lines3d.len() + s.lines2d.len());
    for (i, tb) in w.tiles.iter().enumerate() {
        let p = w.pose(i);
        let v = w.velocity(i, &p);
        let b = &w.world.bodies[tb.body];
        let bv = from_vector(b.linvel());
        let (q, pos) = (p.quaternion, p.position);
        let rec: [f64; TILE_STRIDE] = [pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, bv.x, bv.y, bv.z, tb.spin, tb.spin_angle, tb.jet_power, tb.body.into_raw_parts().0 as f64];
        buf.extend_from_slice(&rec);
    }
    for ball in &w.balls {
        let b = &w.world.bodies[ball.body];
        let t = from_vector(b.translation());
        let q = from_rotation(*b.rotation());
        let rec: [f64; BALL_STRIDE] = [t.x, t.y, t.z, q.x, q.y, q.z, q.w, ball.color[0], ball.color[1], ball.color[2], ball.radius, if ball.fixed { 1.0 } else { 0.0 }];
        buf.extend_from_slice(&rec);
    }
    for &h in &w.crates {
        let b = &w.world.bodies[h];
        let t = from_vector(b.translation());
        let q = from_rotation(*b.rotation());
        let v = from_vector(b.linvel());
        let rec: [f64; CRATE_STRIDE] = [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z];
        buf.extend_from_slice(&rec);
    }
    for p in &w.projectiles {
        let t = from_vector(w.world.bodies[p.body].translation());
        let rec: [f64; SHELL_STRIDE] = [t.x, t.y, t.z];
        buf.extend_from_slice(&rec);
    }
    buf.extend(s.vars.vals.iter().map(|v| v.value));
    buf.extend_from_slice(&s.lines3d);
    buf.extend_from_slice(&s.lines2d);
}
