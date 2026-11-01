//! `Simulation` (port of `src/sim/simulation.ts`): Val state (default/min/max/step/disp, touched flags, per-frame
//! return toward the default), Key bindings, the frame order (keys → Vals → script → return/clamp → two physics
//! steps of 1/60 s), start/reset (OnInit/OnReset), the script API state (lines, zoom, pen, regulations, balls, wind).
//!
//! Every `__tune` knob of the TypeScript is dropped with its default inlined (`scriptAfterPhysics` off, two substeps,
//! 30 fps; the API signs in `api.rs`). `noCourse` is [`PhysicsOptions::no_course`].
//!
//! Ownership: the state the script API touches lives in [`SimState`] behind an `Rc<RefCell<…>>` shared with the Lua
//! closures; nothing holds a borrow of it while Lua runs.

use super::api::{self, Arg, Ret};
use super::keys::key_bit;
use crate::model::{assemble, Vec3};
use crate::physics::math::{from_vector, js_max, js_min, js_sign};
use crate::physics::{BuildOptions, PhysicsOptions, World};
use crate::rc::{parse_rc, RcModel, ScriptLang};
use crate::scripting::lua::{js_to_number, LuaEngine};
use crate::scripting::rcscript::{RcScript, ScriptHost};
use mlua::{Lua, Value};
use std::cell::{Ref, RefCell, RefMut};
use std::collections::HashMap;
use std::rc::Rc;

/// script / key frame rate of the original tool and physics substeps per frame
pub const FRAME_RATE: f64 = 30.0;
pub const PHYSICS_SUBSTEPS: usize = 2;

#[derive(Clone, Debug, PartialEq)]
pub struct ValState {
    pub name: String,
    pub value: f64,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub disp: bool,
    pub touched: bool,
}

/// Val states (in declaration order, as the TypeScript `Map`) and the chip names: the environment attribute
/// expressions read.
#[derive(Clone, Debug, Default)]
pub struct Vars {
    pub vals: Vec<ValState>,
    val_index: HashMap<String, usize>,
    /// (upper-case name, chip number) in first-insertion order
    pub chips: Vec<(String, f64)>,
    chip_index: HashMap<String, usize>,
}

fn upper(name: &str) -> std::borrow::Cow<'_, str> {
    if name.bytes().all(|b| b.is_ascii() && !b.is_ascii_lowercase()) {
        std::borrow::Cow::Borrowed(name)
    } else {
        std::borrow::Cow::Owned(name.to_uppercase())
    }
}

impl Vars {
    /// the Val environment (`Simulation.env`): a Val's value, else a chip name's number
    pub fn get(&self, name: &str) -> Option<f64> {
        let u = upper(name);
        if let Some(&i) = self.val_index.get(u.as_ref()) {
            return Some(self.vals[i].value);
        }
        self.chip_index.get(u.as_ref()).map(|&i| self.chips[i].1)
    }
    pub fn val(&self, name: &str) -> Option<&ValState> {
        self.val_index.get(upper(name).as_ref()).map(|&i| &self.vals[i])
    }
    pub fn val_mut(&mut self, name: &str) -> Option<&mut ValState> {
        let i = *self.val_index.get(upper(name).as_ref())?;
        Some(&mut self.vals[i])
    }
    fn set_val_state(&mut self, v: ValState) {
        match self.val_index.get(&v.name) {
            Some(&i) => self.vals[i] = v,
            None => {
                self.val_index.insert(v.name.clone(), self.vals.len());
                self.vals.push(v);
            }
        }
    }
    fn set_chip(&mut self, name: String, n: f64) {
        match self.chip_index.get(&name) {
            Some(&i) => self.chips[i].1 = n,
            None => {
                self.chip_index.insert(name.clone(), self.chips.len());
                self.chips.push((name, n));
            }
        }
    }
    fn clear_chips(&mut self) {
        self.chips.clear();
        self.chip_index.clear();
    }
}

/// pointer over the view (canvas pixels) and its buttons, for _MX/_MY/_ML/_MR/_MM
#[derive(Clone, Copy, Debug, Default)]
pub struct Mouse {
    pub x: f64,
    pub y: f64,
    pub l: f64,
    pub r: f64,
    pub m: f64,
}

/// Everything the script API reads and writes.
pub struct SimState {
    pub model: RcModel,
    pub vars: Vars,
    pub world: World,
    pub started: bool,
    /// key numbers the page holds (bit n = key n), the set this frame and the previous frame
    pub held: u32,
    pub keys_now: u32,
    pub keys_prev: u32,
    /// gamepad axes for _ANALOG (−1..1), the pointer, the view size for _WIDTH/_HEIGHT
    pub axes: [f64; 6],
    pub mouse: Mouse,
    pub width: f64,
    pub height: f64,
    /// a JavaScript number in the TypeScript: _SETTICKS can make it anything
    pub ticks: f64,
    /// segments drawn by the script this frame: x1 y1 z1 x2 y2 z2 r g b / x1 y1 x2 y2 r g b
    pub lines3d: Vec<f64>,
    pub lines2d: Vec<f64>,
    /// CCD camera field of view in degrees (_ZOOM); the original's default readout
    pub zoom_fov: f64,
    pub(crate) pen_color: [f64; 3],
    pub(crate) pen3: [f64; 3],
    pub(crate) pen2: [f64; 2],
}

impl ScriptHost for SimState {
    fn val(&self, name: &str) -> Option<f64> {
        self.vars.val(name).map(|v| v.value)
    }
    fn set_val(&mut self, name: &str, value: f64) -> bool {
        match self.vars.val_mut(name) {
            Some(v) => {
                v.value = value;
                v.touched = true;
                true
            }
            None => false,
        }
    }
    fn call(&mut self, name: &str, args: &[f64]) -> Option<f64> {
        let f = api::lookup(name)?;
        let a: Vec<Arg> = args.iter().map(|&x| Arg::Num(x)).collect();
        Some(f(self, &a).num())
    }
}

impl SimState {
    /// call an API function by name (`sim.api()[name](...args)`); 0 for an unknown name
    pub fn call_api(&mut self, name: &str, args: &[Arg]) -> Ret {
        match api::lookup(name) {
            Some(f) => f(self, args),
            None => Ret::Num(0.0),
        }
    }
    fn physics_frame(&mut self) {
        if !self.started {
            return;
        }
        let SimState { world, vars, .. } = self;
        let env = |n: &str| vars.get(n);
        // the original runs scripts and key steps at 30 fps; physics takes two 1/60 s steps per frame
        for _ in 0..PHYSICS_SUBSTEPS {
            world.apply_controls(&env);
            world.step(&env);
        }
    }
}

pub struct Simulation {
    state: Rc<RefCell<SimState>>,
    pub lua: LuaEngine,
    pub rc_script: Option<RcScript>,
    pub script_error: Option<String>,
    /// `out()` rows as of the last frame
    pub out: Vec<String>,
}

impl Simulation {
    /// Parse the model (a parse error is returned as its message, as the TypeScript constructor throws it).
    pub fn new(source: &str, opts: PhysicsOptions) -> Result<Simulation, String> {
        let model = parse_rc(source).map_err(|e| e.to_string())?;
        let mut vars = Vars::default();
        for v in &model.vals {
            vars.set_val_state(ValState {
                name: v.name.to_uppercase(),
                value: v.default,
                default: v.default,
                min: v.min,
                max: v.max,
                step: v.step.abs(),
                disp: v.disp.is_none_or(|d| d != 0.0),
                touched: false,
            });
        }
        let state = SimState {
            model,
            vars,
            world: World::new(opts),
            started: false,
            held: 0,
            keys_now: 0,
            keys_prev: 0,
            axes: [0.0; 6],
            mouse: Mouse::default(),
            width: 640.0,
            height: 480.0,
            ticks: 0.0,
            lines3d: Vec::new(),
            lines2d: Vec::new(),
            zoom_fov: 17.19,
            pen_color: [1.0, 1.0, 1.0],
            pen3: [0.0; 3],
            pen2: [0.0; 2],
        };
        Ok(Simulation { state: Rc::new(RefCell::new(state)), lua: LuaEngine::new(), rc_script: None, script_error: None, out: Vec::new() })
    }

    /// Parse and start in one go.
    pub fn load(source: &str, opts: PhysicsOptions) -> Result<Simulation, String> {
        let mut sim = Simulation::new(source, opts)?;
        sim.start()?;
        Ok(sim)
    }

    pub fn state(&self) -> Ref<'_, SimState> {
        self.state.borrow()
    }
    pub fn state_mut(&self) -> RefMut<'_, SimState> {
        self.state.borrow_mut()
    }

    /// Assemble, build the bodies, load the script and run OnInit.
    pub fn start(&mut self) -> Result<(), String> {
        {
            let mut guard = self.state.borrow_mut();
            let s = &mut *guard;
            let a = {
                let vars = &s.vars;
                assemble(&s.model, &|n: &str| vars.get(n)).map_err(|e| e.0)?
            };
            let a = a.ok_or_else(|| "Body section is missing".to_string())?;
            s.vars.clear_chips();
            for t in &a.tiles {
                if let Some(name) = t.name.as_ref().filter(|n| !n.is_empty()) {
                    s.vars.set_chip(name.clone(), t.chip_index as f64);
                }
            }
            let SimState { world, vars, .. } = s;
            world.build(a, &|n: &str| vars.get(n), Vec3::default(), BuildOptions::default());
            s.ticks = 0.0;
            s.started = true;
        }
        self.load_script();
        Ok(())
    }

    /// Back to the rest pose with default Vals (balls and wind stay), then OnReset.
    pub fn reset(&mut self) {
        {
            let mut guard = self.state.borrow_mut();
            let s = &mut *guard;
            if !s.started {
                return;
            }
            for v in &mut s.vars.vals {
                v.value = v.default;
                v.touched = false;
            }
            // fresh rest poses, nothing detached
            let fresh = {
                let vars = &s.vars;
                assemble(&s.model, &|n: &str| vars.get(n)).ok().flatten()
            };
            let a = match fresh.or_else(|| s.world.assembly().cloned()) {
                Some(a) => a,
                None => return,
            };
            let SimState { world, vars, .. } = s;
            world.build(a, &|n: &str| vars.get(n), Vec3::default(), BuildOptions::default());
            world.reset_crates();
            s.ticks = 0.0;
        }
        self.call_lua("OnReset");
    }

    fn lang(&self) -> Option<ScriptLang> {
        self.state.borrow().model.script.as_ref().map(|s| s.lang)
    }

    fn load_script(&mut self) {
        self.script_error = None;
        self.rc_script = None;
        let Some(script) = self.state.borrow().model.script.clone() else { return };
        match script.lang {
            ScriptLang::Lua => {
                let prelude = self.lua_prelude();
                let state = self.state.clone();
                // Lua reports chunk lines; the chunk's line 1 is the opening brace's line in the file
                self.lua.load(&script.source, |lua| register_api(lua, state), &prelude, script.first_line as i64 - 1);
                self.script_error = self.lua.error.clone();
                self.call_lua("OnInit");
            }
            ScriptLang::Rc => match RcScript::new(&script.source) {
                Ok(s) => self.rc_script = Some(s),
                Err(e) => self.script_error = Some(e),
            },
        }
    }

    fn call_lua(&mut self, f: &str) {
        if self.lang() != Some(ScriptLang::Lua) {
            return;
        }
        self.push_vals_to_lua();
        self.lua.call(f);
        self.pull_vals_from_lua();
        if self.lua.error.is_some() {
            self.script_error = self.lua.error.clone();
        }
    }

    fn lua_prelude(&self) -> String {
        let s = self.state.borrow();
        let mut lines: Vec<String> = s.vars.vals.iter().map(|v| format!("{} = {}", v.name, crate::js::number_to_string(v.value))).collect();
        lines.extend(s.vars.chips.iter().map(|(n, i)| format!("{n} = {}", crate::js::number_to_string(*i))));
        lines.join("\n")
    }

    fn push_vals_to_lua(&self) {
        let vals: Vec<(String, f64)> = self.state.borrow().vars.vals.iter().map(|v| (v.name.clone(), v.value)).collect();
        for (name, v) in vals {
            self.lua.set_number(&name, v);
        }
    }

    fn pull_vals_from_lua(&self) {
        let names: Vec<String> = self.state.borrow().vars.vals.iter().map(|v| v.name.clone()).collect();
        let got: Vec<Option<f64>> = names.iter().map(|n| self.lua.get_number(n)).collect();
        let mut s = self.state.borrow_mut();
        for (v, n) in s.vars.vals.iter_mut().zip(got) {
            if let Some(n) = n {
                if n != v.value {
                    v.value = n;
                    v.touched = true;
                }
            }
        }
    }

    /// Hold exactly the keys in `mask` (bit n = key number n) from the next frame on.
    pub fn set_keys(&mut self, mask: u32) {
        self.state.borrow_mut().held = mask & ((1 << super::keys::KEY_COUNT) - 1);
    }
    pub fn press(&mut self, key: usize) {
        if let Some(b) = key_bit(key as f64) {
            self.state.borrow_mut().held |= b;
        }
    }
    pub fn release(&mut self, key: usize) {
        if let Some(b) = key_bit(key as f64) {
            self.state.borrow_mut().held &= !b;
        }
    }

    /// One fixed step: keys → vals → script → clamp → physics.
    pub fn step(&mut self) {
        {
            let mut guard = self.state.borrow_mut();
            let s = &mut *guard;
            s.keys_prev = s.keys_now;
            s.keys_now = s.held;
            for v in &mut s.vars.vals {
                v.touched = false;
            }
            for k in &s.model.keys {
                if !key_bit(k.key).is_some_and(|b| s.keys_now & b != 0) {
                    continue;
                }
                let Some(v) = s.vars.val_mut(&k.var) else { continue };
                // Key-controlled limits apply before the model reads the value this frame.
                v.value = js_max(v.min, js_min(v.max, v.value + k.step));
                v.touched = true;
            }
            s.lines3d.clear();
            s.lines2d.clear();
            s.pen_color = [1.0, 1.0, 1.0];
        }

        let lang = self.lang();
        if lang == Some(ScriptLang::Lua) && self.script_error.is_none() {
            self.push_vals_to_lua();
            let ok = self.lua.frame();
            self.pull_vals_from_lua();
            if !ok {
                self.script_error = self.lua.error.clone();
            }
            self.out = self.lua.out_lines();
        } else if self.script_error.is_none() {
            if let Some(rc) = self.rc_script.as_mut() {
                let mut s = self.state.borrow_mut();
                match rc.run(&mut *s) {
                    Ok(()) => self.out = rc.out_lines.clone(),
                    Err(e) => self.script_error = Some(e),
                }
            }
        }

        let mut guard = self.state.borrow_mut();
        let s = &mut *guard;
        for v in &mut s.vars.vals {
            if !v.touched && v.step > 0.0 && v.value != v.default {
                let d = v.default - v.value;
                v.value = if d.abs() <= v.step { v.default } else { v.value + js_sign(d) * v.step };
            }
            v.value = js_max(v.min, js_min(v.max, v.value));
        }
        s.physics_frame();
        s.ticks += 1.0;
    }

    /// a Val's current value
    pub fn val(&self, name: &str) -> Option<f64> {
        self.state.borrow().vars.val(name).map(|v| v.value)
    }
    /// set a Val from outside (tests, the page's sliders)
    pub fn set_val(&self, name: &str, value: f64) {
        if let Some(v) = self.state.borrow_mut().vars.val_mut(name) {
            v.value = value;
        }
    }

    /// `sim.api()[name](...args)` with numeric arguments
    pub fn api(&self, name: &str, args: &[f64]) -> f64 {
        let a: Vec<Arg> = args.iter().map(|&x| Arg::Num(x)).collect();
        self.state.borrow_mut().call_api(name, &a).num()
    }

    pub fn ticks(&self) -> f64 {
        self.state.borrow().ticks
    }

    /// yaw of the core's forward (−Z) axis: the chase camera's orbit yaw (offset = −forward)
    pub fn core_heading(&self) -> f64 {
        let s = self.state.borrow();
        if s.world.tiles.is_empty() {
            return 0.0;
        }
        let f = Vec3::new(0.0, 0.0, -1.0).apply_quat(s.world.pose(0).quaternion);
        (-f.x).atan2(-f.z)
    }

    pub fn core_position(&self) -> Vec3 {
        let s = self.state.borrow();
        if s.world.tiles.is_empty() {
            Vec3::default()
        } else {
            s.world.pose(0).position
        }
    }

    /// mass-weighted centre of every tile: the original's chase camera aims here, not at the core (a 6 m boom on one
    /// side moved its target 1.24 m that way at the same 8 m eye distance)
    pub fn model_center(&self) -> Vec3 {
        let s = self.state.borrow();
        let Some(a) = s.world.assembly() else { return Vec3::default() };
        let mut c = Vec3::default();
        let mut m = 0.0;
        for (i, tb) in s.world.tiles.iter().enumerate() {
            let mass = a.tiles[tb.tile].mass;
            let w = if mass == 0.0 || mass.is_nan() { 1.0 } else { mass };
            c = c.add(s.world.pose(i).position.scale(w));
            m += w;
        }
        drop(s);
        if m > 0.0 {
            c.scale(1.0 / m)
        } else {
            self.core_position()
        }
    }

    pub fn core_velocity(&self) -> Vec3 {
        let s = self.state.borrow();
        match s.world.tiles.first() {
            Some(tb) => from_vector(s.world.world.bodies[tb.body].linvel()),
            None => Vec3::default(),
        }
    }
}

/// The API as Lua globals: each function borrows the shared state for the length of the call.
fn register_api(lua: &Lua, state: Rc<RefCell<SimState>>) -> mlua::Result<()> {
    let g = lua.globals();
    for &(name, f) in api::api() {
        let state = state.clone();
        g.set(
            name,
            lua.create_function(move |lua, args: mlua::MultiValue| {
                let a: Vec<Arg> = args
                    .iter()
                    .map(|v| match v {
                        Value::Nil => Arg::Nil,
                        Value::Boolean(b) => Arg::Bool(*b),
                        Value::Integer(_) | Value::Number(_) => Arg::Num(js_to_number(v)),
                        Value::String(s) => Arg::Str(s.to_string_lossy().to_string()),
                        _ => Arg::Other,
                    })
                    .collect();
                let r = f(&mut state.borrow_mut(), &a);
                Ok(match r {
                    Ret::Num(x) => crate::scripting::lua::js_number(x),
                    Ret::Str(s) => Value::String(lua.create_string(&s)?),
                })
            })?,
        )?;
    }
    Ok(())
}
