# SnapTiles

A browser sandbox for building vehicles out of square tiles and driving them
with the keyboard or Lua. Runs on [Rapier](https://rapier.rs) (3D rigid bodies,
WebAssembly), [three.js](https://threejs.org) and [wasmoon](https://github.com/ceifa/wasmoon) (Lua 5.4).

It reads the `.rc` model format and the `_KEY()`/`_X()`/`out()` script API of
RigidChips, so models written for it can be pasted in and played. SnapTiles is
a clean-room reimplementation: it was written from the public documentation
and wikis only (see `docs/spec/`), without reading any RigidChips source code.
It shares no code with it and is not affiliated with its author.

## Run

```
bun install
bun run dev
```

Paste a model into the editor and press ▶ (or Ctrl+Enter). `R` resets the
model. Drag to orbit, wheel to zoom.

## Model file

```
Val  { STEER(default=0, min=-30, max=30, step=3) }
Key  { 0:STEER(step=-3)  2:STEER(step=3) }
Body { Core(){ N:Rudder(angle=STEER){ N:Chip(angle=90){ N:Wheel(power=500){ } } } } }
Lua  { function OnFrame() out(0, "x", _X(0)) end }
```

- `Val` declares variables (`default/min/max/step`; `step` is the per-frame
  return toward `default` when nothing touches the variable).
- `Key` adds `step` to a variable every frame a key is held. Key numbers:
  `0 ← 1 ↑ 2 → 3 ↓ 4 Z 5 X 6 C 7 A 8 S 9 D 10 V 11 B 12 F 13 G 14 Q 15 W 16 E`.
- `Body` is a tree of tiles. Each child is attached to a side of its parent
  (`N S E W`). `Chip`/`Frame`/`Weight`/`Jet`/`Arm` fold about the shared edge
  (`angle`), `Rudder` turns about the parent's normal, `Trim` rolls about the
  connection axis, `Wheel` is a disc in the tile plane driven by `power`,
  `Jet` pushes along its normal, `Cowl` is massless decoration.
- `Lua` (or the legacy one-statement-per-line `Script`) runs every frame:
  `OnInit`, `OnReset`, `OnFrame` (or `main`). Val variables are globals.

Details and what is still unverified against the original: `docs/spec/`.

## Tests

```
bun run test
node tools/shot.mjs http://127.0.0.1:5173/ .shots/x ArrowUp:2000   # screenshots via Playwright
```

## License

AGPL-3.0-or-later.
