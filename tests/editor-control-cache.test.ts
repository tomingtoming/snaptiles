import {afterEach,describe,it,expect,vi} from 'vitest';
import * as parser from '../src/rc/parser';
import {ModelDocument} from '../src/editor/document';
const source='Val {ST_STEER_1(default=0,min=-30,max=30,step=30)} Key {2:ST_STEER_1(step=-30) 3:ST_STEER_1(step=30)} Body {Core(){N:Trim(angle=ST_STEER_1)}}';
afterEach(()=>vi.restoreAllMocks());
describe('source-keyed control analysis',()=>{
 it('parses once for repeated control queries until source changes',()=>{
  const d=new ModelDocument(source),spy=vi.spyOn(parser,'parseRc');
  for(let i=0;i<100;i++){expect(d.controlStrength('-ST_STEER_1')).toBe(30);expect(d.controlKeyLabel('ST_STEER_1')).toBe('← / →');}
  expect(spy).toHaveBeenCalledTimes(1);
  d.text=source.replaceAll('30','20');expect(d.controlStrength('ST_STEER_1')).toBe(20);expect(spy).toHaveBeenCalledTimes(2);
 });
 it('does not retain old strength or labels across edits, Undo, Redo and restoration',()=>{
  const d=new ModelDocument(source);expect(d.controlStrength('ST_STEER_1')).toBe(30);
  d.setControlStrength('ST_STEER_1',45);expect(d.controlStrength('ST_STEER_1')).toBe(45);
  d.undo();expect(d.controlStrength('ST_STEER_1')).toBe(30);d.redo();expect(d.controlStrength('ST_STEER_1')).toBe(45);
  d.restore(source.replace('2:','7:').replace('3:','9:'));expect(d.controlKeyLabel('ST_STEER_1')).toBe('A / D');
  d.editSource('Body {');expect(()=>d.controlKeyLabel('ST_STEER_1')).toThrow();
  d.undo();expect(d.controlKeyLabel('ST_STEER_1')).toBe('A / D');
 });
 it('does not make an altered or duplicate declaration look editable',()=>{
  const d=new ModelDocument(source);expect(d.controlStrength('ST_STEER_1')).toBe(30);
  d.text=source.replace('step=-30','step=-3');expect(d.controlStrength('ST_STEER_1')).toBeNull();expect(d.controlKeyLabel('ST_STEER_1')).toBeNull();
  d.text=source.replace('Val {','Val {ST_STEER_1(default=4,min=-30,max=30,step=30) ');expect(d.controlStrength('ST_STEER_1')).toBeNull();
  d.text=source.replace('} Key',' ST_STEER_1(default=4,min=-30,max=30,step=30)} Key');expect(d.controlStrength('ST_STEER_1')).toBeNull();
  expect(()=>d.setControlStrength('ST_STEER_1',40)).toThrow();
 });
});
