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

describe('power controls', () => {
  it('creates one undoable control without altering existing script or bindings', () => {
    const d = new ModelDocument(source); d.addPowerControl(2, 1500);
    const model = parseRc(d.text);
    expect(d.nodes()[2].attrs.power).toBe('ST_POWER_1');
    expect(model.vals.at(-1)?.max).toBe(1500);
    expect(model.keys.at(-2)).toEqual({key: 0, var: 'ST_POWER_1', step: 1500});
    expect(model.script?.source).toBe(parseRc(source).script?.source);
    d.undo(); expect(d.text).toBe(source);
  });
  it('creates missing sections and avoids variable names found in scripts', () => {
    const d = new ModelDocument('Body { Core(){ E:Wheel() } } Lua { ST_POWER_1=1 }');
    d.addPowerControl(1, 500); expect(d.nodes()[1].attrs.power).toBe('ST_POWER_2');
    expect(parseRc(d.text).keys).toHaveLength(2);
    d.power(1, '-ST_POWER_2'); expect(d.nodes()[1].attrs.power).toBe('- ST_POWER_2'); d.power(1, -500); expect(d.nodes()[1].attrs.power).toBe('- 500');
  });
  it('does not use braces or fake sections in comments or Lua strings as insertion points', () => {
    const text = '// Val { fake }\nBody { Core(){ E:Wheel() } }\nLua { local s="} Val {"; local x=[=[ } Key { ]=] --[[ } ]]\n }';
    const d = new ModelDocument(text); d.addPowerControl(1, 700);
    expect(parseRc(d.text).vals).toHaveLength(1);
    expect(parseRc(d.text).script?.source).toBe(parseRc(text).script?.source);
    expect(() => new ModelDocument('Body { Core()').nodes()).toThrow();
  });
});

describe('blank vehicles and steering', () => {
  it('creates a blank Core and restores all original contents with Undo', () => {
    const d = new ModelDocument(source); d.newModel(); expect(d.nodes().map(n => n.type)).toEqual(['Core']);
    d.undo(); expect(d.text).toBe(source);
  });
  it('creates steering independently from throttle and permits sharing it with another joint', () => {
    const d = new ModelDocument('Body{Core(){N:Rudder(){N:Wheel()} S:Trim()}}');
    d.addPowerControl(2, 800); d.addSteeringControl(1);
    expect(parseRc(d.text).keys.slice(-2)).toEqual([{key:2,var:'ST_STEER_1',step:-30},{key:3,var:'ST_STEER_1',step:30}]);
    d.bindAngle(3, 'ST_STEER_1'); expect(d.nodes()[3].attrs.angle).toBe('ST_STEER_1');
    d.fixedAngle(3); expect(d.nodes()[3].attrs.angle).toBe('0');
    expect(d.nodes()[1].attrs.angle).toBe('ST_STEER_1');
  });
});
