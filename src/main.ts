import { initRapier } from './physics/world';
import { SceneView } from './render/scene';
import { KeyState, KEY_TABLE } from './input/keys';
import { Simulation } from './sim/simulation';
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
    const next = new Simulation(R, source, keys);
    await next.start();
    sim = next;
    scene.rebuild(next.assembly!.tiles);
    scene.camYaw = 0.7;
    buildKeyCaps(next);
    if (next.scriptError) statusEl.textContent = next.scriptError;
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

function buildKeyCaps(s: Simulation): void {
  keysEl.replaceChildren();
  keyCaps = [];
  const used = [...new Set(s.model.keys.map((k) => k.key))].sort((a, b) => a - b);
  for (const n of used) {
    const def = KEY_TABLE[n];
    if (!def) continue;
    const el = document.createElement('div');
    el.className = 'cap';
    el.textContent = def.glyph;
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
    void load(s.source);
  });
  samplesEl.append(b);
}
function refreshSampleButtons(): void {
  [...samplesEl.children].forEach((c, i) => c.setAttribute('aria-current', String(i === current)));
}
runBtn.addEventListener('click', () => void load(sourceEl.value));
sourceEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void load(sourceEl.value);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && !(e.target instanceof HTMLTextAreaElement)) sim?.reset();
});

// ---- camera orbit ----
let dragging = false;
let lastX = 0;
let lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.focus();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  scene.camYaw -= (e.clientX - lastX) * 0.006;
  scene.camPitch = Math.max(0.05, Math.min(1.4, scene.camPitch + (e.clientY - lastY) * 0.006));
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scene.camDist = Math.max(3, Math.min(60, scene.camDist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
canvas.tabIndex = 0;

// ---- main loop ----
const FIXED = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim) {
    let n = 0;
    while (acc >= FIXED && n < 4) {
      sim.step();
      acc -= FIXED;
      n++;
    }
    if (n === 4) acc = 0;
    scene.sync(sim.physics);
    scene.follow(sim.corePosition());
    updateOverlay(sim);
  }
  scene.render();
}
function updateOverlay(s: Simulation): void {
  const lines: string[] = [];
  for (const v of s.vals.values()) if (v.disp) lines.push(`${v.name.padEnd(10)} ${fmt(v.value)}`);
  valsEl.textContent = lines.join('\n');
  outEl.textContent = s.out.join('\n').replace(/\n+$/, '');
  for (const c of keyCaps) c.el.dataset.down = String(keys.isDown(c.n));
  if (s.scriptError && statusEl.textContent !== s.scriptError) statusEl.textContent = s.scriptError;
}
function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
new ResizeObserver(() => scene.resize()).observe(canvas);
requestAnimationFrame(frame);

sourceEl.value = SAMPLES[0].source;
refreshSampleButtons();
void load(SAMPLES[0].source);
