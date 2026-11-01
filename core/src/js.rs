//! JavaScript number semantics the script layer depends on: `String(x)`, `x.toFixed(d)`, `Math.round`, `ToInt32`,
//! and which numbers wasmoon hands to Lua as integers. Script output (`out`, `print`) and the replay CSVs are
//! formatted exactly as the TypeScript formats them.

/// `String(x)` for a JavaScript number (shortest round-trip digits, exponent outside 1e-7 ..< 1e21).
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // shortest round-trip digits and the decimal exponent from Rust's `{:e}`
    let e = format!("{:e}", x.abs());
    let (mant, exp) = e.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1; // the decimal point sits after n digits
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let es = if e >= 0 { format!("+{e}") } else { format!("-{}", -e) };
        if k == 1 {
            format!("{digits}e{es}")
        } else {
            format!("{}.{}e{es}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// `x.toFixed(d)`: exact decimal value of the double, ties rounded up (away from zero), `String(x)` from 1e21 on.
pub fn to_fixed(x: f64, d: usize) -> String {
    if !x.is_finite() {
        return number_to_string(x);
    }
    if x.abs() >= 1e21 {
        return number_to_string(x);
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let a = x.abs();
    // Rust rounds exact ties to even; JavaScript picks the larger n. An exact tie needs the exact decimal expansion
    // to end in a 5 at position d+1, which the long expansion shows.
    let long = format!("{:.*}", d + 60, a);
    let (int_part, frac) = long.split_once('.').unwrap();
    let tail = &frac[d..];
    let s = if tail.starts_with('5') && tail[1..].bytes().all(|b| b == b'0') {
        // round the truncated value up by one unit in the last place
        let mut digits: Vec<u8> = format!("{int_part}{}", &frac[..d]).into_bytes();
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
        let s = String::from_utf8(digits).unwrap();
        if d == 0 {
            s
        } else {
            format!("{}.{}", &s[..s.len() - d], &s[s.len() - d..])
        }
    } else {
        format!("{:.*}", d, a)
    };
    format!("{sign}{s}")
}

/// how scripts print a number: integers as `String(x)`, the rest with two decimals
pub fn print_number(x: f64) -> String {
    if is_integer(x) {
        number_to_string(x)
    } else {
        to_fixed(x, 2)
    }
}

/// `Number.isInteger(x)`
pub fn is_integer(x: f64) -> bool {
    x.is_finite() && x.fract() == 0.0
}

/// `Math.round` (ties toward +∞)
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    let r = if x - f >= 0.5 { f + 1.0 } else { f };
    if r == 0.0 && x < 0.0 {
        -0.0
    } else {
        r
    }
}

/// `ToInt32(x)` (the operand conversion of `&`, `|`, `>>`)
pub fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc().rem_euclid(4294967296.0);
    t as u64 as u32 as i32
}

/// wasmoon pushes a JavaScript number as a Lua integer when `Number.isInteger` holds, else as a float
pub fn lua_integer(x: f64) -> Option<i64> {
    if is_integer(x) && x.abs() < 9.2e18 {
        Some(x as i64)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_javascript() {
        for (x, s) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-12.0, "-12"),
            (0.1, "0.1"),
            (1.5e-7, "1.5e-7"),
            (0.000001, "0.000001"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.2345e25, "1.2345e+25"),
            (-0.5, "-0.5"),
            (f64::NAN, "NaN"),
            (f64::NEG_INFINITY, "-Infinity"),
        ] {
            assert_eq!(number_to_string(x), s, "{x}");
        }
        for (x, s) in [(0.125, "0.13"), (-0.125, "-0.13"), (1.005, "1.00"), (2.345, "2.35"), (-0.001, "-0.00"), (99.995, "100.00"), (0.375, "0.38")] {
            assert_eq!(to_fixed(x, 2), s, "{x}");
        }
        assert_eq!(to_fixed(1.23456, 4), "1.2346");
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(0.49999999999999994), 0.0);
        assert_eq!(to_int32(4294967297.0), 1);
        assert_eq!(to_int32(-1.0), -1);
    }
}
