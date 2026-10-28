import { readFileSync,writeFileSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { Vector3, Quaternion } from 'three';
import { attr } from '../src/model/assemble';
import { Simulation } from '../src/sim/simulation';
import { initRapier } from '../src/physics/world';
import { KeyState } from '../src/input/keys';
// bun tools/servo-cause-probe.ts model.rcd tune-json absolute-output.jsonl [intervention-json]
// Diagnostic-only private-method wrappers; production behavior is unchanged without an intervention.
// Fixed/welded rest interventions apply ONLY to static commanded poses, not moving gaits.
if(!process.argv[4] || !isAbsolute(process.argv[4]))throw new Error('An absolute output path is required');
(globalThis as any).__tune={noCourse:true,...JSON.parse(process.argv[3]||'{}')};
const intervention=JSON.parse(process.argv[5]||'{}');
const data=readFileSync(process.argv[2]);let source=new TextDecoder().decode(data);
if(source.includes('�')) source=new TextDecoder('shift_jis').decode(data);
const R=await initRapier();
const sim=new Simulation(R,source,new KeyState(new EventTarget()));await sim.start();
let initialPoseDifference=0;
if(intervention.weldRest){
 const before=sim.physics.tiles.map(t=>sim.physics.pose(t));
 for(const t of sim.assembly!.tiles) if(t.node.attrs.angle!==undefined)t.node.attrs.angle=String(attr(t.node,'angle',sim.env,0));
 sim.physics.build(sim.assembly!,sim.env);
 initialPoseDifference=Math.max(...sim.physics.tiles.map((t,i)=>sim.physics.pose(t).position.distanceTo(before[i].position)));
}
if(intervention.fixedRest || intervention.fixedChips){
 for(const t of sim.physics.tiles){
  if(!t.joint || (intervention.fixedChips && !intervention.fixedChips.includes(t.tile.chipIndex)))continue;
  const j=t.joint,a=j.anchor1(),b=j.anchor2(),parent=sim.physics.byId.get(t.tile.parent!.id)!;
  sim.physics.world.removeImpulseJoint(j,true);
  sim.physics.world.createImpulseJoint(R.JointData.fixed(a,{x:0,y:0,z:0,w:1},b,{x:0,y:0,z:0,w:1}),parent.body,t.body,true);
  t.joint=null;
 }
}
const p=sim.physics as any;
const bodies=[...new Map(sim.physics.tiles.map(t=>[t.body.handle,t.body])).values()];
const totalMass=bodies.reduce((m,b)=>m+b.mass(),0);
const snapshot=()=>{
 let y=0;for(const b of bodies)y+=b.mass()*b.worldCom().y;
 return {comY:y/totalMass,up:new Vector3(0,1,0).applyQuaternion(sim.physics.pose(sim.physics.tiles[0]).quaternion).y};
};
let frame=0,substep=0;const rows:any[]=[];const targets=new Map<number,number>();
const servo=p.servoTeleport.bind(p),step=p.step.bind(p);
p.servoTeleport=(tb:any)=>{
 const target=tb.servoAngle; const old=targets.get(tb.tile.id)??0;targets.set(tb.tile.id,target);
 const error=target-p.jointAngle(tb);if(Math.abs(error)<1e-4){servo(tb);return;}
 const before=snapshot();
 const execute=intervention.mode!=='off' && !(intervention.mode==='command-only' && Math.abs(target-old)<1e-8);
 if(execute) servo(tb);
 const after=snapshot();
 rows.push({frame,substep,phase:'servo',execute,chip:tb.tile.chipIndex,targetChange:(target-old)*180/Math.PI,errorDeg:error*180/Math.PI,deltaY:after.comY-before.comY,deltaUp:after.up-before.up,up:after.up});
};
p.step=()=>{
 const before=snapshot();step();const after=snapshot();
 let worst={chip:-1,errorDeg:0,twistDeg:0};
 for(const t of sim.physics.tiles){
  if(!t.jointAxisLocal)continue;
  const pr=sim.physics.byId.get(t.tile.parent!.id)!.body.rotation(),cr=t.body.rotation();
  const qrel=new Quaternion(pr.x,pr.y,pr.z,pr.w).invert().multiply(new Quaternion(cr.x,cr.y,cr.z,cr.w));
  const target=new Quaternion().setFromAxisAngle(t.jointAxisLocal,t.servoAngle);
  const errorDeg=target.angleTo(qrel)*180/Math.PI;
  if(errorDeg>worst.errorDeg)worst={chip:t.tile.chipIndex,errorDeg,twistDeg:(p.jointAngle(t)-t.servoAngle)*180/Math.PI};
 }
 rows.push({frame,substep,phase:'solver',deltaY:after.comY-before.comY,deltaUp:after.up-before.up,up:after.up,comY:after.comY,worst});substep++;
};
try{for(frame=1;frame<=240;frame++){
 substep=0;
 if(frame===intervention.switchFrame)(globalThis as any).__tune.servoHold=intervention.switchHold;
 sim.step();
}}
finally{await sim.lua.dispose();sim.physics.world.free();}
writeFileSync(process.argv[4],rows.map(r=>JSON.stringify(r)).join('\n'));
const ss=rows.filter(r=>r.phase==='servo'), staticRows=ss.filter(r=>Math.abs(r.targetChange)<1e-8);
const ends=rows.filter(r=>r.phase==='solver' && r.substep===1);
console.log(JSON.stringify({model:basename(process.argv[2]),tune:process.argv[3],intervention,initialPoseDifference,totalMass,bodyCount:bodies.length,endFrameMinUp:Math.min(...ends.map(r=>r.up)),firstEndFrameFall:ends.find(r=>r.up<.5)?.frame??null,calls:ss.length,staticCalls:staticRows.length,staticAbsUp:staticRows.reduce((s,r)=>s+Math.abs(r.deltaUp),0),final:rows.at(-1),firstTilt:rows.find(r=>r.up<.95),firstFall:rows.find(r=>r.up<.5),error:sim.scriptError}));
