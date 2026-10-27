# Measuring the original RigidChips 1.5B26 under wine

The original exe (quarantined copy, not in this repo) runs in WSL2 Ubuntu-24.04 with wine 9
(`WINEPREFIX=~/.wine-rc`, win32) on an Xvfb display. It loads `Resources/Basic.txt` as the default
model and `Resources/System.rcs` as the default scenario, so experiments replace those two files.

- `harness_System.rcs` — scenario: every Wheel/RLW gets `POWER` ±2500 (by side) during frames
  31..150, rest pose of every chip at frame 30 → `geom.txt`, per-frame core state → `log.txt`
  (written once at frame 330; file handles do not survive across frames in the original).
- `harness_turn.rcs` — same with power until 210 and the first Rudder set to 20° (note: the model's
  own `angle=Val` overrides `_SET ANGLE` each frame; use a model with a constant angle instead).
- `rc_launch.sh <secs>` — one run with a screenshot. `rc_batch.sh name:model:power ...` — batch
  runs, copies `log.txt`/`geom.txt`/screenshot to `D:\snaptiles-models\quarantine\original\runs\`.
  `HARNESS=<path>` picks the scenario. `rc_models.sh` writes the probe models.
- Replay in SnapTiles: `bun tools/orig-compare.ts <model> <out.csv> --allwheels --off=210`.

Results are summarised in `docs/measured.md`.
