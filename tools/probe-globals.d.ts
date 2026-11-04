// Types for `tsc -p tools` (bun run check:tools): the page's probe hooks (src/main.ts) are typed exactly, so a probe
// that reads a field the simulation no longer has fails the check. The probes poke the DOM loosely (inputs, dialogs,
// canvases found by id), so element lookups are untyped here; that looseness stays in this check only.
import type { RustSimulation } from '../src/sim/rust-simulation';
import type { SceneView } from '../src/render/scene';

declare global {
  interface Window {
    __sim: RustSimulation | null;
    __scene: SceneView;
    __loadTimes: number[];
    /** probes' own scratch values */
    [key: string]: any;
  }
  interface Document {
    getElementById(id: string): any;
    querySelector(selectors: string): any;
  }
  interface Element {
    [key: string]: any;
  }
}
