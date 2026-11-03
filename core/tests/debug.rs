//! Replays and the page's Lua tools: a run repeats exactly from the same inputs, the watch list shows the model's own
//! globals, and a breakpoint records the locals at its line.
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
    sim.set_breakpoints(vec![line]);
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
