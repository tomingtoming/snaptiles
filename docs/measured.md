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
| spawn | the core starts **1.0 m + the model's reach along z** (tile centres from the core) above the ground and the model falls from there: core only 1.03, core+one chip 1.63, chips three deep 2.83, four deep 3.43, the Basic car 2.37 (its wheels add ~0.13; option 2 wheels 2.64). Weights on the sides (x) add nothing | first-frame `_Y` of 14 runs vs their rest height |
| mass table | Core/Chip/Rudder 25.2, Frame 12.6, Wheel 79.17 (hub+tire) → Basic = 467.87 kg | HUD `Weight=467.87` for 16 chips, SnapTiles table gives 467.88 |
| chip numbering | a Wheel takes two numbers: first `_TYPE` 3 (hub, does not spin), second `_TYPE` 4 (spins) | rest dump |
| wheel radius | option 0 **0.30 m**, option 1 **0.45**, option 2 **0.60**; the wheel's mass does not change with option (4 wheels + core + 2 chips = 392.27 kg for option 0, 1 and 2) | v / `_WY(wheel)` = 0.300 / 0.455 / 0.611 while rolling; wheelmass_* HUD |
| wheel drive | force ∝ power, independent of radius: torque-equivalent **0.13 N·m per power unit** (Basic with all four wheels at power 2500: a₀ = 8.5 m/s²; linear in power from 500 to 2500) | power sweep 500…2500 (two front wheels), basic_nopower (four) |
| drive fade | the push falls linearly with wheel spin: a/a₀ = 0.877 at ω≈22 rad/s, 0.62 at ω≈69 → zero at ≈ **180 rad/s** at power 1000 and 2500. Above that the zero point grows with power: a **sliding** wheel settles at 135 rad/s (power 5000) and 376 (10000) against ~1030 N of ground force, which fits τ = 0.13·p·(1 − ω/ω0) with ω0 = p/20.6 (243, 486) | 180-frame run to 22 m/s; spin_p5000/p10000 |
| drag | **none measurable** coasting at 22 m/s (Δv = 0.02 m/s over 1 s) | turn_basic frames 210–240 |
| wheel spin | **powered wheels slide and spin up**: at power 5000 the powered wheels read `_WY` 90→135 rad/s within 3 s while rolling would be 10→70; at 10000 240→376; the unpowered wheels read v/r. With the fade above, a wheel inertia of ½mr² (3.6 kg·m²) and no extra drag reproduce 53→128 and 171→370 in SnapTiles (`WHEEL_SPIN_DYNAMICS`). At power 20000 the car wheelies and lands on its back with the wheels spinning past 1200 rad/s | spin_p2500…20000 (`harness_wheels.rcs`) |
| wheel in the air | a powered wheel **does** spin up in the air: during the spawn drop `_WY` reaches 65/111/184 rad/s by frame 10 at power 2500/5000/10000 (inertia ≈ 0.35 × ½mr²); the earlier wheel_up probe (folded 90° up, `_SET POWER`) read 0 and is superseded | spin_p2500/5000/10000 frames 1–16 |
| motor reaction | the motor torque reacts on the chassis: the falling car pitches nose-up **before touching down** (`_EX` 0.27 at power 2500, 0.71 at 10000 by frame 16), the leading end rising; RLW is the reactionless wheel. SnapTiles applies the motor (and brake) torque to the body about the wheel axis: 0.21 / 0.55 rad | spin_p2500/p10000 |
| landing | the spinning wheels shove the car off the touchdown (power 2500: 0.31→2.17→2.92 m/s over frames 20–30 while `_WY` drops 109→46→27; power 10000: 2.0 m/s at frame 30) — the wheel's stored momentum goes into the car. SnapTiles: wheel inertia 0.35 × ½mr² (air spin-up 70/126/251 rad/s at frame 10 vs 65/111/184), impact load for grip capped at 30× the static share, and a slip that closes within a step transfers the momentum that stopped the wheel; landings now 3.2/5.1/10.7/17.5 m/s at frames 30/45/90/150 for 2500 (original 2.9/5.2/11.1/17.9) and 2.9/5.6/11.1/18.7 for 10000 (2.0/4.5/10.8/19.3) | spin runs frames 10–150 |
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
| servo with a planted foot | a 277 kg body on two 1.2 m legs, the S hip stepped 90°→60° (foot would swing up/out): one frame later the leg has swung ~24° and the body side ~6° — the **pure inverse-inertia split, no hold for the grounded foot** — and the uncommanded N leg has swung ~20° outward with its foot lifted 0.27 m, returning within 10 frames; the stance ends 6 cm lower with both legs splayed. Stepped 60°→90° (foot driven into the ground): the body rises 0.17 m in a frame, the other foot lifts briefly, then settles 6 cm higher. So the original's joints are compliant in the transient (they flex and recover), which rapier's welded joints cannot reproduce; SnapTiles' grounded-side hold is not what the original does | leg_lift / leg_push / leg_swing (`harness_servo2.rcs`, chips 0–9 logged) |
| joint stiffness | rigid: a Frame(spring=0.5) holding a 4× Weight at 1.2 m does not sag; spring=0.1 sags 0.1° | sag_arm, sag_arm_spring05/01 |
| plate aero | drag per chip / v² from a jet-pushed **rolling** car (no sliding contact): **0.22 at 15°, 1.2 at 30°, 2.85 at 45°, ≈4 at 50°**, constant over 5–19 m/s (∝ v²). At 60–90° the original's car stalls near 1–3 m/s and oscillates (coefficient jumps 7 → 27 → 400 between 5 and 6 m/s: not a v² law, the readme's "steep rise toward 90°"). Normal force per chip ≈ v²·(6.7·sin^1.5 α + 9.3·sin^8 α) reproduces 0–45° within the mass offset; flat plates feel nothing to 40 m/s; a flat 3-plate sled lifts off at ≈40 m/s with 9–18° of pitch | rollb_* (0/15/30/45/50/60/75/90), sled_*, aero_* |
| drive limit | per wheel **1.1 × its dynamic (contact) load**: the Basic-layout car (468 kg, two powered wheels) saturates at 4.4 m/s² at power 5000 and 4.2 at 10000 (≈1030 N per wheel). Its powered axle is the S one and `+Engine` drives it toward S, so that axle **leads** and unloads to ~990 N under acceleration (rapier contact impulses) — 1030/990 ≈ 1.05. The 871 kg version (four Weights) is not saturated at 5000 (4.0 m/s², fade-limited); the corpus bike (RCModel1, power 5000 on a 0.45 m rear wheel) accelerates like the original (14.4 m/s at 3 s, 22.5 at 5 s) only with the load transfer, with a static share it saturates and falls. The earlier 4-wheel "1.1 g" was mostly drive fade | turn_a10_p5000/p10000, heavy4_a10_p5000, bike_e5000, basic_nopower_p5000 |
| lateral grip | per wheel **1.2 × its load** while rolling, shared with the drive in a friction circle (drive first); once the tyre **slides**, kinetic friction of μ·load opposes the contact patch's total slip (lengthwise spin slip plus sideways velocity), so a hard-spinning wheel keeps little lateral grip. Measured at steer 10°/20°: lateral acceleration 1.05–1.13 g with little drive (power 1000), 0.9–1.0 g at 2500, 0.4–0.7 g (10°) / 0.77–0.89 (20°) at 5000 with the powered axle sliding, 0.2 g at 10000; the 871 kg car 0.86–0.88 at 5000. SnapTiles: 1.01 / 0.93 / 0.58 / 0.73 / 0.16 / 0.88 g | turn_a10/a20_p1000…10000, heavy4_a10_p1000…5000 (`tools/orig-harness/turndiff.py`) |
| wheel load | the load each tyre carries is the contact normal force rapier measured in the last step (`measureTyreLoads()`, smoothed 0.3), falling back to the static lever rule about the centre of mass over the current hub positions before the first contact (the contact points of the previous step lag at speed and load the trailing axle too much) | turn runs, bike_e5000 |
| `_VX`/`_VZ` signs | `_VZ` is **positive toward +z (S)**, `_VX` positive toward **+x = W**: the original is left-handed (W = +x), so a car driving S with its nose yawing toward E and the velocity lagging outward reads `_VX` > 0, `_VZ` > 0. SnapTiles mirrors `_X/_GX/_VX/_VZ` (and the `_XX…_ZZ` axis vectors, unmeasured) so model Lua sees the original's numbers | turn_a10_p1000 (orig `vx` +0.6…+1.8 while sliding outward), basic_p1000 (`vz` > 0 while z grows) |
| brake | Coulomb: a 530 kg four-wheel car with `brake=10` sheds **2.2 m/s² (0.22 g)**, with `brake=50` **7.7 m/s² (0.78 g)**, at any speed — ≈0.022 g per brake unit, saturating near 0.8 g | brake3_10/50 (thrust kept on) |
| Lua globals | a Val is reachable from Lua only by its **upper-case** name (`Engine=0` in Lua did nothing; `A=60` worked) | brake3 runs |
| sliding friction | plates pushed along the ground by a stand-up jet (1452 N): **Chip ≈ 0** (7.8 m/s² for 7.7 available), **Frame ≈ 0.1** (9.2 for 10.6), **Weight does not move** (μ ≥ 0.3) — the readme's ordering Chip < Frame < Weight. The earlier 0.23 came from a sled whose hanging jet dragged on the ground | fric_chip/frame/weight |
| settling | the 3-wheeler rests with its core 0.65 m above ground; SnapTiles needed 16 rapier solver iterations (8 let the chain of six servo joints sag 0.4 m and the belly plate touched the ground) | wheel3 rest dump, lowest-corner.ts |
| key table | `_KEY(n)`: 0 ↑, 1 ↓, 2 ←, 3 →, 4 Z, 5 X, 6 C, 7 A, 8 S, 9 D, 10 V, 11 B, 12 F, 13 G, 14 Q, 15 W, 16 E; nothing else (digits, space, Enter, Shift/Ctrl/Alt, Tab, F2–F12, punctuation, keypad) maps to a number | keys.csv (xdotool pressed 81 keys one per 0.75 s, `harness_keys.rcs` logged `_KEY(0..39)`) |
| Arm direction | the shell leaves along the Arm's **own forward edge** (away from the chip it hangs on), not its normal: an Arm standing on an upright column recoils vertically; an Arm lying flat at the nose fires N along the ground | armcar2 (vertical kick), armline (hit on a chip placed on the forward line) |
| Arm shell | **300 m/s** per the bundled readme (15B13 "150 → 300 m/s"; not measured, the flight to a 3 m target takes under a frame); charge **5000 per frame** (power held ≥ option fires every 11 frames at option 50000, every 21 at 100000, the first shot one frame after power rises — the charge fills while power is 0); shot energy = `option`; recoil impulse **≈ 0.0043 N·s per unit of energy** (+0.42 m/s per shot on a 518 kg car at 50000, +1.7 at 200000) | armline_o50000/200000, armcar3_o50000/200000 |
| Arm damage | durability `_T` 10000 → 5000 on a 25.2 kg Chip at option 50000 (= 2.52 × energy / mass); a Frame (12.6 kg) is destroyed by one such shot, a Chip by one at 200000. A destroyed chip reads **−1, comes loose and flies off** with the shot (≈ 50 m/s along it). A Frame was missed by the first three shots (smaller hit sphere?) | armline_o50000 (+_Frame), armline2_o200000 (chip 9 position) |
| fuel | capacities per chip as the readme says: Core 2,000,000, Chip/Rudder/Trim 1,000,000, Frame types 500,000, Weight 6,000,000 (× option), Wheel/Jet/Arm 0 (`_FUELMAX` of a 4-wheel car = 6,000,000). With regulation **E off** (normal fuel) a wheel burns **0.025 × \|power\| per frame** at any speed or load (two wheels at 2500: 125/frame, also while airborne), a Jet **0.1 × \|power\|** (10000 → 1000/frame), an Arm its charge 1:1 (5000/frame while charging). Fuel is drawn from every chip in proportion to what it holds. With E on (the default) nothing is consumed | fuel_wheel / fuel_jet / fuel_arm (`harness_fuel.rcs`: `_SETREG("E",0)`) |
| H key ball | pressing H three times adds no ball with the stock input configuration (the readme requires a keyboard "reset" in Configure Input first); `_ADDBALL(r, x, y, z, density)` is a scenario function and SnapTiles has no scenario layer | ball1/ball3.png |
| Cowl shapes | option 0 plate, **1 outline** (edges only, open inside), **2 disc** inscribed in the tile, 3/4 right triangles (apex NE / NW), **5 tombstone** (attached half square, far half a semicircle, flat), 6/7 plates | cowl_0…7.png, cowl_montage.png |
| car1 / 3wheel at speed | on the original, Up held: the corpus car1 (670 kg, four 0.3 m wheels) accelerates at a constant 13.5 m/s² from 8 to 54.6 m/s and is then thrown 30 m into the air within 15 frames (something far down the original's world; the 3-wheeler likewise at 20 m/s after 20 s) — not aero lift. SnapTiles car1 reached 180 m/s by frame 300 because its two Trim plates (sinα 0.18) pressed it down with 8 kN at 90 m/s and the dynamic load bought grip; with the sustained grip load capped at 1.5× the static share it reaches 38 m/s (the original 54). Joint handedness (Trim roll, Rudder yaw, Chip fold) was re-measured with child chips and matches SnapTiles exactly | drive_car1, drive_3wheel, sign_trim/rudder/trimE/chip |
| small-angle plate aero | tail plates at 5/8/10/−10/15° on the rolling car: speed deficit after 10 s 0.14/0.38/0.66/0.51/1.57 m/s → drag/v² ≈ 0.020/0.053/0.092/0.071/0.22 per chip, within 20% of the sin^1.5 law (0.015/0.048/0.084) | rollb_5/8/10/m10 |
| rolling fade at high power | the sliding-wheel ω0 = power/20.6 is not applied to rolling wheels: a rolling wheel fades to zero push at 180 rad/s whatever the power (car1 on the original stops near 54 m/s = 180 rad/s on 0.3 m wheels); without this cap SnapTiles' car1 ran away to 400 m/s and fell through the ground | drive_car1, spin runs |
| axes | W is **+x**, N is −z, y up in the original (SnapTiles keeps W = −x internally and mirrors the x of `_X/_GX/_VX` and the axis vectors in the Lua API; the Euler and angular-velocity readouts are matched numerically, not by mirroring) | rest dumps, turn runs |
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
the wheel plane, finds the ground; the motor torque is power × 0.13 × (1 − spin/ω0) with ω0 = max(180,
power/20.6) rad/s. While the ground can take the motor's force the wheel rolls (spin = v/r); when the
motor asks for more than the grip the tyre slides at the grip limit and the spin integrates with the
wheel's own inertia until motor torque and ground reaction balance (`WHEEL_SPIN_DYNAMICS`, measured
spin equilibria 135/376 rad/s at power 5000/10000). The brake is a Coulomb torque, sideways slip is
damped (`TYRE_LATERAL_GAIN`) — all applied at the contact patch (a segway needs the pitch moment of
the ground force; forces on a folding rim go to the chassis the rim hangs from). The drive/brake force
is limited to 1.1 × the wheel's load and the lateral force to 1.2 × load, sharing a friction ellipse
with the drive taking priority (`TYRE_FRICTION_CIRCLE`, `TYRE_LATERAL_MU`, measured 2026-10-28 with the
steered car, see the table). The load is the normal force the tyre collider carried in the last step
(`measureTyreLoads()`), so acceleration, braking and cornering shift grip between the wheels as in the
original; before the first contact the static lever rule (`distributeLoads()`) fills in. Spin is integrated for the render and `_WY`. Result against the original
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
| plate aero at 60–90° | the original stalls and oscillates (drag far above v²·sin²); SnapTiles rolls on at 4–7 m/s | `AERO_K2/AERO_P2` |
| Arm shell life / range in air | 4 s placeholder (readme: 150 m under water); hit sphere of a Frame; damage on a Weight (the probe crashed the exe) | `ARM_SHELL_LIFE`, `ARM_HIT_RADIUS` |
| fade of a **rolling** wheel above power 3700 | the ω0 = power/20.6 zero point is fitted on sliding wheels; a rolling wheel at high power is assumed to follow the same torque law (the original's power-5000 car still accelerated at 4.1 m/s² at 29.6 m/s, consistent with it). Corpus car1 now reaches 230 km/h | `WHEEL_SPIN_PER_POWER` |
| sliding friction direction | the kinetic-friction-opposes-total-slip law reproduces the 7 reference turns within ~10%; a lateral floor or independent caps do not (tried 2026-10-28) | `TYRE_LATERAL_FLOOR` (0) |
| network, scenarios (`System.rcs`, `_ADDBALL`, rings, `_LOADLAND`) | stubs / absent | `simulation.ts` |
| `_ANALOG` range, `_HAT` | gamepad axes returned as ±1000, hat 0 (not measured) | `simulation.ts` |

## Known failures

- Corpus walkers (2026-10-28, Up held on the original from 4 s): the original walks all three — `zrobo` 2.4 m in 16 s, `2walk` 32 m (fast, curving), `4leg2` 23 m straight, all upright. SnapTiles: `zrobo` and `4leg1` walk with `SERVO_HOLD` 1000 (zrobo even faster than the original, 13 m); `2walk` flips at spawn with 1000 but stands and walks 18 m with hold 1 (or with the inertia split off); `4leg2` stands with 1000 or 30 and rolls over once it walks with any setting (hold 1: 3 m then ez 1.4). No single hold works for all three: the grounded-side hold is a heuristic for the original's momentum-free servo, not its model. Headless runs with `--key=0:120:540`. Prototype (2026-10-28 evening, knobs `allJoints`, `solverIterations`, `servoHold`, `jointStiff`): every hinge its own body on a hard-limited revolute joint. With 64 solver iterations and the pure inertia split (no hold) the leg probe's transient matches the original (N foot lifts 0.22 m vs 0.27, settles within 10 frames, body 1.16 vs 1.14), zrobo walks 6.5 m (the original 2.4, welded SnapTiles 13), 4leg1 and 4leg2 walk, 2walk walks when not dropped at spawn but is launched 13 m by its touchdown, and car1 rolls over at 50 m/s (its wheels hang on folded frames that now flex; routing the tyre forces to the root makes it worse, a stiff position motor on every joint does not help). 16 or 32 iterations let the 3-wheeler sag. A ground rule on the split (knob `servoGround`: a side the ground would block only turns as far as the ground allows, the rest of the step goes to the other side) lets 2walk survive its touchdown and walk 17 m with the joint model (zrobo 6.7, 4leg1 2.8); adding a lift of the model for a foot driven straight down (as the original's +0.17 m) makes everything bouncy and was dropped. Re-tested with the fade and load caps (`allJoints`+64 iterations+no hold+`servoGround`): zrobo 6.7 m, 2walk 17 m, 4leg1 2.8 m, bike/segway/3wheel fine, but 4leg2 falls at spawn and car1 rolls over at 20 m/s (its wheels on folded frames flex under the tyre forces applied to the small wheel body). Not adopted: the welded default keeps car1/bike/zrobo/4leg1; the joint model is the right structure but needs its own sprint (touchdown with a teleporting gait, tyre forces on small bodies). Tried and rejected (2026-10-28): replacing the hold by a rigid lift of the whole model out of the ground after each teleport (the ground as a pure position constraint) — it injects potential energy every frame and launches zrobo 11 m into the air; also pure inertia split without hold (2walk walks, zrobo and 4leg2 fall) and no split (2walk stands, the others fall).
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

## 2026-10-28 follow-up: orientation API and joint-model acceptance

`_QY/_QZ` and `_RX/_RY/_RZ` had wrong signs. A generated single-axis and compound-orientation
probe on original 1.5B26 establishes the corrected values; `tests/calibration.test.ts` stores them.
The articulated model is **not ready to become the default**. A 20-second bare-ground rerun did
not reproduce the previously recorded car1 rollover, so tyre-force rerouting remains an unconfirmed
hypothesis. 4leg2 still fails. It also exposes two unmodelled mechanisms: a wheel's physical rotor
carrying child chips, and a variable wheel fold that is handled differently from ordinary servos.
Its frame-zero feet penetrate the ground by 0.5 m under the current spawn rule. See
[sprints 22–31](sprints-22-31.md) for exact conditions, rejected experiments, and the next measurement.
The centre-of-mass velocity correction was rejected for now because it regressed long-run bike
stability; changing the formula requires recalibrating the coupled tyre/control behavior.

## 2026-10-29 follow-up: radius spawn and loaded wheel folds

Independent flat, vertical, diagonal, Cowl and ghost-Frame probes establish the
spawn-height increment as maximum 3D tile-centre distance from the core. The old
z-only rule is corrected. A loaded 90°→60° wheel-fold probe reaches its target in
one original frame. Variable wheel rims now use fixed frames instead of equal
revolute limits, eliminating the large loaded fold drift.

The default run keeps 4leg2 upright for 20 s (2.31 m net, min up .980), but it is
still too slow and 2walk still falls during idle landing. Removing ground hold
stabilizes 2walk but destabilizes zrobo; global fixed constraints, articulated
combinations, increased iterations and exact servo inertia did not pass the shared
acceptance set. Those experiments were removed. 39 regression tests and the build
pass. See [sprints 32–44](sprints-32-44.md) for measurements and retrospectives.

## 2026-10-29 causal investigation (sprints 45–47)

The conflicting walker fixes are now separated. In 2walk, the grounded-side inertia
term in the pose update introduces the tipping rotation; removing only that term at
frame 40 rescues the same landing history. In zrobo without this term, unchanged
joint commands lose static support during physics stepping. Disabling repeated
pose corrections does not prevent the fall, whereas replacing just the six leg
fold constraints does.

An 18-tile standing fixture reproduces the static defect: literal angles stand,
identical values bound to unchanged variables fall in SnapTiles with hold=0. Both
versions produce identical stable traces in the original. Production behavior is
unchanged by this investigation. See [sprints 45–47](sprints-45-47.md) for controls,
measurements, limitations and the required separation of static hold from active
commanded rotation.


## 2026-10-29: walking completion (S77–88)

Use `docs/sprints-77-88.md` for the current result, superseding earlier walker
blockers. Fixed frames retain static folds; simultaneous mass-pose balance avoids
joint-order reaction drift; tangential support is separate from solver contact
normals. Key steps are clamped before script evaluation (zrobo previously read
S_SP=20 despite max=10). Four community walkers pass 300 seconds of held input;
zrobo stops when its own energy expires. Original 2walk path length is 170.155 m
in 60 seconds despite net displacement of 22.408 m. Numeric stability is not
bit-identical trajectory or transient-velocity equivalence.

## 2026-10-30: camera (views A–J, keys, zoom)

Measured on 1.5B26 under wine with `tools/orig-harness/harness_camera.rcs` (scenario logs
`_GETVIEWTYPE`, `_GETVIEW` eye/target, `_GETVIEWZOOM` and the core every frame) and `rc_camera.sh`
(xdotool key presses, a screenshot every 3 s; the on-screen frame counter syncs presses to log frames).
Probe models from `rc_camera_models.sh`: the Basic-layout car circling at Engine 2500 / Handle 15, and
the same car parked. The Basic car drives toward **S**, so "behind travel" is in front of its N edge.
Raw logs/shots: `D:\snaptiles-models\quarantine\original\runs\camera\`. Views are the scenario API's
0–9 = A–J (bundled function list v1.2: `_SETVIEWTYPE`, `_GETVIEW`, `_SETVIEWZOOM`, `_SETVIEW`, `_SETVIEWUP`).

| item | original | evidence |
|---|---|---|
| keys | **F8–F12 = views A–E, Ctrl+F8–F12 = views F–J**. F2 opens the render-device dialog and F3 Configure Input (both pause the game); F4–F7 change no view; Escape quits the program | fkeys, ctrlf, plainf3, verify |
| default | view A, field of view 45° | every log, frame 1 |
| I / O | zoom: each press multiplies the field of view by 0.8 (I) or 1.25 (O); it stops at 9.44° and 87.89° (the next step, 7.55° or 109.9°, is refused). **One zoom for all views**: 28.8° set in A stayed through B, A and E | verify, zoomrange, zoomper |
| A | **leash chase that ignores the model's heading**: the eye keeps +1.85 m over the core and is pulled toward 7.86 m horizontal distance along its current bearing, closing ≈31% of the gap per frame. A turntable yawing 23° left the eye bearing at −113.5° (world) throughout; the eye swings behind only as the model travels. Straight runs: horizontal distance 8.01/8.75/9.20/9.57 m at 2.9/11.0/17.8/23.7 m/s = 7.86 + 0.073·v, which is that per-frame closing (lag v·dt·(1−k)/k with k = 0.31). Starts at world bearing −113.5° (eye toward −x, −z) from spawn. **Target is the model's centre, not the core**: a lone core, the car and the car with a 6 m boom all settle 8.0 m (3D) from the target, 7.75 m horizontally and +2.0 m up; the boom moved the target 1.24 m toward it | circle 1–119, spinA, straightA, size_core, size_big |
| B | spectator: starts at the current eye when selected, then stays put. It is re-placed every 150 frames (5 s), or sooner once the model is ~76 m away (max eye distance seen 75.9 m), to a point ~20–32 m **ahead along the model's 3D velocity** (sideways ≤ 3 m; climbs with a climbing model). Same at Engine 2500 and 6000 | circle 120–209, zoomper, straightB, fastB |
| C | body-fixed: local eye ≈ (−0.4, +0.8, +2.3), looking along local −z (≈ 8 m ahead of the eye) | circle 210–299 |
| D | body-fixed at core height: local eye ≈ (−0.16, 0.0, +7.4), looking back at the core (target ≈ (−0.3, −0.15, −1.2)) | circle 300–389 |
| E | top-down: eye 29.9 m straight above the target, which follows the core | circle 390–479 |
| F | identical to A for an intact model (turntable and straight logs match A to the printed digits; the 10 m seen in the circle run is A's speed lag at 31 m/s). Bundled readme: F and G focus detached chips | circle 480–569, spinF, straightF |
| G | identical to B for an intact model (logs match). The 93 m seen in the circle run was before a 150-frame re-placement | circle 570–659, straightG, fastG |
| H | fixed eye and fixed direction (target − eye constant). Readme: "VIEW H is the CCD camera" | circle 660–749 |
| I | onboard, body-fixed: local eye ≈ (−0.8, 0.0, +0.8), 1.1 m from the core, looking along local −z | circle 750–839 |
| J | automatic orbit around the model at ~90°/s, 3–6 m, height swinging −1.7…+3.2 m | circle 840–940 |
| `_ZOOM` | separate from the view zoom: the bundled readme calls it the CCD camera's field of view (the small monitor in the HUD; Ctrl+F10 view H uses it). Default 17.19 | readme 15B15, earlier `_ZOOM` readout |

| mouse | left/right drags (200 px sideways, 120 px down) and wheel up/down on the view moved nothing in view A | mouseA |

Not measured: F/G with detached chips, the CCD inset's own pose, what decides A's spawn bearing, whether
mouse input works in other views, and the vertical lag of A (height over bumps varied 1.2–3.4 m). SnapTiles currently uses its own camera (chase/orbit/top/onboard on
1–4 and a button, mouse drag/wheel/pinch); none of the above is implemented yet.

## 2026-10-31: kerb strike below the tyre radius

Probe: `tools/orig-harness/rc_step.sh` swaps `Resources/Land.x` for a generated land
(`make_step_land.py`: 4 m ground cells at y = 50, a box h m tall over x −10…10, z 6…36) and drives the
default Basic car with Val Engine 2500 (`basic_drive_2500.txt`) into it; `harness_step.rcs` logs core
and wheel heights. SnapTiles replays the same with `bun tools/step-compare.ts`; `stepdiff.py` compares.
Land notes: the 4th material row (Emissive) is the original's rolling/static/dynamic friction (readme
15B11): an Emissive of 0.2 held the car to 0.5 m/s. Tyre radius 0.30 m; impact at 6.6–6.9 m/s.

| step | original | SnapTiles |
|---|---|---|
| 0.10 m | climbs in 3 frames, speed −17% (6.93→5.78), pitch ≤ 0.12 rad, all wheels past the edge 0.7 s after impact | the leading wheels are thrown 2 m up, the car pitches to 1.54 rad (near vertical), stalls to 0.08 m/s; past the edge after 1.7 s |
| 0.20 m | speed −60%, pitch ≤ 0.40 rad, past after 0.8 s | stalls (−99%), pitch 0.92 rad, past after 4.7 s |
| 0.25 m | speed −79%, pitch ≤ 0.53 rad, past after 1.1 s | bounced back at −3 m/s and never climbs (15 s) |

The original's wheel rolls up a kerb lower than its radius with a moderate speed loss. SnapTiles' tyre (a
frictionless load sphere plus ray grip) takes the edge as a stiff collision: an upward/backward kick
instead of a climb. Raw logs: `D:\snaptiles-models\quarantine\original\runs\step\`.

Fixed the same day (`kerbSprings()` in `world.ts`, `TYRE_SOFT_KERB`): a tyre whose ground contact is an edge
(normal more than 30° from vertical), or that has sunk more than 3 cm climbing one, gets a spring-damper along
the edge normal instead of the rigid contact (a contact-pair hook switches that pair off; rapier only runs hooks
when an event queue is passed). Stiffness sags the wheel's static load 2 cm, damping 0.3 of critical, chosen by
sweeping against the three runs. The spring counts toward the tyre's load. Result (original → SnapTiles):

| step | speed loss | max pitch | all wheels past the edge |
|---|---|---|---|
| 0.10 m | 17% → 18% | 0.12 → 0.13 rad | 0.7 → 0.5 s |
| 0.20 m | 60% → 56% | 0.40 → 0.34 rad | 0.8 → 0.7 s |
| 0.25 m | 79% → 84% | 0.53 → 0.49 rad | 1.1 → 1.0 s |

Flat ground never triggers it: eight steady-turn references and three straight runs replay byte-identical
with the kerb spring on and off. `tests/kerb.test.ts` keeps the three runs within 15 points of the original's
speed loss. Two dead ends worth remembering: forces added inside a rapier query callback are silently lost
(apply them after the query), and finer substeps alone fixed only the 0.10 m kerb.
