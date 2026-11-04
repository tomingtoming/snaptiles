# tools — probes used while building SnapTiles

All browser probes expect the dev server at `http://127.0.0.1:5173/` (`bun run dev`) and use
the Playwright Chromium with SwiftShader. Community model files are not part of this repo;
the probes take file paths.

| tool | what it does |
|---|---|
| `shot.mjs <url> <prefix> [@sample] [--file=path] [keys…]` | screenshots after holding keys (`ArrowUp:1500`, chords `ArrowUp+ArrowLeft:1500`) |
| `dump.mjs <url> [@sample] [keys…]` / `dump-file.mjs <url> <file> [type] [keys]` | per-tile rest/world poses and normals |
| `drive-probe.mjs <keys:ms> <file…>` | holds keys on bare ground (`?bare`), reports distance / speed / upright (`TAIL` ms) |
| `track-probe.mjs <file> <keys> [samples]` | core pose every 250 ms while keys are held |
| `delta-probe.mjs <file> <phase1> <phase2> <expr>` | evaluates an expression before/after adding keys (control response signs) |
| `foldsign.ts <file…>` (bun) | scores the 64 joint-sign conventions by wheels at ground level, at rest |
| `restdump.ts` / `lowest.ts` (bun) | rest-pose heights, lowest tiles |
| `census.ts` (bun) | which sides children attach to on triangle cowls |
| `corpus.mjs <url> <dir…>` | runs every model and lists parse/script failures (`bun run probe:corpus`) |
| `parsecheck.ts` (bun) | parse-only check |
| `fire-probe.mjs`, `shell-probe.mjs`, `eval-probe.mjs` | arm charge / shells, arbitrary in-page expressions |
| `touch-probe.mjs`, `pinch-probe.mjs`, `narrow-probe.mjs`, `sfx-probe.mjs`, `hash-probe.mjs` | touch keycaps, pinch zoom, mobile layout, synthesized sound, share-URL round trip |
| `fetch-model.mjs <pageUrl> <outDir>` | downloads a getuploader file by pressing its button |
| `editor-ci.mjs [probe…]` | serves `dist` (run `bun run build` first) and runs the editor and runtime probes |

Headless runs against the original's logs are native Rust binaries in `core/` (2026-11-02; they replaced the
TypeScript `drive-compare`, `geom-compare`, `orig-compare`, `step-compare` and `terrain-compare`):

| `cargo run --release …` in `core/` | what it does |
|---|---|
| `--bin replay -- <runs> [n…]` | corpus driving and geometry replay (`SNAP_DIR`, default `snap_rust`) for `driverank.py` / `geomrank.py` |
| `--bin orig_compare -- <model> <out.csv> [--allwheels] [--power=] [--on=] [--off=] [--self] [--nocourse] [--key=N:a:b] [--turn\|--wheels\|--arm\|--fuel\|--chips6\|--chips10]` | the original-exe harness: forces ENGINE, dumps the rest pose at frame 30 and the per-frame state in the original's columns |
| `--features tools --bin terrain -- <scene\|all> <dir>` / `-- step <out.csv> --h=0.10` | terrain probes of `orig-harness/terrains.json` and the step probe, for `terraindiff.py` / `stepdiff.py` |

The physics keeps no runtime knobs. The page's `?bare` query drops the course blocks and crates (bare ground) for
measurement probes; tests pass `{ bare: true }` to `RustSimulation`.
