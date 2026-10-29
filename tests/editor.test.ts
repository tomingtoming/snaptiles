import { DraftStore } from '../src/editor/draft';
import { describe, it, expect } from 'vitest';
import { downloadFilename, ModelDocument } from '../src/editor/document';
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

describe('draft recovery', () => {
  it('keeps unfinished text and makes restoration undoable', () => {
    const store = new Map<string,string>();
    const drafts = new DraftStore({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);}});
    expect(drafts.save('Body { Core(')).toBe(true);
    const d = new ModelDocument(source); d.restore(drafts.read()!.text);
    expect(d.text).toBe('Body { Core('); d.undo(); expect(d.text).toBe(source);
  });
  it('tolerates unavailable or corrupt browser storage', () => {
    const drafts = new DraftStore({getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('quota');}});
    expect(drafts.read()).toBeNull(); expect(drafts.save('x')).toBe(false);
    expect(new DraftStore({getItem:()=>'{bad',setItem:()=>{}}).read()).toBeNull();
  });
});

describe('shared control strength', () => {
  it('changes the bounds, release and both keys together and undoes exactly', () => {
    const d = new ModelDocument('Body{Core(){E:Wheel() W:Wheel()}}');
    d.addPowerControl(1, 800); d.power(2, '-ST_POWER_1'); const before=d.text;
    d.setControlStrength('-ST_POWER_1', 1600);
    expect(d.controlStrength('ST_POWER_1')).toBe(1600);
    expect(parseRc(d.text).keys.map(k=>k.step)).toEqual([1600,-1600]);
    expect(d.nodes()[2].attrs.power).toBe('- ST_POWER_1');
    d.undo(); expect(d.text).toBe(before);
  });
  it('protects non-generated and manually altered controls', () => {
    const d = new ModelDocument(source); expect(d.controlStrength('A')).toBeNull();
    expect(()=>d.setControlStrength('A',10)).toThrow();
    d.addSteeringControl(1); d.text=d.text.replace('step=30','step=3');
    expect(d.controlStrength('ST_STEER_1')).toBeNull();
  });
});

describe('branch copy and paste', () => {
  it('keeps expressions, comments and nested structure while changing only the root edge', () => {
    const d = new ModelDocument(source), original = d.text, branch = d.copyBranch(1);
    d.pasteBranch(0,'W',branch);
    expect(d.nodes().map(n=>n.type)).toEqual(['Core','Chip','Wheel','Frame','Chip','Wheel']);
    expect(d.nodes()[4].dir).toBe('W'); expect(d.nodes()[5].attrs.angle).toBe('A');
    expect(parseRc(d.text).script?.source).toBe(parseRc(source).script?.source);
    d.undo(); expect(d.text).toBe(original);
  });
  it('protects named branches and missing variables in a new document', () => {
    const d = new ModelDocument('Body{Core(){N:Chip(name=ARM)}}'); expect(()=>d.copyBranch(1)).toThrow();
    const original = new ModelDocument(source), branch=original.copyBranch(1); original.newModel();
    expect(()=>original.pasteBranch(0,'S',branch)).toThrow();
  });
});


describe('document filenames', () => {
  it('keeps imported names through edits and restores them with Undo after New', () => {
    const d = new ModelDocument('Body { Core() }', '探査車.txt');
    d.add(0, 'N', 'Chip'); expect(d.filename).toBe('探査車.txt');
    const edited = d.text;
    d.newModel(); expect(d.filename).toBeUndefined();
    d.undo(); expect(d.text).toBe(edited); expect(d.filename).toBe('探査車.txt');
    d.redo(); expect(d.filename).toBeUndefined();
    d.restore('Body { Core() }', 'other.rcd'); expect(d.filename).toBe('other.rcd');
    d.undo(); expect(d.filename).toBeUndefined();
  });
  it('round-trips names in drafts and accepts older unnamed drafts', () => {
    let value = '';
    const drafts = new DraftStore({getItem:()=>value,setItem:(_, v)=>{value=v;}});
    drafts.save('Body { Core() }', 'rover.rcd'); expect(drafts.read()?.filename).toBe('rover.rcd');
    value = JSON.stringify({version:1,text:'old',savedAt:1}); expect(drafts.read()?.filename).toBeUndefined();
    value = JSON.stringify({version:1,text:'old',savedAt:1,filename:{bad:true}}); expect(drafts.read()?.filename).toBeUndefined();
  });
  it('exports portable .rcd names without path components', () => {
    expect(downloadFilename('探査車.TXT')).toBe('探査車.rcd');
    expect(downloadFilename('../folder/rover.rc')).toBe('rover.rcd');
    expect(downloadFilename('NUL.rcd')).toBe('_NUL.rcd');
    expect(downloadFilename('')).toBe('model.rcd');
  });
});


describe('wheel and ballast options', () => {
  it('changes only option, preserves script and undoes exactly', () => {
    const text = 'Body { Core() { E:Wheel(angle=90, option=0, power=P) N:Weight() } }\nLua { -- preserved\n }';
    const d = new ModelDocument(text);
    d.option(1, 2); expect(d.nodes()[1].attrs.option).toBe('2');
    expect(d.text).toBe(text.replace('option=0', 'option=2'));
    d.undo(); expect(d.text).toBe(text);
    d.option(2, 8); expect(d.nodes()[2].attrs.option).toBe('8');
    d.undo(); expect(d.text).toBe(text);
  });
  it('rejects wrong types, out-of-range values and expression replacement', () => {
    const d = new ModelDocument('Val { R(default=1) } Body { Core() { E:Wheel(option=R) N:Weight() } }');
    const before=d.text;
    expect(()=>d.option(0,1)).toThrow(); expect(()=>d.option(1,2)).toThrow();
    expect(()=>d.option(2,9)).toThrow(); expect(()=>d.option(2,1.5)).toThrow();
    expect(d.text).toBe(before);
  });
});


describe('part colors', () => {
  it('sets Core and part colors without changing other attributes or Lua', () => {
    const text = 'Body { Core() { N:Chip(color=#aabbcc, angle=25) } }\nLua { -- keep\n }';
    const d = new ModelDocument(text);
    d.color(1, '#12AB34'); expect(d.text).toBe(text.replace('#aabbcc','#12ab34'));
    d.undo(); expect(d.text).toBe(text);
    d.color(0,'#0044ff'); expect(d.nodes()[0].attrs.color).toBe('#0044ff');
    d.undo(); expect(d.text).toBe(text);
  });
  it('protects variable colors and rejects invalid hex input', () => {
    const d = new ModelDocument('Val { C(default=255) } Body { Core(color=C) }');
    const before=d.text;
    expect(()=>d.color(0,'#00ff00')).toThrow(); expect(()=>d.color(0,'red')).toThrow();
    expect(d.text).toBe(before);
  });
});
