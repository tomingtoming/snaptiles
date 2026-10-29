import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
describe('named branch duplication',()=>{
 const source='Val {P(default=12) ARM_COPY_1(default=0)} Body {Core(){E:Frame(name=ARM,angle=5){/*keep*/ E:Wheel(name=TYRE,angle=90,power=P)}}} Lua {function OnFrame() out(0,_POWER(TYRE)); ARM_COPY_2=0 end}';
 it('allocates fresh names at every paste without changing references or original bytes',()=>{
  const d=new ModelDocument(source),copy=d.copyBranch(1);expect(d.undoStack).toHaveLength(0);expect(copy.text).toContain('name=ARM');d.pasteBranch(0,'N',copy);
  expect(d.nodes().slice(3).map(n=>n.attrs.name)).toEqual(['ARM_COPY_3','TYRE_COPY_1']);expect(d.text).toContain(copy.text);expect(d.text).toContain('/*keep*/ E:Wheel(name=TYRE_COPY_1,angle=90,power=P)');expect(parseRc(d.text).script?.source).toBe(parseRc(source).script?.source);
  const once=d.text;expect(d.undoStack).toHaveLength(1);d.pasteBranch(0,'S',copy);expect(d.nodes().slice(5).map(n=>n.attrs.name)).toEqual(['ARM_COPY_4','TYRE_COPY_2']);d.undo();expect(d.text).toBe(once);d.undo();expect(d.text).toBe(source);d.redo();expect(d.text).toBe(once);
 });
 it('mirrors named branches and retains sign reversal with one history entry',()=>{
  const d=new ModelDocument(source),i=d.mirrorBranch(1);expect(i).toBe(3);expect(d.nodes()[i].attrs.name).toBe('ARM_COPY_3');expect(d.nodes()[i].dir).toBe('W');expect(d.nodes()[i+1].attrs.name).toBe('TYRE_COPY_1');expect(d.nodes()[i+1].attrs.power.replace(/\s/g,'')).toBe('-P');expect(d.undoStack).toHaveLength(1);d.undo();expect(d.text).toBe(source);
 });
 it('uses the destination namespace including names introduced after copying',()=>{
  const from=new ModelDocument('Body {Core(){E:Chip(name=ARM)}}'),copy=from.copyBranch(1);
  const to=new ModelDocument('Body {Core(){N:Chip(name=arm_copy_1)}}');to.pasteBranch(0,'E',copy);expect(to.nodes()[2].attrs.name).toBe('ARM_COPY_2');
 });
 it('preserves expression identifiers that refer to original names',()=>{
  const d=new ModelDocument('Body {Core(){E:Chip(name=ARM,user1=ARM){N:Wheel(name=TYRE,power=ARM)}}}');d.pasteBranch(0,'W',d.copyBranch(1));expect(d.nodes()[3].attrs.user1).toBe('ARM');expect(d.nodes()[4].attrs.power).toBe('ARM');expect(d.nodes()[3].attrs.name).toBe('ARM_COPY_1');
 });
 it('allocates distinct effective names even for duplicated imported identifiers',()=>{
  const d=new ModelDocument('Body {Core(){E:Chip(name=ARM){N:Chip(name=ARM)}}}');d.pasteBranch(0,'W',d.copyBranch(1));expect(d.nodes().slice(3).map(n=>n.attrs.name)).toEqual(['ARM_COPY_1','ARM_COPY_2']);
 });
});
