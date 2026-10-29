import { DraftStore } from './draft';
import { ModelDocument } from './document';
import { parseRc } from '../rc/parser';
import { assemble, type Assembly } from '../model/assemble';
import type { SceneView } from '../render/scene';

const TYPES = ['Chip', 'Frame', 'Wheel', 'Rudder', 'RudderF', 'Trim', 'TrimF', 'Jet', 'Weight', 'Cowl', 'Arm', 'RLW'];
export class BuildPanel {
  active = false;
  private drafts = new DraftStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
  private restoreButton = document.getElementById('restore-draft') as HTMLButtonElement;
  document: ModelDocument;
  selected = 0;
  assembly: Assembly | null = null;
  private panel = document.getElementById('builder')!;
  private toggle = document.getElementById('build') as HTMLButtonElement;
  private tree = document.getElementById('parts') as HTMLSelectElement;
  private type = document.getElementById('part-type') as HTMLSelectElement;
  private angle = document.getElementById('part-angle') as HTMLInputElement;
  private angleControl = document.getElementById('angle-control') as HTMLSelectElement;
  private angleRow = document.getElementById('angle-control-row')!;
  private power = document.getElementById('part-power') as HTMLInputElement;
  private powerControl = document.getElementById('power-control') as HTMLSelectElement;
  private powerRow = document.getElementById('power-row')!;
  private addType = document.getElementById('add-type') as HTMLSelectElement;
  private undo = document.getElementById('edit-undo') as HTMLButtonElement;
  private redo = document.getElementById('edit-redo') as HTMLButtonElement;
  private remove = document.getElementById('part-delete') as HTMLButtonElement;
  constructor(private source: HTMLTextAreaElement, private scene: SceneView, private status: HTMLElement, private enter: () => void) {
    this.document = new ModelDocument(source.value);
    this.type.add(new Option('Core', 'Core'));
    for (const type of TYPES) { this.type.add(new Option(type, type)); this.addType.add(new Option(type, type)); }
    this.restoreButton.onclick = () => { const draft = this.drafts.read(); if (draft) this.edit(() => { this.document.restore(draft.text); this.selected = 0; }, true); };
    document.getElementById('frame-model')!.onclick = () => this.scene.frameModel();
    this.toggle.onclick = () => this.open();
    this.tree.onchange = () => { this.selected = Number(this.tree.value); this.paintSelection(); };
    this.type.onchange = () => this.edit(() => this.document.type(this.selected, this.type.value));
    this.angle.onchange = () => this.edit(() => { if (!this.angle.value.trim()) throw new Error('角度には数値を入力してください'); this.document.angle(this.selected, Number(this.angle.value)); });
    this.power.onchange = () => this.edit(() => {
      if (!this.power.value.trim()) throw new Error('出力には数値を入力してください');
      this.document.power(this.selected, Number(this.power.value));
    });
    this.powerControl.onchange = () => this.edit(() => {
      const value = this.powerControl.value;
      if (value === 'new') this.document.addPowerControl(this.selected, Math.abs(Number(this.power.value)) || 1000);
      else this.document.power(this.selected, value === 'constant' ? 0 : value);
    });
    this.angleControl.onchange = () => this.edit(() => {
      const value = this.angleControl.value;
      if (value === 'new') this.document.addSteeringControl(this.selected);
      else if (value === 'constant') this.document.fixedAngle(this.selected);
      else this.document.bindAngle(this.selected, value);
    });
    document.getElementById('new-model')!.onclick = () => this.edit(() => { this.document.newModel(); this.selected = 0; }, true);
    this.remove.onclick = () => this.edit(() => { this.document.remove(this.selected); this.selected = 0; });
    this.undo.onclick = () => this.edit(() => this.document.undo());
    this.redo.onclick = () => this.edit(() => this.document.redo());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(button => {
      button.onclick = () => this.edit(() => {
        const parent = this.document.nodes()[this.selected];
        const next = this.selected + this.document.nodes().filter(n => n.source!.start >= parent.source!.start && n.source!.end <= parent.source!.end).length;
        this.document.add(this.selected, button.dataset.edge as 'N' | 'S' | 'E' | 'W', this.addType.value);
        this.selected = next;
      });
    });
    source.addEventListener('input', () => { if (this.active) { this.document = new ModelDocument(source.value); this.refresh(); } this.saveDraft(); });
    const canvas = document.getElementById('view')!;
    let down: { x: number; y: number; id: number } | null = null;
    canvas.addEventListener('pointerdown', e => { down = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null; });
    canvas.addEventListener('pointercancel', () => { down = null; });
    canvas.addEventListener('pointerup', e => {
      if (this.active && down?.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const id = this.scene.pickTile(e.clientX, e.clientY);
        if (id !== null) { this.selected = id; this.paintSelection(); }
      }
      down = null;
    });
  }
  open(): void {
    if (this.document.text !== this.source.value.replace(/\r\n?/g, '\n')) this.document = new ModelDocument(this.source.value);
    this.active = true; this.selected = 0;
    this.panel.hidden = false; this.toggle.setAttribute('aria-pressed', 'true');
    document.body.classList.add('building');
    this.paintDraft(); this.enter(); this.scene.setView('orbit'); this.refresh(true);
  }
  close(): void {
    this.active = false; this.panel.hidden = true;
    this.toggle.setAttribute('aria-pressed', 'false'); document.body.classList.remove('building');
    this.scene.selectTile(null);
  }
  private edit(action: () => void, fit = false): void {
    try { action(); this.source.value = this.document.text; this.refresh(fit); this.saveDraft(); }
    catch (e) { this.status.textContent = e instanceof Error ? e.message : String(e); }
  }
  private paintDraft(): void {
    const draft = this.drafts.read();
    this.restoreButton.hidden = !draft || draft.text === this.source.value;
  }
  private saveDraft(): void {
    if (!this.drafts.save(this.source.value)) this.status.textContent ||= '下書きを保存できません。保存ボタンでファイルに残してください。';
    this.paintDraft();
  }
  private refresh(fit = false): void {
    try {
      const model = parseRc(this.document.text);
      const values = new Map(model.vals.map(v => [v.name.toUpperCase(), v.default]));
      const env = (name: string) => values.get(name.toUpperCase());
      const assembly = assemble(model, env);
      if (!assembly) throw new Error('BodyとCoreが必要です');
      this.assembly = assembly;
      this.scene.preview(assembly.tiles, env);
      this.tree.replaceChildren();
      for (const t of assembly.tiles) {
        let depth = 0, parent = t.parent; while (parent) { depth++; parent = parent.parent; }
        this.tree.add(new Option(`${'　'.repeat(depth)}${t.dir ? t.dir + ': ' : ''}${t.node.type}${t.name ? ' · ' + t.name : ''}`, String(t.id)));
      }
      this.selected = Math.min(this.selected, assembly.tiles.length - 1);
      if (fit) this.scene.frameModel();
      this.status.textContent = ''; this.paintSelection();
      this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(b => b.disabled = false);
    } catch (e) {
      this.assembly = null; this.tree.replaceChildren(); this.scene.selectTile(null);
      this.type.disabled = this.angle.disabled = this.remove.disabled = true;
      this.powerRow.hidden = this.angleRow.hidden = true;
      this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(b => b.disabled = true);
      this.status.textContent = e instanceof Error ? e.message : String(e);
    }
    this.undo.disabled = !this.document.undoStack.length; this.redo.disabled = !this.document.redoStack.length;
  }
  private paintSelection(): void {
    const tile = this.assembly?.tiles[this.selected]; if (!tile) return;
    this.tree.value = String(this.selected); this.scene.selectTile(tile.id);
    this.type.value = TYPES.find(t => t.toLowerCase() === tile.type) ?? 'Core';
    this.type.disabled = !tile.parent;
    const angle = tile.node.attrs.angle ?? '0';
    this.angle.value = angle.replace(/\s/g, '');
    this.angle.disabled = !tile.parent || !Number.isFinite(Number(angle.replace(/\s/g, '')));
    this.angle.title = this.angle.disabled && tile.parent ? `ソースで編集: ${angle}` : '';
    this.angleRow.hidden = !tile.parent || !['rudder', 'rudderf', 'trim', 'trimf'].includes(tile.type);
    this.angleControl.replaceChildren(new Option('固定', 'constant'));
    for (const v of parseRc(this.document.text).vals) this.angleControl.add(new Option(v.name, v.name.toUpperCase()));
    const angleExpression = angle.replace(/\s/g, '').toUpperCase();
    const fixedAngle = Number.isFinite(Number(angleExpression));
    if (!fixedAngle && ![...this.angleControl.options].some(o => o.value === angleExpression)) this.angleControl.add(new Option(angle, angleExpression));
    this.angleControl.add(new Option('← / → を追加', 'new'));
    this.angleControl.value = fixedAngle ? 'constant' : angleExpression;
    this.powerRow.hidden = !['wheel', 'rlw', 'jet', 'arm'].includes(tile.type);
    const power = (tile.node.attrs.power ?? '0').replace(/\s/g, '');
    const constant = Number.isFinite(Number(power));
    this.power.value = power; this.power.disabled = !constant;
    this.powerControl.replaceChildren(new Option('固定', 'constant'));
    for (const v of parseRc(this.document.text).vals) {
      this.powerControl.add(new Option(v.name, v.name.toUpperCase()));
      this.powerControl.add(new Option(`${v.name}（逆）`, `-${v.name.toUpperCase()}`));
    }
    if (!constant && ![...this.powerControl.options].some(o => o.value === power.toUpperCase())) this.powerControl.add(new Option(power, power.toUpperCase()));
    this.powerControl.add(new Option('↑ / ↓ を追加', 'new'));
    this.powerControl.value = constant ? 'constant' : power.toUpperCase();
    this.remove.disabled = !tile.parent;
    this.remove.textContent = tile.children.length ? '枝ごと削除' : '削除';
  }
}
