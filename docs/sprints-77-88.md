---
origin: ai
created: 2026-10-29
---

# Sprints 77–88: simultaneous fold balance and bounded input

This supersedes the open walking blocker in sprints-48-76.md. Local implementation,
unit tests and long representative runs pass. Deployment verification is recorded
at the end when performed. These are compatibility improvements, not a claim of
bit-identical original physics or support for every model.

## S77–78: compare the commands before tuning physics

Instrumented original 2walk and SnapTiles with the same scripted FB ramp. Scenario
logging is one model frame earlier than the after-step SnapTiles logger. With that
offset, commands differ by at most 1 degree during the ramp; rigid-invariant
pairwise distances are within a few centimetres for early gait frames. Original
core remains almost level before landing; sequential reaction rotations pitch
SnapTiles before contact. Per-tile inertia alone did not fix the landing failure.

**Retro:** input, shape and global pose require separate measurements. World Y
has a terrain-origin offset in the original; compare height or relative distances.

## S79–80: remove joint-order dependence

Apply every requested relative fold with the core frame held, then find the
proper rigid rotation and translation that best align the resulting mass
quadrature points with their pre-command positions. Each disconnected component
is balanced separately. Eight points per plate reproduce its mass and inertia.
Fixed joints retain the final target. Velocities are retained, and the contact
solver handles the subsequent impact.

This matches the near-level original airborne 2walk pose. The old full normal
penetration projection then causes landing failure; removing that projection
lets 2walk, 4leg1 and 4leg2 run for five minutes. zrobo still failed after starting
from rest. No special case based on model names was introduced.

**Retro:** a contact workaround can become the defect once the upstream pose
update is corrected. Re-test the combination, not each component in isolation.

## S81–84: zrobo's remaining failure is in input processing

Original zrobo knee commands respect their declared upper bound of zero. Removing
that bound does not fix the new implementation. Restarting joint constraints and
removing COM translation also fail. But zrobo driven by a scripted S_SP=10 is
stable, while holding Up fails.

Cause: key updates added 10 to the existing value of 10; the model script saw 20,
and only afterwards did the simulation clamp to max=10. Thus its phase advanced
20 degrees each frame instead of 10. Clamp immediately after applying each key
step, before running Lua or the legacy Script. Keep post-script range enforcement.
A regression asserts that Lua reads 10 on repeated held-key frames.

The first attempted original delayed-start fixture used _TICKS() in legacy
Script and did not activate; discard that result. The replacement declares a Val
counter, increments it in Script and starts at 120; logged knee movement verifies
activation. Original min-up over 240 frames is .996890. Logs and fixtures are in
ignored .shots/s81-* and s82-*; third-party model copies are not distributed.

**Retro:** a control-layer bug can survive many physics experiments. Match the
value seen by the script, not just the stored value after the frame.

## S85–86: retain tangential support without suppressing contact normals

The bundled walker stood but slipped. Carry loaded static-surface contact points
across the completed pose update, release points lifted from the surface, and
resolve only the weighted tangential displacement. Normal penetration and its
impulses remain with Rapier. The bundled sample now has weighted feet. Its existing
six-second northward-progress and upright assertions are unchanged and pass.

A quaternion eigensolve replaces identity-seeded power iteration, which can miss
an exact 180-degree fit. Unit tests cover arbitrary and 180-degree rigid motion;
a mirrored airborne fixture verifies zero spurious roll and preserved COM.

**Retro:** do not combine tangential grip and normal correction into one opaque
teleport. Preserve independent interventions for causal comparisons.

## S87: long runs and browser review

Bare ground, no course, Up held from frame 120, 30 script frames/s. 9,120 frames
means 300 seconds of held input. Final production candidate:

| Model | Minimum upright dot during input | First fall (< .5) | Path length (m) |
|---|---:|---|---:|
| 2walk | .962 | none | 579.26 |
| zrobo | .993 | none | 6.82 |
| 4leg1 | .987 | none | 452.47 |
| 4leg2 | .988 | none | 413.09 |

zrobo spends its script-defined energy and stops; this is not 300 seconds of
continuous gait. `joint-score.ts --frames=N` now reports both displacement and
path length. Original 2walk's 60-second displacement was 22.408 m but path length
170.155 m: a turning path must not be interpreted as slow walking.

car1, 3wheel and segway stay upright for 60 seconds. Bike stays upright for 30
seconds of input (1,327.6 m); a 60-second trial leaves the finite floor at x/z
approximately 2,000 m and falls outside it. This is a world-boundary limit, not
included in the in-bounds stability claim.

Browser: actual editor load, run button and ArrowUp for walker, 2walk and zrobo;
no page or script errors. Six idle/walking screenshots independently reviewed
under visual-verify: connected models, standing pose, visible pose changes and
input indication, no major layout defects. The reviewer noted possible small
z-fighting on 2walk and that no-input screenshots still show settling velocity;
neither screenshot is evidence of long-run stability. Evidence: .shots/s87-*.

**Retro:** long numeric runs catch delayed falls; actual UI use catches integration
failures. They answer different questions. Report floor limits and spent fuel.

## S88: release checks

44 tests pass; TypeScript and Vite production build pass. Wrangler is pinned to
4.104.0 (the already cached version) for reproducible packaging. No third-party
model data is included in the repository changes.

**Retro:** preserve the failed trials and their limitations, but ship the tested
mechanism and regressions. Original transient angular-velocity equivalence remains
unproven; the earlier blanket “no momentum” interpretation is superseded.


### Production verification

Deployed 2026-10-29 to the existing snaptiles Worker/custom domain.
Version: `56bfc376-5e9a-4341-bfa0-a80e45ccf9e0`.
Bundle: `/assets/index-DtXWpyea.js` (5,066,795 bytes).
SHA-256: `292a55f92355115f99b7d5cfff77f0a51546f8d2c136ffa94c83b423fa328785`.
Fresh remote HTML names this bundle, and downloaded bytes match the local build.
