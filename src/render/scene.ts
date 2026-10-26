import * as THREE from 'three';
import { TILE, TILE_T, type TileInstance } from '../model/assemble';
import type { PhysicsWorld } from '../physics/world';

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

export class SceneView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  meshes = new Map<number, THREE.Object3D>();
  private plateGeo = new THREE.BoxGeometry(TILE, TILE_T, TILE);
  private wheelGeo = new THREE.CylinderGeometry(TILE / 2, TILE / 2, TILE_T, 24);
  private materials = new Map<number, THREE.MeshStandardMaterial>();
  private group = new THREE.Group();
  camYaw = 0.6;
  camPitch = 0.35;
  camDist = 9;
  private camTarget = new THREE.Vector3();

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xdfe7ee);
    this.scene.fog = new THREE.Fog(0xdfe7ee, 60, 220);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
    this.scene.add(hemi);
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
    const grid = new THREE.GridHelper(1000, 1000, 0x8f9a86, 0xa9b4a0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.002;
    this.scene.add(grid);
    const grid10 = new THREE.GridHelper(1000, 100, 0x6f7a66, 0x6f7a66);
    (grid10.material as THREE.Material).transparent = true;
    (grid10.material as THREE.Material).opacity = 0.35;
    grid10.position.y = 0.004;
    this.scene.add(grid10);

    this.scene.add(this.group);
    this.resize();
  }
  private sun: THREE.DirectionalLight;

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private material(color: number): THREE.MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
      this.materials.set(color, m);
    }
    return m;
  }

  rebuild(tiles: TileInstance[]): void {
    this.group.clear();
    this.meshes.clear();
    for (const t of tiles) {
      const color = t.color ?? PALETTE[t.type] ?? 0xcccccc;
      const mesh = new THREE.Mesh(t.spec.wheel ? this.wheelGeo : this.plateGeo, this.material(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const obj: THREE.Object3D = mesh;
      if (t.spec.wheel) {
        // cylinder axis (Y) is already the tile normal, which is the spin axis
      } else if (t.ghost || !t.spec.collides) {
        const mat = this.material(color).clone();
        mat.transparent = true;
        mat.opacity = 0.45;
        mesh.material = mat;
      }
      this.group.add(obj);
      this.meshes.set(t.id, obj);
    }
  }

  private tmpPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  sync(world: PhysicsWorld): void {
    for (const tb of world.tiles) {
      const obj = this.meshes.get(tb.tile.id);
      if (!obj) continue;
      const pose = world.pose(tb, this.tmpPose);
      obj.position.copy(pose.position);
      obj.quaternion.copy(pose.quaternion);
    }
  }

  /** chase: ease the orbit yaw toward the model's heading (set by main when not dragging) */
  chaseYaw(headingYaw: number, rate = 0.03): void {
    let d = headingYaw - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * rate;
  }

  follow(target: THREE.Vector3, smooth = 0.08): void {
    this.camTarget.lerp(target, smooth);
    const cp = this.camPitch;
    const cy = this.camYaw;
    const off = new THREE.Vector3(
      Math.cos(cp) * Math.sin(cy),
      Math.sin(cp),
      Math.cos(cp) * Math.cos(cy),
    ).multiplyScalar(this.camDist);
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
