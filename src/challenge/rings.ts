export interface FlightRing {
  center: [number, number, number];
  radius: number; // clear opening, in metres
  heading: number; // degrees clockwise from north
}

/** Shared colours for the 3D hoops and the map symbols. */
export function ringColor(index: number, passed: number): string {
  if (index === passed) return '#ffc747';
  return index < passed ? '#788787' : '#8ed4b0';
}

interface Point { x: number; y: number; z: number }

/** Cross ring planes in order along this frame's motion. Testing the intersection
 * rather than the endpoint catches a fast model passing between two physics samples. */
export function advanceRings(rings: FlightRing[], passed: number, from: Point, to: Point): number {
  let lastCrossing = -1;
  while (passed < rings.length) {
    const { center: [cx, cy, cz], heading, radius } = rings[passed];
    const angle = heading * Math.PI / 180;
    const nx = Math.sin(angle), nz = -Math.cos(angle);
    const start = nx * (from.x - cx) + nz * (from.z - cz);
    const end = nx * (to.x - cx) + nz * (to.z - cz);
    if (start >= 0 || end < 0) break;
    const t = -start / (end - start);
    if (t <= lastCrossing) break;
    const x = from.x + t * (to.x - from.x) - cx;
    const y = from.y + t * (to.y - from.y) - cy;
    const z = from.z + t * (to.z - from.z) - cz;
    if (x * x + y * y + z * z > radius * radius) break;
    passed++;
    lastCrossing = t;
  }
  return passed;
}
