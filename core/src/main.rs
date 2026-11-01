//! Emscripten entry: the module is driven entirely through the exported `core_*` functions (see ffi.rs), so `main`
//! does nothing; the build passes `-sINVOKE_RUN=0` and the page never calls it.
#[allow(unused_imports)]
use snaptiles_core::ffi;

fn main() {}
