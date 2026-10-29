import { exprIsConstant } from '../rc/expr';
import { DraftStore, type Draft } from './draft';
import { OPTION_SETTINGS, ModelDocument, type CopiedBranch } from './document';
import { parseRc } from '../rc/parser';
import { assemble, type Assembly } from '../model/assemble';
import type { SceneView } from '../render/scene';

const TYPES = ['Chip', 'Frame', 'Wheel', 'Rudder', 'RudderF', 'Trim', 'TrimF', 'Jet', 'Weight', 'Cowl', 'Arm', 'RLW'];
export class BuildPanel {
  active = false;
  private sourceInputRange?: {start: number; end: number};
  private sourceComposing = false;
  private sourceEditGroup: { type: string; time: number; end: number } | null = null;
  private drafts = new DraftStore({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
  private recoveryDraft: Draft | null = null;
  private restoreButton = document.getElementById('restore-draft') as HTMLButtonElement;
  document: ModelDocument;
  get selected(): number {
    const index = this.assembly?.tiles.findIndex(t => t.node.source?.start === this.document.selectedOffset) ?? -1;
    return Math.max(0, index);
  }
  set selected(index: number) {
    try { this.document.selectedOffset = this.document.nodes()[index]?.source?.start; }
    catch { this.document.selectedOffset = undefined; }
  }
  private clipboard: CopiedBranch | null = null;
  private copy = document.getElementById('copy-branch') as HTMLButtonElement;
  private mirror = document.getElementById('mirror-branch') as HTMLButtonElement;
  assembly: Assembly | null = null;
  private panel = document.getElementById('builder')!;
  private toggle = document.getElementById('build') as HTMLButtonElement;
  private tree = document.getElementById('parts') as HTMLSelectElement;
  private type = document.getElementById('part-type') as HTMLSelectElement;
  private angle = document.getElementById('part-angle') as HTMLInputElement;
  private angleControl = document.getElementById('angle-control') as HTMLSelectElement;
  private angleRow = document.getElementById('angle-control-row')!;
  private resetColor = document.getElementById('reset-color') as HTMLButtonElement;
  private color = document.getElementById('part-color') as HTMLInputElement;
  private option = document.getElementById('part-option') as HTMLSelectElement;
  private optionField = document.getElementById('option-field')!;
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
    this.restoreButton.onclick = () => { const draft = this.recoveryDraft; if (draft) this.edit(() => { this.document.restore(draft.text, draft.filename); this.selected = 0; }, true); };
    window.addEventListener('storage', event => {
      if (this.active && (event.key === null || event.key === 'snaptiles.editor.draft.v1')) this.paintDraft();
    });
    document.getElementById('focus-part')!.onclick = () => { if (this.assembly) this.scene.focusTile(this.selected); };
    window.addEventListener('keydown', event => {
      const target = event.target as HTMLElement | null;
      const inSource = target === this.source;
      if ((!this.active && !inSource) || (!inSource && target?.matches('input, textarea')) || target?.isContentEditable || event.repeat || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); this.edit(() => event.shiftKey ? this.document.redo() : this.document.undo());
      }
    });
    document.getElementById('frame-model')!.onclick = () => this.scene.frameModel();
    this.toggle.onclick = () => this.open();
    new ResizeObserver(() => this.revealSelection()).observe(this.tree);
    this.tree.onchange = () => { this.selected = Number(this.tree.value); this.paintSelection(); };
    this.type.onchange = () => this.edit(() => this.document.type(this.selected, this.type.value));
    this.angle.onchange = () => this.edit(() => { if (!this.angle.value.trim()) throw new Error('角度には数値を入力してください'); const expression = this.document.nodes()[this.selected].attrs.angle ?? '0'; if (this.document.controlStrength(expression) !== null) this.document.setControlStrength(expression, Number(this.angle.value)); else this.document.angle(this.selected, Number(this.angle.value)); });
    this.resetColor.onclick = () => this.edit(() => this.document.resetColor(this.selected));
    this.color.onchange = () => this.edit(() => this.document.color(this.selected, this.color.value));
    this.option.onchange = () => this.edit(() => this.document.option(this.selected, Number(this.option.value)), true);
    this.power.onchange = () => this.edit(() => {
      if (!this.power.value.trim()) throw new Error('出力には数値を入力してください');
      const expression = this.document.nodes()[this.selected].attrs.power ?? '0';
      if (this.document.controlStrength(expression) !== null) this.document.setControlStrength(expression, Number(this.power.value));
      else this.document.power(this.selected, Number(this.power.value));
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
    this.mirror.onclick = () => this.edit(() => { this.selected = this.document.mirrorBranch(this.selected); });
    this.copy.onclick = () => {
      try {
        this.clipboard = this.document.copyBranch(this.selected);
        this.addType.querySelector('option[value="clipboard"]')?.remove();
        this.addType.add(new Option(`コピーした枝（${this.clipboard.count}部品）`, 'clipboard'));
        this.addType.value = 'clipboard'; this.status.textContent = '';
      } catch (e) { this.status.textContent = e instanceof Error ? e.message : String(e); }
    };
    this.remove.onclick = () => this.edit(() => { const parent = this.assembly?.tiles[this.selected].parent?.id ?? 0; this.document.remove(this.selected); this.selected = parent; });
    this.undo.onclick = () => this.edit(() => this.document.undo());
    this.redo.onclick = () => this.edit(() => this.document.redo());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(button => {
      button.onclick = () => this.edit(() => {
        const parent = this.document.nodes()[this.selected];
        const next = this.selected + this.document.nodes().filter(n => n.source!.start >= parent.source!.start && n.source!.end <= parent.source!.end).length;
        const dir = button.dataset.edge as 'N' | 'S' | 'E' | 'W';
        if (this.addType.value === 'clipboard' && this.clipboard) this.document.pasteBranch(this.selected, dir, this.clipboard);
        else this.document.add(this.selected, dir, this.addType.value);
        this.selected = next;
      });
    });
    source.addEventListener('compositionstart', () => { this.sourceComposing = true; this.sourceEditGroup = null; });
    source.addEventListener('compositionend', () => { this.sourceComposing = false; });
    source.addEventListener('beforeinput', event => {
      this.captureSourceView();
      this.sourceInputRange = {start: source.selectionStart, end: source.selectionEnd};
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        this.edit(() => event.inputType === 'historyUndo' ? this.document.undo() : this.document.redo());
      } else if (!this.sourceComposing && (source.selectionStart !== source.selectionEnd || source.selectionStart !== this.sourceEditGroup?.end)) {
        this.sourceEditGroup = null;
      }
    });
    source.addEventListener('blur', () => { this.sourceEditGroup = null; });
    source.addEventListener('pointerdown', () => { this.sourceEditGroup = null; });
    source.addEventListener('input', event => {
      const type = event instanceof InputEvent ? event.inputType : '';
      const time = performance.now();
      const continuous = ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'].includes(type);
      const group = this.sourceEditGroup;
      this.document.editSource(source.value, continuous && group?.type === type && (this.sourceComposing || time - group.time < 1000), this.sourceInputRange);
      this.sourceInputRange = undefined;
      this.captureSourceView();
      this.sourceEditGroup = continuous ? {type, time, end: source.selectionEnd} : null;
      if (this.active) this.refresh(); this.saveDraft();
    });
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
  renameFile(filename: string): void { this.edit(() => this.document.renameFile(filename)); }
  loadSource(text: string, filename?: string): void {
    this.sourceEditGroup = null;
    this.source.value = text; this.document = new ModelDocument(this.source.value, filename);
    this.source.dispatchEvent(new Event('modelchange'));
  }
  open(): void {
    if (this.document.text !== this.source.value.replace(/\r\n?/g, '\n')) this.document = new ModelDocument(this.source.value);
    this.active = true;
    this.panel.hidden = false; this.toggle.setAttribute('aria-pressed', 'true');
    document.body.classList.add('building');
    this.paintDraft(); this.enter(); this.scene.setView('orbit'); this.refresh(true);
  }
  close(): void {
    this.active = false; this.panel.hidden = true;
    this.toggle.setAttribute('aria-pressed', 'false'); document.body.classList.remove('building');
    this.scene.selectTile(null);
  }
  private captureSourceView(): void {
    this.document.sourceView = {start: this.source.selectionStart, end: this.source.selectionEnd,
      direction: this.source.selectionDirection, top: this.source.scrollTop, left: this.source.scrollLeft};
  }
  private applySourceView(): void {
    const view = this.document.sourceView;
    if (!view) { this.source.setSelectionRange(0, 0); this.source.scrollTop = this.source.scrollLeft = 0; return; }
    this.source.setSelectionRange(view.start, view.end, view.direction);
    this.source.scrollTop = view.top; this.source.scrollLeft = view.left;
  }
  private edit(action: () => void, fit = false): void {
    this.sourceEditGroup = null;
    try { this.captureSourceView(); action(); this.source.value = this.document.text; this.source.dispatchEvent(new Event('modelchange')); if (this.active) this.refresh(fit); this.applySourceView(); this.saveDraft(); }
    catch (e) { this.status.textContent = e instanceof Error ? e.message : String(e); }
  }
  private paintDraft(): void {
    const draft = this.drafts.read();
    const same = draft?.text === this.source.value && draft?.filename === this.document.filename;
    this.recoveryDraft = draft && !same ? draft : null;
    const recovery = document.getElementById('draft-recovery')!;
    const hadFocus = recovery.contains(document.activeElement);
    recovery.hidden = !this.recoveryDraft;
    // A restored/replaced card must not leave keyboard focus on a hidden button.
    if (recovery.hidden && hadFocus) (this.assembly ? this.tree : this.source).focus();
    if (!this.recoveryDraft) return;
    document.getElementById('draft-filename')!.textContent = draft!.filename || '名前未設定のモデル';
    const saved = new Date(draft!.savedAt);
    document.getElementById('draft-saved')!.textContent = Number.isFinite(saved.getTime())
      ? `保存: ${saved.toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}`
      : '保存時刻不明';
  }
  private saveDraft(): void {
    if (!this.drafts.save(this.source.value, this.document.filename)) this.status.textContent ||= '下書きを保存できません。保存ボタンでファイルに残してください。';
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
        const option = new Option(`${'　'.repeat(Math.min(depth, 4))}${depth > 4 ? '… ' : ''}${t.dir ? t.dir + ': ' : ''}${t.node.type}${t.name ? ' · ' + t.name : ''}`, String(t.id));
        option.dataset.label = option.text;
        this.tree.add(option);
      }
      // Source offsets identify surviving parts; an unknown/replaced declaration falls back to Core.
      if (fit) this.scene.frameModel();
      this.status.textContent = ''; this.paintSelection();
      this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(b => b.disabled = false);
    } catch (e) {
      this.assembly = null; this.tree.replaceChildren(); this.scene.selectTile(null);
      this.type.disabled = this.angle.disabled = this.remove.disabled = this.copy.disabled = this.mirror.disabled = true;
      this.powerRow.hidden = this.angleRow.hidden = true;
      this.panel.querySelectorAll<HTMLButtonElement>('[data-edge]').forEach(b => b.disabled = true);
      this.status.textContent = e instanceof Error ? e.message : String(e);
    }
    this.undo.disabled = !this.document.undoStack.length; this.redo.disabled = !this.document.redoStack.length;
  }
  private revealSelection(): void {
    const option = this.tree.selectedOptions[0];
    if (!this.active || !option) return;
    const row = option.getBoundingClientRect(), box = this.tree.getBoundingClientRect();
    if (row.bottom > box.bottom - 4) this.tree.scrollTop += row.bottom - box.bottom + 4;
    else if (row.top < box.top + 4) this.tree.scrollTop -= box.top + 4 - row.top;
  }
  private paintSelection(): void {
    const tile = this.assembly?.tiles[this.selected]; if (!tile) return;
    this.tree.value = String(this.selected);
    for (const option of this.tree.options) option.text = `${option.selected ? '● ' : ''}${option.dataset.label ?? option.text}`;
    this.revealSelection();
    this.scene.selectTile(tile.id);
    this.type.value = TYPES.find(t => t.toLowerCase() === tile.type) ?? 'Core';
    this.type.disabled = !tile.parent;
    this.color.value = this.scene.tileColorHex(tile.id);
    this.color.disabled = !!tile.node.attrs.color && !exprIsConstant(tile.node.attrs.color);
    this.resetColor.disabled = this.color.disabled || !tile.node.attrs.color;
    document.getElementById('color-note')!.textContent = this.color.disabled ? `ソースで編集: ${tile.node.attrs.color}` : '';
    const settings = OPTION_SETTINGS[tile.type];
    this.optionField.hidden = !settings;
    this.option.replaceChildren();
    if (settings) {
      document.getElementById('option-label')!.textContent = settings.label;
      for (const [value, label] of settings.choices) this.option.add(new Option(label, String(value)));
      const raw = (tile.node.attrs.option ?? '0').replace(/\s/g, '');
      const numeric = Number(raw);
      const value = Number.isFinite(numeric) ? String(numeric) : raw;
      if (![...this.option.options].some(option => option.value === value)) this.option.add(new Option(`元の値: ${raw}`, value));
      this.option.value = value;
      this.option.disabled = !Number.isFinite(numeric);
      this.option.title = this.option.disabled ? `ソースで編集: ${raw}` : '';
    }
    const angle = tile.node.attrs.angle ?? '0';
    const angleStrength = this.document.controlStrength(angle);
    this.angle.value = angleStrength === null ? angle.replace(/\s/g, '') : String(angleStrength);
    document.getElementById('angle-label')!.textContent = angleStrength === null ? '角度' : '最大角度（共通）';
    this.angle.disabled = !tile.parent || angleStrength === null && !Number.isFinite(Number(angle.replace(/\s/g, '')));
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
    const powerStrength = this.document.controlStrength(power);
    this.power.value = powerStrength === null ? power : String(powerStrength);
    this.power.disabled = !constant && powerStrength === null;
    document.getElementById('power-label')!.textContent = powerStrength === null ? '出力' : '最大出力（共通）';
    this.powerControl.replaceChildren(new Option('固定', 'constant'));
    for (const v of parseRc(this.document.text).vals) {
      this.powerControl.add(new Option(v.name, v.name.toUpperCase()));
      this.powerControl.add(new Option(`${v.name}（逆）`, `-${v.name.toUpperCase()}`));
    }
    if (!constant && ![...this.powerControl.options].some(o => o.value === power.toUpperCase())) this.powerControl.add(new Option(power, power.toUpperCase()));
    this.powerControl.add(new Option('↑ / ↓ を追加', 'new'));
    this.powerControl.value = constant ? 'constant' : power.toUpperCase();
    this.remove.disabled = this.copy.disabled = this.mirror.disabled = !tile.parent;
    this.remove.textContent = tile.children.length ? '枝ごと削除' : '削除';
  }
}
