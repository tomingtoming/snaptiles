// The challenge UI: picking a challenge, the banner (cost, time), the clear / time-up check after every step and the
// result with the personal best and a record link. A record link carries the model, the challenge and the run from
// its first step; the receiving page replays the run, so a clear it shows has been re-run there ("確認済み").
import type { RustSimulation } from '../sim/rust-simulation';
import type { Assembly } from '../model/assemble';
import { FRAME_RATE } from '../sim/sim-view';
import { SCENARIOS, inGoal, modelCost, type Scenario } from './scenarios';

export interface ChallengeHost {
  sim(): RustSimulation | null;
  /** reload the current source with the chosen challenge (or none) */
  reload(): void;
  /** a link to the current model, challenge and run */
  recordLink(): Promise<string>;
}

interface Best { time: number; cost: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class ChallengeUI {
  active: Scenario | null = null;
  private cleared: number | null = null;
  private failed = false;
  private dialog = $<HTMLDialogElement>('challenge-dialog');
  private result = $<HTMLDialogElement>('challenge-result');
  private banner = $('challenge-banner');
  private bannerText = $('challenge-banner-text');
  private status = $('challenge-result-status');

  constructor(private host: ChallengeHost) {
    $('challenge-open').addEventListener('click', () => this.openDialog());
    $('challenge-leave').addEventListener('click', () => { this.dialog.close(); this.select(null); });
    $('challenge-quit').addEventListener('click', () => this.select(null));
    $('challenge-retry').addEventListener('click', () => { this.result.close(); this.host.reload(); });
    $('challenge-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await this.host.recordLink());
        this.status.textContent = '記録リンクをコピーしました';
      } catch {
        this.status.textContent = 'コピーできませんでした';
      }
    });
  }

  private openDialog(): void {
    const list = $('challenge-list');
    list.replaceChildren(...SCENARIOS.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(this.active?.id === s.id));
      const best = this.best(s);
      b.innerHTML = '';
      b.append(`${s.title}`);
      const small = document.createElement('small');
      small.textContent = `${s.description} 予算 ${s.budget}・制限 ${s.timeLimit} 秒${best ? `・自己ベスト ${best.time.toFixed(2)} 秒 / コスト ${best.cost}` : ''}`;
      b.append(small);
      b.addEventListener('click', () => { this.dialog.close(); this.select(s); });
      return b;
    }));
    $('challenge-leave').hidden = !this.active;
    this.dialog.showModal();
  }

  select(s: Scenario | null): void {
    this.active = s;
    this.host.reload();
  }

  /** a new simulation: a fresh start, or the same run re-run to a frame (a clear after that frame is undone) */
  attach(sim: RustSimulation, rewound: boolean): void {
    if (!rewound || this.cleared === null || sim.frame < this.cleared) { this.cleared = null; this.failed = false; }
    this.update(sim);
  }

  /** after every step: the goal and the time limit */
  afterStep(sim: RustSimulation): void {
    const s = this.active;
    if (!s || sim.scenario !== s || this.cleared !== null || this.failed) return;
    if (inGoal(s, sim.corePosition())) {
      this.cleared = sim.frame;
      this.showResult(sim, true);
    } else if (sim.frame >= s.timeLimit * FRAME_RATE) {
      this.failed = true;
      this.showResult(sim, false);
    }
  }

  /** every animation frame: the banner */
  update(sim: RustSimulation | null): void {
    const s = this.active;
    this.banner.hidden = !s || !sim;
    if (!s || !sim?.assembly) return;
    const cost = modelCost(sim.assembly);
    const time = (this.cleared ?? sim.frame) / FRAME_RATE;
    const over = cost > s.budget;
    this.banner.classList.toggle('over', over);
    const state = this.cleared !== null ? '・クリア！' : this.failed ? '・時間切れ' : '';
    const text = `お題：${s.title}｜コスト ${cost} / ${s.budget}${over ? '（予算オーバー・記録なし）' : ''}｜${time.toFixed(1)} / ${s.timeLimit} 秒${state}`;
    if (this.bannerText.textContent !== text) this.bannerText.textContent = text;
  }

  /** while building: the cost of the model being edited against the challenge's budget */
  updateBuild(assembly: Assembly | null, building: boolean): void {
    const el = $('build-cost');
    const s = this.active;
    el.hidden = !s || !building;
    if (!s || !building) return;
    const cost = assembly ? modelCost(assembly) : 0;
    const over = cost > s.budget;
    const text = `お題：${s.title}｜コスト ${cost} / ${s.budget}${over ? `（${cost - s.budget} オーバー）` : `（残り ${s.budget - cost}）`}`;
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('over', over);
  }

  private best(s: Scenario): Best | null {
    try { return JSON.parse(localStorage.getItem(`snaptiles.challenge.${s.id}`) ?? 'null') as Best | null; } catch { return null; }
  }

  private showResult(sim: RustSimulation, cleared: boolean): void {
    const s = this.active!;
    const cost = modelCost(sim.assembly!);
    const time = sim.frame / FRAME_RATE;
    const within = cost <= s.budget;
    const verified = !!sim.player && sim.replaying;
    const lua = !!sim.model.script;
    let note = '';
    if (cleared && within && !verified) {
      const best = this.best(s);
      const next: Best = { time: Math.min(time, best?.time ?? Infinity), cost: Math.min(cost, best?.cost ?? Infinity) };
      if (!best || next.time < best.time || next.cost < best.cost) {
        note = best ? '自己ベスト更新！' : '初クリア！';
        try { localStorage.setItem(`snaptiles.challenge.${s.id}`, JSON.stringify(next)); } catch { /* private mode: no best */ }
      }
    }
    const best = this.best(s);
    $('challenge-result-title').textContent = cleared ? (within ? `クリア！ ${s.title}` : `ゴール（予算オーバー）${s.title}`) : `時間切れ ${s.title}`;
    const dl = document.createElement('dl');
    const row = (k: string, v: string) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
    if (cleared) row('タイム', `${time.toFixed(2)} 秒`);
    row('コスト', `${cost} / ${s.budget}${within ? '' : '（予算オーバー：記録になりません）'}`);
    row('Lua', lua ? '使用' : 'なし');
    if (verified) row('記録', 'リンクの走りをこのブラウザで再計算して確認済み');
    if (best) row('自己ベスト', `${best.time.toFixed(2)} 秒 / コスト ${best.cost}`);
    const body = $('challenge-result-body');
    body.replaceChildren(dl);
    if (note) { const p = document.createElement('p'); p.textContent = note; body.prepend(p); }
    $('challenge-copy').hidden = !(cleared && within);
    this.status.textContent = '';
    this.result.showModal();
  }
}
