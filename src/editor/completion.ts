// Deterministic code completion for the source's Lua section: no model, no network — the same text and caret always
// give the same list. Candidates: the model's own Lua identifiers, its Vals and part names, the script API (with the
// reference's description), Lua keywords and libraries (members after `math.`, `string.`, `table.`). Order: prefix
// matches by kind (the model's names first), then alphabetical; at most 12.
import { findBlocks } from '../rc/parser';
import { API_NAMES } from '../sim/core-layout';
import { LUA_REF } from './script';

export interface Candidate {
  label: string;
  /** text that replaces the typed prefix; `|` marks where the caret goes (else after the text) */
  insert: string;
  kind: '変数' | 'Val' | '部品' | 'API' | 'Lua' | 'ライブラリ';
  detail?: string;
}

const KEYWORDS = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'];
const GLOBALS = ['math', 'string', 'table', 'print', 'out', 'pairs', 'ipairs', 'tostring', 'tonumber', 'type', 'next', 'select', 'pcall', 'error', 'unpack', 'setmetatable', 'getmetatable', 'OnFrame', 'OnInit', 'OnReset'];
const MEMBERS: Record<string, string[]> = {
  math: ['abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'cos', 'deg', 'exp', 'floor', 'fmod', 'huge', 'log', 'log10', 'max', 'min', 'mod', 'modf', 'pi', 'pow', 'rad', 'random', 'randomseed', 'sin', 'sqrt', 'tan', 'tointeger', 'type'],
  string: ['byte', 'char', 'find', 'format', 'gmatch', 'gsub', 'len', 'lower', 'match', 'rep', 'reverse', 'sub', 'upper'],
  table: ['concat', 'insert', 'move', 'pack', 'remove', 'sort', 'unpack'],
};
const NOT_FUNCTIONS = new Set(['huge', 'pi']);
const KIND_ORDER: Candidate['kind'][] = ['変数', 'Val', '部品', 'API', 'Lua', 'ライブラリ'];

/** the API reference's description of a function (entries may name several: `_X(n) _Y(n) _Z(n)`) */
function apiDetail(name: string): string | undefined {
  return LUA_REF.find((r) => r.name.split(/[\s,…]+/).some((part) => part.replace(/\(.*$/, '') === name))?.ja;
}

/** the Lua section's range in `text`, or null */
export function luaRange(text: string): { start: number; end: number } | null {
  try {
    const b = findBlocks(text).find((x) => /^lua$/i.test(x.name));
    return b ? { start: b.offset, end: b.offset + b.inner.length } : null;
  } catch { return null; }
}

/** the identifier (and an optional `lib.` before it) that ends at `caret` */
export function wordAt(text: string, caret: number): { start: number; prefix: string; member: string | null } {
  let i = caret;
  while (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1])) i--;
  const prefix = text.slice(i, caret);
  const lib = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(text.slice(Math.max(0, i - 20), i));
  return { start: i, prefix, member: lib && MEMBERS[lib[1]] ? lib[1] : null };
}

export function candidates(text: string, caret: number): { start: number; list: Candidate[] } | null {
  const lua = luaRange(text);
  if (!lua || caret < lua.start || caret > lua.end) return null;
  const { start, prefix, member } = wordAt(text, caret);
  const lower = prefix.toLowerCase();
  const match = (label: string) => label.toLowerCase().startsWith(lower) && label !== prefix;
  const out: Candidate[] = [];
  if (member) {
    for (const m of MEMBERS[member]) if (match(m)) out.push({ label: `${member}.${m}`, insert: NOT_FUNCTIONS.has(m) ? m : `${m}(|)`, kind: 'ライブラリ' });
    return out.length ? { start, list: out.slice(0, 12) } : null;
  }
  if (!prefix) return null;
  const seen = new Set<string>();
  const add = (c: Candidate) => { if (!seen.has(c.label) && match(c.label)) { seen.add(c.label); out.push(c); } };
  // the model's own names: identifiers in the Lua section (not the word being typed), Vals, part names
  const body = text.slice(lua.start, lua.end);
  const own = [...new Set([...body.replace(/--[^\n]*/g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]))]
    .filter((w) => !KEYWORDS.includes(w) && !GLOBALS.includes(w) && !MEMBERS[w] && !/^_[A-Z0-9]+$/.test(w));
  const before = text.slice(0, lua.start);
  const vals = [...(/\bVal\s*\{([\s\S]*?)\}/i.exec(before)?.[1] ?? '').matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1].toUpperCase());
  const parts = [...before.matchAll(/\bname\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1].toUpperCase());
  for (const w of own.sort()) add({ label: w, insert: w, kind: vals.includes(w.toUpperCase()) ? 'Val' : '変数' });
  for (const v of [...new Set(vals)].sort()) add({ label: v, insert: v, kind: 'Val' });
  for (const p of [...new Set(parts)].sort()) add({ label: p, insert: p, kind: '部品', detail: '部品名（チップ番号の代わりに使える）' });
  for (const a of API_NAMES) add({ label: a, insert: `${a}(|)`, kind: 'API', detail: apiDetail(a) });
  for (const k of KEYWORDS) add({ label: k, insert: k, kind: 'Lua' });
  for (const g of GLOBALS) add({ label: g, insert: MEMBERS[g] ? `${g}.` : /^On/.test(g) ? g : `${g}(|)`, kind: 'ライブラリ' });
  out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return out.length ? { start, list: out.slice(0, 12) } : null;
}

/** the popup under the caret; keys while open: ↑↓ choose, Enter/Tab accept, Esc close; Ctrl+Space opens it */
export class Completion {
  private box = document.createElement('div');
  private list: Candidate[] = [];
  private start = 0;
  private index = 0;

  constructor(private textarea: HTMLTextAreaElement, layer: HTMLElement) {
    this.box.id = 'completion';
    this.box.setAttribute('role', 'listbox');
    this.box.hidden = true;
    layer.append(this.box);
    // capture: runs before the textarea's own Tab/Esc handlers, which must not see a key the popup took
    textarea.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    textarea.addEventListener('input', (e) => {
      const ie = e as InputEvent;
      if (ie.inputType?.startsWith('insert') && ie.data && /[A-Za-z0-9_.]/.test(ie.data.slice(-1))) this.update();
      else if (!this.box.hidden) this.update();
    });
    textarea.addEventListener('blur', () => this.close());
    textarea.addEventListener('scroll', () => this.close());
    this.box.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the textarea focused
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
      if (row) { this.index = Number(row.dataset.index); this.accept(); }
    });
  }

  get open(): boolean {
    return !this.box.hidden;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); this.update(); return; }
    if (this.box.hidden) return;
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { take(); this.index = (this.index + 1) % this.list.length; this.render(); }
    else if (e.key === 'ArrowUp') { take(); this.index = (this.index - 1 + this.list.length) % this.list.length; this.render(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { take(); this.accept(); }
    else if (e.key === 'Escape') { take(); this.close(); }
  }

  update(): void {
    const t = this.textarea;
    if (t.selectionStart !== t.selectionEnd) { this.close(); return; }
    const r = candidates(t.value, t.selectionStart);
    if (!r) { this.close(); return; }
    this.list = r.list;
    this.start = r.start;
    this.index = 0;
    this.render();
    this.place();
  }

  close(): void {
    this.box.hidden = true;
  }

  private accept(): void {
    const c = this.list[this.index];
    if (!c) return;
    const t = this.textarea, end = t.selectionStart;
    const caretAt = c.insert.indexOf('|');
    const text = c.insert.replace('|', '');
    // the same path as typing (beforeinput, then input): the editor's history and model sync see a normal edit
    if (!t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: text }))) return;
    t.setRangeText(text, this.start, end, 'end');
    if (caretAt >= 0) t.selectionStart = t.selectionEnd = this.start + caretAt;
    t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    this.close();
    if (text.endsWith('.')) this.update(); // math. → its members
  }

  private render(): void {
    this.box.replaceChildren(...this.list.map((c, i) => {
      const row = document.createElement('div');
      row.className = 'completion-row';
      row.dataset.index = String(i);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === this.index));
      const k = document.createElement('span'); k.className = 'completion-kind'; k.textContent = c.kind;
      const l = document.createElement('span'); l.className = 'completion-label'; l.textContent = c.label;
      row.append(k, l);
      return row;
    }));
    const d = this.list[this.index]?.detail;
    if (d) { const p = document.createElement('div'); p.className = 'completion-detail'; p.textContent = d; this.box.append(p); }
    this.box.hidden = false;
  }

  /** under the caret: the line and the column (tabs at tab-size 2) in the textarea's monospace metrics */
  private place(): void {
    const t = this.textarea, cs = getComputedStyle(t);
    const before = t.value.slice(0, t.selectionStart).split('\n');
    const line = before.length - 1;
    const col = [...before[line]].reduce((c, ch) => c + (ch === '\t' ? 2 - (c % 2) : 1), 0);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const cw = ctx.measureText('0').width;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
    const x = parseFloat(cs.paddingLeft) + col * cw - t.scrollLeft;
    const y = parseFloat(cs.paddingTop) + (line + 1) * lh - t.scrollTop;
    this.box.style.left = `${Math.max(0, Math.min(x, t.clientWidth - 220))}px`;
    this.box.style.top = `${y + 2}px`;
  }
}
