import type { Scenario, Solid } from './scenarios';

import { ringColor } from './rings';

const NS = 'http://www.w3.org/2000/svg';

/** Intersect the existing terrain triangles with horizontal planes.
 * Group segments by elevation so each contour needs just one SVG path. */
export function contourPaths(faces: Solid, interval: number): Map<number, string> {
  const paths = new Map<number, string>();
  if (!(interval > 0)) return paths;
  for (let i = 0; i < faces.length; i += 3) {
    const triangle = faces.slice(i, i + 3);
    const heights = triangle.map(p => p[1]);
    const low = Math.min(...heights), high = Math.max(...heights);
    for (let level = (Math.floor(low / interval) + 1) * interval; level <= high; level += interval) {
      const points: string[] = [];
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        if ((a[1] < level) === (b[1] < level)) continue;
        const t = (level - a[1]) / (b[1] - a[1]);
        const x = a[0] + t * (b[0] - a[0]), z = a[2] + t * (b[2] - a[2]);
        points.push(x.toFixed(2) + ' ' + z.toFixed(2));
      }
      if (points.length === 2 && points[0] !== points[1]) {
        paths.set(level, (paths.get(level) ?? '') + 'M' + points[0] + 'L' + points[1]);
      }
    }
  }
  return paths;
}

/** Round outward: a pilot just outside a gate still has a correction to make. */
export function gateAltitudeGuide(y: number, min: number, max: number): string {
  if (y < min) return 'あと' + Math.ceil(min - y) + 'm上昇';
  if (y > max) return 'あと' + Math.ceil(y - max) + 'm下降';
  return '高度は範囲内';
}

export class TerrainMap {
  private panel = document.querySelector<HTMLDetailsElement>('#terrain-map')!;
  private svg = this.panel.querySelector('svg')!;
  private caption = this.panel.querySelector('small')!;
  private legend = this.panel.querySelector<HTMLElement>('.contour-key')!;
  private direction = document.createElementNS(NS, 'polygon');
  private dot = document.createElementNS(NS, 'circle');
  private course: Scenario | null = null;
  private checkpoint: SVGRectElement | null = null;
  private goal: SVGRectElement | null = null;
  private ringMarkers: SVGCircleElement[] = [];
  private visibleRingCount = -1;
  private lastTarget: SVGRectElement | null = null;

  update(s: Scenario | null, core: { position: { x: number; y: number; z: number }; vel: { x: number; z: number } } | undefined, passed: boolean, ringsPassed: number): void {
    const bounds = s?.terrainBounds;
    const position = core?.position;
    this.panel.hidden = !bounds || !position;
    if (this.panel.hidden || !this.panel.open || !s || !core || !position || !bounds) return;
    if (this.course !== s) {
      this.draw(s, bounds);
      this.course = s;
    }
    const [left, right, north, south] = bounds;
    const x = Math.max(left, Math.min(right, position.x));
    const z = Math.max(north, Math.min(south, position.z));
    this.dot.setAttribute('cx', String(x));
    this.dot.setAttribute('cy', String(z));
    // Indicate travel over the ground, including reverse and sideslip.
    // At the map edge the clamped dot already represents an outside position.
    const moving = x === position.x && z === position.z && Math.hypot(core.vel.x, core.vel.z) >= 0.5;
    this.direction.style.display = moving ? '' : 'none';
    if (moving) {
      const angle = Math.atan2(core.vel.x, -core.vel.z) * 180 / Math.PI;
      this.direction.setAttribute('transform', `translate(${x} ${z}) rotate(${angle})`);
    }
    const where = x === position.x && z === position.z ? '白点：現在地' : '白点：範囲外の方向';
    const headingForCheckpoint = !!s.checkpoint && !passed;
    const next = headingForCheckpoint ? s.checkpoint : s.goal;
    const target = headingForCheckpoint ? this.checkpoint : this.goal;
    if (target !== this.lastTarget) {
      this.lastTarget?.removeAttribute('stroke');
      target?.setAttribute('stroke', 'white');
      this.lastTarget = target;
    }
    let text = where;
    if (next) {
      const [x0, x1, y0, y1, z0, z1] = next;
      const dx = Math.max(x0 - position.x, 0, position.x - x1);
      const dz = Math.max(z0 - position.z, 0, position.z - z1);
      const distance = Math.round(Math.hypot(dx, dz));
      text += '　' + (headingForCheckpoint ? '黄：中間' : '緑：ゴール');
      if (s.showGateAltitude) {
        text += '　水平 ' + distance + 'm・' + gateAltitudeGuide(position.y, y0, y1);
      } else {
        text += 'まで' + distance + 'm';
      }
    }
    if (s.rings) {
      if (this.visibleRingCount !== ringsPassed) {
        this.visibleRingCount = ringsPassed;
        this.ringMarkers.forEach((marker, index) => marker.setAttribute('stroke', ringColor(index, ringsPassed)));
      }
      const ring = s.rings[ringsPassed];
      if (ring) {
        const [rx, ry, rz] = ring.center;
        text += `　リング${ringsPassed + 1}まで水平 ${Math.round(Math.hypot(rx - position.x, rz - position.z))}m・中心高度${ry}m`;
      } else {
        text += '　全リング通過';
      }
    }
    if (!next && !s.rings && s.runway) {
      const { width, north, south } = s.runway;
      const dx = Math.max(-width / 2, Math.min(width / 2, position.x)) - position.x;
      const dz = Math.max(north, Math.min(south, position.z)) - position.z;
      const metres = Math.round(Math.hypot(dx, dz));
      if (metres === 0) {
        text += '　滑走路の範囲内';
      } else {
        const octant = (Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8;
        const direction = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][octant];
        text += '　滑走路は' + direction + ' ' + metres + 'm';
      }
    }
    if (this.caption.textContent !== text) this.caption.textContent = text;
  }

  private draw(s: Scenario, [left, right, north, south]: NonNullable<Scenario['terrainBounds']>): void {
    const width = right - left, height = south - north;
    const pad = Math.max(width, height) * 0.04;
    this.svg.setAttribute('viewBox', [left - pad, north - pad, width + pad * 2, height + pad * 2].join(' '));
    const fragment = document.createDocumentFragment();
    const faces = s.terrainFaces ?? [];
    const [low, high] = s.terrainColorRange ?? [2, 14];
    for (let i = 0; i < faces.length; i += 3) {
      const triangle = faces.slice(i, i + 3);
      const h = triangle.reduce((sum, p) => sum + p[1], 0) / 3;
      const level = Math.max(0, Math.min(1, (h - low) / (high - low)));
      const face = document.createElementNS(NS, 'polygon');
      face.setAttribute('points', triangle.map(([x, , z]) => x + ',' + z).join(' '));
      face.setAttribute('fill', `hsl(${99 - 66 * level} 28% ${34 + 14 * level}%)`);
      fragment.append(face);
    }
    this.legend.hidden = !s.contourInterval;
    if (s.contourInterval) {
      this.legend.textContent = `等高線 ${s.contourInterval}m間隔`;
      for (const [level, segments] of contourPaths(faces, s.contourInterval)) {
        if (level <= 0) continue;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', segments);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#e3e4ae');
        path.setAttribute('stroke-width', '0.8');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        fragment.append(path);
      }
    }
    const zone = ([x0, x1, , , z0, z1]: NonNullable<Scenario['goal']>, fill: string) => {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(x0)); rect.setAttribute('y', String(z0));
      rect.setAttribute('width', String(x1 - x0)); rect.setAttribute('height', String(z1 - z0));
      rect.setAttribute('fill', fill);
      rect.setAttribute('vector-effect', 'non-scaling-stroke');
      rect.setAttribute('stroke-width', '2');
      fragment.append(rect);
      return rect;
    };
    for (const surface of s.surfaces ?? []) zone(surface.bounds, '#' + surface.color.toString(16).padStart(6, '0'));
    if (s.centerStripe) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('x2', '0');
      line.setAttribute('y1', String(north)); line.setAttribute('y2', String(south));
      line.setAttribute('stroke', '#fff3ce');
      line.setAttribute('stroke-dasharray', '3 3');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      fragment.append(line);
    }
    if (s.runway) {
      const { width, north, south } = s.runway;
      zone([-width / 2, width / 2, 0, 0, north, south], '#e9e1c1');
    }
    this.visibleRingCount = -1;
    this.ringMarkers = (s.rings ?? []).map((ring, index) => {
      const marker = document.createElementNS(NS, 'circle');
      marker.setAttribute('cx', String(ring.center[0]));
      marker.setAttribute('cy', String(ring.center[2]));
      marker.setAttribute('r', String(Math.max(ring.radius, pad * 0.65)));
      marker.setAttribute('fill', 'none');
      marker.setAttribute('stroke-width', '2');
      marker.setAttribute('vector-effect', 'non-scaling-stroke');
      marker.setAttribute('aria-label', 'リング' + (index + 1));
      fragment.append(marker);
      return marker;
    });
    this.lastTarget = null;
    this.checkpoint = s.checkpoint ? zone(s.checkpoint, '#ffc747') : null;
    this.goal = s.goal ? zone(s.goal, '#70f8a0') : null;
    this.direction.setAttribute('points', `0,${-2.2 * pad} ${0.6 * pad},0 ${-0.6 * pad},0`);
    this.direction.setAttribute('fill', 'white');
    this.direction.setAttribute('stroke', '#1b262a');
    this.direction.setAttribute('vector-effect', 'non-scaling-stroke');
    this.direction.setAttribute('class', 'map-direction');
    this.dot.setAttribute('r', String(pad * 0.62));
    this.dot.setAttribute('fill', 'white');
    this.dot.setAttribute('stroke', '#1b262a');
    this.dot.setAttribute('vector-effect', 'non-scaling-stroke');
    this.svg.replaceChildren(fragment, this.direction, this.dot);
  }
}
