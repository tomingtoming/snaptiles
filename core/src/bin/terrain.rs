//! Terrain and step probes: the Rust counterpart of the former `tools/terrain-compare.ts` and `tools/step-compare.ts`.
//!
//!   cargo run --release --features tools --bin terrain -- <scene|all> <out-dir> [--model=<file>] [--frames=450]
//!   cargo run --release --features tools --bin terrain -- step <out.csv> --h=0.10 [--model=<file>] [--frames=450]
//!
//! Scenes come from `tools/orig-harness/terrains.json` (`rc_terrain.sh` on the original): the scene's ground replaces
//! the default one, boxes are cuboids and ramps one convex wedge each (slope and plateau, so the crest has no seam).
//! `step` is `rc_step.sh`: the default ground plus a box `h` m tall spanning x −10..10, z 6..36. The model drives itself
//! by its Val defaults (default `tools/orig-harness/basic_drive_2500.txt`). Columns match `harness_step.rcs`: core
//! pose, velocity, Euler, then y, z and `_WY` of the first four Wheel/RLW chips. Paths are relative to the repository.
use rapier3d::geometry::ColliderBuilder;
use rapier3d::math::Vector;
use snaptiles_core::js::number_to_string as js;
use snaptiles_core::{PhysicsOptions, Simulation};
use std::fs;
use std::path::PathBuf;

fn repo(p: &str) -> PathBuf {
    let p = PathBuf::from(p);
    if p.is_absolute() { p } else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(p) }
}

fn cuboid(sim: &mut Simulation, b: &[f64]) {
    let [x0, x1, y0, y1, z0, z1] = [b[0], b[1], b[2], b[3], b[4], b[5]];
    let cd = ColliderBuilder::cuboid(((x1 - x0) / 2.0) as f32, ((y1 - y0) / 2.0) as f32, ((z1 - z0) / 2.0) as f32)
        .translation(Vector::new(((x0 + x1) / 2.0) as f32, ((y0 + y1) / 2.0) as f32, ((z0 + z1) / 2.0) as f32));
    sim.add_ground_collider(cd);
}

fn ramp(sim: &mut Simulation, r: &[f64]) {
    let [x0, x1, z0, z1, h, z_end] = [r[0], r[1], r[2], r[3], r[4], r[5]];
    let pts: Vec<Vector> = [[x0, 0.0, z0], [x1, 0.0, z0], [x0, 0.0, z_end], [x1, 0.0, z_end], [x0, h, z1], [x1, h, z1], [x0, h, z_end], [x1, h, z_end]]
        .iter()
        .map(|p| Vector::new(p[0] as f32, p[1] as f32, p[2] as f32))
        .collect();
    sim.add_ground_collider(ColliderBuilder::convex_hull(&pts).expect("ramp hull"));
}

fn run(sim: &mut Simulation, frames: usize) -> String {
    let wheels: Vec<usize> = sim.wheel_chips().into_iter().take(4).collect();
    let mut rows = vec!["frame,x,y,z,vx,vy,vz,ex,ey,ez,w0y,w0z,w0wy,w1y,w1z,w1wy,w2y,w2z,w2wy,w3y,w3z,w3wy".to_string()];
    for n in 1..=frames {
        sim.step();
        let mut row = vec![n as f64];
        for f in ["_X", "_Y", "_Z", "_VX", "_VY", "_VZ", "_EX", "_EY", "_EZ"] {
            row.push(sim.api(f, &[0.0]));
        }
        for i in 0..4 {
            match wheels.get(i) {
                Some(&c) => row.extend(["_Y", "_Z", "_WY"].map(|f| sim.api(f, &[c as f64]))),
                None => row.extend([0.0, 0.0, 0.0]),
            }
        }
        rows.push(row.iter().map(|&x| js(x)).collect::<Vec<_>>().join(","));
    }
    rows.join("\n") + "\n"
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opt = |k: &str| args.iter().find_map(|a| a.strip_prefix(&format!("--{k}=")).map(str::to_string));
    let pos: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if pos.len() < 2 {
        eprintln!("usage: terrain <scene|all|step> <out> [--model=…] [--frames=450] [--h=0.10]");
        std::process::exit(2);
    }
    let model = fs::read_to_string(repo(&opt("model").unwrap_or("tools/orig-harness/basic_drive_2500.txt".into()))).expect("model");
    let frames: usize = opt("frames").map(|f| f.parse().unwrap()).unwrap_or(450);
    if pos[0] == "step" {
        let h: f64 = opt("h").map(|f| f.parse().unwrap()).unwrap_or(0.1);
        let mut sim = Simulation::load(&model, PhysicsOptions { no_course: true, ..Default::default() }).expect("load");
        cuboid(&mut sim, &[-10.0, 10.0, 0.0, h, 6.0, 36.0]);
        fs::write(pos[1], run(&mut sim, frames)).expect("write");
        return;
    }
    let spec: serde_json::Value = serde_json::from_str(&fs::read_to_string(repo("tools/orig-harness/terrains.json")).unwrap()).unwrap();
    let scenes: Vec<String> = if pos[0] == "all" { spec["scenes"].as_object().unwrap().keys().cloned().collect() } else { vec![pos[0].clone()] };
    let nums = |v: &serde_json::Value| -> Vec<f64> { v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect() };
    for name in scenes {
        let scene = &spec["scenes"][&name];
        let mut sim = Simulation::load(&model, PhysicsOptions { no_course: true, no_ground: true, ..Default::default() }).expect("load");
        // the scene's ground (one box or a list of boxes), else the probe land
        let ground = if scene["ground"].is_array() { scene["ground"].clone() } else { spec["ground"].clone() };
        if ground[0].is_array() {
            for g in ground.as_array().unwrap() {
                cuboid(&mut sim, &nums(g));
            }
        } else {
            cuboid(&mut sim, &nums(&ground));
        }
        for s in scene["solids"].as_array().unwrap() {
            if s["box"].is_array() { cuboid(&mut sim, &nums(&s["box"])) } else { ramp(&mut sim, &nums(&s["ramp"])) }
        }
        fs::write(PathBuf::from(pos[1]).join(format!("{name}_p2500.csv")), run(&mut sim, frames)).expect("write");
        println!("{name} done");
    }
}
