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
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
window.addEventListener('keydown', () => sfx.unlock(), { capture: true });
const muteBtn = $<HTMLButtonElement>('mute');
const paintMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(sfx.muted)); };
muteBtn.addEventListener('click', () => { sfx.setMuted(!sfx.muted); paintMute(); });
paintMute();
(window as unknown as { __sfx: Sfx }).__sfx = sfx; // probe hook
let lastShells = 0;
let lastCoreVel: { x: number; y: number; z: number } | null = null;
const scene = new SceneView(canvas);
let sim: Simulation | null = null;
let keyCaps: { el: HTMLElement; n: number }[] = [];

const R = await initRapier();

async function load(source: string): Promise<void> {
  statusEl.textContent = '';
  const old = sim;
  sim = null;
  if (old) await old.lua.dispose();
  try {
    const t0 = performance.now();
    const next = new Simulation(R, source, keys);
    const t1 = performance.now();
    await next.start();
    const t2 = performance.now();
    sim = next;
    (window as unknown as { __sim: Simulation }).__sim = next; // probe hook for tools/
    scene.rebuild(next.assembly!.tiles, next.env);
    const t3 = performance.now();
    (window as unknown as { __loadTimes: number[] }).__loadTimes = [t1 - t0, t2 - t1, t3 - t2].map((v) => Math.round(v)); // parse, physics+script, meshes
    scene.camYaw = 0.7;
    scene.snap(next.corePosition());
    buildKeyCaps(next);
    if (next.scriptError) statusEl.textContent = next.scriptError;
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

function buildKeyCaps(s: Simulation): void {
  keysEl.replaceChildren();
  keyCaps = [];
  // keys bound in Key{} plus any _KEY(n) literal the script polls
  const polled = [...(s.model.script?.source.matchAll(/_KEY(?:DOWN|UP)?\s*\(\s*(\d+)\s*\)/g) ?? [])].map((m) => Number(m[1]));
  const used = [...new Set([...s.model.keys.map((k) => k.key), ...polled])].sort((a, b) => a - b);
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
      keys.press(n);
    });
    const up = () => keys.release(n);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    keysEl.append(el);
    keyCaps.push({ el, n });
  }
}

// ---- samples ----
let current = 0;
for (const [i, s] of SAMPLES.entries()) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s.name;
  b.addEventListener('click', () => {
    current = i;
    sourceEl.value = s.source;
    refreshSampleButtons();
    void loadAndShare(s.source);
  });
  samplesEl.append(b);
}
function refreshSampleButtons(): void {
  [...samplesEl.children].forEach((c, i) => c.setAttribute('aria-current', String(i === current)));
}
runBtn.addEventListener('click', () => void loadAndShare(sourceEl.value));
sourceEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void loadAndShare(sourceEl.value);
    return;
  }
  if (e.key === 'Tab') {
    // keep Tab in the editor (model files are tab-indented)
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value } = sourceEl;
    sourceEl.value = value.slice(0, a) + '	' + value.slice(b);
    sourceEl.selectionStart = sourceEl.selectionEnd = a + 1;
  }
});
window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLTextAreaElement;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    // save the editor contents as a model file
    e.preventDefault();
    const blob = new Blob([sourceEl.value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${SAMPLES[current]?.name ?? 'model'}.rcd`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  if (typing) return;
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
    if (pinchDist > 0) scene.camDist = Math.max(3, Math.min(60, scene.camDist * (pinchDist / Math.max(1, d))));
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
  touches.delete(e.pointerId);
  dragging = false;
  pinchDist = 0;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
(window as unknown as { __scene: SceneView }).__scene = scene; // probe hook
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.camDist = Math.max(3, Math.min(60, scene.camDist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
canvas.tabIndex = 0;

// ---- main loop ----
let acc = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim) {
    const FIXED = sim.frameDt();
    let n = 0;
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
    drawHud(sim.lines2d);
    if (!dragging && performance.now() - lastDrag > 3000) scene.chaseYaw(sim.coreHeading());
    scene.follow(sim.corePosition());
    updateOverlay(sim);
    updateSound(sim);
  }
  scene.render();
}
function updateSound(s: Simulation): void {
  let spin = 0;
  let jet = 0;
  for (const tb of s.physics.tiles) {
    if (tb.tile.spec.wheel) {
      const w = tb.body.angvel();
      spin = Math.max(spin, Math.hypot(w.x, w.y, w.z));
    }
    if (tb.tile.spec.jet) jet += Math.abs(tb.jetPower);
  }
  sfx.update(spin, jet);
  const shells = s.physics.projectiles.length;
  if (shells > lastShells) sfx.fire();
  lastShells = shells;
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
function drawHud(buf: number[]): void {
  const w = hud.clientWidth;
  const h = hud.clientHeight;
  if (hud.width !== w || hud.height !== h) {
    hud.width = w;
    hud.height = h;
  }
  hudCtx.clearRect(0, 0, w, h);
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
new ResizeObserver(() => scene.resize()).observe(canvas);
requestAnimationFrame(frame);

// ---- files in, links out ----
// Drop a .rc/.txt onto the editor to load it; the model travels in the URL hash so a link is a share.
sourceEl.addEventListener('dragover', (e) => e.preventDefault());
sourceEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  const text = await readModelFile(f);
  sourceEl.value = text;
  current = -1;
  refreshSampleButtons();
  void loadAndShare(text);
});
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
async function publishHash(text: string): Promise<void> {
  const sample = SAMPLES.find((s) => s.source === text);
  const h = sample ? `#${sample.name}` : `#m=${await encodeHash(text)}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

const origLoad = load;
const loadAndShare = async (text: string) => {
  await origLoad(text);
  await publishHash(text);
};

async function boot(): Promise<void> {
  const h = location.hash.slice(1);
  if (h.startsWith('m=')) {
    try {
      const text = await decodeHash(h.slice(2));
      sourceEl.value = text;
      current = -1;
      refreshSampleButtons();
      await origLoad(text);
      return;
    } catch {
      /* fall through to the sample */
    }
  }
  const idx = Math.max(0, SAMPLES.findIndex((s) => s.name === h));
  current = idx;
  sourceEl.value = SAMPLES[idx].source;
  refreshSampleButtons();
  await loadAndShare(SAMPLES[idx].source);
}
void boot();
window.addEventListener('hashchange', () => void boot()); // #car / #plane / #m=... links switch models
