import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { balancePose } from '../src/physics/pose-balance';

describe('commanded mass-pose alignment', () => {
  for (const angle of [0.7,Math.PI]) it(`recovers rigid motion at ${angle} radians`, () => {
    const before = [[-1,0,0],[2,0,0],[0,1,0],[0,0,3]].map((p,i) => ({position:new Vector3(...p),mass:i+1}));
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),angle);
    const after = before.map(p => ({mass:p.mass,position:p.position.clone().applyQuaternion(rotation).add(new Vector3(7,-2,9))}));
    const fit = balancePose(before,after);
    after.forEach((p,i) => expect(p.position.clone().sub(fit.from).applyQuaternion(fit.rotation).add(fit.to).distanceTo(before[i].position)).toBeLessThan(1e-8));
  });
});
