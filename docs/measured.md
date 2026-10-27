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
| wheel radius | option 0 **0.30 m**, option 1 **0.45**, option 2 **0.60**; the wheel's mass does not change with option (4 wheels + core + 2 chips = 392.27 kg for option 0, 1 and 2) | v / `_WY(wheel)` = 0.300 / 0.455 / 0.611 while rolling; wheelmass_* HUD |
| wheel drive | force ∝ power, independent of radius: torque-equivalent **0.13 N·m per power unit** (Basic with all four wheels at power 2500: a₀ = 8.5 m/s²; linear in power from 500 to 2500) | power sweep 500…2500 (two front wheels), basic_nopower (four) |
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
| `_WX/_WY/_WZ` | model-local angular velocity; the yaw rate `_WY` has the sign of d`_EY`/dt. `_WX` = +ω_x and `_WZ` = −ω_z (three.js local frame): the corpus segway (`E = −(_AX + _WX·4 …)`) balances only with `_WX` +, the jet-balanced bike2 (`_AZ·8 − _WZ/30·6`) only with `_WZ` − | turn20, segway, bike2 |
| Jet | thrust **0.145 N per power unit along +normal** (≈ power/6.9): a 530 kg wheeled car with a stand-up jet at power 10000 accelerates at a constant 2.74 m/s² over 6 s, at 5000 at 1.38 m/s², same for wheel option 0 and 2. (The 3-wheeler's script assumes power/6 to hover; the plane sample's ground run was too noisy to pin it) | rolle_* runs, plane_full |
| attribute evaluation | a literal `power=5000` on a Jet produced no thrust; `power=Engine` with a Val default did. Attributes bound to a Val are re-evaluated every frame (so `_SET` on them is lost) | jetc_* vs jet_*_val runs |
| servo | a commanded joint angle is applied **within one frame** (Rudder: 60° one frame after the Val changes), **without momentum**: snapping a Frame holding two Weights 45° pitches the light core 31° and the arm −14° (inertia-weighted split about the hinge), the load then swings from rest and the model settles with the core at 45° | servo_rudder, servo_hinge_load |
| joint stiffness | rigid: a Frame(spring=0.5) holding a 4× Weight at 1.2 m does not sag; spring=0.1 sags 0.1° | sag_arm, sag_arm_spring05/01 |
| plate aero | drag per chip / v² from a jet-pushed **rolling** car (no sliding contact): **0.22 at 15°, 1.2 at 30°, 2.85 at 45°, ≈4 at 50°**, constant over 5–19 m/s (∝ v²). At 60–90° the original's car stalls near 1–3 m/s and oscillates (coefficient jumps 7 → 27 → 400 between 5 and 6 m/s: not a v² law, the readme's "steep rise toward 90°"). Normal force per chip ≈ v²·(6.7·sin^1.5 α + 9.3·sin^8 α) reproduces 0–45° within the mass offset; flat plates feel nothing to 40 m/s; a flat 3-plate sled lifts off at ≈40 m/s with 9–18° of pitch | rollb_* (0/15/30/45/50/60/75/90), sled_*, aero_* |
| brake | Coulomb: a 530 kg four-wheel car with `brake=10` sheds **2.2 m/s² (0.22 g)**, with `brake=50` **7.7 m/s² (0.78 g)**, at any speed — ≈0.022 g per brake unit, saturating near 0.8 g | brake3_10/50 (thrust kept on) |
| Lua globals | a Val is reachable from Lua only by its **upper-case** name (`Engine=0` in Lua did nothing; `A=60` worked) | brake3 runs |
| sliding friction | plates pushed along the ground by a stand-up jet (1452 N): **Chip ≈ 0** (7.8 m/s² for 7.7 available), **Frame ≈ 0.1** (9.2 for 10.6), **Weight does not move** (μ ≥ 0.3) — the readme's ordering Chip < Frame < Weight. The earlier 0.23 came from a sled whose hanging jet dragged on the ground | fric_chip/frame/weight |
| settling | the 3-wheeler rests with its core 0.65 m above ground; SnapTiles needed 16 rapier solver iterations (8 let the chain of six servo joints sag 0.4 m and the belly plate touched the ground) | wheel3 rest dump, lowest-corner.ts |
| axes | W is **+x**, N is −z, y up in the original (SnapTiles keeps W = −x, i.e. a mirrored x; the Euler readouts above are matched numerically, not by mirroring) | rest dumps |
| Trim / Rudder signs | consistent with `JOINT_SIGN` (+1 / −1) | trimrudder30 positions |
| arrow keys | 0 ↑ 1 ↓ 2 ← 3 → (then Z X C A S D V B F G Q W E) | bike (0 engine, 1 brake), tonbo, zrobo |
| script cadence | 30 frames/s, scripts see `_FPS()` 30 | HUD, docs |
| scenario file I/O | `_FOPEN/_FPUTS/_FCLOSE` work only within one call (open, write, close in the same `OnFrame`); handles kept across frames write nothing. **`_SET(chip, attr, v)` is overridden every frame when the model binds that attribute to a Val** (`power=Engine`, `angle=Handle`): the first drive runs only moved the two front wheels of Basic (constant attributes). Probe models must use constant attributes or Val defaults | harness attempts |
| `_VEL` | not available in scenario scripts (nil) | harness error |
| triangle cowls | option 3 keeps the attached edge and the east edge, 4 the west edge | corpus census (unchanged) |
| Jet option 1/2 | balloon: buoyancy straight up | airship corpus (unchanged) |
| Lua dialect | 5.0 era (`math.mod`, `string.format('%d', 1.5)`, full-width spaces) | corpus scripts |

## Implemented from these (SnapTiles)

`TILE` 0.6, `TILE_T` 0.03, `WHEEL_RADIUS0` 0.3 with ×1.5 / ×2, `WHEEL_TORQUE_PER_POWER` 0.13,
`WHEEL_SPIN_FADE` 180, no linear/angular damping, contact-force tyres, `TUNE_DEFAULTS`
(ex −1, ey −1, ez −1, ax +1, ay −1, az +1, wx +1, wy −1, wz −1, local frame), `SOLVER_ITERATIONS` 16.

## Wheel model (implemented 2026-10-27 night, `driveWheel()` in `world.ts`)

The tyre is a frictionless sphere that only carries load. Each step a ray from the hub, down within
the wheel plane, finds the ground; the push is power × 0.13 / r along the rolling direction (fading
to zero at a kinematic spin v/r of 180 rad/s), the brake damps the rolling speed, sideways slip is
damped (`TYRE_LATERAL_GAIN`) — all applied at the contact patch (a segway needs the pitch moment of
the ground force; forces on a folding rim go to the chassis the rim hangs from) and limited by
μ × (weight / wheels). Spin is integrated for the render and `_WY`. Result against the original
(Basic car, all four wheels at power 2500 until frame 150, bare ground):

| frame | original v (m/s) | SnapTiles v | original z | SnapTiles z |
|---|---|---|---|---|
| 59 | 7.89 | 8.14 | 3.6 | 4.1 |
| 119 | 21.57 | 21.47 | 33.6 | 34.7 |
| 149 | 27.13 | 26.61 | 57.9 | 58.9 |
| 199 (coasting) | 27.22 | 26.84 | 103.4 | 103.6 |

Community models after the rewrite (bare ground, ↑ held 4 s): bike 62 km/h, bike2 (jet-balanced)
80 km/h, segway balances at 49 km/h, car1 93 km/h, the 3-wheeler 34 km/h; corpus 94/95 load.
The walker sample's crawl gait slips with the stiffer solver (test threshold relaxed to 0.2 m).

With the Rudder fixed at 20° and power 1000 both cars drive a circle of radius ≈ 5 m toward the E
side, one lap in ≈ 150 frames, `_EY` falling. A frictionless *cylinder* tyre instead of the sphere
made the chassis wander and roll over (edge contacts) — keep the sphere.

## Servo model (implemented 2026-10-28 early, `servoTeleport()` in `world.ts`)

Rapier joint limits catch up with a moved target at only ~6°/frame (any solver setting), velocity
motors inject momentum and break the limits under load. The servo therefore **rotates both sides of
the hinge rigidly** by the remaining angle each step, split inversely to each side's moment of
inertia about the hinge, keeping velocities; limits then hold the angle. A grounded body that the
rotation would drag along the ground or push into it counts as very heavy (`SERVO_HOLD`), so a
planted foot stays and the body moves — that is what makes walkers walk (the corpus `zrobo` stands
and walks for the first time; `4leg1`/`2walk` still fall). The loaded-hinge probe matches the
original frame by frame (31.4°/−13.6° at frame 35, 45°/0° at 60, 15.5°/15.4° at 121, 0 at 140).
Spring joints (`spring<1`) are welded (measured rigid).

## Rapier caps angular velocity (why the tyre is not a spinning body)

Rapier limits a body's rotation to **π/4 per step**: at the 1/60 s step a rotor cannot exceed
47.1 rad/s, i.e. 14.1 m/s on a 0.3 m wheel (`tools/orig-compare.ts` shows `_WY` pinned at 47.1239).
The original reaches 74 rad/s in the same test and racers go far beyond. The original also shows
that its wheel is **not** a spinning rigid body (no spin-up in the air, no inertia in the
acceleration, `_WY` = v/r). Hence the contact-force wheel above.

## Still guesses

| item | current value | where |
|---|---|---|
| gravity | 9.8 | `world.ts` |
| tyre friction | 1.4 | `WHEEL_FRICTION` |
| plate aero at 60–90° | the original stalls and oscillates (drag far above v²·sin²); SnapTiles rolls on at 4–7 m/s | `AERO_K2/AERO_P2` |
| Arm shell | 80 m/s, 2 kg, 4 s | `ARM_*` |
| brake cap 0.8 g vs tyre μ 1.4 for drive/lateral | the drive and lateral limits are not yet measured | `WHEEL_FRICTION`, `BRAKE_G_MAX` |
| cowl option 5 / 1 / 2 | bulging ribbon / plate / plate | `scene.ts` |
| `_T`, `_FUEL`, network, CCD | stubs | `simulation.ts` |

## Known failures

- Corpus walkers: `zrobo`, `4leg1` and the walker sample walk with `SERVO_HOLD` 1000; `2walk` and `4leg2` tip over. With a weak hold (3) `2walk` walks fast and `zrobo` falls instead — the grounded-foot heuristic is only a proxy for the original's constraint solver, and no single setting carries every gait.
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
