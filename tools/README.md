# tools — probes used while building SnapTiles

All browser probes expect the dev server at `http://127.0.0.1:5173/` (`bun run dev`) and use
the Playwright Chromium with SwiftShader. Community model files are not part of this repo;
the probes take file paths.

| tool | what it does |
|---|---|
| `shot.mjs <url> <prefix> [@sample] [--file=path] [keys…]` | screenshots after holding keys (`ArrowUp:1500`, chords `ArrowUp+ArrowLeft:1500`) |
| `dump.mjs <url> [@sample] [keys…]` / `dump-file.mjs <url> <file> [type] [keys]` | per-tile rest/world poses and normals |
| `drive-probe.mjs <keys:ms> <file…>` | holds keys, reports distance / speed / upright (`TUNE` json env, `TAIL` ms) |
| `track-probe.mjs <file> <keys> [samples]` | core pose every 250 ms while keys are held |
| `delta-probe.mjs <file> <phase1> <phase2> <expr>` | evaluates an expression before/after adding keys (control response signs) |
| `tune-probe.mjs <idleMs> <file…>` | sweeps `_AX/_AZ/_W*` sign conventions against self-balancing models |
| `foldsign.ts <file…>` (bun) | scores the 64 joint-sign conventions by wheels at ground level, at rest |
| `restdump.ts` / `lowest.ts` (bun) | rest-pose heights, lowest tiles |
| `census.ts` (bun) | which sides children attach to on triangle cowls |
| `corpus.mjs <url> <dir…>` | runs every model and lists parse/script failures (`bun run probe:corpus`) |
| `parsecheck.ts` / `rcscript-check.ts` (bun) | parse-only checks |
| `fire-probe.mjs`, `shell-probe.mjs`, `eval-probe.mjs` | arm charge / shells, arbitrary in-page expressions |
| `touch-probe.mjs`, `pinch-probe.mjs`, `narrow-probe.mjs`, `sfx-probe.mjs`, `hash-probe.mjs` | touch keycaps, pinch zoom, mobile layout, synthesized sound, share-URL round trip |
| `fetch-model.mjs <pageUrl> <outDir>` | downloads a getuploader file by pressing its button |
| `orig-compare.ts <model> <out.csv> [--allwheels] [--power=] [--on=] [--off=] [--tune=json]` (bun) | replays the original-exe harness headless: forces ENGINE, dumps the rest pose at frame 30 and the per-frame core state in the original's columns |

Runtime knobs read by the physics through `window.__tune` (set before loading a model):
`ex ey ez ax ay az wx wy wz wLocal` (API sign conventions, see `TUNE_DEFAULTS`), `fps substeps`, `noCcd`, `wheelTorque wheelRadius wheelFriction
noReaction`, `noSpring softServo servoRate`, `aero` (`quad|newton|slope`).
