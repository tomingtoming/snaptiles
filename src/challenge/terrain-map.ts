import type { Scenario } from './scenarios';

const NS = 'http://www.w3.org/2000/svg';

export class TerrainMap {
  private panel = document.querySelector<HTMLDetailsElement>('#terrain-map')!;
  private svg = this.panel.querySelector('svg')!;
  private caption = this.panel.querySelector('small')!;
  private dot = document.createElementNS(NS, 'circle');
  private course: Scenario | null = null;
  private checkpoint: SVGRectElement | null = null;
  private goal: SVGRectElement | null = null;
  private lastTarget: SVGRectElement | null = null;

  update(s: Scenario | null, position: { x: number; z: number } | undefined, passed: boolean): void {
    const bounds = s?.terrainBounds;
    this.panel.hidden = !bounds || !position;
    if (this.panel.hidden || !this.panel.open || !s || !position || !bounds) return;
    if (this.course !== s) {
      this.draw(s, bounds);
      this.course = s;
    }
    const [left, right, north, south] = bounds;
    const x = Math.max(left, Math.min(right, position.x));
    const z = Math.max(north, Math.min(south, position.z));
    this.dot.setAttribute('cx', String(x));
    this.dot.setAttribute('cy', String(z));
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
      const [x0, x1, , , z0, z1] = next;
      const dx = Math.max(x0 - position.x, 0, position.x - x1);
      const dz = Math.max(z0 - position.z, 0, position.z - z1);
      const distance = Math.round(Math.hypot(dx, dz));
      text += '　' + (headingForCheckpoint ? '黄：中間' : '緑：ゴール') + 'まで' + distance + 'm';
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
    if (s.runway) {
      const { width, north, south } = s.runway;
      zone([-width / 2, width / 2, 0, 0, north, south], '#e9e1c1');
    }
    this.lastTarget = null;
    this.checkpoint = s.checkpoint ? zone(s.checkpoint, '#ffc747') : null;
    this.goal = s.goal ? zone(s.goal, '#70f8a0') : null;
    this.dot.setAttribute('r', String(pad * 0.62));
    this.dot.setAttribute('fill', 'white');
    this.dot.setAttribute('stroke', '#1b262a');
    this.dot.setAttribute('vector-effect', 'non-scaling-stroke');
    this.svg.replaceChildren(fragment, this.dot);
  }
}
