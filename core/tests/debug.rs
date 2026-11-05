//! Replays and the page's Lua tools: a run repeats exactly from the same inputs, the watch list shows the model's own
//! globals, and a breakpoint records the locals at its line.
use snaptiles_core::scripting::lua::{check_syntax, Breakpoint};
use snaptiles_core::{PhysicsOptions, Simulation};

const BODY: &str = "Val { ENGINE(default=0,min=-2000,max=2000,step=200) }
Key { 0:ENGINE(step=200) }
Body { Core(){ N:Chip(){ N:Wheel(angle=90,power=ENGINE){ } } S:Chip(){ S:Wheel(angle=90,power=ENGINE){ } } } }
";

fn model(lua: &str) -> String {
    format!("{BODY}Lua {{\n{lua}\n}}\n")
}

/// math.random, _RND and the order of `pairs` over string keys, written to out() every frame
const NOISY: &str = "t = { alpha = 1, beta = 2, gamma = 3, delta = 4, epsilon = 5, zeta = 6 }
function OnFrame()
  local order = ''
  for k, _ in pairs(t) do order = order .. k:sub(1, 1) end
  out(0, order, math.random(1000), _RND())
  if math.random() < 0.3 then ENGINE = 2000 * math.random() end
end";

#[test]
fn a_run_repeats_exactly_even_with_another_simulation_interleaved() {
    let src = model(NOISY);
    let mut a = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    let mut b = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    for f in 0..120 {
        if f % 7 == 0 {
            a.press(0);
            b.press(0);
        } else {
            a.release(0);
            b.release(0);
        }
        a.step();
        // a third simulation drawing random numbers between the two must not disturb either
        let mut other = Simulation::load(&src, PhysicsOptions::default()).unwrap();
        other.step();
        b.step();
        assert_eq!(a.out, b.out, "frame {f}");
        assert_eq!(a.core_position(), b.core_position(), "frame {f}");
    }
    assert!(a.script_error.is_none(), "{:?}", a.script_error);
}

#[test]
fn the_watch_list_shows_the_models_own_globals_only() {
    let src = model("count = 0\nlabel = 'ready'\nv = { 1, 2, x = 3 }\nfunction helper() end\nfunction OnFrame()\n  count = count + 1\nend");
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    sim.step();
    sim.step();
    let w = sim.lua_watch();
    let names: Vec<&str> = w.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names, ["count", "label", "v"], "{w:?}");
    assert_eq!(w[0].1, "2");
    assert_eq!(w[1].1, "\"ready\"");
    assert!(w[2].1.contains("x=3") && w[2].1.contains("[1]=1"), "{}", w[2].1);
}

#[test]
fn a_breakpoint_records_the_locals_at_its_line() {
    // the Lua block opens on file line 4 (after Val, Key and Body), so its first line of code is file line 5
    let src = model("function OnFrame()\n  local speed = _TICKS() * 2\n  local name = 'probe'\n  out(0, speed, name)\nend");
    let line = src.lines().position(|l| l.contains("out(0, speed")).unwrap() as i64 + 1;
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    sim.step();
    assert!(sim.break_hit().is_none());
    sim.set_breakpoints(vec![Breakpoint { line, after: 1, ..Default::default() }]);
    sim.step();
    let snap = sim.break_hit().expect("breakpoint hit");
    let parts: Vec<&str> = snap.split('\u{1f}').collect();
    assert_eq!(parts[0], line.to_string());
    assert!(parts.contains(&"speed\u{1e}2"), "{snap:?}");
    assert!(parts.contains(&"name\u{1e}\"probe\""), "{snap:?}");
    // the step completed: out() ran after the breakpoint line
    assert_eq!(sim.out[0], "2 probe");
    sim.set_breakpoints(Vec::new());
    sim.step();
    assert!(sim.break_hit().is_none());
}

#[test]
fn a_breakpoint_can_wait_for_a_condition_or_a_pass_count() {
    let src = model("function OnFrame()
  local t = _TICKS()
  out(0, t)
end");
    let line = src.lines().position(|l| l.contains("out(0, t)")).unwrap() as i64 + 1;
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    // a condition over a local: stops only on the frame where t == 5
    sim.set_breakpoints(vec![Breakpoint { line, after: 1, condition: Some("t == 5".into()), hits: 0 }]);
    let stops: Vec<f64> = (0..10).filter_map(|_| { sim.step(); sim.break_hit().map(|_| sim.ticks()) }).collect();
    assert_eq!(stops, [6.0]); // _TICKS() is 5 inside the frame that ends at tick 6
    // a pass count: the 3rd pass and every pass after it
    sim.set_breakpoints(vec![Breakpoint { line, after: 3, condition: None, hits: 0 }]);
    let hits: Vec<bool> = (0..5).map(|_| { sim.step(); sim.break_hit().is_some() }).collect();
    assert_eq!(hits, [false, false, true, true, true]);
    // a broken condition never stops
    sim.set_breakpoints(vec![Breakpoint { line, after: 1, condition: Some("nosuch.field > 1".into()), hits: 0 }]);
    sim.step();
    assert!(sim.break_hit().is_none());
    assert!(sim.script_error.is_none());
}

#[test]
fn a_running_lua_block_can_be_replaced_keeping_its_state() {
    let src = model("count = 0
LIMIT = 3
function OnFrame()
  count = count + 1
  out(0, count, LIMIT)
end");
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    for _ in 0..10 {
        sim.step();
    }
    let pos = sim.core_position();
    // the edited constant takes its new value, the counter keeps counting, the function is the new one
    let edited = src.replace("LIMIT = 3", "LIMIT = 7").replace("out(0, count, LIMIT)", "out(0, \"v2\", count, LIMIT)");
    sim.reload_lua(&edited).unwrap();
    assert_eq!(sim.core_position(), pos, "the physics is untouched");
    sim.step();
    assert_eq!(sim.out[0], "v2 11 7");
    // anything outside the Lua section must stay as it is
    let body = edited.replace("N:Chip()", "W:Chip()");
    assert!(sim.reload_lua(&body).unwrap_err().contains("Luaの部分以外"));
    // a broken block reports its file line and the old one is gone (the script stops)
    let broken = edited.replace("count = count + 1", "count = = 1");
    assert!(sim.reload_lua(&broken).unwrap_err().contains("line "));
}

#[test]
fn the_console_evaluates_in_the_running_block() {
    let src = model("speed = 4
function OnFrame()
end");
    let mut sim = Simulation::load(&src, PhysicsOptions { no_course: true, ..Default::default() }).unwrap();
    sim.step();
    assert_eq!(sim.eval_lua("speed * 2").unwrap(), "8");
    assert_eq!(sim.eval_lua("speed = 10").unwrap(), "ok");
    assert_eq!(sim.eval_lua("speed, _TICKS()").unwrap(), "10, 1");
    assert!(sim.eval_lua("nosuch.x").is_err());
    assert!(sim.script_error.is_none(), "a console error does not stop the script");
}

#[test]
fn the_syntax_check_names_the_file_line() {
    assert_eq!(check_syntax("x = 1
function f()
end", 4), None);
    let e = check_syntax("x = 1
if x then
", 4).unwrap();
    assert!(e.contains("line "), "{e}");
}
