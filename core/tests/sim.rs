//! Script-dependent behaviours of the TypeScript unit tests on the Rust `Simulation`: tests/scripts, sim,
//! plane-controls (with the landing), measured-api, editor-script's Lua error lines, the scripted parts of physics
//! and calibration (`_RX/_RY/_RZ`), and the prototype's checks (Lua budget, file lines, 5.0 spellings, keys reaching
//! the script, `out` formatting). Samples are read from `src/samples/*.ts` (their template literal).
use snaptiles_core::model::{assemble, Vec3};
use snaptiles_core::physics::math::{from_vector, to_vector};
use snaptiles_core::rc::parse_rc;
use snaptiles_core::scripting::{LuaEngine, RcScript, ScriptHost};
use snaptiles_core::sim::SimState;
use snaptiles_core::{PhysicsOptions, Simulation};
use std::collections::HashMap;
use std::f64::consts::PI;

fn sample(name: &str) -> String {
    let path = format!("{}/../src/samples/{name}.ts", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap();
    let a = text.find('`').unwrap();
    let b = text.rfind('`').unwrap();
    let mut source = text[a + 1..b].to_string();
    if name == "hover" {
        assert!(text.contains(", 3, 'local h = _H(0)')"), "update the native hover fixture for its default arguments");
        source = source.replace("${title}", "hover platform").replace("${targetHeight}", "3").replace("${sensor}", "local h = _H(0)");
    }
    assert!(!source.contains("${"), "sample template requires expansion");
    source
}

fn course() -> PhysicsOptions {
    PhysicsOptions::default()
}
fn bare() -> PhysicsOptions {
    PhysicsOptions { no_course: true, ..Default::default() }
}
fn load(src: &str, opts: PhysicsOptions) -> Simulation {
    let sim = Simulation::load(src, opts).unwrap();
    assert!(sim.script_error.is_none(), "{:?}", sim.script_error);
    sim
}
fn steps(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.step();
    }
}
fn up_y(sim: &Simulation) -> f64 {
    let q = sim.state().world.pose(0).quaternion;
    1.0 - 2.0 * (q.x * q.x + q.z * q.z)
}

// --------------------------------------------------------------------------------------------- scripts.test.ts

/// Vals and a mock API for the legacy Script
struct Host {
    vals: HashMap<String, f64>,
    api: HashMap<&'static str, Box<dyn FnMut(&[f64]) -> f64>>,
}
impl Host {
    fn new(vals: &[(&str, f64)]) -> Host {
        Host { vals: vals.iter().map(|(k, v)| (k.to_string(), *v)).collect(), api: HashMap::new() }
    }
    fn with(mut self, name: &'static str, f: impl FnMut(&[f64]) -> f64 + 'static) -> Host {
        self.api.insert(name, Box::new(f));
        self
    }
    fn v(&self, name: &str) -> f64 {
        self.vals[name]
    }
}
impl ScriptHost for Host {
    fn val(&self, name: &str) -> Option<f64> {
        self.vals.get(name).copied()
    }
    fn set_val(&mut self, name: &str, value: f64) -> bool {
        match self.vals.get_mut(name) {
            Some(v) => {
                *v = value;
                true
            }
            None => false,
        }
    }
    fn call(&mut self, name: &str, args: &[f64]) -> Option<f64> {
        self.api.get_mut(name).map(|f| f(args))
    }
}

#[test]
fn legacy_script_runs_assignments_ifs_labels_and_prints() {
    let mut s = RcScript::new(
        "
      // traction control
      ratio = _WY(TIRE) / 2
      if ratio > 3.4 { TRQ = TRQ * 0.5 }
      if (ratio <= 3.4) & (ratio >= 0) { TRQ = (TRQ + 1000) * 1.05 }
      print 0, \"trq\", TRQ
      n = 0
      label loop
      n = n + 1
      if n < 3 { goto loop }
      X = n
    ",
    )
    .unwrap();
    let mut h = Host::new(&[("TRQ", 0.0), ("TIRE", 5.0), ("X", 0.0)]).with("_WY", |_| 4.0);
    s.run(&mut h).unwrap();
    assert!((h.v("TRQ") - 1050.0).abs() < 1e-5);
    assert_eq!(h.v("X"), 3.0);
    assert_eq!(s.out_lines[0], "trq1050"); // items are concatenated, as in the original
    s.run(&mut h).unwrap();
    assert!((h.v("TRQ") - 2152.5).abs() < 1e-5);
}

#[test]
fn legacy_script_treats_eq_as_comparison_inside_if_and_keeps_undeclared_vars_frame_local() {
    let mut s = RcScript::new("\n      if _KEY(0) = 1 { A = A + 1 }\n      tmp = tmp + 1\n      B = tmp\n    ").unwrap();
    let mut h = Host::new(&[("A", 0.0), ("B", 0.0)]).with("_KEY", |_| 1.0);
    s.run(&mut h).unwrap();
    s.run(&mut h).unwrap();
    assert_eq!(h.v("A"), 2.0);
    assert_eq!(h.v("B"), 1.0);
}

#[test]
fn legacy_script_stops_runaway_loops() {
    let mut s = RcScript::new("label a\ngoto a").unwrap();
    let e = s.run(&mut Host::new(&[])).unwrap_err();
    assert!(e.contains("budget"), "{e}");
}

#[test]
fn legacy_script_idioms_from_community_files() {
    let mut s = RcScript::new(
        "
      if S_SP=0 | fuel=0 {goto A:}
      S=S+S_SP
      if S>=360 {S=S-360}
      F_1=_sin(_torad(S))*10
      label A
      if F_B=1 {Z_A=90 DUMMY=_BYE(zenmai) goto B:}
      Z_A=1
      label B
      print 0,\"FPS=\",_FPS(),\"  Chips=\",_CHIPS()
    ",
    )
    .unwrap();
    let bye = std::rc::Rc::new(std::cell::Cell::new(-1.0));
    let b2 = bye.clone();
    let mut h = Host::new(&[("S_SP", 10.0), ("S", 355.0), ("FUEL", 100.0), ("F_1", 0.0), ("F_B", 1.0), ("Z_A", 0.0), ("ZENMAI", 3.0)])
        .with("_BYE", move |a| {
            b2.set(a[0]);
            0.0
        })
        .with("_FPS", |_| 30.0)
        .with("_CHIPS", |_| 7.0);
    s.run(&mut h).unwrap();
    assert_eq!(h.v("S"), 5.0); // 355 + 10 wrapped
    assert!((h.v("F_1") - (5.0 * PI / 180.0).sin() * 10.0).abs() < 1e-6);
    assert_eq!(h.v("Z_A"), 90.0); // the block ran and jumped over Z_A=1
    assert_eq!(bye.get(), 3.0);
    assert_eq!(s.out_lines[0], "FPS=30  Chips=7");
}

#[test]
fn legacy_script_skips_the_block_when_the_condition_is_false() {
    let mut s = RcScript::new("if _KEY(4)>0 {fuel=fuel+(20/100*Z_P) Z_P=Z_P-5}\nif _KEY(4)=0 {Z_P=100-10*(fuel/500)}").unwrap();
    let mut h = Host::new(&[("FUEL", 1000.0), ("Z_P", 50.0)]).with("_KEY", |_| 0.0);
    s.run(&mut h).unwrap();
    assert_eq!(h.v("FUEL"), 1000.0);
    assert_eq!(h.v("Z_P"), 80.0);
}

#[test]
fn lua_runner_calls_onframe_with_the_api_and_exchanges_val_globals() {
    let mut r = LuaEngine::new();
    r.load(
        "
      function OnFrame()
        if _KEY(1) == 1 then SPEED = SPEED + 10 end
        out(0, \"s\", SPEED)
      end
    ",
        |lua| lua.globals().set("_KEY", lua.create_function(|_, n: f64| Ok(if n == 1.0 { 1 } else { 0 }))?),
        "SPEED = 5",
        0,
    );
    assert!(r.error.is_none(), "{:?}", r.error);
    assert!(r.frame());
    assert_eq!(r.get_number("SPEED"), Some(15.0));
    assert_eq!(r.out_lines()[0], "s 15");
    r.set_number("SPEED", 100.0);
    r.frame();
    assert_eq!(r.get_number("SPEED"), Some(110.0));
}

#[test]
fn lua_runner_falls_back_to_main_and_enforces_the_instruction_budget() {
    let mut r = LuaEngine::new();
    r.load("function main() while true do end end", |_| Ok(()), "", 0);
    r.max_instructions_per_call = 50_000;
    assert!(!r.frame());
    let e = r.error.clone().unwrap();
    assert!(e.contains("budget"), "{e}");
    assert_eq!(e, "main: instruction budget exceeded");
}

#[test]
fn lua_runner_provides_lua_50_compatibility_names() {
    let mut r = LuaEngine::new();
    r.load("function OnFrame() V = math.mod(7, 3) + math.pow(2, 3) end", |_| Ok(()), "", 0);
    r.frame();
    assert_eq!(r.get_number("V"), Some(9.0));
    // printed like the TypeScript prints JavaScript numbers: integers bare, the rest with two decimals
    let mut r = LuaEngine::new();
    r.load("function OnFrame() out(0, math.mod(7, 3), math.pow(2, 3), math.atan2(1, 1)) out(2, string.format('%d', 2.6), true, nil, 'x &') end", |_| Ok(()), "", 0);
    r.frame();
    assert_eq!(r.out_lines()[0], "1 8 0.79");
    assert_eq!(r.out_lines()[1], "");
    assert_eq!(r.out_lines()[2], "3 true undefined x ");
}

// ------------------------------------------------------------------------------------ prototype (core/tests/native.rs)

#[test]
fn a_core_falls_and_lua_reads_it() {
    let mut sim = load("Val {} Key {} Body { Core(){} }\nLua {\nfunction OnFrame() out(0, \"y \", _Y(0), string.format(\" %d\", _TICKS())) end\n}\n", bare());
    steps(&mut sim, 60);
    let y = sim.core_position().y;
    assert!(y < 0.1 && y > -0.05, "the core rests on the ground, y = {y}");
    assert!(sim.out[0].starts_with("y  0.0"), "{:?}", sim.out);
    assert!(sim.out[0].ends_with(" 59"), "{:?}", sim.out);
    assert!(sim.script_error.is_none());
}

#[test]
fn keys_reach_the_script() {
    let mut sim = load("Val {} Key {} Body { Core(){} }\nLua {\nfunction OnFrame() out(1, _KEY(0), _KEYDOWN(0), _KEYUP(0)) end\n}\n", bare());
    sim.step();
    assert_eq!(sim.out[1], "0 0 0");
    sim.press(0);
    sim.step();
    assert_eq!(sim.out[1], "1 1 0");
    sim.step();
    assert_eq!(sim.out[1], "1 0 0");
    sim.set_keys(0);
    sim.step();
    assert_eq!(sim.out[1], "0 0 1");
}

#[test]
fn an_endless_script_is_stopped_and_errors_name_file_lines() {
    let mut sim = load("Val {} Key {} Body { Core(){} }\nLua {\nfunction OnFrame() while true do end end\n}\n", bare());
    sim.step();
    assert_eq!(sim.script_error.as_deref(), Some("OnFrame: instruction budget exceeded"));
    // a load error at the end of the chunk: the chunk starts on the brace line (file line 2), its end is file line 6
    let sim = Simulation::load("Val {} Key {} Body { Core(){} }\nLua {\n\nlocal x = \nnosuch(\n}\n", bare()).unwrap();
    let e = sim.script_error.clone().unwrap();
    assert!(e.starts_with("line 6:"), "{e}");
}

// ----------------------------------------------------------------------------------------- editor-script.test.ts

#[test]
fn lua_errors_name_the_file_line() {
    let body = "Val { P(default=0) }\nBody { Core(){ N:Jet(power=P){ } } }\n";
    for (open, line) in [("Lua {\n", 5), ("Lua\n{\n", 6)] {
        let src = format!("{body}{open}function OnFrame()\n  P = nosuch.field\nend\n}}\n");
        let mut sim = Simulation::load(&src, bare()).unwrap();
        sim.step();
        let e = sim.script_error.clone().unwrap();
        assert!(e.contains(&format!("line {line}:")), "{e}");
        assert_eq!(src.split('\n').nth(line - 1).unwrap(), "  P = nosuch.field");
    }
}

// --------------------------------------------------------------------------------------------------- sim.test.ts

#[test]
fn drives_the_car_sample_forward_when_up_is_held() {
    let mut sim = load(&sample("car"), course());
    steps(&mut sim, 30); // settle
    let z0 = sim.core_position().z;
    sim.press(0);
    steps(&mut sim, 90); // 3 s at 30 fps
    assert!(sim.val("ENGINE").unwrap() > 1000.0);
    assert!(sim.core_position().z < z0 - 5.0, "north is -Z: {} vs {z0}", sim.core_position().z); // north is -Z
    assert!(sim.script_error.is_none());
    assert!(sim.out[0].contains("km/h"), "{:?}", sim.out);
}

#[test]
fn keydown_fires_once_per_press_and_val_steps_return_to_default() {
    let src = "
      Val { X(default=0, min=0, max=100, step=5) }
      Key { 4:X(step=10) }
      Body { Core(){ } }
      Lua { down = 0; function OnFrame() if _KEYDOWN(4) > 0 then down = down + 1 end end }
    ";
    let mut sim = load(src, course());
    sim.press(4);
    sim.step();
    sim.step();
    sim.release(4);
    sim.step();
    assert_eq!(sim.lua.get_number("down"), Some(1.0));
    assert_eq!(sim.val("X"), Some(15.0)); // 2 frames × 10, then one return step of 5
    steps(&mut sim, 10);
    assert_eq!(sim.val("X"), Some(0.0));
}

#[test]
fn brake_stops_the_car_sample() {
    let mut sim = load(&sample("car"), course());
    sim.press(0);
    steps(&mut sim, 90);
    sim.release(0);
    let v_fast = sim.api("_VEL", &[0.0]);
    assert!(v_fast > 5.0, "{v_fast}");
    sim.press(4); // Z = BRAKE
    steps(&mut sim, 60);
    assert!(sim.api("_VEL", &[0.0]) < v_fast * 0.3);
}

#[test]
fn clamps_held_key_values_before_lua_reads_them() {
    let mut sim = load(
        "
      Val { SPEED(default=0,min=0,max=10) }
      Key { 0:SPEED(step=10) }
      Body { Core(){} }
      Lua { seen=0; function OnFrame() seen=SPEED end }
    ",
        course(),
    );
    sim.press(0);
    for _ in 0..3 {
        sim.step();
        assert_eq!(sim.lua.get_number("seen"), Some(10.0));
    }
}

#[test]
fn oninit_runs_once_at_load_and_onreset_on_reset() {
    let mut sim = load(
        "
      Val { } Key { }
      Body { Core(){ } }
      Lua { inits = 0; resets = 0; function OnInit() inits = inits + 1 end function OnReset() resets = resets + 1 end function OnFrame() end }
    ",
        course(),
    );
    steps(&mut sim, 5);
    assert_eq!(sim.lua.get_number("inits"), Some(1.0));
    assert_eq!(sim.lua.get_number("resets"), Some(0.0));
    sim.reset();
    assert_eq!(sim.lua.get_number("resets"), Some(1.0));
    assert_eq!(sim.lua.get_number("inits"), Some(1.0));
    assert_eq!(sim.ticks(), 0.0);
}

#[test]
fn the_walker_crawls_north_on_up_and_stays_upright() {
    let mut sim = load(&sample("walker"), course());
    steps(&mut sim, 30);
    let z0 = sim.core_position().z;
    sim.press(0);
    steps(&mut sim, 180); // 6 s
    // one-leg-at-a-time crawl with the instant (teleporting) servo; with the measured frame friction (0.1) the feet
    // slip a little: ~0.6 m in 6 s
    assert!(sim.core_position().z < z0 - 0.4, "{} vs {z0}", sim.core_position().z);
    assert!(up_y(&sim) > 0.9); // up vector still up
}

#[test]
fn the_tank_turns_its_turret_with_d_and_fires_with_z() {
    let mut sim = load(&sample("tank"), course());
    steps(&mut sim, 160);
    sim.press(9); // D
    steps(&mut sim, 30);
    sim.release(9);
    assert!(sim.val("TURRET").unwrap() > 60.0);
    sim.press(4); // Z
    sim.step();
    assert_eq!(sim.state().world.projectiles.len(), 1);
}

#[test]
fn the_plane_takes_off_when_pull_up_is_held_at_full_throttle() {
    let mut sim = load(&sample("plane"), course());
    steps(&mut sim, 30);
    let y0 = sim.core_position().y;
    sim.press(4); // Z throttle
    sim.press(1); // ↓ pull up
    let mut max_y = y0;
    for _ in 0..240 {
        sim.step();
        max_y = max_y.max(sim.core_position().y);
    }
    assert!(max_y > y0 + 4.0, "{max_y} vs {y0}");
    assert!(sim.script_error.is_none());
}

#[test]
fn holds_the_original_measured_variable_angle_standing_fixture() {
    let src = std::fs::read_to_string(format!("{}/../tools/orig-harness/standing-angle-variable.rcd", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let mut sim = load(&src, course());
    let mut min_up: f64 = 1.0;
    for _ in 0..240 {
        sim.step();
        min_up = min_up.min(up_y(&sim));
    }
    assert!(min_up > 0.97, "{min_up}");
    assert!(sim.script_error.is_none());
}

#[test]
fn balances_symmetric_airborne_folds_without_rolling_the_core_or_translating_the_mass_centre() {
    let sim = load(
        "
    Val { A(default=0,min=-90,max=90) } Key {}
    Body { Core(){
      W:Frame(angle=A){W:Weight(angle=-A){}}
      E:Frame(angle=A){E:Weight(angle=-A){}}
    } }
  ",
        course(),
    );
    let centre = |s: &SimState| {
        let a = s.world.assembly().unwrap();
        let total: f64 = s.world.tiles.iter().map(|t| a.tiles[t.tile].mass).sum();
        s.world.tiles.iter().enumerate().fold(Vec3::default(), |c, (i, t)| c.add(s.world.pose(i).position.scale(a.tiles[t.tile].mass / total)))
    };
    let before = centre(&sim.state());
    sim.set_val("A", 45.0);
    {
        let mut g = sim.state_mut();
        let SimState { world, vars, .. } = &mut *g;
        world.apply_controls(&|n: &str| vars.get(n));
    }
    let s = sim.state();
    assert!(s.world.pose(0).quaternion.z.abs() < 1e-6);
    let after = centre(&s);
    assert!(after.sub(before).length() < 1e-6, "{after:?} vs {before:?}");
}

// ---------------------------------------------------------------------------------------- measured-api.test.ts

fn run_bare(src: &str, frames: usize, read: impl Fn(&Simulation) -> f64) -> f64 {
    let mut sim = load(src, bare());
    steps(&mut sim, frames);
    read(&sim)
}

#[test]
fn weight_drops_what_split_cut_off_chips_does_not() {
    // harness_weight.rcs: 176.4 kg, 50.4 after _SPLIT cuts the Chip+Weight off; _CHIPS keeps 4
    let src = "Val { A(default=0) }\nKey { }\nBody { Core(){ N:Chip(name=cut){ N:Weight(){ } } S:Chip(){ } } }\nLua {\nfunction OnFrame()\n  if _TICKS()==10 then _SPLIT(CUT) end\nend\n}\n";
    assert!((run_bare(src, 5, |s| s.api("_WEIGHT", &[])) - 176.4).abs() < 0.5);
    assert!((run_bare(src, 20, |s| s.api("_WEIGHT", &[])) - 50.4).abs() < 0.5);
    assert_eq!(run_bare(src, 20, |s| s.api("_CHIPS", &[])), 4.0);
}

#[test]
fn a_balloon_jet_of_option_1_lifts_and_option_2_does_not() {
    // rc_models40.sh: two option-1 jets at 4000 lift a 98.7 kg core, option-2 (air) ones do nothing
    for (option, lifts) in [(1, true), (2, false)] {
        let src = format!("Val {{ P(default=0,min=-100000,max=100000) }}\nKey {{ }}\nBody {{ Core(){{ N:Jet(power=P,option={option}){{ }} S:Jet(power=P,option={option}){{ }} }} }}\nLua {{\nfunction OnFrame()\n  if _TICKS()>=30 then P=4000 end\nend\n}}\n");
        let y = run_bare(&src, 90, |s| s.api("_Y", &[0.0]));
        assert_eq!(y > 1.0, lifts, "option {option}: y = {y}");
    }
}

#[test]
fn az_of_an_upside_down_chip_is_a_tilt_not_an_euler_roll() {
    // rc_models38.sh: an upside-down chip reads _AZ ≈ 0 although its Euler roll is ±π
    let az = run_bare("Val { A(default=0) }\nKey { }\nBody { Core(){ N:Chip(angle=180){ } E:Chip(angle=40){ } } }\n", 120, |s| s.api("_AZ", &[1.0]));
    assert!((az - 0.35).abs() < 0.05, "{az}");
}

// ------------------------------------------------------------------------------------ physics.test.ts (scripted)

#[test]
fn an_arm_charges_fires_when_power_reaches_option_and_recoils() {
    let mut sim = load(
        "
      Val { P(default=0, min=0, max=100000, step=100000) }
      Key { 4:P(step=100000) }
      Body { Core(){ W:Weight(){} E:Weight(){} S:Chip(){} N:Chip(angle=-90){ N:Arm(angle=90, power=P, option=30000, name=GUN){} } } }
      Lua { function OnFrame() E = _E(GUN) end }
    ",
        course(),
    );
    steps(&mut sim, 160); // > 150 frames: armed and charged
    assert_eq!(sim.lua.get_number("E"), Some(30000.0));
    sim.press(4);
    sim.step();
    {
        let s = sim.state();
        assert_eq!(s.world.projectiles.len(), 1);
        let v = from_vector(s.world.world.bodies[s.world.projectiles[0].body].linvel());
        assert!(v.z < -50.0, "fired north: {v:?}");
    }
    sim.step(); // the script reads the charge at the start of the next frame
    assert!(sim.lua.get_number("E").unwrap() < 5000.0); // charge spent
}

#[test]
fn bye_cuts_a_subtree_loose_top_changes_and_the_piece_falls_away() {
    let mut sim = load(
        "
      Val { }
      Key { }
      Body { Core(){ W:Chip(angle=90){ W:Wheel(){} } E:Chip(angle=90){ E:Wheel(){} } N:Chip(name=NOSE){ N:Chip(){ N:Chip(){ } } } } }
      Lua { function OnFrame() TOP = _TOP(NOSE + 2) if _TICKS() == 20 then x = _BYE(NOSE) end end }
    ",
        course(),
    );
    steps(&mut sim, 19);
    assert_eq!(sim.lua.get_number("TOP"), Some(0.0));
    steps(&mut sim, 40);
    // chip numbers: Core 0, W chip 1, W wheel 2+3, E chip 4, E wheel 5+6, NOSE 7
    assert_eq!(sim.lua.get_number("TOP"), Some(7.0)); // NOSE is now its own root
    let s = sim.state();
    let nose = s.world.assembly().unwrap().by_chip[7];
    assert!(s.world.assembly().unwrap().tiles[nose].detached);
    assert_ne!(s.world.tiles[nose].body, s.world.tiles[0].body);
}

#[test]
fn the_hover_sample_holds_about_3_m_with_its_lua_attitude_controller() {
    let mut sim = load(&sample("hover"), course());
    steps(&mut sim, 150); // 5 s
    let y = sim.core_position().y;
    assert!(y > 2.3 && y < 3.8, "{y}");
    assert!(sim.script_error.is_none());
}

// ----------------------------------------------------------------------------------- calibration.test.ts (_R*)

#[test]
fn original_orientation_calibration_with_relative_angles() {
    let sim = load(
        "Val {} Key {} Body { Core(){
      N:Chip(angle=30){} S:Rudder(angle=30){} E:Trim(angle=30){}
      W:Chip(angle=20){ N:Rudder(angle=40){ E:Trim(angle=15){} } }
    } }",
        course(),
    );
    // Original first-frame CSV; tolerance covers the original's tiny initial settling.
    let expected = [
        [1.0, -0.2588190734, 0.0, 0.0, 0.9659258127, 0.5235981142, 0.0, 0.0],
        [2.0, 0.0, 0.2588190734, 0.0, 0.9659258127, 0.0, 0.5235982472, 0.0],
        [3.0, 0.2588190734, 0.0, 0.0, 0.9659258127, -0.5235995816, 0.0, 0.0],
        [4.0, 0.0, 0.0, -0.1736480892, 0.9848078489, 0.0, 0.0, -0.3490660503],
        [5.0, 0.0593909100, 0.3368241191, -0.1631758660, 0.9254165888, -0.2216572095, 0.6676862973, -0.2719115898],
        [6.0, 0.1796742678, 0.3126437366, -0.2057444304, 0.9097473621, -0.4730085358, 0.5895209064, -0.2987421611],
    ];
    for row in expected {
        let chip = row[0];
        let mut got: Vec<f64> = ["_QX", "_QY", "_QZ", "_QW"].iter().map(|k| sim.api(k, &[chip])).collect();
        got.extend(["_RX", "_RY", "_RZ"].iter().map(|k| sim.api(k, &[chip, 0.0])));
        for (g, w) in got.iter().zip(&row[1..]) {
            assert!((g - w).abs() < 1e-5, "chip {chip}: {got:?} vs {:?}", &row[1..]);
        }
    }
}

// ------------------------------------------------------------------------------------------ plane-controls.test.ts

fn surfaces(control: &str, value: f64) -> Vec<Vec3> {
    let model = parse_rc(&sample("plane")).unwrap();
    let env = |n: &str| Some(if n == control { value } else { 0.0 });
    let a = assemble(&model, &env).unwrap().unwrap();
    a.tiles.iter().filter(|t| t.attrs.get("angle").is_some_and(|x| x.contains(control))).map(|t| Vec3::new(0.0, 1.0, 0.0).apply_quat(t.quaternion)).collect()
}

#[test]
fn plane_uses_equal_elevator_deflections_and_opposed_aileron_deflections() {
    let e = surfaces("ELEV", 10.0);
    let a = surfaces("AIL", 10.0);
    assert_eq!(e.len(), 2);
    assert!(e[0].sub(e[1]).length() < 1e-10);
    assert!(e[0].z.abs() > 0.1);
    assert_eq!(a.len(), 2);
    assert!(a[0].z * a[1].z < -0.02);
}

#[test]
fn plane_aligns_the_neutral_fin_with_forward_travel_and_deflects_it_about_vertical() {
    let zero = surfaces("RUD", 0.0)[0];
    let left = surfaces("RUD", -10.0)[0];
    let right = surfaces("RUD", 10.0)[0];
    assert!((zero.x.abs() - 1.0).abs() < 0.005);
    assert!(zero.z.abs() < 1e-10);
    assert!(left.y.abs() < 1e-10 && right.y.abs() < 1e-10);
    assert!(left.z * right.z < -0.02);
}

#[test]
fn plane_responds_on_the_requested_physical_axes_from_the_same_airborne_state() {
    let mut results: HashMap<Option<usize>, Vec3> = HashMap::new();
    for key in [None, Some(0), Some(1), Some(2), Some(3), Some(7), Some(9)] {
        let mut sim = load(&sample("plane"), course());
        {
            let mut g = sim.state_mut();
            let world = &mut g.world;
            let mut bodies: Vec<_> = world.tiles.iter().flat_map(|t| [Some(t.body), t.rim]).flatten().collect();
            bodies.sort_by_key(|h| h.into_raw_parts());
            bodies.dedup();
            for h in bodies {
                let b = world.world.bodies.get_mut(h).unwrap();
                let p = from_vector(b.translation());
                b.set_translation(to_vector(Vec3::new(p.x, p.y + 20.0, p.z)), true);
                b.set_linvel(to_vector(Vec3::new(0.0, 0.0, -30.0)), true);
            }
        }
        if let Some(k) = key {
            sim.press(k);
        }
        steps(&mut sim, 15);
        let s = sim.state();
        results.insert(key, from_vector(s.world.world.bodies[s.world.tiles[0].body].angvel()));
    }
    let r = |k: Option<usize>| results[&k];
    assert!(r(None).length() < 0.15, "{:?}", r(None));
    // ↑↓ change the autopilot's wanted climb rate, not the elevator directly, so pitch responds more gently
    assert!(r(Some(0)).x < -0.15, "{:?}", r(Some(0)));
    assert!(r(Some(1)).x > 0.15, "{:?}", r(Some(1)));
    assert!(r(Some(2)).z > 0.7, "{:?}", r(Some(2)));
    assert!(r(Some(3)).z < -0.7, "{:?}", r(Some(3)));
    assert!(r(Some(7)).y > 0.2, "{:?}", r(Some(7)));
    assert!(r(Some(9)).y < -0.2, "{:?}", r(Some(9)));
    for k in [0, 1] {
        assert!(r(Some(k)).y.abs() < 0.05 && r(Some(k)).z.abs() < 0.05, "{k}: {:?}", r(Some(k)));
    }
    for k in [7, 9] {
        assert!(r(Some(k)).z.abs() < 0.05, "{k}: {:?}", r(Some(k)));
    }
}

#[test]
fn plane_takes_off_with_pull_up_rather_than_climbing_under_neutral_controls() {
    let mut heights = Vec::new();
    for pull_up in [false, true] {
        let mut sim = load(&sample("plane"), course());
        for i in 0..180 {
            if i == 0 {
                sim.press(4);
            }
            if i == 100 {
                sim.release(4);
            }
            if i == 150 && pull_up {
                sim.press(1);
            }
            sim.step();
        }
        heights.push(sim.core_position().y);
        assert!(sim.core_position().z < -80.0, "{}", sim.core_position().z);
    }
    assert!(heights[0] < 2.0, "{heights:?}");
    assert!(heights[1] > 3.5, "{heights:?}");
}

#[test]
fn plane_rolls_straight_lifts_off_and_keeps_flying_hands_off_through_a_banked_turn() {
    let mut sim = load(&sample("plane"), course());
    let (mut liftoff, mut lowest, mut drift, mut heading_before) = (-1i64, f64::INFINITY, 0.0f64, 0.0);
    sim.press(4);
    for i in 0..30 * 40 {
        if i == 100 {
            sim.release(4);
        }
        if i == 30 * 15 {
            heading_before = sim.api("_EY", &[0.0]);
            sim.press(2);
        }
        if i == 30 * 22 {
            sim.release(2);
        }
        sim.step();
        let p = sim.core_position();
        if liftoff < 0 {
            drift = drift.max(p.x.abs());
            if p.y > 4.0 {
                liftoff = i;
            }
        } else if i > liftoff + 90 {
            lowest = lowest.min(p.y);
        }
        if i == 30 * 22 {
            assert!((sim.api("_EY", &[0.0]) - heading_before).abs() > 0.4);
        }
    }
    // Measured: liftoff ~8 s at full throttle, ~14 m sideways on the run, never below ~10 m afterwards.
    assert!(liftoff > 0 && liftoff < 30 * 12, "{liftoff}");
    assert!(drift < 30.0, "{drift}");
    assert!(lowest > 5.0, "{lowest}");
    assert!(sim.api("_EZ", &[0.0]).abs() < 0.1);
}

#[test]
fn plane_descends_flares_touches_down_gently_and_brakes_to_a_stop_in_one_piece() {
    let mut sim = load(&sample("plane"), course());
    let chips = sim.api("_CHIPS", &[]);
    let weight = sim.api("_WEIGHT", &[]);
    let (mut phase, mut touchdown, mut sink) = ("takeoff", -1i64, 0.0);
    for f in 0..30 * 90 {
        let mut keys = 0u32;
        if f < 100 {
            keys |= 1 << 4;
        }
        if f == 30 * 20 {
            phase = "approach";
        }
        if phase != "takeoff" {
            if sim.val("THROTTLE").unwrap() > 0.0 {
                keys |= 1 << 5;
            }
            keys |= 1; // a player holds ↑ until it stops
        }
        sim.set_keys(keys);
        let down = {
            let s = sim.state();
            let a = s.world.assembly().unwrap();
            s.world.tiles.iter().any(|t| a.tiles[t.tile].spec.wheel && t.contact_point.is_some())
        };
        if phase == "approach" && down {
            phase = "roll";
            touchdown = f;
            sink = -sim.api("_VY", &[0.0]);
        }
        sim.step();
    }
    assert!(touchdown > 0, "it does come down");
    assert!((touchdown as f64) / 30.0 < 60.0, "{touchdown}");
    assert!(sink < 5.0, "flared: no bounce off the gear ({sink})");
    assert!(sim.api("_VX", &[0.0]).hypot(sim.api("_VZ", &[0.0])) < 1.0, "braked to a stop");
    assert!(sim.api("_EZ", &[0.0]).abs() < 0.3 && sim.api("_EX", &[0.0]).abs() < 0.4);
    assert_eq!(sim.api("_CHIPS", &[]), chips);
    assert_eq!(sim.api("_WEIGHT", &[]), weight); // nothing broke off
}
