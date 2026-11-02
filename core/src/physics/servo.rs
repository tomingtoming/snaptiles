//! Animated joints: spring joints (position motors), the servo teleport and the mass-pose balance of commanded
//! poses with the tangential anchoring of loaded ground contacts (`springMotor`, `jointAngle`, `servoTeleport`,
//! `servoMassPoints`, `balanceServoPose`, `servoContactAnchors`, `anchorServoTangents` of `world.ts`).
//!
//! Default paths only: servos are simultaneous (`simultaneousServo`), so the teleport never splits the rotation
//! between the two sides (`servoSplit` and the ground rule `servoGround` are skipped, and with them the inertia
//! estimate and `touchesGround`, whose results only the split used), and `resolveServoContacts` (the
//! non-simultaneous path) is not ported.

use super::math::*;
use super::pose_balance::{balance_pose, MassPoint};
use super::world::*;
use crate::model::{joint_sign, Quat, Vec3, TILE, TILE_T};
use crate::rc::Env;
use rapier3d::prelude::{JointAxis, RigidBodyHandle};
use std::collections::HashMap;

/// A loaded contact of a model collider against a fixed collider, remembered before the servos move the model
#[derive(Clone, Copy, Debug)]
pub(crate) struct Anchor {
    pub root: usize,
    pub body: RigidBodyHandle,
    pub local: Vec3,
    pub point: Vec3,
    pub normal: Vec3,
    pub weight: f64,
    pub friction: f64,
}

impl World {
    /// a joint with spring < 1: a torsion spring toward its (possibly animated) angle, SPRING_K·spring² N·m/rad (softer
    /// when its subtree is light, SPRING_K_INERTIA_*),
    /// damped by the damper's ratio over the inertia it swings. The target is taken the short way round from the
    /// current angle (G.txt's legs command "current + 20°" and wrap at ±180°).
    pub(crate) fn spring_motor(&mut self, i: usize, env: Env) {
        let tile = self.tile(self.tiles[i].tile);
        let s = js_max(0.0, tile_attr(tile, "spring", env, 1.0));
        let inertia = js_max(1e-3, self.tiles[i].spring_inertia);
        let k = SPRING_K * s.powf(SPRING_K_P) * js_max(SPRING_K_INERTIA_FLOOR, js_min(1.0, (inertia / SPRING_K_INERTIA_REF).powf(SPRING_K_INERTIA_P)));
        let damper = if tile.attrs.get("damper").is_some() { tile_attr(tile, "damper", env, 0.5) } else { tile_attr(tile, "dumper", env, 0.5) };
        let zeta = SPRING_ZETA[0] + (SPRING_ZETA[1] - SPRING_ZETA[0]) * js_min(1.0, js_max(0.0, damper) / 0.5);
        let c = 2.0 * zeta * (k * inertia).sqrt();
        let want = if self.tiles[i].animated { joint_sign(tile.spec.joint, tile.dir) * (tile_attr(tile, "angle", env, 0.0) - self.tiles[i].rest_angle) * std::f64::consts::PI / 180.0 } else { 0.0 };
        let target = want.sin().atan2(want.cos());
        self.tiles[i].servo_angle = target;
        // rapier3d-compat `configureMotorPosition` = `set_motor_position` on the revolute joint's free axis (AngX)
        if let Some(j) = self.tiles[i].joint.and_then(|h| self.world.impulse_joints.get_mut(h, true)) {
            j.data.set_motor_position(JointAxis::AngX, target as f32, k as f32, c as f32);
        }
    }

    /// current angle of an animated joint, measured from the two bodies' rotations (rad)
    pub(crate) fn joint_angle(&self, i: usize) -> f64 {
        let parent = self.tile(self.tiles[i].tile).parent.unwrap();
        let qp = from_rotation(*self.world.bodies[self.tiles[parent].body].rotation());
        let qc = from_rotation(*self.world.bodies[self.tiles[i].body].rotation());
        let qrel = Quat::mul(qp.invert(), qc);
        let ax = self.tiles[i].joint_axis_local.unwrap();
        let mut cur = 2.0 * (qrel.x * ax.x + qrel.y * ax.y + qrel.z * ax.z).atan2(qrel.w);
        if cur > std::f64::consts::PI {
            cur -= 2.0 * std::f64::consts::PI;
        }
        if cur < -std::f64::consts::PI {
            cur += 2.0 * std::f64::consts::PI;
        }
        cur
    }

    /// rigidly rotate a joint's whole subtree about its hinge so the joint reads its commanded angle
    pub(crate) fn servo_teleport(&mut self, i: usize) {
        let raw_delta = self.tiles[i].servo_angle - self.joint_angle(i);
        let delta = raw_delta.sin().atan2(raw_delta.cos());
        if delta.abs() < 1e-4 {
            return;
        }
        let tile = self.tiles[i].tile;
        let pb = self.tiles[self.tile(tile).parent.unwrap()].body;
        let (qp, pt) = {
            let b = &self.world.bodies[pb];
            (from_rotation(*b.rotation()), from_vector(b.translation()))
        };
        let axis_w = self.tiles[i].joint_axis_local.unwrap().apply_quat(qp).normalize();
        let anchor_w = self.tiles[i].joint_anchor_local.unwrap().apply_quat(qp).add(pt);
        // bodies on the child side (the joint's subtree), in visiting order
        let mut sub: Vec<RigidBodyHandle> = Vec::new();
        let mut stack = vec![tile];
        while let Some(t) = stack.pop() {
            let b = self.tiles[t].body;
            if b != pb && !sub.contains(&b) {
                sub.push(b);
            }
            let children = &self.tile(t).children;
            for &c in children.iter().rev() {
                if !self.tile(c).detached {
                    stack.push(c);
                }
            }
        }
        // simultaneous servos: the whole step goes to the subtree; balance_servo_pose then removes the net motion
        if delta.abs() < 1e-6 {
            return;
        }
        let rot = Quat::from_axis_angle(axis_w, delta);
        for h in sub {
            let b = self.world.bodies.get_mut(h).unwrap();
            let p = from_vector(b.translation()).sub(anchor_w).apply_quat(rot).add(anchor_w);
            let q = Quat::mul(rot, from_rotation(*b.rotation()));
            b.set_translation(to_vector(p), true);
            b.set_rotation(to_rotation_normalized(q), true);
        }
    }

    pub(crate) fn servo_mass_points(&self) -> HashMap<usize, Vec<MassPoint>> {
        let mut groups: HashMap<usize, Vec<MassPoint>> = HashMap::new();
        let s12 = 12f64.sqrt();
        for i in 0..self.tiles.len() {
            let t = self.tile(self.tiles[i].tile);
            if t.mass <= 0.0 {
                continue;
            }
            let mass = t.mass;
            let root = self.component_root(t.id);
            let pose = self.pose(i);
            let points = groups.entry(root).or_default();
            // Eight quadrature points reproduce the mass and second moment of a solid plate.
            for x in [-1.0, 1.0] {
                for y in [-1.0, 1.0] {
                    for z in [-1.0, 1.0] {
                        let local = Vec3::new(x * TILE / s12, y * TILE_T / s12, z * TILE / s12);
                        points.push(MassPoint { mass: mass / 8.0, position: local.apply_quat(pose.quaternion).add(pose.position) });
                    }
                }
            }
        }
        groups
    }

    pub(crate) fn balance_servo_pose(&mut self, roots: &[usize], before: &HashMap<usize, Vec<MassPoint>>) {
        if roots.is_empty() {
            return;
        }
        let after = self.servo_mass_points();
        for &root in roots {
            let (Some(old), Some(new)) = (before.get(&root), after.get(&root)) else { continue };
            let fit = balance_pose(old, new);
            let mut moved = Vec::new();
            for i in 0..self.tiles.len() {
                let h = self.tiles[i].body;
                if self.component_root(self.tiles[i].tile) != root || moved.contains(&h) {
                    continue;
                }
                moved.push(h);
                let b = self.world.bodies.get_mut(h).unwrap();
                let p = from_vector(b.translation()).sub(fit.from).apply_quat(fit.rotation).add(fit.to);
                let q = Quat::mul(fit.rotation, from_rotation(*b.rotation()));
                b.set_translation(to_vector(p), true);
                b.set_rotation(to_rotation_normalized(q), true);
            }
        }
    }

    /// Loaded contacts of model colliders (with friction) against fixed colliders, before the servos move anything.
    /// rapier3d-compat's `contactPair(other, collider, (manifold, flipped) => …)` is the pair's manifolds with the
    /// normal flipped when the pair stores `collider` first; `solverContactPoint` is the world point of a solver
    /// contact, here the midpoint of the two surface points `solver_contact_world_points` gives (the solver contacts
    /// of rapier 0.36 hold body-local anchors).
    pub(crate) fn servo_contact_anchors(&self) -> Vec<Anchor> {
        let mut anchors = Vec::new();
        let mut seen = Vec::new();
        for i in 0..self.tiles.len() {
            let h = self.tiles[i].body;
            if seen.contains(&h) {
                continue;
            }
            seen.push(h);
            let body = &self.world.bodies[h];
            for &ch in body.colliders() {
                let collider = &self.world.colliders[ch];
                if collider.is_sensor() || collider.friction() == 0.0 {
                    continue;
                }
                for pair in self.world.narrow_phase.contact_pairs_with(ch) {
                    let other = if pair.collider1 == ch { pair.collider2 } else { pair.collider1 };
                    let oc = &self.world.colliders[other];
                    if oc.is_sensor() || oc.parent().is_some_and(|ob| !self.world.bodies[ob].is_fixed()) {
                        continue;
                    }
                    let flipped = pair.collider1 != other;
                    for m in pair.manifolds() {
                        let impulse = m.points.iter().fold(0.0f64, |s, p| s + p.data.impulse as f64);
                        if impulse <= 0.0 || m.data.friction <= 0.0 {
                            continue;
                        }
                        let normal = from_vector(m.data.normal).scale(if flipped { -1.0 } else { 1.0 });
                        let rotation = from_rotation(*body.rotation());
                        let translation = from_vector(body.translation());
                        let inverse = rotation.invert();
                        let n = m.data.solver_contacts.len();
                        for c in &m.data.solver_contacts {
                            let (p1, p2) = m.data.solver_contact_world_points(c, &self.world.bodies);
                            let point = from_vector(p1).add(from_vector(p2)).scale(0.5);
                            let local = point.sub(translation).apply_quat(inverse);
                            anchors.push(Anchor {
                                root: self.component_root(self.tiles[i].tile),
                                body: h,
                                point,
                                local,
                                normal,
                                weight: impulse / n as f64,
                                friction: m.data.friction as f64,
                            });
                        }
                    }
                }
            }
        }
        anchors
    }

    /// Keep loaded contacts planted tangentially; leave penetration and normal
    /// impulses to the solver. Lifting contacts release immediately.
    pub(crate) fn anchor_servo_tangents(&mut self, roots: &[usize], anchors: &[Anchor]) {
        for &root in roots {
            let mut shift = Vec3::default();
            let mut weight = 0.0;
            for anchor in anchors {
                if anchor.root != root {
                    continue;
                }
                let b = &self.world.bodies[anchor.body];
                let (r, p) = (from_rotation(*b.rotation()), from_vector(b.translation()));
                let mut delta = anchor.local.apply_quat(r).add(p).sub(anchor.point);
                let lift = delta.dot(anchor.normal);
                if lift > 1e-4 {
                    continue;
                }
                delta = delta.add_scaled(anchor.normal, -lift);
                let w = anchor.weight * anchor.friction;
                shift = shift.add_scaled(delta, -w);
                weight += w;
            }
            if weight == 0.0 {
                continue;
            }
            shift = shift.div(weight);
            let mut moved = Vec::new();
            for i in 0..self.tiles.len() {
                let h = self.tiles[i].body;
                if self.component_root(self.tiles[i].tile) != root || moved.contains(&h) {
                    continue;
                }
                moved.push(h);
                let b = self.world.bodies.get_mut(h).unwrap();
                let p = from_vector(b.translation()).add(shift);
                b.set_translation(to_vector(p), true);
            }
        }
    }
}
