import {describe,it,expect} from 'vitest';
import {CONTROL_KEYS,ModelDocument,type ControlKeys} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
import {initRapier} from '../src/physics/world';
import {Simulation} from '../src/sim/simulation';
import {KeyState} from '../src/input/keys';

describe('independent control key pairs',()=>{
 for(const pair of Object.keys(CONTROL_KEYS) as ControlKeys[]) for(const type of ['power','angle'] as const)
 it(`creates and resizes ${type} on ${pair} without changing bindings`,()=>{
  const d=new ModelDocument('Body {Core(){N:Trim() E:Jet()}} Lua { function main() end }');
  if(type==='power')d.addPowerControl(2,100,pair);else d.addSteeringControl(1,100,pair);
  const name=type==='power'?'ST_POWER_1':'ST_STEER_1',before=d.text;
  expect(d.controlStrength(name)).toBe(100);expect(d.controlKeyLabel(name)).toBe(CONTROL_KEYS[pair].label);d.setControlStrength(name,70);
  expect(d.controlStrength(name)).toBe(70);
  expect(parseRc(d.text).keys.map(k=>k.key)).toEqual([...CONTROL_KEYS[pair].keys]);
  expect(parseRc(d.text).keys.map(k=>k.step)).toEqual(type==='power'?[70,-70]:[-70,70]);
  d.undo();expect(d.text).toBe(before);d.redo();expect(d.controlStrength(name)).toBe(70);
  expect(d.text).toContain('Lua { function main() end }');
 });
 it('rejects unknown key pairs before changing text or history',()=>{
  const d=new ModelDocument('Body {Core(){N:Jet()}}'),before=d.text;
  expect(()=>d.addPowerControl(1,100,'bogus' as ControlKeys)).toThrow();expect(d.text).toBe(before);expect(d.undoStack).toHaveLength(0);
 });
 it('runs separate pitch, roll, yaw and thrust controls and releases each independently',async()=>{
  const d=new ModelDocument('Body { Core(){} }');
  d.add(0,'E','Trim');d.addSteeringControl(1,20,'horizontal');d.mirrorBranch(1);
  d.add(0,'S','Chip');d.add(3,'S','Trim');d.addSteeringControl(4,25,'vertical');
  d.add(3,'N','Rudder');d.addSteeringControl(5,15,'ad');
  d.add(0,'N','Jet');d.angle(6,90);d.addPowerControl(6,3000,'zx');
  const R=await initRapier(),keys=new KeyState(new EventTarget()),sim=new Simulation(R,d.text,keys);
  try{
   await sim.start();const names=['ST_STEER_1','ST_STEER_2','ST_STEER_3','ST_POWER_1'];
   for(const [key,expected] of [[0,[0,-25,0,0]],[3,[20,0,0,0]],[7,[0,0,-15,0]],[4,[0,0,0,3000]]] as const){
    keys.press(key);sim.step();expect(names.map(n=>sim.env(n))).toEqual([...expected]);
    keys.release(key);sim.step();expect(names.map(n=>sim.env(n))).toEqual([0,0,0,0]);
   }
   [0,3,7,4].forEach(k=>keys.press(k));sim.step();expect(names.map(n=>sim.env(n))).toEqual([20,-25,-15,3000]);
   keys.release(0);sim.step();expect(names.map(n=>sim.env(n))).toEqual([20,0,-15,3000]);
   keys.clear();sim.step();expect(names.map(n=>sim.env(n))).toEqual([0,0,0,0]);
  }finally{await sim.dispose()}
 });
});
