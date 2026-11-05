// The debug panel under the 3D view: a timeline over the recorded run (rewind = re-run to a frame, the core repeats
// a run exactly), frame stepping, the watch list (Vals and the Lua block's own globals), a graph of chosen values
// and breakpoints (a step that runs a breakpoint line pauses the page and shows the locals at that line).
import type { Breakpoint, RustSimulation } from '../sim/rust-simulation';
import type { Recording } from '../sim/replay';
import { FRAME_RATE } from '../sim/sim-view';

export interface DebugHost {
  sim(): RustSimulation | null;
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** replace the running simulation with one re-run to `frame` of `timeline` */
  seek(frame: number, timeline: Recording): Promise<void>;
  /** one step while paused */
  step(): void;
  /** run the script to its next line (mid-frame) */
  stepLine(): void;
  source: HTMLTextAreaElement;
}

const HISTORY = 600;
const GRAPH_FRAMES = 300;
const COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#fff176'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class DebugPanel {
  readonly panel = $<HTMLElement>('debug');
  private toggle = $<HTMLButtonElement>('debug-toggle');
  private slider = $<HTMLInputElement>('debug-timeline');
  private frameLabel = $('debug-frame');
  private playButton = $<HTMLButtonElement>('debug-play');
  private watchBody = $('debug-watch-body');
  private graph = $<HTMLCanvasElement>('debug-graph');
  private legend = $('debug-legend');
  private bpInput = $<HTMLInputElement>('debug-bp-line');
  private bpList = $('debug-bp-list');
  private breakInfo = $('debug-break');
  private rows = new Map<string, { row: HTMLElement; value: HTMLElement; box: HTMLInputElement }>();
  /** names drawn in the graph */
  private plotted: string[] = [];
  /** per frame: the numeric value of every plotted name */
  private history = new Map<number, Map<string, number>>();
  private breakpoints: Breakpoint[] = [];
  private consoleHistory: string[] = [];
  private consoleIndex = 0;
  private seeking = false;
  private lastWatch = 0;
  /** the run the timeline spans: what a rewind re-runs (kept when rewinding, replaced when the run goes on live) */
  private timelineRun: Recording | null = null;

  constructor(private host: DebugHost) {
    this.toggle.addEventListener('click', () => this.setOpen(this.panel.hidden));
    $('debug-start').addEventListener('click', () => void this.seek(0));
    $('debug-back').addEventListener('click', () => void this.stepBack());
    $('debug-forward').addEventListener('click', () => this.stepForward());
    this.playButton.addEventListener('click', () => this.host.setPaused(!this.host.paused()));
    $('debug-replay').addEventListener('click', () => void this.seek(0).then(() => this.host.setPaused(false)));
    this.slider.addEventListener('input', () => { this.host.setPaused(true); this.frameLabel.textContent = this.label(Number(this.slider.value)); });
    this.slider.addEventListener('change', () => void this.seek(Number(this.slider.value)));
    const addFromInputs = (line: number) => {
      const cond = $<HTMLInputElement>('debug-bp-cond'), after = $<HTMLInputElement>('debug-bp-after');
      this.addBreakpoint(line, cond.value.trim() || undefined, Number(after.value) || undefined);
      cond.value = ''; after.value = '';
    };
    $('debug-bp-add').addEventListener('click', () => addFromInputs(Number(this.bpInput.value)));
    for (const id of ['debug-bp-line', 'debug-bp-cond', 'debug-bp-after']) {
      $(id).addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); addFromInputs(Number(this.bpInput.value)); } });
    }
    const consoleInput = $<HTMLInputElement>('debug-console');
    consoleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && consoleInput.value.trim()) { e.preventDefault(); this.runConsole(consoleInput.value.trim()); consoleInput.value = ''; }
      else if (e.key === 'ArrowUp' && this.consoleHistory.length) {
        e.preventDefault(); this.consoleIndex = Math.max(0, this.consoleIndex - 1); consoleInput.value = this.consoleHistory[this.consoleIndex];
      } else if (e.key === 'ArrowDown' && this.consoleHistory.length) {
        e.preventDefault(); this.consoleIndex = Math.min(this.consoleHistory.length, this.consoleIndex + 1); consoleInput.value = this.consoleHistory[this.consoleIndex] ?? '';
      }
    });
    $('debug-bp-caret').addEventListener('click', () => {
      const s = this.host.source;
      addFromInputs(s.value.slice(0, s.selectionStart).split('\n').length);
    });
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-pressed', String(open));
    document.body.classList.toggle('debugging', open);
  }

  /** the longest run reachable from here: the replay being played, else the run being recorded */
  timeline(sim: RustSimulation): Recording {
    const t = this.timelineRun;
    if (t && sim.replaying && sim.player === t) return t;
    this.timelineRun = sim.player && sim.player.frames > sim.recording.frames && sim.replaying ? sim.player : sim.recording;
    return this.timelineRun;
  }

  /** a new simulation: a new model (history cleared) or the same run re-run to a frame (history kept up to it) */
  attach(sim: RustSimulation, rewound: boolean): void {
    if (rewound) {
      for (const f of [...this.history.keys()]) if (f > sim.frame) this.history.delete(f);
    } else {
      this.history.clear();
      this.timelineRun = null;
      this.breakInfo.hidden = true;
    }
    sim.setBreakpoints(this.breakpoints);
  }

  /** after every step: sample the graph (every numeric value while the panel is open, so a value ticked later has its
   *  past), and pause on a breakpoint (returns true to stop stepping this frame) */
  afterStep(sim: RustSimulation): boolean {
    if (this.open) {
      this.history.set(sim.frame, this.numbers(sim));
      this.history.delete(sim.frame - HISTORY);
    }
    if (!sim.breakHit) return false;
    this.host.setPaused(true);
    this.showBreak(sim);
    if (!this.open) this.setOpen(true);
    return true;
  }

  /** every animation frame */
  update(sim: RustSimulation | null): void {
    if (!this.open || !sim) return;
    const timeline = this.timeline(sim);
    this.slider.max = String(Math.max(timeline.frames, sim.frame));
    if (!this.seeking && document.activeElement !== this.slider) {
      this.slider.value = String(sim.frame);
      this.frameLabel.textContent = this.label(sim.frame);
    }
    this.playButton.textContent = this.host.paused() ? '▶' : '⏸';
    this.playButton.setAttribute('aria-label', this.host.paused() ? '再生' : '一時停止');
    const now = performance.now();
    if (now - this.lastWatch > 100) {
      this.lastWatch = now;
      this.renderWatch(sim);
    }
    this.drawGraph(sim.frame);
  }

  private label(frame: number): string {
    return `${frame} フレーム（${(frame / FRAME_RATE).toFixed(2)} 秒）`;
  }

  async seek(frame: number): Promise<void> {
    const sim = this.host.sim();
    if (!sim || this.seeking) return;
    this.seeking = true;
    this.host.setPaused(true);
    try {
      const timeline = this.timeline(sim);
      await this.host.seek(Math.max(0, Math.min(frame, timeline.frames)), timeline);
    } finally { this.seeking = false; }
  }

  stepForward(): void {
    this.host.setPaused(true);
    this.host.step();
  }

  async stepBack(): Promise<void> {
    const sim = this.host.sim();
    if (sim && sim.frame > 0) await this.seek(sim.frame - 1);
  }

  private numbers(sim: RustSimulation): Map<string, number> {
    const out = new Map<string, number>();
    for (const v of sim.vals.values()) out.set(v.name, v.value);
    for (const [n, v] of sim.luaWatch()) { const x = Number(v); if (v !== '' && Number.isFinite(x)) out.set(n, x); }
    return out;
  }

  private renderWatch(sim: RustSimulation): void {
    const entries: [string, string, string][] = [...sim.vals.values()].map((v) => ['Val', v.name, String(Math.round(v.value * 1000) / 1000)]);
    for (const [n, v] of sim.luaWatch()) entries.push(['Lua', n, v]);
    const seen = new Set<string>();
    for (const [kind, name, value] of entries) {
      seen.add(name);
      let r = this.rows.get(name);
      if (!r) {
        const row = document.createElement('label');
        row.className = 'watch-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.title = 'グラフに表示';
        box.addEventListener('change', () => this.setPlotted(name, box.checked));
        const tag = document.createElement('span'); tag.className = 'watch-kind'; tag.textContent = kind;
        const n = document.createElement('span'); n.className = 'watch-name'; n.textContent = name;
        const v = document.createElement('span'); v.className = 'watch-value';
        row.append(box, tag, n, v);
        this.watchBody.append(row);
        r = { row, value: v, box };
        this.rows.set(name, r);
      }
      if (r.value.textContent !== value) {
        r.value.textContent = value;
        r.row.classList.remove('changed'); void r.row.offsetWidth; r.row.classList.add('changed');
      }
    }
    for (const [name, r] of this.rows) if (!seen.has(name)) { r.row.remove(); this.rows.delete(name); this.setPlotted(name, false); }
    $('debug-watch-empty').hidden = this.rows.size > 0;
  }

  private setPlotted(name: string, on: boolean): void {
    this.plotted = this.plotted.filter((n) => n !== name);
    if (on) this.plotted.push(name);
    if (this.plotted.length > COLORS.length) {
      const dropped = this.plotted.shift()!;
      const r = this.rows.get(dropped); if (r) r.box.checked = false;
    }
    this.legend.replaceChildren(...this.plotted.map((n, i) => {
      const s = document.createElement('span'); s.textContent = n; s.style.color = COLORS[i]; return s;
    }));
  }

  private drawGraph(frame: number): void {
    const c = this.graph, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (!this.plotted.length) {
      g.fillStyle = '#8a939c'; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ウォッチの☐で値を選ぶとグラフに出ます', w / 2, h / 2);
      return;
    }
    const from = frame - GRAPH_FRAMES;
    let lo = Infinity, hi = -Infinity;
    for (let f = from; f <= frame; f++) {
      const sample = this.history.get(f);
      for (const n of this.plotted) { const v = sample?.get(n); if (v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    }
    if (!Number.isFinite(lo)) return;
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const y = (v: number) => h - 14 - ((v - lo) / (hi - lo)) * (h - 28);
    g.strokeStyle = '#39424c'; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); if (lo <= 0 && hi >= 0) g.stroke();
    this.plotted.forEach((name, i) => {
      g.strokeStyle = COLORS[i]; g.lineWidth = 1.5; g.beginPath();
      let started = false;
      for (let f = from; f <= frame; f++) {
        const v = this.history.get(f)?.get(name);
        if (v === undefined) { started = false; continue; }
        const x = ((f - from) / GRAPH_FRAMES) * w;
        if (started) g.lineTo(x, y(v)); else { g.moveTo(x, y(v)); started = true; }
      }
      g.stroke();
    });
    g.fillStyle = '#8a939c'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'left';
    g.textBaseline = 'top'; g.fillText(String(Math.round(hi * 1000) / 1000), 4, 2);
    g.textBaseline = 'bottom'; g.fillText(String(Math.round(lo * 1000) / 1000), 4, h - 2);
  }

  /** file lines with a breakpoint (the source view marks them) */
  breakpointLines(): number[] {
    return this.breakpoints.map((b) => b.line);
  }

  toggleBreakpoint(line: number): void {
    if (this.breakpoints.some((b) => b.line === line)) this.removeBreakpoint(line);
    else this.addBreakpoint(line);
  }

  /** a breakpoint at a file line; `condition` (Lua, sees the line's locals) and `after` (stop from that pass on) */
  addBreakpoint(line: number, condition?: string, after?: number): void {
    if (!Number.isInteger(line) || line < 1) return;
    const rest = this.breakpoints.filter((b) => b.line !== line);
    this.breakpoints = [...rest, { line, condition, after: after && after > 1 ? Math.floor(after) : undefined }].sort((a, b) => a.line - b.line);
    this.applyBreakpoints();
  }

  removeBreakpoint(line: number): void {
    this.breakpoints = this.breakpoints.filter((b) => b.line !== line);
    this.applyBreakpoints();
  }

  private applyBreakpoints(): void {
    this.host.sim()?.setBreakpoints(this.breakpoints);
    this.bpList.replaceChildren(...this.breakpoints.map((bp) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'bp';
      const extra = [bp.condition ? `${bp.condition}` : '', bp.after ? `${bp.after}回目〜` : ''].filter(Boolean).join('・');
      b.textContent = `${bp.line}行${extra ? `（${extra}）` : ''} ×`;
      b.setAttribute('aria-label', `${bp.line}行目のブレークポイントを外す`);
      b.addEventListener('click', () => this.removeBreakpoint(bp.line));
      return b;
    }));
  }

  /** a console line: evaluated in the running block (recorded, so a rewind repeats it) */
  private runConsole(code: string): void {
    const sim = this.host.sim();
    this.consoleHistory.push(code);
    this.consoleIndex = this.consoleHistory.length;
    const log = $('debug-console-log');
    const line = (cls: string, text: string) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; log.append(d); };
    line('console-in', `> ${code}`);
    if (!sim) { line('console-err', '実行中のモデルがありません'); return; }
    const r = sim.evalLua(code);
    line(r.ok ? 'console-out' : 'console-err', r.ok ? r.text : `エラー：${r.text}`);
    while (log.childElementCount > 40) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  }

  /** the line the script is suspended at (the source view marks it), or null */
  pausedLine(): number | null {
    const sim = this.host.sim();
    return sim?.midFrame && sim.breakHit ? sim.breakHit.line : null;
  }

  /** run the suspended frame to its end, past any breakpoint */
  finishFrame(): void {
    const sim = this.host.sim();
    if (!sim?.midFrame) return;
    sim.setBreakpoints([]);
    this.host.step();
    sim.setBreakpoints(this.breakpoints);
    this.breakInfo.hidden = true;
  }

  private showBreak(sim: RustSimulation): void {
    const hit = sim.breakHit!;
    this.breakInfo.hidden = false;
    const head = document.createElement('div');
    head.className = 'break-head';
    head.textContent = sim.midFrame
      ? `${hit.line}行目で一時停止中（${sim.frame} フレーム目の途中。この行はまだ実行していません）`
      : `${hit.line}行目で停止（${sim.frame} フレーム目）`;
    const go = document.createElement('button');
    go.type = 'button'; go.textContent = '行へ';
    go.addEventListener('click', () => {
      const s = this.host.source, lines = s.value.split('\n');
      const start = lines.slice(0, hit.line - 1).reduce((n, l) => n + l.length + 1, 0);
      s.focus(); s.setSelectionRange(start, start + (lines[hit.line - 1]?.length ?? 0));
    });
    head.append(' ', go);
    if (sim.midFrame) {
      const controls = document.createElement('div');
      controls.className = 'break-controls';
      const button = (label: string, title: string, action: () => void) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title;
        b.addEventListener('click', action); controls.append(b);
      };
      button('次の行', 'この行を実行して、次に実行する行で止まる', () => this.host.stepLine());
      button('このフレームを最後まで', 'ブレークポイントで止まらずにこのフレームを終える', () => this.finishFrame());
      button('続行', '再生を続ける（次のブレークポイントで止まる）', () => this.host.setPaused(false));
      head.append(controls);
    }
    const list = document.createElement('div');
    list.className = 'break-locals';
    if (!hit.locals.length) list.textContent = 'ローカル変数なし';
    for (const [n, v] of hit.locals) {
      const row = document.createElement('div');
      const a = document.createElement('span'); a.className = 'watch-name'; a.textContent = n;
      const b = document.createElement('span'); b.className = 'watch-value'; b.textContent = v;
      row.append(a, ' = ', b);
      list.append(row);
    }
    this.breakInfo.replaceChildren(head, list);
  }
}
