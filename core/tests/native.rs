//! The same core, run natively: physics, the Lua API and the budget.
use snaptiles_core::Core;

#[test]
fn a_box_falls_and_lua_reads_it() {
    let mut core = Core::new();
    core.add_box([0.0, 5.0, 0.0], [0.3, 0.015, 0.3], 25.2);
    core.load_lua("function OnFrame() out(0, \"y \", _Y(0), string.format(\" %d\", _TICKS())) end", 0).unwrap();
    for _ in 0..60 { core.step(); }
    let y = core.state[1];
    assert!(y < 0.1 && y > -0.05, "the box rests on the ground, y = {y}");
    assert!(core.out()[0].starts_with("y 0.0"), "{:?}", core.out());
    assert!(core.out()[0].ends_with(" 59"), "{:?}", core.out());
    assert!(core.error.is_none());
}

#[test]
fn keys_reach_the_script() {
    let mut core = Core::new();
    core.add_box([0.0, 1.0, 0.0], [0.3, 0.015, 0.3], 25.2);
    core.load_lua("function OnFrame() out(1, _KEY(0)) end", 0).unwrap();
    core.step();
    assert_eq!(core.out()[1], "0.00");
    core.set_key(0, true);
    core.step();
    assert_eq!(core.out()[1], "1.00");
}

#[test]
fn an_endless_script_is_stopped_and_errors_name_file_lines() {
    let mut core = Core::new();
    core.load_lua("function OnFrame() while true do end end", 0).unwrap();
    core.step();
    assert!(core.error.as_deref().unwrap_or("").contains("budget"), "{:?}", core.error);
    let mut core = Core::new();
    let err = core.load_lua("\nlocal x = \nnosuch(", 4).unwrap_err();
    assert!(err.contains("line 7:"), "{err}");
}

#[test]
fn lua_50_spellings_work() {
    let mut core = Core::new();
    core.load_lua("function OnFrame() out(0, math.mod(7, 3), math.pow(2, 3), math.atan2(1, 1)) end", 0).unwrap();
    core.step();
    assert_eq!(core.out()[0], "1.008.000.79");
}
