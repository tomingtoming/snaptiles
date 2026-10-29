# Visual editor sprints

Independent implementation from SnapTiles' format parser and public behavior;
no RCD/RCM implementation source or assets used.

## 2026-10-29 — Power and controls

Goal: give a newly attached motor usable controls without writing Val/Key code.
Added constant power, existing-variable binding and fresh Up/Down controls for
Wheel/RLW/Jet/Arm. The multi-section change is one undo operation, keeps Lua
unchanged and avoids names already present anywhere in the file.

Validation: 52 tests, production build, browser creation and actual key input
(+1200 / release 0 / -1200), save/URL round trip and mobile control bounds.

Retrospective: source-preserving patches depend on trustworthy section bounds.
Quoted braces, comment braces and Lua long strings exposed the old block scan's
weakness; the scan now skips those constructs and rejects unclosed sections.
The UI's height budget must be tested with the most complex selected part, not
just Core. Next: blank-model creation and steering, so the full vehicle can be
built from the GUI instead of relying on a sample's existing controls.

## 2026-10-29 — Build a vehicle from a blank Core

Goal: construct and operate a whole vehicle using the GUI alone.
Added undoable new models, automatic selection of added parts, ±30° steering
bindings and reversed variable bindings for motors. Tab insertion in the text
editor now synchronizes the visual document too.

Validation: 54 unit tests; browser creates Core, four wheels and a steering
joint, binds throttle and steering, then drives. The vehicle moved 7.0 m in
2 seconds of input and stayed near ground height; left/right/release values
were checked. This proves the tested construction loop, not every vehicle.

Retrospective: the first drive check accepted 0.23 m of sideways drift while
opposing wheels cancelled one another. A threshold of 0.1 m was too weak.
Added reversed bindings and raised the minimum distance to 1 m. A user goal
must be tested by its outcome, not merely by nonzero movement. Next: preserve
work across reloads and improve selection/framing before widening the editor.

## 2026-10-29 — Recovery and editing camera

Goal: avoid losing unpublished work and keep the editing target visible.
Added one browser-local draft with explicit, undoable restoration (including
invalid unfinished text), selection outlines and fit-to-model framing.

Validation: 56 tests and build; browser reloads an unpublished malformed draft,
restores its exact text and undoes restoration. Storage denial/corruption are
handled. Browser probes check actual camera movement on drag and wheel zoom.

Retrospective: static screenshots missed that the paused editor never called
the camera-follow update. The fix updates the editor camera independently of
simulation. A selection highlight also needed an outline because its colour
could be confused with the Core material. Next: run the production build and
integration checks, and make these workflows part of CI rather than relying
on repeated manual probes.

## 2026-10-29 — Production-build regression

Goal: make the creation loop repeatable outside the development server.
Added `test:editor`: it serves dist on an OS-assigned port, runs editing/recovery
and blank-vehicle flows, and closes its own server. CI installs Chromium and
runs the same checks, uploading screenshots on failure.

Validation: both probes pass locally against the production bundle; the GUI-built
vehicle again travels 7.0 m in 2 seconds. Remote CI has not run for these local
commits yet. Publishing and production deployment are awaiting scope confirmation.

Retrospective: keeping probe data in generated models avoids shipping third-party
assets. Use a fresh port and browser context per run, and assert behavior rather
than relying on a development-only environment. Next: let users adjust the
strength of GUI-created controls after a test run without returning to source.

## 2026-10-29 — Tune shared controls after driving

Goal: change motor strength and steering range without going back to code.
Added magnitude editing for intact GUI-generated controls. Each atomic edit
updates min/max, release step and both key steps; reverse-connected wheels
keep their sign. Custom or manually altered control definitions are protected.

Validation: 58 tests and production build; production-browser probes change
power 1200→1800, undo/redo, then verify actual ±1800/release-zero input. Steering
30→45→undo is also tested before the same blank-vehicle drive.

Retrospective: showing a variable name alone was enough to prove binding but
not enough for the next user action, tuning. A shared value must be labelled
as shared, and its associated rates must change together. Next: simplify
repeated structure creation while preserving the existing source and controls.

## 2026-10-29 — Reuse a branch

Goal: reuse repeated structures without rebuilding every tile.
Copy keeps a branch's original text and expressions; choosing a parent and an
edge pastes it with only the root attachment direction changed. Pasted parts
share their existing controls. Core and named branches cannot be copied;
missing referenced variables block cross-document pastes.

Validation: 60 tests; production browser copies a nested branch, pastes it on
another edge, deletes it, and undoes both operations to the exact original.
The previous creation/recovery/drive checks also pass.

Retrospective: copying shape alone can silently break control bindings or
name-based scripts. Preserve expressions and explicitly reject unresolved
references instead of producing a plausible-looking broken model. Next: test
source-preserving edits against the existing external model corpus.

## 2026-10-29 — External-model editing regression

Goal: test edits beyond the generated toy models used during implementation.
Added a local-only corpus probe that decodes UTF-8/Shift-JIS, parses and
assembles each model, adds a tile, changes an eligible angle, copies an
unnamed leaf and verifies exact source restoration by Undo. Lua source stays
unchanged after edits. No community model data is committed.

Validation: 90/90 sprishri models and 5/5 RCModel1 models pass on 2026-10-29.
The slowest complete edit-probe sequence was 45 ms in this run (not a browser
rendering or large-corpus performance guarantee). Ignored reports are under
.shots/editor-corpus-x.json and .shots/editor-corpus-RCModel1.json.

Retrospective: all 95 passing here does not replace the earlier runtime smoke
results or measure behavioral compatibility. Preserving script text is also
not enough to preserve numerical chip references when structure changes;
that limitation is now explicit. Next: inspect large imported models in the
browser and resolve concrete editing/accessibility defects before adding more
features. Public push/deployment still awaits the requested scope confirmation.

## 2026-10-29 — Navigate large models

Goal: reach and recognize small parts in a complex imported model.
A 294-part model rendered without page errors; importing into the editor took
18–31 ms across these runs on this machine. Fit-to-model kept every mesh bound inside the
mobile viewport. Added focus-on-selection and visual Undo/Redo keyboard
shortcuts. The list now marks the selected row and scrolls it into view;
indentation is bounded so deep trees do not hide all labels.

Validation: production browser verifies selected-part centering and keyboard
Undo/Redo alongside prior workflows. Independent screenshot review confirms
whole-model and focused views, with toolbar/control access on mobile.

Retrospective: a visible whole model is not sufficient for editing its small
parts. Selection needs both a spatial cue and a list cue. The performance
measurement is one imported model on one machine, not a general mobile FPS
claim. A follow-up measurement found the selected row just below the list after a
desktop-to-mobile resize. Resize-aware row-bound scrolling fixes this; the
probe now checks the row rectangle is inside the list. Imported model assets
and screenshots remain local. Next: audit remaining editing limitations and
turn the highest-value one into the next bounded sprint.

## 2026-10-29 — Cancel obsolete loads and release simulation resources

Goal: keep rapid run/edit switches consistent with the latest user request.
A controlled delayed start reproduced an older TAG=1 model replacing TAG=2
while the source still showed TAG=2. The previous world was never freed.
Load generations now guard model installation, file reads, URL decoding and
share-hash publication. Entering the builder cancels pending installation.
Simulation disposal closes Lua and frees Rapier once, including failed and
obsolete candidates. Failed runs do not replace the last successful share URL.

Validation: 61 unit tests pass, typecheck/build pass, and all three production
browser probes pass. The new probe holds and releases starts explicitly to
check latest-request selection, cancellation into editing, failed-start cleanup
and subsequent recovery. A unit test checks world release even when Lua cleanup
throws. Existing GUI-built car still travels 7.005 m in the two-second drive.

Retrospective: single successful runs missed both ordering and lifetime bugs.
A reproducible reversed completion order is stronger evidence than repeated
fast clicks. Cleanup call counts establish ownership, not a claim of constant
browser memory usage. Next: audit reopening saved work and file-import failure
paths. Public push/deployment remains pending the requested scope decision.

## 2026-10-29 — Reopen saved models through a file picker

Goal: complete the saved-file round trip on devices without drag and drop.
Added an always-visible Open button backed by the native file picker; picker
and existing drop now share loading and error handling. Reading failures leave
source and the current editor intact and show an error. Resetting the input
allows selecting the same file again. UTF-8 and Shift-JIS decoding are retained.

Validation: typecheck/build passed. A new browser probe downloads a GUI-built
model, reopens those exact bytes, selects the same file again, reads a Shift-JIS
comment, injects a read failure and recovers through another selection. Mobile
screenshot review found the new header controls, existing editing controls,
source and error message visible without clipping or overlap. Native OS picker
appearance and actual touch ergonomics are not established by browser automation.

Retrospective: drag-and-drop support alone left mobile users without an obvious
reopen action. The initial repeat-selection assertion accidentally observed the
previous paused simulation; waiting for editing to close as well as the new
assembly avoids that false failure. Independent visual review flagged small,
closely spaced direction buttons as a possible touch issue. Next: measure and
improve mobile touch targets while preserving usable model preview space.

## 2026-10-29 — Enlarge mobile attachment targets

Goal: make repeated branch attachment easier to tap without reducing the 3D view.
Measured direction buttons at 32px high, with E/S slightly below 44px wide.
Mobile N/W/E/S targets now have a 44px minimum in both dimensions and 6px gaps.
The measured final sizes are 44.67x44, 47.63x44, 44x44 and 44x44 CSS pixels.

Validation: typecheck/build and all four production browser probes pass.
The editor probe asserts target dimensions and confirms the power controls,
part selector and direction row remain inside the editor panel. Independent
screenshot review finds no overlap or clipping in that row and no reduction
in the 3D viewport. This is layout evidence, not a user touch-accuracy study.
The source pane remains compact and scrollable; the change does not claim to
make every mobile control 44px or to optimize source-code editing on phones.

Retrospective: a small measured adjustment solved the specific review finding
without restructuring the editor. Next: make sharing the latest model explicit;
currently the user must run and manually copy the address, and an edited source
can differ from the last successfully published hash.

## 2026-10-29 — Share the current edited model explicitly

Goal: share the current construction without accidentally sending the last run.
Added a Share Link action that captures the editor text, checks model syntax and
Body presence, and builds a compressed URL without running or replacing the
current model/address. A modal exposes a selectable URL and an explicit Copy
button. Clipboard denial leaves the URL selected with manual-copy instructions.
Malformed input clears the result and disables copying rather than offering a
stale link. Closing the dialog restores focus to the initiating control.

Validation: typecheck/build and all five production browser probes pass. The
new probe opens a URL made from unrun GUI edits in a separate page and compares
the exact source. It also tests changed-source links, clipboard success/denial
with a stub (the host clipboard is not touched), invalid syntax, and focus
return. Independent mobile screenshot review confirms readable title, URL,
fallback instructions and both actions without overlap or horizontal overflow.
Clipboard interaction on every real browser and very large link transport
limits remain unmeasured. Syntax validation does not certify model dynamics.

Retrospective: the address bar represented the last successful run, which was
not necessarily the construction being viewed. Capturing the current text at
an explicit share action resolves that ambiguity while preserving editing.
Next: audit state and document identity across new/import/edit/save, including
whether download names misleadingly retain a previous sample name.

## 2026-10-29 — Derive sample identity from current source

Goal: avoid saving new work under an unrelated previously selected sample name.
Reproduced a Core-only new document downloading as car.rcd with car still marked
selected. Removed the separately maintained sample index. Selection and download
name now compare the current source with sample contents (normalizing line
endings). GUI edits emit a model-change notification without resetting their
Undo history; direct text input also refreshes selection. Untouched samples
retain their names; custom content downloads as model.rcd.

Validation: typecheck/build passes. Browser assertions cover new-document
selection clearing, Undo/Redo restoring/removing sample identity, sample download
name and custom-file download name. The original reproduction now yields
model.rcd with no sample selected. This is content identity, not a full document
naming system: imported filenames and custom user titles are not yet retained.

Retrospective: source text was already authoritative for execution and sharing,
but naming still depended on the last sample button. Removing that duplicate
state avoids another synchronization obligation. A local command sequence ran
browser checks after an initial typecheck failure and therefore used old dist;
those results were discarded. After fixing the unused loop index, build and
browser verification ran separately. Next: retain a meaningful filename across
import/edit/save without letting a new document inherit another model's name.
