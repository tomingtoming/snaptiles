# snaptiles-core (prototype)

The simulation core in Rust: [Rapier](https://rapier.rs) (`rapier3d` 0.36) and the model's Lua (Lua 5.4 through
[mlua](https://github.com/mlua-rs/mlua), vendored C sources) in one crate. It builds natively (headless runs, `cargo
test`) and with Emscripten into one WebAssembly ES module for the browser. The page reads the bodies' state straight
out of the module's memory, and Lua calls the physics without leaving WebAssembly.

Status: a prototype of the boundary only — boxes on the ground, a Lua `OnFrame` with `_X/_Y/_Z`, `_KEY`, `_TICKS`
and `out`, an instruction budget, Lua 5.0 spellings and file line numbers in errors. The app still runs on
`src/physics/world.ts` (rapier3d-compat) and wasmoon; nothing in `src/` imports this crate yet.

## Build

```
cargo test --release                 # native
pwsh core/build-wasm.ps1             # browser: core/pkg/snaptiles_core.{js,wasm}
```

The browser build needs [emsdk](https://emscripten.org/docs/getting_started/downloads.html) (`emsdk install latest`,
`emsdk activate latest`; on Windows run `python emsdk.py …` with a real Python if `python` is the Store stub) and
`rustup target add wasm32-unknown-emscripten`. `build-wasm.ps1` sets the Emscripten environment for its own process
only and points the C compiler, archiver and linker at `emcc.exe`/`emar.exe` (current emsdk ships no `.bat`).
Emscripten is used because C (Lua) does not build for `wasm32-unknown-unknown`.

## Measured (2026-11-01, this machine)

`node core/bench/compare.mjs N frames` runs the same scene in both stacks (N boxes dropped in a grid, a Lua `OnFrame`
summing `_Y` of every box); `NOWARM=1` times the falling phase instead of the resting one.

| scene | Rust core | rapier3d-compat + wasmoon |
|---|---|---|
| 50 boxes, resting | 0.033 ms/frame | 0.256 (7.7×) |
| 200 boxes, resting | 0.091 | 0.442 (4.9×) |
| 800 boxes, resting | 0.281 | 1.551 (5.5×) |
| 200 boxes, falling | 1.854 | 3.487 (1.9×) |
| 800 boxes, falling | 4.014 | 6.131 (1.5×) |

Positions and the script's output agree exactly in these scenes. Download: the module is 1.9 MB (0.81 MB gzip)
against 4.3 MB (1.66 MB gzip) of rapier3d-compat plus 0.27 MB (0.11 MB gzip) of wasmoon. In Chromium
(`node core/bench/browser-check.mjs`, Vite dev server and a production build) it loads in ~20 ms and runs 200 boxes
with the Lua at 0.27 ms/frame; Vite emits the `.wasm` as a hashed asset.
