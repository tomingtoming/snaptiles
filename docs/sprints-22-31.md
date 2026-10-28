---
origin: ai
created: 2026-10-28
---

# Calibration sprints 22–31 (2026-10-28)

## Acceptance and outcome

Goal: promote the articulated joint model only when one configuration passes long car1 driving,
reference turns/landings, and zrobo/2walk/4leg1/4leg2/bike/segway/3wheel. **Not achieved.**
The welded production default stays unchanged. No deployment or push was performed.
Accepted change: `_QY/_QZ` mirror signs and `_RX/_RY/_RZ` signs, measured on the original executable.
33 tests pass, including a new independent first-frame original-measurement fixture.

The previous inference that "car1 needs tyre force rerouting" was not reproduced: on revision
30c7aa5, bare ground, Up frames 120–720, allJoints + solverIterations=64 + servoHold=0 +
servoGround=true, car1 stays upright (min up dot 1.000), max speed 30.83 m/s and net distance
53.25 m. It turns in a large curve; net distance is not path length. servoHold=1 also stays upright
(412.93 m net, 33.37 m/s). Do not treat the earlier 20 m/s rollover as a confirmed cause.

## S22 — Establish a reproducible long-run baseline

Added `tools/joint-score.ts`: bare ground, Up held from frame 120 through 720, reports core up dot,
first tilt below 0.5 after input starts, max height, speed, displacement, and script error.
car1 rollover did not reproduce; 4leg2 was already tilted by frame 120; 2walk walked 21.32 m.
**Retro:** record the exact tune JSON and input interval with a failure. A displaced vehicle may
have turned, so displacement alone cannot establish straight driving or stability.

## S23 — Verify the script's orientation inputs before changing the solver

On original 1.5B26, a generated model with 30° fold/yaw/roll plus a compound W-fold/N-yaw/E-roll
was logged on its first frame. Compared to internal Three.js quaternions, original QX/QW agree,
QY/QZ have opposite signs. Relative Euler RX/RY/RZ against the core are all negated.
Single-axis and compound values are recorded independently in `tests/calibration.test.ts`
(tolerance 1e-5, allowing the original's initial settling). This correction alone does not cure 4leg2.
**Retro:** pose readouts used by a model's feedback controller must be measured independently;
passing self-balancing examples that use other APIs does not validate these APIs.

## S24 — Wheel descendants and spawn clearance

The original axle probe (Core, two heavy outriggers, horizontal Wheel(power=100) with a child Weight)
shows rim and rotor have distinct orientations, and the child follows the rotor. Original frame 90:
rim QY=-0.01155; rotor/child QY≈0.07182. The current contact-force wheel cannot represent this.
4leg2 uses a named wheel as the head/leg assembly's axle and reads rotor-vs-rim relative angles.
A switchable separate rotor, reaction torque and distinct rim pose were tried; it did not pass 4leg2.

The existing z-reach-only spawn rule places 4leg2's feet **0.500 m below ground at frame zero**.
A radial-reach rule removed that initial penetration, but the original's precise height rule has not
been established across models. It changed 2walk's drop and did not cure 4leg2. Not adopted.
**Retro:** inspect frame zero geometry. A failure labelled "landing" can begin in penetration;
one horizontal family of probes is insufficient to infer a general 3D spawn rule.

## S25 — Separate control from constraint errors

Disabling head control, then all power, still allowed 4leg2 to fall. Freezing the entire script left
the static assembly upright (min up 0.902); moving the legs is involved. Original settled leg angles
match SnapTiles' commands (e.g. -135, -12.42336, -64.93722, 12.63942 degrees); this is not merely
an inverse-kinematics angle mismatch. Increasing solver iterations 64→256 did not resolve it.
Replacing passive zero-limit revolutes with fixed joints did not resolve it and made car1 excessively
fast (115.6 m/s peak). Rebuilding at settled leg commands did not resolve it. All rejected.
**Retro:** agreement of commanded angles does not imply agreement of transient constraint response.
Solver sweeps and alternate constraint formulations are diagnostics, not evidence of fidelity.

## S26 — Wheel fold servo

Variable wheel folds only update Rapier limits; ordinary animated joints also receive the instantaneous
inertia-split pose update. Extending that operation to wheel rims improved 4leg2's spawn phase, but
it tilted below up-dot 0.5 at frame 198 after walking began. With power/head control disabled it
still failed at frame 188. 2walk walked 21.77 m. Not adopted.
**Retro:** split initial settling and active walking in the score; fixing one does not pass the model.

## S27 — Command-only ground projection / existing welded structure

Applying whole-model ground projection only on changed servo commands also failed 4leg2 and reduced
2walk displacement to 6.85 m. Trying the axle/fold corrections with the welded structure also failed.
These alternatives were removed from runtime code. The complete experimental runtime diff remains
locally at `.shots/s22-s27-experimental.patch` (ignored, not a shipped implementation).
**Retro:** do not accumulate unvalidated switches into production or claim the structure is right
because one minimum probe agrees. No common configuration passed the acceptance set.

## S28 — Select independent fixes and catch a long-run regression

Rapier linear velocity is referenced to the centre of mass; two current velocity calculations use
body translation instead. Correcting both is mathematically justified but changed calibrated tyre
feedback: bike tilted at frame 327, whereas the pre-change 20-second run stayed upright.
Therefore this change was also removed; it needs tyre/control recalibration and a dedicated test set.
Orientation API correction alone preserves bike and car1 long-run results exactly.

| Bare-ground Up frames 120–720 | Before 30c7aa5 | API correction only |
|---|---:|---:|
| bike net displacement / max speed / minimum up | 690.09 m / 57.75 m/s / 0.939 | same |
| car1 net displacement / max speed / minimum up | 234.01 m / 43.17 m/s / 1.000 | same |
| 4leg2 | fails before input starts | still fails before input starts |

**Retro:** unit tests (34/34 with the COM test) missed the bike regression; the long corpus run
prevented adoption. A locally correct formula can invalidate tuning elsewhere. Keep measured API
corrections independent of physics experiments.

## Reproduce / next discriminating measurement

`bun tools/joint-score.ts '{"allJoints":true,"solverIterations":64,"servoHold":0,"servoGround":true}' <model paths...>`
Community models remain outside this repository at `D:/snaptiles-models/raw/`.
Original observations are local `.shots/s22-original-api.csv`, `s23-original-rotor.csv`,
`s23-original-4leg-api.csv`, `s24-original-4leg-settled.csv`. The test embeds the accepted original
orientation measurements, so its regression does not depend on those local files.

The next useful original measurement is a **loaded variable wheel rim with a child axle**, logging
rim/rotor/parent transforms and all anchor positions throughout a command and touchdown. The old
single-hinge probe does not exercise that mechanism. Separately measure core `_H` at spawn on
horizontal and tall models before choosing a new general spawn formula. Do not repeat the same
whole-4leg2 parameter sweep. Promotion remains blocked on reproduced mechanism-level agreement
and one common configuration passing the full acceptance set.

## S29 — Directly identify the wheel rim's failed hold

`tools/rim-probe.ts` reads the actual parent/rim body-relative hinge angle alongside the configured
limits. In the welded baseline on 4leg2, frame 120 has **1.479 rad (84.74°)** actual fold error,
while the limits are 0.000352 rad. This is a direct observation, stronger than inferring the issue
from the vehicle's roll. A rim-only AccelerationBased position motor (stiffness 1e6, damping 2000,
max force 1e12; experimental values, not original measurements) reduced that error to 0.01077 rad.
**Retro:** inspect the constrained degree of freedom, not only the vehicle outcome. A configured
limit is not proof that the solver is holding it.

## S30 — Local progress does not satisfy the common-config gate

With the rim motor and radial spawn, **welded** 4leg2 stayed upright for 20 seconds (2.41 m net,
minimum up 0.962). With no ground hold and the ground split, it still stood but barely travelled
(0.53 m); 2walk walked 27.69 m while zrobo failed. In the fully articulated model, adding fixed
passive joints or minimum-clearance spawn did not yield a common passing setting.
This revises the earlier blanket statement that all rim experiments failed: the rim motor fixes
one measured failure and makes 4leg2 stand, but its fidelity and combined behavior are unverified.
**Retro:** distinguish a local defect fixed, a model standing, and the shared acceptance gate passing.
Do not promote an architectural preference into a requirement if the welded model does better.

## S31 — Actual contact versus a nearby contact pair

`touchesGround` currently marks any ground contact pair as touching, even without a positive
contact impulse. Restricting it to contacts with positive impulse was tested with the rim motor.
Welded/radial spawn: 4leg2 2.11 m (minimum up .979), zrobo 12.41 m (.964), 4leg1 14.95 m (.998),
but 2walk tilted below .5 at frame 330. With minimum-clearance spawn and ground split, 2walk
travelled 35.78 m but tilted to .434; 4leg2 also failed. Original logs over frames 120–600 have
minimum up .98455 (2walk), .98691 (4leg2), .99256 (zrobo), so simply relaxing the tilt threshold
would not demonstrate fidelity. These combined changes remain rejected for default promotion.
The later runtime diff is retained locally in `.shots/s29-s31-experimental.patch`.
**Retro:** an improved distance is not sufficient; compare the stability measure with the original,
and use real contact evidence before attributing effects to ground friction.

## Checkpoint after S31 (superseded by sprints 32–44)

Only the independently measured orientation API correction remains in production source. The
joint structure, spawn rule, contact heuristic and tyre formulas are unchanged. Both experimental
patches are local/ignored, with no community models committed. The goal is still **unmet**: no
single configuration passed all representative vehicles, and no promotion/deployment is justified.
Next measure a loaded variable wheel fold with rotor descendants on the original, then design
its constraint response against that measurement. Avoid another whole-model sweep of constants.

The later spawn and wheel-fold measurements supersede this checkpoint: see [sprints 32–44](sprints-32-44.md).
