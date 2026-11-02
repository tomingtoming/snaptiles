//! C ABI over [`Simulation`] for the page (Emscripten exports these with a leading underscore; the list is in
//! `.cargo/config.toml`). The module holds any number of simulations, addressed by the id `core_create` returns, so a
//! slow older load cannot clobber a newer one. After every command that changes the world the simulation's state
//! buffer (layout in `state.rs`) is rewritten; the page reads it from `HEAPF64` at `core_state_ptr(id)`
//! (`core_state_len(id)` floats). Pointers stay valid until the next call on that simulation.
//!
//! Strings go in as (pointer, length) of UTF-8 the page wrote with `_malloc`; strings come out NUL-terminated and
//! stay valid until the next string getter.

use crate::physics::PhysicsOptions;
use crate::sim::{Arg, Ret};
use crate::state::{write_state, Generations};
use crate::Simulation;
use std::cell::RefCell;
use std::ffi::CString;

/// separator of the multi-row strings (`core_out` rows, `core_val_names`)
pub const TEXT_SEP: &str = "\u{1f}";

struct Slot {
    sim: Option<Simulation>,
    /// load error (parse/assemble) when `sim` is None
    load_error: String,
    state: Vec<f64>,
    gens: Generations,
    last_out: Vec<String>,
    last_error: Option<String>,
}

thread_local! {
    static SLOTS: RefCell<Vec<Option<Slot>>> = const { RefCell::new(Vec::new()) };
    static TEXT: RefCell<CString> = RefCell::new(CString::default());
}

fn text_out(s: &str) -> *const u8 {
    TEXT.with(|t| {
        *t.borrow_mut() = CString::new(s.replace('\0', " ")).unwrap_or_default();
        t.borrow().as_ptr() as *const u8
    })
}

unsafe fn text_in(ptr: *const u8, len: usize) -> String {
    if ptr.is_null() || len == 0 {
        return String::new();
    }
    String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned()
}

fn with_slot<R>(id: u32, d: R, f: impl FnOnce(&mut Slot) -> R) -> R {
    SLOTS.with(|s| match s.borrow_mut().get_mut(id as usize).and_then(|x| x.as_mut()) {
        Some(slot) => f(slot),
        None => d,
    })
}

/// bump the generations whose content changed, then rewrite the state buffer
fn refresh(slot: &mut Slot) {
    let Some(sim) = slot.sim.as_ref() else {
        slot.state.clear();
        return;
    };
    if sim.out != slot.last_out {
        slot.last_out = sim.out.clone();
        slot.gens.out += 1;
    }
    if sim.script_error != slot.last_error {
        slot.last_error = sim.script_error.clone();
        slot.gens.error += 1;
    }
    write_state(sim, &slot.gens, &mut slot.state);
}

/// A new, empty simulation; returns its id.
#[no_mangle]
pub extern "C" fn core_create() -> u32 {
    SLOTS.with(|s| {
        let mut s = s.borrow_mut();
        let slot = Slot { sim: None, load_error: String::new(), state: Vec::new(), gens: Generations::default(), last_out: Vec::new(), last_error: None };
        match s.iter().position(|x| x.is_none()) {
            Some(i) => {
                s[i] = Some(slot);
                i as u32
            }
            None => {
                s.push(Some(slot));
                (s.len() - 1) as u32
            }
        }
    })
}

/// Drop a simulation and its id.
#[no_mangle]
pub extern "C" fn core_free(id: u32) {
    // take it out first: dropping a Simulation (Lua state) must not run inside the SLOTS borrow
    let old = SLOTS.with(|s| s.borrow_mut().get_mut(id as usize).and_then(|x| x.take()));
    drop(old);
}

/// Parse and start a model from its `.rc` source (assemble, bodies, script, OnInit); `no_course` != 0 gives bare
/// ground. 0 on success, 1 when the model failed to parse or assemble (message in `core_error`); a script error
/// leaves the model running without its script (`core_error`, header slot 16).
///
/// # Safety
/// `ptr` must point to `len` readable bytes (or be null).
#[no_mangle]
pub unsafe extern "C" fn core_load(id: u32, ptr: *const u8, len: usize, no_course: u32) -> i32 {
    let source = text_in(ptr, len);
    with_slot(id, 1, |slot| {
        let r = Simulation::load(&source, PhysicsOptions { no_course: no_course != 0, ..Default::default() });
        slot.gens.model += 1;
        match r {
            Ok(sim) => {
                slot.sim = Some(sim);
                slot.load_error.clear();
                refresh(slot);
                0
            }
            Err(msg) => {
                slot.sim = None;
                slot.load_error = msg;
                refresh(slot);
                1
            }
        }
    })
}

/// Back to the rest pose with default Vals, then OnReset.
#[no_mangle]
pub extern "C" fn core_reset(id: u32) {
    with_slot(id, (), |slot| {
        if let Some(sim) = slot.sim.as_mut() {
            sim.reset();
            slot.gens.model += 1;
        }
        refresh(slot);
    });
}

/// The page's input for the next step: held key numbers (bit n = key n), the pointer over the view (canvas pixels)
/// and its buttons, and the view size (`_WIDTH`/`_HEIGHT`).
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn core_set_input(id: u32, keys: u32, mx: f64, my: f64, ml: f64, mr: f64, mm: f64, width: f64, height: f64) {
    with_slot(id, (), |slot| {
        if let Some(sim) = slot.sim.as_mut() {
            sim.set_keys(keys);
            let mut s = sim.state_mut();
            s.mouse.x = mx;
            s.mouse.y = my;
            s.mouse.l = ml;
            s.mouse.r = mr;
            s.mouse.m = mm;
            s.width = width;
            s.height = height;
        }
    });
}

/// Gamepad axes (−1..1) for `_ANALOG`.
#[no_mangle]
pub extern "C" fn core_set_axes(id: u32, a0: f64, a1: f64, a2: f64, a3: f64, a4: f64, a5: f64) {
    with_slot(id, (), |slot| {
        if let Some(sim) = slot.sim.as_mut() {
            sim.state_mut().axes = [a0, a1, a2, a3, a4, a5];
        }
    });
}

/// Drop a ball (the default scenario's H key); returns its index (−1 without a model).
#[no_mangle]
pub extern "C" fn core_add_ball(id: u32, radius: f64, x: f64, y: f64, z: f64, gravity: f64) -> f64 {
    with_slot(id, -1.0, |slot| {
        let i = match slot.sim.as_ref() {
            Some(sim) => sim.state_mut().world.add_ball(radius, x, y, z, gravity) as f64,
            None => -1.0,
        };
        refresh(slot);
        i
    })
}

#[no_mangle]
pub extern "C" fn core_set_wind(id: u32, x: f64, y: f64, z: f64) {
    with_slot(id, (), |slot| {
        if let Some(sim) = slot.sim.as_ref() {
            sim.state_mut().world.wind = crate::model::Vec3::new(x, y, z);
        }
        refresh(slot);
    });
}

/// Step `n` frames (keys → Vals → script → return/clamp → two physics steps each), then rewrite the state buffer.
#[no_mangle]
pub extern "C" fn core_step(id: u32, n: u32) {
    with_slot(id, (), |slot| {
        if let Some(sim) = slot.sim.as_mut() {
            for _ in 0..n {
                sim.step();
            }
        }
        refresh(slot);
    });
}

#[no_mangle]
pub extern "C" fn core_state_ptr(id: u32) -> *const f64 {
    with_slot(id, std::ptr::null(), |slot| slot.state.as_ptr())
}

#[no_mangle]
pub extern "C" fn core_state_len(id: u32) -> usize {
    with_slot(id, 0, |slot| slot.state.len())
}

/// The load error, else the script error (empty when there is none).
#[no_mangle]
pub extern "C" fn core_error(id: u32) -> *const u8 {
    let s = with_slot(id, String::new(), |slot| match slot.sim.as_ref() {
        Some(sim) => sim.script_error.clone().unwrap_or_default(),
        None => slot.load_error.clone(),
    });
    text_out(&s)
}

/// `out()` rows of the last frame, joined with U+001F (unit separator); the header carries their count.
#[no_mangle]
pub extern "C" fn core_out(id: u32) -> *const u8 {
    let s = with_slot(id, String::new(), |slot| slot.sim.as_ref().map(|sim| sim.out.join(TEXT_SEP)).unwrap_or_default());
    text_out(&s)
}

/// Val names in buffer order, joined with U+001F.
#[no_mangle]
pub extern "C" fn core_val_names(id: u32) -> *const u8 {
    let s = with_slot(id, String::new(), |slot| {
        slot.sim.as_ref().map(|sim| sim.state().vars.vals.iter().map(|v| v.name.clone()).collect::<Vec<_>>().join(TEXT_SEP)).unwrap_or_default()
    });
    text_out(&s)
}

/// Mass of the rigid body that carries tile `tile` (the group's mass for welded tiles); 0 for no such tile.
#[no_mangle]
pub extern "C" fn core_tile_body_mass(id: u32, tile: u32) -> f64 {
    with_slot(id, 0.0, |slot| {
        let Some(sim) = slot.sim.as_ref() else { return 0.0 };
        let s = sim.state();
        match s.world.tiles.get(tile as usize) {
            Some(tb) => s.world.world.bodies[tb.body].mass() as f64,
            None => 0.0,
        }
    })
}

/// Ad-hoc script API call (`sim.api()[name](...)`) with up to six numeric arguments (`argc` of them); for probes and
/// tests, never per frame. A string result reads NaN.
///
/// # Safety
/// `name` must point to `len` readable bytes.
#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub unsafe extern "C" fn core_api(id: u32, name: *const u8, len: usize, argc: u32, a0: f64, a1: f64, a2: f64, a3: f64, a4: f64, a5: f64) -> f64 {
    let name = text_in(name, len);
    with_slot(id, 0.0, |slot| {
        let Some(sim) = slot.sim.as_mut() else { return 0.0 };
        let all = [a0, a1, a2, a3, a4, a5];
        let args: Vec<Arg> = all[..(argc as usize).min(6)].iter().map(|&x| Arg::Num(x)).collect();
        let r = match sim.state_mut().call_api(&name, &args) {
            Ret::Num(x) => x,
            Ret::Str(_) => f64::NAN,
        };
        refresh(slot);
        r
    })
}
