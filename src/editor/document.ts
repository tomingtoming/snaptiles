import { parseRc, findBlocks, type ChipNode } from '../rc/parser';

/** Edits use parser offsets: scripts, comments and unrelated attributes remain byte-for-byte. */
export class ModelDocument {
  text: string;
  undoStack: string[] = [];
  redoStack: string[] = [];
  constructor(text: string) { this.text = text.replace(/\r\n?/g, '\n'); }
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
    this.undoStack.push(this.text); this.redoStack = []; this.text = next;
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
  power(index: number, value: number | string): void {
    if (typeof value === 'number' ? !Number.isFinite(value) : !parseRc(this.text).vals.some(v => v.name.toUpperCase() === value.toUpperCase()))
      throw new Error('出力には数値か定義済みの変数を指定してください');
    this.replace(...this.attributeEdit(index, 'power', String(value)));
  }
  /** One undoable edit; a fresh variable never overwrites existing controls or scripts. */
  addPowerControl(index: number, magnitude: number): void {
    if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error('出力の大きさは正の数で指定してください');
    const names = new Set(this.text.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g));
    let suffix = 1; while (names.has(`ST_POWER_${suffix}`)) suffix++;
    const name = `ST_POWER_${suffix}`;
    const edits: [number, number, string][] = [this.attributeEdit(index, 'power', name)];
    const blocks = findBlocks(this.text);
    let prefix = '';
    for (const [section, content] of [
      ['Val', `  ${name}(default=0, min=-${magnitude}, max=${magnitude}, step=${magnitude})`],
      ['Key', `  0:${name}(step=${magnitude})\n  1:${name}(step=-${magnitude})`],
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
  remove(index: number): void {
    const n = this.nodes()[index];
    if (!n?.dir) throw new Error('Coreは削除できません');
    this.replace(n.source!.start, n.source!.end, '');
  }
  undo(): void { const text = this.undoStack.pop(); if (text !== undefined) { this.redoStack.push(this.text); this.text = text; } }
  redo(): void { const text = this.redoStack.pop(); if (text !== undefined) { this.undoStack.push(this.text); this.text = text; } }
}
