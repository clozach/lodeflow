//! Lays out the demo's sample diagram and counts the lines that visibly cross.
//!   cargo run --release --example sample
use lodeflow_layout::*;

/// Edge index pairs whose drawn routes cross (shared endpoints excluded).
pub fn visible_crossings(o: &Output, inp: &Input) -> Vec<(usize, usize)> {
    let poly = |p: &Vec<(f64, f64)>| {
        let mut out = Vec::new();
        let mut i = 0;
        while i + 3 < p.len() {
            let (a, b, c, d) = (p[i], p[i + 1], p[i + 2], p[i + 3]);
            for k in 0..=24 {
                let t = k as f64 / 24.0;
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
    let cross = |p: (f64, f64), q: (f64, f64), r: (f64, f64), s: (f64, f64)| {
        let d = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0);
        let (d1, d2, d3, d4) = (d(r, s, p), d(r, s, q), d(p, q, r), d(p, q, s));
        (d1 > 0.0) != (d2 > 0.0) && (d3 > 0.0) != (d4 > 0.0)
    };
    let ps: Vec<_> = o.edges.iter().map(|e| if e.hidden { Vec::new() } else { poly(&e.path) }).collect();
    let mut out = Vec::new();
    for i in 0..ps.len() {
        for j in i + 1..ps.len() {
            let (a, b) = (&inp.edges[i], &inp.edges[j]);
            if a.src == b.src || a.dst == b.dst || a.src == b.dst || a.dst == b.src {
                continue;
            }
            let hit = ps[i].windows(2).any(|s| ps[j].windows(2).any(|t| cross(s[0], s[1], t[0], t[1])));
            if hit {
                out.push((i, j));
            }
        }
    }
    out
}

fn main() {
    let names = ["specs", "dod", "estimates", "rework", "juggle", "switching", "cycle", "slip", "pressure", "parallel", "wip", "trust"];
    let group = [0, 0, 0, 1, -1, 1, 1, -1, -1, -1, -1, -1];
    let two_line = [true, true, false, false, true, true, false, false, true, true, true, false];
    let edges = [(0, 3), (1, 3), (3, 6), (4, 5), (5, 6), (6, 7), (2, 8), (7, 8), (7, 11), (8, 9), (10, 9), (9, 4)];
    let only = std::env::var("ONLY").ok();
    for &(tight, end) in &[(false, false), (false, true), (true, false), (true, true)] {
        if only.as_deref().is_some_and(|o| o != format!("{tight}{end}")) {
            continue;
        }
        let mut inp = Input::default();
        inp.opts.orient = Orient::LeftToRight;
        inp.opts.bias_end = end;
        inp.opts.tight_groups = tight;
        inp.opts.untangle = std::env::var("UNTANGLE").map_or(true, |v| v != "0");
        inp.opts.node_sep = 28.0;
        inp.opts.rank_sep = 60.0;
        for i in 0..names.len() {
            inp.nodes.push(NodeIn { w: 176.0, h: if two_line[i] { 59.0 } else { 40.0 }, group: group[i], prev: None });
        }
        for &(a, b) in &edges {
            inp.edges.push(EdgeIn { src: a, dst: b, back_hint: false, label: None });
        }
        for _ in 0..2 {
            inp.groups.push(GroupIn { parent: -1, collapsed: false, w: 176.0, h: 44.0, header: 24.0 });
        }
        let o = layout(&inp);
        let vis = visible_crossings(&o, &inp);
        let named: Vec<String> = vis.iter().map(|&(i, j)| format!("{}→{} × {}→{}", names[edges[i].0], names[edges[i].1], names[edges[j].0], names[edges[j].1])).collect();
        println!("tight={tight} end={end}: engine count {} · visible {} {:?}", o.crossings, vis.len(), named);
    }
}
