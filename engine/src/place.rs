//! Rank positions, group boxes, edge routes, radial mapping, and the final frame (rule 2).

use crate::graph::{Graph, Groups, NONE, VK};
use crate::math::{fabs, fmax, fmin, sincos, sqrt, PI};
use crate::types::{EdgeOut, GroupOut, Input, NodeOut, Orient, Output, Shape};
use alloc::vec;
use alloc::vec::Vec;

type P = (f64, f64);

/// Per-group padding at the low / high end of its rank (or ring) range, nested groups stacked.
struct Extras {
    f_lo: Vec<f64>,
    f_hi: Vec<f64>,
    lo_at: Vec<f64>,
    hi_at: Vec<f64>,
}

fn extras(
    gr: &Groups,
    lo: &[usize],
    hi: &[usize],
    n_idx: usize,
    pad: f64,
    header_lo: bool,
    header_hi: bool,
) -> Extras {
    let ng = gr.par.len();
    let mut f_lo = vec![0.0; ng];
    let mut f_hi = vec![0.0; ng];
    let mut lo_at = vec![0.0; n_idx.max(1)];
    let mut hi_at = vec![0.0; n_idx.max(1)];
    let mut by_depth: Vec<usize> = (0..ng).filter(|&g| gr.boxed[g]).collect();
    by_depth.sort_by(|a, b| gr.depth[*b].cmp(&gr.depth[*a]).then(a.cmp(b)));
    for &g in &by_depth {
        let mut a = 0.0f64;
        let mut b = 0.0f64;
        for &c in &gr.children[g] {
            if !gr.boxed[c] {
                continue;
            }
            if lo[c] == lo[g] {
                a = fmax(a, f_lo[c]);
            }
            if hi[c] == hi[g] {
                b = fmax(b, f_hi[c]);
            }
        }
        f_lo[g] = pad + if header_lo { gr.header[g] } else { 0.0 } + a;
        f_hi[g] = pad + if header_hi { gr.header[g] } else { 0.0 } + b;
        if lo[g] < lo_at.len() {
            lo_at[lo[g]] = fmax(lo_at[lo[g]], f_lo[g]);
        }
        if hi[g] < hi_at.len() {
            hi_at[hi[g]] = fmax(hi_at[hi[g]], f_hi[g]);
        }
    }
    Extras {
        f_lo,
        f_hi,
        lo_at,
        hi_at,
    }
}

fn straight(path: &mut Vec<P>, b: P) {
    let a = *path.last().unwrap();
    if fabs(a.0 - b.0) < 1e-9 && fabs(a.1 - b.1) < 1e-9 {
        return;
    }
    path.push((a.0 + (b.0 - a.0) / 3.0, a.1 + (b.1 - a.1) / 3.0));
    path.push((a.0 + 2.0 * (b.0 - a.0) / 3.0, a.1 + 2.0 * (b.1 - a.1) / 3.0));
    path.push(b);
}

/// S-curve along the flow axis (y in the layout frame).
fn flow_curve(path: &mut Vec<P>, b: P) {
    let a = *path.last().unwrap();
    let dy = (b.1 - a.1) * 0.5;
    path.push((a.0, a.1 + dy));
    path.push((b.0, b.1 - dy));
    path.push(b);
}

fn bez(p0: P, c1: P, c2: P, p1: P, t: f64) -> P {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (
        a * p0.0 + b * c1.0 + c * c2.0 + d * p1.0,
        a * p0.1 + b * c1.1 + c * c2.1 + d * p1.1,
    )
}

fn lerp(a: P, b: P, t: f64) -> P {
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

/// Split a cubic at t; returns (left, right) control polygons.
fn split(p0: P, c1: P, c2: P, p1: P, t: f64) -> ([P; 4], [P; 4]) {
    let a = lerp(p0, c1, t);
    let b = lerp(c1, c2, t);
    let c = lerp(c2, p1, t);
    let d = lerp(a, b, t);
    let e = lerp(b, c, t);
    let f = lerp(d, e, t);
    ([p0, a, d, f], [f, e, c, p1])
}

fn inside(p: P, c: P, hw: f64, hh: f64) -> bool {
    fabs(p.0 - c.0) <= hw && fabs(p.1 - c.1) <= hh
}

/// Trim a Bézier chain so it starts on the source's border and ends on the target's.
fn clip_ends(path: &mut Vec<P>, src: Option<(P, f64, f64)>, dst: Option<(P, f64, f64)>) {
    if path.len() < 4 {
        return;
    }
    if let Some((c, hw, hh)) = src {
        let (p0, c1, c2, p1) = (path[0], path[1], path[2], path[3]);
        if inside(p0, c, hw, hh) && !inside(p1, c, hw, hh) {
            let (mut lo, mut hi) = (0.0, 1.0);
            for _ in 0..40 {
                let m = (lo + hi) / 2.0;
                if inside(bez(p0, c1, c2, p1, m), c, hw, hh) {
                    lo = m;
                } else {
                    hi = m;
                }
            }
            let (_, r) = split(p0, c1, c2, p1, hi);
            path[0] = r[0];
            path[1] = r[1];
            path[2] = r[2];
        }
    }
    if let Some((c, hw, hh)) = dst {
        let n = path.len();
        let (p0, c1, c2, p1) = (path[n - 4], path[n - 3], path[n - 2], path[n - 1]);
        if inside(p1, c, hw, hh) && !inside(p0, c, hw, hh) {
            let (mut lo, mut hi) = (0.0, 1.0);
            for _ in 0..40 {
                let m = (lo + hi) / 2.0;
                if inside(bez(p0, c1, c2, p1, m), c, hw, hh) {
                    hi = m;
                } else {
                    lo = m;
                }
            }
            let (l, _) = split(p0, c1, c2, p1, lo);
            path[n - 3] = l[1];
            path[n - 2] = l[2];
            path[n - 1] = l[3];
        }
    }
}

pub(crate) struct Placed {
    pub x: Vec<f64>,
    pub layers: Vec<Vec<usize>>,
}

pub(crate) fn finish(inp: &Input, g: &Graph, gr: &Groups, pl: Placed, crossings: usize) -> Output {
    let o = &inp.opts;
    let nv = g.nv();
    let nr = g.nranks;
    let ng = gr.par.len();
    let orient = o.orient;
    let x = pl.x;
    let layers = pl.layers;
    let mut order = vec![0usize; nv];
    for l in &layers {
        for (i, &v) in l.iter().enumerate() {
            order[v] = i;
        }
    }
    let pad = o.group_pad;

    // Rank thickness along the flow (nodes, and bend points carrying a label).
    let body = |v: usize| g.kind[v].is_real() || g.fw[v] > 0.0;
    let mut thick = vec![0.0f64; nr.max(1)];
    for v in 0..nv {
        if body(v) {
            thick[g.rank[v]] = fmax(thick[g.rank[v]], g.h[v]);
        }
    }

    let mut pos: Vec<P> = vec![(0.0, 0.0); nv];
    let mut group_shapes: Vec<Shape> = vec![Shape::Hidden; ng];
    let mut group_labels: Vec<(f64, f64, f64)> = vec![(0.0, 0.0, 0.0); ng];
    let mut edge_paths: Vec<Vec<P>> = vec![Vec::new(); g.edges.len()];

    if !orient.is_radial() {
        // ---------- linear: compute in a top-to-bottom frame, then rotate ----------
        let header_lo = orient == Orient::TopToBottom;
        let header_hi = orient == Orient::BottomToTop;
        let ex = extras(
            gr,
            &gr.min_rank,
            &gr.max_rank,
            nr,
            pad,
            header_lo,
            header_hi,
        );
        let mut y = vec![0.0f64; nr.max(1)];
        for r in 0..nr {
            y[r] = if r == 0 {
                thick[0] / 2.0
            } else {
                y[r - 1]
                    + thick[r - 1] / 2.0
                    + ex.hi_at[r - 1]
                    + o.rank_sep
                    + ex.lo_at[r]
                    + thick[r] / 2.0
            };
        }
        for v in 0..nv {
            pos[v] = (x[v], y[g.rank[v]]);
        }
        let band_top = |r: usize| y[r] - thick[r] / 2.0;
        let band_bot = |r: usize| y[r] + thick[r] / 2.0;

        // Group boxes (frame coordinates).
        let mut boxes: Vec<(f64, f64, f64, f64)> = vec![(0.0, 0.0, 0.0, 0.0); ng];
        for gi in 0..ng {
            if !gr.boxed[gi] {
                continue;
            }
            let x0 = gr.left[gi].iter().map(|&v| x[v]).fold(f64::INFINITY, fmin);
            let x1 = gr.right[gi]
                .iter()
                .map(|&v| x[v])
                .fold(f64::NEG_INFINITY, fmax);
            let y0 = band_top(gr.min_rank[gi]) - ex.f_lo[gi];
            let y1 = band_bot(gr.max_rank[gi]) + ex.f_hi[gi];
            boxes[gi] = (x0, y0, x1, y1);
        }

        // Ports: fan several edges out along the entity's side instead of one point.
        let mut out_off = vec![0.0f64; g.edges.len()];
        let mut in_off = vec![0.0f64; g.edges.len()];
        let mut outs: Vec<Vec<(usize, f64)>> = vec![Vec::new(); nv];
        let mut ins: Vec<Vec<(usize, f64)>> = vec![Vec::new(); nv];
        for (i, e) in g.edges.iter().enumerate() {
            let c = &e.chain;
            outs[c[0]].push((i, x[c[1]]));
            ins[c[c.len() - 1]].push((i, x[c[c.len() - 2]]));
        }
        let spread = |list: &mut Vec<(usize, f64)>, w: f64, offs: &mut Vec<f64>| {
            list.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
            let n = list.len();
            if n <= 1 {
                return;
            }
            let span = fmin(0.6 * w, 14.0 * (n as f64 - 1.0));
            for (k, &(i, _)) in list.iter().enumerate() {
                offs[i] = -span / 2.0 + span * k as f64 / (n as f64 - 1.0);
            }
        };
        for v in 0..nv {
            let mut l = core::mem::take(&mut outs[v]);
            spread(&mut l, g.w[v], &mut out_off);
            let mut l = core::mem::take(&mut ins[v]);
            spread(&mut l, g.w[v], &mut in_off);
        }
        for (i, e) in g.edges.iter().enumerate() {
            let c = &e.chain;
            let f = c[0];
            let t = c[c.len() - 1];
            let start = (x[f] + out_off[i], y[g.rank[f]] + g.h[f] / 2.0);
            let mut path = vec![start];
            straight(&mut path, (start.0, band_bot(g.rank[f])));
            for &d in &c[1..c.len() - 1] {
                let r = g.rank[d];
                flow_curve(&mut path, (x[d], band_top(r)));
                straight(&mut path, (x[d], band_bot(r)));
            }
            let end = (x[t] + in_off[i], y[g.rank[t]] - g.h[t] / 2.0);
            flow_curve(&mut path, (end.0, band_top(g.rank[t])));
            straight(&mut path, end);
            edge_paths[i] = path;
        }

        // Rotate into the requested direction.
        let map = |p: P| -> P {
            match orient {
                Orient::TopToBottom => p,
                Orient::BottomToTop => (p.0, -p.1),
                Orient::LeftToRight => (p.1, p.0),
                _ => (-p.1, p.0),
            }
        };
        for v in 0..nv {
            pos[v] = map(pos[v]);
        }
        for path in edge_paths.iter_mut() {
            for p in path.iter_mut() {
                *p = map(*p);
            }
        }
        for gi in 0..ng {
            if !gr.boxed[gi] {
                continue;
            }
            let (x0, y0, x1, y1) = boxes[gi];
            let a = map((x0, y0));
            let b = map((x1, y1));
            let (rx, ry) = (fmin(a.0, b.0), fmin(a.1, b.1));
            let (rw, rh) = (fabs(a.0 - b.0), fabs(a.1 - b.1));
            group_shapes[gi] = Shape::Rect {
                x: rx,
                y: ry,
                w: rw,
                h: rh,
            };
            group_labels[gi] = (rx + pad, ry + pad, fmax(0.0, rw - 2.0 * pad));
        }
    } else {
        // ---------- radial: ranks become rings, cross-axis position becomes angle ----------
        let out = orient == Orient::InnerToOuter;
        let maxr = nr.saturating_sub(1);
        let ring = |r: usize| if out { r } else { maxr - r };
        let (mut xmin, mut xmax) = (f64::INFINITY, f64::NEG_INFINITY);
        for v in 0..nv {
            xmin = fmin(xmin, x[v] - g.w[v] / 2.0);
            xmax = fmax(xmax, x[v] + g.w[v] / 2.0);
        }
        let total = fmax(1.0, xmax - xmin + o.node_sep);
        let theta = |xv: f64| -PI / 2.0 + 2.0 * PI * (xv - xmin + o.node_sep / 2.0) / total;
        let mut th = vec![0.0f64; nv];
        for v in 0..nv {
            th[v] = theta(x[v]);
        }
        let rad_ext = |v: usize| {
            let (s, c) = sincos(th[v]);
            g.fw[v] * fabs(c) + g.fh[v] * fabs(s)
        };
        let tan_ext = |v: usize| {
            let (s, c) = sincos(th[v]);
            g.fw[v] * fabs(s) + g.fh[v] * fabs(c)
        };
        // Rings by ring index.
        let mut ring_layer: Vec<usize> = vec![0; nr.max(1)];
        for r in 0..nr {
            ring_layer[ring(r)] = r;
        }
        // Group extras in ring space (title on the outer side).
        let lo: Vec<usize> = (0..ng)
            .map(|gi| ring(gr.min_rank[gi]).min(ring(gr.max_rank[gi])))
            .collect();
        let hi: Vec<usize> = (0..ng)
            .map(|gi| ring(gr.min_rank[gi]).max(ring(gr.max_rank[gi])))
            .collect();
        let ex = extras(gr, &lo, &hi, nr, pad, false, true);
        let mut rad = vec![0.0f64; nr.max(1)];
        let mut radmax = vec![0.0f64; nr.max(1)];
        let mut center: usize = NONE;
        for k in 0..nr {
            let layer = &layers[ring_layer[k]];
            let members: Vec<usize> = layer
                .iter()
                .copied()
                .filter(|&v| !g.kind[v].is_border())
                .collect();
            if k == 0 && members.len() == 1 && g.kind[members[0]].is_real() {
                center = members[0];
                rad[0] = 0.0;
                radmax[0] = sqrt(g.fw[center] * g.fw[center] + g.fh[center] * g.fh[center]);
                continue;
            }
            let mut need = 0.0f64;
            for &v in &members {
                radmax[k] = fmax(radmax[k], rad_ext(v));
            }
            let m = members.len();
            if m >= 2 {
                for i in 0..m {
                    let (u, v) = (members[i], members[(i + 1) % m]);
                    let mut dth = th[v] - th[u];
                    if i + 1 == m {
                        dth += 2.0 * PI;
                    }
                    if dth <= 1e-9 {
                        continue;
                    }
                    let gap = if g.kind[u].is_real() && g.kind[v].is_real() {
                        o.node_sep
                    } else {
                        o.edge_sep
                    };
                    let req = (tan_ext(u) + tan_ext(v)) / 2.0 + gap;
                    let (s, _) = sincos(fmin(dth, PI) / 2.0);
                    need = fmax(need, req / (2.0 * fmax(s, 1e-3)));
                }
            }
            let base = if k == 0 {
                radmax[0] / 2.0 + o.rank_sep / 2.0
            } else {
                rad[k - 1] + ex.hi_at[k - 1] + o.rank_sep + ex.lo_at[k] + 24.0
            };
            let mut r = fmax(need, base);
            if k > 0 {
                // Push the ring out only as far as needed for its entities to clear every inner
                // entity (exact rectangle test), so rings stay tight where nothing faces them.
                let inner: Vec<(f64, f64, f64, f64)> = (0..k)
                    .flat_map(|j| {
                        let rj = rad[j];
                        layers[ring_layer[j]]
                            .iter()
                            .copied()
                            .filter(|&u| body(u))
                            .map(move |u| (u, rj))
                            .collect::<Vec<_>>()
                    })
                    .map(|(u, rj)| {
                        let (s, c) = sincos(th[u]);
                        let (cx, cy) = if u == center {
                            (0.0, 0.0)
                        } else {
                            (rj * c, rj * s)
                        };
                        (cx, cy, g.fw[u] / 2.0, g.fh[u] / 2.0)
                    })
                    .collect();
                let gap = o.node_sep;
                for _ in 0..2 {
                    for &v in &members {
                        if !body(v) {
                            continue;
                        }
                        let (s, c) = sincos(th[v]);
                        let (hw, hh) = (g.fw[v] / 2.0, g.fh[v] / 2.0);
                        let mut guard = 0;
                        loop {
                            let (x, y) = (r * c, r * s);
                            let hit = inner.iter().any(|&(ux, uy, uw, uh)| {
                                fabs(x - ux) < hw + uw + gap && fabs(y - uy) < hh + uh + gap
                            });
                            if !hit || guard > 400 {
                                break;
                            }
                            r += 6.0;
                            guard += 1;
                        }
                    }
                }
            }
            // Same ring: neighbours' boxes must not meet. The chord estimate above uses each
            // box's extent along its own tangent, which undershoots when neighbours sit at very
            // different angles, so check the boxes themselves and widen the ring until they clear.
            if k > 0 || center == NONE {
                let ring_bodies: Vec<usize> = members.iter().copied().filter(|&v| body(v)).collect();
                let nb = ring_bodies.len();
                if nb >= 2 {
                    // Two neighbours at radius r clear once their centres are far enough apart
                    // across (|r·Δcos| ≥ A) or up and down (|r·Δsin| ≥ B), so each pair needs
                    // r ≥ min(A/|Δcos|, B/|Δsin|): computed directly, not searched for.
                    let sc: Vec<(f64, f64)> = ring_bodies.iter().map(|&v| sincos(th[v])).collect();
                    let gap = o.edge_sep;
                    for i in 0..nb {
                        if nb == 2 && i == 1 {
                            break;
                        }
                        let j = (i + 1) % nb;
                        let (u, v) = (ring_bodies[i], ring_bodies[j]);
                        let (a, b) = ((g.fw[u] + g.fw[v]) / 2.0 + gap, (g.fh[u] + g.fh[v]) / 2.0 + gap);
                        let (dx, dy) = (fabs(sc[i].1 - sc[j].1), fabs(sc[i].0 - sc[j].0));
                        let need_x = if dx > 1e-12 { a / dx } else { f64::INFINITY };
                        let need_y = if dy > 1e-12 { b / dy } else { f64::INFINITY };
                        let need = if need_x < need_y { need_x } else { need_y };
                        if need.is_finite() && need > r {
                            // A hair over the minimum, so the boxes do not touch exactly.
                            r = need * 1.000_001;
                        }
                    }
                }
            }
            rad[k] = r;
        }
        for v in 0..nv {
            let k = ring(g.rank[v]);
            if v == center {
                pos[v] = (0.0, 0.0);
            } else {
                let (s, c) = sincos(th[v]);
                pos[v] = (rad[k] * c, rad[k] * s);
            }
        }
        let polar = |a: f64, r: f64| {
            let (s, c) = sincos(a);
            (r * c, r * s)
        };
        for (i, e) in g.edges.iter().enumerate() {
            let c = &e.chain;
            let mut path = vec![pos[c[0]]];
            for k in 1..c.len() {
                let (a, b) = (c[k - 1], c[k]);
                let (ra, rb) = (rad[ring(g.rank[a])], rad[ring(g.rank[b])]);
                let ta = if a == center { th[b] } else { th[a] };
                let tb = if b == center { th[a] } else { th[b] };
                let mid = (ra + rb) / 2.0;
                path.push(polar(ta, mid));
                path.push(polar(tb, mid));
                path.push(pos[b]);
            }
            let (f, t) = (c[0], c[c.len() - 1]);
            clip_ends(
                &mut path,
                Some((pos[f], g.fw[f] / 2.0, g.fh[f] / 2.0)),
                Some((pos[t], g.fw[t] / 2.0, g.fh[t] / 2.0)),
            );
            edge_paths[i] = path;
        }
        for gi in 0..ng {
            if !gr.boxed[gi] {
                continue;
            }
            let has_center = center != NONE && gr.contains(gi, g.parent[center]);
            let (mut a0, mut a1) = (f64::INFINITY, f64::NEG_INFINITY);
            for &v in &gr.left[gi] {
                a0 = fmin(a0, th[v]);
            }
            for &v in &gr.right[gi] {
                a1 = fmax(a1, th[v]);
            }
            let (klo, khi) = (lo[gi], hi[gi]);
            let r0 = if has_center || (klo == 0 && center != NONE) {
                0.0
            } else {
                fmax(0.0, rad[klo] - radmax[klo] / 2.0 - ex.f_lo[gi])
            };
            let r1 = rad[khi] + radmax[khi] / 2.0 + ex.f_hi[gi];
            if has_center {
                a0 = -PI / 2.0;
                a1 = 3.0 * PI / 2.0;
            }
            group_shapes[gi] = Shape::Sector {
                cx: 0.0,
                cy: 0.0,
                r0,
                r1,
                a0,
                a1,
            };
            let mid = (a0 + a1) / 2.0;
            let lw = fmin(fmax(80.0, (a1 - a0) * r1 * 0.8), 240.0);
            let (lx, ly) = polar(mid, r1 - pad - gr.header[gi] / 2.0);
            group_labels[gi] = (lx - lw / 2.0, ly - gr.header[gi] / 2.0, lw);
        }
    }

    // Back edges are drawn source → target: reverse their routed paths.
    for (i, e) in g.edges.iter().enumerate() {
        if e.rev {
            edge_paths[i].reverse();
        }
    }

    // ---------- bounds and translation ----------
    let (mut minx, mut miny, mut maxx, mut maxy) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    let mut grow = |p: P| {
        minx = fmin(minx, p.0);
        miny = fmin(miny, p.1);
        maxx = fmax(maxx, p.0);
        maxy = fmax(maxy, p.1);
    };
    for v in 0..nv {
        if body(v) {
            grow((pos[v].0 - g.fw[v] / 2.0, pos[v].1 - g.fh[v] / 2.0));
            grow((pos[v].0 + g.fw[v] / 2.0, pos[v].1 + g.fh[v] / 2.0));
        }
    }
    for path in &edge_paths {
        for &p in path {
            grow(p);
        }
    }
    for s in &group_shapes {
        match *s {
            Shape::Rect { x, y, w, h } => {
                grow((x, y));
                grow((x + w, y + h));
            }
            Shape::Sector {
                cx,
                cy,
                r0,
                r1,
                a0,
                a1,
            } => {
                for k in 0..=32 {
                    let a = a0 + (a1 - a0) * k as f64 / 32.0;
                    let (s, c) = sincos(a);
                    grow((cx + r1 * c, cy + r1 * s));
                    grow((cx + r0 * c, cy + r0 * s));
                }
            }
            _ => {}
        }
    }
    if !minx.is_finite() {
        minx = 0.0;
        miny = 0.0;
        maxx = 0.0;
        maxy = 0.0;
    }
    let (dx, dy) = (o.margin - minx, o.margin - miny);
    let sh = |p: P| (p.0 + dx, p.1 + dy);

    let mut outp = Output {
        width: maxx - minx + 2.0 * o.margin,
        height: maxy - miny + 2.0 * o.margin,
        crossings,
        ranks: nr,
        ..Default::default()
    };
    for n in 0..inp.nodes.len() {
        let v = g.node_vertex[n];
        let p = sh(pos[v]);
        outp.nodes.push(NodeOut {
            x: p.0,
            y: p.1,
            rank: g.rank[v] as i32,
            order: order[v] as i32,
            visible: matches!(g.kind[v], VK::Node(_)),
        });
    }
    for gi in 0..ng {
        let shape = if gr.proxy[gi] != NONE {
            let v = gr.proxy[gi];
            let p = sh(pos[v]);
            Shape::Proxy {
                x: p.0,
                y: p.1,
                w: g.fw[v],
                h: g.fh[v],
            }
        } else {
            match group_shapes[gi] {
                Shape::Rect { x, y, w, h } => {
                    let p = sh((x, y));
                    Shape::Rect {
                        x: p.0,
                        y: p.1,
                        w,
                        h,
                    }
                }
                Shape::Sector {
                    cx,
                    cy,
                    r0,
                    r1,
                    a0,
                    a1,
                } => {
                    let p = sh((cx, cy));
                    Shape::Sector {
                        cx: p.0,
                        cy: p.1,
                        r0,
                        r1,
                        a0,
                        a1,
                    }
                }
                _ => Shape::Hidden,
            }
        };
        let (lx, ly, lw) = group_labels[gi];
        let lp = sh((lx, ly));
        outp.groups.push(GroupOut {
            shape,
            label: (lp.0, lp.1, lw),
        });
    }
    for i in 0..inp.edges.len() {
        let li = g.edge_of_input[i];
        if li == NONE {
            outp.edges.push(EdgeOut {
                back: false,
                hidden: true,
                path: Vec::new(),
                label: None,
            });
        } else {
            let path: Vec<P> = edge_paths[li].iter().map(|&p| sh(p)).collect();
            let lv = g.edges[li].label_vertex;
            outp.edges.push(EdgeOut {
                back: g.edges[li].rev,
                hidden: false,
                path,
                label: if lv == NONE || inp.edges[i].label.is_none() {
                    None
                } else {
                    Some(sh(pos[lv]))
                },
            });
        }
    }
    outp
}
