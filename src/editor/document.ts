import { parseRc, type ChipNode } from '../rc/parser';

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
  angle(index: number, value: number): void {
    if (!Number.isFinite(value)) throw new Error('角度には数値を入力してください');
    const n = this.nodes()[index], s = n.source!;
    if (n.attrs.angle && !Number.isFinite(Number(n.attrs.angle.replace(/\s/g, ''))))
      throw new Error('変数で制御する角度はソースで編集してください');
    const range = s.attributes.angle;
    if (range) this.replace(range[0], range[1], String(value));
    else if (s.argsEnd !== undefined) this.replace(s.argsEnd, s.argsEnd, `${Object.keys(n.attrs).length ? ', ' : ''}angle=${value}`);
    else this.replace(s.headerEnd, s.headerEnd, `(angle=${value})`);
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
