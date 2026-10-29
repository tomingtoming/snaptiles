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


## 2026-10-30 — Verify the complete build-to-share loop

Goal: test one evolving vehicle across construction, controls, driving, revision,
save, sharing and resumed editing, rather than treating each feature in isolation.
Extended the existing GUI-built four-wheel steering-car probe. After its first
drive, change shared power from 800 to 1000, download the exact source, generate
a share URL, and open it in an independent mobile/touch browser context. The
receiver drives more than one metre using screen controls, holds throttle and
steering together, releases both, then reopens the actual downloaded bytes.
Change power to 1200, save under the imported filename and run again. Source
round trips are exact and no page errors occur.
Validation: the extended probe passes against both the development server and
the current production build. Production run: initial drive7.005m, shared
touch drive4.784m, saved source463bytes. Unit/app code is unchanged; the prior
96-unit/17-browser baseline was not unnecessarily repeated.

Independent visual review confirms the reopened Wheel target, angle90, radius
0.30m, shared power1200 and major controls are readable. Its initial simultaneous-
press screenshot showed only one highlighted key: the capture occurred during
the 60ms CSS color transition. The probe now waits for both held states and
completed computed colors; the repeated review confirms both highlights. No
application change was needed for this observation.

Retrospective: crossing separate browser/file boundaries provides evidence that
isolated feature probes miss. Visual evidence also needs a defined settled
state; an immediate simulation-value assertion does not settle a CSS transition.
The receiver's default chase view makes this small vehicle hard to inspect.
Next: evaluate initial camera framing against model size on first shared-link
load, while preserving intentional manual zoom during ordinary driving.


## 2026-10-30 — Frame newly loaded models for driving

Goal: make a first shared-link load readable without manual zoom setup.
The small-car fixture initially occupied only 48px at the fixed 12m camera
distance. Loading now synchronizes actual physics poses into the rendered
model before measuring its bounds. A bounding radius around the followed Core
sets initial distance using the narrower viewport field of view and 20% margin,
with a 3m minimum. It uses Core rather than bounds center so asymmetric models
remain inside a camera that will continue following Core.

The same probe exposed an additional discontinuity: fitting a long model beyond
60m and then zooming out snapped inward to the old fixed limit. Wheel and pinch
now share one zoom method with a limit of at least 60m or four times the fitted
distance. Editor fit/focus and resize update this range too. Fitting occurs on
load or explicit editor fit actions, not continuously during driving.

Validation: 96 unit tests, typecheck/build and all 18 browser probes pass.
Small, long and very long fresh shared-link fixtures occupy about
143px, 161px and 160px respectively; initial distances are 4.05m, 45.78m and 88.35m.
All geometry fits, zoom-out increases distance, and subsequent simulation frames
do not overwrite manual zoom. Independent visual review finds the small model
readable and the long model fully visible without overlapping controls. Large
models remain visually thin by nature of a full-model view. Dynamic articulation
beyond the initial bounds is not continuously auto-framed.

Retrospective: a camera constant is not a usable default across model scales.
Measure actual rendered poses and use the same target as the follow camera.
Expanding the fit range also requires auditing manual-control limits. Next:
review how a creator names and distinguishes saved models and shared variants
when completing several build/test iterations.


## 2026-10-30 — Name saved model variants

Goal: distinguish iterations without every new creation downloading as model.rcd.
Added a compact 保存名 action that opens a native dialog with the current default
or imported filename. It previews the actual sanitized .rcd filename before
confirmation. Renaming changes document metadata only, is undoable, and travels
with the existing draft filename field. Cancel and Escape leave it unchanged.
The dialog explicitly says the name is local to this browser and is not included
in source-only share links. Ordinary one-click Save remains available.

Ctrl/Command+S while the naming dialog is open validates and applies the entered
name before downloading, so it cannot silently use the previous name. Empty
required input blocks that shortcut until corrected. The in-app guide points
to 保存名 before Save.

Validation: 97 unit tests, final typecheck/build and all 19 browser probes pass.
Coverage includes actual suggested download filenames, unchanged model source,
Undo/Redo, cancel/Escape, sanitization preview, keyboard save and draft restore.
Independent visual review passes the 390px and 320px dialog captures: input,
actual filename, explanation and both actions fit. Physical on-screen keyboard
behavior is not established by these viewport captures.

Retrospective: the imported filename machinery already supplied persistence and
history; a small naming action exposes that capability without changing the
model format or adding a library. Names and source-only links have different
lifetimes, so the UI must state that distinction. Next: check whether the saved
variant remains understandable when imported beside an existing unsaved draft,
and whether recovery offers enough context to choose the intended document.


## 2026-10-30 — Identify the draft before restoring it

Goal: distinguish a recoverable draft from the currently open imported/shared
model before taking the existing one-click restore action. A compact recovery
card now groups the saved filename, local date/time and restore button. Unnamed
models and invalid timestamps have explicit fallback labels. The card disappears
when its source and filename match the current document.

The restore action uses the displayed draft snapshot rather than reading a
possibly different value at click time. Other tabs' storage events refresh the
candidate while the builder is open. This remains the existing single latest
browser draft, not a multi-document library or a conflict-resolution system.
The guide now states the one-draft scope and that Undo reverses restoration.

Validation: 97 unit tests, typecheck/build and all 20 browser probes pass.
Browser coverage checks named/time display in Asia/Tokyo, source and filename
restoration, Undo, an intervening same-document storage change, cross-tab updates,
unnamed drafts, invalid timestamps and incomplete-source recovery. Independent
visual review passes 390px and 320px captures: name, timestamp and button form
one readable group without overlap or horizontal clipping.

Retrospective: recovery needs enough context to identify its target, and the
executed target must agree with what the user saw. Existing saved metadata was
enough; no new persistence schema or confirmation step was needed. Next: audit
remaining gaps against the full build/control/test/save/share workflow and the
independent-implementation scope before adding more local UI features.


## 2026-10-30 — Audit the complete creation loop against outcome evidence

Goal: return to the requested creation/control/test/save/share loop rather than
adding UI details without checking the actual outcome. The existing drive probe
proved forward travel and steering-variable changes, but not a vehicle turn.
A new integration test constructs the same seven-part car through ModelDocument
operations, settles for two seconds, then compares two seconds of straight,
left and right input in separate fresh simulations. Straight travel is 6.78m
with less than 0.1m lateral drift. Left/right inputs move laterally -2.52m/+2.74m
and change heading +82.88/-84.21 degrees, with ground height near 0.60m. Release
returns throttle and steering controls to zero. This proves this constructed
vehicle's controllability, not original-engine fidelity or every vehicle.

| Requirement | Current evidence | Limit |
| --- | --- | --- |
| Build from a blank Core | GUI-built steering car, type/angle/branch/colour/option and selection probes | No mirroring or multi-selection; arbitrary scripts remain source-edited |
| Set controls | Shared/reversed throttle and steering, strengths, keys/touch, mixed-input release tests | General key-mapping GUI and physical-device coverage are incomplete |
| Try the result | Forward travel, new left/right trajectory test, shared-link touch drive, camera tests | One constructed-car outcome fixture; not a universal physics-compatibility proof |
| Save/reopen | Exact downloaded bytes, UTF-8/legacy import, naming, draft restore, Undo/caret tests | One latest local draft; no cloud backup or multi-model library |
| Share/resume | Fresh browser context receives exact source, drives and re-edits it | Local filenames are not in links; deployed website not validated by local tests |
| Retrospectives | This chronological sprint log records implementation, evidence and next action | It is engineering evidence, not user approval of publication |
| Independent implementation | Current editor work uses local parser/public behavior and original tests; no RCD/RCM source/assets used | Full RCD/RCM parity and original physics equivalence are not claimed |

The README still said source typing erased Undo, colour required manual source,
and Undo excluded the source field. Updated it to the current behavior and
explicit limitations, including named saves, draft identification, options,
selection and camera changes. Also qualified the opening compatibility claim.

Validation: 98 unit/integration tests and typecheck/build pass. Application code
and built JS hash (index-BVfEZGL2.js) are unchanged from Sprint 31, whose 20 browser
probes passed; this documentation/test-only sprint does not repeat that suite.
Read-only GitHub check on 2026-10-30: PR 1 remains OPEN at 1f3f884f0f12a659e6c58d49da3a8b5166f034b3
(https://github.com/tomingtoming/snaptiles/pull/1). Editor work through local
02d92c4 is not that remote head. No push or deployment was performed.

Retrospective: input plumbing and a changing control value are weaker evidence
than trajectory and heading. Documentation can also lag implementation and
wrongly discourage supported workflows. Next: check browser portability of the
core creation loop; current browser evidence is Chromium-only, distinct from
physical-device and original-engine calibration.


## 2026-10-30 — Verify the creation loop in Firefox

Goal: add another browser engine's evidence to the Chromium-only creation loop.
Installed the Playwright-pinned Firefox test binary (157.0) and first verified
WASM/WebGL startup. On this Windows host it uses ANGLE/NVIDIA hardware rendering.
A new browser probe builds the same seven-part steering car via GUI controls,
undoes direct source typing, drives/releases throttle, names and downloads the
exact source, opens a share link in a fresh context, edits at 390px width, checks
Undo/Redo and reopens the actual downloaded bytes. Travel measured 4.027m and no
page errors occurred.

Validation: the Firefox flow passes against development and production builds;
`bun run test:editor:firefox` also passes. The shared production runner's selected-
script mode passes both the existing Chromium general editor probe and Firefox.
Independent screenshot review confirms the selected wheel, direction labels,
shared power 1100 and primary controls are readable without clipping. Narrow
windows are not evidence of physical mobile touch/keyboard behavior.

Added the Firefox command and a separate CI step, including browser installation.
The default Chromium suite remains unchanged. Remote Linux CI has not run for
these local changes, so its WebGL/runtime behavior is still unverified. No
application implementation change was needed; the prior 98-unit and 20-Chromium
baseline is not recast as Firefox coverage. This probe covers the core loop,
not every existing Chromium-only pointer/CDP/IME test.

Retrospective: broad browser claims require executing the full workflow in that
engine, not checking that the canvas starts. Separate commands make the smaller
portability scope explicit and repeatable. Next: test the same core loop with
WebKit where available, while retaining the distinction from Safari on an
actual Apple device.

## 2026-10-30 — Make optional audio failures safe and exercise WebKit

Goal: execute the same independent-editor creation loop in WebKit. The first
Windows WebKit 27.2 run completed model operations but emitted page errors because
AudioContext was absent. Audio now detects the standard or prefixed constructor,
handles initialization failure, safely retries rejected resume requests on later
gestures, and tolerates denied localStorage access. Unavailable audio disables
the sound button with an explanatory accessible name; physics/editing remain
independent of sound. Seven new audio tests bring the unit total to 105.

Firefox and WebKit now share one portability scenario, with separate commands
and CI steps. The scenario checks GUI construction, source Undo, driving/release,
named exact-byte download, fresh-context sharing, narrow editing and file reopen.
The WebKit development run traveled 4.027m without page errors. This is workflow
state evidence, not proof of visible rendering or Safari on Apple hardware.

Independent visual review rejected the WebKit image: the 3D canvas is blank,
selected tree text is dark on dark, select values have poor contrast, and the
right end of the toolbar is clipped. These findings remain open. A diagnostic
control renders a red WebGL canvas successfully with preserveDrawingBuffer;
the application returns a nonblank ground pixel immediately after rendering,
72 draw calls, no context loss and GL error 0, but its screenshot remains blank.
This narrows the next investigation toward buffer/compositing/capture behavior;
it does not yet establish the cause or a product fix.

Retrospective: exception-free interactions and changing simulation state can
pass while the captured interface is unusable. Keep independent visual review
as a separate acceptance check. Next sprint: distinguish the Windows WebKit
render/capture path from application behavior, repair native-control contrast
and toolbar bounds, then repeat visual review. Publication remains pending;
no push or deployment was performed.

Final validation: typecheck/build, all 20 Chromium probes and the Firefox/WebKit
production workflow probes pass (audio available true/false respectively). The
105 unit tests passed earlier in this sprint. Visual acceptance remains rejected
as described above. Additional minimal controls capture animated red WebGL with
both preserveDrawingBuffer false and true; removing overlays or forcing a CSS
canvas layer does not restore the application screenshot. Neither buffer
retention alone nor overlay presence alone explains the result.

## 2026-10-30 — Repair toolbar wrapping and distinguish resize capture failures

Goal: address Sprint 34's rejected narrow-view images. The toolbar's wrapping
selector depended on being the builder's first child; the draft recovery card
had displaced it. Gave the toolbar an explicit id and restored wrapping without
coupling it to sibling order. Declared the existing dark theme as color-scheme:
dark so native selects use readable surfaces. Selected tree rows now use light
text on a muted background instead of black text whose requested background
was not consistently honored by native controls.

All toolbar buttons are now checked by bounding rectangle at both 320px and
390px in Chromium and the Firefox/WebKit portability flows. This is stronger
than the former document scrollWidth check, which missed internal overflow.
Build and the general editor, help, filename, recovery and framing probes pass;
Firefox/WebKit creation-loop probes pass. The application changes are HTML/CSS,
so the prior 105-unit baseline is retained rather than needlessly repeated.

The WebKit blank canvas was isolated without modifying production rendering.
Single-scene rendering and a copied framebuffer contain geometry. The new
`node tools/webkit-resize-diagnostic.mjs` uses only raw WebGL: on this Windows
WebKit 27.2, the screenshot pixel changes from red [255,0,0,255] to white
[255,255,255,255] after changing canvas height, while immediate framebuffer
readback remains red, context loss is false and GL error is zero. This proves
a limitation in this engine's presentation/capture path after resize, not an
original-model or Three.js geometry defect. Actual Apple Safari remains untested.
No production buffer-retention or renderer workaround was introduced.

An additional Firefox blank image had a different cause: capture followed two
viewport changes before the replacement drawing buffer had been rendered. Its
raw WebGL resize control stayed red. Waiting for two animation frames before
capture restored the vehicle, ground and selection box; WebKit stayed blank
under the same wait. The portability probe now uses this rendering boundary.
A mistaken interim visual reading of deduplicated tool images was corrected by
comparing PNG pixel distributions: adding a second 2D canvas had no effect.

Retrospective: DOM bounds, framebuffer contents and a composited screenshot
answer different questions. One symptom can have different causes by engine.
Use a minimal independent control before changing working renderer code, and
wait for the actual rendering boundary after resize. Next: exercise creation
workflow accessibility through keyboard/focus and compact viewport states,
including the now-wrapped toolbar and recovery-card state; keep WebKit 3D visual
acceptance explicitly open rather than replacing it with state assertions.
No push or deployment was performed.

Independent visual review: toolbar wrapping, select contrast and selected-row
readability pass in all three captured engines. Chromium and the recaptured
Firefox model/selection/ground pass. WebKit DOM review passes, while its 3D
capture remains unverified under the diagnosed limitation.

## 2026-10-30 — Keep keyboard focus usable after draft recovery

Goal: exercise the compact-screen recovery/edit/save path through keyboard
navigation. At 320x568, pressing Enter on Restore hid its card while leaving
activeElement on the now-hidden restore button. Tab could continue to the
next toolbar action, but the immediate focus indicator disappeared.

When a recovery card containing focus disappears, focus now moves to the part
list for a valid model or the source field for incomplete/invalid source. This
also handles a cross-tab removal of the displayed draft. A card update/removal
does not move focus if the user is editing a different field.

The recovery browser probe now navigates from Build to Restore by Tab, restores,
selects the child with ArrowDown, reaches Rename by Shift+Tab, names and downloads
via Ctrl+S, checks dialog focus return and verifies each editing target is inside
the scrolled panel. It also checks incomplete-source focus, Undo, cross-tab card
removal with focus on the card, and removal while an unrelated input owns focus.
The same probe accepts an optional engine argument for Firefox/WebKit checks.

Validation: 105 tests and build pass. Production-build Chromium recovery,
keyboard and general-editor probes pass. The expanded recovery flow also passes
on development builds in Firefox and WebKit; this is DOM/focus coverage, not
WebKit 3D visual acceptance. Independent Chromium/Firefox image review confirms
the focused part list is fully visible, Core/Chip readable and native focus
indicators distinguishable at 320x568. No clipping or overlap in that target.

Retrospective: a control can vanish correctly while keyboard state still points
at it. The successor should match the task after the operation (choose a part,
or repair the source), and unsolicited storage events must not steal unrelated
focus. Next: move from recovery hardening back to construction effort; inspect
how existing branch-copy operations can reduce repeated left/right vehicle
assembly, with geometry and control signs verified before offering symmetry.
No push or deployment was performed.

## 2026-10-30 — Duplicate a branch on the opposite side

Goal: reduce repeated setup of symmetric vehicle parts. Added **反対側へ**:
select a branch and duplicate its reflection across the parent-local plane to
the opposite attachment edge, selecting the new branch. This is a single Undo
step. It swaps E/W or N/S throughout the branch, reverses Rudder/Trim angle
expressions and Wheel/RLW power, and swaps triangular Cowl options 3/4. Ordinary
fold angles and Jet/Arm power stay unchanged. Shared variables remain shared;
the original branch, scripts and unrelated text are preserved.

The operation rejects an occupied opposite edge, a named branch (existing copy
identity guard) and expression-controlled Cowl shapes. It does not rewrite Lua
numerical part references, invent new control variables or claim full RCD/RCM
editing parity. Help and README describe these boundaries.

Nine new document tests independently compare reflected position and orientation
for all four attachment directions, nested Rudder/Trim/Wheel/Jet/Cowl parts and
a folded parent. They also verify expression meaning/comments, control signs,
source/history preservation on rejected edits and Undo/Redo. A second driving
fixture makes both left wheels using this operation; the same physical straight,
left/right turn and release assertions pass as for individually constructed
wheels. Total: 115 tests pass; typecheck/build pass.

A new browser probe checks actual triangular Cowl mesh vertices under reflection,
selected duplicate, occupied-edge rejection, one-step Undo/Redo and runtime
wheel powers. Firefox/WebKit core-loop probes now build the opposite wheels
with the new UI, then drive, name/download, share and re-edit successfully.
Independent desktop/mobile image review confirms the new button and wrapped
controls are readable, the duplicate is selected, and the model fits. A partly
scrolled-off Core row does not hide the selected branch. WebKit 3D capture
limitations from Sprint 35 remain separate from its workflow assertions.

Retrospective: ordinary copying preserves control expressions, which makes an
opposite-side wheel drive the wrong way unless the user changes its sign. A
geometry-aware operation can remove both repeated construction and that manual
correction, but must be checked with physical trajectories and actual mesh
vertices as well as parsed text. Next: exercise a non-car creation example to
find gaps in assigning controls and testing a model, rather than extrapolating
one steering car to every kind of construction. No push/deployment performed.

Final regression: all 21 Chromium browser scenarios pass against the production
build, in addition to the Firefox/WebKit mirrored-car loops and 115 unit/
integration tests. No regression was observed in the covered save/share, input,
source history, camera, naming and recovery flows.

## 2026-10-30 — Assign independent keys for multiple control axes

Goal: stop assuming a steering car's two input axes cover an aircraft. Existing
GUI generation fixed all angle controls to left/right and all power controls to
up/down. The plane sample instead needs separate pitch, roll, yaw and thrust
bindings. Added ↑/↓, ←/→, Z/X and A/D choices for generated angle/power controls.
Existing defaults and their signs remain unchanged; generated symmetric controls
still return to zero on release. Recognized controls show their key pair in the
selector, and shared magnitude editing retains the chosen keys.

Ten new tests cover all four key pairs for angle and power, magnitude changes,
exact Undo/Redo, invalid-pair rejection and a seven-part control fixture with
separate pitch/roll/yaw/thrust. Simulation checks individual keys, simultaneous
inputs and releasing one axis while others stay held. Total: 125 tests pass.
These assertions establish control independence, not stable aircraft flight.

The new browser flow builds the fixture entirely through GUI operations, edits
strength, checks Undo/Redo, drives the separate controls with physical keys,
verifies W does not alias pitch when A/D are explicitly bound, presses/releases
the screen Z key, and shares the source to a fresh context with the exact key
bindings retained. Help documents that reusing a pair intentionally operates
several controls together. The browser scenario joins the default CI runner.

Retrospective: generating fresh variable names does not make controls independent
when the input keys remain shared. Verify simultaneous axes and partial release,
not only one changing value. A second gap remains: the existing plane throttle
accumulates input and holds its value, while these generated controls spring
back to zero. Next: make held throttle behavior configurable and test its bounds,
release behavior and separation from pitch, then assess actual aircraft motion.
This sprint does not claim a GUI-built airworthy airplane or physical fidelity
to the original. No push or deployment was performed.

Final validation: typecheck/build, all 125 unit/integration tests and seven
selected production browser flows (new key-pair scenario, help, options,
keyboard, mirror, Firefox and WebKit core loops) pass. Independent 320px image
review confirms Z/X remains readable in the selector even when the variable
name is truncated, and all eight screen keys fit in two rows with readable
labels. The full Chromium suite last passed in Sprint 37; this sprint reran
relevant scenarios rather than relabeling that older full run as current.

## 2026-10-30 — Add held throttle controls

Goal: keep thrust while releasing pitch/roll keys, instead of forcing every
GUI-generated output to return to zero. Power selectors now offer each key pair
with **を追加（保持）**. These generate a distinct ST_THROTTLE variable with zero
initial value, bounds [0, maximum], no automatic return, and equal increase/
decrease steps of 1% of the maximum per model frame. The first key increases;
the second decreases. Existing momentary controls and their defaults are
unchanged. Recognized selectors explicitly display the key pair and 保持.

Changing the shared maximum also scales the key increment while retaining zero
minimum and no return. Negative bindings remain available for a shared actuator
with reversed orientation. The generated schema is recognized narrowly; altered
release/rate definitions stay source-edited. A fresh run/share receiver starts
at zero; the current runtime throttle is not embedded in saved source.

Six new tests bring the total to 131: all four key-pair declarations and maximum
edits, source/Undo preservation, collision-safe naming, rejection of altered
schemas, actual simulation accumulation/hold/upper and lower clamps, partial
release with independent pitch, and fresh simulation reset. The browser probe
builds the controls through GUI, changes maximum with Undo/Redo, tests physical
and screen-key holding, independent pitch, shared-source equality and restart
zero. It joins the default runner (now 23 Chromium scenarios).

Validation: all 131 tests and build pass. Production Chromium throttle, key-pair,
help and mirror probes pass. The same throttle scenario passes in development
Firefox and WebKit. Independent 390px review confirms Z/X and 保持 are fully
readable beside maximum 2000 with no control overlap; the variable suffix is
truncated. Part of the test model is outside the current camera framing, so
this image is UI evidence, not a complete-model framing or flight claim. The
known Windows WebKit 3D capture limitation remains open.

Retrospective: a control's behavior on release is part of the design, not merely
an input binding. Holding a value must survive release without leaking into
other axes, but initialization still comes from the source's defaults. Next:
use these controls in a complete aircraft construction and measure actual
motion, separating missing editor operations from flight-model or sample-design
issues. No claim of airworthiness or original-engine equivalence is made here.
No push or deployment was performed.

## 2026-10-30 — Measure flight and repair the sample's control geometry

Goal: move beyond changing control values to measured aircraft motion. The
existing plane lifted off under neutral controls but pitched through a large
arc and crashed. Surface-normal inspection showed its elevator deflected the
two tail surfaces oppositely, while its ailerons deflected together. The vertical
fin also faced the forward airflow, and its Rudder rotated within that plane
without changing its normal. These are sample construction errors under the
current simulator's joint conventions, not evidence requiring physics retuning.

Corrected the E-side aileron/elevator expression signs. Replaced the vertical
fin mount with a 90-degree Trim and its moving surface with a Chip hinge. The
neutral fin now lies along forward travel; its hinge rotates about the vertical
axis. Left/right inputs now roll on the intended side, and A/D produce opposite
yaw. No physics constants or integration behavior changed.

Controls were compared from the same airborne state: all model bodies shifted
20m up with 30m/s forward velocity. Over 0.5s, neutral pitch change fell from
about 40 degrees to 0.7 degrees. Opposite pitch keys produce angular velocities
roughly -0.68/+0.34 rad/s about X; roll about Z is roughly +1.31/-1.31; yaw about
Y roughly +0.33/-0.33. The regression checks axis response and unwanted coupling
with tolerances, not exact snapshot floats. At six seconds in ground-start
simulations, neutral controls keep height below 2m; pulling up from five seconds
raises height above 3.5m. Continuous pull-up can loop the aircraft; stable cruise
and broad flight-envelope behavior are not established.

Validation: four new tests bring the total to 135; all pass, as does build. The
production Chromium probe reaches height 3.66m at tick 178 with position
[-50.19,3.66,-131.79], verifies source remains unchanged and downloads exact bytes.
An initial probe waited only for the editor to close and read a null simulation;
fixed the test to wait for actual simulation initialization. Independent image
review confirms full model framing, selected tail readability and visible
separation from the ground. `bun run test:plane` and a separate CI step retain
this check without conflating it with generic editor flows. Remote CI has not run.

Retrospective: input names and successful takeoff are weak evidence for intended
control axes. Inspect surface normals and isolate angular response before tuning
physics. The investigation also exposed two editor gaps: angle bindings cannot
be reversed through the selector, and Chip hinges have no angle-control row.
Next: expose those operations, then reconstruct this corrected aircraft through
editor operations and verify the full build/control/fly/save loop. This sprint
repairs the reference sample; it does not claim that the complete aircraft was
already built through the GUI. No push or deployment was performed.

## 2026-10-30 — Build and fly the aircraft through editor controls

Goal: close the editor gaps exposed by the corrected plane sample. All non-Core
parts can now bind angle controls, including Chip hinges. Angle selectors offer
both normal and reversed bindings, preserving shared strength editing and Undo.
Three tests verify reversed bindings/history, the Chip rudder's actual vertical
axis after a Trim mount, and rejection of missing/arbitrary expressions. Total:
138 unit/integration tests pass.

Initially showing angle controls for every part pushed the add-part row outside
the narrow panel; the existing general-editor probe caught this. Fixed-angle
parts now reveal the row through **操作** beside their angle. Rudder/Trim and
parts already using an expression show the setting by default on selection.
The disclosure is keyboard-operable and exposes aria-controls/expanded state.
An independent review found the initial button too small: measured height was
16.4px. Expanded it to 44x28px; measured 32px height would clip the existing add
row at 390x844. The final size keeps that row inside the panel. This is a local
layout improvement, not a blanket touch-accessibility certification.

A new browser scenario reads the corrected plane as a construction blueprint,
then starts from a blank Core and uses only GUI part/angle/colour/control
operations to recreate all 30 parts. It compares every neutral preview position
and quaternion with the reference. Generated controls use the new independent
key pairs and held throttle; the source is never pasted into the editor to bypass
construction. The sample's Lua HUD is not copied, and generated momentary control
rates differ from the sample's gradual rates, so this is geometry/workflow
reconstruction rather than byte-for-byte model reproduction.

The constructed aircraft takes off (measured core position about
[-50.61,3.57,-118.71]), exports exact 1,218-byte source as GUI飛行機.rcd, opens that
source in a fresh shared-link context and edits the Chip rudder's strength there.
`test:plane` now runs both the sample and GUI-construction scenarios. The earlier
sample test remains distinct from proof of constructing a model through the UI.
Independent desktop/narrow image review confirms selected tail, A/D binding and
settings readability; small model details still require zooming.

Retrospective: exposing a capability and making it reachable without displacing
common actions are separate requirements. The old overflow assertion identified
a real regression and was retained. A complete construction-to-flight scenario
also closes more gaps than testing each selector alone. Next: assess editability
of more complex imported models and the remaining source-only boundaries, using
actual round trips rather than extrapolating cars and this one aircraft to all
models. No stable-cruise or original-engine fidelity claim is added. No push or
deployment was performed.

Final validation: full 23-scenario Chromium suite passed before the final button
size adjustment. After that adjustment, rebuilt and passed general-editor
(including the original no-scroll add-row bounds), keyboard disclosure, GUI
plane construction/flight, Firefox and WebKit core flows. Independent re-review
of the final 390px image found no new overlap/clipping around the enlarged
button, numeric input, A/D selector or direction controls. The 138-unit baseline
covers the unchanged document operations; the final UI behavior is covered by
the browser checks. Windows WebKit 3D screenshot limits remain as previously
recorded; its state assertions do not replace visual acceptance.


## 2026-10-30 — Many-control selection and scripted model preservation (Sprint 42)

Goal: test editing beyond small vehicle fixtures. Selecting a part repeatedly
parsed the entire source while producing generated-control labels. Cache control
metadata for the exact current source and index key bindings once; source edits,
Undo/Redo and restore invalidate it naturally. Altered or duplicate declarations
remain source-edited rather than offering ambiguous strength changes.

On the same synthetic 101-part/100-control fixture (11,995 bytes), five synchronous
selection-handler measurements changed from a median 311.6ms to 7.9ms. These are
local dispatch durations, not frame rates or a universal performance guarantee.
The permanent browser probe uses named parts and reports timing without a
machine-dependent threshold; its final median was 8ms. It also checks strength
changes, Undo/Redo and rejection of named-branch copy/mirror.

The existing Walker Lua model is imported, one colour token is edited, and the
whole source is compared with the expected single-token substitution. Download
bytes and reopening match exactly, with no script error. This is evidence for
this scripted fixture, not an audit of external community models.

Validation: 141 tests in 17 files, production build and the new scale probe pass.
Control-key, held-throttle and source-history browser probes also passed during
this sprint. Unit tests assert one parse for repeated metadata queries, cache
refresh after direct edits/history/restore, invalid-source recovery, and refusal
of altered or duplicate declarations in either order. Added test:editor:scale
and a separate CI step; remote CI has not run. Existing build-size/wasmoon
warnings remain. No push or deployment was performed.

Retrospective: repeated work inside option rendering was measurable before any
renderer optimisation was needed. Keep performance fixtures separate from exact
source-preservation checks. The initial benchmark attempted to fill the source
field at 1280x720 and timed out on visibility; importing the fixture at 1280x1000
made measurement possible. That timeout is not evidence of parsing cost. Next:
inspect source-editor reachability at shorter viewport heights and distinguish
intentional collapsed state from actual layout obstruction.


## 2026-10-30 — Keep source text readable in short viewports (Sprint 43)

Goal: investigate the source-fill timeout encountered during Sprint 42. A fresh
1280x720 session has a 192.6px source field and accepts real clicks; 1280x600 has
121px. The previous desktop timeout was not reproduced and its cause remains
unresolved. Do not attribute it to the mobile issue found in this investigation.

At 320x568 the source field was only 20px high, entirely occupied by vertical
padding: an element could be clickable while exposing no readable text area.
The editor grid now reserves 58px (two 18.85px text lines plus padding) for source
and lets the builder track shrink and scroll. Narrow edit-row margins decrease
from 6px to 3px to retain the existing no-scroll power/add controls at 390x844.
The first reservation failed that existing assertion; a 4px margin attempt still
left the add selector 3px below the builder. Measured actual rectangles before
choosing 3px, rather than assuming all adjacent margins add independently.

A permanent Chromium scenario covers 1280x720, 1280x600, 390x844 and 320x568:
readable line area, viewport/hit-test bounds, real click/typing/Undo, source
visibility during parse errors, recovery and adding another part through the
scrolled builder. Added it to the default editor runner (now 24 scenarios).
The same scenario passes Firefox and Windows WebKit against the dev server.
Production build and targeted Chromium short-height/general/source-history/
draft-recovery probes pass; no unit logic changed. Full 24-scenario execution
and actual mobile software-keyboard behavior were not tested in this sprint.

Retrospective: visibility and clickability are insufficient evidence of readable
editing space. Reserve space for text content and verify neighboring workflows;
retain the regression test when it exposes a real layout tradeoff. The test's
first Undo expectation also incorrectly grouped Enter and later typing; removed
the unnecessary Enter from this visibility scenario, preserving existing history
semantics. Next: examine where imported models still force source editing and
whether the UI explains those boundaries accurately. No push or deployment.

Independent final image review found no overlap or clipping of the add/power
controls at 320x568 and 390x844. At 320 the visible source lines are complete;
at 390 a third line is partially visible below the two-line reserved area and
long unwrapped lines extend horizontally. Source remains a scrolling textarea;
this change guarantees readable content space, not that every visible fragment
or complete model fits without scrolling.


## 2026-10-30 — Explain and reach source-only attributes (Sprint 44)

Goal: inspect the editing boundary for imported expressions. Custom angle and
option fields had only hover titles, while custom power had no explanation;
colour's note lived inside its disclosure. Disabled controls therefore did not
provide a reliable route for touch/keyboard users.

For selected attributes whose numeric/colour GUI editor is disabled, the builder
now shows labelled source-edit buttons (angle, power, the type-specific option
label, colour). Clicking selects the exact parser-recorded attribute range,
focuses the textarea and scrolls to its line/column without modifying source.
Buttons are absent for normal editable values and cleared for invalid source or
a newly selected part without those fields. This does not rewrite custom control
definitions or extend the generated-strength editor to arbitrary expressions.

The new browser fixture imports a Wheel with four expressions, a long indented
line and 25 preceding comments. It checks all four exact selections, unchanged
source during navigation, vertical/horizontal scroll, a selected-expression edit,
Undo, stale-hint clearing on Core selection/invalid source and exact export.
Chromium production preview, Firefox and Windows WebKit dev-server runs pass.
Added the scenario to the default editor suite (now 25 scenarios). 141 unit tests,
production build and targeted general-editor, short-height, source-history and
caret probes pass. Full 25-scenario execution and real mobile keyboards were not
retested. Existing build warnings remain; no push or deployment.

Independent image review at 390x844 found all four labelled buttons readable in
two rows, no overlap with add/power controls, and the selected P*2 expression
visible. The scrolled builder clips earlier rows at its upper boundary, as a
scrolling region; this is not a claim that all settings fit simultaneously.

Retrospective: a disabled field plus a hover title is not a complete editing
path. Explain the specific field and take the user to its existing source;
verify navigation is non-mutating and history still works after hand-off.
Next: exercise the combined creation/edit/save loop with imported multi-branch
models, especially selection and history after structural edits rather than
adding further isolated presentation tweaks.


## 2026-10-30 — Combined branch editing and history (Sprint 45)

Goal: exercise structural operations in combination rather than extrapolate from
isolated buttons. A seven-part imported fixture includes nested branches, custom
Val control, a coloured untouched branch, comments and Lua. Through GUI actions,
copy the north branch to the south, add a generated wheel control, change its
strength, delete the original north subtree and mirror the copied south branch
back north. The final model has ten parts.

At every step, assert part count/type, selected highlight, untouched branch and
Lua preservation. Undo all five mutations and compare the exact source and
selected part with each pre-edit snapshot; redo restores every text state and
the final selection. Then run, verify 1500 power while holding Up and release to
zero, return to editing, export exact bytes and open a fresh shared-link context
at 390x844. That receiver edits the shared wheel strength and undoes it exactly.
The production-preview scenario passed without requiring application changes.
It is now part of the default editor runner (26 scenarios).

Retrospective: the combined branch workflow provides stronger evidence than
isolated controls, but still covers one constructed fixture. No arbitrary-model
or physical-stability claim follows. No defect was found in this scope, so this
sprint adds durable regression coverage rather than inventing a product change.
Next: inspect model import/runtime failure handling, particularly recovery to an
editable model after a script or unsupported-content failure. No push/deployment.


Final validation: the entire 26-scenario Chromium production-build editor suite
completed successfully, including the new combined branch workflow and recent
short-height/source-help additions. The production build is the successful
Sprint 44 build; Sprint 45 changes only probes/documentation. This local full run
does not establish remote CI or Firefox/WebKit full-suite coverage.


## 2026-10-30 — Recover from long Lua errors without losing the UI (Sprint 46)

Goal: verify repair/restart after import and runtime failures. A real OnFrame
Lua error containing a long unbroken token exposed a layout defect: at 320x568,
a 952-character diagnostic expanded the document and source to 6,211.5px wide.
The side grid's intrinsic width and unbreakable diagnostic displaced controls.

Allow the side panel to shrink, wrap diagnostic tokens anywhere, and cap its
height at min(15dvh,160px) with internal scrolling. The error footer is keyboard
focusable with a visible outline and an accessible label; when empty it is
invisible and absent from keyboard navigation. The same error now leaves the
viewport/document at 320px, with a 62px source field and 85.2px diagnostic region.
No diagnostic text is truncated in storage or DOM.

A permanent browser scenario triggers long OnInit and OnFrame errors, checks
viewport bounds and full message retention, scrolls using PageDown and returns
to the beginning using Home, repairs source through the builder and reruns.
It also verifies restart clears held input and a missing-Body load failure can
be repaired. Chromium production-preview, Firefox and Windows WebKit dev-server
runs pass. Production build, load-lifecycle and short-height regression checks
pass. No simulation/unit logic changed; the previous 141-unit baseline was not
rerun for this CSS/HTML change. Full default suite is now 27 scenarios; only the
relevant scenarios were rerun this sprint. Increased its CI allowance from five
to seven minutes because the preceding 26-scenario local run approached five
minutes; individual scenario timeout remains 120 seconds. Remote CI not run.

Retrospective: successfully displaying an error is insufficient if its content
can displace the recovery controls. Use actual script errors and measure the
whole viewport, then prove repair through the normal UI. Mid-scroll screenshots
naturally show partial first/last lines; distinguish this from inaccessible text
by testing keyboard return to the beginning. Next: inspect whether failure
messages distinguish unsupported model content from malformed source rather
than silently accepting content the simulator cannot represent. No push/deploy.

Independent final image review confirmed the diagnostic beginning is readable
after Home, wraps within the viewport, and the focus outline does not overlap
text. Source and top controls remain in separate visible regions.


## 2026-10-30 — Stop substituting unknown parts (Sprint 47)

Goal: inspect whether unsupported model content is silently accepted. Assembly
used TYPES[type] ?? TYPES.chip, so an unknown spelling such as Wheeel acquired
Chip physics instead of producing a diagnostic. It could appear to load while
representing different hardware. Inherited JavaScript object properties were
also not excluded by that lookup.

Require an own entry in the supported type table before creating a tile. Unknown
types now produce a Japanese diagnostic containing the original spelling and
source line. Parsing still preserves the source and ranges, allowing repair;
this is not a parser rewrite or a claim that every unsupported feature is now
identified. Unknown top-level sections and unconsumed attributes need separate
analysis; their behavior is unchanged.

Validation: 146 tests in 18 files and production build pass. Five new cases cover
Wheeel/constructor/toString/__proto__ rejection without mutating parsed content,
and case-insensitive assembly of every supported type. A production-browser
scenario imports an unknown.rcd, checks the explicit line-3 error and unchanged
source, repairs only the spelling, undoes/redoes it, runs a real Wheel and saves
exact corrected bytes with the imported filename. The prior long-error/recovery
scenario also passes. Added the new case to the default runner (28 scenarios);
full suite and non-Chromium runs were not repeated this sprint.

Retrospective: permissive parsing and silent semantic substitution are distinct.
Retain source for repair, but do not invent a supported part for an unknown name.
This is one bounded compatibility diagnostic, not proof of full compatibility.
Next: inspect the stale visual state left after failed assembly so users do not
mistake the previous model for the rejected one. No push or deployment.


## 2026-10-30 — Remove stale model visuals after failure (Sprint 48)

Goal: check whether a failed model is visually confused with the previous one.
After running a source containing Unknown(), simulation was null and the error
was visible, but all 19 previous vehicle meshes remained. This was a display
lifecycle defect, not evidence that the unsupported part had assembled.

Add SceneView.clearModel using existing rebuild/disposal behavior. Starting a
load clears the prior model and HUD; a current failed load also clears any
partial rebuild. Rebuilds clear transient 3D lines/projectiles, and an invalid
editor refresh clears the old preview instead of retaining it. Environment
geometry remains. Valid source or Undo reconstructs the preview normally.

A browser scenario reproduces real unsupported-part failure and checks zero
model meshes, hidden transient lines/projectiles and cleared HUD. Transient
drawings are seeded through scene hooks to isolate cleanup; this is not an
end-to-end cannon firing test. It also checks invalid-source Undo recovery and
a delayed older start rejection after the user returns to editing: disposal
completes without clearing the newer preview or replacing its status.
Production build, new failure-view, load lifecycle, unsupported-part repair and
source-history scenarios pass. Added the scenario to the default suite (29).
Independent 390px image review confirms no old vehicle, readable source/error
and controls within the viewport; environment objects are still present.

Retrospective: an error message cannot by itself disambiguate stale visual
content. Reset model visuals with the request lifecycle, while guarding late
callbacks so they cannot erase the user's newer work. Next: review unsupported
sections/attributes with concrete examples and decide whether they require an
explicit warning or implementation. No push or deployment.

Final targeted general-editor and reflected-geometry browser checks also pass.
The full default suite and unit baseline were not rerun for this scene-lifecycle
change; validation is the build and listed browser scenarios.


## 2026-10-30 — Report ignored sections without rejecting readable models (Sprint 49)

Goal: distinguish genuinely ignored content from data consumed elsewhere.
Attribute-only allowlists would be incorrect: _GET falls back to attributes,
and an actual Lua fixture reads USER1=7. Unknown top-level sections, however,
were discarded by parseRc without a diagnostic. Known aliases and Lua precedence
must retain their behavior.

RcModel now carries warnings for unknown top-level sections with original name
and line number. Runtime and editor show these as non-blocking diagnostics;
known model content still runs, unknown source remains intact for editing and
export. Comments and script strings do not create spurious sections. Copy keeps
the model warning visible. Script failures and draft-storage failure messages
are appended rather than hidden behind the warning; the footer label now covers
both warnings and errors. No blanket attribute rejection was added.

Validation: 148 tests in 19 files and production build pass. Parser/document
cases cover names/lines, multiple sections, nested braces, comment/string false
positives, Var alias/Lua precedence and exact preservation through edit/Undo.
A production-browser scenario runs USER1 access with a Metadata warning, edits
and exports exact bytes, checks warning persistence after copy, injects a storage
failure and triggers a real Lua error, then verifies a clean reload clears the
warning. Existing long-error/recovery probe passes. The default suite now has
30 scenarios; full suite/non-Chromium runs were not repeated in this sprint.

Retrospective: source preservation, execution support and diagnostics are three
different promises. Inspect consumers before classifying attributes, and avoid
rejecting an entire useful model merely because it carries an ignored block.
Warnings must not suppress a more actionable failure. Unknown text outside
recognised section syntax and attribute semantics remain outside this check.
Next: review construction control conflicts and whether shared controls can be
separated without hand-editing source. No push or deployment.

Independent image review confirms both Metadata warning and Lua failure are
readable within the 390px footer without overlapping controls. The unwrapped
source is horizontally scrolled in this capture; full source-line visibility is
not claimed by the diagnostic review.


## 2026-10-30 — Separate one field from a shared generated control (Sprint 50)

Goal: adjust one part's strength without manually rebuilding its shared control.
Adding a new control could achieve independence but required reselecting keys,
reversal and hold mode. Recognised generated controls now offer
「この部品用に分ける」in the angle/power selector. It creates a fresh definition,
changes only the selected field's binding, preserves key pair, initial strength,
sign and return/hold semantics, and creates one Undo step. Original definitions
remain because other parts or scripts may use them. It keeps the same physical
keys; it does not assign independent keys or rewrite script references.

The shared insertion routine accepts a validated template for this operation.
This preserves even cross-bindings (e.g. a generated power variable bound to
angle), rather than assuming control kind from the target field. Arbitrary or
modified controls still require source editing.

Validation: 155 tests in 20 files and production build pass. New cases cover
steering/momentary power/held power bound to either field, positive/reversed
bindings, exact definition/key copying, original strength preservation, one-step
history and refusal of custom expressions. A production-browser flow separates
reversed angle and held-power bindings, edits strengths, exercises Undo/Redo,
runs real A and Z input, verifies independent 30/15 angle magnitudes and 1000/500
held values, and exports exact source. The default suite now has 31 scenarios.

Retrospective: creating a new control and separating an existing one have
different preservation requirements. The latter must inherit current semantics,
including reversal and held behavior, rather than reset to UI defaults. Existing
references prevent automatic cleanup of old definitions. Next: verify control
configuration discoverability and keyboard operation in the complete builder,
including how users learn that strength is shared before choosing separation.
No push or deployment.

Existing independent-control-key and held-throttle browser probes also pass.
Full default suite and non-Chromium runs were not repeated this sprint.


## 2026-10-30 — Explain shared strength and keyboard separation (Sprint 51)

Goal: make the new separation operation understandable alongside the existing
「共通」strength labels. The help guide now explains that changing a shared
maximum affects parts using the same variable, how to separate one field before
adjusting it, and that key pair/reversal/hold behavior remain unchanged. It also
states that choosing different keys requires adding an operation on those keys.
No additional persistent builder rows or layout changes were introduced.

The guide browser probe checks the explanation and retains its 390/320px bounds,
Escape/close focus return and source-preservation checks. The existing separation
scenario now reaches angle and power selectors using Tab from their inputs and
uses the native End key to choose the separation option, rather than programmatic
selectOption. The complete strength/history/live-input/export flow still passes.
Production build and both targeted Chromium probes pass. Unit/model code is
unchanged, so the 155-unit baseline and full browser suite were not rerun.

Retrospective: separating definitions and separating physical keys are distinct
operations; documentation must not imply one does the other. Keyboard reachability
is demonstrated through actual focus traversal, but this is not a user study of
discoverability. Next: revisit the full build/play loop with the latest control
and diagnostic changes, including cross-browser checks rather than continuing
to accumulate isolated UI changes. No push or deployment.

Independent 390px image review found the shared-strength paragraph fully
readable and all four distinctions explicit, without overlap or clipping.


## 2026-10-30 — Integrated build/play verification (Sprint 52)

Goal: revalidate the accumulated editor/control/diagnostic changes together.
Started from clean commit 62ea700. 155 unit/integration tests in 20 files and a
fresh production build pass. Firefox 157.0 and Windows WebKit 27.2 each build a
seven-part vehicle, drive/release, save a named 458-byte file, share to a fresh
context, edit at narrow width and reopen the file. Distances in these runs were
3.86m and 4.03m respectively; these are workflow observations, not browser
performance rankings. WebKit audio remains unavailable with graceful fallback.

Both plane scenarios pass: the corrected sample takes off at tick 178, and the
GUI-created 30-part aircraft takes off, saves 1,218 bytes, shares and re-edits.
The 101-part/100-control scale probe passes strength/history/named-branch guards
and the Lua exact-byte colour round trip; median synchronous selection duration
was 8.3ms on this host. These scenarios do not establish steady flight, arbitrary
model compatibility, real mobile keyboard behavior or Apple Safari rendering.

Documentation audit found an outdated README sentence still listing mirroring
as unimplemented despite its earlier implemented-feature paragraph. Removed
that contradiction and clarified that the remaining key-mapping gap is arbitrary
key selection, beyond the existing four key-pair choices.

Retrospective: integrated workflows remain the meaningful checkpoint after a
series of small fixes. Tests and feature documentation can drift independently;
read the unsupported-feature list against actual implemented paths. Do not
substitute a passing workflow for full original-engine fidelity. No push/deploy;
remote CI and production still do not contain these local changes.


Final result: all 31 default Chromium scenarios completed successfully on the
fresh build, including new unknown-section/type diagnostics, failed-view cleanup,
shared-control separation, multi-step branch history and failure recovery. The
same run also completed the two browser portability loops, two plane scenarios
and scale scenario described above. No application change was required in this
sprint. Windows WebKit's known 3D screenshot limitation still prevents claiming
full visual parity with Apple Safari. Next: assess extending control assignment
beyond the four preset key pairs, starting from concrete construction needs and
preserving existing shared/reversed/held behavior.


## 2026-10-30 — Choose arbitrary two-key controls (Sprint 53)

Goal: remove the four-preset limitation when constructing independent mechanisms.
Angle and power selectors now offer a dialog choosing any two distinct keys from
the existing 17-key input table; power also offers held mode. Existing presets
remain. The dialog states signed direction/hold semantics and warns that reusing
a physical key moves multiple controls together. Cancel leaves source/history
unchanged; invalid identical choices stay in the dialog. Source changes while
it is open are rejected at submit rather than applying to a stale selected part.

Generated-control recognition now derives the ordered pair from valid signed
increments and validates key numbers, rather than requiring one of four presets.
Custom controls retain labels, magnitude edits, reversed bindings, separation
and Undo/Redo. Separation preserves the original pair. Arbitrary modified control
curves still remain source-edited; this is creation of two-key controls, not an
editor for every possible Key declaration or an in-place key reassignment tool.

Validation: 158 tests in 21 files pass, including all 272 ordered distinct pairs,
invalid/out-of-range/fractional keys, and custom held-control separation/history.
The browser scenario creates Q/E angle and C/V held output through the dialog,
checks cancel/focus and duplicate-key refusal, drives the actual controls,
undoes/redoes creation, separates a custom binding and exports exact source.
Chromium production preview, Firefox and Windows WebKit dev-server runs pass.
Existing separation and preset-control browser probes pass. Default runner now
has 32 scenarios; full suite was not rerun this sprint. Independent 320px image
review found the directions, values and both action buttons readable without
clipping. Build warnings remain unchanged.

Retrospective: preset selection and arbitrary pair creation can share the same
validated model operation. Recognition must evolve with creation, otherwise a
newly generated custom control would immediately lose GUI editing. The initial
cancel-focus assertion ran before the asynchronous dialog close event; changed
it to await the actual focus return, which passes on all three engines. A field
change also clears old validation text. Next: check custom control ownership and
conflicting assignments in more complex models, without silently reassigning
other parts. No push or deployment.


## 2026-10-30 — Show existing key assignments before adding controls (Sprint 54)

Goal: make intentional simultaneous controls distinguishable from accidental key
reuse. The custom-key dialog lists existing Key-section variable assignments for
each selected key, updates on selection changes and deduplicates names. It does
not block reuse or change old bindings. Empty entries say no Key definition,
not globally unused; script polling and implicit WASD arrow aliases are explicitly
excluded. Diagnostics use textContent and wrapping for arbitrary variable names.

A browser fixture has C assigned to OLD and OTHER. The dialog shows both, updates
when selecting Q, and cancels without modifying source. Adding C/V then preserves
the original Key text and actual C input drives OLD=100, OTHER=50 and the new
power=1000 simultaneously; release returns the momentary controls to zero.
Production build, the usage scenario and the full custom-key creation scenario
pass. Independent 320px image review confirms usage names, scope disclaimer and
action buttons fit and are readable. No model logic changed, so the previous
158-unit baseline and full suite were not rerun. Default browser suite now has
33 scenarios; non-Chromium runs were not repeated for this display addition.

Retrospective: key reuse is not inherently a conflict; it is how linked mechanisms
can be controlled. Expose the existing assignments and preserve intentional
sharing, while making the limits of static inspection explicit. Next: inspect
construction operations that still require manual source changes, prioritising
moving or reorganising existing branches over adding more isolated controls.
No push or deployment.


## 2026-10-30 — Relocate an existing named branch (Sprint 55)

Goal: reorganise a model without copy/delete and accidental name duplication.
The new 接続先 disclosure opens a parent/direction dialog for the selected
subtree. The operation preserves names, internal comments, attributes, controls
and scripts, applies one source transaction and selects the moved branch. A
same-parent direction change edits only its direction character and preserves
order. A different parent receives the branch as its last child. Local attributes
are preserved, not world-space pose. Declaration/chip numbers can change, and
the dialog explicitly states numeric script references are not rewritten.

Core roots cannot move; self/descendant targets are omitted and also rejected by
the document operation. Occupied destinations are refused without edits/history.
An unchanged destination adds no document history. Stale source while the modal
is open is rejected. Names can move safely because this relocates, not duplicates.
The move operation is placed below common fields rather than adding a toolbar
row that displaces existing add controls.

Validation: 163 tests in 22 files and production build pass. New cases cover
forward/backward source moves, leaf-parent brace insertion, same-parent direction,
no-op history, self/descendant/occupied/root guards, exact Undo/Redo, and transfer
between separate Core trees. The browser scenario moves a named Frame/Wheel
subtree under TARGET, checks eligible parents and refusal/cancel, verifies selected
identity through history, runs with the new parent relationship and exports exact
bytes. General-editor and selection probes pass. The final move/guide checks
pass after confining rejected-move errors to the modal; earlier background error
text identified during image review was removed. Independent 320px review found
the destination, limitations and buttons readable without clipping.

Retrospective: relocation must be one transaction and preserve identity, while
being honest about transformed poses and reordered numeric IDs. Reusing copy
would wrongly reject named parts and create different failure/history semantics.
The full browser suite was not rerun; default runner now includes 34 scenarios.
Next: verify branch relocation with live control bindings and shared-link
round trips, especially numeric versus named script references. No push/deploy.


Portability follow-up: Firefox passed the full move scenario. Windows WebKit
initially timed out waiting for focus after Escape in three runs, while smaller
state probes observed a closed dialog and correct move-button focus. Timer-based
polling alone did not resolve it. Adding failure-state logging and a bounded
focus wait produced two consecutive full WebKit passes; Chromium production
also passes that probe. The intermittent WebKit focus result is not considered
root-caused or fixed. Failure diagnostics remain in the test; avoid claiming
reliable Apple Safari behavior from these results. A future check should capture
focus/cancel/close event ordering on a failing run rather than assume a rendering
or application cause from the timeout alone.


## 2026-10-30 — Isolate early Escape delivery in Windows WebKit (Sprint 56)

Goal: resolve the intermittent cancellation observation left by Sprint 55.
Twelve fresh WebKit pages reproduced seven failures. In instrumented failures,
Escape keydown/keyup reached move-parent but no cancel or close event fired;
the dialog remained open. Successful cases emitted cancel, close and then focus
on move-branch. This contradicts the initial interpretation as wrong focus
restoration: cancellation itself had not occurred.

A minimal native HTML page containing only a button, dialog and select reproduced
8/12 failures when Escape followed opening immediately. Waiting two animation
frames after opening yielded 0/12 failures on that same minimal page. Applying
that pre-input wait to SnapTiles yielded 12/12 successful cancellation/focus
checks across fresh pages, half with event logging. This isolates a timing-sensitive
native WebKit interaction in this environment; it does not prove a universal
Safari defect or precise browser-internal cause.

Keep the minimal reproducible diagnostic in tools/webkit-dialog-diagnostic.mjs.
It reports counts rather than asserting that immediate-input failures must occur.
Move and custom-key probes now wait for presentation before sending Escape.
Product event handling is unchanged: no forced focus, manual Escape interception,
retry Escape, or skipped focus assertion was introduced. Failure-state logging
remains in the move test. The native early-input case still exists; this change
makes the intended post-presentation user workflow the regression test.

Retrospective: a timeout names the unmet condition, not its cause. Record whether
the dialog is still open, then remove the application before modifying its event
handlers. A shorter wait accidentally passing was not a fix; the minimal control
and repeated settled-input trials provide the useful evidence. Unit/build outputs
are unchanged from Sprint 55. No push/deployment. Next: return to branch relocation
with controls and named versus numeric script references through saved/shared
models, preserving the documented limits on numeric references.

Final validation: complete move and custom-key workflows pass in Windows WebKit
against the dev server and Chromium against the existing production build with
the settled-input probes. Full suite was not rerun for this test-only change.


## 2026-10-30 — Move scripted branches through save and share (Sprint 57)

Goal: verify that relocation preserves named control bindings through actual
file and shared-link round trips. Added editor-move-script-probe.mjs to the
production-preview suite (35 scenarios). Product code is unchanged.

The fixture reads USER1 through BRANCH by name and through numeric index 1.
Both initially return 11. After moving the named Frame/Wheel subtree under
TARGET, BRANCH still returns 11, while index 1 returns TARGET's 99. Lua remains
byte-for-byte unchanged. This verifies the documented numbering limitation;
numeric references are deliberately not rewritten. Actual C press/release
produces wheel power 700/0 without script errors after moving, sharing to a
fresh 390px browser context, and reopening the downloaded file. The receiver
can then edit power to 500 and operate the same named wheel.

Validation: Chromium production-preview probe passes. Undo/Redo restores exact
source; exported bytes and named-move.rcd filename match; fresh shared and
reopened sources match. Reopen waits for a different simulation instance as
well as expected outputs, preventing matching old state from passing the test.
No browser page errors. The fixture covers one named tree and one numeric
reference, not arbitrary script equivalence.

Retrospective: preserving script text is necessary but insufficient evidence
of preserved meaning. Observe named identity and numeric ordering separately,
and prove that a file was actually reloaded before checking identical values.
Next: run the accumulated editor regression suite with a fresh build. No push
or deployment.


## 2026-10-30 — Accumulated editor regression checkpoint (Sprint 58)

Goal: validate the accumulated editor changes together, against a fresh
production build at 423acdf, rather than infer integration from targeted passes.
No application or test behavior changed in this sprint.

Validation: all 163 unit tests in 22 files pass. Type checking and production
build pass, retaining the existing wasmoon externalized-module and large-chunk
warnings. All 35 default Chromium editor scenarios pass in one uninterrupted
run (exit 0), including source/history, file/share/draft recovery, unsupported
content and failed-view cleanup, narrow layouts, mixed input, branch copy,
mirror and relocation, named/numeric script round trips, generated controls,
custom keys and held throttle. Raw local output: .shots/sprint58-editor.log.

Retrospective: individually passing new scenarios do not establish that the
accumulated application still supports its complete creation loop. This fresh
checkpoint supplies that evidence within Chromium. It does not establish
original-engine parity, physical mobile usability, current Firefox/WebKit full
coverage, or production deployment. Separate plane/scale/other-engine suites
were not rerun because this checkpoint targets the accumulated default editor
suite; their prior evidence remains dated to its own sprint.

Next: check relocation beneath transformed parents, comparing the intended
local attachment and preview/runtime geometry rather than assuming unchanged
world-space pose. All changes remain local; no push or deployment.


## 2026-10-30 — Relocation under a folded parent (Sprint 59)

Goal: check the geometry of relocating a branch beneath a transformed parent.
Extended the existing move browser scenario with four directions under a Frame
folded 90 degrees north. Expected coordinates are independently stated: parent
center (0,-0.3,-0.3), local north/south pointing down/up, and a nested south-facing
90-degree wheel whose rotation cancels the parent's fold. Assertions compare
positions relative to Core to remove the preview's ground-clearance translation.

Validation: Chromium production-preview move scenario passes for all four
edges. The moved branch and nested wheel positions/quaternions match the
independent coordinate oracle within 1e-6; runtime assembly rest poses match
the preview. Exact source and preview poses return on Undo/Redo, and selection
stays on BRANCH. This checks construction/rest geometry, not moving joints under
load or preservation of previous world pose. No product defect was observed.

The first test attempt used Tab to leave the source, accidentally inserting a
tab through its intentional indentation handler. The exact-source Undo assertion
caught this. Shift+Tab uses the documented exit gesture; the rerun passes.

Retrospective: comparing preview and runtime alone can miss a shared geometry
error. A hand-calculated right-angle fixture supplies an independent reference,
while source history assertions also catch unintended test interactions. No
application code changed, so the Sprint 58 build/unit/full-suite evidence remains
applicable; only the extended move scenario was rerun. No push/deployment.
Next: improve identification of parts while building larger models, evaluating
how to assign names without silently breaking existing script references.
