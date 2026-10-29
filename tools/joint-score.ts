import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Vector3 } from 'three';
import { initRapier } from '../src/physics/world';
import { Simulation } from '../src/sim/simulation';
import { KeyState } from '../src/input/keys';
// bun tools/joint-score.ts '<tune JSON>' <model paths...>; bare ground, Up from frame 120 through 720.
const tune = { noCourse: true, ...JSON.parse(process.argv[2] || '{}') };
(globalThis as any).__tune = tune;
const frameArg=process.argv.find(x=>x.startsWith('--frames='));
const frames=frameArg?Number(frameArg.slice(9)):720;
if(!Number.isInteger(frames)||frames<120)throw new Error('--frames must be an integer >= 120');
const R = await initRapier();
for (const file of process.argv.slice(3).filter(x=>!x.startsWith('--frames='))) {
 const data = readFileSync(file); let src = new TextDecoder().decode(data);
 if (src.includes('�')) src = new TextDecoder('shift_jis').decode(data);
 const keys = new KeyState(new EventTarget()); const sim = new Simulation(R, src, keys);
 await sim.start(); let minUp=1, maxY=-Infinity, maxSpeed=0, firstFall=0; let start = new Vector3();
 for(let frame=1;frame<=frames;frame++) {
  if(frame===120) { keys.press(0); start.copy(sim.corePosition()); }
  sim.step(); const core = sim.physics.tiles[0]; const pose = sim.physics.pose(core);
  const up = new Vector3(0,1,0).applyQuaternion(pose.quaternion).y;
  if(frame>=120) { minUp=Math.min(minUp,up); if(up<0.5&&!firstFall) firstFall=frame; }
  maxY=Math.max(maxY,pose.position.y); maxSpeed=Math.max(maxSpeed,sim.physics.velocity(core,pose).length());
 }
 const end=sim.corePosition();
 console.log(JSON.stringify({model:basename(file),frames,distance:+end.clone().sub(start).setY(0).length().toFixed(2),y:+end.y.toFixed(3),minUp:+minUp.toFixed(3),firstFall,maxY:+maxY.toFixed(2),maxSpeed:+maxSpeed.toFixed(2),error:sim.scriptError}));
 await sim.lua.dispose(); sim.physics.world.free();
}
