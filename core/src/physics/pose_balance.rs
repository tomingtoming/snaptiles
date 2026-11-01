//! Best rigid alignment of a newly commanded mass distribution to its previous distribution (port of
//! `src/physics/pose-balance.ts`). This removes net translation and rotation from the internal shape change, without
//! making its result depend on joint traversal order.

use super::math::{quat_normalize, V3};
use crate::model::{Quat, Vec3};

#[derive(Clone, Copy, Debug)]
pub struct MassPoint {
    pub position: Vec3,
    pub mass: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Balance {
    pub rotation: Quat,
    pub from: Vec3,
    pub to: Vec3,
}

/// `after` mapped by `(p - from).applyQuaternion(rotation) + to` lands on `before` in the least-squares sense.
///
/// Panics when the two lists differ in length (the TypeScript throws "Mass point correspondence changed").
pub fn balance_pose(before: &[MassPoint], after: &[MassPoint]) -> Balance {
    assert_eq!(before.len(), after.len(), "Mass point correspondence changed");
    let mass = before.iter().fold(0.0, |s, p| s + p.mass);
    let mut from = Vec3::default();
    let mut to = Vec3::default();
    if mass <= 0.0 {
        return Balance { rotation: Quat::IDENTITY, from, to };
    }
    for (p, a) in before.iter().zip(after) {
        to = to.add_scaled(p.position, p.mass / mass);
        from = from.add_scaled(a.position, p.mass / mass);
    }
    let mut h = [0.0f64; 9];
    for (p, a) in before.iter().zip(after) {
        let a = a.position.sub(from).to_array();
        let b = p.position.sub(to).to_array();
        for j in 0..3 {
            for k in 0..3 {
                h[3 * j + k] += p.mass * a[j] * b[k];
            }
        }
    }
    // Quaternion form of the proper-rotation least-squares fit; reflections are excluded.
    let [xx, xy, xz, yx, yy, yz, zx, zy, zz] = h;
    let mut n = [
        [xx + yy + zz, yz - zy, zx - xz, xy - yx],
        [yz - zy, xx - yy - zz, xy + yx, xz + zx],
        [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
        [xy - yx, xz + zx, yz + zy, -xx - yy + zz],
    ];
    let mut vectors = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0f64]];
    let scale = n.iter().flatten().fold(1.0f64, |m, v| if v.abs() > m { v.abs() } else { m });
    // Symmetric Jacobi eigensolver also handles a 180-degree rotation, whose
    // eigenvector is orthogonal to an identity-seeded power iteration.
    for _ in 0..80 {
        let (mut p, mut q) = (0usize, 1usize);
        for i in 0..4 {
            for j in i + 1..4 {
                if n[i][j].abs() > n[p][q].abs() {
                    p = i;
                    q = j;
                }
            }
        }
        if n[p][q].abs() < 1e-12 * scale {
            break;
        }
        let angle = 0.5 * (2.0 * n[p][q]).atan2(n[q][q] - n[p][p]);
        let (c, s) = (angle.cos(), angle.sin());
        let (pp, qq, pq) = (n[p][p], n[q][q], n[p][q]);
        for i in 0..4 {
            if i != p && i != q {
                let (ip, iq) = (n[i][p], n[i][q]);
                n[i][p] = c * ip - s * iq;
                n[p][i] = n[i][p];
                n[i][q] = s * ip + c * iq;
                n[q][i] = n[i][q];
            }
        }
        n[p][p] = c * c * pp - 2.0 * s * c * pq + s * s * qq;
        n[q][q] = s * s * pp + 2.0 * s * c * pq + c * c * qq;
        n[p][q] = 0.0;
        n[q][p] = 0.0;
        for row in vectors.iter_mut() {
            let (ip, iq) = (row[p], row[q]);
            row[p] = c * ip - s * iq;
            row[q] = s * ip + c * iq;
        }
    }
    let mut best = 0;
    for i in 1..4 {
        if n[i][i] > n[best][best] {
            best = i;
        }
    }
    let rotation = quat_normalize(Quat { x: vectors[1][best], y: vectors[2][best], z: vectors[3][best], w: vectors[0][best] });
    Balance { rotation, from, to }
}

#[cfg(test)]
mod tests {
    use super::*;

    // tests/pose-balance.test.ts
    #[test]
    fn recovers_rigid_motion() {
        for angle in [0.7, std::f64::consts::PI] {
            let before: Vec<MassPoint> = [[-1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 3.0]]
                .iter()
                .enumerate()
                .map(|(i, p)| MassPoint { position: Vec3::new(p[0], p[1], p[2]), mass: (i + 1) as f64 })
                .collect();
            let rotation = Quat::from_axis_angle(Vec3::new(1.0, 2.0, 3.0).normalize(), angle);
            let after: Vec<MassPoint> = before
                .iter()
                .map(|p| MassPoint { mass: p.mass, position: p.position.apply_quat(rotation).add(Vec3::new(7.0, -2.0, 9.0)) })
                .collect();
            let fit = balance_pose(&before, &after);
            for (a, b) in after.iter().zip(&before) {
                let d = a.position.sub(fit.from).apply_quat(fit.rotation).add(fit.to).distance_to(b.position);
                assert!(d < 1e-8, "angle {angle}: {d}");
            }
        }
    }
}
