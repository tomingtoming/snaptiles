---
origin: ai
created: 2026-10-29
---

# Sprints 48–76: static retention fixed; dynamic walking remains open

Status: **candidate only, not production-ready or deployed**. Based on ffb3239.
The user requested continued implementation sprints with retrospectives. Static
retention and short walking improve, but 2walk still falls in the long run.
No source or disassembly of the original executable was inspected.

## S48–52 — Separate commanded pose from static retention

Animated folds use fixed-joint frames. Change the pose only when its command
changes; remove the old ground-hold multiplier (1000 -> 0). Apply every fold first,
then resolve penetration of the completed shape against static environment
colliders once. Isolate disconnected components. A generated free-air single
hinge has almost no added velocity under this implementation; this is a check of
our constraint consistency, **not evidence that the original has no transient**.

S48 alone failed moving walkers. S49 checked free air. S50 final-pose floor
projection passed four walkers for 20 seconds. S51 generalized floor projection
to static collider shapes. S52 found the bundled walker no longer progressed.

**Retro:** holding a static pose and moving a loaded pose are separate operations.
Correcting each intermediate joint pose against the floor injects repeated lifts.
The completed shape is the appropriate contact checkpoint.

## S53–59 — Feet and contact anchoring

The bundled sample's old knee command lowered its swinging foot. Reverse that
motion, and correct the stride sign; retain the original forward-progress test.
S53/S57 alternate IK sample prototypes were not adopted. S54 full tangential
anchoring before normal correction and S55 friction-capped anchoring both broke
2walk. S56 measured the original leg-lift transient. S58 projected penetration
first, released lifted contact points, then matched tangential displacement of
remaining loaded points. S59 corrected sample direction: 39 tests and build pass.

**Retro:** decide whether a foot is still planted after normal correction, not
from an intermediate pose. Do not lower the sample's existing acceptance test.

## S60–67 — Long duration invalidates short-run completion

S60 extended Up-held trials from 720 to 1920 frames (input starts at 120).
Default candidate: 2walk falls at frame 834, while zrobo/4leg1/4leg2 remain upright.
S61 preserving total COM launched 2walk; S62 exact inertia tensor did not cure it.
S63 recorded a new original free-air command; core angular velocity reaches
-14.614 at frame 6 then decays. This contradicts a blanket claim that the original
has no angular transient; it does not distinguish actuator momentum from passive
joint relaxation. S64 fixed-frame commands without pose updates destabilized all
walkers. S65 displacement-derived velocities added persistent spin and did not
reproduce gravity correctly. S66 moving only the immediate joint pair did not
match the original transient. S67 distributing commands over the two existing
physics steps still failed 2walk (frame 883).

**Retro:** original transient measurements outrank the earlier simplified verbal
model. None of these unsuccessful experiments should become default behavior.
The COM, inertia, local-pair, interpolation and velocity experiments were removed
from production code; diagnostic files remain ignored under .shots/.

## S68–69 — Original long run and numerical convergence

Own instrumented copy of 2walk sets FB = min(1,max(0,(_TICKS()-119)*.01)) in main.
Original runs in WSL/wine, using the safe backup/restore runner with timeout
extended to 75 seconds. Fresh output: .shots/s68-original-long.csv (1920 frames).
From frame 120: min up **.968214**, net horizontal distance **22.408 m**, no fall.
This establishes that long-duration stability is a real compatibility gap.
The scripted FB ramp approximates the key-table input and should not be treated
as proof of bit-identical input ordering across engines.

With pose interpolation, 8 and 16 substeps held 2walk for 1920 frames (minimum up
.930/.958), but 4 substeps launched it. Eight substeps fell at frame **2316** in a
9120-frame run. Correcting force calculations to use the actual step duration did
not yield a stable four-walker set. These settings were not adopted.

**Retro:** isolated success at one step count is not convergence. A five-minute
trial rejected the apparently successful one-minute setting.

## S70–76 — Direct interventions and regression protection

- S70 transport existing angular velocity across pose changes: failed 2walk.
- S71 normalize hinge correction to the shortest equivalent angle: sound angular
  boundary handling, but no change to 2walk's frame-834 failure.
- S72 alternate joint traversal in eight pose passes, same physics step count:
  delayed failure to frame 1196; not adopted.
- S73 phase trace: frames 800–834 servo operations lose .48557 upright dot while
  solver steps recover .09949; translation-only contact correction changes no
  orientation directly. This localizes the accumulating tilt, but not its final
  physical cause. Early spawn tumbling recovers by frame 120; report intervals.
- S74 fit final planted contacts with a rigid rotation: 2walk fails; not adopted.
- S75 split all passive chips and hold them with fixed joints: 2walk fails by
  input start, 4leg2 at frame 262. Welding alone does not explain the failure.
- S76 disabling servo reaction also fails. Add the original-measured 18-tile
  static standing fixture as a regression: min up > .97 for 240 frames.
  **40/40 tests pass; TypeScript + production build pass.**

**Retro:** retire unsuccessful knobs rather than accumulating an unreviewable
parameter surface. Tests prove static retention and existing sample behavior;
they do not prove long community-walker compatibility.

## Remaining acceptance gap

Default candidate still fails the original-stable 2walk long trial. Three other
walkers stand for 60 seconds. A fresh visual check and production rollout have
not happened. Do not deploy this candidate as a completed compatibility fix.
Next causal work should compare original and candidate per-chip poses/contact
phases around a gait cycle, controlling initial settled state. Avoid another
unstructured sweep of holding coefficients or global stabilization heuristics.
