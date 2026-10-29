import { exprIsConstant } from '../rc/expr';
import { parseRc, findBlocks, declarationRanges, type ChipNode } from '../rc/parser';

export interface SourceViewState {
  start: number; end: number; direction: 'forward' | 'backward' | 'none';
  top: number; left: number;
}
interface DocumentState { text: string; filename?: string; sourceView?: SourceViewState }

export const OPTION_SETTINGS: Record<string, {label: string; choices: [number, string][]}> = {
  wheel: {label: '半径', choices: [[0, '0.30 m'], [1, '0.45 m'], [2, '0.60 m']]},
  rlw: {label: '半径', choices: [[0, '0.30 m'], [1, '0.45 m'], [2, '0.60 m']]},
  cowl: {label: '形状', choices: [[0, '平板'], [1, '枠'], [2, '円板'], [3, '三角A'], [4, '三角B'], [5, '半円端'], [6, '平板(6)'], [7, '平板(7)']]},
  weight: {label: '重さ倍率', choices: [[0, '1倍（既定）'], ...Array.from({length:8}, (_, i): [number, string] => [i + 1, `${i + 1}倍`])]},
};

export interface CopiedBranch { text: string; variables: string[]; count: number }

/** Edits use parser offsets: scripts, comments and unrelated attributes remain byte-for-byte. */
export class ModelDocument {
  text: string;
  sourceView?: SourceViewState;
  undoStack: DocumentState[] = [];
  redoStack: DocumentState[] = [];
  constructor(text: string, public filename?: string) { this.text = text.replace(/\r\n?/g, '\n'); }
  nodes(): ChipNode[] {
    const out: ChipNode[] = [];
    const visit = (n: ChipNode) => { out.push(n); n.children.forEach(visit); };
    parseRc(this.text).bodies.forEach(visit);
    return out;
  }
  replace(start: number, end: number, value: string): void {
    const next = this.text.slice(0, start) + value + this.text.slice(end);
    parseRc(next); // do not commit a malformed edit
    if (next === this.text) return;
    this.undoStack.push(this.snapshot()); this.redoStack = [];
    if (this.sourceView) {
      // Find the changed span even for whole-document operations that preserve most text.
      let first = 0, oldEnd = this.text.length, newEnd = next.length;
      while (first < oldEnd && first < newEnd && this.text[first] === next[first]) first++;
      while (oldEnd > first && newEnd > first && this.text[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
      const move = (position: number) => position <= first ? position : position >= oldEnd ? position + newEnd - oldEnd : newEnd;
      this.sourceView = {...this.sourceView, start: move(this.sourceView.start), end: move(this.sourceView.end)};
    }
    this.text = next;
  }
  type(index: number, type: string): void {
    const n = this.nodes()[index];
    if (!n?.dir) throw new Error('Coreの種類は変更できません');
    this.replace(n.source!.typeStart, n.source!.typeEnd, type);
  }
  private attributeEdit(index: number, attribute: string, value: string): [number, number, string] {
    const n = this.nodes()[index], s = n.source!;
    const range = s.attributes[attribute];
    if (range) return [range[0], range[1], value];
    if (s.argsEnd !== undefined) return [s.argsEnd, s.argsEnd, `${Object.keys(n.attrs).length ? ', ' : ''}${attribute}=${value}`];
    return [s.headerEnd, s.headerEnd, `(${attribute}=${value})`];
  }
  angle(index: number, value: number): void {
    if (!Number.isFinite(value)) throw new Error('角度には数値を入力してください');
    const n = this.nodes()[index];
    if (n.attrs.angle && !Number.isFinite(Number(n.attrs.angle.replace(/\s/g, ''))))
      throw new Error('変数で制御する角度はソースで編集してください');
    this.replace(...this.attributeEdit(index, 'angle', String(value)));
  }
  color(index: number, value: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('色は6桁のRGB値で指定してください');
    const node = this.nodes()[index];
    if (node.attrs.color && !exprIsConstant(node.attrs.color)) throw new Error('変数で制御する色はソースで編集してください');
    this.replace(...this.attributeEdit(index, 'color', value.toLowerCase()));
  }
  resetColor(index: number): void {
    const node = this.nodes()[index];
    if (!node.attrs.color) return;
    if (!exprIsConstant(node.attrs.color)) throw new Error('変数で制御する色はソースで編集してください');
    const ranges = node.source!.attributeTokens.color ?? [];
    // Delete tokens, not the intervening comments/whitespace. Duplicate attributes
    // can share a delimiter, so each source span is removed only once.
    const unique = [...new Map(ranges.map(range => [range.join(':'), range])).values()];
    let next = this.text;
    for (const [start, end] of unique.sort((a,b) => b[0]-a[0])) next = next.slice(0,start)+next.slice(end);
    this.replace(0, this.text.length, next);
  }
  option(index: number, value: number): void {
    const node = this.nodes()[index], settings = OPTION_SETTINGS[node.type.toLowerCase()];
    if (!settings?.choices.some(([choice]) => choice === value)) throw new Error('この部品では使えない設定値です');
    const old = (node.attrs.option ?? '0').replace(/\s/g, '');
    if (!Number.isFinite(Number(old))) throw new Error('式で指定した設定はソースで編集してください');
    this.replace(...this.attributeEdit(index, 'option', String(value)));
  }
  power(index: number, value: number | string): void {
    if (typeof value === 'number' ? !Number.isFinite(value) : !parseRc(this.text).vals.some(v => v.name.toUpperCase() === value.replace(/^-/, '').toUpperCase()))
      throw new Error('出力には数値か定義済みの変数を指定してください');
    this.replace(...this.attributeEdit(index, 'power', String(value)));
  }
  /** One undoable edit; a fresh variable never overwrites existing controls or scripts. */
  controlStrength(variable: string): number | null {
    const name = variable.replace(/\s/g, '').replace(/^-/, '').toUpperCase();
    if (!/^ST_(POWER|STEER)_\d+$/.test(name)) return null;
    const model = parseRc(this.text), v = model.vals.find(v => v.name.toUpperCase() === name);
    const keys = model.keys.filter(k => k.var.toUpperCase() === name);
    if (!v || v.default !== 0 || v.min !== -v.max || v.max <= 0 || v.step !== v.max || keys.length !== 2) return null;
    const expected = name.startsWith('ST_POWER') ? [0, 1] : [3, 2];
    return keys.some(k => k.key === expected[0] && k.step === v.max) && keys.some(k => k.key === expected[1] && k.step === -v.max) ? v.max : null;
  }
  setControlStrength(variable: string, magnitude: number): void {
    if (this.controlStrength(variable) === null) throw new Error('変更済みの操作はソースで編集してください');
    if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error('大きさは正の数で指定してください');
    const name = variable.replace(/\s/g, '').replace(/^-/, '').toUpperCase();
    const model = parseRc(this.text), v = model.vals.find(v => v.name.toUpperCase() === name)!;
    const edits: [number, number, string][] = [];
    const ranges = declarationRanges.get(v)!;
    for (const [attr, value] of [['min', -magnitude], ['max', magnitude], ['step', magnitude]] as const) {
      if (!ranges[attr]) throw new Error('操作の定義が不足しています');
      edits.push([...ranges[attr], String(value)]);
    }
    for (const key of model.keys.filter(k => k.var.toUpperCase() === name)) {
      const range = declarationRanges.get(key)?.step;
      if (!range) throw new Error('キー操作の定義が不足しています');
      edits.push([...range, String(Math.sign(key.step) * magnitude)]);
    }
    let next = this.text;
    for (const [start, end, value] of edits.sort((a,b) => b[0] - a[0])) next = next.slice(0,start) + value + next.slice(end);
    this.replace(0, this.text.length, next);
  }
  addPowerControl(index: number, magnitude: number): void { this.addControl(index, 'power', magnitude, [0, 1]); }
  addSteeringControl(index: number, magnitude = 30): void { this.addControl(index, 'angle', magnitude, [2, 3]); }
  bindAngle(index: number, variable: string): void {
    if (!parseRc(this.text).vals.some(v => v.name.toUpperCase() === variable.toUpperCase())) throw new Error('定義済みの変数を選んでください');
    this.replace(...this.attributeEdit(index, 'angle', variable));
  }
  fixedAngle(index: number): void { this.replace(...this.attributeEdit(index, 'angle', '0')); }
  restore(text: string, filename?: string): void {
    this.undoStack.push(this.snapshot()); this.redoStack = []; this.text = text.replace(/\r\n?/g, '\n'); this.filename = filename; this.sourceView = undefined;
  }
  /** Direct typing may temporarily be invalid; preserve it and the preceding GUI history. */
  editSource(text: string, coalesce = false): void {
    const next = text.replace(/\r\n?/g, '\n');
    if (next === this.text) return;
    if (!coalesce || this.redoStack.length || !this.undoStack.length) this.undoStack.push(this.snapshot());
    this.redoStack = []; this.text = next;
  }
  newModel(): void { this.restore('Body {\n  Core() {\n  }\n}\n'); }
  private addControl(index: number, attribute: 'power' | 'angle', magnitude: number, keys: [number, number]): void {
    if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error('出力の大きさは正の数で指定してください');
    const names = new Set(this.text.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g));
    const prefixName = attribute === 'power' ? 'ST_POWER' : 'ST_STEER';
    let suffix = 1; while (names.has(`${prefixName}_${suffix}`)) suffix++;
    const name = `${prefixName}_${suffix}`;
    const edits: [number, number, string][] = [this.attributeEdit(index, attribute, name)];
    const blocks = findBlocks(this.text);
    const delta = attribute === 'angle' ? -magnitude : magnitude;
    let prefix = '';
    for (const [section, content] of [
      ['Val', `  ${name}(default=0, min=-${magnitude}, max=${magnitude}, step=${magnitude})`],
      ['Key', `  ${keys[0]}:${name}(step=${delta})\n  ${keys[1]}:${name}(step=${-delta})`],
    ]) {
      const block = blocks.find(b => b.name.toLowerCase() === section.toLowerCase() || section === 'Val' && b.name.toLowerCase() === 'var');
      if (block) { const end = block.offset + block.inner.length; edits.push([end, end, `\n${content}\n`]); }
      else prefix += `${section} {\n${content}\n}\n`;
    }
    let next = this.text;
    for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) next = next.slice(0, start) + value + next.slice(end);
    this.replace(0, this.text.length, prefix + next);
  }
  add(index: number, dir: 'N' | 'S' | 'E' | 'W', type: string): void {
    const s = this.nodes()[index].source!;
    const child = `\n  ${dir}:${type}(angle=0)\n`;
    if (s.close !== undefined) this.replace(s.close, s.close, child);
    else this.replace(s.headerEnd, s.headerEnd, ` {${child}}`);
  }
  copyBranch(index: number): CopiedBranch {
    const root = this.nodes()[index];
    if (!root?.dir) throw new Error('Core以外の枝を選んでください');
    const nodes = this.nodes().filter(n => n.source!.start >= root.source!.start && n.source!.end <= root.source!.end);
    if (nodes.some(n => n.attrs.name)) throw new Error('名前付きの枝は、識別名を調整してソースで複製してください');
    const text = this.text.slice(root.source!.start, root.source!.end);
    const words = new Set(text.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g));
    return {text, count:nodes.length, variables:parseRc(this.text).vals.filter(v=>words.has(v.name.toUpperCase())).map(v=>v.name.toUpperCase())};
  }
  pasteBranch(index: number, dir: 'N' | 'S' | 'E' | 'W', branch: CopiedBranch): void {
    const names = new Set(parseRc(this.text).vals.map(v=>v.name.toUpperCase()));
    if (branch.variables.some(name=>!names.has(name))) throw new Error('貼り付け元の操作変数がありません。元のモデルで貼り付けてください');
    const s = this.nodes()[index].source!;
    const child = `\n  ${dir}${branch.text.slice(1)}\n`;
    if (s.close !== undefined) this.replace(s.close, s.close, child);
    else this.replace(s.headerEnd, s.headerEnd, ` {${child}}`);
  }
  remove(index: number): void {
    const n = this.nodes()[index];
    if (!n?.dir) throw new Error('Coreは削除できません');
    this.replace(n.source!.start, n.source!.end, '');
  }
  private snapshot(): DocumentState { return {text: this.text, filename: this.filename, sourceView: this.sourceView ? {...this.sourceView} : undefined}; }
  undo(): void { const state = this.undoStack.pop(); if (state) { this.redoStack.push(this.snapshot()); Object.assign(this, state); } }
  redo(): void { const state = this.redoStack.pop(); if (state) { this.undoStack.push(this.snapshot()); Object.assign(this, state); } }
}

/** Keep imported names portable while always exporting UTF-8 .rcd files. */
export function downloadFilename(filename: string): string {
  let stem = filename.replace(/\\/g, '/').split('/').pop()!.replace(/\.(rcd?|txt)$/i, '');
  stem = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 160);
  if (!stem) stem = 'model';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.rcd`;
}
