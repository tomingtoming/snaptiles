//! A few static obstacles around the spawn point so there is something to drive over and fly between (port of
//! `src/model/course.ts`). Shared by physics (colliders) and rendering (meshes).

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Block {
    /// center
    pub pos: [f64; 3],
    /// full extents
    pub size: [f64; 3],
    /// radians
    pub rot_y: Option<f64>,
    pub rot_x: Option<f64>,
    pub color: u32,
}

const DEG: f64 = std::f64::consts::PI / 180.0;

const fn block(pos: [f64; 3], size: [f64; 3], color: u32) -> Block {
    Block { pos, size, rot_y: None, rot_x: None, color }
}

pub const COURSE: [Block; 11] = [
    // a long ramp north of the spawn
    Block { rot_x: Some(10.0 * DEG), ..block([-16.0, 0.9, -70.0], [8.0, 0.4, 12.0], 0x8a949c) },
    // low kerbs to bump over
    block([-12.0, 0.15, -12.0], [6.0, 0.3, 0.6], 0xb0b8bf),
    block([-12.0, 0.15, -16.0], [6.0, 0.3, 0.6], 0xb0b8bf),
    block([-12.0, 0.15, -20.0], [6.0, 0.3, 0.6], 0xb0b8bf),
    // a gate of two pillars to fly or drive through
    block([18.0, 4.0, -25.0], [1.5, 8.0, 1.5], 0x7a8f9e),
    block([28.0, 4.0, -25.0], [1.5, 8.0, 1.5], 0x7a8f9e),
    block([23.0, 8.3, -25.0], [12.0, 0.6, 1.5], 0x7a8f9e),
    // a wall to shoot at
    block([0.0, 2.5, 40.0], [16.0, 5.0, 1.0], 0x9c8b7a),
    // stepping blocks
    block([-25.0, 0.5, 10.0], [4.0, 1.0, 4.0], 0xa0a8b0),
    block([-31.0, 1.0, 10.0], [4.0, 2.0, 4.0], 0xa0a8b0),
    block([-37.0, 1.5, 10.0], [4.0, 3.0, 4.0], 0xa0a8b0),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crate {
    pub pos: [f64; 3],
    pub size: f64,
    pub color: u32,
}

const fn cr(pos: [f64; 3], color: u32) -> Crate {
    Crate { pos, size: 1.0, color }
}

/// knockable crates (dynamic): a pyramid in front of the wall and a few on the field
pub const CRATES: [Crate; 12] = [
    cr([4.0, 0.5, 34.0], 0xd9a066),
    cr([6.0, 0.5, 34.0], 0xd9a066),
    cr([8.0, 0.5, 34.0], 0xd9a066),
    cr([5.0, 1.5, 34.0], 0xc98e5a),
    cr([7.0, 1.5, 34.0], 0xc98e5a),
    cr([6.0, 2.5, 34.0], 0xb97e4e),
    // (moved off the spawn's straight line: cars drive north at 60 km/h within seconds)
    cr([6.0, 0.5, -30.0], 0xd9a066),
    cr([6.0, 1.5, -30.0], 0xc98e5a),
    cr([6.0, 2.5, -30.0], 0xb97e4e),
    cr([12.0, 0.5, -8.0], 0xd9a066),
    cr([13.2, 0.5, -8.0], 0xd9a066),
    cr([12.6, 1.5, -8.0], 0xc98e5a),
];
