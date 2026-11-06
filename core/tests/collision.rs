//! Black-box B26 collision outcomes recorded in docs/measured.md.
use snaptiles_core::model::{assemble, refresh_joint_frames, Quat, Vec3};
use snaptiles_core::physics::{BuildOptions, World};
use snaptiles_core::rc::parse_rc;
use snaptiles_core::{PhysicsOptions, Simulation};

fn drop_model(part: &str, height: f64, pitch: f64, roll: f64, unbreakable: bool) -> World {
    let source = "Val {}\nKey {}\nBody { Core(){ N:PART(){ N:PART(){} } S:PART(){} W:PART(){} E:PART(){} } }".replace("PART", part);
    let model = parse_rc(&source).unwrap();
    let env = |_: &str| None;
    let mut a = assemble(&model, &env).unwrap().unwrap();
    let q = Quat::mul(Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), pitch.to_radians()),
        Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), -roll.to_radians()));
    for t in &mut a.tiles {
        t.position = t.position.apply_quat(q).add(Vec3::new(0.0, height, 0.0));
        t.quaternion = Quat::mul(q, t.quaternion);
    }
    for i in 0..a.tiles.len() { refresh_joint_frames(&mut a.tiles, i); }
    let mut w = World::new(PhysicsOptions { no_course: true, ..Default::default() });
    w.build(a, &env, Vec3::default(), BuildOptions { in_place: true, velocities: None });
    w.regulations.insert("U".into(), if unbreakable { 1.0 } else { 0.0 });
    // B26 A=0 drop: controls/aerodynamic forces are absent; gravity/contacts remain.
    for _ in 0..840 { w.step(&env); }
    w
}

#[test]
fn matches_original_drop_mass_height_and_orientation_cases() {
    for (part, height, pitch, roll, expected) in [
        ("Weight", 100.0, 0.0, 90.0, vec![]),
        ("Weight", 150.0, 0.0, 90.0, vec![5]),
        ("Weight", 200.0, 0.0, 90.0, vec![4,5]),
        ("Weight", 300.0, 0.0, 90.0, vec![4,5]),
        ("Chip", 300.0, 0.0, 90.0, vec![]),
        ("Frame", 300.0, 0.0, 90.0, vec![]),
        // Independent orientation checks, not used to select the thresholds.
        ("Weight", 300.0, 0.0, 0.0, vec![]),
        ("Weight", 200.0, 90.0, 0.0, vec![1,3]),
    ] {
        let w = drop_model(part, height, pitch, roll, false);
        let a = w.assembly().unwrap();
        let cuts: Vec<_> = a.tiles.iter().filter(|t| t.detached).map(|t| t.id).collect();
        assert_eq!(cuts, expected, "{part} height={height} pitch={pitch} roll={roll}");
        assert!(a.tiles.iter().all(|t| t.durability.unwrap_or(10000.0) == 10000.0));
        for t in a.tiles.iter().filter(|t| t.detached) { assert!(t.powerless); }
    }
}

#[test]
fn unbreakable_blocks_the_same_destructive_collision() {
    let w = drop_model("Weight", 300.0, 0.0, 90.0, true);
    assert!(w.assembly().unwrap().tiles.iter().all(|t| !t.detached));
}

#[test]
fn detached_parent_api_agrees_with_top_and_reset_restores_the_tree() {
    let mut sim = Simulation::load("Val {}\nKey {}\nBody { Core(){ N:Chip(){ N:Chip(){} } } }\nLua { function OnFrame() end }", PhysicsOptions::default()).unwrap();
    sim.eval_lua("_BYE(1); assert(_PARENT(1)==-1); assert(_GET(1,'PARENT')==-1); assert(_TOP(2)==1); assert(_T(1)==10000)").unwrap();
    sim.reset();
    sim.eval_lua("assert(_PARENT(1)==0); assert(_GET(1,'PARENT')==0); assert(_TOP(2)==0)").unwrap();
}

#[test]
fn stock_plane_matches_original_controlled_crashes() {
    let text = include_str!("../../src/samples/plane.ts").replace('\r', "");
    let source = text.split('`').nth(1).unwrap().split("\nLua").next().unwrap();
    let model = parse_rc(source).unwrap();
    let env = |name: &str| model.vals.iter().find(|v| v.name.eq_ignore_ascii_case(name)).map(|v| v.default);
    for (height, expected) in [(100.0, vec![]), (200.0, vec![31]), (300.0, vec![26,31,32])] {
        let a = assemble(&model, &env).unwrap().unwrap();
        let mut w = World::new(PhysicsOptions { no_course: true, ..Default::default() });
        w.regulations.insert("U".into(), 1.0);
        w.build(a, &env, Vec3::default(), BuildOptions::default());
        for _ in 0..358 { w.apply_controls(&env); w.step(&env); }
        let center = w.pose(0).position;
        let q = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), std::f64::consts::FRAC_PI_2);
        let mut a = w.assembly().unwrap().clone();
        for (i, t) in a.tiles.iter_mut().enumerate() {
            let pose = w.pose(i);
            t.position = pose.position.sub(center).apply_quat(q).add(Vec3::new(0.0, height, 0.0));
            t.quaternion = Quat::mul(q, pose.quaternion);
        }
        for i in 0..a.tiles.len() { refresh_joint_frames(&mut a.tiles, i); }
        w.build(a, &env, Vec3::default(), BuildOptions { in_place: true, velocities: None });
        w.regulations.insert("U".into(), 0.0);
        for _ in 0..840 { w.step(&env); }
        let a = w.assembly().unwrap();
        let cuts: Vec<_> = a.tiles.iter().filter(|t| t.detached).map(|t| t.chip_index).collect();
        assert_eq!(cuts, expected, "stock plane {height} m");
        assert!(a.tiles.iter().all(|t| t.durability.unwrap_or(10000.0) == 10000.0));
    }
}

#[test]
fn splitting_a_spinning_body_preserves_velocity_at_every_chip() {
    use snaptiles_core::physics::math::{from_vector, to_vector, V3};
    let model = parse_rc("Val {}\nKey {}\nBody { Core(){ N:Chip(){ N:Weight(){} } S:Chip(){} } }").unwrap();
    let env = |_: &str| None;
    let a = assemble(&model, &env).unwrap().unwrap();
    let mut w = World::new(PhysicsOptions { no_course: true, no_ground: true, ..Default::default() });
    w.build(a, &env, Vec3::new(0.0, 10.0, 0.0), BuildOptions::default());
    w.step(&env);
    let h = w.tiles[0].body;
    w.world.bodies[h].set_linvel(to_vector(Vec3::new(3.0, 4.0, 5.0)), true);
    w.world.bodies[h].set_angvel(to_vector(Vec3::new(1.0, 2.0, 3.0)), true);
    let expected: Vec<_> = (0..w.tiles.len()).map(|i| from_vector(w.world.bodies[h].velocity_at_point(to_vector(w.pose(i).position)))).collect();
    w.detach(1, true, &env);
    for (i, expected) in expected.iter().enumerate() {
        let actual = from_vector(w.world.bodies[w.tiles[i].body].velocity_at_point(to_vector(w.pose(i).position)));
        assert!(actual.sub(*expected).length_sq() < 1e-8, "chip {i}: {actual:?} vs {expected:?}");
    }
}
