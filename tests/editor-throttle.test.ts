import {describe,it,expect} from 'vitest';
import {ModelDocument,CONTROL_KEYS,type ControlKeys} from '../src/editor/document';
import {parseRc} from '../src/rc/parser';
import {initRapier} from '../src/physics/world';
import {Simulation} from '../src/sim/simulation';
import {KeyState} from '../src/input/keys';

describe('held throttle controls',()=>{
 for(const pair of Object.keys(CONTROL_KEYS) as ControlKeys[])it(`creates and resizes a held throttle on ${pair}`,()=>{
  const source='Body {Core(){N:Jet() S:Jet()}} Lua { function main() end }',d=new ModelDocument(source);
  d.addThrottleControl(1,60000,pair);expect(d.undoStack).toHaveLength(1);
  const generated=d.text;expect(d.controlStrength('ST_THROTTLE_1')).toBe(60000);
  expect(d.controlKeyLabel('-ST_THROTTLE_1')).toBe(CONTROL_KEYS[pair].label+'（保持）');
  d.power(2,'-ST_THROTTLE_1');d.setControlStrength('ST_THROTTLE_1',12000);
  const m=parseRc(d.text);expect(m.vals[0]).toEqual({name:'ST_THROTTLE_1',default:0,min:0,max:12000,step:0});
  expect(m.keys.map(k=>k.step)).toEqual([120,-120]);expect(m.keys.map(k=>k.key)).toEqual([...CONTROL_KEYS[pair].keys]);
  expect(d.controlStrength('ST_THROTTLE_1')).toBe(12000);expect(d.nodes()[2].attrs.power).toBe('- ST_THROTTLE_1');
  d.undo();expect(d.controlStrength('ST_THROTTLE_1')).toBe(60000);d.undo();expect(d.text).toBe(generated);d.undo();expect(d.text).toBe(source);
 });
 it('does not overwrite existing identifiers or reinterpret changed throttle definitions',()=>{
  const d=new ModelDocument('Body {Core(){N:Jet()}} Lua { ST_THROTTLE_1=7 }');d.addThrottleControl(1,1000);
  expect(d.nodes()[1].attrs.power).toBe('ST_THROTTLE_2');d.text=d.text.replace('step=10','step=5');
  const before=d.text;expect(d.controlStrength('ST_THROTTLE_2')).toBeNull();expect(()=>d.setControlStrength('ST_THROTTLE_2',2000)).toThrow();expect(d.text).toBe(before);
 });
 it('accumulates, holds, clamps, decreases to zero and starts a new simulation at zero',async()=>{
  const d=new ModelDocument('Body {Core(){N:Jet(angle=90) S:Trim()}}');d.addThrottleControl(1,1000);d.addSteeringControl(2,25,'vertical');
  const R=await initRapier(),keys=new KeyState(new EventTarget());
  const sim=new Simulation(R,d.text,keys);
  try{
   await sim.start();const advance=(n:number)=>{for(let i=0;i<n;i++)sim.step()};
   keys.press(4);advance(17);expect(sim.env('ST_THROTTLE_1')).toBe(170);keys.release(4);advance(10);expect(sim.env('ST_THROTTLE_1')).toBe(170);
   keys.press(0);advance(1);expect(sim.env('ST_STEER_1')).toBe(-25);expect(sim.env('ST_THROTTLE_1')).toBe(170);
   keys.release(0);advance(1);expect(sim.env('ST_STEER_1')).toBe(0);expect(sim.env('ST_THROTTLE_1')).toBe(170);
   keys.press(4);advance(110);expect(sim.env('ST_THROTTLE_1')).toBe(1000);keys.clear();advance(5);expect(sim.env('ST_THROTTLE_1')).toBe(1000);
   keys.press(5);advance(23);expect(sim.env('ST_THROTTLE_1')).toBe(770);keys.release(5);advance(3);expect(sim.env('ST_THROTTLE_1')).toBe(770);
   keys.press(5);advance(100);expect(sim.env('ST_THROTTLE_1')).toBe(0);keys.clear();
  }finally{await sim.dispose()}
  const fresh=new Simulation(R,d.text,keys);try{await fresh.start();fresh.step();expect(fresh.env('ST_THROTTLE_1')).toBe(0)}finally{await fresh.dispose()}
 });
});
