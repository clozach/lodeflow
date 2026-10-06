//! Flat f64 wire format shared with JavaScript (no serde, no wasm-bindgen).
//!
//! Input:  [version, orient, bias_end, node_sep, rank_sep, edge_sep, group_pad, group_gap,
//!          incremental, margin, n_nodes, n_edges, n_groups, tight_groups, untangle, also]
//!         (also: 0 = one direction; code + 1 = also lay out in that direction, appending a
//!          second output block in the same format)
//!         nodes  × [w, h, group, prev_x, prev_y]          (NaN prev = none)
//!         edges  × [src, dst, flags, label_w, label_h]    (flags bit 0 = back hint; label_w 0 = no label)
//!         groups × [parent, collapsed, w, h, header]
//! Output: [version, width, height, n_nodes, n_edges, n_groups, crossings, ranks]
//!         nodes  × [x, y, rank, order, visible]
//!         groups × [kind, a, b, c, d, e, f, label_x, label_y, label_w]
//!                  kind 0 hidden · 1 rect(x,y,w,h) · 2 sector(cx,cy,r0,r1,a0,a1) · 3 proxy(cx,cy,w,h)
//!         edges  × [flags, label_x, label_y, n_points, x0, y0, x1, y1, …]
//!                  (flags bit 0 back, bit 1 hidden, bit 2 has a label)

use crate::types::*;
use alloc::vec::Vec;

pub const VERSION: f64 = 2.0;
pub const HEADER: usize = 16;

fn at(buf: &[f64], i: usize) -> f64 {
    buf.get(i).copied().unwrap_or(0.0)
}

pub fn decode(buf: &[f64]) -> Input {
    let d = Options::default();
    let pick = |i: usize, dflt: f64| {
        let v = at(buf, i);
        if v.is_finite() && v >= 0.0 {
            v
        } else {
            dflt
        }
    };
    let opts = Options {
        orient: Orient::from_code(at(buf, 1)),
        bias_end: at(buf, 2) != 0.0,
        node_sep: pick(3, d.node_sep),
        rank_sep: pick(4, d.rank_sep),
        edge_sep: pick(5, d.edge_sep),
        group_pad: pick(6, d.group_pad),
        group_gap: pick(7, d.group_gap),
        incremental: at(buf, 8) != 0.0,
        margin: pick(9, d.margin),
        tight_groups: at(buf, 13) != 0.0,
        untangle: at(buf, 14) != 0.0,
        also: if at(buf, 15) >= 1.0 { Some(Orient::from_code(at(buf, 15) - 1.0)) } else { None },
    };
    let count = |i: usize| {
        let v = at(buf, i);
        if v.is_finite() && v > 0.0 {
            v as usize
        } else {
            0
        }
    };
    let (nn, ne, ng) = (count(10), count(11), count(12));
    let mut p = HEADER;
    let mut nodes = Vec::with_capacity(nn);
    for _ in 0..nn {
        let (px, py) = (at(buf, p + 3), at(buf, p + 4));
        nodes.push(NodeIn {
            w: at(buf, p),
            h: at(buf, p + 1),
            group: at(buf, p + 2) as i32,
            prev: if px.is_finite() && py.is_finite() {
                Some((px, py))
            } else {
                None
            },
        });
        p += 5;
    }
    let mut edges = Vec::with_capacity(ne);
    for _ in 0..ne {
        let (s, t) = (at(buf, p), at(buf, p + 1));
        let (lw, lh) = (at(buf, p + 3), at(buf, p + 4));
        let label = if lw.is_finite() && lh.is_finite() && lw > 0.0 && lh > 0.0 {
            Some((lw, lh))
        } else {
            None
        };
        if s >= 0.0 && t >= 0.0 {
            edges.push(EdgeIn {
                src: s as usize,
                dst: t as usize,
                back_hint: (at(buf, p + 2) as i64) & 1 == 1,
                label,
            });
        } else {
            edges.push(EdgeIn {
                src: usize::MAX,
                dst: usize::MAX,
                back_hint: false,
                label: None,
            });
        }
        p += 5;
    }
    let mut groups = Vec::with_capacity(ng);
    for _ in 0..ng {
        groups.push(GroupIn {
            parent: at(buf, p) as i32,
            collapsed: at(buf, p + 1) != 0.0,
            w: at(buf, p + 2),
            h: at(buf, p + 3),
            header: at(buf, p + 4),
        });
        p += 5;
    }
    Input {
        opts,
        nodes,
        edges,
        groups,
    }
}

pub fn encode(out: &Output) -> Vec<f64> {
    let mut v: Vec<f64> =
        Vec::with_capacity(8 + out.nodes.len() * 5 + out.groups.len() * 10 + out.edges.len() * 20);
    v.extend_from_slice(&[
        VERSION,
        out.width,
        out.height,
        out.nodes.len() as f64,
        out.edges.len() as f64,
        out.groups.len() as f64,
        out.crossings as f64,
        out.ranks as f64,
    ]);
    for n in &out.nodes {
        v.extend_from_slice(&[
            n.x,
            n.y,
            n.rank as f64,
            n.order as f64,
            if n.visible { 1.0 } else { 0.0 },
        ]);
    }
    for g in &out.groups {
        let (lx, ly, lw) = g.label;
        match g.shape {
            Shape::Hidden => v.extend_from_slice(&[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, lx, ly, lw]),
            Shape::Rect { x, y, w, h } => {
                v.extend_from_slice(&[1.0, x, y, w, h, 0.0, 0.0, lx, ly, lw])
            }
            Shape::Sector {
                cx,
                cy,
                r0,
                r1,
                a0,
                a1,
            } => v.extend_from_slice(&[2.0, cx, cy, r0, r1, a0, a1, lx, ly, lw]),
            Shape::Proxy { x, y, w, h } => {
                v.extend_from_slice(&[3.0, x, y, w, h, 0.0, 0.0, lx, ly, lw])
            }
        }
    }
    for e in &out.edges {
        let flags = (if e.back { 1.0 } else { 0.0 })
            + (if e.hidden { 2.0 } else { 0.0 })
            + (if e.label.is_some() { 4.0 } else { 0.0 });
        let (lx, ly) = e.label.unwrap_or((0.0, 0.0));
        v.push(flags);
        v.push(lx);
        v.push(ly);
        v.push(e.path.len() as f64);
        for &(x, y) in &e.path {
            v.push(x);
            v.push(y);
        }
    }
    v
}

pub fn run(buf: &[f64]) -> Vec<f64> {
    let inp = decode(buf);
    match inp.opts.also {
        Some(o2) if o2 != inp.opts.orient => {
            let outs = crate::layout::layout_many(&inp, &[inp.opts.orient, o2]);
            let mut v = encode(&outs[0]);
            v.extend(encode(&outs[1]));
            v
        }
        _ => encode(&crate::layout::layout(&inp)),
    }
}
