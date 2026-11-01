//! .rc model file parser (port of the runtime parts of `src/rc/parser.ts`; clean-room, grammar reconstructed from
//! public docs).
//!
//! ```text
//!   Val    { NAME(default=0, min=-30, max=30, step=5, disp=0) ... }
//!   Key    { 0:NAME(step=5), OTHER(step=-5)  1:... }
//!   Body   { Core(){ N:Chip(angle=HANDLE){ ... } } }
//!   Script { ...legacy RC script... }   Lua { ...lua... }   (Lua wins when both exist)
//! ```
//!
//! Attribute values are kept as expression strings and evaluated later against the Val table, so `angle=-HANDLE`
//! or `power=ENGINE*2` work. Like the TypeScript, the text is handled as UTF-16 code units. Source offsets used only
//! by the editor are not kept.

use super::expr::{is_hex, is_ident_char, is_ident_start, is_js_space, is_num_char, js_number, js_strip_spaces, js_trim, parse_hex};
use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub struct ValDecl {
    pub name: String,
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub disp: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KeyBinding {
    /// `Number(token)`: NaN for a malformed key number, as in the TypeScript
    pub key: f64,
    pub var: String,
    pub step: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dir {
    N,
    S,
    E,
    W,
}

impl Dir {
    pub fn as_str(self) -> &'static str {
        match self {
            Dir::N => "N",
            Dir::S => "S",
            Dir::E => "E",
            Dir::W => "W",
        }
    }
    fn parse(s: &str) -> Option<Dir> {
        match s {
            "N" => Some(Dir::N),
            "S" => Some(Dir::S),
            "E" => Some(Dir::E),
            "W" => Some(Dir::W),
            _ => None,
        }
    }
}

/// Attributes in source order (a JS object with non-numeric keys): a repeated key keeps its first position and
/// takes the last value.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Attrs(pub Vec<(String, String)>);

impl Attrs {
    pub fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
    fn set(&mut self, k: String, v: String) {
        match self.0.iter_mut().find(|(n, _)| *n == k) {
            Some(e) => e.1 = v,
            None => self.0.push((k, v)),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChipNode {
    /// Core, Chip, Frame, Rudder, RudderF, Trim, TrimF, Wheel, Jet, Weight, Cowl, Arm ...
    pub type_: String,
    pub dir: Option<Dir>,
    /// raw expressions
    pub attrs: Attrs,
    pub children: Vec<ChipNode>,
    pub line: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScriptLang {
    Lua,
    Rc,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Script {
    pub lang: ScriptLang,
    pub source: String,
    /// the section header's line
    pub line: usize,
    /// the line of its opening brace, where the script's own line 1 is
    pub first_line: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RcModel {
    pub warnings: Vec<String>,
    pub vals: Vec<ValDecl>,
    pub keys: Vec<KeyBinding>,
    /// every Core of every Body section (each its own vehicle / "bit")
    pub bodies: Vec<ChipNode>,
    pub script: Option<Script>,
}

impl RcModel {
    /// first Core (kept for convenience); all Cores are in `bodies`
    pub fn body(&self) -> Option<&ChipNode> {
        self.bodies.first()
    }
}

/// A parse error. `line` is `None` where the TypeScript fails with a TypeError (a `peek()!` on the end of a
/// section) instead of an `RcParseError`.
#[derive(Clone, Debug, PartialEq)]
pub struct RcParseError {
    pub message: String,
    pub line: Option<usize>,
}

impl RcParseError {
    fn new(message: String, line: usize) -> Self {
        RcParseError { message, line: Some(line) }
    }
    fn type_error() -> Self {
        RcParseError { message: "TypeError: unexpected end of section".into(), line: None }
    }
}

impl fmt::Display for RcParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.line {
            Some(l) => write!(f, "{} (line {})", self.message, l),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for RcParseError {}

type Result<T> = std::result::Result<T, RcParseError>;

const fn u(c: char) -> u16 {
    c as u16
}

fn starts_with(src: &[u16], i: usize, pat: &str) -> bool {
    let p: Vec<u16> = pat.encode_utf16().collect();
    src.len() >= i + p.len() && src[i..i + p.len()] == p[..]
}

fn index_of(src: &[u16], pat: &[u16], from: usize) -> Option<usize> {
    if pat.is_empty() || src.len() < pat.len() {
        return None;
    }
    (from..=src.len() - pat.len()).find(|&j| src[j..j + pat.len()] == *pat)
}

fn lines_before(src: &[u16], end: usize) -> usize {
    src[..end].iter().filter(|&&c| c == u('\n')).count() + 1
}

fn utf16(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

fn strip_comments(src: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(src.len() + 2);
    let mut i = 0;
    let at = |i: usize| src.get(i).copied();
    while i < src.len() {
        let c = src[i];
        let n = at(i + 1);
        if (c == u('/') && n == Some(u('/'))) || (c == u('-') && n == Some(u('-'))) {
            // `//` comments; some community files also use Lua-style `--` outside the Lua block
            while i < src.len() && src[i] != u('\n') {
                out.push(u(' '));
                i += 1;
            }
        } else if c == u('/') && n == Some(u('*')) {
            out.extend([u(' '), u(' ')]);
            i += 2;
            while i < src.len() && !(src[i] == u('*') && at(i + 1) == Some(u('/'))) {
                out.push(if src[i] == u('\n') { u('\n') } else { u(' ') });
                i += 1;
            }
            out.extend([u(' '), u(' ')]);
            i += 2;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Id,
    Num,
    Sym,
    Str,
}

#[derive(Clone, Debug)]
struct Tok {
    t: Kind,
    v: String,
    line: usize,
}

fn tokenize(src: &[u16]) -> Vec<Tok> {
    let mut toks = Vec::new();
    let mut line = 1;
    let mut i = 0;
    while i < src.len() {
        let c = src[i];
        if c == u('\n') {
            line += 1;
            i += 1;
            continue;
        }
        if is_js_space(c) {
            i += 1;
            continue;
        }
        if is_ident_start(c) {
            let mut j = i;
            while j < src.len() && is_ident_char(src[j]) {
                j += 1;
            }
            toks.push(Tok { t: Kind::Id, v: utf16(&src[i..j]), line });
            i = j;
            continue;
        }
        if c == u('.') || (c < 0x80 && (c as u8).is_ascii_digit()) {
            let mut j = i;
            while j < src.len() && is_num_char(src[j]) {
                j += 1;
            }
            if j < src.len() && (src[j] == u('-') || src[j] == u('+')) && (src[j - 1] == u('e') || src[j - 1] == u('E')) {
                j += 1;
                while j < src.len() && src[j] < 0x80 && (src[j] as u8).is_ascii_digit() {
                    j += 1;
                }
            }
            toks.push(Tok { t: Kind::Num, v: utf16(&src[i..j]), line });
            i = j;
            continue;
        }
        if c == u('"') || c == u('\'') {
            let mut j = i + 1;
            while j < src.len() && src[j] != c {
                j += 1;
            }
            toks.push(Tok { t: Kind::Str, v: utf16(&src[i + 1..j]), line });
            i = j + 1;
            continue;
        }
        if c == u('#') {
            // #RRGGBB colour literal: keep it as one token so no space is inserted after '#'
            let mut j = i + 1;
            while j < src.len() && is_hex(src[j]) {
                j += 1;
            }
            toks.push(Tok { t: Kind::Num, v: utf16(&src[i..j]), line });
            i = j;
            continue;
        }
        toks.push(Tok { t: Kind::Sym, v: utf16(&src[i..i + 1]), line });
        i += 1;
    }
    toks
}

/// Skip quoted text or comments without treating their braces as section delimiters.
fn literal_end(src: &[u16], i: usize) -> Option<usize> {
    let quote = src[i];
    if quote == u('"') || quote == u('\'') {
        let mut j = i + 1;
        while j < src.len() {
            if src[j] == u('\\') {
                j += 2;
                continue;
            }
            let c = src[j];
            j += 1;
            if c == quote {
                return Some(j);
            }
        }
        return Some(src.len());
    }
    let comment = starts_with(src, i, "--");
    let start = if comment { i + 2 } else { i };
    // Lua long bracket `[[`, `[=[` ...
    if src.get(start) == Some(&u('[')) {
        let mut k = start + 1;
        while src.get(k) == Some(&u('=')) {
            k += 1;
        }
        if src.get(k) == Some(&u('[')) {
            let open_len = k + 1 - start;
            let mut close = vec![u(']')];
            close.extend(std::iter::repeat(u('=')).take(k - start - 1));
            close.push(u(']'));
            return Some(match index_of(src, &close, start + open_len) {
                Some(end) => end + open_len,
                None => src.len(),
            });
        }
    }
    if comment || starts_with(src, i, "//") {
        return Some(index_of(src, &[u('\n')], i).unwrap_or(src.len()));
    }
    if starts_with(src, i, "/*") {
        return Some(index_of(src, &[u('*'), u('/')], i + 2).map_or(src.len(), |e| e + 2));
    }
    None
}

/// A top-level section: `name { inner }`.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub name: String,
    pub inner: String,
    /// line of the section name
    pub line: usize,
    /// UTF-16 offset of the first unit after the opening brace
    pub offset: usize,
}

struct RawBlock {
    name: String,
    inner: (usize, usize),
    line: usize,
}

fn find_raw_blocks(src: &[u16]) -> Result<Vec<RawBlock>> {
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < src.len() {
        if let Some(skipped) = literal_end(src, i) {
            i = skipped;
            continue;
        }
        if !is_ident_start(src[i]) {
            i += 1;
            continue;
        }
        let start = i;
        while i < src.len() && is_ident_char(src[i]) {
            i += 1;
        }
        let name = utf16(&src[start..i]);
        while i < src.len() && is_js_space(src[i]) {
            i += 1;
        }
        if src.get(i) != Some(&u('{')) {
            continue;
        }
        let open = i;
        i += 1;
        let line = lines_before(src, start);
        let mut depth = 1;
        while i < src.len() && depth > 0 {
            if let Some(skip) = literal_end(src, i) {
                i = skip;
                continue;
            }
            if src[i] == u('{') {
                depth += 1;
            }
            if src[i] == u('}') {
                depth -= 1;
            }
            i += 1;
        }
        if depth > 0 {
            return Err(RcParseError::new(format!("unclosed {name} section"), line));
        }
        blocks.push(RawBlock { name, inner: (open + 1, i - 1), line });
    }
    Ok(blocks)
}

/// Top-level sections of a (newline-normalised) source.
pub fn find_blocks(src: &str) -> Result<Vec<Block>> {
    let s: Vec<u16> = src.encode_utf16().collect();
    Ok(find_raw_blocks(&s)?
        .into_iter()
        .map(|b| Block { name: b.name, inner: utf16(&s[b.inner.0..b.inner.1]), line: b.line, offset: b.inner.0 })
        .collect())
}

struct P {
    toks: Vec<Tok>,
    i: usize,
    base_line: usize,
}

impl P {
    fn new(src: &[u16], base_line: usize) -> Self {
        P { toks: tokenize(src), i: 0, base_line }
    }
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.i)
    }
    fn peek_at(&self, o: usize) -> Option<&Tok> {
        self.toks.get(self.i + o)
    }
    /// `peek()?.v === v` (the TypeScript compares the text whatever the token kind)
    fn peek_is(&self, o: usize, v: &str) -> bool {
        self.peek_at(o).is_some_and(|t| t.v == v)
    }
    fn next(&mut self) -> Result<Tok> {
        let t = self.toks.get(self.i).cloned();
        self.i += 1;
        t.ok_or_else(|| RcParseError::new("unexpected end of section".into(), self.line()))
    }
    fn line(&self) -> usize {
        self.peek().or(self.toks.last()).map_or(1, |t| t.line) + self.base_line - 1
    }
    fn accept(&mut self, v: &str) -> bool {
        if self.peek().is_some_and(|t| t.t == Kind::Sym && t.v == v) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn expect(&mut self, v: &str) -> Result<()> {
        if self.accept(v) {
            return Ok(());
        }
        let found = self.peek().map_or("EOF".to_string(), |t| t.v.clone());
        Err(RcParseError::new(format!("expected '{v}' but found '{found}'"), self.line()))
    }
    fn ident(&mut self) -> Result<String> {
        let t = self.next()?;
        if t.t != Kind::Id {
            return Err(RcParseError::new(format!("expected identifier, found '{}'", t.v), self.line()));
        }
        Ok(t.v)
    }
    /// raw expression text until ',' or ')' at depth 0
    fn expr(&mut self) -> String {
        let mut depth = 0;
        let mut parts: Vec<String> = Vec::new();
        while let Some(t) = self.peek() {
            if t.t == Kind::Sym {
                if t.v == "(" {
                    depth += 1;
                }
                if t.v == ")" {
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                }
                if t.v == "," && depth == 0 {
                    break;
                }
            }
            parts.push(if t.t == Kind::Str { format!("\"{}\"", t.v) } else { t.v.clone() });
            self.i += 1;
        }
        js_trim(&parts.join(" "))
    }
    /// parses `( a=expr, b=expr )`; bare values are stored positionally as `_0`, `_1`...
    fn args(&mut self) -> Result<Attrs> {
        let mut out = Attrs::default();
        self.expect("(")?;
        let mut pos = 0;
        while !self.accept(")") {
            let named = match (self.peek(), self.peek_at(1)) {
                (Some(t0), Some(t1)) if t0.t == Kind::Id && t1.t == Kind::Sym && t1.v == "=" => Some(t0.v.to_lowercase()),
                _ => None,
            };
            if let Some(key) = named {
                self.i += 2;
                // the TypeScript reads `this.peek()!.start` here for the editor's ranges
                if self.peek().is_none() {
                    return Err(RcParseError::type_error());
                }
                let v = self.expr();
                out.set(key, v);
            } else {
                let v = self.expr();
                out.set(format!("_{pos}"), v);
                pos += 1;
            }
            if !self.accept(",") {
                self.expect(")")?;
                break;
            }
        }
        Ok(out)
    }
}

fn num(s: Option<&str>, d: f64) -> f64 {
    let Some(s) = s else { return d };
    let t = js_strip_spaces(s);
    // colors live in Val too: COLOR_1(default=#27AD96)
    if let Some(h) = t.strip_prefix('#') {
        if (1..=8).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return parse_hex(h);
        }
    }
    let v = js_number(&t);
    if v.is_finite() {
        v
    } else {
        d
    }
}

fn parse_val(inner: &[u16], base_line: usize) -> Result<Vec<ValDecl>> {
    let mut p = P::new(inner, base_line);
    let mut out = Vec::new();
    while p.peek().is_some() {
        if p.accept(",") || p.accept(";") {
            continue;
        }
        let name = p.ident()?;
        let a = if p.peek_is(0, "(") { p.args()? } else { Attrs::default() };
        out.push(ValDecl {
            name,
            default: num(a.get("default"), 0.0),
            min: num(a.get("min"), 0.0),
            max: num(a.get("max"), 3.4e38),
            step: num(a.get("step"), 0.0),
            disp: a.get("disp").map(|d| num(Some(d), 0.0)),
        });
    }
    Ok(out)
}

fn parse_key(inner: &[u16], base_line: usize) -> Result<Vec<KeyBinding>> {
    let mut p = P::new(inner, base_line);
    let mut out = Vec::new();
    let mut key = -1.0;
    while let Some(t) = p.peek().cloned() {
        if p.accept(",") || p.accept(";") {
            continue;
        }
        if t.t == Kind::Num && p.peek_is(1, ":") {
            key = js_number(&t.v);
            p.i += 2;
            continue;
        }
        let name = p.ident()?;
        let a = if p.peek_is(0, "(") { p.args()? } else { Attrs::default() };
        if key < 0.0 {
            return Err(RcParseError::new(format!("key binding '{name}' before any key number"), p.line()));
        }
        out.push(KeyBinding { key, var: name, step: num(a.get("step"), 1.0) });
    }
    Ok(out)
}

fn parse_node(p: &mut P) -> Result<ChipNode> {
    let line = p.line();
    if p.peek().is_none() {
        // `p.peek()!.start` in the TypeScript
        return Err(RcParseError::type_error());
    }
    let mut dir = None;
    let mut name = p.ident()?;
    if let Some(d) = Dir::parse(&name.to_uppercase()) {
        if p.peek_is(0, ":") {
            p.accept(":");
            dir = Some(d);
            name = p.ident()?;
        }
    }
    let attrs = if p.peek_is(0, "(") { p.args()? } else { Attrs::default() };
    let mut node = ChipNode { type_: name, dir, attrs, children: Vec::new(), line };
    if p.accept("{") {
        while !p.accept("}") {
            if p.accept(",") || p.accept(";") {
                continue;
            }
            node.children.push(parse_node(p)?);
        }
    }
    Ok(node)
}

/// A Body may hold several Cores (each its own vehicle / "bit").
fn parse_body(inner: &[u16], base_line: usize) -> Result<Vec<ChipNode>> {
    let mut p = P::new(inner, base_line);
    let mut roots = Vec::new();
    while p.peek().is_some() {
        // stray separators / an extra closing brace (seen in community files) are ignored
        if p.accept(",") || p.accept(";") || p.accept("}") {
            continue;
        }
        roots.push(parse_node(&mut p)?);
    }
    Ok(roots)
}

/// Parse a model source.
pub fn parse_rc(source: &str) -> Result<RcModel> {
    let text = source.replace("\r\n", "\n").replace('\r', "\n");
    let text: Vec<u16> = text.encode_utf16().collect();
    let mut model = RcModel::default();
    for b in find_raw_blocks(&text)? {
        let name = b.name.to_lowercase();
        let (a, z) = b.inner;
        let first_line = lines_before(&text, a);
        if name == "lua" {
            model.script = Some(Script { lang: ScriptLang::Lua, source: utf16(&text[a..z]), line: b.line, first_line });
            continue;
        }
        if name == "script" {
            // legacy RC script; a Lua block (if present) takes precedence
            if model.script.as_ref().map_or(true, |s| s.lang != ScriptLang::Lua) {
                model.script = Some(Script { lang: ScriptLang::Rc, source: utf16(&text[a..z]), line: b.line, first_line });
            }
            continue;
        }
        let inner = strip_comments(&text[a..z]);
        match name.as_str() {
            "val" | "var" => model.vals.extend(parse_val(&inner, b.line)?),
            "key" => model.keys.extend(parse_key(&inner, b.line)?),
            "body" => model.bodies.extend(parse_body(&inner, b.line)?),
            _ => model
                .warnings
                .push(format!("未対応のセクション「{}」(line {})。内容は実行に反映されません。", b.name, b.line)),
        }
    }
    Ok(model)
}

/// Count nodes of the body tree.
pub fn count_nodes(n: Option<&ChipNode>) -> usize {
    n.map_or(0, |n| 1 + n.children.iter().map(|c| count_nodes(Some(c))).sum::<usize>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sections_and_lines() {
        let src = "Val\n{\n A(default=2, max=5)\n}\nKey{0:A(step=1)}\nBody {\n Core(){ N:Chip(angle=-A){} }\n}\nFoo{}\nLua\n{\nx=1\n}\n";
        let m = parse_rc(src).unwrap();
        assert_eq!(m.vals[0].default, 2.0);
        assert_eq!(m.vals[0].max, 5.0);
        assert_eq!(m.keys[0].var, "A");
        assert_eq!(count_nodes(m.body()), 2);
        assert_eq!(m.body().unwrap().children[0].attrs.get("angle"), Some("- A"));
        let s = m.script.unwrap();
        assert_eq!((s.line, s.first_line), (10, 11));
        assert_eq!(m.warnings.len(), 1);
        assert_eq!(parse_rc("Body{ Core( }").unwrap_err().to_string(), "expected ')' but found 'EOF' (line 1)");
        assert_eq!(parse_rc("\nBody{ Core() ").unwrap_err().to_string(), "unclosed Body section (line 2)");
    }
}
