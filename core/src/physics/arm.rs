//! Arms: charge, fire, recoil (`updateArm`), and the shells' swept hits, damage and destruction (`cullProjectiles`).

use super::math::*;
use super::world::*;
use crate::model::{dir_vec, Vec3};
use crate::rc::{Dir, Env};
use rapier3d::prelude::{ColliderBuilder, QueryFilter, Ray, RigidBodyBuilder};

impl World {
    /// Arm: charge every step; fire a shell when power reaches option.
    pub(crate) fn update_arm(&mut self, i: usize, pose: &TilePose, env: Env) {
        let ti = self.tiles[i].tile;
        let (option, powerless, dir) = {
            let t = self.tile(ti);
            (js_max(0.0, t.option), t.powerless, t.dir)
        };
        let have = self.arm_charge.get(&ti).copied().unwrap_or(0.0);
        let want = js_min(ARM_CHARGE_PER_STEP, js_max(0.0, (if option == 0.0 || option.is_nan() { f64::INFINITY } else { option }) - have));
        let charge = have + want * self.use_fuel(FUEL_PER_ARM_CHARGE * want);
        self.arm_charge.insert(ti, charge);
        let power = if powerless { 0.0 } else { tile_attr(self.tile(ti), "power", env, 0.0) };
        if option <= 0.0 || power < option || charge < option || self.tick < ARM_ARMED_AFTER_TICK {
            return;
        }
        self.arm_charge.insert(ti, 0.0);
        let v = self.velocity(i, pose);
        // the shell leaves along the Arm's own forward edge (away from the chip it hangs on), not its normal:
        // measured on the original, an Arm standing on an upright column recoils vertically, and the readme
        // forbids attaching chips in the firing direction
        let fwd = dir_vec(dir.unwrap_or(Dir::N)).apply_quat(pose.quaternion);
        let muzzle = pose.position.add(fwd.scale(0.6));
        let vel = v.add(fwd.scale(ARM_MUZZLE_SPEED));
        let body = self.world.insert_body(RigidBodyBuilder::dynamic().translation(to_vector(muzzle)).linvel(to_vector(vel)).ccd_enabled(true));
        // the shell's momentum is the measured recoil impulse (its mass follows from the muzzle speed)
        let impulse = ARM_RECOIL_PER_ENERGY * option;
        // a sensor: the shell never bounces, chip hits and the ground hit are swept tests in cull_projectiles
        self.world.insert_collider(
            ColliderBuilder::ball(0.15).mass(js_max(0.01, impulse / ARM_MUZZLE_SPEED) as f32).collision_groups(groups(SHELL_GROUP)).sensor(true),
            Some(body),
        );
        self.projectiles.push(Projectile { body, born: self.tick, energy: option, prev: muzzle });
        let recoil = fwd.scale(-impulse);
        let h = self.tiles[i].body;
        self.world.bodies.get_mut(h).unwrap().apply_impulse_at_point(to_vector(recoil), to_vector(pose.position), true);
    }

    pub(crate) fn cull_projectiles(&mut self, env: Env) {
        let shells = std::mem::take(&mut self.projectiles);
        let mut kept = Vec::with_capacity(shells.len());
        for mut p in shells {
            // the targets are taken per shell from the current tiles (the TypeScript filters them once, before a
            // destroyed chip's detach rebuilds the world)
            let hit_targets: Vec<usize> = (0..self.tiles.len()).filter(|&i| self.tile(self.tiles[i].tile).durability.unwrap_or(10000.0) >= 0.0).collect();
            let cur = from_vector(self.world.bodies[p.body].translation());
            let mut dead = self.tick - p.born > ARM_SHELL_LIFE || cur.y < -1.0;
            if !dead {
                // swept sphere test against every chip centre (closest chip along the path wins); the ground (and
                // course) is hit by a ray along the same path - shells skim the ground when an Arm lies flat on it
                let seg = cur.sub(p.prev);
                let len2 = seg.length_sq();
                let mut best: Option<usize> = None;
                let mut best_s = f64::INFINITY;
                if len2 > 0.0 {
                    let len = len2.sqrt();
                    let ray = Ray::new(to_vector(p.prev), to_vector(Vec3::new(seg.x / len, seg.y / len, seg.z / len)));
                    if let Some((_, toi)) = self.world.cast_ray(&ray, len as f32, true, QueryFilter::new().groups(groups(SHELL_GROUP))) {
                        best_s = toi as f64 / len;
                        dead = true;
                    }
                }
                for &i in &hit_targets {
                    let c = self.pose(i).position;
                    let w = c.sub(p.prev);
                    let s = if len2 > 0.0 { js_max(0.0, js_min(1.0, w.dot(seg) / len2)) } else { 0.0 };
                    let d2 = w.sub(seg.scale(s)).length_sq();
                    if d2 <= ARM_HIT_RADIUS * ARM_HIT_RADIUS && s < best_s {
                        best = Some(i);
                        best_s = s;
                    }
                }
                if let Some(bi) = best {
                    let ti = self.tiles[bi].tile;
                    let mass = self.tile(ti).mass;
                    let durability = self.tile(ti).durability.unwrap_or(10000.0) - (ARM_DAMAGE_PER_ENERGY * p.energy) / js_max(1.0, mass);
                    self.assembly.as_mut().unwrap().tiles[ti].durability = Some(durability);
                    let (m, lv) = {
                        let b = &self.world.bodies[p.body];
                        (b.mass() as f64, from_vector(b.linvel()))
                    };
                    let hit_at = self.pose(bi).position;
                    if durability <= 0.0 {
                        // measured: the destroyed chip reads _T −1, comes loose and flies off with the shell's momentum
                        // (a Chip hit at option 200000 leaves at ~50 m/s along the shot)
                        self.assembly.as_mut().unwrap().tiles[ti].durability = Some(-1.0);
                        if ARM_DESTROY_DETACH && self.tile(ti).parent.is_some() {
                            self.detach(ti, true, env);
                        }
                    }
                    let h = self.tiles[ti].body;
                    self.world.bodies.get_mut(h).unwrap().apply_impulse_at_point(to_vector(lv.scale(m)), to_vector(hit_at), true);
                    dead = true;
                }
            }
            if dead {
                self.world.remove_body(p.body);
            } else {
                p.prev = cur;
                kept.push(p);
            }
        }
        // a detach inside the loop restored the (taken, empty) list; shells fired meanwhile cannot exist
        self.projectiles = kept;
    }
}
