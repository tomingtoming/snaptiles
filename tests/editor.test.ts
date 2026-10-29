import { describe, it, expect } from 'vitest';
import { ModelDocument } from '../src/editor/document';
import { parseRc } from '../src/rc/parser';
const source = `// keep header
Val { A(default=20) }
Key { 0:A(step=1) }
Body { Core() { /* comment */ N:Chip(angle=10, color=#ff00ff) { E:Wheel(angle=A) } S:Frame() } }
Lua { function OnFrame() out(0, "keep me") end }
`;
describe('visual model edits', () => {
  it('changes only the angle expression, keeping comments, other attributes and Lua', () => {
    const d = new ModelDocument(source); d.angle(1, -45);
    expect(d.text).toBe(source.replace('angle=10', 'angle=-45'));
    d.undo(); expect(d.text).toBe(source); d.redo(); expect(d.nodes()[1].attrs.angle).toBe('- 45');
  });
  it('removes an entire branch without removing siblings, and can restore it exactly', () => {
    const d = new ModelDocument(source); d.remove(1);
    expect(d.nodes().map(n => n.type)).toEqual(['Core', 'Frame']);
    expect(parseRc(d.text).script).toEqual(parseRc(source).script);
    d.undo(); expect(d.text).toBe(source);
  });
  it('adds to leaves, adds attributes to bare nodes and changes type without touching children', () => {
    const d = new ModelDocument('Body { Core { N:Chip } }');
    d.angle(1, 30); d.add(1, 'E', 'Wheel'); d.type(1, 'Frame');
    expect(d.nodes().map(n => [n.type, n.dir])).toEqual([['Core', null], ['Frame', 'N'], ['Wheel', 'E']]);
    expect(d.nodes()[1].attrs.angle).toBe('30');
  });
  it('protects Core and variable-driven angles', () => {
    const d = new ModelDocument(source);
    expect(() => d.remove(0)).toThrow(); expect(() => d.type(0, 'Chip')).toThrow();
    expect(() => d.angle(2, 0)).toThrow(); expect(d.text).toBe(source);
  });
  it('handles CRLF, multiple roots and comments before a target', () => {
    const d = new ModelDocument('Body { Core() {\r\n// hi\r\n N:Chip(/*keep*/color=#ffffff) } Core(){ S:Wheel() } }');
    d.angle(1, 90); d.angle(3, 45);
    expect(d.nodes()[1].attrs.angle).toBe('90'); expect(d.nodes()[3].attrs.angle).toBe('45');
    expect(d.text).toContain('/*keep*/');
  });
});
