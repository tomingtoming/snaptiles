//! Key numbers of the Key section (the part of `src/input/keys.ts` the simulation needs). The page maps keyboard,
//! pointer and gamepad input to these numbers and sends the held set as a 17-bit mask.

/// number of key numbers (0..=16)
pub const KEY_COUNT: usize = 17;

/// `KeyboardEvent.code` per key number. Arrow order measured on the corpus (bike: 0=engine 1=brake 2/3=steer):
/// 0 ↑, 1 ↓, 2 ←, 3 →; the original's W/A/S/D are their own numbers 15/7/8/9.
pub const KEY_CODES: [&str; KEY_COUNT] = [
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyX", "KeyC", "KeyA", "KeyS", "KeyD", "KeyV", "KeyB", "KeyF",
    "KeyG", "KeyQ", "KeyW", "KeyE",
];

/// bit of key number `n` in a held-keys mask (`None` for anything but an integer 0..=16: JavaScript's
/// `Set.has(n)` on the held numbers)
pub fn key_bit(n: f64) -> Option<u32> {
    if n.fract() == 0.0 && (0.0..KEY_COUNT as f64).contains(&n) {
        Some(1 << (n as u32))
    } else {
        None
    }
}
