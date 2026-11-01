# snaptiles-core

The simulation core in Rust: [Rapier](https://rapier.rs) (`rapier3d` 0.36) and the model's Lua (Lua 5.4 through
[mlua](https://github.com/mlua-rs/mlua), vendored C sources) in one crate. It builds natively (headless runs, `cargo
test`) and with Emscripten into one WebAssembly ES module for the browser. The page reads the bodies' state straight
out of the module's memory, and Lua calls the physics without leaving WebAssembly.

Status: the page's only simulation core since 2026-11-02 (core/PORT.md). Parser and assembler, the physics world,
Val/Key handling, the full script API, Lua (`src/scripting/lua.rs`) and the legacy `Script` (`rcscript.rs`) run
natively and in the page. `src/ffi.rs` is the C ABI the page drives (any number of simulations by id:
create/load/reset/input/step/free, ad-hoc `core_api`), `src/state.rs` the per-frame state buffer the page reads from
`HEAPF64` (layout documented there), `src/sim/rust-simulation.ts` the page's adapter (it also runs under Node, so the
vitest suites use it). The TypeScript core (rapier3d-compat + wasmoon) was removed on 2026-11-02; the TypeScript
parser and assembler stay for the editor, checked against this crate by `tests/oracle.rs`.

Native tools against the original's logs: `src/bin/replay.rs` (corpus driving and geometry), `src/bin/orig_compare.rs`
(the measurement harness), `src/bin/terrain.rs` (terrain and step probes, `--features tools`); see `tools/README.md`.

## Build

```
cargo test --release                 # native
cargo run --release --bin replay -- D:/snaptiles-models/quarantine/original/runs   # corpus replay → snap_rust
bun run build:core                   # browser: core/pkg/snaptiles_core.{js,wasm} (core/build-wasm.ps1)
```

The browser build needs [emsdk](https://emscripten.org/docs/getting_started/downloads.html) (`emsdk install latest`,
`emsdk activate latest`; on Windows run `python emsdk.py …` with a real Python if `python` is the Store stub) and
`rustup target add wasm32-unknown-emscripten`. `build-wasm.ps1` sets the Emscripten environment for its own process
only and points the C compiler, archiver and linker at `emcc.exe`/`emar.exe` (current emsdk ships no `.bat`).
Emscripten is used because C (Lua) does not build for `wasm32-unknown-unknown`.

`core/pkg` is committed so `bun run build` works without emsdk: **rebuild it (`bun run build:core`) after changing
`core/src`** and commit the new `snaptiles_core.{js,wasm}`. `snaptiles_core.d.ts` there is written by hand; keep it, the
`EXPORTED_FUNCTIONS` list in `.cargo/config.toml`, `src/ffi.rs` and the decoder in `src/sim/rust-simulation.ts` in step
(bump `LAYOUT_VERSION` in both when the buffer layout changes).

## Measured (2026-11-01, this machine)

The stage-1 prototype against the TypeScript stack (benchmarks removed with it, see git history `core/bench`): the same
scene in both (N boxes dropped in a grid, a Lua `OnFrame` summing `_Y` of every box).

| scene | Rust core | rapier3d-compat + wasmoon |
|---|---|---|
| 50 boxes, resting | 0.033 ms/frame | 0.256 (7.7×) |
| 200 boxes, resting | 0.091 | 0.442 (4.9×) |
| 800 boxes, resting | 0.281 | 1.551 (5.5×) |
| 200 boxes, falling | 1.854 | 3.487 (1.9×) |
| 800 boxes, falling | 4.014 | 6.131 (1.5×) |

Positions and the script's output agree exactly in these scenes. Download: the module is 1.9 MB (0.81 MB gzip)
against 4.3 MB (1.66 MB gzip) of rapier3d-compat plus 0.27 MB (0.11 MB gzip) of wasmoon. In Chromium it loaded in
~20 ms and ran 200 boxes with the Lua at 0.27 ms/frame; Vite emits the `.wasm` as a hashed asset. With the full
simulation (2026-11-02) the page's default load fell from 5.3 MB to 2.8 MB of scripts and WebAssembly.
