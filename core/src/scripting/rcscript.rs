//! Legacy `Script{}` language (port of `src/scripting/rcscript.ts`, docs/spec/lua-api.md §4), executed top to
//! bottom once per frame.
//!
//! ```text
//!   var = expr
//!   if cond { ... }          (no nesting; leaving the block leaves all)
//!   label name / goto name   (a trailing colon is tolerated: `goto A:`)
//!   print row, item, ...
//! ```
//!
//! Statements are separated by newlines OR just by starting a new statement — community files write
//! `if F_B=1 {Z_A=90 DUMMY=_BYE(zenmai) goto B:}` on one line. Expressions: numbers, variables (Val or frame-local),
//! `_FUNC(args)`, `+ - * / %`, comparisons (`= == != <> < > <= >=`) → 1/0, `& | and or`, unary minus, parentheses.
//! The source is walked in UTF-16 code units like the TypeScript.

use crate::js;
use crate::rc::expr::{is_js_space, js_number, parse_hex};
use std::collections::HashMap;

const MAX_STEPS: usize = 20000;

/// What a running Script sees of the simulation: Val values and the script API.
pub trait ScriptHost {
    /// a Val's value (`None`: not a Val, the name is frame-local)
    fn val(&self, name: &str) -> Option<f64>;
    /// set a Val (marks it touched); false when there is no such Val
    fn set_val(&mut self, name: &str, value: f64) -> bool;
    /// call an API function; `None` when the API has no such name. A non-numeric result reads 0.
    fn call(&mut self, name: &str, args: &[f64]) -> Option<f64>;
}

#[derive(Clone, Debug, PartialEq)]
enum TokKind {
    Num,
    Id,
    Op,
    Str,
}

#[derive(Clone, Debug)]
struct Tok {
    t: TokKind,
    v: String,
}

#[derive(Clone, Debug)]
enum Expr {
    Num(f64),
    Str(String),
    Var(String),
    Call(String, Vec<Expr>),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Bin(String, Box<Expr>, Box<Expr>),
}

#[derive(Clone, Debug)]
enum Stmt {
    Set(String, Expr),
    If(Expr, usize),
    EndIf,
    Goto(String),
    Label,
    Print(Expr, Vec<Expr>),
    Expr(Expr),
}

#[derive(Clone, Debug)]
enum V {
    N(f64),
    S(String),
}

fn num(v: &V) -> f64 {
    match v {
        V::N(x) => *x,
        V::S(s) => {
            let x = js_number(s);
            if x.is_nan() || x == 0.0 {
                0.0
            } else {
                x
            }
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct RcScript {
    stmts: Vec<Stmt>,
    labels: HashMap<String, usize>,
    pub out_lines: Vec<String>,
}

impl RcScript {
    /// Compile; the error messages are the TypeScript's.
    pub fn new(source: &str) -> Result<RcScript, String> {
        let mut s = RcScript::default();
        s.compile(source)?;
        Ok(s)
    }

    fn compile(&mut self, source: &str) -> Result<(), String> {
        let text = strip_line_comments(&source.replace("\r\n", "\n").replace('\r', "\n"));
        let toks = lex(&text);
        let mut if_stack: Vec<usize> = Vec::new();
        let mut i = 0usize;
        let is_op = |t: Option<&Tok>, v: &str| matches!(t, Some(t) if t.t == TokKind::Op && t.v == v);
        let is_start = |j: usize| -> bool {
            let Some(t) = toks.get(j) else { return true };
            if t.t == TokKind::Op && t.v == "}" {
                return true;
            }
            if t.t == TokKind::Id && is_keyword(&t.v) {
                return true;
            }
            t.t == TokKind::Id && is_op(toks.get(j + 1), "=")
        };
        // collect tokens until the next statement start (at paren depth 0)
        let until = |i: &mut usize| -> Vec<Tok> {
            let mut out = Vec::new();
            let mut depth = 0i32;
            while *i < toks.len() {
                let t = &toks[*i];
                if depth == 0 && is_start(*i) {
                    break;
                }
                if t.t == TokKind::Op && t.v == "(" {
                    depth += 1;
                }
                if t.t == TokKind::Op && t.v == ")" {
                    depth -= 1;
                }
                out.push(t.clone());
                *i += 1;
            }
            out
        };
        while i < toks.len() {
            let t = &toks[i];
            if t.t == TokKind::Op && t.v == "}" {
                let Some(idx) = if_stack.pop() else { return Err("unmatched }".into()) };
                let end = self.stmts.len() + 1;
                if let Stmt::If(_, e) = &mut self.stmts[idx] {
                    *e = end;
                }
                self.stmts.push(Stmt::EndIf);
                i += 1;
                continue;
            }
            if t.t == TokKind::Op && t.v == "{" {
                i += 1;
                continue;
            }
            let word = if t.t == TokKind::Id { t.v.to_lowercase() } else { String::new() };
            if word == "if" {
                i += 1;
                let mut cond = Vec::new();
                while i < toks.len() && !(toks[i].t == TokKind::Op && toks[i].v == "{") {
                    cond.push(toks[i].clone());
                    i += 1;
                }
                i += 1; // '{'
                if_stack.push(self.stmts.len());
                self.stmts.push(Stmt::If(parse_tokens(&cond), usize::MAX));
                continue;
            }
            if word == "label" || word == "goto" {
                i += 1;
                let name = match toks.get(i) {
                    Some(t) if t.t == TokKind::Id => {
                        i += 1;
                        t.v.to_uppercase()
                    }
                    _ => String::new(),
                };
                if is_op(toks.get(i), ":") {
                    i += 1;
                }
                if name.is_empty() {
                    return Err(format!("{word} without a name"));
                }
                if word == "label" {
                    self.labels.insert(name, self.stmts.len());
                    self.stmts.push(Stmt::Label);
                } else {
                    self.stmts.push(Stmt::Goto(name));
                }
                continue;
            }
            if word == "print" {
                i += 1;
                let args = split_top(until(&mut i));
                let row = parse_tokens(args.first().map(|v| v.as_slice()).unwrap_or(&[]));
                let items = args.iter().skip(1).map(|a| parse_tokens(a)).collect();
                self.stmts.push(Stmt::Print(row, items));
                continue;
            }
            if t.t == TokKind::Id && is_op(toks.get(i + 1), "=") {
                let name = t.v.to_uppercase();
                i += 2;
                let expr = until(&mut i);
                self.stmts.push(Stmt::Set(name, parse_tokens(&expr)));
                continue;
            }
            // anything else: a bare expression statement
            let expr = until(&mut i);
            if expr.is_empty() {
                i += 1;
                continue;
            }
            self.stmts.push(Stmt::Expr(parse_tokens(&expr)));
        }
        if !if_stack.is_empty() {
            return Err("unclosed if block".into());
        }
        Ok(())
    }

    /// One frame. Undeclared variables are frame-local; an error stops the script (as the TypeScript throws).
    pub fn run(&mut self, host: &mut dyn ScriptHost) -> Result<(), String> {
        let mut locals: HashMap<String, f64> = HashMap::new();
        let mut pc = 0usize;
        let mut steps = 0usize;
        while pc < self.stmts.len() {
            steps += 1;
            if steps > MAX_STEPS {
                return Err("script step budget exceeded".into());
            }
            match &self.stmts[pc] {
                Stmt::Set(name, e) => {
                    let v = num(&evaluate(e, host, &locals));
                    if !host.set_val(name, v) {
                        locals.insert(name.clone(), v);
                    }
                    pc += 1;
                }
                Stmt::If(c, end) => {
                    pc = if num(&evaluate(c, host, &locals)) != 0.0 { pc + 1 } else { *end };
                }
                Stmt::EndIf | Stmt::Label => pc += 1,
                Stmt::Goto(label) => match self.labels.get(label) {
                    Some(&t) => pc = t,
                    None => return Err(format!("unknown label {label}")),
                },
                Stmt::Print(row, items) => {
                    let r = num(&evaluate(row, host, &locals)).floor();
                    let r = if r.is_nan() { f64::NAN } else { r.clamp(0.0, 24.0) };
                    let text: String = items
                        .iter()
                        .map(|i| match evaluate(i, host, &locals) {
                            V::N(x) => js::print_number(x),
                            V::S(s) => s,
                        })
                        .collect();
                    if !r.is_nan() {
                        let r = r as usize;
                        while self.out_lines.len() <= r {
                            self.out_lines.push(String::new());
                        }
                        self.out_lines[r] = text;
                    }
                    pc += 1;
                }
                Stmt::Expr(e) => {
                    evaluate(e, host, &locals);
                    pc += 1;
                }
            }
        }
        Ok(())
    }
}

fn is_keyword(s: &str) -> bool {
    matches!(s.to_lowercase().as_str(), "if" | "goto" | "label" | "print")
}

/// `.replace(/\/\/[^\n]*/g, '')`
fn strip_line_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("//") {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        rest = match rest.find('\n') {
            Some(n) => &rest[n..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// split a token list on top-level commas
fn split_top(toks: Vec<Tok>) -> Vec<Vec<Tok>> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = Vec::new();
    for t in toks {
        if t.t == TokKind::Op && t.v == "(" {
            depth += 1;
        }
        if t.t == TokKind::Op && t.v == ")" {
            depth -= 1;
        }
        if t.t == TokKind::Op && t.v == "," && depth == 0 {
            out.push(std::mem::take(&mut cur));
            continue;
        }
        cur.push(t);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn unit(c: u16, f: fn(u8) -> bool) -> bool {
    c < 0x80 && f(c as u8)
}

fn lex(s: &str) -> Vec<Tok> {
    let u: Vec<u16> = s.encode_utf16().collect();
    let text = |a: usize, b: usize| String::from_utf16_lossy(&u[a..b.min(u.len())]);
    let mut toks = Vec::new();
    let mut i = 0;
    while i < u.len() {
        let c = u[i];
        if is_js_space(c) {
            i += 1;
            continue;
        }
        if c == b'"' as u16 {
            let mut j = i + 1;
            while j < u.len() && u[j] != b'"' as u16 {
                j += 1;
            }
            toks.push(Tok { t: TokKind::Str, v: text(i + 1, j) });
            i = j + 1;
            continue;
        }
        if c == b'#' as u16 {
            let mut j = i + 1;
            while j < u.len() && unit(u[j], |b| b.is_ascii_hexdigit()) {
                j += 1;
            }
            let digits = text(i + 1, j);
            let v = if digits.is_empty() { 0.0 } else { parse_hex(&digits) };
            toks.push(Tok { t: TokKind::Num, v: js::number_to_string(v) });
            i = j;
            continue;
        }
        if unit(c, |b| b.is_ascii_digit() || b == b'.') {
            let mut j = i;
            while j < u.len() && unit(u[j], |b| b.is_ascii_digit() || b == b'.' || b == b'e' || b == b'E') {
                j += 1;
            }
            toks.push(Tok { t: TokKind::Num, v: text(i, j) });
            i = j;
            continue;
        }
        if unit(c, |b| b.is_ascii_alphabetic() || b == b'_') {
            let mut j = i;
            while j < u.len() && unit(u[j], |b| b.is_ascii_alphanumeric() || b == b'_') {
                j += 1;
            }
            toks.push(Tok { t: TokKind::Id, v: text(i, j) });
            i = j;
            continue;
        }
        let two = text(i, i + 2);
        if ["==", "!=", "<>", "<=", ">="].contains(&two.as_str()) {
            toks.push(Tok { t: TokKind::Op, v: two });
            i += 2;
            continue;
        }
        toks.push(Tok { t: TokKind::Op, v: text(i, i + 1) });
        i += 1;
    }
    toks
}

struct P<'a> {
    toks: &'a [Tok],
    i: usize,
}

impl P<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.i)
    }
    fn take(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.i).cloned();
        self.i += 1;
        t
    }
    fn is_op(&self, v: &str) -> bool {
        matches!(self.peek(), Some(t) if t.t == TokKind::Op && t.v == v)
    }
    fn is_word(&self, v: &str) -> bool {
        matches!(self.peek(), Some(t) if t.t == TokKind::Id && t.v.to_lowercase() == v)
    }
    fn primary(&mut self) -> Expr {
        let Some(t) = self.take() else { return Expr::Num(0.0) };
        match t.t {
            TokKind::Num => {
                let v = js_number(&t.v);
                Expr::Num(if v.is_nan() { 0.0 } else { v })
            }
            TokKind::Str => Expr::Str(t.v),
            TokKind::Id => {
                if self.is_op("(") {
                    self.take();
                    let mut args = Vec::new();
                    while self.peek().is_some() && !self.is_op(")") {
                        args.push(self.or());
                        if self.is_op(",") {
                            self.take();
                        } else {
                            break;
                        }
                    }
                    if self.is_op(")") {
                        self.take();
                    }
                    Expr::Call(t.v.to_uppercase(), args)
                } else {
                    Expr::Var(t.v.to_uppercase())
                }
            }
            TokKind::Op => match t.v.as_str() {
                "(" => {
                    let e = self.or();
                    if self.is_op(")") {
                        self.take();
                    }
                    e
                }
                "-" => Expr::Neg(Box::new(self.unary())),
                "!" => Expr::Not(Box::new(self.unary())),
                _ => Expr::Num(0.0),
            },
        }
    }
    fn unary(&mut self) -> Expr {
        if self.is_op("-") {
            self.take();
            return Expr::Neg(Box::new(self.unary()));
        }
        if self.is_op("!") || self.is_word("not") {
            self.take();
            return Expr::Not(Box::new(self.unary()));
        }
        self.primary()
    }
    fn bin_loop(&mut self, ops: &[&str], next: fn(&mut Self) -> Expr) -> Expr {
        let mut a = next(self);
        while ops.iter().any(|o| self.is_op(o)) {
            let op = self.take().unwrap().v;
            let b = next(self);
            a = Expr::Bin(op, Box::new(a), Box::new(b));
        }
        a
    }
    fn mul(&mut self) -> Expr {
        self.bin_loop(&["*", "/", "%"], Self::unary)
    }
    fn add(&mut self) -> Expr {
        self.bin_loop(&["+", "-"], Self::mul)
    }
    fn cmp(&mut self) -> Expr {
        self.bin_loop(&["<", ">", "<=", ">=", "=", "==", "!=", "<>"], Self::add)
    }
    fn and(&mut self) -> Expr {
        let mut a = self.cmp();
        while self.is_op("&") || self.is_word("and") {
            self.take();
            let b = self.cmp();
            a = Expr::Bin("&".into(), Box::new(a), Box::new(b));
        }
        a
    }
    fn or(&mut self) -> Expr {
        let mut a = self.and();
        while self.is_op("|") || self.is_word("or") {
            self.take();
            let b = self.and();
            a = Expr::Bin("|".into(), Box::new(a), Box::new(b));
        }
        a
    }
}

fn parse_tokens(toks: &[Tok]) -> Expr {
    P { toks, i: 0 }.or()
}

/// the Script's own math functions (the API takes precedence)
fn math(name: &str, a: &[f64]) -> Option<f64> {
    let x = |i: usize| a.get(i).copied().unwrap_or(f64::NAN);
    Some(match name {
        "_ABS" => x(0).abs(),
        "_SQRT" => x(0).sqrt(),
        "_SIN" => x(0).sin(),
        "_COS" => x(0).cos(),
        "_TAN" => x(0).tan(),
        "_ASIN" => x(0).asin(),
        "_ACOS" => x(0).acos(),
        "_ATAN" => x(0).atan(),
        "_ATAN2" => x(0).atan2(x(1)),
        "_SGN" => crate::physics::math::js_sign(x(0)),
        "_POW" => js_pow(x(0), x(1)),
        "_EXP" => x(0).exp(),
        "_INT" | "_FIX" => x(0).trunc(),
        "_ROUND" => {
            let v = x(0);
            if v < 0.0 {
                -js::round(-v)
            } else {
                js::round(v)
            }
        }
        "_FLOOR" => x(0).floor(),
        "_CEIL" => x(0).ceil(),
        "_LOG" => x(0).ln(),
        "_LOG10" => x(0).log10(),
        "_LEN2" => js_hypot(&[x(0), x(1)]),
        "_LEN3" => js_hypot(&[x(0), x(1), x(2)]),
        "_PI" => std::f64::consts::PI,
        "_TODEG" => (x(0) * 180.0) / std::f64::consts::PI,
        "_TORAD" => (x(0) * std::f64::consts::PI) / 180.0,
        "_RND" => crate::sim::random(),
        "_MOD" => {
            if x(1) == 0.0 {
                0.0
            } else {
                x(0) % x(1)
            }
        }
        _ => return None,
    })
}

/// `Math.pow` (1 ** NaN and (±1) ** ±∞ are NaN in JavaScript)
fn js_pow(a: f64, b: f64) -> f64 {
    if b.is_nan() || (a.abs() == 1.0 && b.is_infinite()) {
        f64::NAN
    } else {
        a.powf(b)
    }
}

/// `Math.hypot`: ∞ wins over NaN
fn js_hypot(v: &[f64]) -> f64 {
    if v.iter().any(|x| x.is_infinite()) {
        return f64::INFINITY;
    }
    if v.iter().any(|x| x.is_nan()) {
        return f64::NAN;
    }
    v.iter().fold(0.0f64, |h, x| h.hypot(*x))
}

fn evaluate(e: &Expr, host: &mut dyn ScriptHost, locals: &HashMap<String, f64>) -> V {
    match e {
        Expr::Num(v) => V::N(*v),
        Expr::Str(s) => V::S(s.clone()),
        Expr::Var(name) => V::N(host.val(name).unwrap_or_else(|| locals.get(name).copied().unwrap_or(0.0))),
        Expr::Call(name, args) => {
            let a: Vec<f64> = args.iter().map(|x| num(&evaluate(x, host, locals))).collect();
            V::N(match host.call(name, &a) {
                Some(r) => r,
                None => math(name, &a).unwrap_or(0.0),
            })
        }
        Expr::Neg(a) => V::N(-num(&evaluate(a, host, locals))),
        Expr::Not(a) => V::N(if num(&evaluate(a, host, locals)) == 0.0 { 1.0 } else { 0.0 }),
        Expr::Bin(op, a, b) => {
            let a = num(&evaluate(a, host, locals));
            let b = num(&evaluate(b, host, locals));
            let t = |c: bool| if c { 1.0 } else { 0.0 };
            V::N(match op.as_str() {
                "+" => a + b,
                "-" => a - b,
                "*" => a * b,
                "/" => {
                    if b == 0.0 {
                        0.0
                    } else {
                        a / b
                    }
                }
                "%" => {
                    if b == 0.0 {
                        0.0
                    } else {
                        a % b
                    }
                }
                "<" => t(a < b),
                ">" => t(a > b),
                "<=" => t(a <= b),
                ">=" => t(a >= b),
                "=" | "==" => t(a == b),
                "!=" | "<>" => t(a != b),
                "&" => t(a != 0.0 && b != 0.0),
                "|" => t(a != 0.0 || b != 0.0),
                _ => 0.0,
            })
        }
    }
}
