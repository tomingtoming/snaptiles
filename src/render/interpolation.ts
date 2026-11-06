import { Vector3, Quaternion } from 'three';
import type { PhysicsView, Pose } from '../sim/sim-view';

export interface RenderPose extends Pose { spinAngle: number }
export interface ModelFrame {
  poses: Map<number, RenderPose>;
  center: Vector3;
  core?: RenderPose;
}

/** Presentation only: keep the 30 Hz simulation and recordings untouched. */
export function modelFrame(world: PhysicsView, previous?: ModelFrame, alpha = 1): ModelFrame {
  const poses = new Map<number, RenderPose>();
  const center = new Vector3();
  let mass = 0;
  const blend = Math.max(0, Math.min(1, alpha));
  const coreNow = world.tiles[0] && world.pose(world.tiles[0]);
  // A large warp is a discontinuity, not a flight to animate through.
  if (coreNow && previous?.core && coreNow.position.distanceToSquared(previous.core.position) > 10000) previous = undefined;
  for (const tile of world.tiles) {
    const current = world.pose(tile);
    const old = previous?.poses.get(tile.tile.id);
    const pose = {
      position: new Vector3().copy(current.position),
      quaternion: new Quaternion().copy(current.quaternion),
      spinAngle: tile.spinAngle,
    };
    if (old) {
      pose.position.lerpVectors(old.position, current.position, blend);
      pose.quaternion.slerpQuaternions(old.quaternion, current.quaternion, blend);
      pose.spinAngle = old.spinAngle + (tile.spinAngle - old.spinAngle) * blend;
    }
    poses.set(tile.tile.id, pose);
    const weight = tile.tile.mass || 1;
    center.addScaledVector(pose.position, weight); mass += weight;
  }
  if (mass) center.divideScalar(mass);
  return { poses, center, core: world.tiles[0] && poses.get(world.tiles[0].tile.id) };
}
