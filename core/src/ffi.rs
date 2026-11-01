//! Minimal C ABI over [`Simulation`] (Emscripten exports these with a leading underscore). One simulation per module
//! instance. Stage 3 replaces this with the real page boundary (core/PORT.md); the names are the ones the link
//! configuration in `.cargo/config.toml` exports.
//!
//! Strings go in as (pointer, length) of UTF-8 the page wrote with `_malloc`; strings come out NUL-terminated and
//! stay valid until the next call that replaces them.

use crate::physics::PhysicsOptions;
use crate::Simulation;
use std::cell::RefCell;
use std::ffi::CString;

thread_local! {
    static SIM: RefCell<Option<Simulation>> = const { RefCell::new(None) };
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static STATE: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static TEXT: RefCell<CString> = RefCell::new(CString::default());
}

fn text_out(s: &str) -> *const u8 {
    TEXT.with(|t| {
        *t.borrow_mut() = CString::new(s.replace('\0', " ")).unwrap_or_default();
        t.borrow().as_ptr() as *const u8
    })
}

unsafe fn text_in(ptr: *const u8, len: usize) -> String {
    if ptr.is_null() {
        return String::new();
    }
    String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned()
}

fn write_state() {
    SIM.with(|s| {
        STATE.with(|st| {
            let mut st = st.borrow_mut();
            st.clear();
            if let Some(sim) = s.borrow().as_ref() {
                let state = sim.state();
                for i in 0..state.world.tiles.len() {
                    let p = state.world.pose(i);
                    st.extend_from_slice(&[p.position.x, p.position.y, p.position.z, p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w]);
                }
            }
        })
    });
}

/// Drop the running model.
#[no_mangle]
pub extern "C" fn core_reset() {
    SIM.with(|s| *s.borrow_mut() = None);
    ERROR.with(|e| e.borrow_mut().clear());
    write_state();
}

/// Kept for the link configuration; boxes are no longer part of the core (always 0).
#[no_mangle]
pub extern "C" fn core_add_box(_x: f64, _y: f64, _z: f64, _hx: f64, _hy: f64, _hz: f64, _mass: f64) -> u32 {
    0
}

/// Load and start a model from its `.rc` source; `no_course` != 0 gives bare ground. 0 on success, 1 when the model
/// failed to parse or assemble (message in `core_error`); a script error leaves the model running without it.
///
/// # Safety
/// `ptr` must point to `len` readable bytes (or be null).
#[no_mangle]
pub unsafe extern "C" fn core_load_lua(ptr: *const u8, len: usize, no_course: u32) -> i32 {
    let source = text_in(ptr, len);
    let r = Simulation::load(&source, PhysicsOptions { no_course: no_course != 0, ..Default::default() });
    let code = match r {
        Ok(sim) => {
            ERROR.with(|e| *e.borrow_mut() = sim.script_error.clone().unwrap_or_default());
            SIM.with(|s| *s.borrow_mut() = Some(sim));
            0
        }
        Err(msg) => {
            ERROR.with(|e| *e.borrow_mut() = msg);
            SIM.with(|s| *s.borrow_mut() = None);
            1
        }
    };
    write_state();
    code
}

#[no_mangle]
pub extern "C" fn core_set_key(key: u32, down: i32) {
    SIM.with(|s| {
        if let Some(sim) = s.borrow_mut().as_mut() {
            if down != 0 {
                sim.press(key as usize)
            } else {
                sim.release(key as usize)
            }
        }
    });
}

fn step_n(n: u32) {
    SIM.with(|s| {
        if let Some(sim) = s.borrow_mut().as_mut() {
            for _ in 0..n {
                sim.step();
            }
            ERROR.with(|e| *e.borrow_mut() = sim.script_error.clone().unwrap_or_default());
        }
    });
    write_state();
}

#[no_mangle]
pub extern "C" fn core_step() {
    step_n(1);
}

/// Steps `n` frames in one call (benchmarks and headless runs avoid one boundary crossing per frame).
#[no_mangle]
pub extern "C" fn core_step_n(n: u32) {
    step_n(n);
}

/// x, y, z, qx, qy, qz, qw per tile (the core first)
#[no_mangle]
pub extern "C" fn core_state_ptr() -> *const f64 {
    STATE.with(|s| s.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn core_state_len() -> usize {
    STATE.with(|s| s.borrow().len())
}

#[no_mangle]
pub extern "C" fn core_error() -> *const u8 {
    ERROR.with(|e| text_out(&e.borrow()))
}

#[no_mangle]
pub extern "C" fn core_out() -> *const u8 {
    SIM.with(|s| text_out(&s.borrow().as_ref().map(|sim| sim.out.join("\n")).unwrap_or_default()))
}
