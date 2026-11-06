import { expect, it } from 'vitest';
import { KeyState } from '../src/input/keys';
import { RustSimulation } from '../src/sim/rust-simulation';
import { decodeRecording, encodeRecording } from '../src/sim/replay';
const source = `Val { POWER(default=20000,min=0,max=60000) } Key {} Body { Core(){ N:Jet(power=POWER){} S:Jet(power=POWER){} } }
Lua { function OnInit() _SETREG("A",0) _SETREG("G",0) _SETREG("U",1) end
function OnFrame() if _TICKS()==120 then POWER=0 _SETREG("G",1) end end }`;
it('honors A/G and the measured speed limit through a browser-core recording',async()=>{
 const live=new RustSimulation(source,new KeyState(new EventTarget()),{bare:true});
 const replay=new RustSimulation(source,new KeyState(new EventTarget()),{bare:true});
 try{
  await live.start();const states:string[]=[];let top=0;
  for(let f=0;f<180;f++){
   live.step();top=Math.max(top,live.coreVelocity().length());
   states.push(JSON.stringify([live.corePosition().toArray(),live.coreVelocity().toArray()]));
   if(f===89)expect(live.coreVelocity().length()).toBeCloseTo(140,2);
  }
  expect(top).toBeLessThan(140.01);
  expect(live.coreVelocity().y).toBeLessThan(130);
  await replay.start();replay.player=await decodeRecording(await encodeRecording(live.recording));
  for(const state of states){replay.step();expect(JSON.stringify([replay.corePosition().toArray(),replay.coreVelocity().toArray()])).toBe(state);}
 }finally{await live.dispose();await replay.dispose();}
});
