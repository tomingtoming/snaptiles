# Porting the simulation to Rust

Goal: the whole runtime of a model — parse, assemble, physics, Val/Key handling, Lua (and legacy `Script`) — runs in
`core/` (Rust: `rapier3d` 0.36, Lua 5.4 through `mlua`), natively and as one Emscripten module. The page keeps
drawing, the editor, input and sound in TypeScript. The editor keeps the TypeScript parser and assembler for its
preview and source patches; the runtime uses the Rust ones, and a cross-check keeps the two identical.

## Boundary

- Page → core: the model source text (UTF-8) once per load, then per frame the held keys (17 bits), and occasional
  commands (reset, add a ball, set wind).
- Core → page: one flat `f64` state buffer per frame read straight from module memory (layout in `src/state.rs`):
  per tile its pose (position, quaternion, rotor-turned like `PhysicsWorld.pose`), velocity, wheel spin angle, jet
  power and colour value; balls, crates and shells; Val values; `out()` rows, 2D/3D line lists, `_ZOOM`, the
  script error and model warnings as strings through `core_*` getters.
- No per-value calls across the boundary while stepping.

## Layout of `core/src`

| Rust | ports | notes |
|---|---|---|
| `rc/expr.rs` | `src/rc/expr.ts` | attribute expressions; identical results |
| `rc/parser.rs` | `src/rc/parser.ts` | runtime parts only: blocks, Val, Key, Body tree, Lua/Script with `firstLine`, warnings, errors with lines. Source offsets for the editor are not needed |
| `model/assemble.rs`, `model/course.rs` | `src/model/*` | type table, poses, joint frames, spawn height, the course and crates |
| `physics/world.rs`, `physics/pose_balance.rs` | `src/physics/*` | **default code paths only**: every `__tune` knob is dropped and its default inlined; constants keep their names and the measurement comments |
| `sim/simulation.rs` | `src/sim/simulation.ts` | frame order (keys → Vals → script → clamp/return → two physics steps), the full script API, reset, regulations, lines, zoom |
| `scripting/lua.rs`, `scripting/rcscript.rs` | `src/scripting/*` | `lua.rs` grows out of the prototype in `lib.rs` (COMPAT, budget, file lines) |
| `ffi.rs`, `state.rs` | — | C ABI and the state buffer |

## Oracle and acceptance

The TypeScript implementation is the oracle. `tools/export-oracle.ts` writes, for every corpus model
(`D:/snaptiles-models/quarantine/original/runs/geom/models/<n>.txt`, index in `index.tsv` there) and every sample in
`src/samples`, JSON under `D:/snaptiles-models/quarantine/oracle/`:

1. parse: Val declarations, Key bindings, node count, script language and `firstLine`, warnings, or the error;
2. assemble: per tile type, dir, parent index, mass, position, quaternion (rest pose with the default Vals);
3. run (later stages): per frame the core pose and velocity under a fixed key schedule.

Acceptance per stage:

- **Stage 1 (rc + model)**: parse and assemble match the oracle for every model — counts and names exactly, poses
  within 1e-9.
- **Stage 2 (physics + simulation + scripting)**: rapier 0.36 differs from rapier3d-compat 0.21, so trajectories are
  not expected to match bit for bit. The corpus driving comparison against the original
  (`tools/orig-harness/driverank.py` on a native replay with the same columns as `tools/drive-compare.ts`) must be at
  least as good as the TypeScript build: runs scoring above 1 ≤ 21, median ≤ 0.29, upright mismatches ≤ 11; the
  geometry ranking (`geomrank.py`) no worse; and the unit-test behaviours (`tests/*.test.ts` that exercise physics or
  scripts) hold when ported to `cargo test`.
- **Stage 3 (page)**: a TypeScript adapter with the `Simulation` surface used by `main.ts`, `scene.ts` and the HUD,
  switchable by a flag; all browser scenarios and both plane probes pass on the Rust core before it becomes the default.
