//! Contact-driven joint failure, calibrated against the B26 drop observations.
//! This is an energy proxy for B26's compliant connections, not its unknown solver.
use super::math::*;
use super::world::World;
use crate::model::Vec3;
use crate::rc::Env;
use rapier3d::prelude::RigidBodyHandle;
use std::collections::HashMap;

pub(crate) const MODEL_COLLIDER_TAG: u128 = 1 << 64;
// Weight drops: 100 m survives; 150 m loses the contact-side link;
// 200 m loses both vertical links. Chip/Frame survive 300 m. See measured.md.
const JOINT_IMPACT_ENERGY: f64 = 350_000.0;
const CONTACT_SIDE_FACTOR: f64 = 1.2;

pub(crate) struct ImpactSnapshot {
    axes: Vec<Vec3>,
    unstrained: Vec<Vec3>,
    bodies: Vec<RigidBodyHandle>,
    motion: HashMap<RigidBodyHandle, (Vec3, Vec3, Vec3)>,
}

impl ImpactSnapshot {
    fn velocity(&self, body: Option<RigidBodyHandle>, point: Vec3) -> Vec3 {
        body.and_then(|h| self.motion.get(&h)).map_or(Vec3::default(), |&(v, w, com)| {
            v.add(Vec3::cross(w, point.sub(com)))
        })
    }
}

impl World {
    pub(crate) fn impact_snapshot(&self) -> Option<ImpactSnapshot> {
        if self.regulations.get("U").copied().unwrap_or(0.0) != 0.0 || self.tiles.len() < 2 {
            return None;
        }
        let tiles = &self.assembly.as_ref()?.tiles;
        let mut unstrained = vec![Vec3::default(); tiles.len()];
        for (i, t) in tiles.iter().enumerate() {
            let pose = self.pose(i);
            unstrained[i] = match (t.parent, t.local, t.detached) {
                (Some(p), Some(local), false) => {
                    let parent = self.pose(p);
                    let offset = t.position.sub(t.anchor).apply_quat(t.quaternion.invert()).apply_quat(pose.quaternion);
                    unstrained[p].add(local.anchor.apply_quat(parent.quaternion)).add(offset)
                }
                _ => pose.position,
            };
        }
        Some(ImpactSnapshot {
            unstrained,
            axes: self.assembly.as_ref()?.tiles.iter().map(|t| match (t.parent, t.local) {
                (Some(p), Some(local)) => local.dir_axis.apply_quat(self.pose(p).quaternion).normalize(),
                _ => Vec3::default(),
            }).collect(),
            bodies: self.tiles.iter().map(|t| t.body).collect(),
            motion: self.world.bodies.iter().map(|(h, b)| (h, (
                from_vector(b.linvel()), from_vector(b.angvel()), from_vector(b.center_of_mass())
            ))).collect(),
        })
    }

    pub(crate) fn break_impact_joints(&mut self, before: ImpactSnapshot, env: Env) {
        let Some(assembly) = self.assembly.as_ref() else { return };
        let tiles = &assembly.tiles;
        let roots: Vec<_> = (0..tiles.len()).map(|i| self.component_root(i)).collect();
        let mut component_mass = vec![0.0; tiles.len()];
        for (i, t) in tiles.iter().enumerate() { component_mass[roots[i]] += t.mass; }
        let near = |i: usize, hit: usize| {
            let parent = |j: usize| if tiles[j].detached { None } else { tiles[j].parent };
            i == hit || parent(i) == Some(hit) || parent(hit) == Some(i)
                || parent(i).and_then(parent) == Some(hit)
                || parent(hit).and_then(parent) == Some(i)
                || (parent(i).is_some() && parent(i) == parent(hit))
        };
        let mut touching = std::collections::HashSet::new();
        let mut impacts = Vec::new();
        let mut energy = vec![0.0f64; tiles.len()];
        for pair in self.world.narrow_phase.contact_pairs() {
            for (handle, other, sign) in [(pair.collider1, pair.collider2, -1.0), (pair.collider2, pair.collider1, 1.0)] {
                let c = &self.world.colliders[handle];
                if c.user_data >> 64 != 1 || c.is_sensor() { continue; }
                let hit = (c.user_data & (MODEL_COLLIDER_TAG - 1)) as usize;
                let other = &self.world.colliders[other];
                for m in pair.manifolds() {
                    if !m.points.iter().any(|p| p.data.impulse > 0.0) { continue; }
                    let normal = from_vector(m.data.normal).scale(sign);
                    for contact in &m.data.solver_contacts {
                        let (a, b) = m.data.solver_contact_world_points(contact, &self.world.bodies);
                        let point = from_vector(a).add(from_vector(b)).scale(0.5);
                        let relative = before.velocity(c.parent(), point).sub(before.velocity(other.parent(), point));
                        let closing = (-relative.dot(normal)).max(0.0);
                        if closing < 1.0 { continue; }
                        touching.insert(hit);
                        impacts.push((hit, normal, closing));
                    }
                }
            }
        }
        for &(hit, normal, closing) in &impacts {
            // CCD can clamp a fast articulated tip while its parent advances. The
            // following solver then reports both surfaces at once. Resolve the
            // geometrically leading layer first, not a simultaneous deep crush.
            if impacts.iter().any(|&(other, n, _)| roots[other] == roots[hit]
                && n.dot(normal) > 0.95
                && before.unstrained[other].dot(normal) < before.unstrained[hit].dot(normal) - 0.15) { continue; }
            for i in 0..tiles.len() {
                if tiles[i].parent.is_none() || tiles[i].detached || roots[i] != roots[hit] || tiles[i].mass <= 0.0 || !near(i, hit) { continue; }
                let axial_speed = closing * before.axes[i].dot(normal).abs();
                let local_mass = tiles[i].mass + if tiles[hit].parent == Some(i) { tiles[hit].mass } else { 0.0 };
                let mass = (local_mass * component_mass[roots[i]]).sqrt();
                let direct = if i == hit { CONTACT_SIDE_FACTOR } else { 1.0 };
                energy[i] = energy[i].max(0.5 * mass * axial_speed * axial_speed * direct);
            }
        }
        let cuts: Vec<_> = energy.iter().enumerate().filter_map(|(i, &load)|
            (load > JOINT_IMPACT_ENERGY).then_some(i)).collect();
        if cuts.is_empty() { return; }
        for i in cuts { self.detach(i, true, env); }
        // The solver stopped a welded body before discovering that its contact-side
        // connection failed. Uncontacted fragments must keep falling instead of
        // inheriting that whole-body stop; contacting components retain the response.
        let touching_roots: std::collections::HashSet<_> = touching.iter().map(|&i| self.component_root(i)).collect();
        let mut seen = std::collections::HashSet::new();
        for i in 0..self.tiles.len() {
            let body = self.tiles[i].body;
            if !seen.insert(body) || touching_roots.contains(&self.component_root(i)) { continue; }
            let rb = &mut self.world.bodies[body];
            let old = before.bodies[i];
            // Retain a calibrated fraction of the incident velocity: fracture and
            // deformation absorb energy even though the remainder keeps falling.
            let v = before.velocity(Some(old), from_vector(rb.center_of_mass())).scale(0.7)
                .add(from_vector(rb.linvel()).scale(0.3));
            let w = before.motion[&old].1;
            rb.set_linvel(to_vector(v), true);
            rb.set_angvel(to_vector(w), true);
        }
    }
}
