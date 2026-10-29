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
model in place, `U` reloads it, Space pauses, Ctrl+S saves the editor as a
`.rcd` file, and **開く** reopens a `.rc`/`.rcd`/`.txt` file (including on mobile). Files can also be dropped onto the editor. Views: `1`
chase, `2` free orbit, `3` top, `4` onboard (the model's `_ZOOM` sets its field
of view), or the ◎ button. Drag to orbit, wheel or pinch to zoom. The keycaps
at the bottom are the model's keys and work by touch; W/A/S/D double as the
arrows when the model does not bind key numbers 7/8/9/15 of its own, and a
gamepad's stick/d-pad and buttons press the arrows and Z X C A S D V B. Sound
is synthesized (engine, jets, shots, impacts); 🔊 mutes it. Fuel is consumed
only when a script turns regulation E off (`_SETREG("E", 0)`), as in the
original.

Samples: `car` (↑↓ drive, ←→ steer), `plane` (Z/X throttle, ↓ pull up),
`walker` (↑ walk, ←→ turn; a Lua gait), `hover` (jets with a Lua attitude
hold; ↑↓←→ move, A/D turn), `tank` (A/D turret, Z fire). The course has a
ramp, kerbs, a gate, a wall and crates to knock over.

## Build visually

Press **組む** to pause simulation and edit the assembled model. **新規** starts
with a single Core; Undo restores the previous model. Click a tile
in the 3D view or select it in the part list. Choose a part type and N/S/E/W
to attach it, change the selected tile's type or numeric angle, or delete
its branch. **コピー** keeps the selected branch; select its new parent and an
N/S/E/W edge to attach a copy. Expressions and controls remain shared. Named
branches are protected against name collisions, and pasting requires the
referenced variables to exist. Core cannot be deleted or copied. Adding or removing parts can change numerical
chip indices; Lua that refers to chip numbers may need corresponding edits. ↶ / ↷ undo and redo edits, including
after a test run; **保存** downloads the model. Press ▶ to test it and update
the shareable URL, then **組む** to return to its construction pose.

Edits patch only the affected source ranges. Other attributes, comments,
Val/Key definitions and scripts are retained. Variable-driven angles remain
read-only in the visual panel; edit their expressions in the source. Manual
source edits reset visual undo history. Wheel/Jet/Arm power can be fixed, linked to an existing Val, or assigned a new
↑/↓ control from the 操作 menu. New controls use the current positive power
magnitude (1000 when it is zero or an expression), return to zero on release,
and never overwrite existing variables. Select a variable marked （逆） to reverse
a wheel on the opposite side. Rudder/Trim parts can also receive a new ←/→
control (±30°, returning to zero on release). GUI-generated controls expose
**最大出力（共通）** / **最大角度（共通）**: changing the magnitude updates its
bounds, both keys and release together for every connected part. Manually
altered or arbitrary controls remain source-only. Colours, other key mappings and Lua
still use the text editor; mirroring and multi-selection are not implemented.
Edits are also saved as the latest draft in this browser. After reloading,
open **組む** and use **下書きを復元** to recover unpublished or unfinished text.
Restoration is undoable. This is one browser-local draft, not a cloud backup;
use **保存** for a file. **全体** fits the model to the view and a yellow outline
marks the selected tile. **選択へ** zooms to it; the list marks it with ● and
scrolls it into view. Drag and zoom work while editing. Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z undo/redo visual edits when focus is outside text controls.
The editor is independently implemented, without RCD/RCM source or assets.

Production-build browser regression: `bun run build && bun run test:editor`
(install Chromium first with `bun x playwright install chromium`). This runs
in CI with an OS-assigned port and uploads screenshots on failure.

Optional external-model edit regression (models stay outside this repository):
`bun run tools/editor-corpus.ts <model-directory>`. This checks parsing,
assembly and reversible edits, not physics or full Lua compatibility.

Browser regression (against an already running dev server):
`node tools/editor-probe.mjs http://127.0.0.1:<port>/`.

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
  `0 ↑ 1 ↓ 2 ← 3 → 4 Z 5 X 6 C 7 A 8 S 9 D 10 V 11 B 12 F 13 G 14 Q 15 W 16 E`
  (measured on the original; no other key has a number).
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
