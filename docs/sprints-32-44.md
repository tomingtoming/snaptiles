---
origin: ai
created: 2026-10-29
---

# Sprints 32–44: spawn geometry, loaded folds, and the remaining walker failure

Measurements span 2026-10-28/29. Original: quarantined RigidChips 1.5B26 under
WSL/wine, observed through Lua only. Community models remain external and are not distributed.
This supersedes the final checkpoint in [sprints 22–31](sprints-22-31.md).

## S32–34 — Measure the loaded wheel fold

Two generated models carry a Weight(option=4) beyond a variable wheel; a core with
Weight(option=8) outriggers supports a vertical two-chip arm. The cantilever starts
at A=90 and commands A=60 at tick 120. Original absolute fold at frames 121, 122,
130 and 240: 60.302°, 59.007°, 60.023°, 60.062°. The original reaches the target
within one frame and holds it under load. Euler values near the initial 90° fold
flip sign at the singularity; they must not be interpreted as physical 180° flips.
`harness_rim.rcs` records the original; `rim-probe.ts` measures twist in joint space.
Local original log: `.shots/s32-original-cantilever.csv`.

**Retro:** use a joint-space angle when an Euler decomposition is singular. A static
loaded hinge alone does not reproduce the complex walker's 85° limit failure.

## S35 — Establish the spawn rule with independent shapes

Original first-frame `_H(core)` for core-only: 1.0137634277344 m. Differences:

| Shape | Difference, m |
|---|---:|
| Three flat chips | 1.7999992370605 |
| Three chips folded vertically | 1.5297012329101 |
| N/E/N diagonal chain | 1.3416404724121 |
| Five Cowl tiles | 3.0000000000000 |
| Three non-colliding Frame tiles | 1.7999916076660 |

These match maximum **3D tile-centre distance from the core**, including Cowl and
ghost Frame, within 1e-5 m. The old maximum z-distance rule was wrong. Production
source now uses this radius. The existing 1 m base is retained; relative probes
alone do not establish the absolute ground offset. Fixtures live in calibration.test.ts.
Original logs: `.shots/s35-spawn-*.csv`.

**Retro:** distinguish a measured difference from an absolute offset. The earlier
radial-spawn guess becomes acceptable only after independent non-flat measurements.

## S36 — Hold the variable wheel fold with a fixed frame

Replace equal revolute limits on variable wheel rims with a fixed joint whose
parent frame follows the requested fold. No motor stiffness/damping is fitted.
With the radius spawn rule and otherwise welded defaults, 4leg2 walks 2.31 m in
20 s, minimum upright dot 0.980, no fall. At frame 120 the measured fold error is
about 0.188° instead of 84.74°. Ordinary animated joints are unchanged.

**Retro:** separate angle retention from locomotion fidelity. The wheel fix removes
one failure but does not explain the original's much greater walking distance.

## S37 — Reject fixed constraints for ordinary animated joints

Applying fixed frames globally with articulated joints (64 iterations) launched
2walk to 15.67 m and overturned the walkers. Adding the existing momentum-free
pose update before fixed constraints still overturned 2walk and 4leg2. Removed.
Local experiment: `.shots/s37-constraint-experimental.patch`.

**Retro:** a successful constraint for one local mechanism cannot be generalized
without checking energy injection and the full vehicle set.

## S38–40 — Reject combined articulated and update-order changes

All runs use radius spawn and the fixed wheel fold. Input: Up from frame 120 to
720 (30 Hz; about 20 s of driving), bare ground. The shared articulated setting is
`allJoints=true, solverIterations=64, servoHold=0, servoGround=true`.

| Experiment | 2walk min up | 4leg2 min up | zrobo min up | 4leg1 min up | car1 min up |
|---|---:|---:|---:|---:|---:|
| S38: shared articulated setting | .940 | -.748 | .988 | .991 | .371 |
| S39: also teleport wheel folds | .940 | -.769 | .988 | .991 | .999 |
| S40: also position all joints before applying forces | .942 | -.992 | .988 | -.553 | .995 |

None passes. All three changes remain experimental and were removed from the
final source. Local patches: `.shots/s39-rimsnap-experimental.patch` and
`.shots/s40-phases-experimental.patch`.

**Retro:** preserve exact combinations. Improved car stability did not fix 4leg2;
separating calculation phases changed outcomes but did not demonstrate the cause.

## S41 — Verify the limited correction

Final runtime diff: measured orientation API signs, measured radius spawn, and the
fixed variable wheel fold. A generated loaded-fold regression requires the 30°
command to be within 2° from frame 121 through 240, consistent with the original's
transient. 39 tests pass; TypeScript/Vite build succeeds. Existing bundle-size and
wasmoon browser-externalization warnings remain.

Default configuration (bare ground, Up frame 120–720):

| Model | Net xz displacement, m | Minimum up | First up < .5 after frame 120 |
|---|---:|---:|---:|
| 2walk | 22.24 | -.719 | 120 |
| 4leg2 | 2.31 | .980 | none |
| zrobo | 12.09 | .960 | none |
| 4leg1 | 11.39 | .944 | none |
| car1 | 233.62 | 1.000 | none |
| bike | 690.26 | .939 | none |
| 3wheel | 385.80 | 1.000 | none |
| segway | 172.38 | .754 | none |

Distance is displacement, not path length or proof of correct walking. The fall
column deliberately covers the driving window; 120 can mean an earlier idle fall.

**Retro:** retain useful local corrections without relabelling overall failure as
success. Passing unit tests does not mean the original model is fully reproduced.

## S42 — Separate idle landing from walking in 2walk

Fresh original no-input measurement: height 4.079 m at frame 1, 2.087 at frame 20,
then about 2.1 through 240; upright dot rounds to 1.000 throughout sampled frames.
SnapTiles default: upright dot .265 at frame 60, -.078 at frame 120. With only
`servoHold=0`, it settles near 2.14 m and upright dot 1.000 at frames 90–240.
Under subsequent Up input, that setting keeps 2walk, 4leg2 and 4leg1 standing but
zrobo fails. The original idle log is `.shots/s42-original-2walk-idle.csv`.

**Retro:** the dominant 2walk failure precedes user input. Do not tune its walking
speed to compensate for a landing failure. Removing the ground-hold heuristic is
supported locally, but insufficient as a shared replacement.

## S43 — Check solver convergence, not another fitted constant

Increasing S38's iteration count from 64 to 256 worsens the result: 2walk peaks at
14.70 m, 4leg2 at 510.99 m, 4leg1 at 18.37 m; zrobo also falls. car1 exceeds
132 m/s. More accurate constraint solving is not sufficient and can amplify the
energy problem. No default changes.

**Retro:** an iteration count is not a physical calibration parameter. Divergence
with increasing solver work is evidence against treating this as insufficient precision.

## S44 — Test exact inertia separately from tyre formulas

Replace only servo split inertia with the parallel-axis theorem using world COM,
principal inertia and its world orientation; remove the ground hold. Welded model:
2walk 9.12 m / min up .935, 4leg2 3.54 / .993, 4leg1 9.33 / .981; zrobo still
falls (min up -.057). This does not resolve the shared gate. The experiment is
archived in `.shots/s44-inertia-experimental.patch` and removed from final source.
The tyre point-velocity formula was not changed.

**Retro:** a mathematically better local approximation need not repair the coupled
model. Keep the unresolved transient joint response separate from inertia and tyre claims.

## Follow-up sensitivity check of the existing ground hold

With the corrected spawn and wheel fold, check whether intermediate values of the
existing heuristic offer a shared stable range. This is an empirical sensitivity
check, not a claim that the original has such a parameter.

| servoHold | 2walk min up | 4leg2 min up | zrobo min up |
|---|---:|---:|---:|
| 1 | .976 | .995 | -.009 |
| 3 | -.520 | .994 | -.788 |
| 10 | -.635 | .996 | .970 |
| 30 | -.700 | .999 | .966 |

No tested value passes all three. This does not prove no intermediate value could
pass, but gives no justification for changing the default. The next step remains
a mechanism-level comparison rather than an increasingly fine parameter search.

## Remaining acceptance work

The overall task is **not complete**. 2walk fails in the default implementation;
4leg2 is stable but substantially slower than the original; the known wheel-rotor
child motion and transient passive-joint deformation are still not represented.
Do not deploy the articulated experiments or claim full compatibility. The next
mechanism-level comparison should isolate zrobo's idle landing and passive-joint
response against the original, before adding another global ground-hold formula.
