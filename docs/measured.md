# What was measured, what is still a guess (2026-10-27)

The public docs (`docs/spec/`) leave out most sign conventions and constants. These were
determined empirically against community models (not included in this repo) and are the
source of truth for the implementation. Re-measure with `tools/` if something changes.

## Measured (evidence)

| convention | value | evidence |
|---|---|---|
| fold `angle` on Chip/Frame/Weight/Jet/Arm and the Wheel rim | positive folds the child **down**, all four directions | `tools/foldsign.ts`: 64 sign combinations scored by wheels at ground level over 16 vehicles; best 32/42, next 29 |
| Trim | `+1` (right-hand rotation about the connection axis) | same sweep |
| Rudder | `-1` (opposite of a right-hand rotation about the parent normal) | same sweep |
| triangle cowls | option 3 keeps the attached edge and the east edge, 4 the west edge | `tools/census.ts`: children attach E on 3 (143 vs 5), W on 4 (156 vs 8) |
| `_AX` | pitch with the sign of a left-handed rotation (negated vs three.js) | segway stands only with it negated (`tools/tune-probe.mjs`) |
| `_WX/_WY/_WZ` | world-frame angular velocity, sign flipped | drive-probe on segway/unicycle/drum/bike |
| arrow keys | 0 ↑ 1 ↓ 2 ← 3 → (then Z X C A S D V B F G Q W E) | bike (0 engine, 1 brake), tonbo (0/1 pitch), zrobo "Up/Down: Walk" |
| script cadence | 30 frames/s, two 1/60 s physics steps per frame | docs (`_BASE`), controllers tuned per frame |
| Wheel has an `angle` | the rim folds like a chip; the rotor spins about the rim normal | `E:Wheel(angle=WHEELANG_1)` in the 3-wheeler |
| Jet option 1/2 | balloon: buoyancy straight up regardless of tilt | the airship mounts them at -90/0/90 |
| Lua dialect | 5.0 era: `math.mod/pow/atan2`, `string.format('%d', 1.5)`, full-width spaces | corpus scripts |
| `out()` items | concatenated without separators; trailing `&` is a font flag | corpus `print 0,"FPS=",_FPS()` |

## Guesses (change freely, keep the tests green)

| item | current value | where |
|---|---|---|
| tile edge / thickness | 1 m / 0.1 m | `assemble.ts` |
| gravity | 9.8 | `world.ts` |
| wheel torque per power | 0.1 N·m | `WHEEL_TORQUE_PER_POWER` (0.25 launched corpus cars, 0.02 crawled) |
| rotor radius by option | 0.5 / 0.625 / 0.75 | `wheelRadius()` |
| tyre friction | 1.4 | `WHEEL_FRICTION` |
| plate aero | lift slope 3.8 N/(m/s)² per sin α, broadside cap 0.7 | chosen over `quad`/`newton` because tonbo only flies with it |
| isotropic drag | off | `ISO_DRAG` (it kept planes from taking off; hovercar hits 446 km/h without it) |
| servo | infinitely stiff hard limits slewed at 6°/step; finite-stiffness mode off | `SOFT_SERVO` (8000 let walkers stand but grounded the plane) |
| spring<1 joints | motor 4000·spring, ±8° travel | `SPRING_*` |
| Arm shell | 80 m/s, 2 kg, 4 s life, charge 2500 per 30 fps frame | `ARM_*` |
| cowl option 5 / 1 / 2 | bulging ribbon / plate / plate | `scene.ts` |
| `_T`, `_FUEL`, network, CCD | stubs | `simulation.ts` |

## Known failures

- Self-balancing models (segway when driven hard, unicycle) and some walkers (zrobo, 4leg) tip
  over: servo stiffness/damping of the original unknown.
- hovercar reaches 446 km/h: the original's air resistance model unknown.
- `weapon/cannon.rcd`: the model itself indexes an undefined Val (`math.mod(nil)`).

## Root causes worth remembering

- A steady torque applied to a small body held by hard joint limits pumps energy into the
  solver: car1 lifted straight off the ground until wheel reaction torque was sent to the
  rim's parent body instead of the rim.
- `addForce/addTorque` accumulate across steps in rapier; reset every step.
- rapier's `JointData.revolute` axis has identical coordinates in both bodies' local frames:
  joint bodies are created with their parent's orientation and the collider is rotated instead.
- Instant jumps of a leg joint (infinitely stiff servo) launch walkers; the slew limit helps,
  finite stiffness helps walkers but not planes.
