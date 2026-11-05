import type { Scenario, Solid } from './scenarios';

type Point = Solid[number];
interface Section { x: number; z: number; nx: number; nz: number; slope: number }

export function bankedOval(): Scenario {
  const sections: Section[] = [];
  const bank = Math.tan(10 * Math.PI / 180);
  for (const direction of [1, -1]) {
    for (const z of [36, 20, 0, -20]) {
      sections.push({ x: direction === 1 ? 0 : 48, z: direction * z, nx: -direction, nz: 0,
        slope: Math.abs(z) === 36 ? bank : 0 });
    }
    for (let i = 0; i < 20; i++) {
      const angle = i * Math.PI / 20;
      const nx = -direction * Math.cos(angle), nz = -direction * Math.sin(angle);
      sections.push({ x: 24 + 24 * nx, z: -36 * direction + 24 * nz, nx, nz, slope: bank });
    }
  }
  const point = (s: Section, offset: number): Point => [
    s.x + offset * s.nx, Math.abs(offset) > 6 ? -0.3 : (offset + 6) * s.slope, s.z + offset * s.nz,
  ];
  const ground: Solid[] = [];
  const terrainFaces: Solid = [];
  const triangle = (a: Point, b: Point, c: Point) => {
    terrainFaces.push(a, b, c);
    ground.push([a, b, c, [a[0], -2, a[2]], [b[0], -2, b[2]], [c[0], -2, c[2]]]);
  };
  triangle([-22,-0.3,78], [70,-0.3,78], [-22,-0.3,-78]);
  triangle([70,-0.3,78], [70,-0.3,-78], [-22,-0.3,-78]);
  for (const [outer, inner] of [[9, 6], [-6, -9], [6, -6]]) {
    sections.forEach((s, i) => {
      const next = sections[(i + 1) % sections.length];
      const a = point(s, outer), b = point(s, inner), c = point(next, outer), d = point(next, inner);
      triangle(a, b, c);
      triangle(b, d, c);
    });
  }
  const roadPaint: Solid = [];
  for (const edge of [-5.7, 5.7]) {
    sections.forEach((s, i) => {
      const next = sections[(i + 1) % sections.length];
      const a = point(s, edge + 0.1), b = point(s, edge - 0.1);
      const c = point(next, edge + 0.1), d = point(next, edge - 0.1);
      roadPaint.push(a, b, c, b, d, c);
    });
  }
  roadPaint.push([-5.7, 0, 0.2], [5.7, 0, 0.2], [-5.7, 0, -0.2],
    [5.7, 0, 0.2], [5.7, 0, -0.2], [-5.7, 0, -0.2]);
  return {
    id: 'banked-oval', title: 'バンク付き周回路', freeDrive: true,
    description: '右回りの約295m。幅12mの直線から、外側が10°高いカーブへ入ります。',
    terrainBounds: [-22, 70, -78, 78], ground, terrainFaces, roadPaint,
    asphaltStart: terrainFaces.length - sections.length * 6,
    budget: Infinity, timeLimit: Infinity, solids: [],
  };
}
