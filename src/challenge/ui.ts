// The challenge UI: picking a challenge, the banner (cost, time), the clear / time-up check after every step and the
// result with the personal best and a record link. A record link carries the model, the challenge and the run from
// its first step; the receiving page replays the run, so a clear it shows has been re-run there ("確認済み").
import type { RustSimulation } from '../sim/rust-simulation';
import { TerrainMap } from './terrain-map';
import type { Assembly } from '../model/assemble';
import { FRAME_RATE } from '../sim/sim-view';
import { FREE_DRIVES, MISSIONS, SCENARIOS, scenarioById, costBreakdown, inGoal, modelCost, type Scenario } from './scenarios';

export interface ChallengeHost {
  sim(): RustSimulation | null;
  /** reload the current source with the chosen challenge (or none); `source` replaces it first (a mission's model) */
  reload(source?: string): void;
  /** a link to the current model, challenge and run */
  recordLink(finishFrame: number): Promise<string>;
  editLesson(): void;
}

interface Best { time: number; cost: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class ChallengeUI {
  active: Scenario | null = null;
  private cleared: number | null = null;
  private failed = false;
  private terrainMap = new TerrainMap();
  private dialog = $<HTMLDialogElement>('challenge-dialog');
  private result = $<HTMLDialogElement>('challenge-result');
  private banner = $('challenge-banner');
  private bannerText = $('challenge-banner-text');
  private status = $('challenge-result-status');

  constructor(private host: ChallengeHost) {
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-course-section]').forEach(button => {
      button.addEventListener('click', () => {
        const heading = $(button.dataset.courseSection!);
        heading.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
      });
    });
    $('brake-retry').addEventListener('click', () => this.host.reload());
    $('challenge-open').addEventListener('click', () => this.openDialog());
    $('course-restart').addEventListener('click', () => { this.dialog.close(); this.host.reload(); });
    $('challenge-leave').addEventListener('click', () => { this.dialog.close(); this.select(null); });
    $('mission-edit').addEventListener('click', () => this.host.editLesson());
    $('brake-compare').addEventListener('click', () => {
      const road = scenarioById(this.active?.compareRoad?.id);
      if (road) this.select(road);
    });
    $('challenge-quit').addEventListener('click', () => this.select(null));
    $('challenge-retry').addEventListener('click', () => { this.result.close(); this.host.reload(); });
    $('challenge-copy').addEventListener('click', async () => {
      if (this.cleared === null) return;
      try {
        await navigator.clipboard.writeText(await this.host.recordLink(this.cleared));
        this.status.textContent = '記録リンクをコピーしました';
      } catch {
        this.status.textContent = 'コピーできませんでした';
      }
    });
  }

  private openDialog(): void {
    const button = (s: Scenario) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(this.active?.id === s.id));
      const best = s.freeDrive ? null : this.best(s);
      b.append(s.title);
      const small = document.createElement('small');
      const limits = s.mission ? `制限 ${s.timeLimit} 秒` : `予算 ${s.budget}・制限 ${s.timeLimit} 秒`;
      const record = best ? (s.mission ? `・自己ベスト ${best.time.toFixed(2)} 秒` : `・自己ベスト ${best.time.toFixed(2)} 秒 / コスト ${best.cost}`) : '';
      small.textContent = s.freeDrive ? s.description : `${s.description} ${limits}${record}`;
      b.append(small);
      b.addEventListener('click', () => { this.dialog.close(); this.select(s); });
      return b;
    };
    const heading = (id: string, text: string) => {
      const h = document.createElement('h3');
      h.id = id;
      h.tabIndex = -1;
      h.textContent = text;
      return h;
    };
    $('challenge-list').replaceChildren(
      heading('course-free', '自由走行'),
      ...FREE_DRIVES.map(s => button(this.active?.compareRoad?.id === s.id ? this.active : s)),
      heading('course-trials', 'お題（予算内で組んでゴールへ）'), ...SCENARIOS.map(button),
      heading('course-lessons', 'ミッション（Luaで制御の練習。機体はミッションのものに替わります）'), ...MISSIONS.map(button),
    );
    $('course-restart').hidden = !this.active;
    $('challenge-leave').hidden = !this.active;
    this.dialog.showModal();
  }

  select(s: Scenario | null): void {
    this.active = s;
    this.host.reload(s?.mission?.starter);
  }

  /** a new simulation: a fresh start, or the same run re-run to a frame (a clear after that frame is undone) */
  attach(sim: RustSimulation, rewound: boolean): void {
    if (!rewound) {
      this.result.close();
      this.dialog.close();
    }
    $('mission-edit').hidden = !sim.scenario?.mission;
    $('brake-retry').hidden = true;
    const compare = $('brake-compare');
    compare.hidden = !sim.scenario?.compareRoad;
    compare.textContent = sim.scenario?.compareRoad?.label ?? '';
    if (rewound && sim.missionProgress) {
      this.cleared = sim.missionProgress.clearedAt;
      this.failed = this.cleared === null && sim.frame >= sim.missionProgress.scenario.timeLimit * FRAME_RATE;
    } else if (!rewound || this.cleared === null || sim.frame < this.cleared) {
      this.cleared = null;
      this.failed = false;
    }
    this.update(sim);
  }

  /** after every step: the goal and the time limit */
  afterStep(sim: RustSimulation): void {
    const s = this.active;
    if (!s || s.freeDrive || sim.scenario !== s || this.cleared !== null || this.failed) return;
    const done = s.rings ? sim.ringsPassed === s.rings.length : s.mission
      ? sim.missionProgress?.clearedAt != null
      : (!s.checkpoint || sim.checkpointPassed) && inGoal(s, sim.corePosition())
        && (!s.brakingTest || sim.coreVelocity().length() * 3.6 <= s.brakingTest.stopKmh);
    if (done) {
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
    this.terrainMap.update(s, sim?.physics.tiles[0], !!sim?.checkpointPassed, sim?.ringsPassed ?? 0);
    this.banner.hidden = !s || !sim;
    if (!s || !sim?.assembly) return;
    if (s.freeDrive) {
      this.banner.classList.remove('over');
      let title = s.title;
      if (s.brakeLine !== undefined) {
        const distance = sim.corePosition().z - s.brakeLine;
        title += distance > 0 ? '｜基準線まで ' + distance.toFixed(1) + 'm' : '｜基準線から ' + (-distance).toFixed(1) + 'm';
      }
      if (this.bannerText.textContent !== title) this.bannerText.textContent = title;
      return;
    }
    const cost = modelCost(sim.assembly);
    const time = (this.cleared ?? sim.frame) / FRAME_RATE;
    const over = !s.mission && cost > s.budget;
    this.banner.classList.toggle('over', over);
    const state = this.cleared !== null ? '・クリア！' : this.failed ? '・時間切れ' : '';
    const checkpoint = s.checkpoint ? (!sim.checkpointPassed ? '｜黄色の中間地点へ' : '｜中間地点通過・緑のゴールへ') : '';
    let driving = checkpoint;
    if (s.brakingTest) {
      const entry = sim.brakingEntryKmh;
      const slow = entry !== undefined && !sim.checkpointPassed;
      $('brake-retry').hidden = !slow;
      // Round down so a measured 35.99 never reads as a qualifying 36.0.
      const measured = entry === undefined ? '' : '進入 ' + (Math.floor(entry * 10) / 10).toFixed(1) + 'km/h・';
      driving = sim.checkpointPassed
        ? `｜${measured}緑枠内で${s.brakingTest.stopKmh}km/h以下`
        : `｜${measured}黄色に${s.brakingTest.entryKmh}km/h以上で進入${slow ? '（速度不足）' : ''}`;
    }
    if (s.rings) {
      const next = s.rings[sim.ringsPassed];
      driving = next ? `｜次はリング ${sim.ringsPassed + 1} / ${s.rings.length}（中心高度${next.center[1]}m）` : '｜全リング通過';
    }
    const zone = !sim.checkpointPassed && s.checkpoint ? s.checkpoint : s.goal;
    const altitude = s.showGateAltitude && zone ? `（高度${zone[2]}〜${zone[3]}m）` : '';
    let hint = s.mission?.hint;
    if (s.mission?.hold.kind === 'clearance' && sim.groundRange !== undefined) {
      const range = sim.groundRange;
      const height = sim.corePosition().y.toFixed(1);
      hint = `標高 _Y ${height}m｜対地高 _H ${range < 0 ? '範囲外' : range.toFixed(1) + 'm'}（目標 ${s.mission.hold.min}〜${s.mission.hold.max}m）`;
    }
    const text = s.mission
      ? `ミッション：${s.title}｜${s.mission.via ? (sim.missionProgress?.visitedAt != null ? '折り返し済み｜' : '折り返しはまだ｜') : ''}保持 ${((sim.missionProgress?.held ?? 0) / FRAME_RATE).toFixed(1)} / ${s.mission.hold.seconds} 秒｜${time.toFixed(1)} / ${s.timeLimit} 秒${state}｜${hint}`
      : `お題：${s.title}｜コスト ${cost} / ${s.budget}${over ? '（予算オーバー・記録なし）' : ''}｜${time.toFixed(1)} / ${s.timeLimit} 秒${state}${driving}${altitude}`;
    if (this.bannerText.textContent !== text) this.bannerText.textContent = text;
  }

  /** while building: the cost of the model being edited against the challenge's budget */
  updateBuild(assembly: Assembly | null, building: boolean): void {
    const el = $('build-cost');
    const s = this.active?.mission || this.active?.freeDrive ? null : this.active;
    el.hidden = !s || !building;
    if (!s || !building) return;
    const cost = assembly ? modelCost(assembly) : 0;
    const over = cost > s.budget;
    const parts = assembly ? costBreakdown(assembly) : '';
    const text = `お題：${s.title}｜コスト ${cost} / ${s.budget}${over ? `（${cost - s.budget} オーバー）` : `（残り ${s.budget - cost}）`}${parts ? `｜${parts}` : ''}`;
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
    // Results judge the completed frame, including the final one in the recording.
    const verified = !!sim.player && sim.frame > 0 && sim.frame <= sim.player.frames;
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
    if (!s.mission) row('コスト', `${cost} / ${s.budget}${within ? '' : '（予算オーバー：記録になりません）'}`);
    if (cleared && s.brakingTest && sim.brakingEntryKmh !== undefined) {
      row('進入速度', sim.brakingEntryKmh.toFixed(1) + ' km/h');
      row('停止判定時', (sim.coreVelocity().length() * 3.6).toFixed(2) + ' km/h');
      if (s.brakeLine !== undefined) row('白線からの停止位置', (s.brakeLine - sim.corePosition().z).toFixed(2) + ' m先');
    }
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
