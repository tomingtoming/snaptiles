//! SnapTiles simulation core (prototype): Rapier physics and the model's Lua in one Rust crate, built natively for
//! fast headless runs and with Emscripten into one WebAssembly module for the browser.
//!
//! The prototype covers the boundary only: boxes on a ground plane, a Lua script with a few read APIs (`_X/_Y/_Z`,
//! `_KEY`, `_TICKS`, `out`), an instruction budget, and a flat state array the page reads without crossing the
//! boundary per value. The real physics layer (`src/physics/world.ts`) is not ported yet.

mod physics;
pub mod ffi;
pub mod rc;
pub mod model;

use mlua::{HookTriggers, Lua, Value, VmState};
use std::cell::RefCell;
use std::rc::Rc;

pub use physics::Physics;

/// Script frames per second and physics steps per frame, as in the TypeScript simulation.
pub const FRAME_RATE: f64 = 30.0;
pub const SUBSTEPS: usize = 2;
/// Lua instructions allowed per call before the script is stopped (an infinite loop must not hang the page).
pub const LUA_BUDGET: u32 = 5_000_000;
/// The original runs Lua 5.0; these give its spellings on Lua 5.4 (same text as `src/scripting/lua.ts`).
const COMPAT: &str = r#"
math.mod = math.fmod
math.pow = function(a, b) return a ^ b end
math.atan2 = function(y, x) return math.atan(y, x) end
"#;

/// State shared with the Lua API closures.
#[derive(Default)]
pub struct Shared {
    pub physics: Physics,
    pub keys: [bool; 17],
    pub ticks: u64,
    pub out: Vec<String>,
}

pub struct Core {
    shared: Rc<RefCell<Shared>>,
    lua: Option<Lua>,
    frame_fn: Option<&'static str>,
    pub error: Option<String>,
    /// x, y, z, qx, qy, qz, qw per body: what the page needs to draw, read straight out of memory
    pub state: Vec<f64>,
}

impl Default for Core {
    fn default() -> Self { Self::new() }
}

impl Core {
    pub fn new() -> Self {
        Core { shared: Rc::new(RefCell::new(Shared::default())), lua: None, frame_fn: None, error: None, state: Vec::new() }
    }

    pub fn add_box(&mut self, pos: [f64; 3], half: [f64; 3], mass: f64) -> usize {
        self.shared.borrow_mut().physics.add_box(pos, half, mass)
    }

    pub fn set_key(&mut self, key: usize, down: bool) {
        if let Some(k) = self.shared.borrow_mut().keys.get_mut(key) { *k = down; }
    }

    pub fn out(&self) -> Vec<String> { self.shared.borrow().out.clone() }

    /// Load the model's Lua section. `line_offset` maps the chunk's line numbers to file lines in errors.
    pub fn load_lua(&mut self, source: &str, line_offset: usize) -> Result<(), String> {
        let lua = Lua::new();
        let result = (|| -> mlua::Result<()> {
            self.register_api(&lua)?;
            lua.load(COMPAT).set_name("compat").exec()?;
            Self::arm_budget(&lua);
            lua.load(&source.replace('\u{3000}', " ")).set_name("model").exec()?;
            Ok(())
        })();
        lua.remove_hook();
        if let Err(e) = result {
            let message = file_line(&e.to_string(), line_offset);
            self.error = Some(message.clone());
            return Err(message);
        }
        let globals = lua.globals();
        self.frame_fn = ["OnFrame", "main"].into_iter().find(|name| matches!(globals.get::<Value>(*name), Ok(Value::Function(_))));
        self.lua = Some(lua);
        self.error = None;
        Ok(())
    }

    fn arm_budget(lua: &Lua) {
        let left = std::cell::Cell::new(LUA_BUDGET);
        let _ = lua.set_hook(HookTriggers::new().every_nth_instruction(10_000), move |_, _| {
            left.set(left.get().saturating_sub(10_000));
            if left.get() == 0 { Err(mlua::Error::runtime("script took too long (instruction budget exceeded)")) } else { Ok(VmState::Continue) }
        });
    }

    fn register_api(&self, lua: &Lua) -> mlua::Result<()> {
        let g = lua.globals();
        for (name, axis) in [("_X", 0usize), ("_Y", 1), ("_Z", 2)] {
            let shared = self.shared.clone();
            g.set(name, lua.create_function(move |_, n: f64| Ok(shared.borrow().physics.position(n as usize).map(|p| p[axis]).unwrap_or(0.0)))?)?;
        }
        let shared = self.shared.clone();
        g.set("_KEY", lua.create_function(move |_, n: f64| Ok(if shared.borrow().keys.get(n as usize).copied().unwrap_or(false) { 1.0 } else { 0.0 }))?)?;
        let shared = self.shared.clone();
        g.set("_TICKS", lua.create_function(move |_, ()| Ok(shared.borrow().ticks as f64))?)?;
        let shared = self.shared.clone();
        g.set("out", lua.create_function(move |lua, (row, rest): (f64, mlua::MultiValue)| {
            let mut text = String::new();
            for v in rest.iter() {
                match v {
                    Value::Number(x) => text.push_str(&format!("{x:.2}")),
                    Value::Integer(x) => text.push_str(&format!("{x}.00")),
                    other => text.push_str(&lua.coerce_string(other.clone())?.map(|s| s.to_string_lossy().to_string()).unwrap_or_default()),
                }
            }
            let row = row.max(0.0) as usize;
            let mut s = shared.borrow_mut();
            if s.out.len() <= row { s.out.resize(row + 1, String::new()); }
            s.out[row] = text;
            Ok(())
        })?)?;
        Ok(())
    }

    /// One script frame: run the script, then advance the physics by 1/30 s in SUBSTEPS steps.
    pub fn step(&mut self) {
        if let (Some(lua), Some(name), None) = (&self.lua, self.frame_fn, &self.error) {
            Self::arm_budget(lua);
            let call = lua.globals().get::<mlua::Function>(name).and_then(|f| f.call::<()>(()));
            lua.remove_hook();
            if let Err(e) = call { self.error = Some(e.to_string()); }
        }
        {
            let mut s = self.shared.borrow_mut();
            for _ in 0..SUBSTEPS { s.physics.step(1.0 / FRAME_RATE / SUBSTEPS as f64); }
            s.ticks += 1;
        }
        self.write_state();
    }

    fn write_state(&mut self) {
        let s = self.shared.borrow();
        self.state.clear();
        for i in 0..s.physics.len() {
            let (p, q) = s.physics.pose(i).unwrap();
            self.state.extend_from_slice(&[p[0], p[1], p[2], q[0], q[1], q[2], q[3]]);
        }
    }
}

/// `[string "model"]:12:` → `line 57:` given the line before the chunk's first line (see `script.firstLine`).
pub fn file_line(message: &str, offset: usize) -> String {
    let mut out = String::new();
    let mut rest = message;
    while let Some(i) = rest.find("[string \"model\"]:") {
        out.push_str(&rest[..i]);
        let tail = &rest[i + "[string \"model\"]:".len()..];
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        match digits.parse::<usize>() {
            Ok(n) if tail[digits.len()..].starts_with(':') => {
                out.push_str(&format!("line {}:", n + offset));
                rest = &tail[digits.len() + 1..];
            }
            _ => { out.push_str("[string \"model\"]:"); rest = tail; }
        }
    }
    out.push_str(rest);
    out
}
