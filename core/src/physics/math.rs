//! The three.js operations `src/physics/*` uses, in f64 with three.js's formulas and operation order, on top of the
//! model's `Vec3`/`Quat`, plus the conversions to and from Rapier's f32 types (the JavaScript bindings round f64 to
//! f32 the same way).

use crate::model::{Quat, Vec3};
use rapier3d::math::{Rotation, Vector};

/// `Math.sign` (0 for ±0, NaN for NaN); `f64::signum` gives ±1 for ±0
pub fn js_sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// `Math.max(a, b)` / `Math.min(a, b)` (NaN wins)
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}
/// `Math.max(lo, Math.min(hi, x))`
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    js_max(lo, js_min(hi, x))
}

pub trait V3 {
    fn dot(self, v: Vec3) -> f64;
    fn length_sq(self) -> f64;
    /// `this.add(v.clone().multiplyScalar(s))`
    fn add_scaled(self, v: Vec3, s: f64) -> Vec3;
    /// `divideScalar(s)` = `multiplyScalar(1 / s)`
    fn div(self, s: f64) -> Vec3;
    fn neg(self) -> Vec3;
    /// `distanceTo`
    fn distance_to(self, v: Vec3) -> f64;
}

impl V3 for Vec3 {
    fn dot(self, v: Vec3) -> f64 {
        self.x * v.x + self.y * v.y + self.z * v.z
    }
    fn length_sq(self) -> f64 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }
    fn add_scaled(self, v: Vec3, s: f64) -> Vec3 {
        Vec3::new(self.x + v.x * s, self.y + v.y * s, self.z + v.z * s)
    }
    fn div(self, s: f64) -> Vec3 {
        self.scale(1.0 / s)
    }
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
    fn distance_to(self, v: Vec3) -> f64 {
        let (dx, dy, dz) = (self.x - v.x, self.y - v.y, self.z - v.z);
        (dx * dx + dy * dy + dz * dz).sqrt()
    }
}

/// `Quaternion.normalize()`
pub fn quat_normalize(q: Quat) -> Quat {
    let l = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
    if l == 0.0 {
        Quat::IDENTITY
    } else {
        let l = 1.0 / l;
        Quat { x: q.x * l, y: q.y * l, z: q.z * l, w: q.w * l }
    }
}

/// `Quaternion.setFromEuler(new Euler(x, y, z, 'YXZ'))`
pub fn quat_from_euler_yxz(x: f64, y: f64, z: f64) -> Quat {
    let (c1, c2, c3) = ((x / 2.0).cos(), (y / 2.0).cos(), (z / 2.0).cos());
    let (s1, s2, s3) = ((x / 2.0).sin(), (y / 2.0).sin(), (z / 2.0).sin());
    Quat {
        x: s1 * c2 * c3 + c1 * s2 * s3,
        y: c1 * s2 * c3 - s1 * c2 * s3,
        z: c1 * c2 * s3 - s1 * s2 * c3,
        w: c1 * c2 * c3 + s1 * s2 * s3,
    }
}

/// `new Euler().setFromQuaternion(q, 'YXZ')` (through the rotation matrix, as three.js does)
pub fn euler_yxz(q: Quat) -> [f64; 3] {
    let (x, y, z, w) = (q.x, q.y, q.z, q.w);
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let m11 = 1.0 - (yy + zz);
    let m13 = xz + wy;
    let m21 = xy + wz;
    let m22 = 1.0 - (xx + zz);
    let m23 = yz - wx;
    let m31 = xz - wy;
    let m33 = 1.0 - (xx + yy);
    let ex = (-clamp(m23, -1.0, 1.0)).asin();
    if m23.abs() < 0.9999999 {
        [ex, m13.atan2(m33), m21.atan2(m22)]
    } else {
        [ex, (-m31).atan2(m11), 0.0]
    }
}

pub fn to_vector(v: Vec3) -> Vector {
    Vector::new(v.x as f32, v.y as f32, v.z as f32)
}
pub fn from_vector(v: Vector) -> Vec3 {
    Vec3::new(v.x as f64, v.y as f64, v.z as f64)
}
/// As given (descriptors and joint frames keep the quaternion they get)
pub fn to_rotation(q: Quat) -> Rotation {
    Rotation::from_xyzw(q.x as f32, q.y as f32, q.z as f32, q.w as f32)
}
/// `RigidBody.setRotation`: the binding normalizes (in f32)
pub fn to_rotation_normalized(q: Quat) -> Rotation {
    to_rotation(q).normalize()
}
pub fn from_rotation(q: Rotation) -> Quat {
    Quat { x: q.x as f64, y: q.y as f64, z: q.z as f64, w: q.w as f64 }
}
