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

## 2026-10-29 — Retain imported document names through editing and recovery

Goal: preserve a useful imported filename without giving new work another
model's identity. Document history now snapshots text and optional filename
together. Import assigns a name, edits keep it, New clears it, and Undo/Redo
restores both fields. Local drafts store the optional name; existing version-1
unnamed drafts still work. Sample/URL loading resets imported identity through
a single source-loading entry point. Downloads normalize the extension to .rcd
and strip path components and filename characters reserved by Windows.

Validation: 64 unit tests and typecheck/build pass. Production file probe
imports saved.rcd, edits it, checks the downloaded name, creates a new model,
checks model.rcd, undoes and checks saved.rcd, then reloads/restores the draft
and checks saved.rcd again. All five browser probes pass. Tests also cover old
unnamed drafts, malformed name metadata and Japanese filenames.

Retrospective: keeping a second filename variable in the UI would have repeated
the stale-selection defect. Filename belongs to the same history snapshot as
content. Share links still contain model text only, so receiving a link does not
restore its sender's local filename; no custom-title UI has been introduced.
Next: assess construction parameters already supported by the runtime but not
yet editable in the GUI, especially wheel options and ballast weight.

## 2026-10-29 — Adjust wheel radius and ballast from the GUI

Goal: tune construction geometry and balance without editing option syntax.
Wheel/RLW now expose radii 0.30/0.45/0.60 m and Weight exposes mass multipliers
1–8 (option 0 retains its existing 1x default meaning). The radius choices use
the 2026-10-27 measurements in measured.md; ballast choices follow the saved
public format specification and existing runtime. Existing expression-valued
options remain source-only. Edits preserve surrounding text and Undo history.

The construction preview now lifts geometry whose bounding box would cross
the ground, with 0.05 m clearance, and option changes reframe the whole model.
This only affects the editor pose/camera; runtime spawn rules are unchanged.

Validation: 66 unit tests and typecheck/build pass. The option browser probe
checks rendered wheel scale, geometry minimum height, projected bounds inside
the viewport, Undo/Redo, runtime option, Weight assembly mass 806.4 kg and
combined Core/Weight physics mass 831.6 kg. Expression replacement is blocked.
Independent mobile review confirms readable settings and no overlapping controls.

Retrospective: the first screenshot caught a large wheel clipped at the top;
clearing the ground did not automatically update the camera framing. Reframing
and a projection-bound assertion now cover that defect. An initial physical-mass
assertion treated Weight as a separate body; fixed parts share one body, so the
correct probe sums unique bodies and includes Core. These checks establish this
editor/runtime path, not new original-executable calibration. Next: assess
appearance controls so builders can distinguish and personalize their parts.

## 2026-10-29 — Paint parts without changing dynamic color expressions

Goal: distinguish and personalize parts from the construction UI. A collapsed
Color section exposes the selected part's current rendered RGB as a native
color input. Core and other parts support fixed-color edits with source-range
replacement and Undo/Redo. Variable/expression-driven colors are read-only in
this UI with a source-edit hint. Lua may still override a literal color at run
time; this editor does not attempt to rewrite or analyze those scripts.

Validation: 68 unit tests and typecheck/build pass. Browser checks compare
material RGB for Core and Chip, Undo/Redo, runtime colors, and an exact-source
share-link round trip in a second page. A variable-driven color disables the
picker. Native platform picker appearance is not tested by these scripted
color input events. Independent mobile image review confirms the color section
is readable and the two colored parts remain fully visible.

Retrospective: material RGB assertions initially passed while the selected blue
Core looked purple in the screenshot. Selection added yellow emissive light.
Removed that tint and retained the yellow outline/list marker; a new no-tint
assertion and re-review confirm the blue face remains blue while selected.
Next: check how builders return from a custom color to the type's default,
without undoing later unrelated construction edits.

## 2026-10-29 — Restore a type's default color without undoing construction

Goal: remove a color override while retaining later angle/structure edits.
Added Default Color beside the picker. It removes the color attribute rather
than baking in a palette number, so a subsequent type change adopts that type's
default. The parser records attribute token spans and separators; removal keeps
intervening whitespace/comments, handles first/middle/last attributes and removes
duplicate color declarations together. One Undo restores the exact source.
Dynamic colors remain protected, and already-default colors disable the action.

Validation: 76 unit tests, typecheck/build, all seven production browser probes
and the 90-model external editing corpus pass. Browser checks preserve a later
20-degree angle while resetting color, change Chip to Frame and verify Frame's
palette, then undo the type/reset and recover the custom color. Mobile review
confirms the added control is readable and fits beside the picker.

Retrospective: resetting to a copied RGB number would have lost the meaning of
'default'. Token-level deletion preserves that meaning and unrelated comments.
The screenshot's clipped Copy button was a scroll-state observation: the panel
was at scrollTop 57 with 419px content in 362px, and scrolling back brought the
entire button into view. This was verified rather than treated as an overlap.
Corpus success measures parsing/editing, not physics compatibility. Next: assess
Cowl shape selection, another existing runtime feature missing from construction.

## 2026-10-29 — Choose Cowl shapes and remove self-shadow striping

Goal: shape decorative bodywork in the visual editor. Cowl exposes options
0–7 using the existing renderer and the observations recorded in measured.md:
plate, outline, disc, two triangles, rounded end, and plate aliases 6/7.
Angle/color/script contents survive option edits and Undo/Redo.

Validation: 84 unit tests and typecheck/build pass. The browser probe selects
all eight values, finds six distinct geometry buffers and confirms 6/7 match
plate geometry, then checks Undo/Redo and runtime option. Independent image
review identifies the expected shapes and readable mobile labels. It does not
establish exact right angles or new original-executable compatibility.

Retrospective: visual review caught diagonal stripes on thin Cowl surfaces.
Disabling shadow reception removed them, isolating self-shadowing. Small bias
and shadow-side experiments did not establish a usable fix. After checking
existing findings and the Three.js shadow-side code, a 0.05 normal bias (about
one texel over the 80 m shadow frustum) removed the stripes while retaining
ground shadows. Early snapshots did not explicitly wait for a rendered frame;
the shape probe now waits two animation frames before every image. Re-review
confirms smooth plate/disc/rounded-end faces; tiny contact-shadow offsets and
all lighting/view angles remain unmeasured. Keep striping in visual checklists.
Next: audit the growing editor as a complete workflow for discoverability and
keyboard operation, before adding further part parameters.

## 2026-10-30 — Keep the keyboard workflow connected

Goal: move from editing to driving and back without a pointer-only workaround.
Reproduced Enter on Run leaving focus on the button: ArrowUp produced ENGINE=0.
Also reproduced Ctrl+Z doing nothing while the part list was focused. Successful
loads now focus an accessible, keyboard-focusable canvas, unless the user moved
focus elsewhere during initialization. The view has a visible inset focus ring.
Select elements permit GUI Undo/Redo; text inputs retain native editing behavior.
Source Shift+Tab leaves the field instead of inserting a tab. Ctrl/Meta/Alt
shortcuts no longer become model key presses.

Validation: 84 unit tests and typecheck/build pass. The keyboard browser probe
uses Tab/Shift+Tab/Enter to run, drive, enter the builder, create/add a part, and
Undo/Redo from the list. It holds a modifier shortcut across simulation ticks
and checks no brake input, and delays initialization to verify a user's move to
the source field keeps focus. Reproduction after the fix reports view focus,
ENGINE=900 while held, and a successful part removal by Undo. Independent image
review confirms the focus border is visible without obscuring model or controls.

Retrospective: prior browser tests explicitly focused the view before driving,
which bypassed the real transition failure. The new probe preserves actual
keyboard focus transitions. This is a keyboard workflow check, not a complete
screen-reader or accessibility audit. Next: audit icon labels and discoverability
of construction commands, including guidance that does not require reading README.

## 2026-10-30 — Put the construction guide in the app

Goal: make the build/configure/run/save loop discoverable without opening README.
Added a ? button with a native modal guide covering the five-step workflow,
branch copy, camera/touch gestures, and keyboard navigation. Icon controls now
have Japanese accessible labels and state/tooltips. Entering the builder also
synchronizes the view button/index with the orbit camera instead of leaving a
chase icon for an orbit view. Narrow headers wrap below 360px.

Validation: typecheck/build passes. The guide probe opens the named dialog,
checks view-state labels, preserves source and editor state, closes with Escape
and its button, and checks focus returns to the initiating control. At 320px,
header/document width and the reachable close button stay inside the viewport.
Independent review finds readable steps and no text overlap at 390/320px.

Retrospective: a small-screen check found the native dialog initially focused
its last Close button and scrolled past the opening instructions. Explicitly
focusing the heading restores the intended reading order; that condition is
now asserted. Review also caught missing touch instructions despite existing
pinch support; the guide now names both gestures. This is a layout/focus and
content check, not a first-time-user comprehension study. Next: test touch
pinch/cancellation sequences rather than infer their reliability from code.

## 2026-10-30 — Continue and release multi-pointer gestures correctly

Goal: keep mobile camera gestures and model mouse state consistent when fingers
are removed or cancelled. Reproduced a pinch followed by one remaining pointer
that no longer orbited, while _ML cleared despite that pointer remaining down.
Cancellation could also leave _ML pressed. Pointer button masks are now tracked
per pointer, and the remaining gesture is rebased when a pointer ends. Up,
cancel, capture loss and window blur clear the appropriate state; mouse button
chords update when one button lifts while another remains held.

Validation: 84 unit tests and typecheck/build pass. A browser probe uses CDP
touch input to zoom, lift only one named finger, continue orbiting with the same
pointer, cancel and restart. It verifies actual got/lost-pointer-capture events,
mouse button chords, and the blur cleanup handler. The blur event is injected;
physical-device gestures and OS focus transitions are not certified here.

Retrospective: the first CDP test specified the remaining finger in touchEnd,
but this command names the fingers being removed. Event logging exposed the
mistake. A release-capture test initially released a pending request before the
browser acquired capture; a move plus observed gotpointercapture makes the
precondition explicit. Test timing alone was not enough. Next: test simultaneous
keyboard and on-screen control inputs so releasing one does not cancel another.

## 2026-10-30 — Preserve independent control sources

Goal: allow keyboard and screen controls to overlap without one release
cancelling another hold. Reproduced ArrowUp held at ENGINE=1500, then a screen
Up click/release causing _KEY(0)=0 and ENGINE to fall. KeyState now tracks physical
codes and per-control pointer sources separately, exposing their union through
its existing down/isDown interface. Repeats and duplicate releases are idempotent.
Alias key-up uses its original physical-code record, and blur clears source maps.
Starting a model clears old keycap sources before replacing their DOM.

Validation: 88 unit tests and typecheck/build pass. Unit cases cover release
orders, shared arrow/W aliases, alias-map changes, repeated keydown, duplicate
pointer release, modifiers and blur. Browser coverage exercises both keyboard/
screen release orders, two touches on the same keycap, cancellation and reload
while a screen key remains held. The API assertions wait for a simulation tick
because _KEY reports the model's frame snapshot, not instantaneous DOM state.

Retrospective: a Set of virtual key numbers erased input provenance. Independent
sources need independent release ownership, with a union only at consumption.
The existing simulation API stays unchanged. Gamepad remains its existing
separate source; physical multi-device behavior beyond these browser cases is
not claimed. Next: check whether construction direction controls are legible
from different camera angles and identify a concrete orientation aid if needed.


## 2026-10-30 — Show selected attachment directions

Goal: make N/W/E/S understandable after rotating the construction camera.
Selected parts now show upright direction letters with leaders and endpoint dots.
The markers use nominal joint edges transformed by the selected tile orientation;
wheel visual radius does not move the attachment points. The overlay ignores
pointer events and disappears on run. The guide explains its letters and dots.

Validation: 88 unit tests, build, and all 13 browser probes pass. After the
endpoint-dot refinement, the targeted probe and final build pass again.
The new browser probe compares each marker with actual child hinge
anchors on an enlarged wheel folded 65 degrees, across three camera/viewport
configurations. Independent visual review confirmed readable separated letters
on mobile and desktop. Its first review found ambiguous line endpoints; adding
small outlined dots resolved that observation. Camera projection testing also
caught a one-frame stale matrix, fixed by updating it before projecting markers.

Retrospective: direction names alone do not identify a construction destination.
Keep labels readable in screen space while anchoring their leaders in model
space. These samples do not prove collision-free labels at every degenerate
camera angle. Next: investigate framing after changing the construction view,
particularly the clipping seen in the enlarged-wheel review fixture.


## 2026-10-30 — Preserve construction framing across viewport changes

Goal: distinguish ordinary manual enlargement from unintended clipping after
camera/view changes. A fitted 15-part span stays visible while orbiting, but
resizing a 1600x600 window to 850x1000 reproduced clipping (projected extent
1.759, where 1 is the viewport boundary). 800px uses the mobile layout and did
not reproduce it; the responsive boundary matters.

Scene resize now scales editor camera distance by the old/new limiting field
of view. It preserves the viewing direction and the user's relative manual
zoom, rather than unconditionally fitting the full model again. Runtime camera
distance is unchanged. The new browser probe checks geometry bounds, orbit,
wide/narrow/mobile resize, a manual-zoom resize round trip and runtime isolation.
Independent visual review confirms all model ends remain visible in three sizes.
Validation: 88 unit tests, typecheck/build and all 14 browser probes pass.

Retrospective: the previous clipped fixture was enlarged by adding branches
without refitting, so it alone did not establish a camera defect. A controlled
full-fit/resize experiment identified a separate real issue. Whole-model view
can still make attachment points dense; “選択へ” remains the detail view.
The source field deliberately disables wrapping; the long-line fixture alone
is insufficient evidence for changing that policy. Next: verify Undo when
switching between direct source editing and GUI construction.


## 2026-10-30 — Share Undo between source and visual construction

Goal: preserve work when alternating direct source edits and GUI construction.
Reproduced adding a part, typing a comment, and losing even the preceding GUI
Undo history. Each source input constructed a new ModelDocument. Direct source
changes now enter the existing history without requiring valid intermediate
syntax. Adjacent typing/deletion within one second is grouped; focus changes,
selection replacement, input-type changes, GUI edits and Undo delimit groups.
IME composition stays in one group, including slow candidate changes.

Source keyboard Undo/Redo and browser beforeinput history requests use the same
document history, including outside build mode. Other text/number fields keep
native Undo. Programmatic indentation becomes undoable. The guide describes
this distinction. Imported filenames survive direct edits and history travel.

Validation: 91 unit tests and all 15 browser probes pass. Typecheck/build passes.
New unit cases cover grouped input after GUI edits, incomplete
source recovery, redo branching and normalized no-op input. The browser probe
reproduces the original loss and verifies GUI/source Undo/Redo, invalid syntax,
indentation outside build mode, Chromium IME composition/commit and new input
after Undo. Synthetic beforeinput verifies the history-gesture handler; actual
mobile keyboard gesture behavior has not been tested on a physical device.

Retrospective: native textarea Undo and a separate model history did not form
one reversible document. Preserving a single history fixes the boundary; it
also requires grouping typing so Undo does not regress to character-by-character
steps. Next: verify selection/caret position and viewport continuity when
Undo/Redo crosses source and visual edits.


## 2026-10-30 — Restore source editing position with history

Goal: resume editing where an Undo/Redo happened instead of searching the file.
A 90-line fixture reproduced Undo replacing a backward selection near offset
6593 with a caret at the document end (14872), also changing horizontal scroll.
Document history now carries optional source selection direction/range and both
scroll offsets. Source beforeinput records the pre-edit location; Undo/Redo
restores it after updating the source and preview. These are transient editor
metadata, not added to exported models or persisted drafts.

GUI replacements remap offsets before/after their changed span, preserving
scroll; positions inside the replaced span move to its end. The changed span is
computed from common prefix/suffix even when the implementation replaces the
whole document. New documents start at the beginning; Undo restores the prior
view. Programmatic Tab now emits beforeinput so replacing a selection has the
same checkpoint as normal typing.

Validation: 93 unit tests, typecheck/build and all 16 browser probes pass.
The new browser probe checks backward-selection replacement, source
Undo/Redo, both scroll axes, GUI angle edits before a caret and Tab replacement.
Unit cases cover view metadata snapshots, GUI offset shifts, whole-document
replacement with an unchanged prefix, and new-document Undo. A viewport change
may naturally clamp scroll offsets to the new available range.

Retrospective: reversible text alone is insufficient for comfortable iteration;
the editing position is part of the operation. Keep this metadata in ephemeral
history rather than modifying model format or draft storage. Next: verify that
part selection remains understandable when removing branches and using Undo,
and when source edits change traversal indices.


## 2026-10-30 — Keep the selected construction target through edits

Goal: avoid changing the edit target merely because traversal indices change.
Removal previously selected Core unconditionally and history did not restore
the deleted part's selection. The document now stores a source-position anchor
in transient history. Removing a branch selects its surviving parent; Undo
restores the original part, and Redo restores the parent. Run/build also keeps
the target when the document is unchanged.

Direct input uses the verified beforeinput replacement range where available,
so inserting identical declarations before a selected one preserves the old
part rather than matching the first identical text. A prefix/suffix span is the
fallback for input paths without a valid range. Replacing/removing the anchor
falls back to Core; it never guesses another traversal index. GUI operations
with unchanged topology, including generated controls inserted in several
regions, retain traversal identity. No persistent IDs are added to model files.

Validation: 96 unit tests, typecheck/build and all 17 browser probes pass.
Targeted browser coverage checks nested branch deletion, Undo/Redo,
source insertion, identical insertion, generated controls, deleting the selected
declaration directly, run/build and scene-highlight agreement. Unit tests cover
anchor mapping, deletion fallback, history restoration and generated controls.

Retrospective: a list index is presentation order, not stable edit identity.
Actual input ranges resolve ambiguity that text comparison alone cannot.
Selection metadata belongs alongside history, while arbitrary source replacement
requires a conservative fallback. Next: run another complete construction-to-
share workflow and prioritize failures that interrupt that loop over isolated
control polish.
