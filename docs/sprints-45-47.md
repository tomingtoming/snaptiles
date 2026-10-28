---
origin: ai
created: 2026-10-29
---

# Sprints 45–47: identify the walker failure mechanisms

Scope requested: three sprints for causal identification, not another tuning sweep
or a production physics rewrite. Base: local commit 82378a3. Production source is
unchanged throughout these three sprints. Original executable measurements use
quarantined RigidChips 1.5B26 under WSL/wine; no original source was inspected.

## S45 — Find which stage introduces the tilt

Wrap `servoTeleport` and the subsequent Rapier step, recording core upright dot,
whole-model COM height and commanded-angle changes before/after each operation.
`tools/servo-cause-probe.ts` records JSONL and separates intermediate states from
end-of-frame outcomes. Runs have no key input, flat ground and 240 frames at 30 Hz.

- **2walk, default hold=1000:** first up < .95 occurs inside a servo rotation at
  frame 46, chip 5. At frame 54 the servo operations sum to **-.2601** upright dot,
  while the physics steps recover **+.0345**. The first end-of-frame up < .5 is 55.
- **zrobo, hold=0:** all **2,780** nontrivial servo corrections over 240 frames have
  **zero commanded-angle change**. The machine is not walking. At frame 28 the
  servo operations recover +.0073 upright dot while the physics steps lose -.0168.
  It crosses .5 at the end of frame 52.
- Fresh original zrobo idle measurement remains upright (frame 240 up .999841).

This distinguishes an active pose-update failure from a static load-holding
failure. Neither depends on the user's Up input. Local traces:
`.shots/s45-{2walk,zrobo}-hold{0,1000}.jsonl`; original idle log:
`.shots/s45-original-zrobo-idle.csv`.

**Retro:** instrument state transitions, not only end-of-run distance. The same
visible symptom came from different stages, so one shared hold coefficient was
not a useful root-cause model.

## S46 — Intervene after reproducing the same history

| Intervention | Result over 240 idle frames |
|---|---|
| 2walk: keep default until frame 40, then remove only ground hold | no fall; min end-frame up .983221, final .999944 |
| 2walk: skip servo corrections when the command is unchanged | still falls, frame 57; repeated corrections alone do not explain it |
| zrobo hold=0: skip all unchanged-command corrections | still falls, frame 48; manual correction is not necessary for its failure |
| zrobo hold=0: restore hold=1000 at frame 20 | stays upright, final .999964 |
| zrobo: weld the initial rest pose | stays upright, final ~1; initial tile positions differ by at most 1.19e-7 m |
| zrobo: retain bodies, mass distribution, contacts and geometry, replacing zero-angle revolute limits with fixed joints | stays upright, final .999998 |

The fixed-rest intervention is diagnostic only: it does not process changing
angle commands and is **not** a proposed moving-joint implementation. Keeping the
bodies separate controls for welding's changes to body count and mass aggregation.

Evidence supports these causal statements:

1. The existing ground-hold term causes the observed 2walk idle gait failure;
   removing it *after the same landing history* prevents that failure.
2. zrobo's hold-free static failure depends on the joint constraints, not just
   initial geometry, COM placement, gait commands or repeated servo corrections.
3. The large ground-hold term masks that static constraint problem in zrobo.

**Retro:** use an intervention at a known frame rather than changing the entire
run from spawn. Also distinguish removing a symptom-producing operation from
replacing the constraint that makes compensation necessary.

## S47 — Reproduce outside the full community model and compare the original

An **18-tile generated standing rig** has two legs, three top ballast Weights,
and fixed commands A=0, B=85. Its variable and literal versions have identical
geometry and commands and no script or keys. The first unballasted and symmetrically
ballasted rigs stayed upright; adding rear ballast to load the standing joint chain
reproduced the failure. No motor/solver coefficients were fitted.

Fixtures:

- `tools/orig-harness/standing-angle-variable.rcd`
- `tools/orig-harness/standing-angle-literal.rcd`
- `tools/orig-harness/harness_idle.rcs`
- `tools/orig-harness/standing-angle-original.csv`

| Engine / fixture | Minimum end-frame up | Final up | First end-frame fall (< .5) |
|---|---:|---:|---:|
| Original, variable | .999530 | approximately 1 | none |
| Original, literal | .999530 | approximately 1 | none |
| SnapTiles, variable, hold=0 | .113097 | .113112 | 62 |
| SnapTiles, literal, hold=0 | .999934 | ~1 | none |
| SnapTiles, variable, fixed-rest diagnostic | .990091 | .999998 | none |

Original variable/literal CSVs are **byte-identical** across all 240 frames, so
one shared CSV is stored. Both were fresh executable runs; `run_probe.sh` checks
the output modification time against its per-run marker and restores Basic/System.
SHA-256 of each original CSV:
`be570dcc43275cc4af3a0894694b499cfc8852844238e1b791c2aacd95afe881`.

At the first appreciable tilt in the variable SnapTiles rig, a loaded knee has
about **3.74°** holding error despite a zero-angle command. In zrobo, selectively
fixing just hips, knees or ankles moves the error to another member of the chain
and does not prevent falling. Fixing the **six leg fold joints** (15,16,17 and
47,48,49) is sufficient: minimum up .975729, final .999997, no ground-hold term.
This localizes the static failure to the loaded leg constraint chain rather than
requiring a change to arms, tyres, scripts or all model bodies.

**Retro:** variable binding must not change static mechanics. The reduced fixture
makes that invariant testable without depending on the community model or a tuned
gait. A single offending joint index was not the cause: the error moved along the
chain when only one pair was strengthened.

## Conclusion and implementation boundary

**The requested causal investigation is complete within this scope.** Two coupled
mechanisms are identified:

- Equal lower/upper revolute limits do not retain the commanded rest angles
  sufficiently under these standing loads. Literal angles are welded, so replacing
  a literal with an unchanged variable can change a stable rig into a falling one.
- The extra grounded-side inertia in `servoTeleport` compensates for that weakness
  in zrobo, but reallocates moving-joint rotations into the rest of 2walk and tips it.

This does **not** establish a defect inside Rapier, a general impossibility of
revolute limits, or full fidelity of a proposed replacement. The observed failure
is in this model/solver/pose-update combination. It also does not explain 4leg2's
remaining speed difference.

Next implementation target: separate **holding an unchanged commanded angle**
from **applying a changed command without adding momentum**, then remove the
compensating hold only after both are verified. Do not simply promote global fixed
frames: S37 already demonstrated that moving them through the velocity solver can
launch walkers. Static success here is a necessary control, not dynamic acceptance.

## Reproduce

From the repository, use absolute output paths in an existing ignored directory:

```powershell
bun tools/servo-cause-probe.ts tools/orig-harness/standing-angle-variable.rcd '{"servoHold":0}' D:/snaptiles/.shots/cause-variable.jsonl
bun tools/servo-cause-probe.ts tools/orig-harness/standing-angle-literal.rcd '{"servoHold":0}' D:/snaptiles/.shots/cause-literal.jsonl
bun tools/servo-cause-probe.ts tools/orig-harness/standing-angle-variable.rcd '{"servoHold":0}' D:/snaptiles/.shots/cause-fixed.jsonl '{"fixedRest":true}'
```

For community-model diagnostics pass the external model path. Interventions are
optional JSON: `{"mode":"command-only"}`, `{"switchFrame":40,"switchHold":0}`,
`{"weldRest":true}`, `{"fixedRest":true}`, or `{"fixedChips":[15,16,17,47,48,49]}`.
Welding/fixed-rest interventions are valid controls only when commands are static.
`firstFall` reports intermediate transitions; `firstEndFrameFall` and
`endFrameMinUp` are the frame-complete outcomes used in the table.
