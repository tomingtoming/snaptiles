import { expect, it } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { modelFrame } from '../src/render/interpolation';
import type { PhysicsView, TileBodyView } from '../src/sim/sim-view';

function fixture() {
  const pose = { position: new Vector3(), quaternion: new Quaternion() };
  const tile = { tile: { id: 0, mass: 1 }, spinAngle: 0 } as TileBodyView;
  const world: PhysicsView = { tiles: [tile], pose: () => pose, velocity: () => new Vector3(), balls: [], crates: [], projectiles: [], wind: new Vector3(), addBall: () => 0 };
  return { pose, tile, world };
}
it('draws constant-speed motion evenly at 60 and 144 Hz across 30 Hz steps', () => {
  for(const kmh of [10, 30, 60, 180]) for(const hz of [60,144]) {
    const { pose, world } = fixture(); const speed=kmh/3.6;
    let previous=modelFrame(world), priorX: number | undefined;
    let previousTick=0;
    for(let f=1;f<hz*2;f++) {
      const time=f/hz, tick=Math.floor(time*30+1e-9), alpha=Math.max(0,time*30-tick);
      if(tick!==previousTick) { pose.position.x=speed*(tick-1)/30; previous=modelFrame(world); previousTick=tick; }
      pose.position.x=speed*tick/30;
      const visible=modelFrame(world,previous,alpha);
      if(time>=2/30 && priorX!==undefined) expect(visible.core!.position.x-priorX).toBeCloseTo(speed/hz,9);
      priorX=visible.core!.position.x;
      expect(pose.position.x).toBe(speed*tick/30);
    }
  }
});
it('interpolates rotation and wheel spin without mutating snapshots; resets and warps snap', () => {
  const {pose,tile,world}=fixture(), previous=modelFrame(world);
  pose.position.x=2; pose.quaternion.setFromAxisAngle(new Vector3(0,1,0),Math.PI/2); tile.spinAngle=8;
  const halfway=modelFrame(world,previous,0.5);
  expect(halfway.center.x).toBe(1); expect(halfway.core!.spinAngle).toBe(4);
  expect(halfway.core!.quaternion.angleTo(new Quaternion())).toBeCloseTo(Math.PI/4);
  expect(previous.core!.position.x).toBe(0); expect(previous.core!.spinAngle).toBe(0);
  expect(modelFrame(world,undefined,0).core!.position.x).toBe(2);
  expect(modelFrame(world,previous,1).core!.position.x).toBe(2);
  pose.position.x=1000; expect(modelFrame(world,previous,0.5).core!.position.x).toBe(1000);
});
