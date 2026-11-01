import { describe, it, expect } from 'vitest';
import { insertScript, diagnosticLine, LUA_REF } from '../src/editor/script';
import { parseRc } from '../src/rc/parser';

const BODY = 'Val { P(default=0) }\nBody { Core(){ N:Jet(power=P){ } } }\n';

describe('script helpers in the builder', () => {
  it('appends a Lua section with an OnFrame when the model has none', () => {
    const r = insertScript(BODY, 0, '_KEY(0)');
    expect(r.text).toBe(BODY + 'Lua {\nfunction OnFrame()\n  _KEY(0)\nend\n}\n');
    expect(r.text.slice(0, r.caret).endsWith('_KEY(0)')).toBe(true);
    expect(parseRc(r.text).script?.lang).toBe('lua');
  });

  it('puts an OnFrame snippet in as it is and leaves the caret in its body', () => {
    const r = insertScript(BODY.trimEnd(), 0, 'function OnFrame()\n  \nend');
    expect(r.text).toBe(BODY + 'Lua {\nfunction OnFrame()\n  \nend\n}\n');
    expect(r.text.slice(r.caret, r.caret + 4)).toBe('\nend');
  });

  it('inserts at the caret inside the Lua section, else at its end', () => {
    const src = BODY + 'Lua {\nfunction OnFrame()\n  P = 1\nend\n}\n';
    const inside = src.indexOf('P = 1');
    expect(insertScript(src, inside, 'out(0, P) ').text).toContain('  out(0, P) P = 1');
    const r = insertScript(src, 3, '-- tail');
    expect(r.text).toBe(BODY + 'Lua {\nfunction OnFrame()\n  P = 1\nend\n-- tail\n}\n');
    expect(r.text.slice(0, r.caret).endsWith('-- tail')).toBe(true);
  });

  it('finds the line a Lua error names', () => {
    const src = 'a\nbb\nccc\n';
    expect(diagnosticLine(src, 'Lua error: line 3: attempt to call nil')).toEqual({ line: 3, start: 5, end: 8 });
    expect(diagnosticLine(src, 'no line here')).toBeNull();
    expect(diagnosticLine(src, 'line 99: x')).toBeNull();
  });

  it('lists every reference entry with something to insert and a description', () => {
    for (const r of LUA_REF) { expect(r.insert.length).toBeGreaterThan(0); expect(r.ja.length).toBeGreaterThan(0); }
  });
});

describe('Lua errors name the file line', () => {
  it.each([['Lua {\n', 5], ['Lua\n{\n', 6]])('with the section opened as %j', async (open, line) => {
    const { RustSimulation } = await import('../src/sim/rust-simulation');
    const { KeyState } = await import('../src/input/keys');
    (globalThis as unknown as { __tune?: unknown }).__tune = { noCourse: true };
    const src = `${BODY}${open}function OnFrame()\n  P = nosuch.field\nend\n}\n`;
    const sim = new RustSimulation(src, new KeyState(new EventTarget()));
    try {
      await sim.start(); sim.step();
      expect(sim.scriptError).toMatch(new RegExp(`line ${line}:`));
      expect(src.split('\n')[line - 1]).toBe('  P = nosuch.field');
    } finally { await sim.dispose(); }
  }, 20000); // loads the core's WebAssembly: slow when the whole suite runs in parallel
});
