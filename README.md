# SnapTiles

A browser sandbox for building vehicles out of square tiles and driving them
with the keyboard or Lua. The simulation core (`core/`) is Rust: [Rapier](https://rapier.rs) (3D rigid bodies)
and Lua 5.4 through [mlua](https://github.com/mlua-rs/mlua), built with Emscripten into one WebAssembly module;
the page draws with [three.js](https://threejs.org).

It reads the `.rc` model format and implements parts of the RigidChips script
API, including `_KEY()`/`_X()`/`out()`. Supported models can be pasted in and
played; compatibility is incomplete. SnapTiles is
a clean-room reimplementation: it was written from public documentation,
wikis and black-box observations (see `docs/spec/` and `docs/measured.md`),
without reading any RigidChips source code.
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

## Play

Paste a model into the editor and press ▶ (or Ctrl+Enter). `R` resets the
model in place, `U` reloads it, Space pauses, Ctrl+S saves the editor as a
`.rcd` file, and **開く** reopens a `.rc`/`.rcd`/`.txt` file (including on mobile).
Files can also be dropped onto the editor.

- **Views** are the original's A–J (F8–F12 = A–E, Ctrl+F8–F12 = F–J; also `1`–`9`,
  `0` and the view button, since browsers may keep F11/F12). A, the default, is the
  original's leash chase that follows the model's motion, not its heading; I/O zoom
  every view. Dragging, the wheel and pinching swing or lengthen view A's leash, a
  SnapTiles extra; H uses the model's `_ZOOM` field of view. See `docs/measured.md`
  (camera).
- **Keys**: the keycaps at the bottom are the model's keys and work by touch;
  W/A/S/D double as the arrows when the model does not bind key numbers 7/8/9/15 of
  its own, and a gamepad's stick/d-pad and buttons press the arrows and Z X C A S D V B.
  Keyboard aliases and on-screen controls can be held together.
- **Sound** is synthesized (engine, jets, shots, impacts); 🔊 mutes it. Without the
  audio API the button is disabled and everything else works.
- **Fuel** is consumed only when a script turns regulation E off (`_SETREG("E", 0)`),
  as in the original.

Samples: `car` (↑↓ drive, ←→ steer), `plane` (Z/X throttle, then it lifts off by
itself; a Lua autopilot holds height and level wings, ↓↑ climb/descend, ←→ bank; to land, X to
zero throttle and hold ↑: it flares by itself and brakes once down),
`walker` (↑ walk, ←→ turn; a Lua gait), `hover` (jets with a Lua attitude
hold; ↑↓←→ move, A/D turn), `tank` (A/D turret, Z fire), and `raft` (↑↓ forward/reverse, ←→ steer the twin jets). Choosing raft from the default course starts it on the water. The default course has a
ramp, kerbs, a gate, a wall and crates to knock over.

Choose **地形・お題** beside the samples for original SnapTiles terrain. Free drive
includes a kilometre-wide plateau with four peaks, a mountain pass and a six-hump washboard. The humps rise from 12 cm on
the left to 55 cm on the right. The brake track pairs a low-grip blue lane with
ordinary pavement. Brake at the white line to compare stopping distances. Timed courses include a drive over the pass,
a steering course, and a flyover with altitude gates. Cross the yellow
checkpoint before the green finish. At **入り江の試走場** (#car&c=tidal-inlet), drive north from the beach to test whether your model floats. Chip and Frame rafts rise in deep water. Weight ballast can sink them. Select **水上から落とす** to release the current model offshore. In **入り江のブイ航路** (#raft&c=inlet-buoys), drive between the yellow buoys and turn right toward the green pair. **地形図** opens the map while driving.

## Build visually

Press **組む** to pause simulation and edit the construction pose; ▶ tests the model
and **組む** returns to editing. **新規** starts with one Core. **?** opens the in-app guide.
Every visual edit is a patch of the source text: unrelated attributes, comments and Lua
stay byte-for-byte, and source typing and visual edits share one Undo/Redo history
(including incomplete syntax, selection and the source caret). Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z use it in the source and the construction controls.

### Parts and selection

- Select a part in the 3D view or the list; **全体** fits the model, **選択へ** focuses
  the selection. **探す…** finds parts by name or type.
- **Multi-selection**: Shift/Ctrl+click in the 3D view adds or removes a part; on touch,
  turn on **複数選択** and tap. Other selected parts are outlined in blue. **種類**, **角度**,
  **色** and delete then apply to every selected part as one Undo step (a part inside another
  selected branch is deleted with it); branch tools, controls and adding stay single-part.
  Choosing a part from the list, the search or **選択を解除** ends it.
- Add parts at N/S/E/W with the panel buttons or the N/W/E/S marks around the selected
  part in the 3D view. The buttons show how many children each edge already has (空き when
  none); several children on one edge are allowed and may overlap.
- Change the type or angle, or delete a part (with its branch). Core cannot be deleted.
- Wheel/RLW radius (0.30/0.45/0.60 m), Weight multiplier (up to 8) and Cowl shape (0–7) are
  edited as `option`. **色** sets a constant colour or **既定色** restores the type's default.
- Expression-valued angle, power, option and colour fields show a 「ソースで編集」 button
  that selects that attribute in the source.

### Branches and names

- **コピー** copies the selected branch; paste it by adding at a parent's edge. Named parts
  receive fresh `_COPY_n` names; expressions keep their original references, and the variables
  and part names they read must exist in the destination (missing ones are listed).
- **反対側へ** reflects the branch to the opposite edge of its parent: nested directions are
  mirrored, Rudder/Trim angles and Wheel/RLW power reversed, triangular Cowls swapped. An
  occupied opposite edge is refused.
- Under **名前・接続先**, **部品名…** names a part (ASCII, stored in uppercase, unique among
  parts and variables) and **枝を移動…** moves the branch to another parent and edge.
- Adding, removing or moving parts changes numeric chip indices; Lua that uses numbers may need
  updates (names are safer). Scripts are never rewritten.

### Controls

- Wheel/RLW/Jet/Arm **power** can be constant, bound to an existing Val (**（逆）** for the
  opposite side), or given new controls with ↑/↓, ←/→, Z/X or A/D: momentary (back to zero on
  release) or **を追加（保持）** (a throttle: the first key raises it 1% of the maximum per frame,
  the second lowers it, release holds).
- Any non-Core part can bind its **angle** the same way (±30°, back to zero on release); for a
  fixed hinge open **操作** beside the angle.
- **キーを選んで追加…** builds a control from any two of the 17 model keys and lists their
  existing assignments. **最大出力（共通）**/**最大角度（共通）** change a generated control for every
  part bound to it; **この部品用に分ける** gives one part its own copy. Hand-written controls stay
  source-edited.

### Scripts

**スクリプト（Lua）** in the builder: **Luaへ移動** jumps to the Lua section (adding one with an
`OnFrame` when there is none), a searchable reference of the API with Japanese descriptions
inserts calls at the caret, and snippets add common pieces (show a value, move a value by keys,
hold a height or level the roll with PD control) using the model's first Val. Insertion always
lands inside the Lua section. When a script error names a line, **エラーの行へ** under the
status line selects it in the source.

### Saving and sharing

**保存名** names a variant and previews its `.rcd` filename; **保存** downloads it; **開く** reads one.
**共有リンク** encodes the current source in a URL (not the local filename). The browser keeps one
latest draft with its filename; **下書きを復元** brings it back (undoably). Opening another file,
sample or link keeps the previous editor state as one Undo step. This is not a model library or a
backup: save files to keep them.

### Limits

An unknown part type stops assembly with its name and line (it is not replaced by Chip); unknown
top-level sections are kept and produce a warning. The editor is independently implemented without
RCD/RCM source or assets. A working construction
loop does not establish compatibility with every RigidChips model, script or physical behaviour.
See `docs/editor-sprints.md` for each feature's measured scope.

## Model file

```
Val  { STEER(default=0, min=-30, max=30, step=3) }
Key  { 2:STEER(step=-3)  3:STEER(step=3) }
Body { Core(){ N:Rudder(angle=STEER){ N:Chip(angle=90){ N:Wheel(power=500){ } } } } }
Lua  { function OnFrame() out(0, "x", _X(0)) end }
```

- `Val` declares variables (`default/min/max/step`; `step` is the per-frame
  return toward `default` when nothing touches the variable). Values written by
  scripts are clamped to `min/max` too.
- `Key` adds `step` to a variable every frame a key is held. Key numbers:
  `0 ↑ 1 ↓ 2 ← 3 → 4 Z 5 X 6 C 7 A 8 S 9 D 10 V 11 B 12 F 13 G 14 Q 15 W 16 E`
  (measured on the original; no other key has a number).
- `Body` is a tree of tiles. Each child is attached to a side of its parent
  (`N S E W`). `Chip`/`Frame`/`Weight`/`Jet`/`Arm` fold about the shared edge
  (`angle`; a positive angle folds the child down), `Rudder` turns about the parent's
  normal, `Trim` rolls about the connection axis, `Wheel` is a disc in the tile plane
  driven by `power`, `Jet` pushes along its normal, `Cowl` is massless decoration.
  `spring` below 1 makes a joint a torsion spring that follows its angle and gives
  under load. A wheel carrying chips spins them as a rotor.
- `Lua` (or the legacy one-statement-per-line `Script`) runs every frame:
  `OnInit`, `OnReset`, `OnFrame` (or `main`). Val variables are globals.

## Physics notes

Constants and conventions were measured on the original 1.5B26 and are recorded with
their probes in `docs/measured.md`: for example jets push 1/6 N per unit of power, a
wheel's motor gives 0.13 N·m per unit, `_AX/_AZ` are tilts of the chip's own axes,
`_WEIGHT()` counts only what is still attached to the core, and the joint, rotor,
aerodynamic, tyre and camera models. Scripts run at 30 fps with two physics steps per
frame. What is still unverified is listed there and in `docs/spec/`.

## Tests

```
bun run test                                  # unit tests (vitest)
bun run build && bun run test:editor          # browser regression against the production build
bun run test:plane                            # plane sample takeoff and GUI-built aircraft
bun run test:editor:scale                     # 101 named parts, 100 generated controls
bun run test:editor:firefox                   # creation loop in Firefox
bun run test:editor:webkit                    # creation loop in WebKit
```

Install browsers first with `bun x playwright install chromium` (and `firefox`/`webkit`).
The browser suites serve `dist` on an OS-assigned port. Remote CI is disabled; run them
locally. Automated engines and narrow windows do not establish support on physical mobile
devices or Safari on Apple devices. Windows WebKit loses WebGL pixels in screenshots after
a canvas-size change (`node tools/webkit-resize-diagnostic.mjs` reproduces it without the
app); workflow assertions still pass there.

Optional checks with models kept outside this repository:
`bun run tools/editor-corpus.ts <model-directory>` (parsing, assembly and reversible edits)
and the comparison tools against the original under `tools/orig-harness/`.

## Privacy

The live site (snaptiles.toming.app only) loads Cloudflare Web Analytics to count visits: no cookies, no personal
data. Nothing collects models, runs or challenge results; personal bests stay in the browser's local storage, and
share and record links carry their data in the URL fragment, which the beacon does not send (its payload's
`location` is the page URL without `#…`; checked 2026-11-04).

## License

AGPL-3.0-or-later.
