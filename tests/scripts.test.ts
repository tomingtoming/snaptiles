import { describe, expect, it } from 'vitest';
import { RcScript } from '../src/scripting/rcscript';
import { ScriptRunner } from '../src/scripting/lua';
import type { ValState } from '../src/sim/simulation';

function vals(init: Record<string, number>): Map<string, ValState> {
  const m = new Map<string, ValState>();
  for (const [k, v] of Object.entries(init)) {
    m.set(k, { name: k, value: v, default: v, min: -1e9, max: 1e9, step: 0, disp: true, touched: false });
  }
  return m;
}

describe('legacy Script', () => {
  it('runs assignments, ifs, labels and prints', () => {
    const src = `
      // traction control
      ratio = _WY(TIRE) / 2
      if ratio > 3.4 { TRQ = TRQ * 0.5 }
      if (ratio <= 3.4) & (ratio >= 0) { TRQ = (TRQ + 1000) * 1.05 }
      print 0, "trq", TRQ
      n = 0
      label loop
      n = n + 1
      if n < 3 { goto loop }
      X = n
    `;
    const s = new RcScript(src);
    const v = vals({ TRQ: 0, TIRE: 5, X: 0 });
    const api = { _WY: () => 4 } as never;
    s.run(api, v);
    expect(v.get('TRQ')!.value).toBeCloseTo(1050, 5);
    expect(v.get('X')!.value).toBe(3);
    expect(s.outLines[0]).toBe('trq 1050');
    s.run(api, v);
    expect(v.get('TRQ')!.value).toBeCloseTo(2152.5, 5);
  });

  it('treats = as comparison inside if and keeps undeclared vars frame-local', () => {
    const s = new RcScript(`
      if _KEY(0) = 1 { A = A + 1 }
      tmp = tmp + 1
      B = tmp
    `);
    const v = vals({ A: 0, B: 0 });
    const api = { _KEY: () => 1 } as never;
    s.run(api, v);
    s.run(api, v);
    expect(v.get('A')!.value).toBe(2);
    expect(v.get('B')!.value).toBe(1);
  });

  it('stops runaway loops', () => {
    const s = new RcScript(`label a\ngoto a`);
    expect(() => s.run({} as never, vals({}))).toThrow(/budget/);
  });
});

describe('Lua runner', () => {
  it('calls OnFrame with the API and exchanges Val globals', async () => {
    const r = new ScriptRunner();
    await r.load(
      `
      function OnFrame()
        if _KEY(1) == 1 then SPEED = SPEED + 10 end
        out(0, "s", SPEED)
      end
    `,
      { _KEY: (n: number) => (n === 1 ? 1 : 0) },
      'SPEED = 5',
    );
    expect(r.error).toBeNull();
    expect(r.frame()).toBe(true);
    expect(r.getNumber('SPEED')).toBe(15);
    expect(r.outLines[0]).toBe('s 15');
    r.setNumber('SPEED', 100);
    r.frame();
    expect(r.getNumber('SPEED')).toBe(110);
    await r.dispose();
  });

  it('falls back to main() and enforces the instruction budget', async () => {
    const r = new ScriptRunner();
    await r.load(`function main() while true do end end`, {});
    r.maxInstructionsPerCall = 50_000;
    expect(r.frame()).toBe(false);
    expect(r.error).toMatch(/budget/);
    await r.dispose();
  });

  it('provides Lua 5.0 compatibility names', async () => {
    const r = new ScriptRunner();
    await r.load(`function OnFrame() V = math.mod(7, 3) + math.pow(2, 3) end`, {});
    r.frame();
    expect(r.getNumber('V')).toBe(9);
    await r.dispose();
  });
});
