import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
describe('part names',()=>{
 const source='Val {SPEED(default=0)} Body {Core(){N:Frame(name=OLD,/* keep */angle=20){E:Wheel(name=TYRE)}}} Lua {function OnFrame() out(0,_TYPE(OLD)) end}';
 it('sets and changes names in one transaction without changing script references',()=>{
  const d=new ModelDocument(source);d.selectedOffset=d.nodes()[1].source!.start;d.name(1,' front_arm ');
  expect(d.text).toBe(source.replace('name=OLD','name=FRONT_ARM'));expect(d.undoStack).toHaveLength(1);expect(d.selectedOffset).toBe(d.nodes()[1].source!.start);
  const named=d.text;d.undo();expect(d.text).toBe(source);d.redo();expect(d.text).toBe(named);d.name(0,'MAIN');expect(d.nodes()[0].attrs.name).toBe('MAIN');
 });
 it('rejects malformed names and case-insensitive part/variable collisions without edits',()=>{
  for(const name of ['1FOO','_KEY','a b','日本語','x);Lua{}','tyre','speed']){const d=new ModelDocument(source);expect(()=>d.name(1,name)).toThrow();expect(d.text).toBe(source);expect(d.undoStack).toHaveLength(0)}
 });
 it('clears every duplicate name token while preserving comments and other attributes',()=>{
  const d=new ModelDocument('Body {Core(name=MAIN){N:Chip(name=OLD,/* keep */angle=25,name=LAST)}}');const before=d.text;
  d.name(1,'');expect(d.nodes()[1].attrs.name).toBeUndefined();expect(d.nodes()[1].attrs.angle).toBe('25');expect(d.text).toContain('/* keep */');expect(d.text).not.toMatch(/OLD|LAST/);d.undo();expect(d.text).toBe(before);
 });
 it('adds names to bare headers and treats unchanged/absent names as no-ops',()=>{
  const d=new ModelDocument('Body {Core{N:Chip}}');d.name(1,'');expect(d.undoStack).toHaveLength(0);d.name(1,'left');expect(d.nodes()[1].attrs.name).toBe('LEFT');d.name(1,'LEFT');expect(d.undoStack).toHaveLength(1);
 });
});
