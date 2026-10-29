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
