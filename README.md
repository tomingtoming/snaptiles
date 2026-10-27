# SnapTiles

A browser sandbox for building vehicles out of square tiles and driving them
with the keyboard or Lua. Runs on [Rapier](https://rapier.rs) (3D rigid bodies,
WebAssembly), [three.js](https://threejs.org) and [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4).

It reads the `.rc` model format and the `_KEY()`/`_X()`/`out()` script API of
RigidChips, so models written for it can be pasted in and played. SnapTiles is
a clean-room reimplementation: it was written from the public documentation
and wikis only (see `docs/spec/`), without reading any RigidChips source code.
It shares no code with it and is not affiliated with its author. RigidChips
itself was made by 学生 (Yasuhiko Takeya); its last release, 1.5B26 (2006), was
used as the reference for the physics constants recorded in `docs/measured.md`
(measured by running it, not by reading it). No RigidChips files, community
models or maps are included in this repository; bring your own `.rcd`.

Live: https://snaptiles.toming.app (source: this repository, AGPL-3.0).

## Run

```
bun install
bun run dev
```

Paste a model into the editor and press ▶ (or Ctrl+Enter). `R` resets the
model in place, `U` reloads it, Ctrl+S saves the editor as a `.rcd` file, and a
`.rcd`/`.txt` can be dropped onto the editor. Drag to orbit, wheel or pinch to
zoom. The keycaps at the bottom are the model's keys and work by touch. Sound
is synthesized (engine, jets, shots, impacts); 🔊 mutes it.

Samples: `car` (↑↓ drive, ←→ steer), `plane` (Z/X throttle, ↓ pull up),
`walker` (↑ walk, ←→ turn; a Lua gait), `hover` (jets with a Lua attitude
hold; ↑↓←→ move, A/D turn), `tank` (A/D turret, Z fire). The course has a
ramp, kerbs, a gate, a wall and crates to knock over.

## Model file

```
Val  { STEER(default=0, min=-30, max=30, step=3) }
Key  { 2:STEER(step=-3)  3:STEER(step=3) }
Body { Core(){ N:Rudder(angle=STEER){ N:Chip(angle=90){ N:Wheel(power=500){ } } } } }
Lua  { function OnFrame() out(0, "x", _X(0)) end }
```

- `Val` declares variables (`default/min/max/step`; `step` is the per-frame
  return toward `default` when nothing touches the variable).
- `Key` adds `step` to a variable every frame a key is held. Key numbers:
  `0 ↑ 1 ↓ 2 ← 3 → 4 Z 5 X 6 C 7 A 8 S 9 D 10 V 11 B 12 F 13 G 14 Q 15 W 16 E`.
- `Body` is a tree of tiles. Each child is attached to a side of its parent
  (`N S E W`). `Chip`/`Frame`/`Weight`/`Jet`/`Arm` fold about the shared edge
  (`angle`), `Rudder` turns about the parent's normal, `Trim` rolls about the
  connection axis, `Wheel` is a disc in the tile plane driven by `power`,
  `Jet` pushes along its normal, `Cowl` is massless decoration.
- `Lua` (or the legacy one-statement-per-line `Script`) runs every frame:
  `OnInit`, `OnReset`, `OnFrame` (or `main`). Val variables are globals.

Conventions that the public docs do not state were measured against community
models (see `tools/foldsign.ts`, `tools/tune-probe.mjs`, `tools/drive-probe.mjs`):
a positive fold `angle` folds the child down, `Rudder` turns the opposite way
of a right-hand rotation about the parent normal, `_AX` reports pitch with the
opposite sign of a right-hand rotation about +X, and `_WX/_WY/_WZ` are world
frame angular velocity with the sign flipped. Scripts run at 30 fps with two
physics substeps per frame. Wheel `power` maps to torque at 0.1 N·m per unit.

Details and what is still unverified against the original: `docs/spec/`.

## Tests

```
bun run test
node tools/shot.mjs http://127.0.0.1:5173/ .shots/x ArrowUp:2000   # screenshots via Playwright
```

## License

AGPL-3.0-or-later.
