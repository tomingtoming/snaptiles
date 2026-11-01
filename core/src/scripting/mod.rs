//! The model's scripts: Lua 5.4 through mlua (`lua.rs`, port of `src/scripting/lua.ts`) and the legacy one-statement
//! `Script` language (`rcscript.rs`, port of `src/scripting/rcscript.ts`).

pub mod lua;
pub mod rcscript;

pub use lua::{file_line, LuaEngine, COMPAT};
pub use rcscript::{RcScript, ScriptHost};
