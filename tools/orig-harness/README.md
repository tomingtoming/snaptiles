# Measuring the original RigidChips 1.5B26 under wine

The original exe (quarantined copy, not in this repo) runs in WSL2 Ubuntu-24.04 with wine 9
(`WINEPREFIX=~/.wine-rc`, win32) on an Xvfb display. It loads `Resources/Basic.txt` as the default
model and `Resources/System.rcs` as the default scenario, so experiments replace those two files.

- `harness_System.rcs` — scenario: every Wheel/RLW gets `POWER` ±2500 (by side) during frames
  31..150, rest pose of every chip at frame 30 → `geom.txt`, per-frame core state → `log.txt`
  (written once at frame 330; file handles do not survive across frames in the original).
- `harness_turn.rcs` — same with power until 210 and the first Rudder set to 20° (note: the model's
  own `angle=Val` overrides `_SET ANGLE` each frame; use a model with a constant angle instead).
- `harness_turn2.rcs` — log only (same columns as `harness_turn.rcs`); the model drives and steers itself
  (Val defaults + its own Lua, see `rc_models17.sh`/`rc_models18.sh`). Replay with
  `bun tools/orig-compare.ts <model> <out.csv> --self --turn --tune='{"noCourse":true}'` and compare both
  logs with `turndiff.py <csv…>` (speed, yaw rate, radius, lateral g, body slip per 20-frame window).
- `harness_wheels.rcs` — log only: core pose/velocity/Euler plus `_WY` of up to six wheels (`rc_models19.sh`
  straight-line spin probes). Replay with `--self --wheels`.
- `rc_launch.sh <secs>` — one run with a screenshot. `rc_batch.sh name:model:power ...` — batch
  runs, copies `log.txt`/`geom.txt`/screenshot to `D:\snaptiles-models\quarantine\original\runs\`.
  `HARNESS=<path>` picks the scenario. `rc_models.sh` writes the probe models.
- Replay in SnapTiles: `bun tools/orig-compare.ts <model> <out.csv> --allwheels --off=210`.

Results are summarised in `docs/measured.md`.

For the static-angle binding diagnostic, `standing-angle-variable.rcd` and
`standing-angle-literal.rcd` are an 18-tile generated fixture pair. Run either with
`harness_idle.rcs` through `run_probe.sh` (log name `idle.csv`). Their original
240-frame traces were identical; `standing-angle-original.csv` stores the shared
result. See `docs/sprints-45-47.md` for provenance and SnapTiles replay commands.
