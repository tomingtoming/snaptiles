//! The model's Lua section (port of `src/scripting/lua.ts`): Lua 5.4 with the safe libraries only (base, table,
//! string, utf8, math), the Lua 5.0 `COMPAT` names, `print`/`out`, an instruction budget per call, `OnFrame` (or
//! `main`) per frame, and error lines mapped to file lines.
//!
//! Values cross the boundary the way wasmoon carries them: a number the TypeScript would hand over is pushed as a
//! Lua integer when it is integral (`Number.isInteger`), else as a float, and every Lua number reads back as `f64`.

use crate::js;
use mlua::debug::DebugEvent;
use mlua::{HookTriggers, Lua, LuaOptions, StdLib, Value, VmState};
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
    /// file lines of the page's breakpoints, and the snapshot taken at the first one hit in the current call
    pub breakpoints: Rc<RefCell<Vec<i64>>>,
    pub break_hit: Rc<RefCell<Option<String>>>,
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
        match self.frame_fn {
            None => self.error.is_none(),
            Some(f) => self.call(f),
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
        let remaining = Cell::new(self.max_instructions_per_call.max(1) as i64);
        let breakpoints = self.breakpoints.borrow().clone();
        let mut triggers = HookTriggers::new().every_nth_instruction(QUANTUM);
        if !breakpoints.is_empty() {
            triggers = triggers.every_line();
        }
        let (hit, line_offset) = (self.break_hit.clone(), self.line_offset);
        let _ = lua.set_hook(triggers, move |lua, debug| {
            if debug.event() == DebugEvent::Line {
                if hit.borrow().is_none() && debug.source().source.as_deref().is_some_and(|s| s.contains("model")) {
                    if let Some(line) = debug.current_line().map(|l| l as i64 + line_offset).filter(|l| breakpoints.contains(l)) {
                        *hit.borrow_mut() = Some(break_snapshot(lua, line));
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
        });
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
