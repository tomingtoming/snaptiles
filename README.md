# SnapTiles

A browser sandbox for building vehicles out of square tiles and driving them
with the keyboard or Lua. Runs on [Rapier](https://rapier.rs) (3D rigid bodies,
WebAssembly), [three.js](https://threejs.org) and [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4).

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

Press **組む** to pause simulation and edit the construction pose. **新規** starts
with one Core; Undo restores the previous model. Select a part in the 3D view
or list. Add parts at N/S/E/W, change their type or angle, or delete a branch.
Yellow letters and endpoint dots show the selected part's actual attachment
edges. **コピー** copies a branch to another selected parent/edge; its expressions
and controls remain shared. Named parts receive fresh `_COPY_n` names at paste time; expressions and
script references retain their original targets. Referenced variables must already exist. Core cannot be deleted
or copied. Adding/removing parts changes numerical chip indices; Lua that uses
those numbers may need manual updates.

**反対側へ** reflects the selected branch to the opposite edge of its parent in
one undoable operation, selecting the new branch. It mirrors nested attachment
directions, reverses Rudder/Trim angles and Wheel/RLW power, and swaps triangular
Cowl shapes. Ordinary fold angles and Jet/Arm power stay unchanged. Variables
remain shared; scripts and numerical part references are not rewritten. An
occupied opposite edge or expression-controlled Cowl shape is
rejected instead of silently overlapping or guessing.

Wheel/RLW/Jet/Arm power can be constant, bound to an existing Val, or assigned
new controls using ↑/↓, ←/→, Z/X or A/D. New power controls use the current positive magnitude (1000 for
zero or expressions), return to zero on release and avoid existing names.
Choose （逆） for an opposite-side wheel. Any non-Core part can bind its angle using the same key
pairs (±30°, returning to zero on release). For a fixed hinge, open **操作** beside its angle. Angle bindings also offer
**（逆）** for opposite motion; Rudder/Trim controls open by default.
Selectors show the keys for recognized
GUI controls; assigning the same keys to several controls operates them together.
Power also offers **を追加（保持）**: the first key increases and the second
decreases throttle, release holds it, and values are clamped from zero to the
maximum. Each model frame changes it by 1% of the maximum (100 frames from zero
to full); changing the maximum scales that increment. Re-running initializes
throttle to zero. Existing momentary controls retain their release-to-zero behavior. **最大出力（共通）** and **最大角度（共通）**
change GUI-generated controls for every bound part. Arbitrary expressions or
manually altered controls remain source-only.

The panel also edits wheel radius, Weight multiplier and Cowl shape. **色**
sets a constant part colour or restores its type's default. Dynamic colour
expressions stay in the source. Patches preserve unrelated attributes,
comments and Lua. Source typing and visual edits share Undo/Redo, including
incomplete syntax, selection and source caret/scroll state. Ctrl/Cmd+Z and
Ctrl/Cmd+Shift+Z use this history in the source or construction controls;
other text/number fields retain native editing Undo.

**全体** fits the model; **選択へ** focuses the selected part. Drag and zoom also
work while editing. Loaded models get an initial driving distance based on
their size; ordinary driving preserves manual zoom. **?** opens the in-app guide.

**保存名** names a variant and previews its actual .rcd filename; **保存** downloads
it. Imported/assigned names survive edits and draft recovery. New clears the
name, and Undo restores it. **開く** reads a saved file. **共有リンク** encodes the
current source without running it; it does not include the local filename.
The dialog provides a selectable URL when automatic copying is unavailable.
Press ▶ to test the model and update the URL, then **組む** to return to editing.

This browser keeps one latest draft, including unfinished text and its filename.
The recovery card identifies its name and local save time before **下書きを復元**.
Restoration is undoable. It is not a multi-model library or cloud backup; save
files for durable copies. The editor is independently implemented without
RCD/RCM source or assets. Multi-selection and a Lua programming GUI are not implemented; the source remains editable.
A working construction loop does not establish compatibility with every
RigidChips model, script or physical behavior. See `docs/editor-sprints.md` for
measured scope. Local checkout behavior may differ from the deployed website.

Production-build browser regression: `bun run build && bun run test:editor`
(install Chromium first with `bun x playwright install chromium`). This runs
in CI with an OS-assigned port and uploads screenshots on failure. The branch
workflow covers copying, subtree removal, reflection, multi-step history, live
controls, exact export and editing the result in a fresh shared-link context.
`bun run test:plane` separately checks the plane sample in Chromium: takeoff
under throttle/pull-up input and exact source export. A second flow reconstructs
the 30-part aircraft through GUI operations, compares its construction poses,
flies it, exports named bytes and re-edits the shared result. Unit tests verify control
surface geometry and isolated airborne axis responses. These checks do not
establish trimmed cruise or original-engine flight fidelity.

`bun run test:editor:scale` checks 101 named parts with 100 generated controls,
strength/history changes, named-branch duplication and a Lua model colour edit with
exact-byte export/reopening. It reports selection timings without a machine-
dependent timing threshold. Control metadata is cached only for unchanged source;
altered or duplicate declarations stay source-edited.

The separate Firefox creation-loop check is `bun run test:editor:firefox`
(install its browser with `bun x playwright install firefox`). It covers GUI
construction, driving, source Undo, named download, share/re-edit and file reopen.
The same core-loop scenario runs in WebKit via `bun run test:editor:webkit`
(install with `bun x playwright install webkit`). CI is configured for both.
These automated engines and narrow desktop windows do not establish physical
mobile-device or Safari-on-Apple-device support. Windows WebKit 27.2 on this host loses WebGL pixels in screenshots after a
canvas-size change, even though framebuffer pixels and workflow assertions pass.
`node tools/webkit-resize-diagnostic.mjs` reproduces this without the app or
Three.js. This limits visual acceptance in that engine; it does not establish
Safari behavior on Apple devices. Native-control contrast and toolbar wrapping
are checked separately. Audio is optional: when its API
is unavailable, the sound button is disabled and editing/driving remain usable.

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

Wheel/RLW parts expose three radius choices (0.30/0.45/0.60 m); Weight parts expose mass multipliers up to 8. These edit `option` and support Undo/Redo. Existing option expressions remain source-only. Larger wheels are lifted clear of the ground in the construction preview; simulation spawn behavior is unchanged.

Expand **色** to set a selected part’s fixed RGB color, including Core. **既定色** removes the color override without undoing other edits; changing the part type then uses its default palette. Undo restores the previous color. Variable-driven colors remain source-only; Lua can still override color during simulation.

Cowl parts expose shape options 0–7: plate, outline, disc, two triangles, a rounded end, and the two plate variants retained by the format. Shape changes preserve angle/color and support Undo/Redo.

Keyboard workflow: running a model focuses the view so arrow controls work immediately; a focus change made during loading is respected. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z work from part selectors. Source Tab inserts indentation; Shift+Tab leaves the source field. Modifier shortcuts do not act as vehicle controls.

The **?** button opens an in-app building guide with control assignment, branch copy, saving/sharing, camera controls and keyboard navigation. View and sound icons expose Japanese labels and current-state hints.

Keyboard aliases and on-screen controls can be held together: releasing one source leaves the others active. Starting another model clears old keycap presses.


Imported expression-valued angle, power, option and colour fields show a
「ソースで編集」button in the builder. It focuses and selects that exact attribute
in the source without changing it. Strength editing remains limited to recognised
generated controls; arbitrary expressions retain their source representation.

Unknown part types stop assembly with the original type name and line number;
they are not substituted with Chip. The source remains available for repair.
This check does not detect every unsupported section or attribute.

Unknown top-level sections are preserved but produce a non-blocking warning with
name and line number, since their contents are not executed. Attribute presence
alone is not treated as unsupported: scripts can read attributes through _GET.
Warnings coexist with script errors and draft-storage failures.

For recognised generated angle/power controls, choose 「この部品用に分ける」
to copy the control for that field. Its key pair, reversed binding, magnitude and
return/hold behavior are preserved, while later strength edits are independent.
The original definition remains for other parts/scripts; separation retains the
same physical keys. Custom definitions remain source-edited.


Choose 「キーを選んで追加…」 to create an operation from any two distinct keys
in the 17-key model input table. The held-power variant is also available.
Direction semantics are stated in the dialog. Existing four preset pairs remain;
custom pairs participate in strength editing, separation and Undo/Redo. This
creates a new control rather than changing every binding of an existing one.

The custom-key dialog lists existing Key-section assignments for each selected
key. Reusing a key remains allowed and keeps the original assignments. Script
input polling and implicit WASD arrow aliases are explicitly outside this list.


Under **名前・接続先**, **枝を移動…** relocates the selected subtree to another parent
and direction in one undoable operation. Names, internal comments and controls
are retained. Core roots, self/descendant destinations and occupied edges are
rejected. New parent transforms and declaration order can change poses and chip
numbers; numeric script references are not rewritten. This preserves local
attributes, not the branch's previous world-space pose.


**部品名…** in **名前・接続先** assigns or clears a part's name, including Core.
Names start with an ASCII letter, contain letters/digits/underscores, and are
stored in uppercase. Other part names and Val/Var names cannot collide. The
part list updates immediately; changes support Undo/Redo and survive file/share
round trips. Empty input removes all name attributes while preserving comments.
Scripts are not rewritten on rename/removal; inspect references in the source.
This is a script identifier, not a free-form display label. Copies and mirrors allocate fresh part names while leaving existing expression
and script references intact. Script-defined globals are not analyzed
for collisions by this dialog.


**探す…** beside the part list searches names and types by case-insensitive
substring. Select a result and press **選択へ** (or Enter from the search input)
to select and focus that part. The full selected result and parent/direction are
shown below the result list, including when a long option is clipped. Search
and cancellation preserve source and Undo/Redo history; each opening uses the
current model, including renamed parts. Invalid source disables the search.


When pasting a copied branch into another model, attribute expressions retain
references to the original variables and part names. The editor checks known
reads using its attribute evaluator and rejects missing variables, missing part
names, or a variable shadowing a required part name, listing the affected names.
Comments, name declarations and hexadecimal literals do not create dependencies.
Definitions and scripts are not imported. Same-name definitions may still mean
something different in another model; unknown identifiers already present in
the source remain unchanged. This check does not establish behavioral equivalence
or analyze arbitrary Lua/Script programs.


The N/W/E/S add buttons show how many direct children are already attached in
each direction, or 空き when none are attached. Counts follow selection, paste,
removal and Undo/Redo. Adding/pasting multiple children on one edge remains
supported; equal angles can overlap visually. These are connectivity counts,
not geometric collision detection. Move and mirror retain their separate
occupied-destination guards.

The N/W/E/S marks drawn around the selected part in the 3D view are also
clickable (or tappable) and act exactly like the matching panel button,
including paste mode and the disabled state for invalid source. They are hidden
while running. Keyboard users keep the panel buttons; the marks are pointer-only.


Opening another file, sample or in-page model link preserves the prior editor
state as one Undo step. Return to **組む** and undo to recover source, filename,
selection and source caret, including incomplete text. Earlier editing history
is retained; reloading identical source with the same filename adds no redundant
step. This history lives only in the current page and does not replace saving
files. Undo restores editor content; press Run to simulate that restored model.
