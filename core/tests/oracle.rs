//! Stage 1 acceptance (core/PORT.md): the Rust parser and assembler against the TypeScript oracle written by
//! `bun tools/export-oracle.ts`. Counts, names and strings must match exactly, numbers within 1e-9.
//! Set `SNAPTILES_ORACLE` to use another directory; without one the test passes with a message.
use serde_json::Value;
use snaptiles_core::model::{assemble, assembly_bottom, Vec3};
use snaptiles_core::rc::{count_nodes, parse_rc, ChipNode, ScriptLang};
use std::collections::HashMap;
use std::path::PathBuf;

const TOL: f64 = 1e-9;

struct Cmp {
    errors: Vec<String>,
}

impl Cmp {
    fn fail(&mut self, what: &str, msg: String) {
        self.errors.push(format!("{what}: {msg}"));
    }
    fn eq<T: PartialEq + std::fmt::Debug>(&mut self, what: &str, rust: T, ts: T) {
        if rust != ts {
            self.fail(what, format!("rust {rust:?} ts {ts:?}"));
        }
    }
    /// JSON writes non-finite numbers as null
    fn num(&mut self, what: &str, rust: f64, ts: &Value) {
        let ok = match ts.as_f64() {
            Some(t) => rust == t || (rust - t).abs() <= TOL,
            None => ts.is_null() && !rust.is_finite(),
        };
        if !ok {
            self.fail(what, format!("rust {rust} ts {ts}"));
        }
    }
    fn vec(&mut self, what: &str, rust: &[f64], ts: &Value) {
        let Some(a) = ts.as_array().filter(|a| a.len() == rust.len()) else {
            return self.fail(what, format!("rust {rust:?} ts {ts}"));
        };
        for (i, (r, t)) in rust.iter().zip(a).enumerate() {
            self.num(&format!("{what}[{i}]"), *r, t);
        }
    }
    fn v3(&mut self, what: &str, rust: Vec3, ts: &Value) {
        self.vec(what, &rust.to_array(), ts);
    }
    fn opt_str(&mut self, what: &str, rust: Option<&str>, ts: &Value) {
        self.eq(what, rust, ts.as_str());
    }
}

fn flatten<'a>(n: &'a ChipNode, out: &mut Vec<&'a ChipNode>) {
    out.push(n);
    for c in &n.children {
        flatten(c, out);
    }
}

fn compare(o: &Value, c: &mut Cmp) -> (bool, bool) {
    let path = o["source"].as_str().expect("source path");
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let text = String::from_utf8_lossy(&bytes);
    let p = &o["parse"];
    let model = match parse_rc(&text) {
        // a TypeError in the TypeScript (end of section where it reads `peek()!`) has an engine-specific message
        Err(e) if e.line.is_none() => {
            c.opt_str("parse error class", Some("TypeError"), &p["errorClass"]);
            return (false, false);
        }
        Err(e) => {
            c.opt_str("parse error", Some(&e.to_string()), &p["error"]);
            return (false, false);
        }
        Ok(m) => m,
    };
    if let Some(err) = p.get("error") {
        c.fail("parse", format!("rust parsed, ts error {err}"));
        return (false, false);
    }
    let vals = p["vals"].as_array().unwrap();
    c.eq("val count", model.vals.len(), vals.len());
    for (v, t) in model.vals.iter().zip(vals) {
        let w = format!("val {}", v.name);
        c.opt_str(&w, Some(&v.name), &t["name"]);
        c.num(&format!("{w}.default"), v.default, &t["default"]);
        c.num(&format!("{w}.min"), v.min, &t["min"]);
        c.num(&format!("{w}.max"), v.max, &t["max"]);
        c.num(&format!("{w}.step"), v.step, &t["step"]);
        match v.disp {
            Some(d) => c.num(&format!("{w}.disp"), d, &t["disp"]),
            None => c.eq(&format!("{w}.disp"), true, t["disp"].is_null()),
        }
    }
    let keys = p["keys"].as_array().unwrap();
    c.eq("key count", model.keys.len(), keys.len());
    for (k, t) in model.keys.iter().zip(keys) {
        let w = format!("key {} {}", k.key, k.var);
        c.num(&w, k.key, &t["key"]);
        c.opt_str(&w, Some(&k.var), &t["var"]);
        c.num(&format!("{w}.step"), k.step, &t["step"]);
    }
    c.eq("bodies", model.bodies.len() as u64, p["bodies"].as_u64().unwrap());
    let count: usize = model.bodies.iter().map(|b| count_nodes(Some(b))).sum();
    c.eq("node count", count as u64, p["nodeCount"].as_u64().unwrap());
    let mut flat = Vec::new();
    for b in &model.bodies {
        flatten(b, &mut flat);
    }
    for (i, (n, t)) in flat.iter().zip(p["nodes"].as_array().unwrap()).enumerate() {
        let w = format!("node {i}");
        c.opt_str(&format!("{w}.type"), Some(&n.type_), &t["type"]);
        c.opt_str(&format!("{w}.dir"), n.dir.map(|d| d.as_str()), &t["dir"]);
        c.eq(&format!("{w}.line"), n.line as u64, t["line"].as_u64().unwrap());
        c.eq(&format!("{w}.children"), n.children.len() as u64, t["children"].as_u64().unwrap());
        let attrs: Vec<(String, String)> = t["attrs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e[0].as_str().unwrap().to_string(), e[1].as_str().unwrap().to_string()))
            .collect();
        c.eq(&format!("{w}.attrs"), &n.attrs.0, &attrs);
    }
    match (&model.script, p["script"].is_null()) {
        (None, true) => {}
        (Some(s), false) => {
            let t = &p["script"];
            c.opt_str("script.lang", Some(if s.lang == ScriptLang::Lua { "lua" } else { "rc" }), &t["lang"]);
            c.eq("script.line", s.line as u64, t["line"].as_u64().unwrap());
            c.eq("script.firstLine", s.first_line as u64, t["firstLine"].as_u64().unwrap());
            c.eq("script.source", Some(s.source.as_str()), t["source"].as_str());
        }
        (s, _) => c.fail("script", format!("rust {:?} ts {}", s.as_ref().map(|s| s.lang), p["script"])),
    }
    let warnings: Vec<&str> = p["warnings"].as_array().unwrap().iter().map(|w| w.as_str().unwrap()).collect();
    c.eq("warnings", model.warnings.iter().map(String::as_str).collect::<Vec<_>>(), warnings);

    // assembly with the default Vals, as Simulation does at load (later declarations of a name win)
    let vals: HashMap<String, f64> = model.vals.iter().map(|v| (v.name.to_uppercase(), v.default)).collect();
    let env = |n: &str| vals.get(&n.to_uppercase()).copied();
    let a = &o["assemble"];
    let asm = match assemble(&model, &env) {
        Err(e) => {
            c.opt_str("assemble error", Some(&e.to_string()), &a["error"]);
            return (true, false);
        }
        Ok(None) => {
            c.eq("assembly", true, a.is_null());
            return (true, true);
        }
        Ok(Some(asm)) => asm,
    };
    if a.is_null() || a.get("error").is_some() {
        c.fail("assemble", format!("rust assembled, ts {a}"));
        return (true, false);
    }
    c.eq("chipCount", asm.chip_count as u64, a["chipCount"].as_u64().unwrap());
    let roots: Vec<u64> = a["roots"].as_array().unwrap().iter().map(|r| r.as_u64().unwrap()).collect();
    c.eq("roots", asm.roots.iter().map(|&r| r as u64).collect::<Vec<_>>(), roots);
    c.num("bottom", assembly_bottom(&asm), &a["bottom"]);
    let tiles = a["tiles"].as_array().unwrap();
    c.eq("tile count", asm.tiles.len(), tiles.len());
    for (t, j) in asm.tiles.iter().zip(tiles) {
        let w = format!("tile {}", t.id);
        c.opt_str(&format!("{w}.type"), Some(&t.type_), &j["type"]);
        c.opt_str(&format!("{w}.dir"), t.dir.map(|d| d.as_str()), &j["dir"]);
        c.eq(&format!("{w}.parent"), t.parent.map_or(-1, |p| p as i64), j["parent"].as_i64().unwrap());
        c.eq(&format!("{w}.chipIndex"), t.chip_index as u64, j["chipIndex"].as_u64().unwrap());
        c.num(&format!("{w}.mass"), t.mass, &j["mass"]);
        c.num(&format!("{w}.option"), t.option, &j["option"]);
        c.eq(&format!("{w}.ghost"), Some(t.ghost), j["ghost"].as_bool());
        c.opt_str(&format!("{w}.name"), t.name.as_deref(), &j["name"]);
        match t.color {
            Some(col) => c.num(&format!("{w}.color"), col, &j["color"]),
            None => c.eq(&format!("{w}.color"), true, j["color"].is_null()),
        }
        c.opt_str(&format!("{w}.colorExpr"), t.color_expr.as_deref(), &j["colorExpr"]);
        c.opt_str(&format!("{w}.effectExpr"), t.effect_expr.as_deref(), &j["effectExpr"]);
        c.v3(&format!("{w}.position"), t.position, &j["position"]);
        c.vec(&format!("{w}.quaternion"), &t.quaternion.to_array(), &j["quaternion"]);
        c.v3(&format!("{w}.anchor"), t.anchor, &j["anchor"]);
        c.v3(&format!("{w}.axis"), t.axis, &j["axis"]);
        c.v3(&format!("{w}.rimAnchor"), t.rim_anchor, &j["rimAnchor"]);
        c.v3(&format!("{w}.rimAxis"), t.rim_axis, &j["rimAxis"]);
        c.v3(&format!("{w}.dirAxis"), t.dir_axis, &j["dirAxis"]);
        match (&t.local, &j["local"]) {
            (None, Value::Null) => {}
            (Some(l), jl) if !jl.is_null() => {
                c.v3(&format!("{w}.local.anchor"), l.anchor, &jl["anchor"]);
                c.v3(&format!("{w}.local.axis"), l.axis, &jl["axis"]);
                c.v3(&format!("{w}.local.rimAnchor"), l.rim_anchor, &jl["rimAnchor"]);
                c.v3(&format!("{w}.local.rimAxis"), l.rim_axis, &jl["rimAxis"]);
                c.v3(&format!("{w}.local.dirAxis"), l.dir_axis, &jl["dirAxis"]);
            }
            (l, jl) => c.fail(&format!("{w}.local"), format!("rust {} ts {jl}", l.is_some())),
        }
    }
    (true, true)
}

#[test]
fn parse_and_assemble_match_the_typescript_oracle() {
    let dir = PathBuf::from(std::env::var("SNAPTILES_ORACLE").unwrap_or_else(|_| "D:/snaptiles-models/quarantine/oracle".into()));
    let Ok(entries) = std::fs::read_dir(&dir) else {
        println!("oracle: no directory {} — skipped (run `bun tools/export-oracle.ts`)", dir.display());
        return;
    };
    let mut files: Vec<PathBuf> =
        entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e == "json")).collect();
    files.sort();
    let (mut models, mut parsed, mut assembled, mut bad) = (0, 0, 0, Vec::new());
    for f in &files {
        let o: Value = serde_json::from_slice(&std::fs::read(f).unwrap()).unwrap();
        let mut c = Cmp { errors: Vec::new() };
        let (p, a) = compare(&o, &mut c);
        models += 1;
        parsed += p as usize;
        assembled += a as usize;
        if !c.errors.is_empty() {
            bad.push(format!("{}: {} mismatches, first: {}", o["name"], c.errors.len(), c.errors[..c.errors.len().min(5)].join("; ")));
        }
    }
    println!(
        "oracle: {models} models compared, {parsed} parsed, {assembled} assembled, {} with mismatches",
        bad.len()
    );
    for b in &bad {
        println!("  {b}");
    }
    assert!(bad.is_empty(), "{} of {models} models differ from the TypeScript oracle", bad.len());
}
