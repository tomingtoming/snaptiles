//! Native corpus replay: replaced the TypeScript `tools/drive-compare.ts` and `tools/geom-compare.ts` (removed 2026-11-02).
//!
//!   cargo run --release --bin replay -- <runs dir> [n ...]
//!
//! `<runs>/drive/<n>.<idle|up>.csv` are the original's driving logs: every model `<runs>/geom/models/<n>.txt` is
//! replayed on bare flat ground (`noCourse`) for 600 frames holding key 0 exactly on the frames the log has
//! `key0 = 1`, written to `<runs>/drive/<SNAP_DIR>/<n>.<mode>.csv` (columns frame,key0,x,y,z,vx,vy,vz,ex,ey,ez,chips
//! read through the script API `_X(0)` …). For every model in `<runs>/geom/index.tsv` with an original dump, the
//! geometry after the first frame and after 30 frames goes to `<runs>/geom/<SNAP_DIR>/<n>.g1.csv` / `.g30.csv`
//! (chip,type,dir,parent,x,y,z,ex,ey,ez). Load failures go to `.err` files. SNAP_DIR defaults to `snap_rust`;
//! existing outputs are overwritten. Runs are spread over the machine's cores (REPLAY_THREADS to override);
//! REPLAY_JITTER nudges the initial velocities of the drive runs (see [`jitter`]).
use snaptiles_core::js::{number_to_string as js, to_fixed};
use snaptiles_core::{PhysicsOptions, Simulation};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

enum Job {
    Drive { n: String, mode: String, log: PathBuf },
    Geom { n: String },
}

fn opts() -> PhysicsOptions {
    PhysicsOptions { no_course: true, ..Default::default() }
}

fn drive(runs: &Path, snap: &str, n: &str, mode: &str, log: &Path) {
    let out = runs.join("drive").join(snap).join(format!("{n}.{mode}.csv"));
    let err = runs.join("drive").join(snap).join(format!("{n}.{mode}.err"));
    let text = fs::read_to_string(log).unwrap_or_default();
    let held: std::collections::HashSet<i64> = text
        .trim()
        .lines()
        .skip(1)
        .filter_map(|l| {
            let c: Vec<&str> = l.split(',').collect();
            (c.len() > 1 && c[1].trim().parse::<f64>().ok() == Some(1.0)).then(|| c[0].trim().parse::<f64>().ok().map(|f| f as i64)).flatten()
        })
        .collect();
    let source = match fs::read(runs.join("geom").join("models").join(format!("{n}.txt"))) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            let _ = fs::write(&err, e.to_string());
            return;
        }
    };
    snaptiles_core::sim::seed_random(1);
    let mut sim = match Simulation::load(&source, opts()) {
        Ok(s) => s,
        Err(e) => {
            let _ = fs::write(&err, e);
            return;
        }
    };
    jitter(&sim);
    let mut rows = vec!["frame,key0,x,y,z,vx,vy,vz,ex,ey,ez,chips".to_string()];
    for f in 1..=600i64 {
        let h = held.contains(&f);
        sim.set_keys(if h { 1 } else { 0 });
        sim.step();
        let v: Vec<String> = ["_X", "_Y", "_Z", "_VX", "_VY", "_VZ", "_EX", "_EY", "_EZ"].iter().map(|k| js(sim.api(k, &[0.0]))).collect();
        rows.push(format!("{f},{},{},{}", if h { 1 } else { 0 }, v.join(","), js(sim.api("_CHIPS", &[]))));
    }
    let _ = fs::remove_file(&err);
    let _ = fs::write(out, rows.join("\n") + "\n");
}

/// REPLAY_JITTER=<m/s>: nudge every body's initial velocity along x by that much (a sensitivity probe: how much of a
/// run's divergence is chaos rather than a systematic difference)
fn jitter(sim: &Simulation) {
    let Some(eps) = std::env::var("REPLAY_JITTER").ok().and_then(|v| v.parse::<f32>().ok()) else { return };
    let mut s = sim.state_mut();
    for (_, b) in s.world.world.bodies.iter_mut() {
        let v = b.linvel();
        b.set_linvel(rapier3d::math::Vector::new(v.x + eps, v.y, v.z), true);
    }
}

fn geom(runs: &Path, snap: &str, n: &str) {
    let dir = runs.join("geom");
    let err = dir.join(snap).join(format!("{n}.err"));
    let source = match fs::read(dir.join("models").join(format!("{n}.txt"))) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            let _ = fs::write(&err, e.to_string());
            return;
        }
    };
    snaptiles_core::sim::seed_random(1);
    let mut sim = match Simulation::load(&source, opts()) {
        Ok(s) => s,
        Err(e) => {
            let _ = fs::write(&err, e);
            return;
        }
    };
    let dump = |sim: &Simulation| {
        let chips: Vec<usize> = sim.state().world.assembly().unwrap().tiles.iter().map(|t| t.chip_index).collect();
        let mut out = vec!["chip,type,dir,parent,x,y,z,ex,ey,ez".to_string()];
        for c in chips {
            let a = [c as f64];
            let f4 = |k: &str| to_fixed(sim.api(k, &a), 4);
            out.push(format!(
                "{c},{},{},{},{},{},{},{},{},{}",
                js(sim.api("_TYPE", &a)),
                js(sim.api("_DIR", &a)),
                js(sim.api("_PARENT", &a)),
                f4("_X"),
                f4("_Y"),
                f4("_Z"),
                f4("_EX"),
                f4("_EY"),
                f4("_EZ")
            ));
        }
        out.join("\n") + "\n"
    };
    sim.step();
    let _ = fs::write(dir.join(snap).join(format!("{n}.g1.csv")), dump(&sim));
    for _ in 1..30 {
        sim.step();
    }
    let _ = fs::remove_file(&err);
    let _ = fs::write(dir.join(snap).join(format!("{n}.g30.csv")), dump(&sim));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(runs) = args.first().map(PathBuf::from) else {
        eprintln!("usage: replay <runs dir> [n ...]");
        std::process::exit(2);
    };
    let only: Vec<String> = args[1..].to_vec();
    let snap = std::env::var("SNAP_DIR").unwrap_or_else(|_| "snap_rust".into());
    fs::create_dir_all(runs.join("drive").join(&snap)).unwrap();
    fs::create_dir_all(runs.join("geom").join(&snap)).unwrap();
    let mut jobs = Vec::new();
    let mut logs: Vec<String> = fs::read_dir(runs.join("drive")).unwrap().filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
    logs.sort();
    for f in logs {
        let p: Vec<&str> = f.split('.').collect();
        if p.len() == 3 && p[0].chars().all(|c| c.is_ascii_digit()) && (p[1] == "idle" || p[1] == "up") && p[2] == "csv" && (only.is_empty() || only.iter().any(|o| o == p[0])) {
            jobs.push(Job::Drive { n: p[0].into(), mode: p[1].into(), log: runs.join("drive").join(&f) });
        }
    }
    let drives = jobs.len();
    let index = fs::read_to_string(runs.join("geom").join("index.tsv")).unwrap_or_default();
    for line in index.lines().filter(|l| !l.is_empty()) {
        let n = line.split('\t').next().unwrap().to_string();
        if runs.join("geom").join(format!("{n}.g30.csv")).exists() && (only.is_empty() || only.contains(&n)) {
            jobs.push(Job::Geom { n });
        }
    }
    let threads = std::env::var("REPLAY_THREADS").ok().and_then(|t| t.parse().ok()).unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    let next = AtomicUsize::new(0);
    let t0 = Instant::now();
    std::thread::scope(|sc| {
        for _ in 0..threads.max(1) {
            sc.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(job) = jobs.get(i) else { break };
                match job {
                    Job::Drive { n, mode, log } => drive(&runs, &snap, n, mode, log),
                    Job::Geom { n } => geom(&runs, &snap, n),
                }
            });
        }
    });
    println!("done: {drives} drive runs, {} geometry models in {:.1} s on {threads} threads", jobs.len() - drives, t0.elapsed().as_secs_f64());
}
