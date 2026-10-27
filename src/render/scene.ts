import * as THREE from 'three';
import { TILE, TILE_T, type TileInstance, type ValEnv } from '../model/assemble';
import { evalExpr, exprIsConstant } from '../rc/expr';
import { wheelRadius, type PhysicsWorld } from '../physics/world';
const SPIN_AXIS = new THREE.Vector3(0, 1, 0);
import { COURSE, CRATES } from '../model/course';

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
 * Cowl shapes (option): 0 plate, 3/4 the two right triangles of a tile cut on
 * its diagonal, 5 a curved plate (drawn flat), 1/2 undocumented (drawn as plates).
 * Which triangle is which was read off the model corpus: children of option 3
 * cowls attach on their east side (143 vs 5), option 4 on the west (156 vs 8),
 * with "north" meaning away from the parent. So option 3 keeps the attached edge
 * and the east edge, option 4 the attached edge and the west edge.
 */
function cowlGeometry(option: number, dir: TileInstance['dir'], cache: Map<string, THREE.BufferGeometry>): THREE.BufferGeometry {
  const shape = option === 3 || option === 4 || option === 5 ? option : 0;
  const key = `${shape}${shape ? dir ?? 'N' : ''}`;
  let g = cache.get(key);
  if (g) return g;
  if (shape === 0) {
    g = new THREE.BoxGeometry(TILE, TILE_T * 0.5, TILE);
  } else if (shape === 5) {
    // "curved" cowl (shape undocumented): a ribbon spanning the tile that bulges up 0.18
    const h = TILE / 2;
    const n = 10;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const z = h - TILE * t;
      const y = 0.18 * Math.sin(Math.PI * t);
      pos.push(-h, y, z, h, y, z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const turn = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 }[dir ?? 'N'];
    if (turn) g.rotateY(turn);
    g.computeVertexNormals();
  } else {
    // built for a north-attached cowl: parent on +Z, the attached edge is +Z, far edge -Z
    const h = TILE / 2;
    const t = TILE_T * 0.25;
    const ax = shape === 3 ? h : -h; // apex corner on the far edge: NE for 3, NW for 4
    const top = [[-h, t, h], [h, t, h], [ax, t, -h]];
    const bot = top.map(([x, , z]) => [x, -t, z]);
    const pos: number[] = [];
    const push = (...v: number[][]) => v.forEach((p) => pos.push(...p));
    push(top[0], top[1], top[2]);
    push(bot[2], bot[1], bot[0]);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      push(top[i], bot[i], top[j]);
      push(top[j], bot[i], bot[j]);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // turn so the attached edge faces the parent: S parent is at -Z, E parent at -X, W parent at +X
    const turn = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 }[dir ?? 'N'];
    if (turn) g.rotateY(turn);
    g.computeVertexNormals();
  }
  cache.set(key, g);
  return g;
}

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
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
  private camTarget = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private tmpPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

  constructor(public canvas: HTMLCanvasElement) {
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

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  rebuild(tiles: TileInstance[], env: ValEnv): void {
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
  sync(world: PhysicsWorld): void {
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

  /** chase: ease the orbit yaw toward the model's heading (set by main when not dragging) */
  chaseYaw(headingYaw: number, rate = 0.03): void {
    let d = headingYaw - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * rate;
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

  follow(target: THREE.Vector3, smooth = 0.08): void {
    this.camTarget.lerp(target, smooth);
    const cp = this.camPitch;
    const cy = this.camYaw;
    const off = new THREE.Vector3(Math.cos(cp) * Math.sin(cy), Math.sin(cp), Math.cos(cp) * Math.cos(cy)).multiplyScalar(this.camDist);
    const eye = this.camTarget.clone().add(off);
    eye.y = Math.max(eye.y, 0.4);
    this.camera.position.lerp(eye, 0.15);
    this.camera.lookAt(this.camTarget);
    this.sun.target.position.copy(this.camTarget);
    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(20, 40, 10));
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
