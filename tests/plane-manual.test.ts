import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { KeyState } from '../src/input/keys';
import { RustSimulation } from '../src/sim/rust-simulation';
import { PLANE } from '../src/samples/plane';

it('toggles assist once per C press and flies a manual loop', async () => {
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(PLANE, keys, { bare: true });
  const step = (n: number) => { for (let i=0;i<n;i++) sim.step(); };
  try {
    await sim.start();
    expect(sim.env('ASSIST')).toBe(1);
    keys.press(4); keys.press(1); step(900);
    keys.release(4); keys.release(1); step(30);
    expect(sim.corePosition().y).toBeGreaterThan(100);
    keys.press(6); step(15);
    expect(sim.env('ASSIST')).toBe(0);
    keys.release(6); step(1);
    expect(sim.env('ELEV')).toBe(0);
    const angle = () => { const f = new Vector3(0,0,-1).applyQuaternion(sim.physics.tiles[0].quaternion); return Math.atan2(f.y,-f.z); };
    let previous=angle(), turn=0, minHeight=sim.corePosition().y;
    keys.press(1);
    for(let i=0;i<900 && turn<Math.PI*2;i++) {
      sim.step();
      const a=angle(); turn+=Math.atan2(Math.sin(a-previous),Math.cos(a-previous)); previous=a;
      minHeight=Math.min(minHeight,sim.corePosition().y);
    }
    console.log({ turn, minHeight, height:sim.corePosition().y });
    expect(turn).toBeGreaterThanOrEqual(Math.PI*2);
    expect(minHeight).toBeGreaterThan(3);
    expect(sim.physics.tiles.every(t => t.tile.parent == null || sim.api()._PARENT(t.tile.chipIndex)>=0)).toBe(true);
    keys.release(1); step(1);
    expect(sim.env('ELEV')).toBe(0);
    keys.press(6); step(15);
    expect(sim.env('ASSIST')).toBe(1);
    sim.reset(); expect(sim.env('ASSIST')).toBe(1);
  } finally { await sim.dispose(); }
}, 30000);

it('settles into assisted cruise at full throttle and returns full jet power on C', async () => {
  const keys = new KeyState(new EventTarget());
  const sim = new RustSimulation(PLANE, keys, { bare: true });
  try {
    await sim.start();
    keys.press(4);
    for (let frame = 0; frame < 900; frame++) sim.step();
    keys.release(4);
    const kmh = sim.coreVelocity().length() * 3.6;
    expect(kmh).toBeGreaterThan(250);
    expect(kmh).toBeLessThan(310);
    expect(sim.env('THROTTLE')).toBe(60000);
    expect(sim.env('JET_SCALE')).toBeLessThan(0.5);
    keys.press(6);
    sim.step();
    expect(sim.env('JET_SCALE')).toBe(1);
  } finally {
    await sim.dispose();
  }
});
