import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
describe('separate generated controls',()=>{
 for(const kind of ['steer','power','held'] as const)for(const attribute of ['angle','power'] as const)it(`preserves ${kind} semantics when bound to ${attribute}`,()=>{
  for(const reverse of [false,true]){
   const d=new ModelDocument('Body {Core(){E:Trim() W:Jet()}} Lua {function main() end}');
   if(kind==='steer')d.addSteeringControl(1,40,'ad');else if(kind==='held')d.addThrottleControl(1,400,'zx');else d.addPowerControl(1,400,'horizontal');
   const old=kind==='steer'?'ST_STEER_1':kind==='held'?'ST_THROTTLE_1':'ST_POWER_1';
   if(attribute==='angle')d.bindAngle(2,(reverse?'-':'')+old);else d.power(2,(reverse?'-':'')+old);
   const before=d.text,history=d.undoStack.length,original=parseRc(before);
   d.separateControl(2,attribute);const after=d.text,newName=old.replace('_1','_2');
   expect(d.nodes()[2].attrs[attribute].replace(/\s/g,'')).toBe((reverse?'-':'')+newName);
   expect(d.undoStack).toHaveLength(history+1);
   const model=parseRc(after);expect(model.vals.at(-1)).toEqual({...original.vals[0],name:newName});
   expect(model.keys.slice(-2)).toEqual(original.keys.map(k=>({...k,var:newName})));
   d.setControlStrength(newName,25);expect(d.controlStrength(old)).toBe(kind==='steer'?40:400);expect(d.controlStrength(newName)).toBe(25);
   d.undo();expect(d.text).toBe(after);d.undo();expect(d.text).toBe(before);d.redo();expect(d.text).toBe(after);
   expect(d.text).toContain('Lua {function main() end}');
  }
 });
 it('refuses custom expressions without changing source or history',()=>{
  const d=new ModelDocument('Val {A(default=2)} Body {Core(){E:Jet(power=A*2)}}');const before=d.text;
  expect(()=>d.separateControl(1,'power')).toThrow();expect(d.text).toBe(before);expect(d.undoStack).toHaveLength(0);
 });
});
