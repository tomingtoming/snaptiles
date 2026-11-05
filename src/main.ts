import { downloadFilename } from './editor/document';
import { parseRc } from './rc/parser';
import { BuildPanel } from './editor/panel';
import { SceneView } from './render/scene';
import { KeyState, KEY_TABLE } from './input/keys';
import type { SimView } from './sim/sim-view';
import type { RustSimulation } from './sim/rust-simulation';
import { decodeRecording, decodeText, encodeRecording, encodeText, type Recording } from './sim/replay';
import { DebugPanel } from './debug/panel';
import { SourceView } from './editor/source-view';
import { Completion } from './editor/completion';
import { diagnosticLine } from './editor/script';
import { ChallengeUI } from './challenge/ui';
import { scenarioById } from './challenge/scenarios';
import { Sfx } from './audio/sfx';
import { SAMPLES } from './samples';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
// Cloudflare Web Analytics (no cookies, no personal data), on the production host only: local runs and tests stay out
if (location.hostname === 'snaptiles.toming.app') {
  const beacon = document.createElement('script');
  beacon.defer = true;
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.dataset.cfBeacon = JSON.stringify({ token: 'c7f0e1e7c1374cacacd923e51e765def' });
  document.head.append(beacon);
}
const sourceEl = $<HTMLTextAreaElement>('source');
/** `?bare`: no course blocks or crates (measurement probes) */
const BARE = new URLSearchParams(location.search).has('bare');
const statusEl = $('status');
const valsEl = $('vals');
const outEl = $('out');
const keysEl = $('keys');
const samplesEl = $('samples');
const runBtn = $<HTMLButtonElement>('run');

const keys = new KeyState(window);
const sfx = new Sfx();
window.addEventListener('pointerdown', () => { sfx.unlock(); paintMute(); }, { capture: true });
window.addEventListener('keydown', () => { sfx.unlock(); paintMute(); }, { capture: true });
const muteBtn = $<HTMLButtonElement>('mute');
const paintMute = () => {
  muteBtn.disabled = !sfx.available;
  muteBtn.textContent = !sfx.available || sfx.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-pressed', String(sfx.muted));
  muteBtn.title = !sfx.available ? 'この環境では音声を利用できません' : sfx.muted ? '音を出す' : '消音';
  muteBtn.setAttribute('aria-label', muteBtn.title);
};
muteBtn.addEventListener('click', () => { sfx.setMuted(!sfx.muted); paintMute(); });
paintMute();
(window as unknown as { __sfx: Sfx }).__sfx = sfx; // probe hook
let lastShells = 0;
let lastCoreVel: { x: number; y: number; z: number } | null = null;
const crateVel: ({ x: number; y: number; z: number } | null)[] = [];
const scene = new SceneView(canvas);
let sim: RustSimulation | null = null;
let loadGeneration = 0;
let builder: BuildPanel;
let keyCaps: { el: HTMLElement; n: number }[] = [];

// the simulation core (core/: Rust, rapier3d and Lua, built with Emscripten) starts loading at boot, so a load later
// only awaits settled promises (microtasks)
const rustSimulation = import('./sim/rust-simulation').then((m) => { void m.loadRustCore(); return m.RustSimulation; });

// the debug panel: rewinding re-runs the recorded run to a frame in a fresh simulation and swaps it in
const debug = new DebugPanel({
  sim: () => sim,
  paused: () => paused,
  setPaused: (p) => { paused = p; },
  seek: seekTo,
  step: () => { if (sim && !builder?.active) { sim.step(); if (!debug.afterStep(sim) && !sim.midFrame) challenge.afterStep(sim); } },
  stepLine: () => { if (sim && !builder?.active) { sim.stepLine(); if (!debug.afterStep(sim) && !sim.midFrame) challenge.afterStep(sim); } },
  source: sourceEl,
});
// the source editor's gutter (line numbers, breakpoints, errors) and colours
const errorLine = () => {
  const msg = statusEl.textContent ?? '';
  return msg ? diagnosticLine(sourceEl.value, msg) : null;
};
/** the live syntax check's error (compiled by the core while typing, never run) */
let liveError: { line: number; message: string } | null = null;
const sourceView = new SourceView(sourceEl, {
  breakpoints: () => debug.breakpointLines(),
  toggleBreakpoint: (line) => debug.toggleBreakpoint(line),
  errorLines: () => [...new Set([errorLine()?.line, liveError?.line].filter((n): n is number => !!n))],
  currentLine: () => debug.pausedLine(),
  errorMessage: (line) => (liveError?.line === line ? liveError.message : statusEl.textContent ?? undefined),
});
new Completion(sourceEl, sourceView.layer);
const hintEl = $('source-hint');
const hintText = hintEl.textContent ?? '';
let checkTimer = 0;
let checkGeneration = 0;
const liveCheck = () => {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(async () => {
    const request = ++checkGeneration, text = sourceEl.value;
    const msg = await (await import('./sim/rust-simulation')).checkSource(text);
    if (request !== checkGeneration) return;
    const m = /\bline (\d+):\s*([\s\S]*)/.exec(msg);
    liveError = msg ? { line: m ? Number(m[1]) : 0, message: msg } : null;
    hintEl.classList.toggle('error', !!msg);
    hintEl.textContent = msg ? `文法：${msg}` : hintText;
  }, 300);
};
sourceEl.addEventListener('input', liveCheck);
// a live Lua edit: the running model keeps going with the new Lua block (Ctrl+Shift+Enter or the button)
const luaApply = document.createElement('button');
luaApply.id = 'lua-apply';
luaApply.type = 'button';
luaApply.hidden = true;
luaApply.textContent = 'Luaを反映（続けたまま）';
luaApply.title = '実行を止めずに、Luaの部分だけ差し替えます（Ctrl+Shift+Enter）。機体・Val・Keyを変えたときは▶で実行し直します';
sourceView.layer.append(luaApply);
const applyLua = () => {
  if (!sim || builder?.active) return;
  const err = sim.reloadScript(sourceEl.value);
  statusEl.textContent = err ? err : '';
  if (!err) { luaApply.hidden = true; statusEl.textContent = ''; }
};
luaApply.addEventListener('click', applyLua);
// challenges: a course, a budget and a goal; the challenge rides in the URL (&c=) with the model and the run
const challenge = new ChallengeUI({
  sim: () => sim,
  reload: (source) => {
    if (source !== undefined) { builder.loadSource(source); refreshSampleButtons(); }
    void loadAndShare(source ?? sourceEl.value);
  },
  recordLink: async () => {
    const s = sim!;
    const url = new URL(location.href);
    url.hash = `m=${await encodeText(s.source)}${s.scenario ? `&c=${s.scenario.id}` : ''}&r=${await encodeRecording(s.recording)}`;
    return url.href;
  },
});
async function seekTo(frame: number, timeline: Recording): Promise<void> {
  const current = sim;
  if (!current) return;
  const request = loadGeneration;
  const next = new (await rustSimulation)(current.source, keys, { scenario: current.scenario, bare: current.bare });
  await next.start();
  next.player = timeline;
  for (let i = 0; i < frame; i++) next.step();
  if (request !== loadGeneration || sim !== current) { await next.dispose(); return; }
  sim = next;
  (window as unknown as { __sim: SimView }).__sim = next;
  scene.rebuild(next.assembly!.tiles, next.env);
  scene.setLines3d(next.lines3d);
  scene.sync(next.physics);
  lastCoreVel = null; lastShells = next.physics.projectiles.length; crateVel.length = 0;
  debug.attach(next, true);
  challenge.attach(next, true);
  await current.dispose();
}

async function load(source: string, request: number, player: Recording | null = null): Promise<boolean> {
  if (request !== loadGeneration) return false;
  const focusBeforeLoad = document.activeElement;
  builder?.close();
  paused = false;
  statusEl.textContent = '';
  valsEl.textContent = outEl.textContent = '';
  keys.clear(); keysEl.replaceChildren(); keyCaps = [];
  sfx.update(0, 0);
  const old = sim;
  sim = null;
  (window as unknown as { __sim: SimView | null }).__sim = null;
  scene.clearModel();
  hudCtx.clearRect(0, 0, hud.width, hud.height);
  let next: RustSimulation | null = null;
  try {
    if (old) await old.dispose();
    if (request !== loadGeneration) return false;
    const t0 = performance.now();
    const made = new (await rustSimulation)(source, keys, { scenario: challenge.active, bare: BARE });
    next = made;
    const t1 = performance.now();
    await next.start();
    if (request !== loadGeneration) { await next.dispose(); return false; }
    const t2 = performance.now();
    next.player = player; // a shared run replays from the first step
    sim = next;
    debug.attach(next, false);
    scene.setScenario(next.scenario);
    challenge.attach(next, false);
    (window as unknown as { __sim: SimView }).__sim = next;
    scene.rebuild(next.assembly!.tiles, next.env);
    scene.setLines3d([]);
    const t3 = performance.now();
    (window as unknown as { __loadTimes: number[] }).__loadTimes = [t1 - t0, t2 - t1, t3 - t2].map(v => Math.round(v));
    scene.camYaw = 0.7;
    scene.sync(next.physics);
    scene.frameSimulation(next.corePosition());
    scene.snapModel(next.modelCenter(), next.scenario);
    acc = 0; last = performance.now(); lastCoreVel = null; lastShells = 0; crateVel.length = 0;
    buildKeyCaps(next);
    if (document.activeElement === focusBeforeLoad) canvas.focus({preventScroll: true});
    statusEl.textContent = [...next.model.warnings, next.scriptError].filter(Boolean).join('\n');
    liveCheck(); // the source may have been set by code (a sample, a link), with no input event
    return true;
  } catch (e) {
    if (next) await next.dispose();
    if (request === loadGeneration) {
      sim = null;
      (window as unknown as { __sim: SimView | null }).__sim = null;
      scene.clearModel();
      statusEl.textContent = e instanceof Error ? e.message : String(e);
    }
    return false;
  }
}

function buildKeyCaps(s: SimView): void {
  keysEl.replaceChildren();
  keyCaps = [];
  // keys bound in Key{} plus any _KEY(n) literal the script polls
  const polled = [...(s.model.script?.source.matchAll(/_KEY(?:DOWN|UP)?\s*\(\s*(\d+)\s*\)/g) ?? [])].map((m) => Number(m[1]));
  const used = [...new Set([...s.model.keys.map((k) => k.key), ...polled])].sort((a, b) => a - b);
  keys.setWasdAliases(used);
  for (const n of used) {
    const def = KEY_TABLE[n];
    if (!def) continue;
    const el = document.createElement('div');
    el.className = 'cap';
    el.textContent = def.glyph;
    // the keycap is also the touch control
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      keys.press(n, e.pointerId);
    });
    const up = (e: PointerEvent) => keys.release(n, e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    keysEl.append(el);
    keyCaps.push({ el, n });
  }
}

// ---- samples ----
for (const s of SAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s.name;
  b.addEventListener('click', () => {
    builder.loadSource(s.source);
    refreshSampleButtons();
    void loadAndShare(s.source);
  });
  samplesEl.append(b);
}
// the challenges sit with the samples (both pick what to play); the run bar has no room left on a 380 px panel
samplesEl.append($('challenge-open'));
function currentSample(): number {
  const source = sourceEl.value.replace(/\r\n?/g, '\n');
  return SAMPLES.findIndex(sample => sample.source.replace(/\r\n?/g, '\n') === source);
}
function refreshSampleButtons(): void {
  const current = currentSample();
  [...samplesEl.children].forEach((c, i) => c.setAttribute('aria-current', String(i === current)));
}
sourceEl.addEventListener('input', refreshSampleButtons);
sourceEl.addEventListener('modelchange', refreshSampleButtons);
runBtn.addEventListener('click', () => void loadAndShare(sourceEl.value));
// ---- the original's views A–J (F8–F12, Ctrl+F8–F12; also 1–9, 0 and the button, since browsers may keep F11/F12) ----
const VIEWS = [
  { mode: 'A', label: '追従' },
  { mode: 'B', label: '観客席' },
  { mode: 'C', label: '後方固定' },
  { mode: 'D', label: '前方固定' },
  { mode: 'E', label: '真上' },
  { mode: 'F', label: '追従（切り離し用）' },
  { mode: 'G', label: '観客席（切り離し用）' },
  { mode: 'H', label: '定点（CCD）' },
  { mode: 'I', label: '車載' },
  { mode: 'J', label: '周回' },
] as const;
const viewBtn = $<HTMLButtonElement>('viewmode');
let viewIndex = 0;
function setView(i: number): void {
  viewIndex = (i + VIEWS.length) % VIEWS.length;
  if (!builder?.active) scene.setView(VIEWS[viewIndex].mode);
  viewBtn.textContent = VIEWS[viewIndex].mode;
  viewBtn.title = `視点 ${VIEWS[viewIndex].mode}: ${VIEWS[viewIndex].label}（クリックで切替）`;
  viewBtn.setAttribute('aria-label', viewBtn.title);
}
viewBtn.addEventListener('click', () => setView(viewIndex + 1));
setView(0);
$('help').addEventListener('click', () => { $<HTMLDialogElement>('help-dialog').showModal(); $('help-title').focus(); });
let paused = false;
let windLevel = 0;
sourceEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    applyLua();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void loadAndShare(sourceEl.value);
    return;
  }
  if (e.key === 'Escape') {
    // Tab indents here, so Esc is the keyboard way out of the source: to the 3D view
    e.preventDefault(); canvas.focus(); return;
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    // keep Tab in the editor (model files are tab-indented)
    e.preventDefault();
    if (!sourceEl.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, cancelable:true, inputType:'insertText', data:'\t'}))) return;
    const { selectionStart: a, selectionEnd: b, value } = sourceEl;
    sourceEl.value = value.slice(0, a) + '	' + value.slice(b);
    sourceEl.selectionStart = sourceEl.selectionEnd = a + 1;
    sourceEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
function currentFilename(): string {
  const name = builder.document.text === sourceEl.value.replace(/\r\n?/g, '\n') ? builder.document.filename : undefined;
  return downloadFilename(name ?? SAMPLES[currentSample()]?.name ?? 'model');
}
const filenameDialog = $<HTMLDialogElement>('filename-dialog');
const filenameInput = $<HTMLInputElement>('filename-input');
const filenamePreview = $('filename-preview');
const showFilename = () => { filenamePreview.textContent = `保存される名前: ${downloadFilename(filenameInput.value)}`; };
$('rename-model').addEventListener('click', () => {
  filenameInput.value = currentFilename(); showFilename(); filenameDialog.showModal(); filenameInput.select();
});
filenameInput.addEventListener('input', showFilename);
$('filename-cancel').addEventListener('click', () => filenameDialog.close());
$('filename-form').addEventListener('submit', event => {
  event.preventDefault(); builder.renameFile(filenameInput.value); filenameDialog.close();
});
function saveModel(): void {
    const blob = new Blob([sourceEl.value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentFilename();
    a.click();
    URL.revokeObjectURL(a.href);
}
$('save-model').addEventListener('click', saveModel);
window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLElement && (['TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName) || e.target.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    // Commit an open filename edit before saving, just as the dialog's submit does.
    e.preventDefault();
    if (filenameDialog.open) {
      const form = $<HTMLFormElement>('filename-form');
      if (!form.reportValidity()) return;
      form.requestSubmit();
    }
    saveModel();
    return;
  }
  if (typing) return;
  if (builder?.active) {
    // build mode, focus on the 3D view or the page: arrows orbit, +/- zoom, Delete removes the selection,
    // N/W/E/S add the chosen part on that edge (the buttons do the checks)
    const orbit = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -18], ArrowDown: [0, 18] }[e.key];
    if (orbit) { e.preventDefault(); scene.orbitBy(orbit[0], orbit[1]); return; }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') {
      e.preventDefault(); scene.zoomBy(e.key === '-' || e.code === 'NumpadSubtract' ? 1.15 : 1 / 1.15, true); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $<HTMLButtonElement>('part-delete').click(); return; }
    const edge = /^Key([NWES])$/.exec(e.code);
    if (edge && !e.ctrlKey && !e.metaKey && !e.altKey) {
      document.querySelector<HTMLButtonElement>(`#builder [data-edge="${edge[1]}"]`)?.click();
    }
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; } // Space carries no key number in the original
  if (e.code === 'Period' && debug.open) debug.stepForward(); // . / , step one frame (debug panel open)
  if (e.code === 'Comma' && debug.open) void debug.stepBack();
  // the original's default scenario: H drops a ball (r 0.6, specific gravity 0.3) 6 m up at x = 2, J cycles the wind
  if (e.code === 'KeyH' && sim) { const n = sim.physics.balls.length; sim.physics.addBall(0.6, 2, 6 + n, n / 10, 0.3); }
  if (e.code === 'KeyJ' && sim) { windLevel = (windLevel + 1) % 4; sim.physics.wind.set([0, 5, 16, 50][windLevel], 0, 0); }
  if (e.code >= 'Digit0' && e.code <= 'Digit9') setView((Number(e.code.slice(5)) + 9) % 10);
  const fkey = /^F(8|9|1[012])$/.exec(e.code);
  if (fkey) { e.preventDefault(); setView(Number(fkey[1]) - 8 + (e.ctrlKey ? 5 : 0)); }
  if (e.code === 'KeyI' || e.code === 'KeyO') scene.zoomStep(e.code === 'KeyI' ? -1 : 1); // the original's view zoom
  if (e.code === 'KeyR' && sim) { sim.reset(); scene.snapModel(sim.modelCenter(), sim.scenario); } // R: reset in place (OnReset)
  if (e.code === 'KeyU') void loadAndShare(sourceEl.value); // U: reload from source (OnInit)
});

// ---- camera orbit ----
let dragging = false;
let lastX = 0;
let lastY = 0;
// one finger orbits, two fingers pinch to zoom
const touches = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
// pointer state for the model's _MX/_MY/_ML/_MR/_MM (canvas pixels)
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); keys.mouse.x = Math.round(e.clientX - r.left); keys.mouse.y = Math.round(e.clientY - r.top); });
const pointerButtons = new Map<number, number>();
const updateMouseButtons = () => {
  let buttons = 0;
  for (const held of pointerButtons.values()) buttons |= held;
  keys.mouse.l = buttons & 1 ? 1 : 0; keys.mouse.r = buttons & 2 ? 1 : 0; keys.mouse.m = buttons & 4 ? 1 : 0;
};
canvas.addEventListener('pointerdown', (e) => { pointerButtons.set(e.pointerId, e.buttons); updateMouseButtons(); });
canvas.addEventListener('pointermove', (e) => { if (pointerButtons.has(e.pointerId)) { pointerButtons.set(e.pointerId, e.buttons); updateMouseButtons(); } });
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = touches.size === 1;
  lastX = e.clientX;
  lastY = e.clientY;
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
  canvas.setPointerCapture(e.pointerId);
  canvas.focus();
});
canvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) scene.zoomBy(pinchDist / Math.max(1, d), builder?.active);
    pinchDist = d;
    return;
  }
  if (!dragging) return;
  scene.orbitBy(e.clientX - lastX, e.clientY - lastY);
  lastX = e.clientX;
  lastY = e.clientY;
});
const endPointer = (e: PointerEvent) => {
  pointerButtons.delete(e.pointerId); updateMouseButtons();
  if (!touches.delete(e.pointerId)) return;
  const [a, b] = [...touches.values()];
  dragging = touches.size === 1;
  pinchDist = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  if (a) { lastX = a.x; lastY = a.y; }
};
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
window.addEventListener('blur', () => {
  touches.clear(); pointerButtons.clear(); updateMouseButtons(); dragging = false; pinchDist = 0;
});
(window as unknown as { __scene: SceneView }).__scene = scene; // probe hook
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.zoomBy(Math.exp(e.deltaY * 0.001), builder?.active);
}, { passive: false });
canvas.tabIndex = 0;

// ---- main loop ----
let acc = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const frameSeconds = Math.min(0.1, (now - last) / 1000);
  acc += frameSeconds;
  last = now;
  if (sim && !builder?.active) {
    keys.pollGamepad();
    const FIXED = sim.frameDt();
    let n = 0;
    if (paused) acc = 0;
    // a key held during a replay takes the run over from there (it keeps recording)
    if (sim.replaying && keys.anyDown()) sim.player = null;
    while (acc >= FIXED && n < 4) {
      sim.step();
      acc -= FIXED;
      n++;
      if (debug.afterStep(sim)) { acc = 0; break; } // a breakpoint pauses the page
      challenge.afterStep(sim);
    }
    if (n === 4) acc = 0;
    scene.sync(sim.physics);
    scene.updateDynamic(sim.env);
    scene.setLines3d(sim.lines3d);
    scene.syncProjectiles(sim.physics.projectiles);
    drawHud(sim.lines2d, sim);
    scene.onboardFov = sim.zoomFov;
    if (scene.viewMode === 'orbit') scene.setView(VIEWS[viewIndex].mode); // back from the editor
    const core = sim.physics.tiles[0] ? sim.physics.pose(sim.physics.tiles[0]) : undefined;
    if (core) scene.followModel({ center: sim.modelCenter(), core: core.position, quat: core.quaternion, velocity: sim.coreVelocity() }, frameSeconds);
    updateOverlay(sim);
    updateSound(sim);
  }
  if (builder?.active) { acc = 0; scene.updateEditorCamera(); }
  if (!builder?.active) { debug.update(sim); challenge.update(sim); }
  // the live-edit button: running, and the source differs from the running Lua's
  luaApply.hidden = !sim || !!builder?.active || !sim.model.script || sourceEl.value === sim.currentSource;
  challenge.updateBuild(builder?.assembly ?? null, !!builder?.active);
  scene.render();
}
function updateSound(s: SimView): void {
  let spin = 0;
  let jet = 0;
  for (const tb of s.physics.tiles) {
    if (tb.tile.spec.wheel) spin = Math.max(spin, Math.abs(tb.spin));
    if (tb.tile.spec.jet) jet += Math.abs(tb.jetPower);
  }
  sfx.update(spin, jet);
  const shells = s.physics.projectiles.length;
  if (shells > lastShells) sfx.fire();
  lastShells = shells;
  // crates being hit: a thud scaled by how hard they were kicked
  s.physics.crates.forEach((b, i) => {
    const v = b.linvel();
    const prev = crateVel[i];
    if (prev) {
      const dv = Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z);
      if (dv > 2) sfx.thud(Math.min(1, (dv - 2) / 10));
    }
    crateVel[i] = { x: v.x, y: v.y, z: v.z };
  });
  const core = s.physics.tiles[0];
  if (core) {
    const v = core.body.linvel();
    if (lastCoreVel) {
      const dv = Math.hypot(v.x - lastCoreVel.x, v.y - lastCoreVel.y, v.z - lastCoreVel.z);
      if (dv > 4) sfx.thud((dv - 4) / 12); // a sudden speed change of more than 4 m/s in one frame
    }
    lastCoreVel = { x: v.x, y: v.y, z: v.z };
  } else lastCoreVel = null;
}
function updateOverlay(s: SimView): void {
  const lines: string[] = [];
  for (const v of s.vals.values()) if (v.disp) lines.push(`${v.name.padEnd(10)} ${fmt(v.value)}`);
  valsEl.textContent = lines.join('\n');
  outEl.textContent = s.out.join('\n').replace(/\n+$/, '');
  for (const c of keyCaps) c.el.dataset.down = String(keys.isDown(c.n));
  if (s.scriptError) {
    const diagnostic = [...s.model.warnings, s.scriptError].filter(Boolean).join('\n');
    if (statusEl.textContent !== diagnostic) statusEl.textContent = diagnostic;
  }
}
// _MOVE2D/_LINE2D overlay: x spans -1..1 across the width, y is 1 at the top and -1 at the bottom
const hud = $<HTMLCanvasElement>('hud');
const hudCtx = hud.getContext('2d')!;
function drawHud(buf: number[], s: SimView): void {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  if (hud.width !== w || hud.height !== h) {
    hud.width = w;
    hud.height = h;
  }
  hudCtx.clearRect(0, 0, w, h);
  if (paused) {
    hudCtx.font = `${Math.round(h / 8)}px system-ui, sans-serif`;
    hudCtx.textAlign = 'center';
    hudCtx.textBaseline = 'middle';
    hudCtx.fillStyle = 'rgba(255,255,255,0.7)';
    hudCtx.fillText('\u23F8', w / 2, h / 2);
  }
  if (sim?.replaying && sim.player) {
    // top centre, clear of the Val (left) and out() (right) boxes
    const size = Math.max(12, Math.min(15, Math.round(h / 48)));
    hudCtx.font = `${size}px system-ui, sans-serif`;
    hudCtx.textAlign = 'center';
    hudCtx.textBaseline = 'top';
    const text = `\u25B6 リプレイ ${(sim.frame / 30).toFixed(1)} / ${(sim.player.frames / 30).toFixed(1)} 秒 ・ キーで操作を引き継ぐ`;
    const width = hudCtx.measureText(text).width + 20;
    hudCtx.fillStyle = 'rgba(16,20,24,0.62)';
    hudCtx.beginPath();
    hudCtx.roundRect(w / 2 - width / 2, 12, width, size + 12, 8);
    hudCtx.fill();
    hudCtx.fillStyle = '#fff';
    hudCtx.fillText(text, w / 2, 18);
  }
  // the original's dials: speed in km/h and altitude in m (the compass is the camera's job here)
  const core = s.physics.tiles[0];
  if (core) {
    const p = s.physics.pose(core);
    const kmh = s.physics.velocity(core, p).length() * 3.6;
    const size = Math.max(12, Math.round(h / 28)), step = Math.round(h / 24);
    hudCtx.font = `${size}px system-ui, sans-serif`;
    hudCtx.textAlign = 'right';
    hudCtx.textBaseline = 'bottom';
    const rows = [`${kmh.toFixed(0)} km/h`, `${p.position.y.toFixed(1)} m`];
    if (s.physics.wind.lengthSq() > 0) rows.push(`wind ${s.physics.wind.length().toFixed(0)} m/s`);
    // a dark plate behind the readout: white text alone vanished over the bright ground and sky (UI audit 2026-11-01)
    const width = Math.max(...rows.map((r) => hudCtx.measureText(r).width)) + 16;
    const height = (rows.length - 1) * step + size + 12;
    hudCtx.fillStyle = 'rgba(16,20,24,0.62)';
    hudCtx.beginPath();
    const bottom = h - 12 - (debug.open ? debug.panel.offsetHeight : 0); // above the debug panel when it is open
    hudCtx.roundRect(w - 12 - width + 8, bottom - height + 6, width, height, 8);
    hudCtx.fill();
    hudCtx.fillStyle = '#fff';
    rows.forEach((r, i) => hudCtx.fillText(r, w - 12, bottom - i * step));
  }
  if (buf.length === 0) return;
  hudCtx.lineWidth = 1.5;
  for (let i = 0; i < buf.length; i += 7) {
    const [x1, y1, x2, y2, r, g, b] = buf.slice(i, i + 7);
    hudCtx.strokeStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
    hudCtx.beginPath();
    hudCtx.moveTo(((x1 + 1) / 2) * w, ((1 - y1) / 2) * h);
    hudCtx.lineTo(((x2 + 1) / 2) * w, ((1 - y2) / 2) * h);
    hudCtx.stroke();
  }
}
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
new ResizeObserver(() => scene.resize(builder.active)).observe(canvas);
requestAnimationFrame(frame);

// ---- files in, links out ----
// Both picker and drop use the same latest-request and read-error handling.
const fileInput = $<HTMLInputElement>('model-file');
$('open-model').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = ''; // Selecting the same file again must also reload it.
  if (file) void openModelFile(file);
});
sourceEl.addEventListener('dragover', (e) => e.preventDefault());
sourceEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void openModelFile(file);
});
async function openModelFile(file: File): Promise<void> {
  const request = ++loadGeneration;
  try {
    const text = await readModelFile(file);
    if (request !== loadGeneration) return;
    builder.loadSource(text, file.name);
    refreshSampleButtons();
    await loadAndShare(text, request);
  } catch (error) {
    if (request === loadGeneration) statusEl.textContent = `ファイルを開けませんでした: ${error instanceof Error ? error.message : String(error)}`;
  }
}
async function readModelFile(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!/�/.test(utf8)) return utf8;
  try {
    return new TextDecoder('shift_jis').decode(buf); // original tool's files are often Shift-JIS
  } catch {
    return utf8;
  }
}
const shareDialog = $<HTMLDialogElement>('share-dialog');
const shareUrl = $<HTMLInputElement>('share-url');
const shareStatus = $('share-status');
const copyLink = $<HTMLButtonElement>('copy-link');
let shareGeneration = 0;
shareDialog.addEventListener('close', () => { ++shareGeneration; });
const shareRun = $<HTMLInputElement>('share-run');
const shareRunRow = $('share-run-row');
async function makeShareLink(): Promise<void> {
  const text = sourceEl.value;
  const request = ++shareGeneration;
  shareUrl.value = ''; copyLink.disabled = true;
  shareStatus.textContent = 'リンクを作成しています…';
  // the run can travel only with the model it was driven on
  const run = sim && sim.source === text && sim.recording.frames > 0 ? sim.recording : null;
  shareRunRow.hidden = !run;
  if (run) $('share-run-length').textContent = (run.frames / 30).toFixed(1);
  try {
    if (!parseRc(text).body) throw new Error('Body がありません');
    const hash = await encodeHash(text);
    const recording = run && shareRun.checked ? await encodeRecording(run) : null;
    if (request !== shareGeneration || !shareDialog.open) return;
    const course = sim?.scenario ? `&c=${sim.scenario.id}` : '';
    const url = new URL(location.href); url.hash = `m=${hash}${course}${recording ? `&r=${recording}` : ''}`;
    shareUrl.value = url.href; copyLink.disabled = false;
    shareStatus.textContent = ''; shareUrl.focus(); shareUrl.select();
  } catch (error) {
    if (request === shareGeneration && shareDialog.open) shareStatus.textContent = `リンクを作れませんでした: ${error instanceof Error ? error.message : String(error)}`;
  }
}
$('share-model').addEventListener('click', () => { shareDialog.showModal(); void makeShareLink(); });
shareRun.addEventListener('change', () => void makeShareLink());
copyLink.addEventListener('click', async () => {
  const request = shareGeneration;
  copyLink.disabled = true;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    if (request === shareGeneration) shareStatus.textContent = 'コピーしました';
  } catch {
    if (request === shareGeneration) {
      shareStatus.textContent = '自動コピーできませんでした。URLを選択してコピーしてください。';
      shareUrl.focus(); shareUrl.select();
    }
  } finally { if (request === shareGeneration) copyLink.disabled = false; }
});
const encodeHash = encodeText;
const decodeHash = decodeText;
async function publishHash(text: string, request: number): Promise<void> {
  const sample = SAMPLES.find((s) => s.source === text);
  const h = (sample ? `#${sample.name}` : `#m=${await encodeHash(text)}`) + (challenge.active ? `&c=${challenge.active.id}` : '');
  if (request === loadGeneration && location.hash !== h) history.replaceState(null, '', h);
}

const loadAndShare = async (text: string, request = ++loadGeneration) => {
  if (await load(text, request)) await publishHash(text, request);
};

async function boot(): Promise<void> {
  const request = ++loadGeneration;
  // #m=<model> or #<sample>, then &c=<challenge> and &r=<run> (base64url never holds & or =)
  const [h, ...rest] = location.hash.slice(1).split('&');
  const params = new Map(rest.map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)] as [string, string]; }));
  const runCode = params.get('r');
  challenge.active = scenarioById(params.get('c'));
  let player: Recording | null = null;
  if (runCode) {
    try { player = await decodeRecording(runCode); } catch { player = null; }
    if (request !== loadGeneration) return;
  }
  if (h.startsWith('m=')) {
    try {
      const text = await decodeHash(h.slice(2));
      if (request !== loadGeneration) return;
      builder.loadSource(text);
      refreshSampleButtons();
      await load(text, request, player);
      return;
    } catch {
      /* fall through to the sample */
    }
  }
  if (request !== loadGeneration) return;
  const idx = Math.max(0, SAMPLES.findIndex((s) => s.name === h));
  builder.loadSource(SAMPLES[idx].source);
  refreshSampleButtons();
  if (player) await load(SAMPLES[idx].source, request, player);
  else await loadAndShare(SAMPLES[idx].source, request);
}
builder = new BuildPanel(sourceEl, scene, statusEl, () => { ++loadGeneration; paused = true; sfx.update(0, 0); });
void boot();
window.addEventListener('hashchange', () => void boot()); // #car / #plane / #m=... links switch models

// an opened section of the builder panel scrolls itself into view (the panel scrolls on short screens)
for (const id of ['appearance', 'placement', 'script-tools']) {
  const details = $<HTMLDetailsElement>(id);
  details.addEventListener('toggle', () => { if (details.open) details.scrollIntoView({ block: 'nearest' }); });
}
