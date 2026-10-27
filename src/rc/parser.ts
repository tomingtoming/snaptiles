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

export interface ChipNode {
  type: string; // Core, Chip, Frame, Rudder, RudderF, Trim, TrimF, Wheel, Jet, Weight, Cowl, Arm ...
  dir: 'N' | 'S' | 'E' | 'W' | null;
  attrs: Record<string, string>; // raw expressions
  children: ChipNode[];
  line: number;
}

export interface RcModel {
  vals: ValDecl[];
  keys: KeyBinding[];
  body: ChipNode | null;
  script: { lang: 'lua' | 'rc'; source: string } | null;
}

export class RcParseError extends Error {
  constructor(message: string, public line: number) {
    super(`${message} (line ${line})`);
  }
}

type Tok = { t: 'id' | 'num' | 'sym' | 'str'; v: string; line: number };

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
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
      toks.push({ t: 'id', v: src.slice(i, j), line });
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
      toks.push({ t: 'num', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      toks.push({ t: 'str', v: src.slice(i + 1, j), line });
      i = j + 1;
      continue;
    }
    toks.push({ t: 'sym', v: c, line });
    i++;
  }
  return toks;
}

/** Find top-level `Name { ... }` blocks, returning raw inner text (brace-balanced). */
function findBlocks(src: string): { name: string; inner: string; line: number }[] {
  const blocks: { name: string; inner: string; line: number }[] = [];
  const re = /(^|[\s}])([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[2];
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const line = src.slice(0, m.index).split('\n').length;
    blocks.push({ name, inner: src.slice(open + 1, i), line });
    re.lastIndex = i + 1;
  }
  return blocks;
}

class P {
  i = 0;
  constructor(public toks: Tok[], public baseLine: number) {}
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
    this.expect('(');
    let pos = 0;
    while (!this.accept(')')) {
      const t0 = this.peek();
      const t1 = this.peek(1);
      if (t0?.t === 'id' && t1?.t === 'sym' && t1.v === '=') {
        this.i += 2;
        out[t0.v.toLowerCase()] = this.expr();
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

function parseVal(inner: string, baseLine: number): ValDecl[] {
  const p = new P(tokenize(inner), baseLine);
  const out: ValDecl[] = [];
  while (p.peek()) {
    if (p.accept(',') || p.accept(';')) continue;
    const name = p.ident();
    const a = p.peek()?.v === '(' ? p.args() : {};
    out.push({
      name,
      default: num(a.default, 0),
      min: num(a.min, 0),
      max: num(a.max, 3.4e38),
      step: num(a.step, 0),
      disp: a.disp !== undefined ? num(a.disp, 0) : undefined,
    });
  }
  return out;
}

function parseKey(inner: string, baseLine: number): KeyBinding[] {
  const p = new P(tokenize(inner), baseLine);
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
    const a = p.peek()?.v === '(' ? p.args() : {};
    if (key < 0) throw new RcParseError(`key binding '${name}' before any key number`, p.line());
    out.push({ key, var: name, step: num(a.step, 1) });
  }
  return out;
}

const DIRS = new Set(['N', 'S', 'E', 'W']);

function parseNode(p: P): ChipNode {
  const line = p.line();
  let dir: ChipNode['dir'] = null;
  let name = p.ident();
  if (DIRS.has(name.toUpperCase()) && p.peek()?.v === ':') {
    p.accept(':');
    dir = name.toUpperCase() as ChipNode['dir'];
    name = p.ident();
  }
  const attrs = p.peek()?.v === '(' ? p.args() : {};
  const node: ChipNode = { type: name, dir, attrs, children: [], line };
  if (p.accept('{')) {
    while (!p.accept('}')) {
      if (p.accept(',') || p.accept(';')) continue;
      node.children.push(parseNode(p));
    }
  }
  return node;
}

function parseBody(inner: string, baseLine: number): ChipNode | null {
  const p = new P(tokenize(inner), baseLine);
  if (!p.peek()) return null;
  return parseNode(p);
}

export function parseRc(source: string): RcModel {
  const text = source.replace(/\r\n?/g, '\n');
  const model: RcModel = { vals: [], keys: [], body: null, script: null };
  const blocks = findBlocks(text);
  for (const b of blocks) {
    const name = b.name.toLowerCase();
    if (name === 'lua') {
      model.script = { lang: 'lua', source: b.inner };
      continue;
    }
    if (name === 'script') {
      // legacy RC script; a Lua block (if present) takes precedence
      if (!model.script || model.script.lang !== 'lua') model.script = { lang: 'rc', source: b.inner };
      continue;
    }
    const inner = stripComments(b.inner);
    if (name === 'val' || name === 'var') model.vals.push(...parseVal(inner, b.line));
    else if (name === 'key') model.keys.push(...parseKey(inner, b.line));
    else if (name === 'body') model.body = parseBody(inner, b.line);
  }
  return model;
}

/** Count nodes of the body tree. */
export function countNodes(n: ChipNode | null): number {
  if (!n) return 0;
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}
