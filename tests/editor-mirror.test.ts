import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {ModelDocument} from '../src/editor/document';
import {assemble} from '../src/model/assemble';
import {parseRc} from '../src/rc/parser';
import {evalExpr} from '../src/rc/expr';

describe('opposite-side branch duplication',()=>{
 for(const edge of ['N','S','E','W'] as const) it(`reflects nested poses about the parent local plane for ${edge}`,()=>{
  const d=new ModelDocument(`Val { A(default=23) P(default=800) }
Body { Core(){ N:Chip(angle=31){ ${edge}:Rudder(angle=A){
 E:Trim(angle=17){N:Wheel(angle=90,power=P){S:Chip(angle=-15)}}
 W:Jet(angle=25,power=70) S:Cowl(angle=15,option=3,color=#ff1234)
} } } } Lua { function main() end }`);
  const before=d.text, originalNodes=d.nodes().length, count=d.copyBranch(2).count;
  const inserted=d.mirrorBranch(2);expect(inserted).toBe(originalNodes);expect(d.undoStack).toHaveLength(1);
  const model=parseRc(d.text), env=(name:string)=>model.vals.find(v=>v.name===name)?.default;
  const a=assemble(model,env)!, parent=a.tiles[1], inv=parent.quaternion.clone().invert();
  const axis=edge==='E'||edge==='W'?'x':'z';
  const reflect=(v:Vector3)=>{v[axis]*=-1;return v;};
  for(let i=0;i<count;i++){
   const original=a.tiles[2+i], mirrored=a.tiles[inserted+i];
   const local=(p:Vector3)=>p.clone().sub(parent.position).applyQuaternion(inv);
   expect(local(mirrored.position).distanceTo(reflect(local(original.position)))).toBeLessThan(1e-10);
   for(const basis of [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)]){
    const expected=reflect(reflect(basis.clone()).applyQuaternion(original.quaternion).applyQuaternion(inv));
    const actual=basis.clone().applyQuaternion(mirrored.quaternion).applyQuaternion(inv);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
   }
  }
  const copied=d.nodes().slice(inserted);
  expect(copied.find(n=>n.type==='Wheel')!.attrs.power.replace(/\s/g,'')).toBe('-P');
  expect(copied.find(n=>n.type==='Jet')!.attrs.power).toBe('70');
  expect(copied.find(n=>n.type==='Cowl')!.attrs.option).toBe('4');
  expect(d.text).toContain('Lua { function main() end }');
  d.undo();expect(d.text).toBe(before);d.redo();expect(d.nodes()).toHaveLength(originalNodes+count);
 });
 it('preserves unrelated text and expression meaning while reversing wheel control',()=>{
  const source='Val { P(default=7) } Body { Core(){ E /* edge */ :Wheel(angle=90,power=P /* keep */ + 3,color=#123456) } }';
  const d=new ModelDocument(source),i=d.mirrorBranch(1);
  expect(d.text).toContain('E /* edge */ :Wheel(angle=90,power=P /* keep */ + 3,color=#123456)');
  expect(d.text.match(/keep/g)).toHaveLength(2);
  expect(evalExpr(d.nodes()[i].attrs.power,n=>n==='P'?7:undefined)).toBe(-10);
 });
 it('reverses negative named controls without making them opaque to the control editor',()=>{
  const d=new ModelDocument('Val { P(default=0) } Body { Core(){ W:RLW(angle=90,power=-P) } }');
  const i=d.mirrorBranch(1);expect(d.nodes()[i].attrs.power).toBe('P');expect(d.nodes()[i].dir).toBe('E');
 });
 for(const source of [
  'Body { Core(){E:Chip() W:Chip()} }',
  'Val { SHAPE(default=3) } Body { Core(){E:Cowl(option=SHAPE)} }'
 ]) it('rejects ambiguous duplication without changing history or source',()=>{
  const d=new ModelDocument(source);expect(()=>d.mirrorBranch(1)).toThrow();expect(d.text).toBe(source);expect(d.undoStack).toHaveLength(0);
 });
});
