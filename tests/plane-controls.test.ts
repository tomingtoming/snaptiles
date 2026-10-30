import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {PLANE} from '../src/samples/plane';
import {parseRc} from '../src/rc/parser';
import {assemble} from '../src/model/assemble';
import {initRapier} from '../src/physics/world';
import {Simulation} from '../src/sim/simulation';
import {KeyState} from '../src/input/keys';

describe('plane sample control geometry and motion',()=>{
 const surfaces=(control:string,value:number)=>assemble(parseRc(PLANE),n=>n===control?value:0)!.tiles.filter(t=>t.node.attrs.angle?.includes(control));
 const normal=(t:ReturnType<typeof surfaces>[number])=>new Vector3(0,1,0).applyQuaternion(t.quaternion);
 it('uses equal elevator deflections and opposed aileron deflections',()=>{
  const e=surfaces('ELEV',10).map(normal),a=surfaces('AIL',10).map(normal);
  expect(e).toHaveLength(2);expect(e[0].distanceTo(e[1])).toBeLessThan(1e-10);expect(Math.abs(e[0].z)).toBeGreaterThan(.1);
  expect(a).toHaveLength(2);expect(a[0].z*a[1].z).toBeLessThan(-.02);
 });
 it('aligns the neutral vertical fin with forward travel and deflects it about vertical',()=>{
  const zero=normal(surfaces('RUD',0)[0]),left=normal(surfaces('RUD',-10)[0]),right=normal(surfaces('RUD',10)[0]);
  expect(Math.abs(zero.x)).toBeCloseTo(1);expect(Math.abs(zero.z)).toBeLessThan(1e-10);
  expect(Math.abs(left.y)).toBeLessThan(1e-10);expect(Math.abs(right.y)).toBeLessThan(1e-10);expect(left.z*right.z).toBeLessThan(-.02);
 });
 it('responds on the requested physical axes from the same airborne state',async()=>{
  const R=await initRapier(),results=new Map<number|null,Vector3>();
  for(const key of [null,0,1,2,3,7,9]){
   const keys=new KeyState(new EventTarget()),sim=new Simulation(R,PLANE,keys);
   try{
    await sim.start();const bodies=new Set(sim.physics.tiles.flatMap(t=>t.rim?[t.body,t.rim]:[t.body]));
    for(const b of bodies){const p=b.translation();b.setTranslation({x:p.x,y:p.y+20,z:p.z},true);b.setLinvel({x:0,y:0,z:-30},true)}
    if(key!==null)keys.press(key);for(let i=0;i<15;i++)sim.step();
    const w=sim.physics.tiles[0].body.angvel();results.set(key,new Vector3(w.x,w.y,w.z));
   }finally{await sim.dispose()}
  }
  expect(results.get(null)!.length()).toBeLessThan(.15);
  // ↑↓ change the autopilot's wanted climb rate, not the elevator directly, so pitch responds more gently
  expect(results.get(0)!.x).toBeLessThan(-.15);expect(results.get(1)!.x).toBeGreaterThan(.15);
  expect(results.get(2)!.z).toBeGreaterThan(.7);expect(results.get(3)!.z).toBeLessThan(-.7);
  expect(results.get(7)!.y).toBeGreaterThan(.2);expect(results.get(9)!.y).toBeLessThan(-.2);
  for(const key of [0,1]){expect(Math.abs(results.get(key)!.y)).toBeLessThan(.05);expect(Math.abs(results.get(key)!.z)).toBeLessThan(.05)}
  for(const key of [7,9])expect(Math.abs(results.get(key)!.z)).toBeLessThan(.05);
 });
 it('takes off with pull-up rather than climbing unintentionally under neutral controls',async()=>{
  const R=await initRapier(),heights=[];
  for(const pullUp of [false,true]){
   const keys=new KeyState(new EventTarget()),sim=new Simulation(R,PLANE,keys);
   try{await sim.start();for(let i=0;i<180;i++){
    if(i===0)keys.press(4);if(i===100)keys.release(4);if(i===150&&pullUp)keys.press(1);sim.step();
   }heights.push(sim.corePosition().y);expect(sim.corePosition().z).toBeLessThan(-80);
   }finally{await sim.dispose()}
  }
  expect(heights[0]).toBeLessThan(2);expect(heights[1]).toBeGreaterThan(3.5);
 });
 it('rolls straight, lifts off and keeps flying hands-off, through a banked turn and back to level',async()=>{
  const R=await initRapier(),keys=new KeyState(new EventTarget()),sim=new Simulation(R,PLANE,keys);
  try{
   await sim.start();const api=sim.api() as Record<string,(n:number)=>number>;
   let liftoff=-1,lowest=Infinity,drift=0,headingBefore=0;
   keys.press(4);
   for(let i=0;i<30*40;i++){
    if(i===100)keys.release(4);
    if(i===30*15){headingBefore=api._EY(0);keys.press(2);}
    if(i===30*22)keys.release(2);
    sim.step();const p=sim.corePosition();
    if(liftoff<0){drift=Math.max(drift,Math.abs(p.x));if(p.y>4)liftoff=i;}
    else if(i>liftoff+90)lowest=Math.min(lowest,p.y);
    if(i===30*22)expect(Math.abs(api._EY(0)-headingBefore)).toBeGreaterThan(.4);
   }
   // Measured: liftoff ~8 s at full throttle, ~14 m sideways on the run, never below ~10 m afterwards.
   expect(liftoff).toBeGreaterThan(0);expect(liftoff).toBeLessThan(30*12);expect(drift).toBeLessThan(30);
   expect(lowest).toBeGreaterThan(5);expect(Math.abs(api._EZ(0))).toBeLessThan(.1);
  }finally{await sim.dispose()}
 });
});
