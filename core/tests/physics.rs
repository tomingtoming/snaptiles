//! Physics behaviours of the TypeScript unit tests (tests/calibration, kerb, physics, rotor, spring-servo .test.ts)
//! that need no script, on the Rust world. Where a test's Lua only sets a Val at a frame (`if _TICKS()>=N then A=x`)
//! or calls `_BYE`, the harness does the same before that frame's physics; a key press is the Val change it makes.
//! The script API readings are reproduced from `src/sim/simulation.ts` (`_X` = −x, `_VX`/`_VZ` local velocity along
//! −X/+Z, `_EX` = −Euler x, `_Q*` with y and z negated).
use snaptiles_core::model::{assemble, Quat, Vec3};
use snaptiles_core::physics::math::{euler_yxz, from_rotation};
use snaptiles_core::physics::{groups, BuildOptions, PhysicsOptions, World, GROUND_GROUP};
use snaptiles_core::rc::{parse_rc, RcModel};
use rapier3d::prelude::ColliderBuilder;
use std::cell::RefCell;
use std::collections::HashMap;
use std::f64::consts::PI;

struct Sim {
    model: RcModel,
    vals: RefCell<HashMap<String, f64>>,
    chips: RefCell<HashMap<String, f64>>,
    w: World,
    ticks: u64,
}

impl Sim {
    fn new(source: &str, no_course: bool) -> Sim {
        let model = parse_rc(source).unwrap();
        let vals = RefCell::new(model.vals.iter().map(|v| (v.name.to_uppercase(), v.default)).collect());
        let mut sim = Sim { model, vals, chips: RefCell::new(HashMap::new()), w: World::new(PhysicsOptions { no_course, ..Default::default() }), ticks: 0 };
        let a = {
            let env = |n: &str| sim.env(n);
            assemble(&sim.model, &env).unwrap().unwrap()
        };
        for t in &a.tiles {
            if let Some(n) = &t.name {
                sim.chips.borrow_mut().insert(n.clone(), t.chip_index as f64);
            }
        }
        let Sim { w, vals, chips, .. } = &mut sim;
        let env = |n: &str| vals.borrow().get(&n.to_uppercase()).copied().or_else(|| chips.borrow().get(&n.to_uppercase()).copied());
        w.build(a, &env, Vec3::default(), BuildOptions::default());
        sim
    }
    fn env(&self, n: &str) -> Option<f64> {
        self.vals.borrow().get(&n.to_uppercase()).copied().or_else(|| self.chips.borrow().get(&n.to_uppercase()).copied())
    }
    fn set(&self, name: &str, v: f64) {
        self.vals.borrow_mut().insert(name.to_uppercase(), v);
    }
    /// one 1/30 s frame: two physics steps
    fn step(&mut self) {
        let Sim { w, vals, chips, .. } = self;
        let env = |n: &str| vals.borrow().get(&n.to_uppercase()).copied().or_else(|| chips.borrow().get(&n.to_uppercase()).copied());
        for _ in 0..2 {
            w.apply_controls(&env);
            w.step(&env);
        }
        self.ticks += 1;
    }
    fn detach(&mut self, chip: usize, powerless: bool) {
        let t = self.tile(chip);
        let Sim { w, vals, chips, .. } = self;
        let env = |n: &str| vals.borrow().get(&n.to_uppercase()).copied().or_else(|| chips.borrow().get(&n.to_uppercase()).copied());
        w.detach(t, powerless, &env);
    }
    fn tile(&self, chip: usize) -> usize {
        self.w.assembly().unwrap().by_chip[chip]
    }
    fn pos(&self, chip: usize) -> Vec3 {
        self.w.pose(self.tile(chip)).position
    }
    fn x(&self, chip: usize) -> f64 {
        -self.pos(chip).x
    }
    fn y(&self, chip: usize) -> f64 {
        self.pos(chip).y
    }
    fn z(&self, chip: usize) -> f64 {
        self.pos(chip).z
    }
    fn local_vel(&self, chip: usize, axis: Vec3) -> f64 {
        let i = self.tile(chip);
        let pose = self.w.pose(i);
        let v = self.w.velocity(i, &pose);
        let a = axis.apply_quat(pose.quaternion);
        v.x * a.x + v.y * a.y + v.z * a.z
    }
    fn vx(&self, chip: usize) -> f64 {
        self.local_vel(chip, Vec3::new(-1.0, 0.0, 0.0))
    }
    fn vz(&self, chip: usize) -> f64 {
        self.local_vel(chip, Vec3::new(0.0, 0.0, 1.0))
    }
    fn ex(&self, chip: usize) -> f64 {
        -euler_yxz(self.w.pose(self.tile(chip)).quaternion)[0]
    }
    fn top(&self, chip: usize) -> usize {
        let a = self.w.assembly().unwrap();
        let mut t = self.tile(chip);
        while let (Some(p), false) = (a.tiles[t].parent, a.tiles[t].detached) {
            t = p;
        }
        a.tiles[t].chip_index
    }
    fn wheels(&self) -> Vec<usize> {
        self.w.assembly().unwrap().tiles.iter().filter(|t| t.spec.wheel).map(|t| t.chip_index).collect()
    }
    fn add_block(&mut self, half: [f64; 3], center: [f64; 3]) {
        let cd = ColliderBuilder::cuboid(half[0] as f32, half[1] as f32, half[2] as f32)
            .translation(rapier3d::math::Vector::new(center[0] as f32, center[1] as f32, center[2] as f32))
            .friction(1.0)
            .collision_groups(groups(GROUND_GROUP));
        self.w.world.insert_collider(cd, None);
    }
}

// ----------------------------------------------------------------------------------------------- calibration.test.ts

#[test]
fn original_orientation_calibration() {
    let sim = Sim::new(
        "Val {} Key {} Body { Core(){
      N:Chip(angle=30){} S:Rudder(angle=30){} E:Trim(angle=30){}
      W:Chip(angle=20){ N:Rudder(angle=40){ E:Trim(angle=15){} } }
    } }",
        false,
    );
    // Original first-frame CSV (quaternion part; _RX/_RY/_RZ belong to the script API, stage 2b)
    let expected = [
        (1, [-0.2588190734, 0.0, 0.0, 0.9659258127]),
        (2, [0.0, 0.2588190734, 0.0, 0.9659258127]),
        (3, [0.2588190734, 0.0, 0.0, 0.9659258127]),
        (4, [0.0, 0.0, -0.1736480892, 0.9848078489]),
        (5, [0.0593909100, 0.3368241191, -0.1631758660, 0.9254165888]),
        (6, [0.1796742678, 0.3126437366, -0.2057444304, 0.9097473621]),
    ];
    for (chip, want) in expected {
        let q = sim.w.pose(sim.tile(chip)).quaternion;
        let got = [q.x, -q.y, -q.z, q.w];
        for k in 0..4 {
            assert!((got[k] - want[k]).abs() < 1e-5, "chip {chip}: {got:?} vs {want:?}");
        }
    }
}

#[test]
fn original_spawn_height_differences() {
    let base = Sim::new("Val {} Key {} Body { Core(){} }", false);
    for (name, body, measured) in [
        ("flat", "N:Chip(){ N:Chip(){ N:Chip(){} } }", 1.7999992370605),
        ("tall", "N:Chip(angle=90){ N:Chip(){ N:Chip(){} } }", 1.5297012329101),
        ("diagonal", "N:Chip(){ E:Chip(){ N:Chip(){} } }", 1.3416404724121),
        ("cowl", "N:Cowl(){ N:Cowl(){ N:Cowl(){ N:Cowl(){ N:Cowl(){} } } } }", 3.0),
        ("ghost frame", "N:Frame(option=1){ N:Frame(option=1){ N:Frame(option=1){} } }", 1.799991607666),
    ] {
        let model = Sim::new(&format!("Val {{}} Key {{}} Body {{ Core(){{ {body} }} }}"), false);
        let d = model.y(0) - base.y(0);
        assert!((d - measured).abs() < 1e-5, "{name}: {d} vs {measured}");
    }
}

#[test]
fn loaded_wheel_fold_reaches_30_degrees_within_a_frame_and_holds() {
    let mut sim = Sim::new(
        "Val { A(default=90,min=-180,max=180) } Key {}
      Body { Core(){ W:Weight(option=8){} E:Weight(option=8){}
        N:Chip(angle=-90){ N:Chip(){ N:Wheel(angle=A){ N:Weight(option=4){} } } }
      } }",
        false,
    );
    let rim = sim.w.tiles.iter().position(|t| t.rim_joint.is_some()).unwrap();
    let a = sim.w.assembly().unwrap();
    let parent = a.tiles[sim.w.tiles[rim].tile].parent.unwrap();
    let axis = a.tiles[sim.w.tiles[rim].tile].rim_axis.apply_quat(sim.w.tiles[parent].body_rest_quat.invert());
    for frame in 1..=240 {
        // Lua: if _TICKS()>=120 then A=60 end (OnFrame runs before the frame's physics)
        if sim.ticks >= 120 {
            sim.set("A", 60.0);
        }
        sim.step();
        if frame < 121 {
            continue;
        }
        let pr = from_rotation(*sim.w.world.bodies[sim.w.tiles[parent].body].rotation());
        let cr = from_rotation(*sim.w.world.bodies[sim.w.tiles[rim].rim.unwrap()].rotation());
        let q = Quat::mul(pr.invert(), cr);
        let angle = 2.0 * (q.x * axis.x + q.y * axis.y + q.z * axis.z).atan2(q.w);
        // Original fold: 60.30 degrees at frame 121, 59.01 at 122, settling near 60.06.
        // This joint measures displacement relative to its initial 90 degree fold.
        let error = angle + PI / 6.0;
        assert!(error.sin().atan2(error.cos()).abs() < 2.0 * PI / 180.0, "frame {frame}: {}", angle * 180.0 / PI);
    }
}

// ------------------------------------------------------------------------------------------------------ kerb.test.ts

// The original's default Basic car driving itself at Engine 2500 (tools/orig-harness/basic_drive_2500.txt).
const BASIC: &str = "Val {
  Brake(default=0,min=0,max=80,step=80)
  HBrake(default=0,min=0,max=100,step=100)
  Handle(default=0,min=-20,max=20,step=5)
  Engine(default=2500,min=-2500,max=2500,step=0)
}
Key { }
Body { Core(){
  N:Chip(){ N:Rudder(angle=Handle){ W:Frame(){ W:Wheel(angle=90,brake=Brake){} } E:Frame(){ E:Wheel(angle=90,brake=Brake){} } } }
  S:Chip(){ W:Frame(){ W:Wheel(angle=90,power=Engine,brake=HBrake){} } E:Frame(){ E:Wheel(angle=90,power=-Engine,brake=HBrake){} } }
} }";

#[test]
fn climbs_kerbs_lower_than_the_tyre_like_the_original() {
    // Original, step face 6 m ahead, hit at 6.9 m/s: speed loss 17/60/79%, every wheel past the edge
    // 0.7/0.8/1.1 s after the hit, pitch at most 0.12/0.40/0.53 rad (docs/measured.md, kerb section).
    for (h, loss, pitch) in [(0.10, 17.0, 0.12), (0.20, 60.0, 0.40), (0.25, 79.0, 0.53)] {
        let mut sim = Sim::new(BASIC, true);
        sim.add_block([10.0, h / 2.0, 15.0], [0.0, h / 2.0, 21.0]);
        let wheels = sim.wheels();
        let (mut hit, mut over, mut v0, mut vmin, mut max_pitch) = (-1i32, -1i32, 0.0, f64::INFINITY, 0.0f64);
        let mut n = 0;
        while n < 300 && over < 0 {
            sim.step();
            let zs: Vec<f64> = wheels.iter().map(|&w| sim.z(w)).collect();
            let v = sim.vx(0).hypot(sim.vz(0));
            if hit < 0 && zs.iter().cloned().fold(f64::MIN, f64::max) > 5.68 {
                hit = n;
                v0 = v;
            }
            if hit >= 0 {
                vmin = vmin.min(v);
                max_pitch = max_pitch.max(sim.ex(0).abs());
            }
            if hit >= 0 && zs.iter().cloned().fold(f64::MAX, f64::min) > 6.6 {
                over = n;
            }
            n += 1;
        }
        let lost = 100.0 * (1.0 - vmin / v0);
        println!("kerb {h}: hit {hit} over {over} loss {lost:.1}% (original {loss}) pitch {max_pitch:.2} (original {pitch})");
        assert!(hit > 0, "kerb {h}: never reached");
        assert!(over >= 0 && over - hit < 45, "kerb {h}: over {over} hit {hit}");
        assert!((lost - loss).abs() < 15.0, "kerb {h}: loss {lost}");
        assert!(max_pitch < pitch + 0.15, "kerb {h}: pitch {max_pitch}");
    }
}

#[test]
fn crosses_a_1m_ditch_without_being_launched_by_its_far_lip() {
    // Original (terrain probe "ditch", 150 m base): a 1 m wide, 2 m deep ditch 10 m ahead is crossed at 9 m/s with
    // pitch at most 0.13 rad, the leading hubs rising to 0.41 m. (The TypeScript test removes slabs of half extent
    // 2000 first; the ground is 100 km now, so it removes nothing, and neither does this port.)
    let mut sim = Sim::new(BASIC, true);
    for [y0, y1, z0, z1] in [[-1.0, 0.0, -40.0, 10.0], [-3.0, -2.0, 10.0, 11.0], [-1.0, 0.0, 11.0, 250.0]] {
        sim.add_block([30.0, (y1 - y0) / 2.0, (z1 - z0) / 2.0], [0.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0]);
    }
    let wheels = sim.wheels();
    let (mut pitch, mut hub) = (0.0f64, 0.0f64);
    for n in 0..200 {
        sim.step();
        if n > 60 {
            pitch = pitch.max(sim.ex(0).abs());
            hub = wheels.iter().fold(hub, |m, &w| m.max(sim.y(w)));
        }
    }
    assert!(sim.z(0) > 30.0, "z {}", sim.z(0));
    assert!(pitch < 0.25, "pitch {pitch}");
    assert!(hub < 0.6, "hub {hub}");
}

#[test]
fn stops_dead_at_a_wall_instead_of_rebounding() {
    // Original (terrain probe "wall"): a 2 m wall 15 m ahead, hit at 10.5 m/s, stops the car dead at z = 14.1.
    let mut sim = Sim::new(BASIC, true);
    sim.add_block([10.0, 1.0, 0.5], [0.0, 1.0, 15.5]);
    let mut min_vz = f64::INFINITY;
    for n in 0..200 {
        sim.step();
        if n > 85 {
            min_vz = min_vz.min(sim.vz(0));
        }
    }
    assert!(min_vz > -1.5, "rebound {min_vz}");
    assert!((sim.z(0) - 14.1).abs() < 0.5, "z {}", sim.z(0));
}

// --------------------------------------------------------------------------------------------------- physics.test.ts

#[test]
fn an_arm_charges_fires_when_power_reaches_option_and_recoils() {
    let mut sim = Sim::new(
        "Val { P(default=0, min=0, max=100000, step=100000) }
      Key { 4:P(step=100000) }
      Body { Core(){ W:Weight(){} E:Weight(){} S:Chip(){} N:Chip(angle=-90){ N:Arm(angle=90, power=P, option=30000, name=GUN){} } } }",
        false,
    );
    let gun = sim.tile(sim.env("GUN").unwrap() as usize);
    for _ in 0..160 {
        sim.step(); // > 150 frames: armed and charged
    }
    assert_eq!(sim.w.arm_charge.get(&gun).copied(), Some(30000.0));
    sim.set("P", 100000.0); // key 4 held: P += 100000, clamped
    sim.step();
    assert_eq!(sim.w.projectiles.len(), 1);
    let v = sim.w.world.bodies[sim.w.projectiles[0].body].linvel();
    assert!(v.z < -50.0, "fired north: {v:?}");
    assert!(sim.w.arm_charge[&gun] < 5000.0, "charge spent: {}", sim.w.arm_charge[&gun]);
}

#[test]
fn bye_cuts_a_subtree_loose() {
    let mut sim = Sim::new(
        "Val { }
      Key { }
      Body { Core(){ W:Chip(angle=90){ W:Wheel(){} } E:Chip(angle=90){ E:Wheel(){} } N:Chip(name=NOSE){ N:Chip(){ N:Chip(){ } } } } }",
        false,
    );
    let nose = sim.env("NOSE").unwrap() as usize;
    for _ in 0..19 {
        sim.step();
    }
    assert_eq!(sim.top(nose + 2), 0);
    for _ in 0..40 {
        // Lua: if _TICKS() == 20 then x = _BYE(NOSE) end
        if sim.ticks == 20 {
            sim.detach(nose, true);
        }
        sim.step();
    }
    // chip numbers: Core 0, W chip 1, W wheel 2+3, E chip 4, E wheel 5+6, NOSE 7
    assert_eq!(nose, 7);
    assert_eq!(sim.top(nose + 2), 7); // NOSE is now its own root
    let t = sim.tile(nose);
    assert!(sim.w.assembly().unwrap().tiles[t].detached);
    assert!(sim.w.assembly().unwrap().tiles[t].powerless);
    assert_ne!(sim.w.tiles[t].body, sim.w.tiles[0].body);
    assert!(sim.y(nose) < sim.y(0) + 0.5);
}

#[test]
fn a_balloon_jet_lifts_regardless_of_its_tilt() {
    let mut sim = Sim::new("Val { } Key { } Body { Core(){ N:Jet(angle=-90, power=60000, option=1){} } }", false);
    let y0 = sim.y(0);
    for _ in 0..60 {
        sim.step();
    }
    assert!(sim.y(0) > y0 + 2.0, "{} -> {}", y0, sim.y(0));
}

// ----------------------------------------------------------------------------------------------------- rotor.test.ts

#[test]
fn a_wheel_carrying_chips_is_a_rotor() {
    // tools/orig-harness/rc_models34.sh: a horizontal RLW on a weighted base carrying two chips, powered from frame 60.
    // Steady spin of the carried chips in the original: 26.1 / 43.8 / 64.3 rad/s with two Trims, 20.5 with two Weights;
    // +power turns them clockwise seen from above in the original's frame
    for (power, carried, want) in [(5000.0, "Trim", 26.1), (20000.0, "Trim", 43.8), (60000.0, "Trim", 64.3), (20000.0, "Weight", 20.5)] {
        let mut sim = Sim::new(
            &format!("Val {{ P(default=0,min=-100000,max=100000) }}
Key {{ }}
Body {{ Core(){{ N:RLW(angle=0,power=P){{ W:{carried}(){{ }} E:{carried}(){{ }} }} W:Weight(){{ }} E:Weight(){{ }} S:Weight(){{ S:Weight(){{ }} }} }} }}"),
            true,
        );
        let ang = |s: &Sim| (s.z(3) - s.z(2)).atan2(s.x(3) - s.x(2));
        let run = |s: &mut Sim| {
            if s.ticks >= 60 {
                s.set("P", power);
            }
            s.step();
        };
        for _ in 1..=200 {
            run(&mut sim);
        }
        let (mut prev, mut turned) = (ang(&sim), 0.0);
        for _ in 0..30 {
            run(&mut sim);
            let a = ang(&sim);
            turned += (a - prev).sin().atan2((a - prev).cos());
            prev = a;
        }
        assert!(-turned > want * 0.95 && -turned < want * 1.05, "{power} {carried}: {} rad/s, original {want}", -turned);
        assert!(sim.y(0) < 0.3, "the base stays down: {}", sim.y(0));
    }
}

// ---------------------------------------------------------------------------------------------- spring-servo.test.ts

#[test]
fn joints_with_spring_below_1_follow_their_command_like_a_damped_spring() {
    // tools/orig-harness/rc_models32.sh: an arm standing up from a heavy base, its hinge commanded −90 → −60 at frame 150.
    // Fraction of the commanded swing reached 1, 3 and 6 frames after the command in the original (sdarm_<spring>_0.5).
    for (spring, want) in [(0.05, [0.04, 0.13, 0.38]), (0.1, [0.16, 0.58, 1.04]), (0.2, [0.47, 1.23, 0.97]), (1.0, [1.0, 1.0, 1.0])] {
        let mut sim = Sim::new(
            &format!("Val {{ A(default=-90,min=-180,max=180) }}
Key {{ }}
Body {{ Core(){{ N:Frame(angle=A,spring={spring},damper=0.5){{ N:Chip(){{ N:Chip(){{ N:Chip(){{ }} }} }} }} W:Weight(){{ }} E:Weight(){{ }} S:Chip(){{ S:Weight(){{ }} }} }} }}"),
            true,
        );
        let p = |s: &Sim, c: usize| [s.x(c), s.y(c), s.z(c)];
        let angle = |s: &Sim| {
            let (a, b, c, d) = (p(s, 0), p(s, 1), p(s, 2), p(s, 4));
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let w = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
            let dot = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
            (dot / (u[0].hypot(u[1]).hypot(u[2])) / (w[0].hypot(w[1]).hypot(w[2]))).acos()
        };
        let mut seen = vec![0.0; 221];
        for f in 1..=220 {
            if sim.ticks >= 150 {
                sim.set("A", -60.0);
            }
            sim.step();
            seen[f] = angle(&sim);
        }
        let (a0, a1) = (seen[150], seen[220]);
        let got: Vec<f64> = [151, 153, 156].iter().map(|&f| (a0 - seen[f]) / (a0 - a1)).collect();
        // the overshoot is under-reproduced (rapier's implicit motor adds damping): spring 0.2 peaks at ~0.95, not 1.23
        for k in 0..3 {
            assert!((got[k] - want[k]).abs() < 0.35, "spring {spring}: {got:?} vs {want:?}");
        }
    }
}

#[test]
fn joints_with_spring_below_1_give_under_load() {
    // tools/orig-harness/rc_models33.sh: the arm at 45° elevation with a Weight at its tip, never commanded.
    // The original's elevation after settling (sd_sag_v_<spring>): 43.6 / 41.3 / 30.3°, and 0.02 lies on the ground
    for (spring, want) in [(0.2, 43.6), (0.1, 41.3), (0.05, 30.3), (0.02, 0.2)] {
        let mut sim = Sim::new(
            &format!("Val {{ A(default=-45,min=-180,max=180) }}
Key {{ }}
Body {{ Core(){{ N:Frame(angle=A,spring={spring},damper=0.5){{ N:Chip(){{ N:Chip(){{ N:Weight(){{ }} }} }} }} W:Weight(){{ }} E:Weight(){{ }} S:Chip(){{ S:Weight(){{ W:Weight(){{ }} E:Weight(){{ }} }} }} }} }}"),
            true,
        );
        for _ in 1..=200 {
            sim.step();
        }
        let d = [sim.x(4) - sim.x(2), sim.y(4) - sim.y(2), sim.z(4) - sim.z(2)];
        let el = d[1].atan2(d[0].hypot(d[2])) * 180.0 / PI;
        assert!((el - want).abs() < 2.0, "spring {spring}: {el:.1}° vs {want}");
    }
}
