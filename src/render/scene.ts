import * as THREE from 'three';
import { TILE, TILE_T, type TileInstance, type ValEnv } from '../model/assemble';
import { evalExpr, exprIsConstant } from '../rc/expr';
import { wheelRadius, type PhysicsWorld } from '../physics/world';
import { COURSE, CRATES } from '../model/course';
const SPIN_AXIS = new THREE.Vector3(0, 1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** the original's built-in views: F8–F12 select A–E, Ctrl+F8–F12 select F–J */
export type ViewId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

const PALETTE: Record<string, number> = {
  core: 0xffb000,
  chip: 0xe8e8e8,
  frame: 0x9aa4ad,
  rudder: 0x7fb7ff,
  rudderf: 0x9fc9ff,
  trim: 0xb7ff7f,
  trimf: 0xcaffa0,
  wheel: 0x303030,
  jet: 0xff6a3d,
  weight: 0x6b4f3a,
  cowl: 0xffffff,
  arm: 0xd04040,
};

interface TileView {
  tile: TileInstance;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  dynamicColor: boolean;
  dynamicAlpha: boolean;
}

/**
 * Cowl shapes (option), read off the original (screenshots of each option standing on a core,
 * 2026-10-28): 0 plate, 1 an outline (edges only, open inside), 2 a disc inscribed in the tile,
 * 3/4 the two right triangles of a tile cut on its diagonal (apex NE for 3, NW for 4, with
 * "north" meaning away from the parent, as the corpus attaches children on their east/west
 * edges), 5 a tombstone: the attached edge full width, the far half rounded, 6/7 plates.
 */
function cowlGeometry(option: number, dir: TileInstance['dir'], cache: Map<string, THREE.BufferGeometry>): THREE.BufferGeometry {
  const shape = option >= 1 && option <= 5 ? option : 0;
  const key = `${shape}${shape ? dir ?? 'N' : ''}`;
  let g = cache.get(key);
  if (g) return g;
  const h = TILE / 2;
  const t = TILE_T * 0.25;
  // a flat polygon (counter-clockwise seen from +Y) extruded to thickness 2t; built for a north-attached
  // cowl: parent on +Z, the attached edge is +Z, far edge -Z
  const prism = (poly: [number, number][]): THREE.BufferGeometry => {
    const pos: number[] = [];
    const push = (...v: number[][]) => v.forEach((q) => pos.push(...q));
    const n = poly.length;
    const top = poly.map(([x, z]) => [x, t, z]);
    const bot = poly.map(([x, z]) => [x, -t, z]);
    for (let i = 1; i < n - 1; i++) {
      push(top[0], top[i + 1], top[i]);
      push(bot[0], bot[i], bot[i + 1]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      push(top[i], top[j], bot[i]);
      push(top[j], bot[j], bot[i]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  };
  if (shape === 0) {
    g = new THREE.BoxGeometry(TILE, TILE_T * 0.5, TILE);
  } else if (shape === 1) {
    // outline: four thin bars along the edges
    const w = 0.04;
    const bar = (x: number, z: number, sx: number, sz: number) => new THREE.BoxGeometry(sx, TILE_T * 0.5, sz).translate(x, 0, z);
    const parts = [bar(0, h - w / 2, TILE, w), bar(0, -h + w / 2, TILE, w), bar(h - w / 2, 0, w, TILE), bar(-h + w / 2, 0, w, TILE)];
    g = mergeGeometries(parts);
  } else if (shape === 2) {
    const poly: [number, number][] = [];
    for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; poly.push([h * Math.cos(a), -h * Math.sin(a)]); }
    g = prism(poly);
  } else if (shape === 5) {
    // tombstone: attached half square, far half a semicircle
    const poly: [number, number][] = [[-h, h], [h, h]];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; poly.push([h * Math.cos(a), -h * Math.sin(a)]); }
    g = prism(poly);
  } else {
    const ax = shape === 3 ? h : -h; // apex corner on the far edge: NE for 3, NW for 4
    g = prism([[-h, h], [h, h], [ax, -h]]);
  }
  if (shape) {
    // turn so the attached edge faces the parent: S parent is at -Z, E parent at -X, W parent at +X
    const turn = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 }[dir ?? 'N'];
    if (turn) g.rotateY(turn);
    g.computeVertexNormals();
  }
  cache.set(key, g);
  return g;
}

/** concatenate non-indexed box geometries (position only) */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const p of parts) {
    const q = p.toNonIndexed();
    pos.push(...(q.getAttribute('position').array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private selectedId: number | null = null;
  private directionOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private directionMarks = ['N', 'W', 'E', 'S'].map((dir) => {
    const group = document.createElementNS(this.directionOverlay.namespaceURI, 'g');
    group.setAttribute('data-direction', dir);
    group.innerHTML = `<line stroke="#785f00" stroke-width="2"/><circle r="12" fill="#242a30" stroke="#ffd900"/><text text-anchor="middle" dominant-baseline="central" fill="#ffe76b" font-size="12" font-family="sans-serif">${dir}</text><circle class="anchor" r="3" fill="#ffe76b" stroke="#242a30"/><circle class="hit" r="20" fill="transparent" style="pointer-events:all;cursor:pointer"/>`;
    // Only the enlarged hit circle takes pointers; the rest of the overlay stays transparent to orbit and pick.
    const hit = group.querySelector('.hit')!;
    hit.addEventListener('pointerdown', e => e.stopPropagation());
    hit.addEventListener('click', e => { e.stopPropagation(); this.onDirectionPick?.(dir as 'N' | 'W' | 'E' | 'S'); });
    this.directionOverlay.append(group);
    return group;
  });
  /** Set by the editor: clicking an N/W/E/S mark adds there, like the panel's edge buttons. */
  onDirectionPick?: (dir: 'N' | 'W' | 'E' | 'S') => void;
  private selectionBox: THREE.BoxHelper | null = null;
  private views = new Map<number, TileView>();
  private plateGeo = new THREE.BoxGeometry(TILE, TILE_T, TILE);
  // a tyre is drawn as a short cylinder (0.12 m wide) with a pale spoke; the physics sphere has the same radius
  private wheelGeo = new THREE.CylinderGeometry(TILE / 2, TILE / 2, TILE * 0.2, 24);
  private spokeGeo = new THREE.BoxGeometry(TILE * 0.8, TILE * 0.22, TILE * 0.12);
  private spokeMat = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.6 });
  private cowlGeos = new Map<string, THREE.BufferGeometry>();
  private group = new THREE.Group();
  private lines: THREE.LineSegments;
  private linesGeo = new THREE.BufferGeometry();
  camYaw = 0.6;
  camPitch = 0.35;
  camDist = 12;
  private zoomLimit = 60;
  /** wheel / pinch: the editor's orbit distance, or the leash length of views A and F (a SnapTiles extra) */
  zoomBy(factor: number, editing = false): void {
    if (editing || this.viewMode === 'orbit') this.camDist = Math.max(editing ? 0.5 : 3, Math.min(this.zoomLimit, this.camDist * factor));
    else if (this.viewMode === 'A' || this.viewMode === 'F') this.leashDist = Math.max(2, Math.min(200, this.leashDist * factor));
  }
  /** runtime views A–J as measured on the original (docs/measured.md, camera); 'orbit' is the editor's camera */
  viewMode: ViewId | 'orbit' = 'A';
  private baseFov = 50;
  /** the original's I/O zoom, one value for every runtime view: 45° default, ×0.8 / ×1.25, 9.44–87.89° */
  viewFov = 45;
  /** the model's _ZOOM (the original's CCD camera); view H uses it */
  onboardFov = 17.19;
  setView(mode: ViewId | 'orbit'): void {
    this.viewMode = mode;
    this.camera.up.set(0, 1, 0);
    // B/G start where the camera is; H freezes the current eye and direction
    if (mode === 'B' || mode === 'G') { this.spectatorEye.copy(this.camera.position); this.spectatorTime = 0; }
    if (mode === 'H') { this.fixedEye.copy(this.camera.position); this.camera.getWorldDirection(this.fixedDir); }
    if (mode === 'J') this.orbitAngle = Math.atan2(this.camera.position.x - this.camTarget.x, this.camera.position.z - this.camTarget.z);
    this.applyFov();
  }
  /** I (−1) / O (+1): steps that would leave 9.44–87.89° are refused, as on the original */
  zoomStep(dir: -1 | 1): void {
    const next = this.viewFov * (dir < 0 ? 0.8 : 1.25);
    if (next >= 9.4 && next <= 88) this.viewFov = next;
    this.applyFov();
  }
  private applyFov(): void {
    const fov = this.viewMode === 'orbit' ? this.baseFov : this.viewMode === 'H' ? this.onboardFov : this.viewFov;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  /** mouse drag: the editor orbit, or (SnapTiles extra) swing the leash of views A and F */
  orbitBy(dx: number, dy: number): void {
    if (this.viewMode === 'A' || this.viewMode === 'F') {
      this.leashEye.sub(this.camTarget).applyAxisAngle(UP_AXIS, -dx * 0.006).add(this.camTarget);
      this.leashPitch = Math.max(0.05, Math.min(1.4, this.leashPitch + dy * 0.006));
    } else {
      this.camYaw -= dx * 0.006;
      this.camPitch = Math.max(0.05, Math.min(1.4, this.camPitch + dy * 0.006));
    }
  }
  // view A/F leash: 8.0 m from the model centre, 2.0 m above it (a 14.5° pitch)
  private leashEye = new THREE.Vector3();
  private leashDist = 8.0;
  private leashPitch = Math.asin(2.0 / 8.0);
  private spectatorEye = new THREE.Vector3();
  private spectatorTime = 0;
  private fixedEye = new THREE.Vector3();
  private fixedDir = new THREE.Vector3(0, 0, -1);
  private orbitAngle = 0;
  private camTarget = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private tmpPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  constructor(public canvas: HTMLCanvasElement) {
    this.directionOverlay.setAttribute('aria-hidden', 'true');
    this.directionOverlay.classList.add('attachment-directions');
    this.directionOverlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none';
    canvas.parentElement?.append(this.directionOverlay);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xdfe7ee);
    this.scene.fog = new THREE.Fog(0xdfe7ee, 60, 220);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // About one shadow texel over the 80 m frustum; prevents thin Cowl self-shadow stripes.
    sun.shadow.normalBias = 0.05;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 120;
    this.scene.add(sun);
    this.sun = sun;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({ color: 0xb9c4b0, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    for (const [div, color] of [[1000, 0x8f9a86], [100, 0x6f7a66]] as const) {
      const grid = new THREE.GridHelper(1000, div, color, color);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.35;
      grid.position.y = div === 1000 ? 0.002 : 0.004;
      this.scene.add(grid);
    }

    for (const b of COURSE) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...b.size), new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9 }));
      m.position.set(...b.pos);
      m.rotation.set(b.rotX ?? 0, b.rotY ?? 0, 0, 'YXZ');
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    }

    for (const c of CRATES) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(c.size, c.size, c.size), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.8 }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.crateMeshes.push(m);
    }

    this.lines = new THREE.LineSegments(this.linesGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
    this.scene.add(this.group);
    this.resize();
  }

  resize(preserveFraming = false): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    // Preserve the user's zoom relative to the limiting viewport dimension.
    // This also keeps a previously fitted bounding sphere visible after rotation/resizing.
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const oldLimit = Math.atan(Math.tan(halfFov) * Math.min(1, this.camera.aspect));
    this.camera.aspect = w / h;
    if (preserveFraming) {
      const newLimit = Math.atan(Math.tan(halfFov) * Math.min(1, this.camera.aspect));
      const scale = Math.sin(oldLimit) / Math.sin(newLimit);
      this.camDist *= scale;
      this.zoomLimit = Math.max(60, this.zoomLimit * scale);
      this.camera.position.sub(this.camTarget).multiplyScalar(scale).add(this.camTarget);
    }
    this.camera.updateProjectionMatrix();
  }

  clearModel(): void { this.rebuild([], () => 0); }

  rebuild(tiles: TileInstance[], env: ValEnv): void {
    this.setLines3d([]); this.syncProjectiles([]);
    this.selectTile(null);
    for (const v of this.views.values()) v.material.dispose();
    this.group.clear();
    this.views.clear();
    for (const t of tiles) {
      const geo = t.spec.wheel ? this.wheelGeo : t.type === 'cowl' ? cowlGeometry(t.option, t.dir, this.cowlGeos) : this.plateGeo;
      const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
      if (t.type === 'cowl') material.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (t.spec.wheel) {
        // tyre radius follows the physics; a pale spoke makes the spin visible
        const r = wheelRadius(t.option) / (TILE / 2);
        mesh.scale.set(r, 1, r);
        const spoke = new THREE.Mesh(this.spokeGeo, this.spokeMat);
        spoke.scale.set(1 / r, 1, 1 / r);
        mesh.add(spoke);
      }
      if (t.spec.jet) {
        material.emissive.setHex(0xff5a00);
        material.emissiveIntensity = 0;
      }
      const view: TileView = {
        tile: t,
        mesh,
        material,
        dynamicColor: !!t.colorExpr && !exprIsConstant(t.colorExpr),
        dynamicAlpha: !!t.effectExpr && !exprIsConstant(t.effectExpr),
      };
      this.applyColor(view, env);
      this.applyAlpha(view, env);
      if (t.ghost) {
        material.transparent = true;
        material.opacity = 0.35;
      }
      this.group.add(mesh);
      this.views.set(t.id, view);
    }
  }

  preview(tiles: TileInstance[], env: ValEnv): void {
    this.rebuild(tiles, env);
    const lift = 0.4 - Math.min(...tiles.map(t => t.position.y));
    for (const t of tiles) {
      const v = this.views.get(t.id)!;
      v.mesh.position.copy(t.position);
      v.mesh.position.y += lift;
      v.mesh.quaternion.copy(t.quaternion);
    }
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    if (!bounds.isEmpty() && bounds.min.y < 0.05) {
      const clearance = 0.05 - bounds.min.y;
      for (const view of this.views.values()) view.mesh.position.y += clearance;
      this.group.updateMatrixWorld(true);
    }
  }

  /** Fit around the followed Core, including asymmetric models extending far to one side. */
  frameSimulation(target: THREE.Vector3): void {
    this.resize();
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    if (bounds.isEmpty()) return;
    const farthest = new THREE.Vector3(
      Math.max(Math.abs(bounds.min.x - target.x), Math.abs(bounds.max.x - target.x)),
      Math.max(Math.abs(bounds.min.y - target.y), Math.abs(bounds.max.y - target.y)),
      Math.max(Math.abs(bounds.min.z - target.z), Math.abs(bounds.max.z - target.z)),
    );
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2) * Math.min(1, this.camera.aspect));
    this.camDist = Math.max(3, farthest.length() / Math.sin(halfFov) * 1.2);
    this.zoomLimit = Math.max(60, this.camDist * 4);
    this.snap(target);
  }

  frameModel(): void {
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    this.camDist = Math.max(2, radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.15);
    this.zoomLimit = Math.max(60, this.camDist * 4);
    this.snap(center);
  }

  focusTile(id: number): void {
    const view = this.views.get(id); if (!view) return;
    this.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(view.mesh);
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.min(1, this.camera.aspect));
    this.camDist = Math.max(1, radius / Math.sin(halfFov) * 1.4);
    this.zoomLimit = Math.max(60, this.camDist * 4);
    this.snap(bounds.getCenter(new THREE.Vector3()));
  }

  updateEditorCamera(): void { this.follow(this.camTarget, 1); }

  selectTile(id: number | null): void {
    this.selectedId = id;
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.geometry.dispose(); this.selectionBox.material.dispose(); this.selectionBox = null;
    }
    const selected = id === null ? null : this.views.get(id);
    if (selected) {
      this.selectionBox = new THREE.BoxHelper(selected.mesh, 0xffd900);
      this.selectionBox.material.depthTest = false;
      this.selectionBox.renderOrder = 10;
      this.scene.add(this.selectionBox);
    }
  }

  pickTile(x: number, y: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), this.camera);
    const hit = ray.intersectObjects([...this.views.values()].map(v => v.mesh), true)[0];
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      for (const [id, v] of this.views) if (v.mesh === object) return id;
      object = object.parent;
    }
    return null;
  }

  tileColorHex(id: number): string { return `#${this.views.get(id)?.material.color.getHexString() ?? 'cccccc'}`; }

  private applyColor(v: TileView, env: ValEnv): void {
    const t = v.tile;
    let c = t.colorExpr ? evalExpr(t.colorExpr, env) : NaN;
    if (!Number.isFinite(c) || !t.colorExpr) c = PALETTE[t.type] ?? 0xcccccc;
    v.material.color.setHex(Math.max(0, Math.min(0xffffff, Math.floor(c))));
  }

  /** effect=#PQRS on a Cowl: P is transparency (0 opaque … F invisible) */
  private applyAlpha(v: TileView, env: ValEnv): void {
    const t = v.tile;
    if (t.type !== 'cowl' || !t.effectExpr) return;
    const e = Math.floor(evalExpr(t.effectExpr, env));
    if (!Number.isFinite(e) || e < 0x1000) return; // fewer than 4 hex digits: P is 0
    const p = (e >> 12) & 0xf;
    const opacity = 1 - p / 15;
    v.material.transparent = opacity < 1;
    v.material.opacity = opacity;
  }

  /** re-evaluate colors / transparency that depend on Val variables */
  updateDynamic(env: ValEnv): void {
    for (const v of this.views.values()) {
      if (v.dynamicColor) this.applyColor(v, env);
      if (v.dynamicAlpha) this.applyAlpha(v, env);
    }
  }

  private crateMeshes: THREE.Mesh[] = [];
  private ballMeshes: THREE.Mesh[] = [];
  sync(world: PhysicsWorld): void {
    while (this.ballMeshes.length < world.balls.length) {
      const b = world.balls[this.ballMeshes.length];
      const m = new THREE.Mesh(new THREE.SphereGeometry(b.radius, 24, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color(...b.color), roughness: 0.5 }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.ballMeshes.push(m);
    }
    this.ballMeshes.forEach((m, i) => {
      const b = world.balls[i];
      m.visible = !!b;
      if (!b) return;
      const t = b.body.translation();
      const r = b.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
      (m.material as THREE.MeshStandardMaterial).color.setRGB(...b.color);
    });
    world.crates.forEach((b, i) => {
      const m = this.crateMeshes[i];
      const t = b.translation();
      const r = b.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
    });
    for (const tb of world.tiles) {
      const v = this.views.get(tb.tile.id);
      if (!v) continue;
      const pose = world.pose(tb, this.tmpPose);
      v.mesh.position.copy(pose.position);
      v.mesh.quaternion.copy(pose.quaternion);
      if (tb.tile.spec.wheel) v.mesh.quaternion.multiply(this.spinQuat.setFromAxisAngle(SPIN_AXIS, tb.spinAngle));
      if (tb.tile.spec.jet) v.material.emissiveIntensity = Math.min(1.5, Math.abs(tb.jetPower) / 20000);
    }
  }

  private spinQuat = new THREE.Quaternion();
  private shellPool: THREE.Mesh[] = [];
  private shellGeo = new THREE.SphereGeometry(0.18, 12, 8);
  private shellMat = new THREE.MeshStandardMaterial({ color: 0xffc040, emissive: 0xff7000, emissiveIntensity: 1.2 });
  syncProjectiles(list: { body: { translation(): { x: number; y: number; z: number } } }[]): void {
    while (this.shellPool.length < list.length) {
      const m = new THREE.Mesh(this.shellGeo, this.shellMat);
      this.scene.add(m);
      this.shellPool.push(m);
    }
    this.shellPool.forEach((m, i) => {
      const p = list[i];
      m.visible = !!p;
      if (p) {
        const t = p.body.translation();
        m.position.set(t.x, t.y, t.z);
      }
    });
  }

  /** segments from _MOVE3D/_LINE3D: x1 y1 z1 x2 y2 z2 r g b */
  setLines3d(buf: number[]): void {
    const n = buf.length / 9;
    const pos = new Float32Array(n * 6);
    const col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      pos.set([buf[o], buf[o + 1], buf[o + 2], buf[o + 3], buf[o + 4], buf[o + 5]], i * 6);
      col.set([buf[o + 6], buf[o + 7], buf[o + 8], buf[o + 6], buf[o + 7], buf[o + 8]], i * 6);
    }
    this.linesGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.linesGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lines.visible = n > 0;
  }

  /** place view A's leash where the original starts it (after load / reset): 7.75 m out at world bearing
   *  −111.5° in the original's frame (x mirrored here), 2.0 m up */
  snapModel(center: THREE.Vector3): void {
    this.camTarget.copy(center);
    const horiz = this.leashDist * Math.cos(this.leashPitch);
    this.leashEye.copy(center).add(new THREE.Vector3(0.930 * horiz, this.leashDist * Math.sin(this.leashPitch), -0.367 * horiz));
    this.spectatorEye.copy(this.leashEye); this.spectatorTime = 0;
    if (this.viewMode === 'A' || this.viewMode === 'F') { this.camera.position.copy(this.leashEye); this.camera.lookAt(center); }
  }

  /** runtime camera, once per rendered frame. Laws from the original (docs/measured.md, camera):
   *  A/F a leash that ignores heading and closes 31% of the gap per 1/30 s frame; B/G a spectator re-placed
   *  25 m ahead along the velocity every 5 s or beyond 76 m; C/D/I fixed to the core; E 29.9 m overhead;
   *  H frozen; J an orbit at 90°/s. F and G only differ from A and B with detached chips (not modelled). */
  followModel(s: { center: THREE.Vector3; core: THREE.Vector3; quat: THREE.Quaternion; velocity: THREE.Vector3 }, dt: number): void {
    const center = s.center;
    this.camTarget.copy(center);
    const k = 1 - Math.pow(1 - 0.31, dt * 30);
    const flat = this.leashEye.clone().sub(center).setY(0);
    if (flat.lengthSq() < 1e-8) flat.set(0.930, 0, -0.367);
    const desired = center.clone().addScaledVector(flat.normalize(), this.leashDist * Math.cos(this.leashPitch));
    desired.y += this.leashDist * Math.sin(this.leashPitch);
    this.leashEye.lerp(desired, k);
    const cam = this.camera;
    cam.up.set(0, 1, 0);
    const fixed = (eye: [number, number, number], look: [number, number, number]) => {
      cam.position.set(...eye).applyQuaternion(s.quat).add(s.core);
      cam.lookAt(new THREE.Vector3(...look).applyQuaternion(s.quat).add(s.core));
    };
    switch (this.viewMode) {
      case 'A': case 'F': cam.position.copy(this.leashEye); cam.lookAt(center); break;
      case 'B': case 'G': {
        this.spectatorTime += dt;
        if (this.spectatorTime >= 5 || this.spectatorEye.distanceTo(center) > 76) {
          if (s.velocity.lengthSq() > 0.25) this.spectatorEye.copy(center).addScaledVector(s.velocity.clone().normalize(), 25);
          this.spectatorTime = 0;
        }
        cam.position.copy(this.spectatorEye); cam.lookAt(center); break;
      }
      // core-relative offsets measured in the original's model frame (its x mirrored)
      case 'C': fixed([0.4, 0.8, 2.3], [0.6, 0.8, -5.6]); break;
      case 'D': fixed([0.16, 0.0, 7.4], [0.3, -0.15, -1.2]); break;
      case 'I': fixed([0.8, 0.0, 0.8], [0.42, -0.15, -1.7]); break;
      case 'E': cam.position.copy(center).add(new THREE.Vector3(0, 29.9, 0.001)); cam.up.set(0, 0, -1); cam.lookAt(center); break;
      case 'H': cam.position.copy(this.fixedEye); cam.lookAt(this.fixedEye.clone().add(this.fixedDir)); break;
      case 'J': {
        this.orbitAngle += dt * Math.PI / 2;
        cam.position.copy(center).add(new THREE.Vector3(Math.sin(this.orbitAngle) * 4.5, 0.75 + 2.45 * Math.sin(this.orbitAngle), Math.cos(this.orbitAngle) * 4.5));
        cam.lookAt(center); break;
      }
    }
    this.applyFov();
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).add(new THREE.Vector3(20, 40, 10));
    this.sun.target.updateMatrixWorld();
  }

  /** jump the chase camera onto the model (after load / reset) instead of easing from afar */
  snap(target: THREE.Vector3): void {
    this.camTarget.copy(target);
    const cp = this.camPitch;
    const cy = this.camYaw;
    const off = new THREE.Vector3(Math.cos(cp) * Math.sin(cy), Math.sin(cp), Math.cos(cp) * Math.cos(cy)).multiplyScalar(this.camDist);
    this.camera.position.copy(target).add(off);
    this.camera.lookAt(target);
  }

  /** the editor's free orbit */
  follow(target: THREE.Vector3, smooth = 0.08): void {
    this.camTarget.lerp(target, smooth);
    const cp = this.camPitch;
    const cy = this.camYaw;
    const off = new THREE.Vector3(Math.cos(cp) * Math.sin(cy), Math.sin(cp), Math.cos(cp) * Math.cos(cy)).multiplyScalar(this.camDist);
    const eye = this.camTarget.clone().add(off);
    eye.y = Math.max(eye.y, 0.4);
    this.camera.position.lerp(eye, 0.15);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camTarget);
    this.sun.target.position.copy(this.camTarget);
    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(20, 40, 10));
    this.sun.target.updateMatrixWorld();
  }

  private updateDirectionMarks(): void {
    const view = this.selectedId === null ? undefined : this.views.get(this.selectedId);
    this.directionOverlay.style.display = view ? 'block' : 'none';
    if (!view) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const project = (v: THREE.Vector3) => {
      v.project(this.camera);
      return {x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2, z: v.z};
    };
    const center = project(view.mesh.position.clone());
    const vectors = [[0, 0, -1], [-1, 0, 0], [1, 0, 0], [0, 0, 1]];
    const placed: {x: number; y: number}[] = [];
    this.directionMarks.forEach((mark, i) => {
      // Nominal tile edges define joints, including on enlarged wheels.
      const anchor = new THREE.Vector3(...vectors[i]).multiplyScalar(TILE / 2)
        .applyQuaternion(view.tile.quaternion).add(view.mesh.position);
      const edge = project(anchor);
      const visible = center.z > -1 && center.z < 1 && edge.z > -1 && edge.z < 1;
      mark.setAttribute('visibility', visible ? 'visible' : 'hidden');
      let dx = edge.x - center.x, dy = edge.y - center.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) { dx = i % 2 ? -1 : 1; dy = i < 2 ? -1 : 1; }
      const norm = Math.hypot(dx, dy);
      let x = center.x + dx / norm * Math.max(length + 20, 34);
      let y = center.y + dy / norm * Math.max(length + 20, 34);
      x = Math.max(14, Math.min(width - 14, x));
      y = Math.max(14, Math.min(height - 14, y));
      // Edge-on projections can coincide. Keep letters apart while lines retain the exact anchors.
      for (let attempt = 0; attempt < 8 && placed.some(p => Math.hypot(p.x-x, p.y-y) < 27); attempt++) {
        y = Math.max(14, Math.min(height - 14, y + (y < height / 2 ? 28 : -28)));
      }
      placed.push({x,y});
      const [line, circle, text] = Array.from(mark.children);
      line.setAttribute('x1', String(edge.x)); line.setAttribute('y1', String(edge.y));
      line.setAttribute('x2', String(x)); line.setAttribute('y2', String(y));
      circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y));
      text.setAttribute('x', String(x)); text.setAttribute('y', String(y));
      const hit = mark.querySelector('.hit')!;
      hit.setAttribute('cx', String(x)); hit.setAttribute('cy', String(y));
      const dot = mark.querySelector('.anchor')!;
      dot.setAttribute('cx', String(edge.x)); dot.setAttribute('cy', String(edge.y));
    });
  }

  render(): void {
    this.camera.updateMatrixWorld();
    this.updateDirectionMarks();
    this.renderer.render(this.scene, this.camera);
  }
}
