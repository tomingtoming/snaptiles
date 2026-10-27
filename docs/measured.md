# What was measured, what is still a guess (2026-10-27, evening)

The public docs (`docs/spec/`) leave out most sign conventions and constants. Since the evening of
2026-10-27 the original **RigidChips 1.5B26** (the author's final release, 2006-08-03) runs in a
quarantined WSL2 + wine 9 prefix, and the numbers below come from driving it with a scenario
harness (`Resources/System.rcs` replaced by a Lua script that sets wheel `POWER` through `_SET`,
dumps the rest pose of every chip and writes the per-frame core state with `_FOPEN/_FPUTS`).
`tools/orig-compare.ts` replays the same experiment headless in SnapTiles and prints the same
columns. Raw logs: `D:\snaptiles-models\quarantine\original\runs\*.csv` (not in this repo).

## Measured against the original exe

| item | value | evidence |
|---|---|---|
| chip spacing | **0.6 m** center to center (`TILE`) | rest dump of Basic.txt: Core→N chip Δz = −0.600 |
| folded child offset | 0.3 m beyond the hinge and 0.3 m down for a 90° fold | wheel hub at x = 0.91 vs frame 0.61, y −0.30 |
| chip thickness / ground contact | a flat chip rests with its center **0.015 m** above the ground (box contact, not a 0.3 m sphere) | core-only, core+chip, Cube rest heights |
| spawn | the model is dropped from about 1.0 m above the ground (lowest point) | core-only spawns at ground+1.03 |
| mass table | Core/Chip/Rudder 25.2, Frame 12.6, Wheel 79.17 (hub+tire) → Basic = 467.87 kg | HUD `Weight=467.87` for 16 chips, SnapTiles table gives 467.88 |
| chip numbering | a Wheel takes two numbers: first `_TYPE` 3 (hub, does not spin), second `_TYPE` 4 (spins) | rest dump |
| wheel radius | option 0 **0.30 m**, option 1 **0.45**, option 2 **0.60** | v / `_WY(wheel)` = 0.300 / 0.455 / 0.611 while rolling |
| wheel drive | force ∝ power, independent of radius: torque-equivalent **0.066–0.069 N·m per power unit** (Basic, 4 wheels: a₀ = 4.89 m/s² at power 2500, 0.90 at 500 → linear) | power sweep 500…2500 |
| drive fade | the push falls linearly with wheel spin: a/a₀ = 0.877 at ω≈22 rad/s, 0.62 at ω≈69 → zero at ≈ **180 rad/s** | 180-frame run to 22 m/s |
| drag | **none measurable** coasting at 22 m/s (Δv = 0.02 m/s over 1 s) | turn_basic frames 210–240 |
| wheel in the air | a powered wheel folded up into the air does **not** spin up (`_WY` stays 0) | wheel_up at power 2500 and 1000 |
| `_WY(wheel)` while rolling | = v / r exactly | all drives |
| fold sign | positive `angle` folds **down** on all four sides (`FOLD_SIGN` all +1) | fold30: all four 30° chips sit 0.15 m lower |
| `_EX` | +0.52 rad for a chip folded 30° down on the **N** side (−0.52 on S) | fold30 |
| `_EZ` | +0.52 for a chip folded 30° down on the **E** side (−0.53 on W); a Trim(30) on N reads +0.52 | fold30, trimrudder30 |
| `_EY` | +0.52 for a Rudder(30) on the S side, whose tile swings toward **W**; the nose turning toward W gives a falling `_EY` | trimrudder30, turn20 |
| `_AX/_AY/_AZ` | = (−`_EX`, `_EY`, −`_EZ`) | every log |
| `_VX/_VY/_VZ` | **model-local** velocity (world drift of a slightly yawed car shows in x only in dx/dt, not in `_VX`) | turn_basic |
| `_WX/_WY/_WZ` | model-local angular velocity; the yaw rate `_WY` has the sign of d`_EY`/dt. `_WX`/`_WZ` signs not yet measured | turn20 |
| axes | W is **+x**, N is −z, y up in the original (SnapTiles keeps W = −x, i.e. a mirrored x; the Euler readouts above are matched numerically, not by mirroring) | rest dumps |
| Trim / Rudder signs | consistent with `JOINT_SIGN` (+1 / −1) | trimrudder30 positions |
| arrow keys | 0 ↑ 1 ↓ 2 ← 3 → (then Z X C A S D V B F G Q W E) | bike (0 engine, 1 brake), tonbo, zrobo |
| script cadence | 30 frames/s, scripts see `_FPS()` 30 | HUD, docs |
| scenario file I/O | `_FOPEN/_FPUTS/_FCLOSE` work only within one call (open, write, close in the same `OnFrame`); handles kept across frames write nothing; `_SET(chip,"ANGLE",v)` is overridden by the model's `angle=Val` each frame, `_SET(...,"POWER",v)` is not | harness attempts |
| `_VEL` | not available in scenario scripts (nil) | harness error |
| triangle cowls | option 3 keeps the attached edge and the east edge, 4 the west edge | corpus census (unchanged) |
| Jet option 1/2 | balloon: buoyancy straight up | airship corpus (unchanged) |
| Lua dialect | 5.0 era (`math.mod`, `string.format('%d', 1.5)`, full-width spaces) | corpus scripts |

## Implemented from these (SnapTiles)

`TILE` 0.6, `TILE_T` 0.03, `WHEEL_RADIUS0` 0.3 with ×1.5 / ×2, `WHEEL_TORQUE_PER_POWER` 0.066,
`WHEEL_SPIN_FADE` 180, no linear/angular damping, rotor spin inertia 0.3 kg·m², `TUNE_DEFAULTS`
(ex −1, ey −1, ez −1, ax +1, ay −1, az +1, wy −1, local frame).

## Known gap: rapier caps angular velocity

Rapier limits a body's rotation to **π/4 per step**: at the 1/60 s step a rotor cannot exceed
47.1 rad/s, i.e. 14.1 m/s on a 0.3 m wheel (`tools/orig-compare.ts` shows `_WY` pinned at 47.1239).
The original reaches 74 rad/s in the same test and racers go far beyond. The original also shows
that its wheel is **not** a spinning rigid body (no spin-up in the air, no inertia in the
acceleration, `_WY` = v/r): the right model is a contact force at the tyre with a kinematic
spin readout. That rewrite (raycast / contact-force wheels, hub as the only rigid part) is the
next step; until then cars top out near 14 m/s.

## Still guesses

| item | current value | where |
|---|---|---|
| gravity | 9.8 | `world.ts` |
| tyre friction | 1.4 | `WHEEL_FRICTION` |
| plate aero | lift slope 3.8 per sin α, broadside cap 0.7 (per tile, not per area) | `world.ts` — measure with Data/plane.txt next |
| servo | hard limits slewed at 6°/step | `SOFT_SERVO` |
| spring<1 joints | motor 4000·spring, ±8° travel | `SPRING_*` |
| Arm shell | 80 m/s, 2 kg, 4 s | `ARM_*` |
| cowl option 5 / 1 / 2 | bulging ribbon / plate / plate | `scene.ts` |
| `_WX`, `_WZ` signs, `_T`, `_FUEL`, network, CCD | unverified / stubs | `simulation.ts` |

## Known failures

- Self-balancing models and some walkers tip over when driven (servo stiffness unknown).
- The plane sample no longer takes off with the 0.6 m tile (test skipped; aero unmeasured).
- `weapon/cannon.rcd` indexes an undefined Val (`math.mod(nil)`): the model itself.

## Root causes worth remembering

- A steady torque against hard joint limits pumps energy into the solver (car1 lift-off).
- `addForce/addTorque` accumulate across steps in rapier; reset every step.
- rapier's revolute axis has identical coordinates in both local frames: joint bodies are created
  with the parent's orientation and the collider is rotated instead.
- Rapier's angular velocity cap (π/4 per step) silently limits spinning-wheel vehicles.
- Readme of the original (`Doc/readme15B26.txt`, in the quarantine) lists physics changes per
  version: chip collisions as spheres r = 0.3 for **bullets**, Weight = 4× chip mass, air drag ∝
  projected area^1.3 with an angle term, fuel coefficients. Not yet cross-checked.
