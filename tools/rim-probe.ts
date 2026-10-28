import { readFileSync } from 'node:fs';
import { Quaternion } from 'three';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';
import { attr, jointSign } from '../src/model/assemble';
// bun tools/rim-probe.ts <model> [tune JSON]; hinge error is independent of Euler gimbal lock.
(globalThis as { __tune?: unknown }).__tune=JSON.parse(process.argv[3]||'{}');
const data=readFileSync(process.argv[2]);let source=new TextDecoder().decode(data);
if(source.includes('�')) source=new TextDecoder('shift_jis').decode(data);
const sim=new Simulation(await initRapier(),source,new KeyState(new EventTarget()));
await sim.start();
try {
 for(let frame=1;frame<=240;frame++) {
  sim.step();
  if(![1,20,60,120,121,122,130,150,240].includes(frame)) continue;
  for(const t of sim.physics.tiles) {
   if(!t.rimJoint) continue;
   const parent=sim.physics.byId.get(t.tile.parent!.id)!;
   const pr=parent.body.rotation(),cr=t.body.rotation();
   const q=new Quaternion(pr.x,pr.y,pr.z,pr.w).invert().multiply(new Quaternion(cr.x,cr.y,cr.z,cr.w));
   const axis=t.tile.rimAxis.clone().applyQuaternion(parent.bodyRestQuat.clone().invert());
   const angle=2*Math.atan2(q.x*axis.x+q.y*axis.y+q.z*axis.z,q.w);
   const target=jointSign('wheel',t.tile.dir)*(attr(t.tile.node,'angle',sim.env,0)-t.restAngle)*Math.PI/180;
   const error=Math.atan2(Math.sin(angle-target),Math.cos(angle-target))*180/Math.PI;
   console.log(JSON.stringify({frame,chip:t.tile.chipIndex,targetDeg:target*180/Math.PI,angleDeg:angle*180/Math.PI,errorDeg:error}));
  }
 }
} finally {await sim.lua.dispose();sim.physics.world.free();}
