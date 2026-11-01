//! Model assembly: the type table, rest poses and joint frames, and the static course (ports of `src/model/*`).

pub mod assemble;
pub mod course;

pub use assemble::{
    assemble, assembly_bottom, attr, dir_code, dir_vec, fold_sign, joint_sign, refresh_joint_frames, type_spec, AssembleError,
    Assembly, JointKind, LocalFrames, Quat, TileInstance, TypeSpec, Vec3, FOLD_SIGN, JOINT_SIGN, TILE, TILE_T, TYPES,
};
pub use course::{Block, Crate, COURSE, CRATES};
