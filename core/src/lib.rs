//! SnapTiles simulation core: the model's parser and assembler, Rapier physics, Val/Key handling and the model's
//! scripts (Lua 5.4 through mlua, and the legacy `Script`) in one Rust crate, built natively for fast headless runs
//! and with Emscripten into one WebAssembly module for the browser. See core/PORT.md for the layout and the stages.

pub mod ffi;
pub mod js;
pub mod model;
pub mod physics;
pub mod rc;
pub mod scripting;
pub mod sim;
pub mod state;

pub use physics::PhysicsOptions;
pub use sim::{Simulation, FRAME_RATE, PHYSICS_SUBSTEPS};
