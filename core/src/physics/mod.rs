//! The physics layer (port of `src/physics/*`, default code paths only — core/PORT.md stage 2a).
//!
//! Every `__tune` knob of the TypeScript is dropped and its default inlined; the constants keep their names and
//! measurement comments. The world runs on `rapier3d` 0.36 where the TypeScript runs on rapier3d-compat 0.21; the
//! places where the two APIs differ are noted where they are used.

pub mod math;
pub mod pose_balance;
mod arm;
mod impact;
mod servo;
mod wheel;
mod world;

pub use pose_balance::{balance_pose, Balance, MassPoint};
pub use world::*;
