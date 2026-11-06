//! Read a self-authored flight-probe model and log the same physical quantities as B26.
use snaptiles_core::{Simulation, PhysicsOptions};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let source = std::fs::read_to_string(&args[1]).unwrap();
    let frames: usize = args.get(2).map_or(900, |s| s.parse().unwrap());
    let u: usize = args.get(3).map_or(0, |s| s.parse().unwrap());
    assert!(!args.get(4).is_some_and(|s| s == "thrust"), "A=0 currently only stores the flag; a native thrust-only comparison would be invalid");
    let air = 1;
    let gravity = if args.get(4).is_some_and(|s| s == "thrust" || s == "fixed-plane") { 0 } else { 1 };
    let mut sim = Simulation::load(&source, PhysicsOptions { no_course: true, gravity: -9.8, ..Default::default() }).unwrap();
    for (key, value) in [("U", u), ("A", air), ("G", gravity), ("E", 1)] { sim.state_mut().world.regulations.insert(key.into(), value as f64); }
    let count = sim.api("_CHIPS", &[]) as usize;
    print!("frame,y,vy,h,z,vz,pitch,x,yaw,vx,roll,weight");
    for c in 0..count { print!(",parent{c}"); } println!();
    for frame in 1..=frames {
        // The original scenario changes G after the first observed frame.
        if gravity == 0 && frame == 2 { sim.state_mut().world.world.gravity = rapier3d::math::Vector::new(0.0, 0.0, 0.0); }
        sim.step();
        print!("{frame}");
        for key in ["_Y","_VY","_H","_Z","_VZ","_EX","_X","_EY","_VX","_EZ"] {
            print!(",{}",sim.api(key,&[0.0]));
        }
        print!(",{}",sim.api("_WEIGHT",&[]));
        for c in 0..count { print!(",{}",sim.api("_PARENT",&[c as f64])); } println!();
    }
}
