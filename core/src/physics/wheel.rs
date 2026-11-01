//! Wheels (`driveWheel`), the lever-rule and contact-impulse tyre loads (`distributeLoads`, `measureTyreLoads`) and
//! soft kerbs (`kerbSprings`) of `world.ts`.

use super::math::*;
use super::world::*;
use crate::model::{joint_sign, JointKind, Quat, Vec3};
use crate::rc::Env;

use rapier3d::parry::shape::Ball as BallShape;
use rapier3d::prelude::{ColliderHandle, QueryFilter, Ray};

const DEG: f64 = std::f64::consts::PI / 180.0;
/// rigid ground: a face tilted less than 30°, or anything within 2° of vertical; a face normal within 3° of the
/// contact direction marks a face rather than an edge
fn kerb_cos() -> f64 {
    (30.0 * std::f64::consts::PI / 180.0).cos()
}
fn kerb_cos_flat() -> f64 {
    (2.0 * std::f64::consts::PI / 180.0).cos()
}
fn kerb_face_cos() -> f64 {
    (3.0 * std::f64::consts::PI / 180.0).cos()
}
const KERB_DEEP: f64 = 0.03;

impl World {
    /// Contact-force wheel (measured against the original): the tyre is not a spinning body. A ray
    /// from the hub, down within the wheel plane, finds the ground; the push is power × 0.066 / r
    /// (fading linearly with the kinematic spin v/r, zero at 180 rad/s), the brake damps the rolling
    /// speed, sideways slip is damped like a tyre with a friction limit. Spin is v/r while rolling and
    /// decays in the air.
    pub(crate) fn drive_wheel(&mut self, i: usize, pose: &TilePose, normal: Vec3, env: Env) {
        let ti = self.tiles[i].tile;
        let (parent, powerless, option, mass, no_reaction, dir, rim_axis) = {
            let t = self.tile(ti);
            (t.parent, t.powerless, t.option, t.mass, t.spec.no_reaction, t.dir, t.rim_axis)
        };
        // a wheel on a folding rim applies its tyre forces to the chassis the rim hangs from: the rim body
        // is light and its hard-limited joint would otherwise chatter under the grip forces
        let body = match (self.tiles[i].rim, parent) {
            (Some(_), Some(p)) => self.tiles[p].body,
            _ => self.tiles[i].body,
        };
        let mut power = if powerless { 0.0 } else { tile_attr(self.tile(ti), "power", env, 0.0) };
        if power != 0.0 {
            power *= self.use_fuel(FUEL_PER_POWER_WHEEL * power.abs() * self.dt * 30.0);
        }
        let brake = tile_attr(self.tile(ti), "brake", env, 0.0);
        if let Some(rj) = self.tiles[i].rim_joint {
            let a = joint_sign(JointKind::Wheel, dir) * (tile_attr(self.tile(ti), "angle", env, 0.0) - self.tiles[i].rest_angle) * DEG;
            let p = parent.unwrap();
            let axis = rim_axis.apply_quat(self.tiles[p].body_rest_quat.invert());
            // rapier3d-compat `setFrameX1(q)`: the rotation of the joint's first local frame
            let q = to_rotation(Quat::from_axis_angle(axis, a));
            if let Some(j) = self.world.impulse_joints.get_mut(rj, true) {
                j.data.local_frame1.rotation = q;
            }
        }
        let r = wheel_radius(option);
        // down, projected into the wheel plane
        let mut d = Vec3::new(0.0, -1.0, 0.0).add_scaled(normal, normal.y);
        let mut contact = false;
        if d.length_sq() > 0.09 {
            d = d.normalize();
            let o = pose.position;
            let ray = Ray::new(to_vector(o), to_vector(d));
            let filter = QueryFilter::new().groups(groups(MODEL_GROUP)).exclude_rigid_body(body);
            let hit = self.world.cast_ray_and_get_normal(&ray, (r + TYRE_CONTACT_MARGIN) as f32, true, filter);
            if let Some((_, hit)) = hit {
                contact = true;
                let toi = hit.time_of_impact as f64;
                let p_contact = o.add_scaled(d, toi);
                let g = from_vector(hit.normal);
                // rolling direction for +power and the lateral direction, both in the ground plane
                let f = Vec3::cross(g, normal);
                if f.length_sq() < 1e-6 {
                    return;
                }
                let f = f.normalize();
                let l = Vec3::cross(f, g).normalize();
                let (c, lv, av) = {
                    let b = &self.world.bodies[body];
                    (from_vector(b.translation()), from_vector(b.linvel()), from_vector(b.angvel()))
                };
                let v_p = lv.add(Vec3::cross(av, p_contact.sub(c)));
                let vf = v_p.dot(f);
                let vl = v_p.dot(l);
                let k = WHEEL_TORQUE_PER_POWER;
                let wheels = self.a().tiles.iter().filter(|t| t.spec.wheel).count();
                let tb = &mut self.tiles[i];
                tb.contact_age = if tb.contact_point.is_some() { tb.contact_age + 1 } else { 0 };
                tb.contact_point = Some(p_contact);
                let load = (if TYRE_STATIC_LOAD && tb.load > 0.0 { tb.load } else { (self.total_mass * 9.8) / js_max(1.0, wheels as f64) }) * TYRE_LOAD_SHARE;
                // motor torque: k·power·(1 − spin/ω0). Measured: at power 1000 and 2500 the push fades linearly to zero at
                // 180 rad/s; a sliding wheel at power 5000/10000 settles near 135/375 rad/s against ~1030 N of ground
                // force, which only fits if the fade's zero point grows with power above ~3700 (ω0 = power/20.6)
                // two regimes (measured): a rolling wheel's push fades to zero at 180 rad/s whatever the power (power 1000
                // and 2500 straight runs; the corpus car1 on the original stops accelerating near 54 m/s = 180 rad/s on
                // 0.3 m wheels and takes off), while a sliding wheel spins on to p/20.6 rad/s (135 at 5000, 376 at 10000)
                let w0 = if tb.slipping || ROLL_FADE_SCALES { js_max(WHEEL_SPIN_FADE, power.abs() * WHEEL_SPIN_PER_POWER) } else { WHEEL_SPIN_FADE };
                let mut tau = if power != 0.0 { power * k * js_max(0.0, 1.0 - (js_sign(power) * tb.spin) / w0) } else { 0.0 };
                if brake > 0.0 {
                    // measured: a 530 kg car with brake=10 on four wheels sheds 2.2 m/s² (0.22 g), brake=50 7.7 m/s²
                    // (0.78 g) at any speed — Coulomb, ≈0.022 g per brake unit, saturating near 0.8 g
                    let frac = js_min(BRAKE_G_PER_UNIT * brake, BRAKE_G_MAX);
                    let ramp = js_min(1.0, vf.abs() / 0.5); // no chatter at rest
                    tau -= js_sign(vf) * frac * load * ramp * r;
                }
                let mu = WHEEL_FRICTION;
                let limit = mu * load;
                let mut ff = tau / r;
                // set while the tyre slides: kinetic friction direction (f, l)
                let mut slide_dir: Option<(f64, f64)> = None;
                // WHEEL_SPIN_DYNAMICS: rolling: the ground force is the motor's, the spin follows the road. Sliding (the
                // motor asks for more than the grip): kinetic friction at the grip limit against the slip, and the wheel
                // spins up with its own inertia ½mr² until motor torque, ground reaction and a spin drag balance
                // (measured 135/375 rad/s)
                let slip = tb.spin * r - vf;
                // a wheel that lands spinning (or stops spinning) far from the road speed slides first
                if !tb.slipping && ff.abs() <= limit && slip.abs() < 0.5 {
                    tb.spin = vf / r;
                } else {
                    tb.slipping = true;
                    let dir = if slip.abs() > 0.1 { js_sign(slip) } else { js_sign(ff) };
                    ff = dir * limit;
                    // kinetic friction opposes the contact patch's total slip (the tyre surface running against the
                    // road lengthwise plus the sideways velocity): a wheel spinning hard keeps little lateral grip
                    // (measured: the steered car corners at 0.4-0.7 g with power 5000 on its sliding axle, 0.2 g at 10000)
                    let sl = if slip.abs() > 0.1 { slip } else { dir * 0.1 };
                    let mag = sl.hypot(vl);
                    slide_dir = Some((sl / mag, -vl / mag));
                    let inertia = WHEEL_INERTIA_SCALE * 0.5 * mass * r * r;
                    let spin_next = tb.spin + (self.dt * (tau - ff * r - WHEEL_SPIN_DRAG * tb.spin)) / inertia;
                    let slip_next = spin_next * r - vf;
                    if (slip.abs() > 0.1 && slip * slip_next < 0.0) || (slip_next.abs() < 0.05 && (tau / r).abs() <= limit) {
                        // the slip closed within this step: the ground force is whatever brought the wheel from its spin
                        // to the road speed (a landing wheel shoves the car with its stored momentum), then rolling
                        let target = vf / r;
                        // only a real speed difference (a landing wheel, > 1 m/s of slip) carries momentum worth applying;
                        // the small in/out chatter of a wheel grazing its grip limit in a corner must not eat the lateral grip
                        let stored = if slip.abs() > 1.0 { (inertia * (target - tb.spin)) / self.dt } else { 0.0 };
                        let impulse_limit = mu * js_min(if tb.contact_force > 0.0 { tb.contact_force } else { load }, TYRE_LOAD_CAP * js_max(tb.static_load, 1.0));
                        ff = clamp((tau - stored) / r, -impulse_limit, impulse_limit);
                        tb.slipping = false;
                        tb.spin = target;
                    } else {
                        tb.spin = spin_next;
                    }
                    if !tb.slipping {
                        slide_dir = None;
                    }
                }
                // the motor (and brake) torque acts between wheel and chassis: its reaction pitches the body (measured:
                // a car at power 10000 pitches 0.7 rad nose-up while still falling after spawn; RLW has no reaction)
                if !no_reaction && WHEEL_REACTION && WHEEL_REACTION_GROUND {
                    let t = normal.scale(tau * WHEEL_REACTION_GROUND_SCALE);
                    self.world.bodies.get_mut(body).unwrap().add_torque(to_vector(t), true);
                }
                let mut fl = (-TYRE_LATERAL_GAIN * vl * (load / 9.8)) / self.dt;
                // friction circle, drive first (measured on the original, steered car at steer 10/20 deg: the lateral
                // acceleration tops out near 1.1 g with little drive, 0.9-1.0 g with rear drive at 0.7 of the cap, and
                // the rear axle slides freely once its drive saturates - the car then drifts along the front wheels)
                let mu_l = TYRE_LATERAL_MU;
                if let Some((sf, sl)) = slide_dir {
                    ff = limit * sf;
                    fl = limit * sl;
                } else {
                    // (TYRE_LATERAL_FIRST off) a drive-saturated wheel keeps a floor of its lateral grip (measured: the
                    // steered car at power 5000 still corners at 0.4-0.9 g with its powered axle sliding)
                    let floor = TYRE_LATERAL_FLOOR;
                    let lateral_limit = mu_l * load * if TYRE_FRICTION_CIRCLE { js_max(floor, js_max(0.0, 1.0 - (ff / limit) * (ff / limit)).sqrt()) } else { 1.0 };
                    fl = clamp(fl, -lateral_limit, lateral_limit);
                }
                let force = f.scale(ff).add_scaled(l, fl);
                // applied at the contact patch: the ground force below the hub is what pitches a segway's body back
                // when its wheels drive forward (self-balancers need it); the chassis rocking seen earlier came
                // from the cylinder tyre, not from this moment
                self.world.bodies.get_mut(body).unwrap().add_force_at_point(to_vector(force), to_vector(p_contact), true);
            }
        }
        if !contact {
            let tb = &mut self.tiles[i];
            tb.contact_point = None;
            tb.slipping = false;
            // in the air a powered wheel spins up against the motor's fade (measured: 34→207 rad/s over the first
            // 12 frames of the spawn drop at power 10000; a flipped car's wheels pass 1200 rad/s at 20000)
            if tb.rotor_inertia > 0.0 {
                // a rotor: driven against the air drag of the chips it carries (ROTOR_*); the motor reacts on the body
                let torque = power * ROTOR_TORQUE;
                // the drag grows with ω^2.74, so step in small pieces and never past the speed where it balances the motor
                // (a rotor that touched the ground at speed otherwise overshot and diverged)
                let cd = ROTOR_DRAG * tb.rotor_mass.powf(ROTOR_DRAG_M);
                let inertia = tb.rotor_inertia + WHEEL_INERTIA_SCALE * 0.5 * mass * r * r;
                let eq = js_sign(torque) * (torque.abs() / cd).powf(1.0 / ROTOR_DRAG_N);
                for _ in 0..8 {
                    let next = tb.spin + (self.dt / 8.0) * (torque - cd * tb.spin.abs().powf(ROTOR_DRAG_N) * js_sign(tb.spin)) / inertia;
                    tb.spin = if (next - eq) * (tb.spin - eq) < 0.0 { eq } else { next };
                }
                if power != 0.0 && !no_reaction && WHEEL_REACTION {
                    let t = normal.scale(torque);
                    self.world.bodies.get_mut(body).unwrap().add_torque(to_vector(t), true);
                }
            } else if WHEEL_SPIN_DYNAMICS && power != 0.0 {
                let w0 = js_max(WHEEL_SPIN_FADE, power.abs() * WHEEL_SPIN_PER_POWER);
                let tau = power * WHEEL_TORQUE_PER_POWER * (1.0 - (js_sign(power) * tb.spin) / w0);
                tb.spin += (self.dt * tau) / (WHEEL_INERTIA_SCALE * 0.5 * mass * r * r);
                if !no_reaction && WHEEL_REACTION {
                    let t = normal.scale(tau);
                    self.world.bodies.get_mut(body).unwrap().add_torque(to_vector(t), true);
                }
            } else {
                tb.spin *= 0.9;
            }
        }
        let tb = &mut self.tiles[i];
        tb.spin_angle += tb.spin * self.dt;
    }

    /// Static load of each touching wheel: minimum-norm solution of weight and moment balance about the
    /// centre of mass over the contact points of the last step (lever rule for two axles, equal shares for a
    /// symmetric four), negatives clamped and the rest rescaled to the full weight. Wheels in the air get 0.
    pub fn distribute_loads(&mut self) {
        let wheels: Vec<usize> = (0..self.tiles.len()).filter(|&i| self.tile(self.tiles[i].tile).spec.wheel && self.tiles[i].contact_point.is_some()).collect();
        for i in 0..self.tiles.len() {
            if self.tile(self.tiles[i].tile).spec.wheel {
                self.tiles[i].load = 0.0;
            }
        }
        if wheels.is_empty() {
            return;
        }
        let w_total = self.total_mass * 9.8;
        if wheels.len() == 1 {
            self.tiles[wheels[0]].load = w_total;
            return;
        }
        let (mut cx, mut cz, mut m) = (0.0, 0.0, 0.0);
        for i in 0..self.tiles.len() {
            let p = self.pose(i).position;
            let mass = self.tile(self.tiles[i].tile).mass;
            cx += p.x * mass;
            cz += p.z * mass;
            m += mass;
        }
        cx /= m;
        cz /= m;
        // rows: sum N = W, sum N·(x−cx) = 0, sum N·(z−cz) = 0; min-norm N = Aᵀ(AAᵀ+εI)⁻¹ b
        // lever arms from the current hub positions (the contact points are one step old, which at speed
        // shifts them all backwards relative to the centre of mass and loads the rear axle too much)
        let hubs: Vec<Vec3> = wheels.iter().map(|&w| self.pose(w).position).collect();
        let xs: Vec<f64> = hubs.iter().map(|h| h.x - cx).collect();
        let zs: Vec<f64> = hubs.iter().map(|h| h.z - cz).collect();
        let n = wheels.len() as f64;
        let eps = 1e-4 * n;
        let sx = xs.iter().fold(0.0, |a, b| a + b);
        let sz = zs.iter().fold(0.0, |a, b| a + b);
        let sxx = xs.iter().fold(0.0, |a, b| a + b * b);
        let szz = zs.iter().fold(0.0, |a, b| a + b * b);
        let sxz = xs.iter().zip(&zs).fold(0.0, |a, (x, z)| a + x * z);
        let mut mm = [[n + eps, sx, sz], [sx, sxx + eps, sxz], [sz, sxz, szz + eps]];
        let mut b = [w_total, 0.0, 0.0];
        // solve M y = b (3×3, Gaussian elimination)
        for i in 0..3 {
            let mut piv = i;
            for r in i + 1..3 {
                if mm[r][i].abs() > mm[piv][i].abs() {
                    piv = r;
                }
            }
            mm.swap(i, piv);
            b.swap(i, piv);
            for r in i + 1..3 {
                let f = mm[r][i] / mm[i][i];
                for c in i..3 {
                    mm[r][c] -= f * mm[i][c];
                }
                b[r] -= f * b[i];
            }
        }
        let mut y = [0.0; 3];
        for i in (0..3).rev() {
            let mut acc = b[i];
            for c in i + 1..3 {
                acc -= mm[i][c] * y[c];
            }
            y[i] = acc / mm[i][i];
        }
        let mut sum = 0.0;
        for (k, &w) in wheels.iter().enumerate() {
            let l = js_max(0.0, y[0] + y[1] * xs[k] + y[2] * zs[k]);
            self.tiles[w].load = l;
            sum += l;
        }
        if sum > 0.0 {
            for &w in &wheels {
                self.tiles[w].load *= w_total / sum;
            }
        }
        // the landing impact spikes the contact force for a frame; the grip must not eat a spinning wheel's
        // momentum in one step (measured: the original's wheels keep spinning for ~15 frames after touchdown)
        for &w in &wheels {
            self.tiles[w].static_load = self.tiles[w].load;
        }
        // sustained grip follows the contact force only up to TYRE_LOAD_CAP_SUSTAINED × the static share (measured: the
        // original's car1 keeps a constant 13.5 m/s² to 54 m/s while its tilted plates press it down ever harder, so
        // aero downforce does not buy grip there); the touchdown impulse uses the higher cap in drive_wheel
        if TYRE_DYNAMIC_LOAD {
            for &w in &wheels {
                let tb = &mut self.tiles[w];
                if tb.contact_force > 0.0 {
                    let fresh = tb.contact_age < TYRE_TOUCHDOWN_STEPS;
                    let cap = if fresh { TYRE_LOAD_CAP } else { TYRE_LOAD_CAP_SUSTAINED };
                    tb.load = js_min(tb.contact_force, cap * tb.load);
                }
            }
        }
    }

    /// normal force each tyre carried in the step just taken (sum of contact impulses / dt), smoothed.
    /// rapier3d-compat's `contactPair(...)` manifolds and `contactImpulse(i)` are `ContactPair::manifolds()` and
    /// their points' `data.impulse` (contact clustering never applies to a ball against a cuboid).
    pub fn measure_tyre_loads(&mut self) {
        for i in 0..self.tiles.len() {
            let Some(col) = self.tiles[i].collider else { continue };
            if !self.tile(self.tiles[i].tile).spec.wheel {
                continue;
            }
            let mut impulse = 0.0f64;
            for pair in self.world.narrow_phase.contact_pairs_with(col) {
                for m in pair.manifolds() {
                    for p in &m.points {
                        impulse += (p.data.impulse as f64).abs();
                    }
                }
            }
            let tb = &mut self.tiles[i];
            let f = impulse / self.dt + tb.kerb_force;
            tb.contact_force = if f > 0.0 { if tb.contact_force > 0.0 { tb.contact_force + TYRE_LOAD_SMOOTH * (f - tb.contact_force) } else { f } } else { 0.0 };
        }
    }

    /// Push each tyre off kerb edges with a spring-damper along the edge normal, and switch that pair's rigid
    /// contact off. Ground under the tyre (normal within 30° of vertical) stays a rigid contact.
    pub(crate) fn kerb_springs(&mut self) {
        self.kerb_pairs.clear();
        for i in 0..self.tiles.len() {
            self.tiles[i].kerb_force = 0.0;
            let Some(col) = self.tiles[i].collider else { continue };
            if !TYRE_SOFT_KERB || self.world.colliders[col].is_sensor() {
                continue;
            }
            let ti = self.tiles[i].tile;
            // like drive_wheel: a wheel on a folding rim pushes the chassis the rim hangs from
            let body = match (self.tiles[i].rim, self.tile(ti).parent) {
                (Some(_), Some(p)) => self.tiles[p].body,
                _ => self.tiles[i].body,
            };
            let r = wheel_radius(self.tile(ti).option);
            let t = self.world.colliders[col].translation();
            let tv = from_vector(t);
            let static_load = self.tiles[i].static_load;
            let k = js_max(static_load, 50.0) / KERB_SAG;
            let c = 2.0 * KERB_DAMPING * (k * js_max(static_load, 50.0) / 9.8).sqrt();
            // rapier solves contacts it predicts for the coming step, so take kerbs over before the tyre touches them
            let lv0 = from_vector(self.world.bodies[body].linvel());
            let reach = r + js_max(0.05, 2.0 * self.dt * (lv0.x * lv0.x + lv0.y * lv0.y + lv0.z * lv0.z).sqrt());
            let mut hits: Vec<(Vec3, Vec3, f64, ColliderHandle)> = Vec::new();
            let shape = BallShape::new(reach as f32);
            let filter = QueryFilter::new().groups(groups(MODEL_GROUP)).exclude_rigid_body(self.tiles[i].body);
            let candidates: Vec<ColliderHandle> = self.world.intersect_shape(rapier3d::math::Pose::from_translation(t), &shape, filter).map(|(h, _)| h).collect();
            for other in candidates {
                let oc = &self.world.colliders[other];
                let proj = oc.shape().project_point(oc.position(), t, true);
                let pp = from_vector(proj.point);
                let e = Vec3::new(tv.x - pp.x, tv.y - pp.y, tv.z - pp.z);
                let dist = e.length();
                if dist < 1e-6 {
                    continue;
                }
                let e = e.div(dist);
                // a face under the tyre (flat or sloped up to 30°) stays a rigid contact; an edge or corner is a kerb,
                // however shallow (a 3 cm lip at 9 m/s launched the car). A ray from the hub along -e meets a face with
                // the same normal; at an edge the face normal differs. A tyre sunk into the ground climbing a kerb stays
                // soft too: a rigid contact would pop that depth out in one step, with no loss of speed.
                if r - dist < KERB_DEEP {
                    let hit = oc.shape().cast_ray_and_get_normal(oc.position(), &Ray::new(t, to_vector(e.neg())), (dist + 0.05) as f32, true);
                    let on_face = match hit {
                        None => true,
                        Some(h) => h.normal.x as f64 * e.x + h.normal.y as f64 * e.y + h.normal.z as f64 * e.z > kerb_face_cos(),
                    };
                    if (on_face && e.y >= kerb_cos()) || e.y >= kerb_cos_flat() {
                        continue;
                    }
                }
                self.kerb_pairs.insert((col, other));
                if dist < r {
                    hits.push((e, pp, r - dist, other));
                }
            }
            // forces only after the query (the TypeScript: touching a body inside its callback throws)
            for (e, p, depth, other) in hits {
                let (com, lv, av) = {
                    let b = &self.world.bodies[body];
                    (from_vector(b.translation()), from_vector(b.linvel()), from_vector(b.angvel()))
                };
                let v_p = lv.add(Vec3::cross(av, p.sub(com)));
                let force = js_max(0.0, k * depth - c * v_p.dot(e));
                self.world.bodies.get_mut(body).unwrap().add_force_at_point(to_vector(e.scale(force)), to_vector(p), true);
                if let Some(ob) = self.world.colliders[other].parent() {
                    let b = self.world.bodies.get_mut(ob).unwrap();
                    if b.is_dynamic() {
                        b.add_force_at_point(to_vector(e.scale(-force)), to_vector(p), true); // crates, balls
                    }
                }
                self.tiles[i].kerb_force += force;
            }
        }
    }
}
