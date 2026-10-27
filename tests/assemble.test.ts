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

// Conventions measured on community models (tools/foldsign.ts, 2026-10-27): these synthetic
// bodies reproduce the mounting idioms and must keep wheels at the bottom / masts at the top.
describe('measured conventions', () => {
  const lowestHighest = (body: string, vals: Record<string, number> = {}) => {
    const a = build(body, vals);
    const ys = a.tiles.map((t) => t.position.y);
    return { a, lo: Math.min(...ys), hi: Math.max(...ys) };
  };

  it('segway idiom: side wheels Frame(-30){Wheel(angle=120)} sit lowest, the mast folds up', () => {
    const { a, lo, hi } = lowestHighest('Core(){ W:Frame(angle=-30){ W:Wheel(angle=120){} } E:Frame(angle=-30){ E:Wheel(angle=120){} } N:Frame(angle=-70){ N:Frame(angle=-20){ N:Frame(){} } } S:Weight(angle=-90){} }');
    const wheels = a.tiles.filter((t) => t.spec.wheel);
    for (const w of wheels) expect(w.position.y - lo).toBeLessThan(0.6 * TILE);
    const mastTip = a.tiles[a.tiles.length - 2]; // last N frame
    expect(mastTip.position.y).toBeGreaterThan(1.5 * TILE);
    expect(hi).toBeGreaterThan(1.5 * TILE);
  });

  it('car1 idiom: Trim(90) then Frame(90) Frame(50) Frame(-140) hangs the wheel below the core', () => {
    const { a, lo } = lowestHighest('Core(){ N:Chip(){ N:Trim(angle=90){ E:Frame(angle=90){ E:Frame(angle=50){ E:Frame(angle=-140){ N:Wheel(){} } } } } } }');
    const w = a.tiles.find((t) => t.spec.wheel)!;
    expect(w.position.y).toBeLessThan(-0.2 * TILE);
    expect(w.position.y - lo).toBeLessThan(0.6 * TILE);
  });

  it('bike idiom: TrimF(angle=-90){ S:Wheel } stands the rear wheel up (normal sideways)', () => {
    const a = build('Core(){ N:Frame(angle=-15){ S:TrimF(angle=-90){ S:Wheel(){} } } }');
    const w = a.tiles.find((t) => t.spec.wheel)!;
    expect(Math.abs(w.axis.x)).toBeGreaterThan(0.95); // spin axis lateral
  });

  it('rudder sign: Rudder(angle=90) on N swings the tile toward +X', () => {
    const a = build('Core(){ N:Rudder(angle=90){} }');
    expect(a.tiles[1].position.x).toBeGreaterThan(0.4 * TILE);
  });
});
