//! Tiny arithmetic evaluator for attribute expressions (port of `src/rc/expr.ts`): numbers, identifiers, unary
//! minus, + - * /, parentheses. Unknown identifiers resolve to 0.
//!
//! The TypeScript walks UTF-16 code units; this does the same so odd input (astral characters) stops the
//! evaluation at the same place.

/// Value lookup: `None` (or a non-finite value) reads as 0.
pub type Env<'a> = &'a dyn Fn(&str) -> Option<f64>;

/// JavaScript `\s` on one UTF-16 code unit.
pub(crate) fn is_js_space(c: u16) -> bool {
    matches!(c,
        0x09..=0x0d | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

pub(crate) fn is_ascii_unit(c: u16, f: fn(u8) -> bool) -> bool {
    c < 0x80 && f(c as u8)
}

pub(crate) fn is_ident_start(c: u16) -> bool {
    is_ascii_unit(c, |b| b.is_ascii_alphabetic() || b == b'_')
}

pub(crate) fn is_ident_char(c: u16) -> bool {
    is_ascii_unit(c, |b| b.is_ascii_alphanumeric() || b == b'_')
}

pub(crate) fn is_hex(c: u16) -> bool {
    is_ascii_unit(c, |b| b.is_ascii_hexdigit())
}

pub(crate) fn is_num_char(c: u16) -> bool {
    is_ascii_unit(c, |b| b.is_ascii_digit() || b == b'.' || b == b'e' || b == b'E')
}

/// JavaScript `String.prototype.trim`.
pub(crate) fn js_trim(s: &str) -> String {
    let u: Vec<u16> = s.encode_utf16().collect();
    let a = u.iter().position(|&c| !is_js_space(c)).unwrap_or(u.len());
    let b = u.iter().rposition(|&c| !is_js_space(c)).map_or(a, |p| p + 1);
    String::from_utf16_lossy(&u[a..b])
}

/// `s.replace(/\s+/g, '')`
pub(crate) fn js_strip_spaces(s: &str) -> String {
    let u: Vec<u16> = s.encode_utf16().filter(|&c| !is_js_space(c)).collect();
    String::from_utf16_lossy(&u)
}

/// JavaScript `Number(string)`.
pub fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    let t = t.as_str();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            return parse_radix(&t[2..], radix).unwrap_or(f64::NAN);
        }
    }
    // StrDecimalLiteral: [+-] (digits [. digits?] | . digits) [e [+-] digits]
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let f = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - f;
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let e = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == e {
            return f64::NAN;
        }
    }
    if i != b.len() {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// Digits in `radix` (already validated or not); `None` when empty or a digit is out of range.
fn parse_radix(s: &str, radix: u32) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    if s.len() <= 32 {
        if let Ok(v) = u128::from_str_radix(s, radix) {
            return Some(v as f64);
        }
        if !s.chars().all(|c| c.is_digit(radix)) {
            return None;
        }
    }
    let mut v = 0.0f64;
    for c in s.chars() {
        v = v * radix as f64 + c.to_digit(radix)? as f64;
    }
    Some(v)
}

/// `parseInt(hexDigits, 16)` for a string of hex digits.
pub(crate) fn parse_hex(digits: &str) -> f64 {
    parse_radix(digits, 16).unwrap_or(f64::NAN)
}

/// Evaluate an attribute expression against `env`.
pub fn eval_expr(src: &str, env: Env) -> f64 {
    let s: Vec<u16> = js_trim(src).encode_utf16().collect();
    if s.is_empty() {
        return 0.0;
    }
    let mut p = Ev { s: &s, i: 0, env };
    p.add()
}

struct Ev<'a> {
    s: &'a [u16],
    i: usize,
    env: Env<'a>,
}

impl Ev<'_> {
    fn peek(&self) -> Option<u16> {
        self.s.get(self.i).copied()
    }
    fn skip(&mut self) {
        while self.i < self.s.len() && is_js_space(self.s[self.i]) {
            self.i += 1;
        }
    }
    fn text(&self, a: usize, b: usize) -> String {
        String::from_utf16_lossy(&self.s[a..b])
    }
    fn primary(&mut self) -> f64 {
        self.skip();
        let Some(c) = self.peek() else {
            self.i += 1;
            return 0.0;
        };
        if c == b'(' as u16 {
            self.i += 1;
            let v = self.add();
            self.skip();
            if self.peek() == Some(b')' as u16) {
                self.i += 1;
            }
            return v;
        }
        if c == b'-' as u16 {
            self.i += 1;
            return -self.primary();
        }
        if c == b'+' as u16 {
            self.i += 1;
            return self.primary();
        }
        if c == b'#' as u16 {
            let mut j = self.i + 1;
            while j < self.s.len() && is_hex(self.s[j]) {
                j += 1;
            }
            let digits = self.text(self.i + 1, j);
            let v = parse_hex(if digits.is_empty() { "0" } else { &digits });
            self.i = j;
            return v;
        }
        if c == b'"' as u16 || c == b'\'' as u16 {
            let mut j = self.i + 1;
            while j < self.s.len() && self.s[j] != c {
                j += 1;
            }
            self.i = j + 1;
            return 0.0;
        }
        if is_ascii_unit(c, |b| b.is_ascii_digit() || b == b'.') {
            let mut j = self.i;
            while j < self.s.len() && is_num_char(self.s[j]) {
                j += 1;
            }
            let v = js_number(&self.text(self.i, j));
            self.i = j;
            return if v.is_finite() { v } else { 0.0 };
        }
        if is_ident_start(c) {
            let mut j = self.i;
            while j < self.s.len() && is_ident_char(self.s[j]) {
                j += 1;
            }
            let name = self.text(self.i, j);
            self.i = j;
            return match (self.env)(&name) {
                Some(v) if v.is_finite() => v,
                _ => 0.0,
            };
        }
        self.i += 1;
        0.0
    }
    fn mul(&mut self) -> f64 {
        let mut v = self.primary();
        loop {
            self.skip();
            match self.peek() {
                Some(c) if c == b'*' as u16 => {
                    self.i += 1;
                    v *= self.primary();
                }
                Some(c) if c == b'/' as u16 => {
                    self.i += 1;
                    let d = self.primary();
                    v = if d == 0.0 { 0.0 } else { v / d };
                }
                _ => return v,
            }
        }
    }
    fn add(&mut self) -> f64 {
        let mut v = self.mul();
        loop {
            self.skip();
            match self.peek() {
                Some(c) if c == b'+' as u16 => {
                    self.i += 1;
                    v += self.mul();
                }
                Some(c) if c == b'-' as u16 => {
                    self.i += 1;
                    v -= self.mul();
                }
                _ => return v,
            }
        }
    }
}

/// True when the expression has no identifiers (a `#RRGGBB` literal contains letters but is still a constant).
pub fn expr_is_constant(src: &str) -> bool {
    let u: Vec<u16> = src.encode_utf16().collect();
    let mut i = 0;
    while i < u.len() {
        if u[i] == b'#' as u16 && i + 1 < u.len() && is_hex(u[i + 1]) {
            i += 1;
            while i < u.len() && is_hex(u[i]) {
                i += 1;
            }
            continue;
        }
        if is_ident_start(u[i]) {
            return false;
        }
        i += 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_like_the_typescript() {
        let env = |n: &str| if n == "A" { Some(3.0) } else { None };
        assert_eq!(eval_expr("-A*2+1", &env), -5.0);
        assert_eq!(eval_expr("(1+2)/0", &env), 0.0);
        assert_eq!(eval_expr("#ff", &env), 255.0);
        assert_eq!(eval_expr("1e-5", &env), -5.0); // "1e" is NaN → 0, then "- 5"
        assert_eq!(eval_expr("B", &env), 0.0);
        assert!(expr_is_constant("#27AD96 * 2"));
        assert!(!expr_is_constant("A"));
        assert_eq!(js_number(""), 0.0);
        assert!(js_number("1.2.3").is_nan());
        assert_eq!(js_number(" .5 "), 0.5);
        assert_eq!(js_number("0x1F"), 31.0);
        assert!(js_number("inf").is_nan());
    }
}
