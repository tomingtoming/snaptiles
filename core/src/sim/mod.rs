//! One running model (port of `src/sim/simulation.ts`): Val state, keys, the script (Lua or legacy Script) and the
//! physics stepping, plus the script API (`api.rs`).

pub mod api;
pub mod keys;
mod simulation;

pub use api::{api, lookup, Arg, Ret};
pub use simulation::*;

use std::cell::Cell;

thread_local! {
    static RNG: Cell<u64> = const { Cell::new(0x9E37_79B9_7F4A_7C15) };
}

/// `Math.random()` stand-in: xorshift64*, seeded the same way on every run so headless replays repeat exactly
/// (the browser's `Math.random` is not seedable; nothing measured depends on its values).
pub fn random() -> f64 {
    RNG.with(|r| {
        let mut x = r.get();
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        r.set(x);
        (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    })
}

/// Reseed [`random`] (tests and replays).
pub fn seed_random(seed: u64) {
    RNG.with(|r| r.set(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed }));
}
