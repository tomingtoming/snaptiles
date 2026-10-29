import {describe,it,expect} from 'vitest';
import {ModelDocument} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
import {assemble} from '../src/model/assemble';
import {Vector3} from 'three';

describe('hinge angle bindings',()=>{
 it('binds a shared angle in reverse, preserving its magnitude editor and history',()=>{
  const d=new ModelDocument('Body {Core(){E:Chip() W:Frame()}}');d.addSteeringControl(1,25,'vertical');
  const before=d.text;d.bindAngle(2,'-st_steer_1');expect(d.nodes()[2].attrs.angle).toBe('- ST_STEER_1');expect(d.controlStrength('-ST_STEER_1')).toBe(25);
  d.setControlStrength('-ST_STEER_1',15);expect(d.controlStrength('ST_STEER_1')).toBe(15);
  d.undo();d.undo();expect(d.text).toBe(before);
 });
 it('deflects a Chip rudder about the world vertical axis after its Trim mount',()=>{
  const d=new ModelDocument('Body {Core(){S:Trim(angle=90){S:Chip()}}}');d.addSteeringControl(2,20,'ad');
  const normals=[-20,20].map(value=>new Vector3(0,1,0).applyQuaternion(assemble(parseRc(d.text),n=>n==='ST_STEER_1'?value:0)!.tiles[2].quaternion));
  expect(normals[0].z*normals[1].z).toBeLessThan(-.1);expect(Math.abs(normals[0].y)).toBeLessThan(1e-10);expect(Math.abs(normals[1].y)).toBeLessThan(1e-10);
 });
 it('rejects missing variables and arbitrary expressions without edits',()=>{
  const d=new ModelDocument('Val { A(default=0) } Body {Core(){N:Chip()}}');const source=d.text;
  for(const invalid of ['-MISSING','--A','A+1'])expect(()=>d.bindAngle(1,invalid)).toThrow();
  expect(d.text).toBe(source);expect(d.undoStack).toHaveLength(0);
 });
});
