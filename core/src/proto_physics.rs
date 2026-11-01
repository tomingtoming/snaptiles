//! Physics for the prototype: Rapier's `PhysicsWorld` with SnapTiles' ground (a 200 km slab, top at y = 0) and
//! free boxes. The settings follow `src/physics/world.ts`: 1 solver iteration with 48 internal PGS iterations.

use rapier3d::prelude::*;

pub struct Physics {
    world: PhysicsWorld,
    bodies: Vec<RigidBodyHandle>,
}

impl Default for Physics {
    fn default() -> Self {
        let mut world = PhysicsWorld::default();
        world.gravity = Vector::new(0.0, -9.8, 0.0);
        world.integration_parameters.num_solver_iterations = 1;
        world.integration_parameters.num_internal_pgs_iterations = 48;
        world.insert_collider(ColliderBuilder::cuboid(100_000.0, 1.0, 100_000.0).translation(Vector::new(0.0, -1.0, 0.0)).friction(1.0), None);
        Physics { world, bodies: Vec::new() }
    }
}

impl Physics {
    pub fn add_box(&mut self, pos: [f64; 3], half: [f64; 3], mass: f64) -> usize {
        let body = self.world.insert_body(RigidBodyBuilder::dynamic().translation(Vector::new(pos[0] as Real, pos[1] as Real, pos[2] as Real)));
        let collider = ColliderBuilder::cuboid(half[0] as Real, half[1] as Real, half[2] as Real).mass(mass as Real);
        self.world.insert_collider(collider, Some(body));
        self.bodies.push(body);
        self.bodies.len() - 1
    }

    pub fn len(&self) -> usize { self.bodies.len() }
    pub fn is_empty(&self) -> bool { self.bodies.is_empty() }

    pub fn step(&mut self, dt: f64) {
        self.world.integration_parameters.dt = dt as Real;
        self.world.step();
    }

    pub fn position(&self, i: usize) -> Option<[f64; 3]> {
        let b = self.world.bodies.get(*self.bodies.get(i)?)?;
        let t = b.translation();
        Some([t.x as f64, t.y as f64, t.z as f64])
    }

    pub fn pose(&self, i: usize) -> Option<([f64; 3], [f64; 4])> {
        let b = self.world.bodies.get(*self.bodies.get(i)?)?;
        let (t, q) = (b.translation(), b.rotation());
        Some(([t.x as f64, t.y as f64, t.z as f64], [q.x as f64, q.y as f64, q.z as f64, q.w as f64]))
    }
}
