//! Builds the layered graph: collapse groups (rule 7), pick back edges (rule 6),
//! assign ranks with bias (rules 3–4), split long edges, and add group borders.

use crate::types::Input;
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

pub(crate) const NONE: usize = usize::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum VK {
    Node(usize),
    Proxy(usize),
    Dummy,
    BorderL(usize),
    BorderR(usize),
}

impl VK {
    pub fn is_border(self) -> bool {
        matches!(self, VK::BorderL(_) | VK::BorderR(_))
    }
    pub fn is_real(self) -> bool {
        matches!(self, VK::Node(_) | VK::Proxy(_))
    }
}

/// A layout edge: one or more input edges between the same pair of vertices.
pub(crate) struct LEdge {
    pub a: usize,
    pub b: usize,
    pub hint: bool,
    /// Label size (final frame), carried by the middle bend point.
    pub label: Option<(f64, f64)>,
    /// The bend point that carries the label (NONE without one).
    pub label_vertex: usize,
    /// Rule 6: reversed for layout; drawn the original way round.
    pub rev: bool,
    /// Vertices from the upstream end to the downstream end, dummies in between.
    pub chain: Vec<usize>,
}

pub(crate) struct Graph {
    pub kind: Vec<VK>,
    /// Frame sizes: `w` across the flow, `h` along it.
    pub w: Vec<f64>,
    pub h: Vec<f64>,
    /// Final-frame size (what the renderer sees).
    pub fw: Vec<f64>,
    pub fh: Vec<f64>,
    /// Innermost expanded group, or -1.
    pub parent: Vec<i32>,
    pub rank: Vec<usize>,
    pub up: Vec<Vec<usize>>,
    pub down: Vec<Vec<usize>>,
    pub edges: Vec<LEdge>,
    /// Input edge → layout edge (NONE when hidden inside a collapsed group or invalid).
    pub edge_of_input: Vec<usize>,
    /// Input node → vertex that represents it.
    pub node_vertex: Vec<usize>,
    pub nranks: usize,
    /// Vertices before bend points and borders were added (nodes and group proxies).
    pub nv0: usize,
    /// For those vertices: the ranks each could take without breaking rule 3 (others fixed).
    pub slack: Vec<(usize, usize)>,
}

pub(crate) struct Groups {
    pub par: Vec<i32>,
    pub depth: Vec<usize>,
    /// Outermost collapsed group among self + ancestors, or -1.
    pub top_collapsed: Vec<i32>,
    /// Drawn as a single node (collapsed, or expanded but empty).
    pub proxy: Vec<usize>,
    /// Drawn as a box around its members.
    pub boxed: Vec<bool>,
    pub min_rank: Vec<usize>,
    pub max_rank: Vec<usize>,
    /// Border vertices per rank (index = rank - min_rank).
    pub left: Vec<Vec<usize>>,
    pub right: Vec<Vec<usize>>,
    pub header: Vec<f64>,
    pub children: Vec<Vec<usize>>,
}

impl Groups {
    pub fn borders_at(&self, g: usize, r: usize) -> (Option<usize>, Option<usize>) {
        if !self.boxed[g] || r < self.min_rank[g] || r > self.max_rank[g] {
            return (None, None);
        }
        let i = r - self.min_rank[g];
        (Some(self.left[g][i]), Some(self.right[g][i]))
    }
    pub fn contains(&self, g: usize, mut c: i32) -> bool {
        while c >= 0 {
            if c as usize == g {
                return true;
            }
            c = self.par[c as usize];
        }
        false
    }
}

impl Graph {
    fn add(
        &mut self,
        kind: VK,
        w: f64,
        h: f64,
        fw: f64,
        fh: f64,
        parent: i32,
        rank: usize,
    ) -> usize {
        self.kind.push(kind);
        self.w.push(w);
        self.h.push(h);
        self.fw.push(fw);
        self.fh.push(fh);
        self.parent.push(parent);
        self.rank.push(rank);
        self.up.push(Vec::new());
        self.down.push(Vec::new());
        self.kind.len() - 1
    }
    pub fn nv(&self) -> usize {
        self.kind.len()
    }
    fn seg(&mut self, u: usize, v: usize) {
        self.down[u].push(v);
        self.up[v].push(u);
    }
}

fn clean(x: f64, dflt: f64) -> f64 {
    if x.is_finite() && x >= 0.0 {
        x
    } else {
        dflt
    }
}

/// `adjust` moves vertices to other ranks within their slack (untangling, see `layout.rs`);
/// each move is re-checked against the ranks at the time it is applied.
pub(crate) fn build(inp: &Input, adjust: &[(usize, usize)]) -> (Graph, Groups) {
    let o = &inp.opts;
    let nn = inp.nodes.len();
    let ng = inp.groups.len();
    let swap = o.orient.swaps_axes();

    // ---- group hierarchy (sanitised: bad parents and parent cycles are cut) ----
    let mut par: Vec<i32> = inp.groups.iter().map(|g| g.parent).collect();
    for g in 0..ng {
        let p = par[g];
        if p < 0 || p as usize >= ng || p as usize == g {
            par[g] = -1;
        }
    }
    for g in 0..ng {
        let mut c = par[g];
        let mut steps = 0;
        while c >= 0 {
            steps += 1;
            if steps > ng {
                par[g] = -1;
                break;
            }
            c = par[c as usize];
        }
    }
    let depth: Vec<usize> = (0..ng)
        .map(|g| {
            let mut d = 0;
            let mut c = par[g];
            while c >= 0 {
                d += 1;
                c = par[c as usize];
            }
            d
        })
        .collect();
    let mut top_collapsed = vec![-1i32; ng];
    for g in 0..ng {
        let mut c = g as i32;
        while c >= 0 {
            if inp.groups[c as usize].collapsed {
                top_collapsed[g] = c;
            }
            c = par[c as usize];
        }
    }
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); ng];
    for g in 0..ng {
        if par[g] >= 0 {
            children[par[g] as usize].push(g);
        }
    }

    let mut gr = Groups {
        par,
        depth,
        top_collapsed,
        proxy: vec![NONE; ng],
        boxed: vec![false; ng],
        min_rank: vec![0; ng],
        max_rank: vec![0; ng],
        left: vec![Vec::new(); ng],
        right: vec![Vec::new(); ng],
        header: inp.groups.iter().map(|g| clean(g.header, 0.0)).collect(),
        children,
    };

    let mut g = Graph {
        kind: Vec::new(),
        w: Vec::new(),
        h: Vec::new(),
        fw: Vec::new(),
        fh: Vec::new(),
        parent: Vec::new(),
        rank: Vec::new(),
        up: Vec::new(),
        down: Vec::new(),
        edges: Vec::new(),
        edge_of_input: vec![NONE; inp.edges.len()],
        node_vertex: vec![NONE; nn],
        nranks: 0,
        nv0: 0,
        slack: Vec::new(),
    };

    let frame = |w: f64, h: f64| if swap { (h, w) } else { (w, h) };

    // ---- vertices: visible nodes, and one proxy per outermost collapsed group ----
    for n in 0..nn {
        let nd = &inp.nodes[n];
        let gi = if nd.group >= 0 && (nd.group as usize) < ng {
            nd.group
        } else {
            -1
        };
        let top = if gi >= 0 {
            gr.top_collapsed[gi as usize]
        } else {
            -1
        };
        if top >= 0 {
            let t = top as usize;
            if gr.proxy[t] == NONE {
                let gi_ = &inp.groups[t];
                let (fw, fh) = (clean(gi_.w, 120.0), clean(gi_.h, 40.0));
                let (w, h) = frame(fw, fh);
                gr.proxy[t] = g.add(VK::Proxy(t), w, h, fw, fh, gr.par[t], 0);
            }
            g.node_vertex[n] = gr.proxy[t];
        } else {
            let (fw, fh) = (clean(nd.w, 120.0), clean(nd.h, 40.0));
            let (w, h) = frame(fw, fh);
            g.node_vertex[n] = g.add(VK::Node(n), w, h, fw, fh, gi, 0);
        }
    }
    for t in 0..ng {
        if gr.top_collapsed[t] == t as i32 && gr.proxy[t] == NONE {
            let gi_ = &inp.groups[t];
            let (fw, fh) = (clean(gi_.w, 120.0), clean(gi_.h, 40.0));
            let (w, h) = frame(fw, fh);
            gr.proxy[t] = g.add(VK::Proxy(t), w, h, fw, fh, gr.par[t], 0);
        }
    }
    // Expanded groups with nothing inside are drawn as a node so they stay visible.
    let mut content = vec![false; ng];
    for v in 0..g.nv() {
        let mut c = g.parent[v];
        while c >= 0 {
            content[c as usize] = true;
            c = gr.par[c as usize];
        }
    }
    let mut by_depth: Vec<usize> = (0..ng).collect();
    by_depth.sort_by(|a, b| gr.depth[*b].cmp(&gr.depth[*a]).then(a.cmp(b)));
    for &t in &by_depth {
        if gr.top_collapsed[t] < 0 && !content[t] {
            let gi_ = &inp.groups[t];
            let (fw, fh) = (clean(gi_.w, 120.0), clean(gi_.h, 40.0));
            let (w, h) = frame(fw, fh);
            gr.proxy[t] = g.add(VK::Proxy(t), w, h, fw, fh, gr.par[t], 0);
            let mut c = gr.par[t];
            while c >= 0 {
                content[c as usize] = true;
                c = gr.par[c as usize];
            }
        }
    }
    let nv0 = g.nv();

    // ---- layout edges (duplicates merged, collapsed-internal edges hidden) ----
    let mut seen: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    for (i, e) in inp.edges.iter().enumerate() {
        if e.src >= nn || e.dst >= nn || e.src == e.dst {
            continue;
        }
        let (a, b) = (g.node_vertex[e.src], g.node_vertex[e.dst]);
        if a == b {
            continue;
        }
        // Duplicates share one route, except labelled edges: each keeps its own bend point for its label.
        let shared = if e.label.is_some() { None } else { seen.get(&(a, b)).copied() };
        let li = match shared {
            Some(li) => li,
            None => {
                g.edges.push(LEdge {
                    a,
                    b,
                    hint: e.back_hint,
                    label: e.label,
                    label_vertex: NONE,
                    rev: false,
                    chain: Vec::new(),
                });
                let li = g.edges.len() - 1;
                if e.label.is_none() {
                    seen.insert((a, b), li);
                }
                li
            }
        };
        if g.edges[li].label.is_none() {
            g.edges[li].label = e.label;
        }
        g.edge_of_input[i] = li;
    }

    // ---- rule 6: an edge that would close a loop becomes a back edge ----
    // Edges are accepted in creation order (hinted back edges last), so the
    // edge that closes a loop is the one reversed — the way Flying Logic does it.
    let mut order_e: Vec<usize> = (0..g.edges.len()).collect();
    order_e.sort_by_key(|&i| (g.edges[i].hint as u8, i));
    let mut fwd: Vec<Vec<usize>> = vec![Vec::new(); nv0];
    let mut mark = vec![0u32; nv0];
    let mut stamp = 0u32;
    let mut stack: Vec<usize> = Vec::new();
    for &i in &order_e {
        let (a, b) = (g.edges[i].a, g.edges[i].b);
        stamp += 1;
        stack.clear();
        stack.push(b);
        mark[b] = stamp;
        let mut found = false;
        while let Some(x) = stack.pop() {
            if x == a {
                found = true;
                break;
            }
            for &y in &fwd[x] {
                if mark[y] != stamp {
                    mark[y] = stamp;
                    stack.push(y);
                }
            }
        }
        if found {
            g.edges[i].rev = true;
        } else {
            fwd[a].push(b);
        }
    }

    // ---- rules 3–4: ranks. Start bias = as early as possible; End bias = as late as possible ----
    // A labelled edge spans at least two ranks, so it has a bend point to carry its label.
    let mut succ: Vec<Vec<(usize, usize)>> = vec![Vec::new(); nv0];
    let mut indeg = vec![0usize; nv0];
    for e in &g.edges {
        let (f, t) = if e.rev { (e.b, e.a) } else { (e.a, e.b) };
        succ[f].push((t, if e.label.is_some() { 2 } else { 1 }));
        indeg[t] += 1;
    }
    let mut topo: Vec<usize> = (0..nv0).filter(|&v| indeg[v] == 0).collect();
    let mut head = 0;
    while head < topo.len() {
        let v = topo[head];
        head += 1;
        for &(w, _) in &succ[v] {
            indeg[w] -= 1;
            if indeg[w] == 0 {
                topo.push(w);
            }
        }
    }
    let mut rank = vec![0usize; nv0];
    for &v in &topo {
        for &(w, len) in &succ[v] {
            if rank[w] < rank[v] + len {
                rank[w] = rank[v] + len;
            }
        }
    }
    if o.bias_end {
        let maxr = rank.iter().copied().max().unwrap_or(0);
        for &v in topo.iter().rev() {
            rank[v] = if succ[v].is_empty() {
                maxr
            } else {
                succ[v].iter().map(|&(w, len)| rank[w] - len).min().unwrap_or(maxr)
            };
        }
    }
    if o.tight_groups {
        tighten(&mut rank, &succ, &g.parent, &gr.par);
    }
    let mut pred: Vec<Vec<(usize, usize)>> = vec![Vec::new(); nv0];
    for u in 0..nv0 {
        for &(w, len) in &succ[u] {
            pred[w].push((u, len));
        }
    }
    let maxr = rank.iter().copied().max().unwrap_or(0);
    let slack_of = |v: usize, rank: &[usize]| {
        let lo = pred[v].iter().map(|&(u, len)| rank[u] + len).max().unwrap_or(0);
        let hi = succ[v].iter().map(|&(w, len)| rank[w].saturating_sub(len)).min().unwrap_or(maxr);
        (lo, hi.max(lo))
    };
    for &(v, r) in adjust {
        if v < nv0 {
            let (lo, hi) = slack_of(v, &rank);
            if lo <= r && r <= hi {
                rank[v] = r;
            }
        }
    }
    g.nv0 = nv0;
    g.slack = (0..nv0).map(|v| slack_of(v, &rank)).collect();
    for v in 0..nv0 {
        g.rank[v] = rank[v];
    }

    // ---- split long edges into chains of bend points ----
    for i in 0..g.edges.len() {
        let (f, t) = if g.edges[i].rev {
            (g.edges[i].b, g.edges[i].a)
        } else {
            (g.edges[i].a, g.edges[i].b)
        };
        let lca = lca(&gr, g.parent[f], g.parent[t]);
        let mut chain = vec![f];
        let (rf, rt) = (g.rank[f], g.rank[t]);
        let label_rank = g.edges[i].label.map(|_| rf + (rt - rf) / 2);
        for r in rf + 1..rt {
            let d = match (label_rank, g.edges[i].label) {
                (Some(lr), Some((fw, fh))) if lr == r => {
                    let (w, h) = frame(fw, fh);
                    let d = g.add(VK::Dummy, w, h, fw, fh, lca, r);
                    g.edges[i].label_vertex = d;
                    d
                }
                _ => g.add(VK::Dummy, 0.0, 0.0, 0.0, 0.0, lca, r),
            };
            chain.push(d);
        }
        chain.push(t);
        for k in 0..chain.len() - 1 {
            let (u, v) = (chain[k], chain[k + 1]);
            g.seg(u, v);
        }
        g.edges[i].chain = chain;
    }

    // ---- group rank ranges and border chains (keep members together, rule 7) ----
    let mut gmin = vec![usize::MAX; ng];
    let mut gmax = vec![0usize; ng];
    for v in 0..g.nv() {
        let r = g.rank[v];
        let mut c = g.parent[v];
        while c >= 0 {
            let cu = c as usize;
            if r < gmin[cu] {
                gmin[cu] = r;
            }
            if r > gmax[cu] {
                gmax[cu] = r;
            }
            c = gr.par[cu];
        }
    }
    for gi in 0..ng {
        let boxed = gr.top_collapsed[gi] < 0 && gr.proxy[gi] == NONE && gmin[gi] != usize::MAX;
        gr.boxed[gi] = boxed;
        if !boxed {
            continue;
        }
        gr.min_rank[gi] = gmin[gi];
        gr.max_rank[gi] = gmax[gi];
        for r in gmin[gi]..=gmax[gi] {
            let l = g.add(VK::BorderL(gi), 0.0, 0.0, 0.0, 0.0, gi as i32, r);
            let rr = g.add(VK::BorderR(gi), 0.0, 0.0, 0.0, 0.0, gi as i32, r);
            if let (Some(&pl), Some(&pr)) = (gr.left[gi].last(), gr.right[gi].last()) {
                g.seg(pl, l);
                g.seg(pr, rr);
            }
            gr.left[gi].push(l);
            gr.right[gi].push(rr);
        }
    }
    g.nranks = if g.nv() == 0 {
        0
    } else {
        g.rank.iter().copied().max().unwrap_or(0) + 1
    };
    (g, gr)
}

/// Tight groups: move each group member toward the median rank of the rest of its group, but only
/// within the slack its causes and effects leave, so rule 3 still holds and no rank is added.
/// A vertex counts toward every group that contains it, innermost first.
fn tighten(rank: &mut [usize], succ: &[Vec<(usize, usize)>], parent: &[i32], gpar: &[i32]) {
    let nv = rank.len();
    if nv == 0 {
        return;
    }
    let mut pred: Vec<Vec<(usize, usize)>> = vec![Vec::new(); nv];
    for u in 0..nv {
        for &(w, len) in &succ[u] {
            pred[w].push((u, len));
        }
    }
    let maxr = rank.iter().copied().max().unwrap_or(0);
    let mut members: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
    for v in 0..nv {
        if parent[v] >= 0 {
            members.entry(parent[v]).or_default().push(v);
        }
    }
    if members.is_empty() {
        return;
    }
    let mut ranks_buf: Vec<usize> = Vec::new();
    for _pass in 0..6 {
        let mut moved = false;
        for v in 0..nv {
            let p = parent[v];
            if p < 0 {
                continue;
            }
            // The innermost group with other members decides the pull.
            let mut gi = p;
            let target = loop {
                ranks_buf.clear();
                for (&g, list) in members.iter() {
                    let mut c = g;
                    let mut inside = false;
                    while c >= 0 {
                        if c == gi {
                            inside = true;
                            break;
                        }
                        c = gpar[c as usize];
                    }
                    if inside {
                        ranks_buf.extend(list.iter().filter(|&&u| u != v).map(|&u| rank[u]));
                    }
                }
                if !ranks_buf.is_empty() {
                    ranks_buf.sort_unstable();
                    break Some(ranks_buf[(ranks_buf.len() - 1) / 2]);
                }
                gi = gpar[gi as usize];
                if gi < 0 {
                    break None;
                }
            };
            let Some(t) = target else { continue };
            let lo = pred[v].iter().map(|&(u, len)| rank[u] + len).max().unwrap_or(0);
            let hi = succ[v].iter().map(|&(w, len)| rank[w].saturating_sub(len)).min().unwrap_or(maxr);
            if lo > hi {
                continue;
            }
            let r = t.clamp(lo, hi);
            if r != rank[v] {
                rank[v] = r;
                moved = true;
            }
        }
        if !moved {
            break;
        }
    }
}

/// Lowest common expanded group of two vertices' parents (-1 = top level).
pub(crate) fn lca(gr: &Groups, a: i32, b: i32) -> i32 {
    if a < 0 || b < 0 {
        return -1;
    }
    let (mut a, mut b) = (a, b);
    while gr.depth[a as usize] > gr.depth[b as usize] {
        a = gr.par[a as usize];
    }
    while gr.depth[b as usize] > gr.depth[a as usize] {
        b = gr.par[b as usize];
    }
    while a != b {
        a = gr.par[a as usize];
        b = gr.par[b as usize];
        if a < 0 || b < 0 {
            return -1;
        }
    }
    a
}
