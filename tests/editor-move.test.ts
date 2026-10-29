import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
describe('branch relocation',()=>{
 const source='Val {A(default=12)} Body {Core(){N:Frame(name=BRANCH){/* inside */ E:Wheel(angle=90,power=A,name=TYRE)} W:Chip(name=TARGET) S:Trim(angle=8)}} Lua {function main() end}';
 it('moves a named subtree to a later leaf with one undo and exact unrelated source',()=>{
  const d=new ModelDocument(source);d.selectedOffset=d.nodes()[1].source!.start;const count=d.nodes().length;
  const i=d.moveBranch(1,3,'S');expect(d.nodes()).toHaveLength(count);expect(d.nodes()[i].attrs.name).toBe('BRANCH');
  const target=d.nodes().find(n=>n.attrs.name==='TARGET')!;expect(target.children[0].dir).toBe('S');expect(target.children[0].children[0].attrs.name).toBe('TYRE');
  expect(d.text).toContain('/* inside */ E:Wheel(angle=90,power=A,name=TYRE)');expect(d.text).toContain('S:Trim(angle=8)');expect(d.text.endsWith('Lua {function main() end}')).toBe(true);
  const moved=d.text;expect(d.undoStack).toHaveLength(1);d.undo();expect(d.text).toBe(source);d.redo();expect(d.text).toBe(moved);expect(d.selectedOffset).toBe(d.nodes()[i].source!.start);
 });
 it('moves a later branch to an earlier parent and preserves sibling order',()=>{
  const d=new ModelDocument(source);const i=d.moveBranch(4,1,'W');expect(d.nodes()[i].type).toBe('Trim');expect(d.nodes()[1].children.map(n=>n.type)).toEqual(['Wheel','Trim']);d.undo();expect(d.text).toBe(source);
 });
 it('changes only direction under the same parent; identical moves add no history',()=>{
  const d=new ModelDocument(source);d.moveBranch(1,0,'N');expect(d.undoStack).toHaveLength(0);d.moveBranch(1,0,'E');expect(d.text).toBe(source.replace('N:Frame','E:Frame'));expect(d.nodes()[1].attrs.name).toBe('BRANCH');
 });
 it('rejects roots, cycles and occupied destinations without mutation',()=>{
  for(const [from,to,dir] of [[0,1,'N'],[1,1,'N'],[1,2,'N'],[4,0,'W'],[4,1,'E']] as const){const d=new ModelDocument(source);expect(()=>d.moveBranch(from,to,dir)).toThrow();expect(d.text).toBe(source);expect(d.undoStack).toHaveLength(0)}
 });
 it('moves between separate Core trees without duplicating named parts',()=>{
  const d=new ModelDocument('Body {Core(){N:Chip(name=ONE)} Core(){}}');d.moveBranch(1,2,'E');const m=parseRc(d.text);expect(m.bodies[0].children).toHaveLength(0);expect(m.bodies[1].children[0].attrs.name).toBe('ONE');
 });
});
