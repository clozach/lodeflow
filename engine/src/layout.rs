//! The pipeline: build → order → coordinates → routes.

use crate::graph::{self, Graph, VK};
use crate::types::{Input, Orient, Output};
use crate::{bk, order, place, untangle};
use alloc::vec;
use alloc::vec::Vec;

/// Lay out a diagram. Deterministic: the same input gives the same output.
pub fn layout(inp: &Input) -> Output {
    layout_many(inp, &[inp.opts.orient]).pop().unwrap_or_default()
}

/// Rank and order once, then place the result in each direction. Ranks and order do not depend
/// on the direction (only the frame sizes do), so each extra direction costs only coordinates
/// and routes. `Auto` orientation uses this to compare directions at little extra cost.
pub fn layout_many(inp: &Input, orients: &[Orient]) -> Vec<Output> {
    #[cfg(not(target_arch = "wasm32"))]
    let t0 = std::time::Instant::now();
    let (mut g, mut gr) = graph::build(inp, &[]);
    #[cfg(not(target_arch = "wasm32"))]
    let t1 = t0.elapsed().as_secs_f64() * 1e3;
    let o = &inp.opts;
    let incremental = o.incremental && !o.orient.is_radial();
    let keys = if incremental {
        Some(incremental_keys(inp, &g))
    } else {
        None
    };
    let (mut layers, mut crossings, cost) = order::Orderer { g: &g, gr: &gr }.run(keys.as_deref(), None);
    #[cfg(not(target_arch = "wasm32"))]
    let t_order = t0.elapsed().as_secs_f64() * 1e3;
    if o.untangle && !incremental && cost > 0 && untangle::tries_for(g.nv0, g.nv()) > 0 {
        if let Some((g2, gr2, l2, c2)) = untangle::untangle(inp, &g, &gr, cost, crossings) {
            g = g2;
            gr = gr2;
            layers = l2;
            crossings = c2;
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    let t2 = t0.elapsed().as_secs_f64() * 1e3;
    let mut outs = Vec::with_capacity(orients.len());
    // Alignment depends only on the order: once for every direction.
    let aligned = if g.nv() > 0 { Some(bk::align(&g, &layers)) } else { None };
    for &or in orients {
        // Frame sizes for this direction: width across the flow, height along it.
        let swap = or.swaps_axes();
        for v in 0..g.nv() {
            let (fw, fh) = (g.fw[v], g.fh[v]);
            if fw > 0.0 || fh > 0.0 {
                let (w, h) = if swap { (fh, fw) } else { (fw, fh) };
                g.w[v] = w;
                g.h[v] = h;
            }
        }
        let mut here = inp.clone();
        here.opts.orient = or;
        #[cfg(not(target_arch = "wasm32"))]
        let t3 = t0.elapsed().as_secs_f64() * 1e3;
        let x = coordinates(&here, &g, &gr, &layers, aligned.as_ref());
        #[cfg(not(target_arch = "wasm32"))]
        let t4 = t0.elapsed().as_secs_f64() * 1e3;
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var("LF_DEBUG").is_ok() {
            for (r, l) in layers.iter().enumerate() {
                let row: Vec<std::string::String> = l
                    .iter()
                    .map(|&v| std::format!("{:?}@{:.0}", g.kind[v], x[v]))
                    .collect();
                std::eprintln!("rank {r}: {}", row.join("  "));
            }
        }
        outs.push(place::finish(&here, &g, &gr, place::Placed { x, layers: layers.clone() }, crossings));
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var("LF_TIME").is_ok() {
            let t5 = t0.elapsed().as_secs_f64() * 1e3;
            if outs.len() == 1 {
                std::eprintln!("  build {t1:.1} · order {:.1} · untangle {:.1} ms · vertices {}", t_order - t1, t2 - t_order, g.nv());
            }
            std::eprintln!("  {or:?}: coordinates {:.1} · routes {:.1} ms", t4 - t3, t5 - t4);
        }
    }
    outs
}

/// Brandes–Köpf coordinates across the flow. Rule 5 lives here: the three spacings come from
/// the compactness setting.
fn coordinates(inp: &Input, g: &Graph, gr: &graph::Groups, layers: &[Vec<usize>], aligned: Option<&bk::Aligned>) -> Vec<f64> {
    let o = &inp.opts;
    let header_cross = o.orient.swaps_axes();
    let side = |v: usize| match g.kind[v] {
        VK::Node(_) | VK::Proxy(_) => o.node_sep / 2.0,
        // A bend point carrying a label keeps a node's distance from its neighbours.
        VK::Dummy if g.w[v] > 0.0 => o.node_sep / 2.0,
        VK::Dummy => o.edge_sep / 2.0,
        VK::BorderL(_) | VK::BorderR(_) => o.group_gap / 2.0,
    };
    let sep = |u: usize, v: usize| -> f64 {
        let half = g.w[u] / 2.0 + g.w[v] / 2.0;
        let inner_l = match g.kind[u] {
            VK::BorderL(gi) => Some(o.group_pad + if header_cross { gr.header[gi] } else { 0.0 }),
            _ => None,
        };
        let inner_r = match g.kind[v] {
            VK::BorderR(_) => Some(o.group_pad),
            _ => None,
        };
        let gap = match (inner_l, inner_r) {
            (Some(a), Some(b)) => a + b,
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => side(u) + side(v),
        };
        half + gap
    };
    match aligned {
        _ if g.nv() == 0 => Vec::new(),
        Some(al) => bk::compact(g, layers, al, &sep),
        None => bk::assign(g, layers, &sep),
    }
}

/// Rule 9: previous cross-axis positions become sort keys; new vertices borrow their neighbours'.
fn incremental_keys(inp: &Input, g: &Graph) -> Vec<f64> {
    let nv = g.nv();
    let swaps = inp.opts.orient.swaps_axes();
    let mut key = vec![f64::NAN; nv];
    for (n, nd) in inp.nodes.iter().enumerate() {
        if let Some((px, py)) = nd.prev {
            let v = g.node_vertex[n];
            if matches!(g.kind[v], VK::Node(_)) && px.is_finite() && py.is_finite() {
                key[v] = if swaps { py } else { px };
            }
        }
    }
    for e in &g.edges {
        let c = &e.chain;
        let (a, b) = (key[c[0]], key[c[c.len() - 1]]);
        if a.is_finite() && b.is_finite() && c.len() > 2 {
            let m = (c.len() - 1) as f64;
            for k in 1..c.len() - 1 {
                key[c[k]] = a + (b - a) * k as f64 / m;
            }
        }
    }
    let mut by_rank: Vec<usize> = (0..nv).filter(|&v| !g.kind[v].is_border()).collect();
    by_rank.sort_by_key(|&v| (g.rank[v], v));
    for pass in 0..2 {
        let seq: Vec<usize> = if pass == 0 {
            by_rank.clone()
        } else {
            by_rank.iter().rev().copied().collect()
        };
        for v in seq {
            if key[v].is_finite() {
                continue;
            }
            let (mut s, mut n) = (0.0, 0.0);
            for &u in g.up[v].iter().chain(g.down[v].iter()) {
                if key[u].is_finite() {
                    s += key[u];
                    n += 1.0;
                }
            }
            if n > 0.0 {
                key[v] = s / n;
            }
        }
    }
    for v in 0..nv {
        if !key[v].is_finite() {
            key[v] = 1e9 + v as f64;
        }
    }
    key
}
