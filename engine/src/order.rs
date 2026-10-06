//! Crossing reduction within ranks. Group members stay contiguous (rule 7) and
//! sibling groups keep one left-to-right order on every rank, so boxes never interleave.

use crate::graph::{Graph, Groups, VK};
use alloc::vec;
use alloc::vec::Vec;

#[derive(Clone, Copy)]
enum Item {
    V(usize),
    Grp(usize),
}

struct Entry {
    /// A lone vertex is held inline (no allocation: a layout sorts every rank several times).
    one: Option<usize>,
    /// A group's vertices, in order.
    vs: Vec<usize>,
    bc: f64,
    w: f64,
    has_bc: bool,
    idx: usize,
    i: usize,
    grp: Option<usize>,
}

struct BlockRes {
    vs: Vec<usize>,
    bcw: f64,
    w: f64,
    min_idx: usize,
}

pub(crate) struct Orderer<'a> {
    pub g: &'a Graph,
    pub gr: &'a Groups,
}

impl<'a> Orderer<'a> {
    /// Sort one rank. `key(v)` gives (sort key, weight) or None (keep its place).
    fn sort_layer(
        &self,
        r: usize,
        layer: &[usize],
        key: &dyn Fn(usize) -> Option<(f64, f64)>,
        cur: &dyn Fn(usize) -> usize,
        gkey: &[f64],
        bias_right: bool,
    ) -> Vec<usize> {
        let ng = self.gr.par.len();
        let mut kids: Vec<Vec<Item>> = vec![Vec::new(); ng + 1];
        let mut reg = vec![false; ng];
        let register = |c: i32, kids: &mut Vec<Vec<Item>>, reg: &mut Vec<bool>| {
            let mut c = c;
            while c >= 0 {
                let cu = c as usize;
                if reg[cu] {
                    break;
                }
                reg[cu] = true;
                let p = self.gr.par[cu];
                kids[(p + 1) as usize].push(Item::Grp(cu));
                c = p;
            }
        };
        for &v in layer {
            match self.g.kind[v] {
                VK::BorderL(gi) => register(gi as i32, &mut kids, &mut reg),
                VK::BorderR(_) => {}
                _ => {
                    let p = self.g.parent[v];
                    kids[(p + 1) as usize].push(Item::V(v));
                    register(p, &mut kids, &mut reg);
                }
            }
        }
        self.sort_block(-1, r, &kids, key, cur, gkey, bias_right).vs
    }

    #[allow(clippy::too_many_arguments)]
    fn sort_block(
        &self,
        b: i32,
        r: usize,
        kids: &[Vec<Item>],
        key: &dyn Fn(usize) -> Option<(f64, f64)>,
        cur: &dyn Fn(usize) -> usize,
        gkey: &[f64],
        bias_right: bool,
    ) -> BlockRes {
        let mut entries: Vec<Entry> = Vec::new();
        for it in &kids[(b + 1) as usize] {
            match *it {
                Item::V(v) => {
                    let k = key(v);
                    entries.push(Entry {
                        one: Some(v),
                        vs: Vec::new(),
                        bc: k.map(|x| x.0).unwrap_or(0.0),
                        w: k.map(|x| x.1).unwrap_or(0.0),
                        has_bc: k.is_some(),
                        idx: cur(v),
                        i: 0,
                        grp: None,
                    });
                }
                Item::Grp(c) => {
                    let sub = self.sort_block(c as i32, r, kids, key, cur, gkey, bias_right);
                    let has = sub.w > 0.0;
                    entries.push(Entry {
                        bc: if has { sub.bcw / sub.w } else { 0.0 },
                        w: sub.w,
                        has_bc: has,
                        idx: sub.min_idx,
                        one: None,
                        vs: sub.vs,
                        i: 0,
                        grp: Some(c),
                    });
                }
            }
        }
        entries.sort_by_key(|e| e.idx);
        for (i, e) in entries.iter_mut().enumerate() {
            e.i = i;
        }
        let (mut sortable, unsortable): (Vec<Entry>, Vec<Entry>) =
            entries.into_iter().partition(|e| e.has_bc);
        sortable.sort_by(|a, b| {
            a.bc.total_cmp(&b.bc).then_with(|| {
                if bias_right {
                    b.i.cmp(&a.i)
                } else {
                    a.i.cmp(&b.i)
                }
            })
        });
        let mut out: Vec<Entry> = Vec::with_capacity(sortable.len() + unsortable.len());
        let mut uq = unsortable.into_iter().peekable();
        let mut pos = 0usize;
        while let Some(u) = uq.peek() {
            if u.i <= pos {
                out.push(uq.next().unwrap());
                pos += 1;
            } else {
                break;
            }
        }
        for e in sortable {
            out.push(e);
            pos += 1;
            while let Some(u) = uq.peek() {
                if u.i <= pos {
                    out.push(uq.next().unwrap());
                    pos += 1;
                } else {
                    break;
                }
            }
        }
        out.extend(uq);

        // Sibling groups take their slots in one global order (gkey), identical on every rank.
        let slots: Vec<usize> = out
            .iter()
            .enumerate()
            .filter(|(_, e)| e.grp.is_some())
            .map(|(i, _)| i)
            .collect();
        if slots.len() > 1 {
            let mut gents: Vec<Entry> = Vec::with_capacity(slots.len());
            for &s in &slots {
                gents.push(core::mem::replace(
                    &mut out[s],
                    Entry {
                        one: None,
                        vs: Vec::new(),
                        bc: 0.0,
                        w: 0.0,
                        has_bc: false,
                        idx: 0,
                        i: 0,
                        grp: None,
                    },
                ));
            }
            gents.sort_by(|a, b| {
                let (ga, gb) = (a.grp.unwrap(), b.grp.unwrap());
                gkey[ga].total_cmp(&gkey[gb]).then(ga.cmp(&gb))
            });
            for (k, e) in gents.into_iter().enumerate() {
                out[slots[k]] = e;
            }
        }

        let mut vs = Vec::new();
        let mut bcw = 0.0;
        let mut w = 0.0;
        let mut min_idx = usize::MAX;
        let (bl, br) = if b >= 0 {
            self.gr.borders_at(b as usize, r)
        } else {
            (None, None)
        };
        if let Some(l) = bl {
            vs.push(l);
            min_idx = min_idx.min(cur(l));
        }
        for e in out {
            if e.has_bc {
                bcw += e.bc * e.w;
                w += e.w;
            }
            min_idx = min_idx.min(e.idx);
            match e.one {
                Some(v) => vs.push(v),
                None => vs.extend(e.vs),
            }
        }
        if let Some(rr) = br {
            vs.push(rr);
        }
        BlockRes {
            vs,
            bcw,
            w,
            min_idx,
        }
    }

    fn group_keys(
        &self,
        layers: &[Vec<usize>],
        val: &dyn Fn(usize, usize, usize) -> f64,
    ) -> Vec<f64> {
        let ng = self.gr.par.len();
        let mut sum = vec![0.0; ng];
        let mut cnt = vec![0.0; ng];
        for (r, layer) in layers.iter().enumerate() {
            for (i, &v) in layer.iter().enumerate() {
                if self.g.kind[v].is_border() {
                    continue;
                }
                let x = val(v, r, i);
                let mut c = self.g.parent[v];
                while c >= 0 {
                    sum[c as usize] += x;
                    cnt[c as usize] += 1.0;
                    c = self.gr.par[c as usize];
                }
            }
        }
        (0..ng)
            .map(|k| if cnt[k] > 0.0 { sum[k] / cnt[k] } else { 0.5 })
            .collect()
    }

    /// Crossings between consecutive ranks. With `edges_only`, segments of group border chains
    /// are left out, so the count is lines crossing lines; without, a line crossing a group's
    /// outline counts too.
    fn count(&self, layers: &[Vec<usize>], pos: &[usize], edges_only: bool) -> usize {
        let g = self.g;
        let mut total = 0usize;
        let mut south: Vec<usize> = Vec::new();
        let mut bit: Vec<usize> = Vec::new();
        for r in 0..layers.len().saturating_sub(1) {
            let n_south = layers[r + 1].len();
            if n_south == 0 {
                continue;
            }
            south.clear();
            for &u in &layers[r] {
                if edges_only && g.kind[u].is_border() {
                    continue;
                }
                let start = south.len();
                for &v in &g.down[u] {
                    if !(edges_only && g.kind[v].is_border()) {
                        south.push(pos[v]);
                    }
                }
                south[start..].sort_unstable();
            }
            // Count inversions with a Fenwick tree.
            bit.clear();
            bit.resize(n_south + 1, 0);
            for (k, &s) in south.iter().enumerate() {
                let mut le = 0usize;
                let mut i = s + 1;
                while i > 0 {
                    le += bit[i];
                    i &= i - 1;
                }
                total += k - le;
                let mut i = s + 1;
                while i <= n_south {
                    bit[i] += 1;
                    i += i & i.wrapping_neg();
                }
            }
        }
        total
    }

    /// What the ordering minimises: a line crossing a line costs three, a line crossing a
    /// group's outline costs two. So one crossing beats a line cutting through a box (in and
    /// out: four), and a line entering the box it belongs to costs the same everywhere.
    /// Returns (cost, line-over-line crossings).
    fn score(&self, layers: &[Vec<usize>], pos: &[usize]) -> (usize, usize) {
        let all = self.count(layers, pos, false);
        let ee = self.count(layers, pos, true);
        (3 * ee + 2 * all.saturating_sub(ee), ee)
    }

    /// Barycentre sweeps from one starting order (group contiguity enforced throughout).
    /// Returns the best layering found, its cost and its line crossings.
    fn sweeps(&self, start: &[Vec<usize>]) -> (Vec<Vec<usize>>, usize, usize) {
        let g = self.g;
        let nr = g.nranks;
        let mut pos = vec![0usize; g.nv()];
        let set_pos = |layers: &[Vec<usize>], pos: &mut Vec<usize>| {
            for layer in layers {
                for (i, &v) in layer.iter().enumerate() {
                    pos[v] = i;
                }
            }
        };
        set_pos(start, &mut pos);
        let gkey = self.group_keys(start, &|_, r, i| i as f64 / (start[r].len().max(1) as f64));
        let mut layers: Vec<Vec<usize>> = Vec::with_capacity(nr);
        for r in 0..nr {
            layers.push(self.sort_layer(r, &start[r], &|v| Some((pos[v] as f64, 1.0)), &|v| pos[v], &gkey, false));
        }
        set_pos(&layers, &mut pos);
        let mut best = layers.clone();
        let (mut best_cost, mut best_ee) = self.score(&layers, &pos);
        let mut since = 0;
        for it in 0..32 {
            if since >= 4 || best_cost == 0 {
                break;
            }
            let down = it % 2 == 0;
            let bias_right = it % 4 >= 2;
            let gkey = self.group_keys(&layers, &|_, r, i| i as f64 / (layers[r].len().max(1) as f64));
            for r in 0..nr {
                let l = self.sort_layer(r, &layers[r], &|v| Some((pos[v] as f64, 1.0)), &|v| pos[v], &gkey, false);
                layers[r] = l;
            }
            set_pos(&layers, &mut pos);
            let ranks: Vec<usize> = if down { (1..nr).collect() } else { (0..nr.saturating_sub(1)).rev().collect() };
            for r in ranks {
                let bary = |v: usize| -> Option<(f64, f64)> {
                    let nb = if down { &g.up[v] } else { &g.down[v] };
                    if nb.is_empty() {
                        return None;
                    }
                    let s: usize = nb.iter().map(|&u| pos[u]).sum();
                    Some((s as f64 / nb.len() as f64, nb.len() as f64))
                };
                let l = self.sort_layer(r, &layers[r], &bary, &|v| pos[v], &gkey, bias_right);
                for (i, &v) in l.iter().enumerate() {
                    pos[v] = i;
                }
                layers[r] = l;
            }
            let (cost, ee) = self.score(&layers, &pos);
            if cost < best_cost {
                best_cost = cost;
                best_ee = ee;
                best = layers.clone();
                since = 0;
            } else {
                since += 1;
            }
        }
        (best, best_cost, best_ee)
    }

    /// Returns rank lists (left-to-right) and the crossing count.
    /// `restarts` overrides how many starting orders the sweeps try (untangling uses fewer).
    /// Returns the ranks (left to right), line crossings, and the cost the search minimised.
    pub fn run(&self, incremental_keys: Option<&[f64]>, restarts: Option<usize>) -> (Vec<Vec<usize>>, usize, usize) {
        let g = self.g;
        let nv = g.nv();
        let nr = g.nranks;
        if nv == 0 {
            return (Vec::new(), 0, 0);
        }
        // Initial order: depth-first from the sources, in creation order.
        let mut raw: Vec<Vec<usize>> = vec![Vec::new(); nr];
        let mut visited = vec![false; nv];
        let mut roots: Vec<usize> = (0..nv).filter(|&v| !g.kind[v].is_border()).collect();
        roots.sort_by_key(|&v| (g.rank[v], v));
        let mut stack: Vec<usize> = Vec::new();
        for &s in &roots {
            if visited[s] {
                continue;
            }
            stack.push(s);
            while let Some(x) = stack.pop() {
                if visited[x] {
                    continue;
                }
                visited[x] = true;
                raw[g.rank[x]].push(x);
                for &y in g.down[x].iter().rev() {
                    if !visited[y] {
                        stack.push(y);
                    }
                }
            }
        }
        for v in 0..nv {
            if g.kind[v].is_border() {
                raw[g.rank[v]].push(v);
            }
        }
        let mut pos = vec![0usize; nv];
        let set_pos = |layers: &[Vec<usize>], pos: &mut Vec<usize>| {
            for layer in layers {
                for (i, &v) in layer.iter().enumerate() {
                    pos[v] = i;
                }
            }
        };
        set_pos(&raw, &mut pos);

        let mut layers: Vec<Vec<usize>> = Vec::with_capacity(nr);
        if let Some(keys) = incremental_keys {
            // Rule 9: keep the previous left-to-right order; new things slot in by their neighbours.
            let gkey = self.group_keys(&raw, &|v, _, _| keys[v]);
            for r in 0..nr {
                let l = self.sort_layer(
                    r,
                    &raw[r],
                    &|v| Some((keys[v], 1.0)),
                    &|v| pos[v],
                    &gkey,
                    false,
                );
                layers.push(l);
            }
            set_pos(&layers, &mut pos);
            let (cost, cc) = self.score(&layers, &pos);
            return (layers, cc, cost);
        }

        // Untangling is NP-hard, and barycentre sweeps stop in the first local optimum they
        // reach. Sweep from several starting orders and keep the best; small diagrams get more
        // starts, since they are cheap and are the ones people read closely.
        // About as many starts as the old size steps gave (12 / 6 / 3 / 1 at 80 / 250 / 700 vertices),
        // but smooth, so crossing counts do not jump between neighbouring sizes.
        let restarts = restarts.unwrap_or((1000 / nv.max(1)).clamp(1, 12));
        let mut seed: u64 = 0x9e37_79b9_7f4a_7c15 ^ nv as u64;
        let mut best: Option<(Vec<Vec<usize>>, usize, usize)> = None;
        for k in 0..restarts {
            let start: Vec<Vec<usize>> = match k {
                0 => raw.clone(),
                1 => raw.iter().map(|l| l.iter().rev().copied().collect()).collect(),
                _ => raw
                    .iter()
                    .map(|l| {
                        let mut l = l.clone();
                        for i in (1..l.len()).rev() {
                            seed ^= seed << 13;
                            seed ^= seed >> 7;
                            seed ^= seed << 17;
                            l.swap(i, (seed % (i as u64 + 1)) as usize);
                        }
                        l
                    })
                    .collect(),
            };
            let run = self.sweeps(&start);
            if best.as_ref().map_or(true, |b| run.1 < b.1) {
                best = Some(run);
            }
            if best.as_ref().map_or(false, |b| b.1 == 0) {
                break;
            }
        }
        let (best, best_cost, best_cc) = best.unwrap();
        (best, best_cc, best_cost)
    }
}
