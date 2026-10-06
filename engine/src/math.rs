//! Small float helpers that work without `std` (wasm32 builds are `no_std`).

pub const PI: f64 = core::f64::consts::PI;

#[inline]
pub fn fabs(x: f64) -> f64 {
    if x < 0.0 {
        -x
    } else {
        x
    }
}

#[inline]
pub fn fmax(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else {
        b
    }
}

#[inline]
pub fn fmin(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else {
        b
    }
}

/// Newton–Raphson square root (the wasm32 intrinsic is unstable on current Rust).
pub fn sqrt(x: f64) -> f64 {
    if !(x > 0.0) {
        return 0.0;
    }
    let mut r = if x > 1.0 { x / 2.0 } else { 1.0 };
    for _ in 0..64 {
        let n = 0.5 * (r + x / r);
        if fabs(n - r) <= 1e-15 * n {
            return n;
        }
        r = n;
    }
    r
}

/// Round half away from zero.
pub fn round(x: f64) -> f64 {
    let t = x as i64 as f64;
    let d = x - t;
    if d >= 0.5 {
        t + 1.0
    } else if d <= -0.5 {
        t - 1.0
    } else {
        t
    }
}

fn sin_poly(x: f64) -> f64 {
    let x2 = x * x;
    x * (1.0
        + x2 * (-1.0 / 6.0
            + x2 * (1.0 / 120.0
                + x2 * (-1.0 / 5040.0
                    + x2 * (1.0 / 362_880.0
                        + x2 * (-1.0 / 39_916_800.0 + x2 * (1.0 / 6_227_020_800.0)))))))
}

fn cos_poly(x: f64) -> f64 {
    let x2 = x * x;
    1.0 + x2
        * (-0.5
            + x2 * (1.0 / 24.0
                + x2 * (-1.0 / 720.0
                    + x2 * (1.0 / 40_320.0
                        + x2 * (-1.0 / 3_628_800.0 + x2 * (1.0 / 479_001_600.0))))))
}

/// (sin x, cos x), accurate to ~1e-12 over the ranges a layout uses.
pub fn sincos(x: f64) -> (f64, f64) {
    let two_pi = 2.0 * PI;
    let y = x - two_pi * round(x / two_pi);
    let q = round(y / (PI / 2.0));
    let r = y - q * (PI / 2.0);
    let (s, c) = (sin_poly(r), cos_poly(r));
    match (q as i64).rem_euclid(4) {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sincos_matches_std() {
        let mut x = -20.0;
        while x < 20.0 {
            let (s, c) = sincos(x);
            assert!((s - x.sin()).abs() < 1e-10, "sin {x}");
            assert!((c - x.cos()).abs() < 1e-10, "cos {x}");
            x += 0.0137;
        }
        for &v in &[0.0, 1e-9, 0.25, 1.0, 2.0, 1234.5, 9.9e12] {
            assert!(
                (sqrt(v) - v.sqrt()).abs() <= 1e-9 * v.sqrt().max(1.0),
                "sqrt {v}"
            );
        }
    }
}
