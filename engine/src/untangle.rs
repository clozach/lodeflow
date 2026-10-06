//! Untangle: when no ordering of the ranks avoids a crossing, change the ranks. Nodes with
//! room to move try other ranks, and a move stays when it lowers the crossing cost without
//! adding a crossing line (see `layout.rs`, which calls this after the first ordering).

use crate::graph::{self, Graph};
use crate::order;
use crate::types::Input;
use alloc::vec::Vec;

/// The search has two budgets. By nodes: about 400 node-tries, so dozens of tries for a small
/// diagram and a handful for a large one (at least 4, at most 48). By work, counted in vertices
/// (nodes, bend points and group borders): each try rebuilds the graph and orders it, so its
/// cost follows vertices, and a small but dense or deeply grouped diagram can have thousands.
/// The smaller budget wins: past 5,400 vertices (about 250 flow-like nodes) there are no tries.
const UNTANGLE_WORK: usize = 5400;

/// How many tries a graph with `nodes` real nodes and `nv` vertices gets (0: skip untangling).
pub(crate) fn tries_for(nodes: usize, nv: usize) -> usize {
    (400 / nodes.max(1)).clamp(4, 48).min(UNTANGLE_WORK / nv.max(1))
}

/// The ordering only arranges entities within their ranks; which rank a node with room to
/// move takes can decide whether a crossing is avoidable at all. Try each such node at the
/// ends of its slack, keep the move that lowers the crossing cost most (lines, then group
/// outlines; ties: the move that keeps groups tightest, then the smallest), and repeat until
/// nothing improves. Returns the new graph, ranks and line crossings.
/// A move never adds a crossing line, even where it would remove more outline crossings.
pub(crate) fn untangle(inp: &Input, g0: &Graph, gr0: &graph::Groups, cost0: usize, cross0: usize) -> Option<(Graph, graph::Groups, Vec<Vec<usize>>, usize)> {
    let span = |gr: &graph::Groups| -> usize {
        (0..gr.par.len()).filter(|&k| gr.boxed[k]).map(|k| gr.max_rank[k] - gr.min_rank[k]).sum()
    };
    let mut adjust: Vec<(usize, usize)> = Vec::new();
    let mut best: Option<(Graph, graph::Groups, Vec<Vec<usize>>, usize)> = None;
    let mut cur_cost = cost0;
    let mut cur_cross = cross0;
    let _ = span(gr0);
    // Layout reruns while someone edits, so the search has a budget (see `tries_for`; each try a
    // quick two-start ordering), and at most three settled moves (each a full ordering).
    let mut tries_left = tries_for(g0.nv0, g0.nv());
    for _round in 0..3 {
        let g = best.as_ref().map(|b| &b.0).unwrap_or(g0);
        let mut cands: Vec<(usize, usize)> = Vec::new();
        for v in 0..g.nv0 {
            let (lo, hi) = g.slack[v];
            for t in [lo, hi] {
                if t != g.rank[v] && !cands.contains(&(v, t)) {
                    cands.push((v, t));
                }
            }
        }
        let mut pick: Option<((usize, usize, usize), (usize, usize), Graph, graph::Groups, Vec<Vec<usize>>, usize)> = None;
        for (v, t) in cands {
            if tries_left == 0 {
                break;
            }
            tries_left -= 1;
            let mut adj = adjust.clone();
            adj.push((v, t));
            let (g2, gr2) = graph::build(inp, &adj);
            if g2.rank[v] != t {
                continue;
            }
            let (l2, c2, k2) = order::Orderer { g: &g2, gr: &gr2 }.run(None, Some(2));
            if k2 >= cur_cost || c2 > cur_cross {
                continue;
            }
            let moved = (g.rank[v] as isize - t as isize).unsigned_abs();
            let key = (k2, if inp.opts.tight_groups { span(&gr2) } else { 0 }, moved);
            if pick.as_ref().map_or(true, |p| key < p.0) {
                pick = Some((key, (v, t), g2, gr2, l2, c2));
            }
        }
        let Some((key, mv, g2, gr2, l2, c2)) = pick else { break };
        adjust.push(mv);
        // A settled move gets the full ordering effort (keep the try's order if that is better).
        let (l3, c3, k3) = order::Orderer { g: &g2, gr: &gr2 }.run(None, None);
        let (l, c, k) = if k3 <= key.0 && c3 <= c2 { (l3, c3, k3) } else { (l2, c2, key.0) };
        cur_cost = k;
        cur_cross = c;
        best = Some((g2, gr2, l, c));
        if cur_cost == 0 || tries_left == 0 {
            break;
        }
    }
    best
}
