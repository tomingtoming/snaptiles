// Legacy `Script{}` language (docs/spec/lua-api.md §4), executed top to bottom once per frame.
//
//   var = expr
//   if cond { ... }          (no nesting; leaving the block leaves all)
//   label name / goto name   (a trailing colon is tolerated: `goto A:`)
//   print row, item, ...
//
// Statements are separated by newlines OR just by starting a new statement — community
// files write `if F_B=1 {Z_A=90 DUMMY=_BYE(zenmai) goto B:}` on one line.
// Expressions: numbers, variables (Val or frame-local), _FUNC(args), + - * / %,
// comparisons (= == != <> < > <= >=) → 1/0, & | and or, unary minus, parentheses.

import type { LuaApi } from './lua';
import type { ValState } from '../sim/simulation';

type Stmt =
  | { k: 'set'; name: string; expr: Expr }
  | { k: 'if'; cond: Expr; end: number } // jump to `end` (index after the block) when false
  | { k: 'endif' }
  | { k: 'goto'; label: string }
  | { k: 'label'; name: string }
  | { k: 'print'; row: Expr; items: Expr[] }
  | { k: 'expr'; expr: Expr };

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'un'; op: string; a: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr };

type Tok = { t: 'num' | 'id' | 'op' | 'str'; v: string };

const MAX_STEPS = 20000;
const KEYWORDS = new Set(['if', 'goto', 'label', 'print']);

export class RcScript {
  private stmts: Stmt[] = [];
  private labels = new Map<string, number>();
  outLines: string[] = [];

  constructor(source: string) {
    this.compile(source);
  }

  private compile(source: string): void {
    const text = source.replace(/\r\n?/g, '\n').replace(/\/\/[^\n]*/g, '');
    const toks = lex(text);
    const ifStack: number[] = [];
    let i = 0;
    const isStart = (j: number): boolean => {
      const t = toks[j];
      if (!t) return true;
      if (t.t === 'op' && t.v === '}') return true;
      if (t.t === 'id' && KEYWORDS.has(t.v.toLowerCase())) return true;
      // `IDENT =` begins an assignment (but not `IDENT ==` and not inside parentheses)
      return t.t === 'id' && toks[j + 1]?.t === 'op' && toks[j + 1].v === '=';
    };
    /** collect tokens until the next statement start (at paren depth 0) or a brace */
    const until = (stop: (t: Tok) => boolean): Tok[] => {
      const out: Tok[] = [];
      let depth = 0;
      while (i < toks.length) {
        const t = toks[i];
        if (depth === 0 && (stop(t) || isStart(i))) break;
        if (t.t === 'op' && t.v === '(') depth++;
        if (t.t === 'op' && t.v === ')') depth--;
        out.push(t);
        i++;
      }
      return out;
    };
    while (i < toks.length) {
      const t = toks[i];
      if (t.t === 'op' && t.v === '}') {
        const idx = ifStack.pop();
        if (idx === undefined) throw new Error('unmatched }');
        (this.stmts[idx] as { end: number }).end = this.stmts.length + 1;
        this.stmts.push({ k: 'endif' });
        i++;
        continue;
      }
      if (t.t === 'op' && t.v === '{') { i++; continue; } // stray
      const word = t.t === 'id' ? t.v.toLowerCase() : '';
      if (word === 'if') {
        i++;
        const cond: Tok[] = [];
        while (i < toks.length && !(toks[i].t === 'op' && toks[i].v === '{')) cond.push(toks[i++]);
        i++; // '{'
        ifStack.push(this.stmts.length);
        this.stmts.push({ k: 'if', cond: parseTokens(cond), end: -1 });
        continue;
      }
      if (word === 'label' || word === 'goto') {
        i++;
        const name = toks[i]?.t === 'id' ? toks[i++].v.toUpperCase() : '';
        if (toks[i]?.t === 'op' && toks[i].v === ':') i++;
        if (!name) throw new Error(`${word} without a name`);
        if (word === 'label') {
          this.labels.set(name, this.stmts.length);
          this.stmts.push({ k: 'label', name });
        } else this.stmts.push({ k: 'goto', label: name });
        continue;
      }
      if (word === 'print') {
        i++;
        const args = splitTop(until(() => false));
        this.stmts.push({ k: 'print', row: parseTokens(args[0] ?? []), items: args.slice(1).map(parseTokens) });
        continue;
      }
      if (t.t === 'id' && toks[i + 1]?.t === 'op' && toks[i + 1].v === '=') {
        const name = t.v.toUpperCase();
        i += 2;
        const expr = until(() => false);
        this.stmts.push({ k: 'set', name, expr: parseTokens(expr) });
        continue;
      }
      // anything else: a bare expression statement
      const expr = until(() => false);
      if (expr.length === 0) { i++; continue; }
      this.stmts.push({ k: 'expr', expr: parseTokens(expr) });
    }
    if (ifStack.length) throw new Error('unclosed if block');
  }

  run(api: LuaApi, vals: Map<string, ValState>): void {
    const locals = new Map<string, number>();
    const get = (name: string): number => {
      const v = vals.get(name);
      if (v) return v.value;
      return locals.get(name) ?? 0;
    };
    const set = (name: string, value: number): void => {
      const v = vals.get(name);
      if (v) { v.value = value; v.touched = true; } else locals.set(name, value);
    };
    const ev = (e: Expr): number | string => evaluate(e, get, api);
    let pc = 0;
    let steps = 0;
    while (pc < this.stmts.length) {
      if (++steps > MAX_STEPS) throw new Error('script step budget exceeded');
      const s = this.stmts[pc];
      switch (s.k) {
        case 'set': set(s.name, num(ev(s.expr))); pc++; break;
        case 'if': pc = num(ev(s.cond)) !== 0 ? pc + 1 : s.end; break;
        case 'endif': pc++; break;
        case 'label': pc++; break;
        case 'goto': {
          const t = this.labels.get(s.label);
          if (t === undefined) throw new Error(`unknown label ${s.label}`);
          pc = t;
          break;
        }
        case 'print': {
          const row = Math.max(0, Math.min(24, Math.floor(num(ev(s.row)))));
          const text = s.items.map((i) => { const v = ev(i); return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v; }).join('');
          while (this.outLines.length <= row) this.outLines.push('');
          this.outLines[row] = text;
          pc++;
          break;
        }
        case 'expr': ev(s.expr); pc++; break;
      }
    }
  }
}

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** split a token list on top-level commas */
function splitTop(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let depth = 0;
  let cur: Tok[] = [];
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    if (t.t === 'op' && t.v === ')') depth--;
    if (t.t === 'op' && t.v === ',' && depth === 0) { out.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---- lexer ----
function lex(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      toks.push({ t: 'str', v: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
      toks.push({ t: 'num', v: String(parseInt(s.slice(i + 1, j) || '0', 16)) });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.eE]/.test(s[j])) j++;
      toks.push({ t: 'num', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '<>', '<=', '>='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    toks.push({ t: 'op', v: c });
    i++;
  }
  return toks;
}

// ---- expression parser (over tokens) ----
function parseTokens(toks: Tok[]): Expr {
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const isWord = (v: string) => peek()?.t === 'id' && peek().v.toLowerCase() === v;

  const primary = (): Expr => {
    const t = take();
    if (!t) return { k: 'num', v: 0 };
    if (t.t === 'num') return { k: 'num', v: Number(t.v) || 0 };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (isOp('(')) {
        take();
        const args: Expr[] = [];
        while (peek() && !isOp(')')) {
          args.push(or());
          if (isOp(',')) take(); else break;
        }
        if (isOp(')')) take();
        return { k: 'call', name: t.v.toUpperCase(), args };
      }
      return { k: 'var', name: t.v.toUpperCase() };
    }
    if (t.v === '(') { const e = or(); if (isOp(')')) take(); return e; }
    if (t.v === '-') return { k: 'un', op: '-', a: unary() };
    if (t.v === '!') return { k: 'un', op: '!', a: unary() };
    return { k: 'num', v: 0 };
  };
  const unary = (): Expr => {
    if (isOp('-')) { take(); return { k: 'un', op: '-', a: unary() }; }
    if (isOp('!') || isWord('not')) { take(); return { k: 'un', op: '!', a: unary() }; }
    return primary();
  };
  const mul = (): Expr => {
    let a = unary();
    while (isOp('*') || isOp('/') || isOp('%')) { const op = take().v; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  };
  const add = (): Expr => {
    let a = mul();
    while (isOp('+') || isOp('-')) { const op = take().v; a = { k: 'bin', op, a, b: mul() }; }
    return a;
  };
  const cmp = (): Expr => {
    let a = add();
    while (isOp('<') || isOp('>') || isOp('<=') || isOp('>=') || isOp('=') || isOp('==') || isOp('!=') || isOp('<>')) {
      const op = take().v;
      a = { k: 'bin', op, a, b: add() };
    }
    return a;
  };
  const and = (): Expr => {
    let a = cmp();
    while (isOp('&') || isWord('and')) { take(); a = { k: 'bin', op: '&', a, b: cmp() }; }
    return a;
  };
  const or = (): Expr => {
    let a = and();
    while (isOp('|') || isWord('or')) { take(); a = { k: 'bin', op: '|', a, b: and() }; }
    return a;
  };
  return or();
}

export function parseExpr(src: string): Expr {
  return parseTokens(lex(src));
}

const MATH: Record<string, (...a: number[]) => number> = {
  _ABS: Math.abs, _SQRT: Math.sqrt, _SIN: Math.sin, _COS: Math.cos, _TAN: Math.tan,
  _ASIN: Math.asin, _ACOS: Math.acos, _ATAN: Math.atan, _ATAN2: Math.atan2,
  _SGN: Math.sign, _POW: Math.pow, _EXP: Math.exp, _INT: Math.trunc, _FIX: Math.trunc,
  _ROUND: (v) => (v < 0 ? -Math.round(-v) : Math.round(v)), _FLOOR: Math.floor, _CEIL: Math.ceil,
  _LOG: Math.log, _LOG10: Math.log10, _LEN2: (a, b) => Math.hypot(a, b), _LEN3: (a, b, c) => Math.hypot(a, b, c),
  _PI: () => Math.PI, _TODEG: (r) => (r * 180) / Math.PI, _TORAD: (d) => (d * Math.PI) / 180,
  _RND: () => Math.random(), _MOD: (a, b) => (b === 0 ? 0 : a % b),
};

function evaluate(e: Expr, get: (n: string) => number, api: LuaApi): number | string {
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return e.v;
    case 'var': return get(e.name);
    case 'call': {
      const args = e.args.map((a) => num(evaluate(a, get, api)));
      const f = api[e.name] ?? MATH[e.name];
      if (!f) return 0;
      const r = f(...args);
      return typeof r === 'number' ? r : 0;
    }
    case 'un': {
      const a = num(evaluate(e.a, get, api));
      return e.op === '-' ? -a : a === 0 ? 1 : 0;
    }
    case 'bin': {
      const a = num(evaluate(e.a, get, api));
      const b = num(evaluate(e.b, get, api));
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b;
        case '%': return b === 0 ? 0 : a % b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '=': case '==': return a === b ? 1 : 0;
        case '!=': case '<>': return a !== b ? 1 : 0;
        case '&': return a !== 0 && b !== 0 ? 1 : 0;
        case '|': return a !== 0 || b !== 0 ? 1 : 0;
      }
      return 0;
    }
  }
}
