//! The model's Lua section (port of `src/scripting/lua.ts`): Lua 5.4 with the safe libraries only (base, table,
//! string, utf8, math), the Lua 5.0 `COMPAT` names, `print`/`out`, an instruction budget per call, `OnFrame` (or
//! `main`) per frame, and error lines mapped to file lines.
//!
//! Values cross the boundary the way wasmoon carries them: a number the TypeScript would hand over is pushed as a
//! Lua integer when it is integral (`Number.isInteger`), else as a float, and every Lua number reads back as `f64`.

use crate::js;
use mlua::debug::DebugEvent;
use mlua::{HookTriggers, Lua, LuaOptions, StdLib, Value, VmState};
use mlua::debug::Debug;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// Lua 5.0-era names that community scripts rely on, mapped onto 5.4 (same text as `src/scripting/lua.ts`).
pub const COMPAT: &str = r#"
math.mod = math.fmod
math.pow = function(a, b) return a ^ b end
math.atan2 = function(y, x) return math.atan(y, x) end
math.log10 = function(x) return math.log(x, 10) end
math.ldexp = function(m, e) return m * 2 ^ e end
math.frexp = function(x)
  if x == 0 then return 0, 0 end
  local e = math.floor(math.log(math.abs(x), 2)) + 1
  return x / 2 ^ e, e
end
math.cosh = function(x) return (math.exp(x) + math.exp(-x)) / 2 end
math.sinh = function(x) return (math.exp(x) - math.exp(-x)) / 2 end
math.tanh = function(x) local a, b = math.exp(x), math.exp(-x) return (a - b) / (a + b) end
string.gfind = string.gmatch
table.getn = function(t) return #t end
table.setn = function() end
unpack = table.unpack
loadstring = load
-- Lua 5.0 accepted %d with any number; 5.4 insists on an integer representation
do
  local fmt = string.format
  string.format = function(f, ...)
    local ok, r = pcall(fmt, f, ...)
    if ok then return r end
    local n = select('#', ...)
    local args = { ... }
    for i = 1, n do
      if type(args[i]) == 'number' then args[i] = math.floor(args[i] + 0.5) end
    end
    return fmt(f, table.unpack(args, 1, n))
  end
end
dofile = nil; loadfile = nil; require = nil; collectgarbage = nil
"#;

/// Instructions allowed per call (`maxInstructionsPerCall` in the TypeScript) and the hook quantum.
pub const MAX_INSTRUCTIONS_PER_CALL: u32 = 500_000;
const QUANTUM: u32 = 1000;
/// `out` rows 0..=24
pub const OUT_ROWS: usize = 25;

/// A number as wasmoon pushes it.
pub fn js_number(x: f64) -> Value {
    match js::lua_integer(x) {
        Some(i) => Value::Integer(i),
        None => Value::Number(x),
    }
}

/// `String(v)` of the JavaScript value wasmoon makes of a Lua value.
pub fn js_string(lua: &Lua, v: &Value) -> String {
    match v {
        Value::Nil => "undefined".into(),
        Value::Boolean(b) => b.to_string(),
        Value::Integer(i) => js::number_to_string(*i as f64),
        Value::Number(x) => js::number_to_string(*x),
        Value::String(s) => s.to_string_lossy().to_string(),
        Value::Table(_) => "[object Object]".into(),
        other => lua.coerce_string(other.clone()).ok().flatten().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| other.type_name().to_string()),
    }
}

/// `Number(v)` of the JavaScript value wasmoon makes of a Lua value (NaN where JavaScript gives NaN).
pub fn js_to_number(v: &Value) -> f64 {
    match v {
        Value::Integer(i) => *i as f64,
        Value::Number(x) => *x,
        Value::Boolean(b) => f64::from(u8::from(*b)),
        Value::String(s) => crate::rc::expr::js_number(&s.to_string_lossy()),
        _ => f64::NAN,
    }
}

/// The message of a Lua error without mlua's traceback (the TypeScript's `lua_pcallk` has no message handler).
pub fn error_message(e: &mlua::Error) -> String {
    let s = match e {
        mlua::Error::RuntimeError(s) | mlua::Error::MemoryError(s) => s.clone(),
        mlua::Error::SyntaxError { message, .. } => message.clone(),
        mlua::Error::CallbackError { cause, .. } => return error_message(cause),
        mlua::Error::WithContext { cause, .. } => return error_message(cause),
        other => other.to_string(),
    };
    match s.find("\nstack traceback:") {
        Some(i) => s[..i].to_string(),
        None => s,
    }
}

/// `[string "..."]:12:` → `line 57:` (file line), given the line before the Lua block's first line.
pub fn file_line(message: &str, line_offset: i64) -> String {
    let mut out = String::new();
    let mut rest = message;
    while let Some(i) = rest.find("[string \"") {
        out.push_str(&rest[..i]);
        let tail = &rest[i + "[string \"".len()..];
        let mapped = tail.find("\"]:").and_then(|q| {
            let name = &tail[..q];
            if name.contains('"') {
                return None;
            }
            let after = &tail[q + 3..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() || !after[digits.len()..].starts_with(':') {
                return None;
            }
            let n: i64 = digits.parse().ok()?;
            Some((n, q + 3 + digits.len() + 1))
        });
        match mapped {
            Some((n, used)) => {
                out.push_str(&format!("line {}:", n + line_offset));
                rest = &tail[used..];
            }
            None => {
                out.push_str("[string \"");
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text `print`/`out` show: numbers like JavaScript prints them, items joined by spaces, a trailing `&` (the
/// original's fixed-width request) dropped.
pub fn print_text(lua: &Lua, args: &[Value]) -> String {
    let text = args
        .iter()
        .map(|a| match a {
            Value::Integer(i) => js::print_number(*i as f64),
            Value::Number(x) => js::print_number(*x),
            other => js_string(lua, other),
        })
        .collect::<Vec<_>>()
        .join(" ");
    // .replace(/&\s*$/, '')
    let trimmed = text.trim_end_matches(|c: char| c.is_whitespace());
    if trimmed.ends_with('&') {
        trimmed[..trimmed.len() - 1].to_string()
    } else {
        text
    }
}

/// Runs the model's Lua block: OnInit / OnReset / OnFrame (or main) with an instruction budget per call.
pub struct LuaEngine {
    lua: Option<Lua>,
    pub error: Option<String>,
    out: Rc<RefCell<Vec<String>>>,
    frame_fn: Option<&'static str>,
    /// line before the Lua block's first line: error lines are reported relative to the file
    pub line_offset: i64,
    pub max_instructions_per_call: u32,
    /// globals that exist before the model's chunk runs (API, libraries, COMPAT): hidden from [`LuaEngine::watch`]
    baseline: Vec<String>,
    /// the page's breakpoints, and the snapshot taken at the first one hit in the current call
    pub breakpoints: Rc<RefCell<Vec<Breakpoint>>>,
    pub break_hit: Rc<RefCell<Option<String>>>,
    /// the model's globals right after its chunk ran (before OnInit): a reload keeps a global's running value unless
    /// the new chunk starts it differently
    initial: Vec<(String, Plain)>,
    /// the frame function suspended at a breakpoint (or a line step): the next [`LuaEngine::frame_step`] resumes it
    frame_thread: Option<mlua::Thread>,
    /// stop at the next line the model runs (the page's line step)
    pub step_line: Rc<Cell<bool>>,
}

/// How a frame's script call ended: finished (false: the script errored and is now disabled), or suspended mid-frame
/// at a breakpoint or a line step.
#[derive(Debug, PartialEq, Eq)]
pub enum FrameOutcome {
    Done(bool),
    Paused,
}

impl Default for LuaEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl LuaEngine {
    pub fn new() -> Self {
        LuaEngine {
            lua: None,
            error: None,
            out: Rc::new(RefCell::new(Vec::new())),
            frame_fn: None,
            line_offset: 0,
            max_instructions_per_call: MAX_INSTRUCTIONS_PER_CALL,
            baseline: Vec::new(),
            breakpoints: Rc::new(RefCell::new(Vec::new())),
            break_hit: Rc::new(RefCell::new(None)),
            initial: Vec::new(),
            frame_thread: None,
            step_line: Rc::new(Cell::new(false)),
        }
    }

    pub fn lua(&self) -> Option<&Lua> {
        self.lua.as_ref()
    }

    /// `out()` rows written so far
    pub fn out_lines(&self) -> Vec<String> {
        self.out.borrow().clone()
    }

    /// Load `source`: the safe libraries, the API (`register`), `print`/`out`, COMPAT, `prelude`, then the source
    /// under the budget. A failure is kept in `error` (with file lines).
    pub fn load(&mut self, source: &str, register: impl FnOnce(&Lua) -> mlua::Result<()>, prelude: &str, line_offset: i64) {
        self.line_offset = line_offset;
        self.dispose();
        // The debug library is loaded only to read a breakpoint's locals: its getlocal/getinfo are kept in the registry
        // and the `debug` global is removed before any model code runs.
        // SAFETY: the debug library is never reachable from the model's code (removed from the globals below).
        let lua = unsafe { Lua::unsafe_new_with(StdLib::TABLE | StdLib::STRING | StdLib::UTF8 | StdLib::MATH | StdLib::DEBUG, LuaOptions::default()) };
        self.error = None;
        self.out.borrow_mut().clear();
        let setup = (|| -> mlua::Result<()> {
            let g = lua.globals();
            let debug: mlua::Table = g.get("debug")?;
            lua.set_named_registry_value("snaptiles_getlocal", debug.get::<mlua::Function>("getlocal")?)?;
            lua.set_named_registry_value("snaptiles_getinfo", debug.get::<mlua::Function>("getinfo")?)?;
            g.set("debug", Value::Nil)?;
            register(&lua)?;
            let out = self.out.clone();
            g.set("print", lua.create_function(move |lua, args: mlua::MultiValue| {
                let args: Vec<Value> = args.into_iter().collect();
                set_row(&out, 0.0, print_text(lua, &args));
                Ok(())
            })?)?;
            let out = self.out.clone();
            g.set("out", lua.create_function(move |lua, args: mlua::MultiValue| {
                let mut args: Vec<Value> = args.into_iter().collect();
                let row = if args.is_empty() { f64::NAN } else { js_to_number(&args.remove(0)) };
                set_row(&out, row, print_text(lua, &args));
                Ok(())
            })?)?;
            Ok(())
        })();
        if let Err(e) = setup {
            self.error = Some(error_message(&e));
            return;
        }
        let result = (|| -> mlua::Result<()> {
            lua.load(COMPAT).set_name("compat").exec()?;
            // Lua 5.4 seeds math.random from the clock: a fixed seed keeps runs (and replays) identical
            lua.load("math.randomseed(24301)").set_name("seed").exec()?;
            if !prelude.is_empty() {
                lua.load(prelude).set_name("prelude").exec()?;
            }
            self.baseline = lua
                .globals()
                .pairs::<Value, Value>()
                .filter_map(|kv| kv.ok())
                .filter_map(|(k, _)| match k {
                    Value::String(s) => Some(s.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect();
            self.arm_budget(&lua);
            // full-width spaces (U+3000) appear as indentation in Shift-JIS era scripts
            lua.load(source.replace('\u{3000}', " ")).set_name("model").exec()?;
            Ok(())
        })();
        lua.remove_hook();
        match result {
            Ok(()) => {
                self.initial = snapshot(&lua, &self.baseline);
                let g = lua.globals();
                let is_fn = |name: &str| matches!(g.get::<Value>(name), Ok(Value::Function(_)));
                self.frame_fn = if is_fn("OnFrame") {
                    Some("OnFrame")
                } else if is_fn("main") {
                    Some("main")
                } else {
                    None
                };
            }
            Err(e) => self.error = Some(file_line(&error_message(&e), self.line_offset)),
        }
        self.lua = Some(lua);
    }

    pub fn set_number(&self, name: &str, v: f64) {
        if let Some(lua) = &self.lua {
            let _ = lua.globals().set(name, js_number(v));
        }
    }

    pub fn get_number(&self, name: &str) -> Option<f64> {
        match self.lua.as_ref()?.globals().get::<Value>(name) {
            Ok(Value::Integer(i)) => Some(i as f64),
            Ok(Value::Number(x)) => Some(x),
            _ => None,
        }
    }

    /// Run the per-frame function. Returns false if the script errored (and is now disabled).
    pub fn frame(&mut self) -> bool {
        match self.frame_step() {
            FrameOutcome::Done(ok) => ok,
            FrameOutcome::Paused => true,
        }
    }

    /// true while a frame function is suspended mid-frame
    pub fn suspended(&self) -> bool {
        self.frame_thread.is_some()
    }

    /// Run (or resume) the per-frame function. With breakpoints or a line step pending it runs as a coroutine that a
    /// stop suspends right at that line ([`FrameOutcome::Paused`]); the next call resumes it where it stopped, so the
    /// frame computes exactly what an uninterrupted call would. Without them it is a plain call.
    pub fn frame_step(&mut self) -> FrameOutcome {
        if let Some(th) = self.frame_thread.take() {
            return self.resume_frame(th);
        }
        let Some(name) = self.frame_fn else { return FrameOutcome::Done(self.error.is_none()) };
        if self.breakpoints.borrow().is_empty() && !self.step_line.get() {
            return FrameOutcome::Done(self.call(name));
        }
        if self.error.is_some() {
            return FrameOutcome::Done(false);
        }
        let Some(lua) = &self.lua else { return FrameOutcome::Done(false) };
        let func = match lua.globals().get::<Value>(name) {
            Ok(Value::Function(f)) => f,
            _ => return FrameOutcome::Done(true),
        };
        let th = match lua.create_thread(func) {
            Ok(t) => t,
            Err(e) => {
                self.error = Some(error_message(&e));
                return FrameOutcome::Done(false);
            }
        };
        let (triggers, hook) = self.hook();
        if let Err(e) = th.set_hook(triggers, hook) {
            self.error = Some(error_message(&e));
            return FrameOutcome::Done(false);
        }
        self.resume_frame(th)
    }

    fn resume_frame(&mut self, th: mlua::Thread) -> FrameOutcome {
        let name = self.frame_fn.unwrap_or("OnFrame");
        match th.resume::<()>(()) {
            Err(e) => {
                self.error = Some(file_line(&format!("{name}: {}", error_message(&e)), self.line_offset));
                FrameOutcome::Done(false)
            }
            Ok(()) if th.status() == mlua::thread::ThreadStatus::Resumable => {
                self.frame_thread = Some(th);
                FrameOutcome::Paused
            }
            Ok(()) => FrameOutcome::Done(true),
        }
    }

    /// Call a global function if it exists (true when absent).
    pub fn call(&mut self, name: &str) -> bool {
        let Some(lua) = &self.lua else { return false };
        if self.error.is_some() {
            return false;
        }
        let f = match lua.globals().get::<Value>(name) {
            Ok(Value::Function(f)) => f,
            _ => return true,
        };
        self.arm_budget(lua);
        let r = f.call::<()>(());
        lua.remove_hook();
        match r {
            Ok(()) => true,
            Err(e) => {
                self.error = Some(file_line(&format!("{name}: {}", error_message(&e)), self.line_offset));
                false
            }
        }
    }

    fn arm_budget(&self, lua: &Lua) {
        let (triggers, hook) = self.hook();
        let _ = lua.set_hook(triggers, hook);
    }

    /// The hook: the instruction budget, and (with breakpoints or a line step pending) every model line. A stop records
    /// the snapshot and asks to yield, which suspends a frame coroutine there; outside one (OnInit, OnReset, a plain
    /// call) mlua cannot yield and the call simply goes on.
    fn hook(&self) -> (HookTriggers, impl Fn(&Lua, &Debug) -> mlua::Result<VmState> + 'static) {
        let remaining = Cell::new(self.max_instructions_per_call.max(1) as i64);
        let breakpoints = self.breakpoints.clone();
        let step_line = self.step_line.clone();
        let mut triggers = HookTriggers::new().every_nth_instruction(QUANTUM);
        if !breakpoints.borrow().is_empty() || step_line.get() {
            triggers = triggers.every_line();
        }
        let (hit, line_offset) = (self.break_hit.clone(), self.line_offset);
        let hook = move |lua: &Lua, debug: &Debug| {
            if debug.event() == DebugEvent::Line {
                if hit.borrow().is_none() && debug.source().source.as_deref().is_some_and(|s| s.contains("model")) {
                    if let Some(line) = debug.current_line().map(|l| l as i64 + line_offset) {
                        if step_line.get() {
                            step_line.set(false);
                            *hit.borrow_mut() = Some(break_snapshot(lua, line));
                            return Ok(VmState::Yield);
                        }
                        let mut bps = breakpoints.borrow_mut();
                        if let Some(bp) = bps.iter_mut().find(|b| b.line == line) {
                            // the hit count counts every pass; the condition is asked only from the `after`-th pass on
                            bp.hits += 1;
                            let stop = bp.hits >= bp.after.max(1) && bp.condition.as_deref().is_none_or(|c| condition_holds(lua, c));
                            if stop {
                                *hit.borrow_mut() = Some(break_snapshot(lua, line));
                                return Ok(VmState::Yield);
                            }
                        }
                    }
                }
                return Ok(VmState::Continue);
            }
            remaining.set(remaining.get() - QUANTUM as i64);
            if remaining.get() <= 0 {
                Err(mlua::Error::runtime("instruction budget exceeded"))
            } else {
                Ok(VmState::Continue)
            }
        };
        (triggers, hook)
    }

    /// Replace the running Lua block with `source` (the page's edit while running): the new chunk runs (OnInit does not);
    /// then each global gets its running value back unless the new chunk starts it differently from the old one (a
    /// counter keeps counting, an edited constant takes the new value). Breakpoints stay. Err: the new block's error.
    pub fn reload(&mut self, source: &str, register: impl FnOnce(&Lua) -> mlua::Result<()>, prelude: &str, line_offset: i64) -> Result<(), String> {
        let (old_initial, running) = match &self.lua {
            Some(lua) => (self.initial.clone(), snapshot(lua, &self.baseline)),
            None => (Vec::new(), Vec::new()),
        };
        self.load(source, register, prelude, line_offset);
        if let Some(e) = &self.error {
            return Err(e.clone());
        }
        let Some(lua) = &self.lua else { return Ok(()) };
        let g = lua.globals();
        let find = |v: &[(String, Plain)], n: &str| v.iter().find(|(k, _)| k == n).map(|(_, p)| p.clone());
        for (name, value) in running {
            let keep = match (find(&old_initial, &name), find(&self.initial, &name)) {
                (_, None) => true,
                (old, Some(new)) => old.as_ref() == Some(&new),
            };
            if keep {
                if let Ok(v) = plain_to_lua(lua, &value) {
                    let _ = g.set(name.as_str(), v);
                }
            }
        }
        Ok(())
    }

    /// Evaluate `code` in the running block (the page's console): an expression's values, else a statement's "ok".
    /// An error does not disable the script.
    pub fn eval(&mut self, code: &str) -> Result<String, String> {
        let Some(lua) = &self.lua else { return Err("Luaがありません".into()) };
        self.arm_budget(lua);
        let r = (|| -> mlua::Result<String> {
            match lua.load(format!("return {code}")).set_name("console").into_function() {
                Ok(f) => {
                    let vals: mlua::MultiValue = f.call(())?;
                    let vs: Vec<Value> = vals.into_iter().collect();
                    Ok(if vs.is_empty() { "nil".into() } else { vs.iter().map(|v| watch_value(lua, v, 1)).collect::<Vec<_>>().join(", ") })
                }
                Err(_) => {
                    lua.load(code).set_name("console").exec()?;
                    Ok("ok".into())
                }
            }
        })();
        lua.remove_hook();
        r.map_err(|e| error_message(&e))
    }

    /// the model's own globals (not functions) and their values, sorted by name, for the page's watch list
    pub fn watch(&self) -> Vec<(String, String)> {
        let Some(lua) = &self.lua else { return Vec::new() };
        let mut out: Vec<(String, String)> = lua
            .globals()
            .pairs::<Value, Value>()
            .filter_map(|kv| kv.ok())
            .filter_map(|(k, v)| match (k, &v) {
                (_, Value::Function(_) | Value::Nil | Value::Thread(_) | Value::UserData(_) | Value::LightUserData(_)) => None,
                (Value::String(s), _) => {
                    let name = s.to_string_lossy().to_string();
                    (!self.baseline.contains(&name)).then(|| (name, watch_value(lua, &v, 1)))
                }
                _ => None,
            })
            .collect();
        out.sort();
        out
    }

    pub fn dispose(&mut self) {
        self.frame_thread = None;
        if let Some(lua) = self.lua.take() {
            lua.remove_hook();
        }
        self.frame_fn = None;
    }
}

/// `Math.max(0, Math.min(24, Math.floor(row)))`; a NaN row (nil, a non-numeric string) shows nowhere.
fn set_row(out: &RefCell<Vec<String>>, row: f64, text: String) {
    let r = js_max(0.0, js_min(24.0, row.floor()));
    if r.is_nan() {
        return;
    }
    let r = r as usize;
    let mut o = out.borrow_mut();
    while o.len() <= r {
        o.push(String::new());
    }
    o[r] = text;
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

/// A value as the watch list and breakpoint snapshots show it: numbers like JavaScript prints them, strings quoted,
/// tables one level deep (at most 8 entries).
pub fn watch_value(lua: &Lua, v: &Value, depth: u32) -> String {
    match v {
        Value::String(s) => format!("{:?}", s.to_string_lossy()),
        Value::Table(t) if depth > 0 => {
            let mut items = Vec::new();
            let mut n = 0;
            for (k, x) in t.clone().pairs::<Value, Value>().filter_map(|kv| kv.ok()) {
                n += 1;
                if items.len() < 8 {
                    let key = match &k {
                        Value::Integer(_) | Value::Number(_) => format!("[{}]", watch_value(lua, &k, 0)),
                        _ => js_string(lua, &k),
                    };
                    items.push(format!("{key}={}", watch_value(lua, &x, depth - 1)));
                }
            }
            if n > items.len() {
                items.push(format!("\u{2026} {n}"));
            }
            format!("{{{}}}", items.join(", "))
        }
        Value::Table(_) => "{\u{2026}}".into(),
        Value::Function(_) => "function".into(),
        Value::Integer(i) => js::print_number(*i as f64),
        Value::Number(x) => js::print_number(*x),
        other => js_string(lua, other),
    }
}

/// The locals of the model function running at a breakpoint (read with the registry's `debug.getlocal`), as
/// `line US name RS value US name RS value ...` (US = U+001F, RS = U+001E); the page adds the globals from
/// [`LuaEngine::watch`].
fn break_snapshot(lua: &Lua, line: i64) -> String {
    let mut parts = vec![line.to_string()];
    let (Ok(getlocal), Ok(getinfo)) =
        (lua.named_registry_value::<mlua::Function>("snaptiles_getlocal"), lua.named_registry_value::<mlua::Function>("snaptiles_getinfo"))
    else {
        return parts.join("\u{1f}");
    };
    // the hooked function's stack level as seen from a call made inside the hook: the first that runs model code
    let level = (1..8).find(|&l| {
        matches!(getinfo.call::<Value>((l, "S")), Ok(Value::Table(t)) if t.get::<String>("source").is_ok_and(|s| s.contains("model")))
    });
    if let Some(level) = level {
        for i in 1..200 {
            match getlocal.call::<(Value, Value)>((level, i)) {
                Ok((Value::String(name), v)) => {
                    let name = name.to_string_lossy().to_string();
                    if !name.starts_with('(') && !matches!(v, Value::Function(_)) {
                        parts.push(format!("{name}\u{1e}{}", watch_value(lua, &v, 1)));
                    }
                }
                _ => break,
            }
        }
    }
    parts.join("\u{1f}")
}

/// Compile (never run) a Lua block: its syntax error with the file line (`line_offset` as for [`LuaEngine::load`]), or
/// None. For the editor's check while typing.
pub fn check_syntax(source: &str, line_offset: i64) -> Option<String> {
    let lua = Lua::new_with(StdLib::NONE, LuaOptions::default()).ok()?;
    match lua.load(source.replace('\u{3000}', " ")).set_name("model").into_function() {
        Ok(_) => None,
        Err(e) => Some(file_line(&error_message(&e), line_offset)),
    }
}

/// A Lua value without identity (a reload copies running globals into a new state): tables deep-copied, at most 8
/// levels; functions and other references are not kept.
#[derive(Clone, Debug, PartialEq)]
enum Plain {
    Bool(bool),
    Int(i64),
    Num(f64),
    Str(Vec<u8>),
    Table(Vec<(Plain, Plain)>),
}

fn to_plain(v: &Value, depth: u32) -> Option<Plain> {
    match v {
        Value::Boolean(b) => Some(Plain::Bool(*b)),
        Value::Integer(i) => Some(Plain::Int(*i)),
        Value::Number(x) => Some(Plain::Num(*x)),
        Value::String(s) => Some(Plain::Str(s.as_bytes().to_vec())),
        Value::Table(t) if depth < 8 => Some(Plain::Table(
            t.clone().pairs::<Value, Value>().filter_map(|kv| kv.ok()).filter_map(|(k, x)| Some((to_plain(&k, depth + 1)?, to_plain(&x, depth + 1)?))).collect(),
        )),
        _ => None,
    }
}

fn plain_to_lua(lua: &Lua, p: &Plain) -> mlua::Result<Value> {
    Ok(match p {
        Plain::Bool(b) => Value::Boolean(*b),
        Plain::Int(i) => Value::Integer(*i),
        Plain::Num(x) => Value::Number(*x),
        Plain::Str(s) => Value::String(lua.create_string(s)?),
        Plain::Table(entries) => {
            let t = lua.create_table()?;
            for (k, v) in entries {
                t.raw_set(plain_to_lua(lua, k)?, plain_to_lua(lua, v)?)?;
            }
            Value::Table(t)
        }
    })
}

/// the model's own globals (not in `baseline`) that a reload can carry over
fn snapshot(lua: &Lua, baseline: &[String]) -> Vec<(String, Plain)> {
    lua.globals()
        .pairs::<Value, Value>()
        .filter_map(|kv| kv.ok())
        .filter_map(|(k, v)| match k {
            Value::String(s) => {
                let name = s.to_string_lossy().to_string();
                if baseline.contains(&name) {
                    return None;
                }
                Some((name, to_plain(&v, 0)?))
            }
            _ => None,
        })
        .collect()
}

/// A breakpoint: its file line, an optional Lua condition (sees the line's locals and the globals) and the pass from
/// which it stops (1: every pass). `hits` counts the passes since the breakpoints were set.
#[derive(Clone, Debug, Default)]
pub struct Breakpoint {
    pub line: i64,
    pub condition: Option<String>,
    pub after: u32,
    pub hits: u32,
}

/// the model function at a hook's stack level, as seen from a call made inside the hook
fn model_level(getinfo: &mlua::Function) -> Option<i32> {
    (1..8).find(|&l| matches!(getinfo.call::<Value>((l, "S")), Ok(Value::Table(t)) if t.get::<String>("source").is_ok_and(|s| s.contains("model"))))
}

/// a breakpoint condition, in an environment of the line's locals over the globals; an error counts as false
fn condition_holds(lua: &Lua, condition: &str) -> bool {
    let run = || -> mlua::Result<bool> {
        let getlocal: mlua::Function = lua.named_registry_value("snaptiles_getlocal")?;
        let getinfo: mlua::Function = lua.named_registry_value("snaptiles_getinfo")?;
        let env = lua.create_table()?;
        if let Some(level) = model_level(&getinfo) {
            for i in 1..200 {
                match getlocal.call::<(Value, Value)>((level, i)) {
                    Ok((Value::String(name), v)) => {
                        if !name.to_string_lossy().starts_with('(') {
                            env.raw_set(name, v)?;
                        }
                    }
                    _ => break,
                }
            }
        }
        let meta = lua.create_table()?;
        meta.set("__index", lua.globals())?;
        env.set_metatable(Some(meta))?;
        let f = lua.load(format!("return {condition}")).set_name("condition").set_environment(env).into_function()?;
        // Lua truth: everything but nil and false
        Ok(!matches!(f.call::<Value>(())?, Value::Nil | Value::Boolean(false)))
    };
    run().unwrap_or(false)
}
