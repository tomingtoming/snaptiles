import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
describe('copied attribute dependencies',()=>{
 it('finds actual reads without requiring names in comments, literals or declarations',()=>{
  const d=new ModelDocument('Val {P(default=7) FACE(default=1) E3(default=9) UNUSED(default=2)} Body {Core(){N:Chip(name=UNUSED,color=#FACE,angle=1e3,power=P /* UNUSED */)}}');
  const branch=d.copyBranch(1);expect(branch.variables).toEqual(['P']);expect(branch.partNames).toEqual([]);
  const target=new ModelDocument('Val {P(default=8)} Body {Core(){}}');target.pasteBranch(0,'N',branch);expect(target.nodes()[1].attrs.name).toBe('UNUSED_COPY_1');
 });
 it('reports missing named dependencies before changing source or history',()=>{
  const from=new ModelDocument('Body {Core(){N:Chip(name=REF) E:Wheel(power=REF,user1=REF)}}'),branch=from.copyBranch(2);
  expect(branch.partNames).toEqual(['REF']);const target=new ModelDocument('Body {Core(){}}'),before=target.text;
  expect(()=>target.pasteBranch(0,'W',branch)).toThrow(/REF/);expect(target.text).toBe(before);expect(target.undoStack).toHaveLength(0);
  const withRef=new ModelDocument('Body {Core(){N:Chip(name=ref)}}');withRef.pasteBranch(0,'W',branch);expect(withRef.nodes()[2].attrs.power).toBe('REF');
 });
 it('rejects a variable shadowing a required part but preserves variable precedence from source',()=>{
  const from=new ModelDocument('Body {Core(){N:Chip(name=REF) E:Wheel(power=REF)}}');
  const target=new ModelDocument('Val {REF(default=1)} Body {Core(){N:Chip(name=REF)}}');expect(()=>target.pasteBranch(0,'E',from.copyBranch(2))).toThrow(/REF/);
  expect(target.copyBranch(1).variables).toEqual([]);
  const ambiguous=new ModelDocument('Val {REF(default=1)} Body {Core(){N:Chip(name=REF) E:Wheel(power=REF)}}');expect(ambiguous.copyBranch(2).variables).toEqual(['REF']);expect(ambiguous.copyBranch(2).partNames).toEqual([]);
 });
 it('requires original internal name targets since copied expressions are not rebound',()=>{
  const d=new ModelDocument('Body {Core(){N:Chip(name=ARM,user1=ARM)}}'),branch=d.copyBranch(1);expect(branch.partNames).toEqual(['ARM']);d.pasteBranch(0,'W',branch);expect(d.nodes()[2].attrs.user1).toBe('ARM');
  const target=new ModelDocument('Body {Core(){}}');expect(()=>target.pasteBranch(0,'W',branch)).toThrow(/ARM/);
 });
 it('reports missing variables by name and leaves pre-existing unknown reads unchanged',()=>{
  const d=new ModelDocument('Val {P(default=7)} Body {Core(){N:Wheel(power=P+MISSING)}}'),branch=d.copyBranch(1);expect(branch.variables).toEqual(['P']);
  const target=new ModelDocument('Body {Core(){}}');expect(()=>target.pasteBranch(0,'N',branch)).toThrow(/P/);
  const known=new ModelDocument('Val {P(default=1)} Body {Core(){}}');known.pasteBranch(0,'N',branch);expect(known.nodes()[1].attrs.power.replace(/\s/g,'')).toBe('P+MISSING');
 });
});
