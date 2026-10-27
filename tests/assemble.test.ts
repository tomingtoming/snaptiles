import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assemble, TILE } from '../src/model/assemble';
import { parseRc } from '../src/rc/parser';

const env = (vals: Record<string, number>) => (n: string) => vals[n];

function build(body: string, vals: Record<string, number> = {}) {
  const m = parseRc(`Val{} Key{} Body{ ${body} }`);
  const a = assemble(m, env(vals));
  if (!a) throw new Error('no body');
  return a;
}

const near = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
};

describe('assemble', () => {
  it('places children edge to edge in the four directions', () => {
    const a = build('Core(){ N:Chip(){} S:Chip(){} E:Chip(){} W:Chip(){} }');
    expect(a.tiles).toHaveLength(5);
    near(a.tiles[1].position, 0, 0, -TILE);
    near(a.tiles[2].position, 0, 0, TILE);
    near(a.tiles[3].position, TILE, 0, 0);
    near(a.tiles[4].position, -TILE, 0, 0);
  });

  it('folds a chip about the shared edge', () => {
    const a = build('Core(){ W:Chip(angle=90){} }');
    const c = a.tiles[1];
    // positive angle folds down (measured against the corpus): hangs below the west edge
    near(c.position, -TILE / 2, -TILE / 2, 0);
    near(c.anchor, -TILE / 2, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    near(normal, -1, 0, 0);
  });

  it('a wheel below a folded chip spins about the lateral axis', () => {
    const a = build('Core(){ W:Chip(angle=90){ W:Wheel(){} } }');
    const w = a.tiles[2];
    near(w.position, -TILE / 2, -TILE * 1.5, 0);
    near(w.axis, -1, 0, 0);
    expect(w.spec.wheel).toBe(true);
    // rim + rotor occupy two chip numbers; the name points at the rotor
    expect(a.chipCount).toBe(4);
    expect(a.byChip.get(2)).toBe(w);
    expect(a.byChip.get(3)).toBe(w);
  });

  it('rudder yaws about the parent normal at the shared edge', () => {
    const a = build('Core(){ N:Rudder(angle=STEER){} }', { STEER: 90 });
    const r = a.tiles[1];
    near(r.axis, 0, 1, 0);
    near(r.anchor, 0, 0, -TILE / 2);
    // Rudder sign is -1 (measured): angle=90 rotates -90° about +Y, the tile extends toward +X
    near(r.position, TILE / 2, 0, -TILE / 2);
  });

  it('trim rolls about the connection axis', () => {
    const a = build('Core(){ E:Trim(angle=90){} }');
    const t = a.tiles[1];
    near(t.position, TILE, 0, 0);
    near(t.axis, 1, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(t.quaternion);
    near(normal, 0, 0, 1);
  });

  it('evaluates attribute expressions against Val', () => {
    const a = build('Core(){ N:Chip(angle=-A*2){} }', { A: 15 });
    const c = a.tiles[1];
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    // 30° fold either way: the normal tilts by 30°
    expect(Math.abs(normal.y - Math.cos(Math.PI / 6))).toBeLessThan(1e-6);
  });

  it('names resolve to chip numbers', () => {
    const a = build('Core(){ N:Chip(name=NOSE){} }');
    expect(a.tiles[1].name).toBe('NOSE');
    expect(a.tiles[1].chipIndex).toBe(1);
  });
});
