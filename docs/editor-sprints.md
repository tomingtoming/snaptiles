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
