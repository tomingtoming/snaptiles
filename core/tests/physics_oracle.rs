//! Stage 2a check (core/PORT.md): the Rust physics world against the TypeScript `PhysicsWorld`, both run on every
//! corpus model without its script (oracle: `bun tools/export-physics-oracle.ts`, JSON in
//! `D:/snaptiles-models/quarantine/oracle-physics`, or `SNAPTILES_PHYSICS_ORACLE`). Without the oracle the test passes
//! with a message.
//!
//! rapier3d 0.36 and rapier3d-compat 0.21 are not bit-identical engines, so trajectories drift apart and chaotic
//! models diverge; the hard requirements are the geometry right after the build and after the first frame, and no
//! NaN or explosion where the TypeScript stays finite. Everything else is reported (`cargo test --release --test
//! physics_oracle -- --nocapture`).
use serde_json::Value;
use snaptiles_core::model::{assemble, Vec3};
use snaptiles_core::physics::{math::euler_yxz, BuildOptions, PhysicsOptions, World};
use snaptiles_core::rc::parse_rc;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;

struct Run {
    tiles0: Vec<[f64; 3]>,
    tiles1: Vec<[f64; 3]>,
    tiles30: Vec<[f64; 3]>,
    /// per frame: position, linear velocity, Euler YXZ
    core: Vec<[f64; 9]>,
}

fn run(path: &str, frames: usize, drive_at: Option<usize>) -> Result<Run, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let model = parse_rc(&String::from_utf8_lossy(&bytes)).map_err(|e| e.to_string())?;
    let vals: RefCell<HashMap<String, f64>> = RefCell::new(HashMap::new());
    for v in &model.vals {
        vals.borrow_mut().insert(v.name.to_uppercase(), v.default);
    }
    let chips: RefCell<HashMap<String, f64>> = RefCell::new(HashMap::new());
    let env = |n: &str| vals.borrow().get(&n.to_uppercase()).copied().or_else(|| chips.borrow().get(&n.to_uppercase()).copied());
    let a = assemble(&model, &env).map_err(|e| e.to_string())?.ok_or("Body section is missing")?;
    for t in &a.tiles {
        if let Some(n) = &t.name {
            chips.borrow_mut().insert(n.clone(), t.chip_index as f64);
        }
    }
    let mut w = World::new(PhysicsOptions { no_course: true, ..Default::default() });
    w.build(a, &env, Vec3::default(), BuildOptions::default());
    let tiles = |w: &World| (0..w.tiles.len()).map(|i| w.pose(i).position.to_array()).collect::<Vec<_>>();
    let mut r = Run { tiles0: tiles(&w), tiles1: vec![], tiles30: vec![], core: vec![] };
    for f in 1..=frames {
        if drive_at == Some(f) {
            // as tools/export-physics-oracle.ts: every Val to its max, else its min, when within 1e5 and not the default
            for v in &model.vals {
                let k = v.name.to_uppercase();
                if v.max <= 1e5 && v.max != v.default {
                    vals.borrow_mut().insert(k, v.max);
                } else if v.min >= -1e5 && v.min != v.default {
                    vals.borrow_mut().insert(k, v.min);
                }
            }
        }
        for _ in 0..2 {
            w.apply_controls(&env);
            w.step(&env);
        }
        let pose = w.pose(0);
        let v = w.world.bodies[w.tiles[0].body].linvel();
        let e = euler_yxz(pose.quaternion);
        let p = pose.position;
        r.core.push([p.x, p.y, p.z, v.x as f64, v.y as f64, v.z as f64, e[0], e[1], e[2]]);
        if f == 1 {
            r.tiles1 = tiles(&w);
        }
        if f == 30 {
            r.tiles30 = tiles(&w);
        }
    }
    Ok(r)
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}
fn v3(v: &Value) -> [f64; 3] {
    [num(&v[0]), num(&v[1]), num(&v[2])]
}
fn dist(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}
fn max_tile_err(rust: &[[f64; 3]], ts: &Value, relative: bool) -> f64 {
    let ts: Vec<[f64; 3]> = ts.as_array().map(|a| a.iter().map(v3).collect()).unwrap_or_default();
    if ts.len() != rust.len() || ts.is_empty() {
        return f64::INFINITY;
    }
    let (r0, t0) = if relative { (rust[0], ts[0]) } else { ([0.0; 3], [0.0; 3]) };
    rust.iter()
        .zip(&ts)
        .map(|(r, t)| dist([r[0] - r0[0], r[1] - r0[1], r[2] - r0[2]], [t[0] - t0[0], t[1] - t0[1], t[2] - t0[2]]))
        .fold(0.0, |m: f64, d| if d.is_nan() { f64::INFINITY } else { m.max(d) })
}

#[derive(Debug)]
struct Row {
    name: String,
    tiles: usize,
    f0: f64,
    f1: f64,
    first30: f64,
    rel30: f64,
    all300: f64,
    /// first frame whose core position differs by more than 0.01 m (0 = never)
    diverge: usize,
    nan: bool,
    ts_stable: bool,
    rust_max_speed: f64,
    ts_max_speed: f64,
    /// the drive run: max core position error over the 30 frames after the Vals change, and over the run
    drive30: f64,
    drive300: f64,
}

fn oracle_dir() -> Option<PathBuf> {
    let dir = std::env::var("SNAPTILES_PHYSICS_ORACLE").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("D:/snaptiles-models/quarantine/oracle-physics"));
    dir.is_dir().then_some(dir)
}

#[test]
fn physics_matches_the_typescript_oracle() {
    let Some(dir) = oracle_dir() else {
        eprintln!("no physics oracle (run `bun tools/export-physics-oracle.ts`); skipped");
        return;
    };
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    files.sort_by_key(|p| p.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<u32>().ok()).unwrap_or(u32::MAX));
    let mut rows = Vec::new();
    let mut failures = Vec::new();
    for f in &files {
        let o: Value = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
        let name = o["name"].as_str().unwrap().to_string();
        let frames = o["frames"].as_u64().unwrap_or(300) as usize;
        let source = o["source"].as_str().unwrap();
        let drive_at = o["driveAt"].as_u64().map(|d| d as usize);
        let r = run(source, frames, None);
        let rd = run(source, frames, drive_at);
        if let Some(err) = o.get("error") {
            if r.is_ok() {
                failures.push(format!("{name}: ts error {err}, rust ran"));
            }
            continue;
        }
        let r = match r {
            Ok(r) => r,
            Err(e) => {
                failures.push(format!("{name}: rust error {e}"));
                continue;
            }
        };
        let core: Vec<Vec<f64>> = o["core"].as_array().unwrap().iter().map(|row| row.as_array().unwrap().iter().map(num).collect()).collect();
        let pos_err = |k: usize| dist([r.core[k][0], r.core[k][1], r.core[k][2]], [core[k][0], core[k][1], core[k][2]]);
        let max_over = |n: usize| (0..n.min(core.len())).map(pos_err).fold(0.0, |m: f64, d| if d.is_nan() { f64::INFINITY } else { m.max(d) });
        if std::env::var("SNAPTILES_PHYSICS_TRACE").is_ok_and(|t| t == name) {
            for k in 0..core.len() {
                println!("{name} frame {:>3} err {:.3e} rust {:?} ts {:?}", k + 1, pos_err(k), &r.core[k][..3], &core[k][..3]);
            }
        }
        let rd = rd.unwrap();
        let drive: Vec<Vec<f64>> = o["drive"].as_array().map(|a| a.iter().map(|row| row.as_array().unwrap().iter().map(num).collect()).collect()).unwrap_or_default();
        let drive_err = |k: usize| dist([rd.core[k][0], rd.core[k][1], rd.core[k][2]], [drive[k][0], drive[k][1], drive[k][2]]);
        let drive_max = |a: usize, b: usize| (a..b.min(drive.len())).map(drive_err).fold(0.0, |m: f64, d| if d.is_nan() { f64::INFINITY } else { m.max(d) });
        let d0 = drive_at.unwrap_or(1) - 1;
        if std::env::var("SNAPTILES_PHYSICS_TRACE").is_ok_and(|t| t == format!("d{name}")) {
            for k in 0..drive.len() {
                println!("{name} drive frame {:>3} err {:.3e} rust {:?} ts {:?}", k + 1, drive_err(k), &rd.core[k][..3], &drive[k][..3]);
            }
        }
        let nan = r.core.iter().any(|c| c.iter().any(|x| !x.is_finite()));
        let drive_nan = rd.core.iter().any(|c| c.iter().any(|x| !x.is_finite())) && drive.iter().all(|c| c.iter().all(|x| x.is_finite()));
        let ts_stable = core.iter().all(|c| c.iter().all(|x| x.is_finite()));
        let speed = |c: &[f64]| (c[3] * c[3] + c[4] * c[4] + c[5] * c[5]).sqrt();
        let row = Row {
            name: name.clone(),
            tiles: r.tiles0.len(),
            f0: max_tile_err(&r.tiles0, &o["tiles0"], false),
            f1: max_tile_err(&r.tiles1, &o["tiles1"], false),
            first30: max_over(30),
            rel30: max_tile_err(&r.tiles30, &o["tiles30"], true),
            all300: max_over(frames),
            diverge: (0..core.len()).find(|&k| pos_err(k) > 0.01).map_or(0, |k| k + 1),
            nan,
            ts_stable,
            rust_max_speed: r.core.iter().map(|c| speed(c)).fold(0.0, f64::max),
            ts_max_speed: core.iter().map(|c| speed(c)).fold(0.0, f64::max),
            drive30: drive_max(d0, d0 + 30),
            drive300: drive_max(0, frames),
        };
        let (vd_rs, vd_ts) = (rd.core.iter().map(|c| speed(c)).fold(0.0, f64::max), drive.iter().map(|c| speed(c)).fold(0.0, f64::max));
        if drive_nan {
            failures.push(format!("{name}: drive run NaN in rust, finite in ts"));
        }
        if vd_rs > 2.0 * vd_ts + 20.0 {
            failures.push(format!("{name}: drive run reaches {vd_rs:.1} m/s in rust, ts {vd_ts:.1}"));
        }
        if row.f0 > 1e-3 {
            failures.push(format!("{name}: build geometry differs by {:.2e}", row.f0));
        }
        if row.nan && row.ts_stable {
            failures.push(format!("{name}: NaN in rust, finite in ts"));
        }
        if row.rust_max_speed > 2.0 * row.ts_max_speed + 20.0 {
            failures.push(format!("{name}: rust reaches {:.1} m/s, ts {:.1}", row.rust_max_speed, row.ts_max_speed));
        }
        rows.push(row);
    }
    println!("{:>4} {:>5} {:>9} {:>9} {:>9} {:>9} {:>9} {:>6} {:>7} {:>7} {:>9} {:>9}", "n", "tiles", "f0", "f1", "max<=30", "rel@30", "max<=300", "div@", "v_rs", "v_ts", "drv<=30", "drv<=300");
    for r in &rows {
        println!(
            "{:>4} {:>5} {:>9.2e} {:>9.2e} {:>9.2e} {:>9.2e} {:>9.2e} {:>6} {:>7.1} {:>7.1} {:>9.2e} {:>9.2e}{}",
            r.name, r.tiles, r.f0, r.f1, r.first30, r.rel30, r.all300, r.diverge, r.rust_max_speed, r.ts_max_speed, r.drive30, r.drive300, if r.nan { " NaN" } else { "" }
        );
    }
    let count = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count();
    let median = |mut v: Vec<f64>| {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        if v.is_empty() { 0.0 } else { v[v.len() / 2] }
    };
    println!("models {}", rows.len());
    for tol in [1e-6, 1e-4, 1e-3] {
        println!("  frame 0 within {tol:e}: {}  frame 1: {}", count(&|r| r.f0 <= tol), count(&|r| r.f1 <= tol));
    }
    for tol in [1e-3, 1e-2, 0.1, 1.0] {
        println!(
            "  within {tol:e} m: first 30 frames {}  frame 30 relative to core {}  300 frames {}",
            count(&|r| r.first30 <= tol),
            count(&|r| r.rel30 <= tol),
            count(&|r| r.all300 <= tol)
        );
        println!("  drive run within {tol:e} m: 30 frames after the change {}  whole run {}", count(&|r| r.drive30 <= tol), count(&|r| r.drive300 <= tol));
    }
    println!(
        "  median: max<=30 {:.2e}  rel@30 {:.2e}  max<=300 {:.2e}",
        median(rows.iter().map(|r| r.first30).collect()),
        median(rows.iter().map(|r| r.rel30).collect()),
        median(rows.iter().map(|r| r.all300).collect())
    );
    println!("  median drive: 30 after {:.2e}  whole {:.2e}", median(rows.iter().map(|r| r.drive30).collect()), median(rows.iter().map(|r| r.drive300).collect()));
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}
