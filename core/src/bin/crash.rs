//! Controlled drop counterpart of tools/orig-harness/crash-probe.py.
//! cargo run --release --bin crash -- Weight 200 90
//! Emits per-substep poses, velocities, ground impulses and detached state.
use snaptiles_core::model::{assemble, refresh_joint_frames, Quat, Vec3};
use snaptiles_core::physics::{BuildOptions, World};
use snaptiles_core::physics::math::{from_vector, V3};
use snaptiles_core::rc::parse_rc;
use snaptiles_core::PhysicsOptions;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert!((3..=5).contains(&args.len()), "usage: crash <Chip|Frame|Weight|model-path> <height> <roll-degrees> [pitch-degrees] [unbreakable]");
    let pitch = args.get(3).map(|s| s.parse::<f64>().expect("pitch")).unwrap_or(0.0).to_radians();
    let height: f64 = args[1].parse().expect("height");
    let roll: f64 = args[2].parse::<f64>().expect("roll").to_radians();
    assert!(height.is_finite() && height > 0.0 && height <= 1000.0 && roll.is_finite());
    let specimen = "Val {}\nKey {}\nBody { Core(){ N:PART(){ N:PART(){} } S:PART(){} W:PART(){} E:PART(){} } }".replace("PART", &args[0]);
    let source = if ["Chip", "Frame", "Weight"].contains(&args[0].as_str()) { specimen } else { std::fs::read_to_string(&args[0]).expect("model file") };
    let model = parse_rc(&source).expect("parse");
    let env = |name: &str| model.vals.iter().find(|v| v.name.eq_ignore_ascii_case(name)).map(|v| v.default);
    let a = assemble(&model, &env).expect("assemble").expect("body");
    let mut w = World::new(PhysicsOptions { no_course: true, ..Default::default() });
    w.regulations.insert("U".into(), 1.0);
    w.build(a, &env, Vec3::default(), BuildOptions::default());
    // Match the original's frame-180 protocol: settle on the landing gear first.
    for _ in 0..358 { w.apply_controls(&env); w.step(&env); }
    let center = w.pose(0).position;
    let mut a = w.assembly().unwrap().clone();
    for i in 0..a.tiles.len() {
        let pose = w.pose(i);
        a.tiles[i].position = pose.position.sub(center);
        a.tiles[i].quaternion = pose.quaternion;
    }
    w.regulations.insert("U".into(), args.get(4).map(|v| v.parse().expect("U")).unwrap_or(0.0));
    // Original W is +x; this engine mirrors x, so negate the original roll.
    let q = Quat::mul(Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), pitch), Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), -roll));
    for tile in &mut a.tiles {
        tile.position = tile.position.apply_quat(q).add(Vec3::new(0.0, height, 0.0));
        tile.quaternion = Quat::mul(q, tile.quaternion);
    }
    for i in 0..a.tiles.len() { refresh_joint_frames(&mut a.tiles, i); }
    w.build(a, &env, Vec3::default(), BuildOptions { in_place: true, velocities: None });
    for t in &w.assembly().unwrap().tiles { eprintln!("tile {} chip {} parent {:?} type {} mass {}",t.id,t.chip_index,t.parent,t.type_,t.mass); }
    println!("step,tile,x,y,z,vx,vy,vz,ix,iy,iz,detached");
    for step in 0..840 {
        let velocities: Vec<_> = (0..w.tiles.len()).map(|i| w.velocity(i, &w.pose(i))).collect();
        // A=0: no aerodynamic/control force; gravity and contacts remain active.
        w.step(&env);
        for (i, tb) in w.tiles.iter().enumerate() {
            let mut impulse = Vec3::default();
            for &ch in w.world.bodies[tb.body].colliders() {
                let collider = &w.world.colliders[ch];
                let local = from_vector(collider.position_wrt_parent().unwrap().translation);
                if local.sub(tb.rel_pos).length_sq() > 1e-8 { continue; }
                for pair in w.world.narrow_phase.contact_pairs_with(ch) {
                    for m in pair.manifolds() {
                        let sum: f64 = m.points.iter().map(|p| p.data.impulse as f64).sum();
                        let normal = from_vector(m.data.normal).scale(if pair.collider1 == ch { -1.0 } else { 1.0 });
                        impulse = impulse.add(normal.scale(sum));
                    }
                }
            }
            let p = w.pose(i).position;
            let v = velocities[i];
            let detached = w.assembly().unwrap().tiles[i].detached;
            println!("{step},{i},{},{},{},{},{},{},{},{},{},{detached}", p.x,p.y,p.z,v.x,v.y,v.z,impulse.x,impulse.y,impulse.z);
        }
    }
}
