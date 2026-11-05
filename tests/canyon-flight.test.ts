import { it, expect } from 'vitest';
import { RustSimulation } from '../src/sim/rust-simulation';
import { KeyState } from '../src/input/keys';
import { PLANE } from '../src/samples/plane';
import { chartHeight, scenarioById } from '../src/challenge/scenarios';

it('flies the stock plane below the canyon walls through both bends', async () => {
  const keys = new KeyState(new EventTarget()), sim = new RustSimulation(PLANE, keys, {scenario: scenarioById('canyon-run')});
  const key = (n:number, down:boolean) => down ? keys.press(n) : keys.release(n);
  const route = [[120,0],[180,12],[240,36],[300,12],[360,-24],[420,-24],[480,0],[500,0]];
  const centre = (d:number) => {
    for(let i=1;i<route.length;i++){
      const [a,x] = route[i-1], [b,y] = route[i];
      if(d<=b) return x+(y-x)*Math.max(0,(d-a)/(b-a));
    }
    return 0;
  };
  let worst = 0, minHeight = Infinity, maxHeight = 0, next = 0;
  try {
    await sim.start();
    while(sim.frame<1800 && next<route.length) {
      const p=sim.corePosition(), v=sim.coreVelocity(), d=-p.z;
      key(4,sim.frame>=45 && (d<105 || (sim.env('THROTTLE')??0)<22000));
      key(5,d>=105 && (sim.env('THROTTLE')??0)>22500);
      key(1,d>30 && p.y<18 && v.y<6);
      key(0,p.y>21 && v.y>-2);
      const aim = 1.5*centre(d+80);
      const steer = Math.max(-40,Math.min(40,(aim-p.x)*1.8-v.x*5));
      const bank = sim.env('BANK')??0;
      key(2,d>90 && steer < bank-2); key(3,d>90 && steer > bank+2);
      const rud = sim.env('RUD') ?? 0;
      key(7,d>65 && steer*0.6 < rud-1); key(9,d>65 && steer*0.6 > rud+1);
      if(d>=120){
        worst=Math.max(worst,Math.abs(p.x-centre(d)));
        minHeight=Math.min(minHeight,p.y-chartHeight(sim.scenario!.terrainFaces!,p.x,p.z)!);maxHeight=Math.max(maxHeight,p.y);
      }
      if (d >= route[next][0]) next++;
      sim.step();
    }
    expect(sim.ringsPassed).toBe(3);
    expect(next).toBe(route.length);
    expect(worst).toBeLessThan(24);
    expect(minHeight).toBeGreaterThan(2);
    expect(maxHeight).toBeLessThan(45);
  } finally {await sim.dispose();}
});
