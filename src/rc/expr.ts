// Tiny arithmetic evaluator for attribute expressions: numbers, identifiers,
// unary minus, + - * /, parentheses. Unknown identifiers resolve to 0.

export type Env = (name: string) => number | undefined;

export function evalExpr(src: string, env: Env): number {
  const s = src.trim();
  if (s === '') return 0;
  let i = 0;
  const peek = () => s[i];
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const primary = (): number => {
    skip();
    const c = peek();
    if (c === '(') {
      i++;
      const v = add();
      skip();
      if (peek() === ')') i++;
      return v;
    }
    if (c === '-') { i++; return -primary(); }
    if (c === '+') { i++; return primary(); }
    if (c === '#') {
      let j = i + 1;
      while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
      const v = parseInt(s.slice(i + 1, j) || '0', 16);
      i = j;
      return v;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < s.length && s[j] !== q) j++;
      i = j + 1;
      return 0;
    }
    if (/[0-9.]/.test(c ?? '')) {
      let j = i;
      while (j < s.length && /[0-9.eE]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      i = j;
      return Number.isFinite(v) ? v : 0;
    }
    if (/[A-Za-z_]/.test(c ?? '')) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i, j);
      i = j;
      const v = env(name);
      return v === undefined || !Number.isFinite(v) ? 0 : v;
    }
    i++;
    return 0;
  };
  const mul = (): number => {
    let v = primary();
    for (;;) {
      skip();
      const c = peek();
      if (c === '*') { i++; v *= primary(); }
      else if (c === '/') { i++; const d = primary(); v = d === 0 ? 0 : v / d; }
      else return v;
    }
  };
  const add = (): number => {
    let v = mul();
    for (;;) {
      skip();
      const c = peek();
      if (c === '+') { i++; v += mul(); }
      else if (c === '-') { i++; v -= mul(); }
      else return v;
    }
  };
  return add();
}

export function exprIsConstant(src: string): boolean {
  // a #RRGGBB literal contains letters but is still a constant
  return !/[A-Za-z_]/.test(src.replace(/#[0-9a-fA-F]+/g, ''));
}
