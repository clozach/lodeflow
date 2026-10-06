//! Crossings and time on flow-like random graphs (the web bench's generator), per size.
//!   cargo run --release --example stats
use lodeflow_layout::*;
use std::time::Instant;

fn rng(seed: u64) -> impl FnMut() -> f64 {
    let mut s = seed.max(1);
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s % 1_000_000) as f64 / 1_000_000.0
    }
}

fn flow(n: usize, seed: u64, ng: usize, end: bool, tight: bool, untangle: bool) -> Input {
    let mut r = rng(seed);
    let mut inp = Input::default();
    for i in 0..n {
        let g = if ng > 0 && r() < 0.3 { ((i * ng) / n) as i32 } else { -1 };
        inp.nodes.push(NodeIn { w: 176.0, h: 38.0 + (r() * 3.0).floor() * 19.0, group: g, prev: None });
    }
    for i in 0..n {
        let k = 1 + (r() * 2.0) as usize;
        for _ in 0..k {
            let t = i + 1 + (r() * 6.0) as usize;
            if t < n {
                inp.edges.push(EdgeIn { src: i, dst: t, back_hint: false, label: None });
            }
        }
        if r() < 0.04 && i > 4 {
            inp.edges.push(EdgeIn { src: i, dst: i - 1 - (r() * 4.0) as usize, back_hint: false, label: None });
        }
    }
    for _ in 0..ng {
        inp.groups.push(GroupIn { parent: -1, collapsed: false, w: 176.0, h: 44.0, header: 22.0 });
    }
    inp.opts.orient = Orient::LeftToRight;
    inp.opts.bias_end = end;
    inp.opts.tight_groups = tight;
    set_untangle(&mut inp, untangle);
    inp
}

#[allow(unused_variables)]
fn set_untangle(inp: &mut Input, on: bool) {
    inp.opts.untangle = on; // UNTANGLE-LINE
}

/// Pairs of edges whose drawn routes cross (shared endpoints excluded): the same yardstick for any engine.
fn visible(o: &Output, inp: &Input) -> usize {
    let poly = |p: &Vec<(f64, f64)>| {
        let mut out = Vec::new();
        let mut i = 0;
        while i + 3 < p.len() {
            let (a, b, c, d) = (p[i], p[i + 1], p[i + 2], p[i + 3]);
            for k in 0..=8 {
                let t = k as f64 / 8.0;
                let m = 1.0 - t;
                out.push((
                    m * m * m * a.0 + 3.0 * m * m * t * b.0 + 3.0 * m * t * t * c.0 + t * t * t * d.0,
                    m * m * m * a.1 + 3.0 * m * m * t * b.1 + 3.0 * m * t * t * c.1 + t * t * t * d.1,
                ));
            }
            i += 3;
        }
        out
    };
    let bbox = |p: &Vec<(f64, f64)>| p.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, q| (b.0.min(q.0), b.1.min(q.1), b.2.max(q.0), b.3.max(q.1)));
    let d = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
    let cross = |p: (f64, f64), q: (f64, f64), r: (f64, f64), s: (f64, f64)| (d(r, s, p) > 0.0) != (d(r, s, q) > 0.0) && (d(p, q, r) > 0.0) != (d(p, q, s) > 0.0);
    let ps: Vec<_> = o.edges.iter().map(|e| if e.hidden { Vec::new() } else { poly(&e.path) }).collect();
    let bs: Vec<_> = ps.iter().map(bbox).collect();
    let mut n = 0;
    for i in 0..ps.len() {
        for j in i + 1..ps.len() {
            let (a, b) = (&inp.edges[i], &inp.edges[j]);
            if a.src == b.src || a.dst == b.dst || a.src == b.dst || a.dst == b.src || ps[i].is_empty() || ps[j].is_empty() {
                continue;
            }
            let (x, y) = (bs[i], bs[j]);
            if x.2 < y.0 || y.2 < x.0 || x.3 < y.1 || y.3 < x.1 {
                continue;
            }
            if ps[i].windows(2).any(|s| ps[j].windows(2).any(|t| cross(s[0], s[1], t[0], t[1]))) {
                n += 1;
            }
        }
    }
    n
}

fn main() {
    for &(n, ng, seeds) in &[(12usize, 2usize, 60u64), (30, 2, 40), (60, 3, 20), (100, 4, 10), (300, 8, 3)] {
        for &untangle in &[false, true] {
            let (mut cross, mut zero, mut ms) = (0usize, 0usize, 0.0f64);
            let mut runs = 0;
            for seed in 1..=seeds {
                for &(end, tight) in &[(false, true), (true, true)] {
                    let inp = flow(n, seed * 7919, ng, end, tight, untangle);
                    let t = Instant::now();
                    let o = layout(&inp);
                    ms += t.elapsed().as_secs_f64() * 1e3;
                    let v = if n <= 100 { visible(&o, &inp) } else { o.crossings };
                    cross += v;
                    zero += (v == 0) as usize;
                    runs += 1;
                }
            }
            println!("n={n:4} untangle={untangle:5}: mean visible crossings {:.2} · crossing-free {}/{} · {:.2} ms/layout", cross as f64 / runs as f64, zero, runs, ms / runs as f64);
        }
    }
}
