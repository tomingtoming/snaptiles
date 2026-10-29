// .rc model file parser (clean-room; grammar reconstructed from public docs).
//
//   Val    { NAME(default=0, min=-30, max=30, step=5, disp=0) ... }
//   Key    { 0:NAME(step=5), OTHER(step=-5)  1:... }
//   Body   { Core(){ N:Chip(angle=HANDLE){ ... } } }
//   Script { ...legacy RC script... }   Lua { ...lua... }   (Lua wins when both exist)
//
// Attribute values are kept as expression strings and evaluated later
// against the Val table, so `angle=-HANDLE` or `power=ENGINE*2` work.

export interface ValDecl {
  name: string;
  default: number;
  min: number;
  max: number;
  step: number;
  disp?: number;
}

export interface KeyBinding {
  key: number;
  var: string;
  step: number;
}

export const declarationRanges = new WeakMap<ValDecl | KeyBinding, Record<string, [number, number]>>();

export interface ChipNode {
  type: string; // Core, Chip, Frame, Rudder, RudderF, Trim, TrimF, Wheel, Jet, Weight, Cowl, Arm ...
  dir: 'N' | 'S' | 'E' | 'W' | null;
  attrs: Record<string, string>; // raw expressions
  children: ChipNode[];
  line: number;
  source?: { start: number; end: number; typeStart: number; typeEnd: number; headerEnd: number; close?: number; argsEnd?: number; attributes: Record<string, [number, number]>; attributeTokens: Record<string, [number, number][]> };
}

export interface RcModel {
  warnings: string[];
  vals: ValDecl[];
  keys: KeyBinding[];
  /** first Core (kept for convenience); all Cores are in `bodies` */
  body: ChipNode | null;
  bodies: ChipNode[];
  /** `line` is the file line of the block's opening brace (for error messages) */
  script: { lang: 'lua' | 'rc'; source: string; line: number } | null;
}

export class RcParseError extends Error {
  constructor(message: string, public line: number) {
    super(`${message} (line ${line})`);
  }
}

type Tok = { t: 'id' | 'num' | 'sym' | 'str'; v: string; line: number; start: number; end: number };

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if ((c === '/' && n === '/') || (c === '-' && n === '-')) {
      // `//` comments; some community files also use Lua-style `--` outside the Lua block
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) j++;
      if ((src[j] === '-' || src[j] === '+') && /[eE]/.test(src[j - 1])) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      toks.push({ t: 'num', v: src.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      toks.push({ t: 'str', v: src.slice(i + 1, j), line, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '#') {
      // #RRGGBB colour literal: keep it as one token so no space is inserted after '#'
      let j = i + 1;
      while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    toks.push({ t: 'sym', v: c, line, start: i, end: i + 1 });
    i++;
  }
  return toks;
}

/** Skip quoted text or comments without treating their braces as section delimiters. */
function literalEnd(src: string, i: number): number | null {
  const quote = src[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j++] === quote) return j; }
    return src.length;
  }
  const comment = src.startsWith('--', i);
  const start = comment ? i + 2 : i;
  const long = /^\[(=*)\[/.exec(src.slice(start));
  if (long) {
    const end = src.indexOf(`]${long[1]}]`, start + long[0].length);
    return end < 0 ? src.length : end + long[0].length;
  }
  if (comment || src.startsWith('//', i)) { const end = src.indexOf('\n', i); return end < 0 ? src.length : end; }
  if (src.startsWith('/*', i)) { const end = src.indexOf('*/', i + 2); return end < 0 ? src.length : end + 2; }
  return null;
}

/** Top-level section spans are also used by the visual editor to preserve unrelated text. */
export function findBlocks(src: string): { name: string; inner: string; line: number; offset: number }[] {
  const blocks: { name: string; inner: string; line: number; offset: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const skipped = literalEnd(src, i);
    if (skipped !== null) { i = skipped; continue; }
    if (!/[A-Za-z_]/.test(src[i])) { i++; continue; }
    const start = i;
    while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
    const name = src.slice(start, i);
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue;
    const open = i++, line = src.slice(0, start).split('\n').length;
    let depth = 1;
    while (i < src.length && depth) {
      const skip = literalEnd(src, i);
      if (skip !== null) { i = skip; continue; }
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      i++;
    }
    if (depth) throw new RcParseError(`unclosed ${name} section`, line);
    blocks.push({ name, inner: src.slice(open + 1, i - 1), line, offset: open + 1 });
  }
  return blocks;
}

class P {
  i = 0;
  ranges: Record<string, [number, number]> = {};
  attributeTokens: Record<string, [number, number][]> = {};
  constructor(public toks: Tok[], public baseLine: number, public offset = 0) {}
  peek(o = 0): Tok | undefined { return this.toks[this.i + o]; }
  next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new RcParseError('unexpected end of section', this.line());
    return t;
  }
  line(): number { return (this.peek()?.line ?? this.toks[this.toks.length - 1]?.line ?? 1) + this.baseLine - 1; }
  accept(v: string): boolean {
    const t = this.peek();
    if (t && t.t === 'sym' && t.v === v) { this.i++; return true; }
    return false;
  }
  expect(v: string): void {
    if (!this.accept(v)) throw new RcParseError(`expected '${v}' but found '${this.peek()?.v ?? 'EOF'}'`, this.line());
  }
  ident(): string {
    const t = this.next();
    if (t.t !== 'id') throw new RcParseError(`expected identifier, found '${t.v}'`, this.line());
    return t.v;
  }
  /** raw expression text until ',' or ')' at depth 0 */
  expr(): string {
    let depth = 0;
    const parts: string[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === 'sym') {
        if (t.v === '(') depth++;
        if (t.v === ')') { if (depth === 0) break; depth--; }
        if (t.v === ',' && depth === 0) break;
      }
      parts.push(t.t === 'str' ? `"${t.v}"` : t.v);
      this.i++;
    }
    return parts.join(' ').trim();
  }
  /** parses `( a=expr, b=expr )`; bare values are stored positionally as `_0`, `_1`... */
  args(): Record<string, string> {
    const out: Record<string, string> = {};
    this.ranges = {}; this.attributeTokens = {};
    this.expect('(');
    let pos = 0;
    while (!this.accept(')')) {
      const entryStart = this.i;
      const t0 = this.peek();
      const t1 = this.peek(1);
      if (t0?.t === 'id' && t1?.t === 'sym' && t1.v === '=') {
        this.i += 2;
        const start = this.peek()!.start + this.offset;
        out[t0.v.toLowerCase()] = this.expr();
        this.ranges[t0.v.toLowerCase()] = [start, this.toks[this.i - 1].end + this.offset];
        const spans = this.attributeTokens[t0.v.toLowerCase()] ??= [];
        for (const token of this.toks.slice(entryStart, this.i)) spans.push([token.start + this.offset, token.end + this.offset]);
        const separator = this.peek()?.v === ',' ? this.peek() : this.toks[entryStart - 1]?.v === ',' ? this.toks[entryStart - 1] : undefined;
        if (separator) spans.push([separator.start + this.offset, separator.end + this.offset]);
      } else {
        out[`_${pos++}`] = this.expr();
      }
      if (!this.accept(',')) { this.expect(')'); break; }
    }
    return out;
  }
}

function num(s: string | undefined, d: number): number {
  if (s === undefined) return d;
  const t = s.replace(/\s+/g, '');
  const hex = /^#([0-9a-fA-F]{1,8})$/.exec(t); // colors live in Val too: COLOR_1(default=#27AD96)
  if (hex) return parseInt(hex[1], 16);
  const v = Number(t);
  return Number.isFinite(v) ? v : d;
}

function parseVal(inner: string, baseLine: number, offset: number): ValDecl[] {
  const p = new P(tokenize(inner), baseLine);
  p.offset = offset;
  const out: ValDecl[] = [];
  while (p.peek()) {
    if (p.accept(',') || p.accept(';')) continue;
    const name = p.ident();
    const hasArgs = p.peek()?.v === '(';
    const a = hasArgs ? p.args() : {};
    const declaration: ValDecl = {
      name,
      default: num(a.default, 0),
      min: num(a.min, 0),
      max: num(a.max, 3.4e38),
      step: num(a.step, 0),
      disp: a.disp !== undefined ? num(a.disp, 0) : undefined,
    };
    declarationRanges.set(declaration, hasArgs ? { ...p.ranges } : {});
    out.push(declaration);
  }
  return out;
}

function parseKey(inner: string, baseLine: number, offset: number): KeyBinding[] {
  const p = new P(tokenize(inner), baseLine);
  p.offset = offset;
  const out: KeyBinding[] = [];
  let key = -1;
  while (p.peek()) {
    if (p.accept(',') || p.accept(';')) continue;
    const t = p.peek()!;
    if (t.t === 'num' && p.peek(1)?.v === ':') {
      key = Number(t.v);
      p.i += 2;
      continue;
    }
    const name = p.ident();
    const hasArgs = p.peek()?.v === '(';
    const a = hasArgs ? p.args() : {};
    if (key < 0) throw new RcParseError(`key binding '${name}' before any key number`, p.line());
    const binding: KeyBinding = { key, var: name, step: num(a.step, 1) };
    declarationRanges.set(binding, hasArgs ? { ...p.ranges } : {});
    out.push(binding);
  }
  return out;
}

const DIRS = new Set(['N', 'S', 'E', 'W']);

function parseNode(p: P): ChipNode {
  const line = p.line();
  const start = p.peek()!.start + p.offset;
  let typeToken = p.peek()!;
  let dir: ChipNode['dir'] = null;
  let name = p.ident();
  if (DIRS.has(name.toUpperCase()) && p.peek()?.v === ':') {
    p.accept(':');
    dir = name.toUpperCase() as ChipNode['dir'];
    typeToken = p.peek()!;
    name = p.ident();
  }
  const hasArgs = p.peek()?.v === '(';
  const attrs = p.peek()?.v === '(' ? p.args() : {};
  const headerEnd = p.toks[p.i - 1].end + p.offset;
  const node: ChipNode = { type: name, dir, attrs, children: [], line, source: { start, end: headerEnd, headerEnd, typeStart: typeToken.start + p.offset, typeEnd: typeToken.end + p.offset, argsEnd: hasArgs ? headerEnd - 1 : undefined, attributes: hasArgs ? { ...p.ranges } : {}, attributeTokens: hasArgs ? { ...p.attributeTokens } : {} } };
  if (p.accept('{')) {
    while (!p.accept('}')) {
      if (p.accept(',') || p.accept(';')) continue;
      node.children.push(parseNode(p));
    }
  }
  if (p.toks[p.i - 1].v === '}') node.source!.close = p.toks[p.i - 1].start + p.offset;
  node.source!.end = p.toks[p.i - 1].end + p.offset;
  return node;
}

/** A Body may hold several Cores (each its own vehicle / "bit"). */
function parseBody(inner: string, baseLine: number, offset: number): ChipNode[] {
  const p = new P(tokenize(inner), baseLine);
  p.offset = offset;
  const roots: ChipNode[] = [];
  while (p.peek()) {
    // stray separators / an extra closing brace (seen in community files) are ignored
    if (p.accept(',') || p.accept(';') || p.accept('}')) continue;
    roots.push(parseNode(p));
  }
  return roots;
}

export function parseRc(source: string): RcModel {
  const text = source.replace(/\r\n?/g, '\n');
  const model: RcModel = { warnings: [], vals: [], keys: [], body: null, bodies: [], script: null };
  const blocks = findBlocks(text);
  for (const b of blocks) {
    const name = b.name.toLowerCase();
    if (name === 'lua') {
      model.script = { lang: 'lua', source: b.inner, line: b.line };
      continue;
    }
    if (name === 'script') {
      // legacy RC script; a Lua block (if present) takes precedence
      if (!model.script || model.script.lang !== 'lua') model.script = { lang: 'rc', source: b.inner, line: b.line };
      continue;
    }
    const inner = stripComments(b.inner);
    if (name === 'val' || name === 'var') model.vals.push(...parseVal(inner, b.line, b.offset));
    else if (name === 'key') model.keys.push(...parseKey(inner, b.line, b.offset));
    else if (name === 'body') {
      const roots = parseBody(inner, b.line, b.offset);
      model.bodies.push(...roots);
      model.body = model.bodies[0] ?? null;
    } else {
      model.warnings.push(`未対応のセクション「${b.name}」(line ${b.line})。内容は実行に反映されません。`);
    }
  }
  return model;
}

/** Count nodes of the body tree. */
export function countNodes(n: ChipNode | null): number {
  if (!n) return 0;
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}
