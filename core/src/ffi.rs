//! C ABI for the page (Emscripten exports these with a leading underscore). One core per module instance.
//! Strings go in as (pointer, length) of UTF-8 the page wrote with `_malloc`; strings come out NUL-terminated and
//! stay valid until the next call that replaces them.

use crate::Core;
use std::cell::RefCell;
use std::ffi::CString;

thread_local! {
    static CORE: RefCell<Core> = RefCell::new(Core::new());
    static TEXT: RefCell<CString> = RefCell::new(CString::default());
}

fn text_out(s: &str) -> *const u8 {
    TEXT.with(|t| {
        *t.borrow_mut() = CString::new(s.replace('\0', " ")).unwrap_or_default();
        t.borrow().as_ptr() as *const u8
    })
}

unsafe fn text_in(ptr: *const u8, len: usize) -> String {
    if ptr.is_null() { return String::new(); }
    String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned()
}

#[no_mangle]
pub extern "C" fn core_reset() { CORE.with(|c| *c.borrow_mut() = Core::new()); }

#[no_mangle]
pub extern "C" fn core_add_box(x: f64, y: f64, z: f64, hx: f64, hy: f64, hz: f64, mass: f64) -> u32 {
    CORE.with(|c| c.borrow_mut().add_box([x, y, z], [hx, hy, hz], mass) as u32)
}

/// 0 on success, 1 when the script failed to load (read the message with `core_error`).
#[no_mangle]
pub unsafe extern "C" fn core_load_lua(ptr: *const u8, len: usize, line_offset: u32) -> i32 {
    let source = text_in(ptr, len);
    CORE.with(|c| if c.borrow_mut().load_lua(&source, line_offset as usize).is_ok() { 0 } else { 1 })
}

#[no_mangle]
pub extern "C" fn core_set_key(key: u32, down: i32) { CORE.with(|c| c.borrow_mut().set_key(key as usize, down != 0)); }

#[no_mangle]
pub extern "C" fn core_step() { CORE.with(|c| c.borrow_mut().step()); }

/// Steps `n` frames in one call (benchmarks and headless runs avoid one boundary crossing per frame).
#[no_mangle]
pub extern "C" fn core_step_n(n: u32) { CORE.with(|c| { let mut c = c.borrow_mut(); for _ in 0..n { c.step(); } }); }

#[no_mangle]
pub extern "C" fn core_state_ptr() -> *const f64 { CORE.with(|c| c.borrow().state.as_ptr()) }

#[no_mangle]
pub extern "C" fn core_state_len() -> usize { CORE.with(|c| c.borrow().state.len()) }

#[no_mangle]
pub extern "C" fn core_error() -> *const u8 { CORE.with(|c| text_out(c.borrow().error.as_deref().unwrap_or(""))) }

#[no_mangle]
pub extern "C" fn core_out() -> *const u8 { CORE.with(|c| text_out(&c.borrow().out().join("\n"))) }
