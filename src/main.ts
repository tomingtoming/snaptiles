import { downloadFilename } from './editor/document';
import { parseRc } from './rc/parser';
import { BuildPanel } from './editor/panel';
import { initRapier } from './physics/world';
import { SceneView } from './render/scene';
import { KeyState, KEY_TABLE } from './input/keys';
import { Simulation } from './sim/simulation';
import { Sfx } from './audio/sfx';
import { SAMPLES } from './samples';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const sourceEl = $<HTMLTextAreaElement>('source');
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
let sim: Simulation | null = null;
let loadGeneration = 0;
let builder: BuildPanel;
let keyCaps: { el: HTMLElement; n: number }[] = [];

const R = await initRapier();

async function load(source: string, request: number): Promise<boolean> {
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
  (window as unknown as { __sim: Simulation | null }).__sim = null;
  scene.clearModel();
  hudCtx.clearRect(0, 0, hud.width, hud.height);
  let next: Simulation | null = null;
  try {
    if (old) await old.dispose();
    if (request !== loadGeneration) return false;
    const t0 = performance.now();
    next = new Simulation(R, source, keys);
    const t1 = performance.now();
    await next.start();
    if (request !== loadGeneration) { await next.dispose(); return false; }
    const t2 = performance.now();
    sim = next;
    (window as unknown as { __sim: Simulation }).__sim = next;
    scene.rebuild(next.assembly!.tiles, next.env);
    scene.setLines3d([]);
    const t3 = performance.now();
    (window as unknown as { __loadTimes: number[] }).__loadTimes = [t1 - t0, t2 - t1, t3 - t2].map(v => Math.round(v));
    scene.camYaw = 0.7;
    scene.sync(next.physics);
    scene.frameSimulation(next.corePosition());
    acc = 0; last = performance.now(); lastCoreVel = null; lastShells = 0; crateVel.length = 0;
    buildKeyCaps(next);
    if (document.activeElement === focusBeforeLoad) canvas.focus({preventScroll: true});
    if (next.scriptError) statusEl.textContent = next.scriptError;
    return true;
  } catch (e) {
    if (next) await next.dispose();
    if (request === loadGeneration) {
      sim = null;
      (window as unknown as { __sim: Simulation | null }).__sim = null;
      scene.clearModel();
      statusEl.textContent = e instanceof Error ? e.message : String(e);
    }
    return false;
  }
}

function buildKeyCaps(s: Simulation): void {
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
// ---- view modes (1-4 or the button; those digits carry no key number in the original) ----
const VIEWS = [
  { mode: 'chase', glyph: '◎', label: '追従' },
  { mode: 'orbit', glyph: '✥', label: '周回' },
  { mode: 'top', glyph: '⬒', label: '上空' },
  { mode: 'onboard', glyph: '◉', label: '車載' },
] as const;
const viewBtn = $<HTMLButtonElement>('viewmode');
let viewIndex = 0;
function setView(i: number): void {
  viewIndex = (i + VIEWS.length) % VIEWS.length;
  scene.setView(VIEWS[viewIndex].mode);
  viewBtn.textContent = VIEWS[viewIndex].glyph;
  viewBtn.title = `視点: ${VIEWS[viewIndex].label}（クリックで切替）`;
  viewBtn.setAttribute('aria-label', viewBtn.title);
}
viewBtn.addEventListener('click', () => setView(viewIndex + 1));
setView(0);
$('help').addEventListener('click', () => { $<HTMLDialogElement>('help-dialog').showModal(); $('help-title').focus(); });
let paused = false;
let windLevel = 0;
sourceEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void loadAndShare(sourceEl.value);
    return;
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
  if (typing || builder?.active) return;
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; } // Space carries no key number in the original
  // the original's default scenario: H drops a ball (r 0.6, specific gravity 0.3) 6 m up at x = 2, J cycles the wind
  if (e.code === 'KeyH' && sim) { const n = sim.physics.balls.length; sim.physics.addBall(0.6, 2, 6 + n, n / 10, 0.3); }
  if (e.code === 'KeyJ' && sim) { windLevel = (windLevel + 1) % 4; sim.physics.wind.set([0, 5, 16, 50][windLevel], 0, 0); }
  if (e.code >= 'Digit1' && e.code <= 'Digit4') setView(Number(e.code.slice(5)) - 1);
  if (e.code === 'KeyR' && sim) { sim.reset(); scene.snap(sim.corePosition()); } // R: reset in place (OnReset)
  if (e.code === 'KeyU') void loadAndShare(sourceEl.value); // U: reload from source (OnInit)
});

// ---- camera orbit ----
let dragging = false;
let lastDrag = -1e9;
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
  lastDrag = performance.now();
  if (touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) scene.zoomBy(pinchDist / Math.max(1, d), builder?.active);
    pinchDist = d;
    return;
  }
  if (!dragging) return;
  scene.camYaw -= (e.clientX - lastX) * 0.006;
  scene.camPitch = Math.max(0.05, Math.min(1.4, scene.camPitch + (e.clientY - lastY) * 0.006));
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
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim && !builder?.active) {
    keys.pollGamepad();
    const FIXED = sim.frameDt();
    let n = 0;
    if (paused) acc = 0;
    while (acc >= FIXED && n < 4) {
      sim.step();
      acc -= FIXED;
      n++;
    }
    if (n === 4) acc = 0;
    scene.sync(sim.physics);
    scene.updateDynamic(sim.env);
    scene.setLines3d(sim.lines3d);
    scene.syncProjectiles(sim.physics.projectiles);
    drawHud(sim.lines2d, sim);
    if (scene.viewMode === 'chase' && !dragging && performance.now() - lastDrag > 3000) scene.chaseYaw(sim.coreHeading());
    scene.onboardFov = sim.zoomFov;
    scene.follow(sim.corePosition(), 0.08, sim.physics.tiles[0] ? sim.physics.pose(sim.physics.tiles[0]).quaternion : undefined);
    updateOverlay(sim);
    updateSound(sim);
  }
  if (builder?.active) { acc = 0; scene.updateEditorCamera(); }
  scene.render();
}
function updateSound(s: Simulation): void {
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
function updateOverlay(s: Simulation): void {
  const lines: string[] = [];
  for (const v of s.vals.values()) if (v.disp) lines.push(`${v.name.padEnd(10)} ${fmt(v.value)}`);
  valsEl.textContent = lines.join('\n');
  outEl.textContent = s.out.join('\n').replace(/\n+$/, '');
  for (const c of keyCaps) c.el.dataset.down = String(keys.isDown(c.n));
  if (s.scriptError && statusEl.textContent !== s.scriptError) statusEl.textContent = s.scriptError;
}
// _MOVE2D/_LINE2D overlay: x spans -1..1 across the width, y is 1 at the top and -1 at the bottom
const hud = $<HTMLCanvasElement>('hud');
const hudCtx = hud.getContext('2d')!;
function drawHud(buf: number[], s: Simulation): void {
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
  // the original's dials: speed in km/h and altitude in m (the compass is the camera's job here)
  const core = s.physics.tiles[0];
  if (core) {
    const p = s.physics.pose(core);
    const kmh = s.physics.velocity(core, p).length() * 3.6;
    hudCtx.font = `${Math.max(12, Math.round(h / 28))}px system-ui, sans-serif`;
    hudCtx.textAlign = 'right';
    hudCtx.textBaseline = 'bottom';
    hudCtx.fillStyle = 'rgba(255,255,255,0.85)';
    hudCtx.fillText(`${kmh.toFixed(0)} km/h`, w - 12, h - 12);
    hudCtx.fillText(`${p.position.y.toFixed(1)} m`, w - 12, h - 12 - Math.round(h / 24));
    if (s.physics.wind.lengthSq() > 0) hudCtx.fillText(`wind ${s.physics.wind.length().toFixed(0)} m/s`, w - 12, h - 12 - 2 * Math.round(h / 24));
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
$('share-model').addEventListener('click', async () => {
  const text = sourceEl.value;
  const request = ++shareGeneration;
  shareUrl.value = ''; copyLink.disabled = true;
  shareStatus.textContent = 'リンクを作成しています…';
  shareDialog.showModal();
  try {
    if (!parseRc(text).body) throw new Error('Body がありません');
    const hash = await encodeHash(text);
    if (request !== shareGeneration || !shareDialog.open) return;
    const url = new URL(location.href); url.hash = `m=${hash}`;
    shareUrl.value = url.href; copyLink.disabled = false;
    shareStatus.textContent = ''; shareUrl.focus(); shareUrl.select();
  } catch (error) {
    if (request === shareGeneration && shareDialog.open) shareStatus.textContent = `リンクを作れませんでした: ${error instanceof Error ? error.message : String(error)}`;
  }
});
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
async function encodeHash(text: string): Promise<string> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(new TextEncoder().encode(text));
  void w.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function decodeHash(h: string): Promise<string> {
  const b64 = h.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(bytes);
  void w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}
async function publishHash(text: string, request: number): Promise<void> {
  const sample = SAMPLES.find((s) => s.source === text);
  const h = sample ? `#${sample.name}` : `#m=${await encodeHash(text)}`;
  if (request === loadGeneration && location.hash !== h) history.replaceState(null, '', h);
}

const loadAndShare = async (text: string, request = ++loadGeneration) => {
  if (await load(text, request)) await publishHash(text, request);
};

async function boot(): Promise<void> {
  const request = ++loadGeneration;
  const h = location.hash.slice(1);
  if (h.startsWith('m=')) {
    try {
      const text = await decodeHash(h.slice(2));
      if (request !== loadGeneration) return;
      builder.loadSource(text);
      refreshSampleButtons();
      await load(text, request);
      return;
    } catch {
      /* fall through to the sample */
    }
  }
  if (request !== loadGeneration) return;
  const idx = Math.max(0, SAMPLES.findIndex((s) => s.name === h));
  builder.loadSource(SAMPLES[idx].source);
  refreshSampleButtons();
  await loadAndShare(SAMPLES[idx].source, request);
}
builder = new BuildPanel(sourceEl, scene, statusEl, () => { ++loadGeneration; paused = true; sfx.update(0, 0); setView(1); });
void boot();
window.addEventListener('hashchange', () => void boot()); // #car / #plane / #m=... links switch models
