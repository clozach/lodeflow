//! Cross-axis coordinates: Brandes–Köpf alignment with block-graph compaction
//! (the variant dagre uses), balanced across the four alignments.

use crate::graph::{Graph, VK};
use alloc::collections::BTreeSet;
use alloc::vec;
use alloc::vec::Vec;

fn norm(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// An inner segment: both ends are bend points, or both belong to one group border chain.
fn inner(g: &Graph, u: usize, v: usize) -> bool {
    match (g.kind[u], g.kind[v]) {
        (VK::Dummy, VK::Dummy) => true,
        (VK::BorderL(a), VK::BorderL(b)) | (VK::BorderR(a), VK::BorderR(b)) => a == b,
        _ => false,
    }
}

/// The size-independent half of Brandes–Köpf: conflicts and the four vertical alignments depend
/// only on the order, so Auto's two directions share them and only compaction runs twice.
pub(crate) struct Aligned {
    /// For each of the four alignments: every vertex's block root.
    roots: Vec<Vec<usize>>,
}

pub(crate) fn assign(
    g: &Graph,
    layers: &[Vec<usize>],
    sep: &dyn Fn(usize, usize) -> f64,
) -> Vec<f64> {
    compact(g, layers, &align(g, layers), sep)
}

pub(crate) fn align(g: &Graph, layers: &[Vec<usize>]) -> Aligned {
    let n = g.nv();
    let mut pos = vec![0usize; n];
    for layer in layers {
        for (i, &v) in layer.iter().enumerate() {
            pos[v] = i;
        }
    }
    // Type-1 conflicts: a non-inner segment crossing an inner one.
    let mut conflicts: BTreeSet<(usize, usize)> = BTreeSet::new();
    for r in 1..layers.len() {
        let prev = &layers[r - 1];
        let layer = &layers[r];
        if layer.is_empty() {
            continue;
        }
        let mut k0 = 0usize;
        let mut scan = 0usize;
        let last = layer.len() - 1;
        for (i, &v) in layer.iter().enumerate() {
            let w = g.up[v].iter().copied().find(|&u| inner(g, u, v));
            let k1 = match w {
                Some(u) => pos[u],
                None => prev.len(),
            };
            if w.is_some() || i == last {
                for &sv in &layer[scan..=i] {
                    for &u in &g.up[sv] {
                        let up = pos[u];
                        if (up < k0 || k1 < up) && !inner(g, u, sv) {
                            conflicts.insert(norm(u, sv));
                        }
                    }
                }
                scan = i + 1;
                k0 = k1;
            }
        }
    }

    // Border chains win every crossing: any other segment that crosses a group border
    // gives way, so each border stays one straight block and a box never swallows an outsider.
    let mut bsegs: Vec<(usize, usize)> = Vec::new();
    for r in 1..layers.len() {
        bsegs.clear();
        for &v in &layers[r] {
            if g.kind[v].is_border() {
                for &u in &g.up[v] {
                    if inner(g, u, v) {
                        bsegs.push((pos[u], pos[v]));
                    }
                }
            }
        }
        if bsegs.is_empty() {
            continue;
        }
        for &v in &layers[r] {
            for &u in &g.up[v] {
                if g.kind[v].is_border() && inner(g, u, v) {
                    continue;
                }
                if bsegs.iter().any(|&(bu, bv)| (pos[u] < bu) != (pos[v] < bv)) {
                    conflicts.insert(norm(u, v));
                }
            }
        }
    }

    let mut roots_all: Vec<Vec<usize>> = Vec::with_capacity(4);
    for dir in 0..4 {
        let from_bottom = dir >= 2;
        let right = dir % 2 == 1;
        let mut adj: Vec<Vec<usize>> = if from_bottom {
            layers.iter().rev().cloned().collect()
        } else {
            layers.to_vec()
        };
        if right {
            for l in adj.iter_mut() {
                l.reverse();
            }
        }
        let nbrs = |v: usize| -> &Vec<usize> {
            if from_bottom {
                &g.down[v]
            } else {
                &g.up[v]
            }
        };
        // Vertical alignment.
        let mut root: Vec<usize> = (0..n).collect();
        let mut align: Vec<usize> = (0..n).collect();
        let mut apos = vec![0usize; n];
        for l in &adj {
            for (i, &v) in l.iter().enumerate() {
                apos[v] = i;
            }
        }
        let mut ws: Vec<usize> = Vec::new();
        for l in &adj {
            let mut prev_idx: isize = -1;
            for &v in l {
                ws.clear();
                ws.extend_from_slice(nbrs(v));
                if ws.is_empty() {
                    continue;
                }
                ws.sort_by_key(|&w| apos[w]);
                let d = ws.len();
                let (lo, hi) = ((d - 1) / 2, d / 2);
                for m in lo..=hi {
                    let w = ws[m];
                    if align[v] == v
                        && prev_idx < apos[w] as isize
                        && !conflicts.contains(&norm(v, w))
                    {
                        align[w] = v;
                        root[v] = root[w];
                        align[v] = root[v];
                        prev_idx = apos[w] as isize;
                    }
                }
            }
        }
        roots_all.push(root);
    }
    Aligned { roots: roots_all }
}

/// The size-dependent half: compacts each alignment's blocks with `sep`, then balances the four.
pub(crate) fn compact(g: &Graph, layers: &[Vec<usize>], al: &Aligned, sep: &dyn Fn(usize, usize) -> f64) -> Vec<f64> {
    let n = g.nv();
    let mut results: Vec<Vec<f64>> = Vec::with_capacity(4);
    for dir in 0..4 {
        let from_bottom = dir >= 2;
        let right = dir % 2 == 1;
        let root = &al.roots[dir];
        let mut adj: Vec<Vec<usize>> = if from_bottom {
            layers.iter().rev().cloned().collect()
        } else {
            layers.to_vec()
        };
        if right {
            for l in adj.iter_mut() {
                l.reverse();
            }
        }
        // Horizontal compaction over the block graph.
        let mut out_e: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
        let mut in_e: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
        for l in &adj {
            for k in 1..l.len() {
                let (u, v) = (l[k - 1], l[k]);
                let s = if right { sep(v, u) } else { sep(u, v) };
                let (ru, rv) = (root[u], root[v]);
                out_e[ru].push((rv, s));
                in_e[rv].push((ru, s));
            }
        }
        let roots: Vec<usize> = (0..n).filter(|&v| root[v] == v).collect();
        let mut indeg = vec![0usize; n];
        for &r in &roots {
            for &(c, _) in &out_e[r] {
                indeg[c] += 1;
            }
        }
        let mut order: Vec<usize> = roots.iter().copied().filter(|&r| indeg[r] == 0).collect();
        let mut head = 0;
        while head < order.len() {
            let r = order[head];
            head += 1;
            for &(c, _) in &out_e[r] {
                indeg[c] -= 1;
                if indeg[c] == 0 {
                    order.push(c);
                }
            }
        }
        if order.len() < roots.len() {
            // Should not happen; keep going with whatever is left.
            let mut inq = vec![false; n];
            for &r in &order {
                inq[r] = true;
            }
            for &r in &roots {
                if !inq[r] {
                    order.push(r);
                }
            }
        }
        let mut xs = vec![0.0f64; n];
        for &r in &order {
            let mut x = 0.0f64;
            for &(p, s) in &in_e[r] {
                let c = xs[p] + s;
                if c > x {
                    x = c;
                }
            }
            xs[r] = x;
        }
        let keep = |v: usize| match g.kind[v] {
            VK::BorderR(_) => !right,
            VK::BorderL(_) => right,
            _ => false,
        };
        for &r in order.iter().rev() {
            let mut min = f64::INFINITY;
            for &(c, s) in &out_e[r] {
                let m = xs[c] - s;
                if m < min {
                    min = m;
                }
            }
            if min.is_finite() && !keep(r) && min > xs[r] {
                xs[r] = min;
            }
        }
        let mut x = vec![0.0f64; n];
        for v in 0..n {
            x[v] = xs[root[v]];
            if right {
                x[v] = -x[v];
            }
        }
        results.push(x);
    }

    // Align all four to the narrowest, then take the average of the two median candidates.
    let ext = |xs: &Vec<f64>| -> (f64, f64, f64, f64) {
        let (mut lo, mut hi, mut xmin, mut xmax) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for v in 0..n {
            let h = g.w[v] / 2.0;
            lo = lo.min(xs[v] - h);
            hi = hi.max(xs[v] + h);
            xmin = xmin.min(xs[v]);
            xmax = xmax.max(xs[v]);
        }
        (lo, hi, xmin, xmax)
    };
    let mut best = 0;
    let mut best_w = f64::INFINITY;
    for (k, xs) in results.iter().enumerate() {
        let (lo, hi, _, _) = ext(xs);
        if hi - lo < best_w {
            best_w = hi - lo;
            best = k;
        }
    }
    let (_, _, ref_min, ref_max) = ext(&results[best]);
    for k in 0..4 {
        if k == best {
            continue;
        }
        let (_, _, mn, mx) = ext(&results[k]);
        let delta = if k % 2 == 0 {
            ref_min - mn
        } else {
            ref_max - mx
        };
        for v in 0..n {
            results[k][v] += delta;
        }
    }
    let mut x = vec![0.0f64; n];
    for v in 0..n {
        let mut c = [results[0][v], results[1][v], results[2][v], results[3][v]];
        c.sort_by(|a, b| a.total_cmp(b));
        x[v] = (c[1] + c[2]) / 2.0;
    }
    // Balancing can, rarely, pull neighbours too close: push right until every gap holds.
    for layer in layers {
        for k in 1..layer.len() {
            let (u, v) = (layer[k - 1], layer[k]);
            let need = x[u] + sep(u, v);
            if x[v] < need - 1e-9 {
                x[v] = need;
            }
        }
    }
    x
}
