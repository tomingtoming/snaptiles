//! The per-frame state buffer the page reads straight out of module memory (`HEAPF64`), one flat `f64` array per
//! simulation, rewritten after every step and command. `src/sim/rust-simulation.ts` decodes it; keep both in step
//! (bump [`LAYOUT_VERSION`] when the layout changes).
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
//!  18, 19 spare (0)
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

pub const LAYOUT_VERSION: f64 = 1.0;
pub const HEADER: usize = 20;
pub const TILE_STRIDE: usize = 17;
pub const BALL_STRIDE: usize = 12;
pub const CRATE_STRIDE: usize = 10;
pub const SHELL_STRIDE: usize = 3;

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
    buf[0] = LAYOUT_VERSION;
    buf[1] = w.tiles.len() as f64;
    buf[2] = w.balls.len() as f64;
    buf[3] = w.crates.len() as f64;
    buf[4] = w.projectiles.len() as f64;
    buf[5] = n_vals as f64;
    buf[6] = s.lines3d.len() as f64;
    buf[7] = s.lines2d.len() as f64;
    buf[8] = s.ticks;
    buf[9] = s.zoom_fov;
    buf[10] = w.wind.x;
    buf[11] = w.wind.y;
    buf[12] = w.wind.z;
    buf[13] = gens.out as f64;
    buf[14] = sim.out.len() as f64;
    buf[15] = gens.error as f64;
    buf[16] = if sim.script_error.is_some() { 1.0 } else { 0.0 };
    buf[17] = gens.model as f64;
    buf.reserve(w.tiles.len() * TILE_STRIDE + w.balls.len() * BALL_STRIDE + w.crates.len() * CRATE_STRIDE + w.projectiles.len() * SHELL_STRIDE + n_vals + s.lines3d.len() + s.lines2d.len());
    for (i, tb) in w.tiles.iter().enumerate() {
        let p = w.pose(i);
        let v = w.velocity(i, &p);
        let b = &w.world.bodies[tb.body];
        let bv = from_vector(b.linvel());
        let (q, pos) = (p.quaternion, p.position);
        buf.extend_from_slice(&[pos.x, pos.y, pos.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, bv.x, bv.y, bv.z, tb.spin, tb.spin_angle, tb.jet_power, tb.body.into_raw_parts().0 as f64]);
    }
    for ball in &w.balls {
        let b = &w.world.bodies[ball.body];
        let t = from_vector(b.translation());
        let q = from_rotation(*b.rotation());
        buf.extend_from_slice(&[t.x, t.y, t.z, q.x, q.y, q.z, q.w, ball.color[0], ball.color[1], ball.color[2], ball.radius, if ball.fixed { 1.0 } else { 0.0 }]);
    }
    for &h in &w.crates {
        let b = &w.world.bodies[h];
        let t = from_vector(b.translation());
        let q = from_rotation(*b.rotation());
        let v = from_vector(b.linvel());
        buf.extend_from_slice(&[t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z]);
    }
    for p in &w.projectiles {
        let t = from_vector(w.world.bodies[p.body].translation());
        buf.extend_from_slice(&[t.x, t.y, t.z]);
    }
    buf.extend(s.vars.vals.iter().map(|v| v.value));
    buf.extend_from_slice(&s.lines3d);
    buf.extend_from_slice(&s.lines2d);
}
