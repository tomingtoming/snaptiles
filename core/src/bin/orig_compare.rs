//! Replay the original-exe measurement harness on the Rust core (the former `tools/orig-compare.ts`):
//!
//!   cargo run --release --bin orig_compare -- <model.txt> <out.csv> [--allwheels] [--power=2500] [--on=31] [--off=150]
//!       [--frames=330] [--geomAt=30] [--self] [--nocourse] [--key=N:from:to] [--chips6|--chips10|--turn|--wheels|--arm|--fuel]
//!
//! Every frame in [on, off] the Val ENGINE is forced to `power` (the harness scenario in the original sets POWER on
//! every wheel; `--allwheels` gives the Basic car's front wheels power=±Engine too); `--self` leaves ENGINE to the
//! model. `--key=N:from:to` holds key N during those frames (xdotool held it on the original). The columns are those
//! of the original's log for the chosen harness (default `log.txt`: frame,x,y,z,vx,vy,vz,ex,ey,ez,chips,wheel,
//! wheelpow,wheelwy,wheely, plus `<out>.geom.csv` at frame geomAt; `--chips6` harness_servo.rcs, `--chips10`
//! harness_servo2.rcs, `--turn` harness_turn2.rcs, `--wheels` harness_wheels.rcs, `--arm` harness_arm.rcs, `--fuel`
//! harness_fuel.rcs). The default course is in place unless `--nocourse` (the TypeScript tool's `--tune={"noCourse":true}`). Model files that are not UTF-8 are read lossily (names and comments).
use snaptiles_core::js::to_fixed;
use snaptiles_core::sim::api::{Arg, Ret};
use snaptiles_core::{PhysicsOptions, Simulation};
use std::fs;

fn f4(x: f64) -> String {
    to_fixed(x, 4)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |k: &str| args.iter().any(|a| a == &format!("--{k}"));
    let opt = |k: &str, d: f64| args.iter().find_map(|a| a.strip_prefix(&format!("--{k}=")).map(|v| v.parse::<f64>().unwrap())).unwrap_or(d);
    let pos: Vec<&String> = args.iter().filter(|a| !a.starts_with("--")).collect();
    let file = pos.first().expect("usage: orig_compare <model.txt> <out.csv> [options]");
    let out_file = pos.get(1).map(|s| s.as_str()).unwrap_or("orig-compare.csv").to_string();
    let (power, on, off, frames, geom_at) = (opt("power", 2500.0), opt("on", 31.0) as i64, opt("off", 150.0) as i64, opt("frames", 330.0) as i64, opt("geomAt", 30.0) as i64);
    let (chips6, chips10, self_drive, turn, wheels, arm, fuel) = (flag("chips6"), flag("chips10"), flag("self"), flag("turn"), flag("wheels"), flag("arm"), flag("fuel"));
    let key: Option<Vec<i64>> = args.iter().find_map(|a| a.strip_prefix("--key=").map(|v| v.split(':').map(|x| x.parse().unwrap()).collect()));

    let mut src = String::from_utf8_lossy(&fs::read(file).expect("model")).into_owned();
    if flag("allwheels") {
        src = src.replace("W:Wheel(angle=90,brake=Brake)", "W:Wheel(angle=90,power=Engine,brake=Brake)");
        src = src.replace("E:Wheel(angle=90,brake=Brake)", "E:Wheel(angle=90,power=-Engine,brake=Brake)");
    }
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: flag("nocourse"), ..Default::default() }).expect("load");
    let a = |sim: &Simulation, f: &str, n: f64| sim.api(f, &[n]);
    let get = |sim: &Simulation, n: f64, what: &str| match sim.state_mut().call_api("_GET", &[Arg::Num(n), Arg::Str(what.into())]) {
        Ret::Num(x) => x,
        Ret::Str(_) => 0.0,
    };
    let wheel_chips = sim.wheel_chips();
    let wheel_no = wheel_chips.first().map(|&c| c as i64).unwrap_or(-1);
    let has_engine = sim.val("ENGINE").is_some();
    if !has_engine && !chips6 && !self_drive {
        panic!("model has no ENGINE val");
    }
    let header = if chips10 {
        format!("frame,{}", (0..10).map(|c| format!("x{c},y{c},z{c}")).collect::<Vec<_>>().join(","))
    } else if fuel {
        "frame,x,y,z,vx,vy,vz,fuel,fuelmax,fuel0,fuelmax0,fuel1,chips".into()
    } else if arm {
        format!("frame,x,y,z,vx,vy,vz,ex,ey,ez,{}", (0..20).map(|i| format!("t{i}")).collect::<Vec<_>>().join(","))
    } else if wheels {
        "frame,x,y,z,vx,vy,vz,ex,ey,ez,w0,w1,w2,w3,w4,w5".into()
    } else if turn {
        "frame,x,y,z,c1x,c1z,vx,vy,vz,wx,wy,wz,ax,ay,az,ex,ey,ez".into()
    } else if chips6 {
        format!("frame,{}", (0..6).map(|c| format!("x{c},y{c},z{c},ex{c},ey{c},ez{c}")).collect::<Vec<_>>().join(","))
    } else {
        "frame,x,y,z,vx,vy,vz,ex,ey,ez,chips,wheel,wheelpow,wheelwy,wheely".into()
    };
    let mut rows = vec![header];
    let mut prev = sim.core_position();
    let pose = |sim: &Simulation| ["_X", "_Y", "_Z", "_VX", "_VY", "_VZ", "_EX", "_EY", "_EZ"].map(|f| f4(a(sim, f, 0.0))).join(",");
    for n in 1..=frames {
        if let Some(k) = &key {
            if n >= k[1] && n <= k[2] { sim.press(k[0] as usize) } else { sim.release(k[0] as usize) }
        }
        let p = if n >= on && n <= off { power } else { 0.0 };
        if has_engine && !self_drive {
            if let Some(v) = sim.state_mut().vars.val_mut("ENGINE") {
                v.default = p;
                v.value = p;
            }
        }
        sim.step();
        let chips = a(&sim, "_CHIPS", 0.0);
        let row = if chips10 {
            let m = chips - 1.0;
            let cols: Vec<String> = (0..10).map(|c| if (c as f64) <= m { ["_X", "_Y", "_Z"].map(|f| f4(a(&sim, f, c as f64))).join(",") } else { ",,".into() }).collect();
            format!("{n},{}", cols.join(","))
        } else if fuel {
            let xs = ["_X", "_Y", "_Z", "_VX", "_VY", "_VZ"].map(|f| f4(a(&sim, f, 0.0))).join(",");
            let fv = [a(&sim, "_FUEL", 0.0), a(&sim, "_FUELMAX", 0.0), get(&sim, 0.0, "FUEL"), get(&sim, 0.0, "FUELMAX"), get(&sim, 1.0, "FUEL"), chips];
            format!("{n},{xs},{}", fv.map(|x| snaptiles_core::js::number_to_string(x)).join(","))
        } else if arm {
            let ts: Vec<String> = (0..20).map(|c| snaptiles_core::js::number_to_string(if (c as f64) < chips { a(&sim, "_T", c as f64) } else { -2.0 })).collect();
            format!("{n},{},{}", pose(&sim), ts.join(","))
        } else if wheels {
            let mut ws: Vec<f64> = wheel_chips.iter().take(6).map(|&c| a(&sim, "_WY", c as f64)).collect();
            ws.resize(6, 0.0);
            format!("{n},{},{}", pose(&sim), ws.iter().map(|&x| f4(x)).collect::<Vec<_>>().join(","))
        } else if turn {
            let cols = [(0, "_X"), (0, "_Y"), (0, "_Z"), (1, "_X"), (1, "_Z"), (0, "_VX"), (0, "_VY"), (0, "_VZ"), (0, "_WX"), (0, "_WY"), (0, "_WZ"), (0, "_AX"), (0, "_AY"), (0, "_AZ"), (0, "_EX"), (0, "_EY"), (0, "_EZ")];
            format!("{n},{}", cols.map(|(c, f)| f4(a(&sim, f, c as f64))).join(","))
        } else if chips6 {
            let m = chips - 1.0;
            let cols: Vec<String> = (0..6).map(|c| if (c as f64) <= m { ["_X", "_Y", "_Z", "_EX", "_EY", "_EZ"].map(|f| f4(a(&sim, f, c as f64))).join(",") } else { ",,,,,".into() }).collect();
            format!("{n},{}", cols.join(","))
        } else {
            if n == geom_at {
                let mut g = vec!["chip,type,dir,parent,x,y,z,ex,ey,ez".to_string()];
                for c in 0..chips as usize {
                    let c = c as f64;
                    g.push(format!("{},{},,,{}", c, snaptiles_core::js::number_to_string(a(&sim, "_TYPE", c)), ["_X", "_Y", "_Z", "_EX", "_EY", "_EZ"].map(|f| f4(a(&sim, f, c))).join(",")));
                }
                let g = g.join("\n") + "\n";
                fs::write(out_file.trim_end_matches(".csv").to_string() + ".geom.csv", &g).expect("write geom");
                print!("{g}");
            }
            let c = sim.core_position();
            let v = c.sub(prev).scale(30.0);
            prev = c;
            let w = |f: &str| if wheel_no >= 0 { f4(a(&sim, f, wheel_no as f64)) } else { String::new() };
            format!("{n},{},{},{},{},{},{},{},{},{},{},{},{},{},{}", f4(c.x), f4(c.y), f4(c.z), f4(v.x), f4(v.y), f4(v.z), f4(a(&sim, "_EX", 0.0)), f4(a(&sim, "_EY", 0.0)), f4(a(&sim, "_EZ", 0.0)), chips, wheel_no, p, w("_WY"), w("_Y"))
        };
        rows.push(row);
    }
    fs::write(&out_file, rows.join("\n") + "\n").expect("write");
    for k in [1, 30, 31, 59, 89, 119, 149, 150, 151, 199, 249, 329] {
        if let Some(r) = rows.get(k) {
            println!("{r}");
        }
    }
    if let Some(e) = &sim.script_error {
        println!("scriptError {e}");
    }
}
