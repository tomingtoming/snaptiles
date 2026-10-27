// A few static obstacles around the spawn point so there is something to drive
// over and fly between. Shared by physics (colliders) and rendering (meshes).

export interface Block {
  pos: [number, number, number]; // center
  size: [number, number, number]; // full extents
  rotY?: number; // radians
  rotX?: number;
  color: number;
}

const DEG = Math.PI / 180;

export const COURSE: Block[] = [
  // a long ramp north of the spawn
  { pos: [-16, 0.9, -70], size: [8, 0.4, 12], rotX: 10 * DEG, color: 0x8a949c },
  // low kerbs to bump over
  { pos: [-12, 0.15, -12], size: [6, 0.3, 0.6], color: 0xb0b8bf },
  { pos: [-12, 0.15, -16], size: [6, 0.3, 0.6], color: 0xb0b8bf },
  { pos: [-12, 0.15, -20], size: [6, 0.3, 0.6], color: 0xb0b8bf },
  // a gate of two pillars to fly or drive through
  { pos: [18, 4, -25], size: [1.5, 8, 1.5], color: 0x7a8f9e },
  { pos: [28, 4, -25], size: [1.5, 8, 1.5], color: 0x7a8f9e },
  { pos: [23, 8.3, -25], size: [12, 0.6, 1.5], color: 0x7a8f9e },
  // a wall to shoot at
  { pos: [0, 2.5, 40], size: [16, 5, 1], color: 0x9c8b7a },
  // stepping blocks
  { pos: [-25, 0.5, 10], size: [4, 1, 4], color: 0xa0a8b0 },
  { pos: [-31, 1, 10], size: [4, 2, 4], color: 0xa0a8b0 },
  { pos: [-37, 1.5, 10], size: [4, 3, 4], color: 0xa0a8b0 },
];
