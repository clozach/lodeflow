//! Property checks for the ten layout rules on hand-made and random graphs.

use lodeflow_layout::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

const ORIENTS: [Orient; 6] = [
    Orient::TopToBottom,
    Orient::BottomToTop,
    Orient::LeftToRight,
    Orient::RightToLeft,
    Orient::InnerToOuter,
    Orient::OuterToInner,
];

fn node(w: f64, h: f64, group: i32) -> NodeIn {
    NodeIn {
        w,
        h,
        group,
        prev: None,
    }
}
fn edge(a: usize, b: usize) -> EdgeIn {
    EdgeIn {
        src: a,
        dst: b,
        back_hint: false,
        label: None,
    }
}
fn group(parent: i32, collapsed: bool) -> GroupIn {
    GroupIn {
        parent,
        collapsed,
        w: 150.0,
        h: 44.0,
        header: 20.0,
    }
}

fn random_input(seed: u64, n: usize, m: usize, ng: usize, cycles: bool) -> Input {
    let mut r = Rng(seed * 2654435761 + 1);
    let mut inp = Input::default();
    for g in 0..ng {
        let parent = if g > 0 && r.below(3) == 0 {
            r.below(g) as i32
        } else {
            -1
        };
        inp.groups.push(group(parent, false));
    }
    for _ in 0..n {
        let gi = if ng > 0 && r.below(3) == 0 {
            r.below(ng) as i32
        } else {
            -1
        };
        inp.nodes.push(node(
            120.0 + r.below(80) as f64,
            30.0 + r.below(60) as f64,
            gi,
        ));
    }
    for _ in 0..m {
        let a = r.below(n);
        let b = r.below(n);
        if a == b {
            continue;
        }
        // Mostly forward edges; a few backwards ones make loops.
        let (a, b) = if cycles || a < b { (a, b) } else { (b, a) };
        inp.edges.push(edge(a, b));
    }
    inp
}

fn rect_of(o: &Output, inp: &Input, i: usize) -> (f64, f64, f64, f64) {
    let n = &o.nodes[i];
    (
        n.x - inp.nodes[i].w / 2.0,
        n.y - inp.nodes[i].h / 2.0,
        n.x + inp.nodes[i].w / 2.0,
        n.y + inp.nodes[i].h / 2.0,
    )
}

fn overlap(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), tol: f64) -> bool {
    a.0 < b.2 - tol && b.0 < a.2 - tol && a.1 < b.3 - tol && b.1 < a.3 - tol
}

fn check_basic(inp: &Input, o: &Output, label: &str) {
    assert_eq!(o.nodes.len(), inp.nodes.len());
    assert_eq!(o.edges.len(), inp.edges.len());
    assert!(
        o.width.is_finite() && o.height.is_finite(),
        "{label}: finite bounds"
    );
    // Rule 1/2: no two visible entities overlap.
    for i in 0..inp.nodes.len() {
        if !o.nodes[i].visible {
            continue;
        }
        let a = rect_of(o, inp, i);
        assert!(
            a.0 >= -0.5 && a.1 >= -0.5,
            "{label}: node {i} inside bounds"
        );
        for j in i + 1..inp.nodes.len() {
            if !o.nodes[j].visible {
                continue;
            }
            assert!(
                !overlap(a, rect_of(o, inp, j), 0.5),
                "{label}: nodes {i} and {j} overlap"
            );
        }
    }
    // Rules 3 & 6: every forward edge runs down the ranks; back edges run up.
    for (k, e) in inp.edges.iter().enumerate() {
        let eo = &o.edges[k];
        if eo.hidden || e.src == e.dst {
            continue;
        }
        let (rs, rd) = (o.nodes[e.src].rank, o.nodes[e.dst].rank);
        if !o.nodes[e.src].visible || !o.nodes[e.dst].visible {
            continue;
        }
        if eo.back {
            assert!(rd < rs, "{label}: back edge {k} must point upstream");
        } else {
            assert!(
                rs < rd,
                "{label}: edge {k} must point downstream ({rs} -> {rd})"
            );
        }
        assert!(
            eo.path.len() >= 4 && (eo.path.len() - 1) % 3 == 0,
            "{label}: edge {k} path shape"
        );
        for p in &eo.path {
            assert!(
                p.0.is_finite() && p.1.is_finite(),
                "{label}: edge {k} finite"
            );
        }
    }
}

fn check_flow_direction(inp: &Input, o: &Output, orient: Orient, label: &str) {
    for (k, e) in inp.edges.iter().enumerate() {
        let eo = &o.edges[k];
        if eo.hidden || eo.back || !o.nodes[e.src].visible || !o.nodes[e.dst].visible {
            continue;
        }
        let (a, b) = (&o.nodes[e.src], &o.nodes[e.dst]);
        let ok = match orient {
            Orient::TopToBottom => a.y < b.y,
            Orient::BottomToTop => a.y > b.y,
            Orient::LeftToRight => a.x < b.x,
            Orient::RightToLeft => a.x > b.x,
            _ => true,
        };
        assert!(ok, "{label}: edge {k} flows the wrong way");
    }
}

fn contains(outer: (f64, f64, f64, f64), inner: (f64, f64, f64, f64)) -> bool {
    inner.0 >= outer.0 - 0.5
        && inner.1 >= outer.1 - 0.5
        && inner.2 <= outer.2 + 0.5
        && inner.3 <= outer.3 + 0.5
}

fn in_group(inp: &Input, mut g: i32, target: usize) -> bool {
    let mut steps = 0;
    while g >= 0 && steps <= inp.groups.len() {
        if g as usize == target {
            return true;
        }
        g = inp.groups[g as usize].parent;
        steps += 1;
    }
    false
}

fn check_groups_linear(inp: &Input, o: &Output, label: &str) {
    for (gi, go) in o.groups.iter().enumerate() {
        if let Shape::Rect { x, y, w, h } = go.shape {
            let bx = (x, y, x + w, y + h);
            for i in 0..inp.nodes.len() {
                if !o.nodes[i].visible {
                    continue;
                }
                let r = rect_of(o, inp, i);
                if in_group(inp, inp.nodes[i].group, gi) {
                    assert!(contains(bx, r), "{label}: member {i} escapes group {gi}");
                } else {
                    assert!(
                        !overlap(bx, r, 0.5),
                        "{label}: outsider {i} inside group {gi}"
                    );
                }
            }
        }
    }
}

#[test]
fn chain_start_and_end_bias() {
    // a → b → c → d, plus x → d. Start bias puts x first; End bias puts it next to d.
    let mut inp = Input::default();
    for _ in 0..5 {
        inp.nodes.push(node(140.0, 40.0, -1));
    }
    inp.edges = vec![edge(0, 1), edge(1, 2), edge(2, 3), edge(4, 3)];
    let o = layout(&inp);
    check_basic(&inp, &o, "start");
    assert_eq!(o.nodes[4].rank, 0, "start bias: x at rank 0");
    inp.opts.bias_end = true;
    let o = layout(&inp);
    check_basic(&inp, &o, "end");
    assert_eq!(o.nodes[4].rank, 2, "end bias: x right before d");
    assert_eq!(o.nodes[3].rank, 3);
}

#[test]
fn loop_gets_exactly_one_back_edge_the_newest() {
    let mut inp = Input::default();
    for _ in 0..3 {
        inp.nodes.push(node(100.0, 40.0, -1));
    }
    inp.edges = vec![edge(0, 1), edge(1, 2), edge(2, 0)];
    let o = layout(&inp);
    check_basic(&inp, &o, "loop");
    let backs: Vec<usize> = (0..3).filter(|&k| o.edges[k].back).collect();
    assert_eq!(
        backs,
        vec![2],
        "the edge that closed the loop is the back edge"
    );
}

#[test]
fn back_hint_is_honoured() {
    let mut inp = Input::default();
    for _ in 0..3 {
        inp.nodes.push(node(100.0, 40.0, -1));
    }
    inp.edges = vec![
        edge(0, 1),
        EdgeIn {
            src: 1,
            dst: 2,
            back_hint: true,
            label: None,
        },
        edge(2, 0),
    ];
    let o = layout(&inp);
    assert!(o.edges[1].back && !o.edges[2].back);
}

#[test]
fn compactness_changes_size() {
    let inp0 = random_input(7, 30, 40, 0, false);
    let mut relaxed = inp0.clone();
    relaxed.opts.node_sep = 48.0;
    relaxed.opts.rank_sep = 90.0;
    let mut compact = inp0.clone();
    compact.opts.node_sep = 14.0;
    compact.opts.rank_sep = 32.0;
    let (a, b) = (layout(&relaxed), layout(&compact));
    assert!(a.width * a.height > b.width * b.height);
}

#[test]
fn collapsed_group_is_one_node() {
    let mut inp = Input::default();
    inp.groups.push(group(-1, true));
    inp.nodes = vec![
        node(100.0, 40.0, -1),
        node(100.0, 40.0, 0),
        node(100.0, 40.0, 0),
        node(100.0, 40.0, -1),
    ];
    inp.edges = vec![edge(0, 1), edge(1, 2), edge(2, 3)];
    let o = layout(&inp);
    assert!(!o.nodes[1].visible && !o.nodes[2].visible);
    assert!(
        (o.nodes[1].x - o.nodes[2].x).abs() < 1e-9 && (o.nodes[1].y - o.nodes[2].y).abs() < 1e-9
    );
    assert!(o.edges[1].hidden, "internal edge hidden");
    assert!(matches!(o.groups[0].shape, Shape::Proxy { .. }));
    assert_eq!(o.nodes[1].rank, 1);
    assert_eq!(o.nodes[3].rank, 2);
}

#[test]
fn nested_groups_contain_members_and_exclude_others() {
    for seed in 0..300u64 {
        let inp = random_input(
            seed,
            10 + (seed as usize % 30),
            14 + (seed as usize % 45),
            1 + (seed % 6) as usize,
            seed % 2 == 0,
        );
        for &or in &ORIENTS[..4] {
            let mut i2 = inp.clone();
            i2.opts.orient = or;
            let o = layout(&i2);
            let label = format!("seed {seed} {or:?}");
            check_basic(&i2, &o, &label);
            check_flow_direction(&i2, &o, or, &label);
            check_groups_linear(&i2, &o, &label);
        }
    }
}

#[test]
fn random_graphs_with_loops_all_orientations() {
    for seed in 0..60u64 {
        let inp = random_input(
            seed,
            5 + (seed as usize % 40),
            8 + (seed as usize % 60),
            (seed % 3) as usize,
            true,
        );
        for &or in &ORIENTS {
            for &bias in &[false, true] {
                let mut i2 = inp.clone();
                i2.opts.orient = or;
                i2.opts.bias_end = bias;
                let o = layout(&i2);
                let label = format!("seed {seed} {or:?} end={bias}");
                check_basic(&i2, &o, &label);
                check_flow_direction(&i2, &o, or, &label);
            }
        }
    }
}

#[test]
fn tight_groups_close_empty_bands() {
    // The sample's Planning box under End bias: s and d feed r early; e only feeds p, late.
    // 0 s, 1 d, 2 e (all in group 0) · 3 r · 4 c · 5 slip · 6 p
    let mut inp = Input::default();
    for i in 0..7 {
        inp.nodes.push(node(150.0, 40.0, if i < 3 { 0 } else { -1 }));
    }
    inp.groups = vec![group(-1, false)];
    inp.edges = vec![edge(0, 3), edge(1, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(2, 6)];
    inp.opts.bias_end = true;
    let strict = layout(&inp);
    check_basic(&inp, &strict, "strict");
    assert_eq!(strict.nodes[2].rank, 3, "strict End bias: e sits right before p");
    inp.opts.tight_groups = true;
    let tight = layout(&inp);
    check_basic(&inp, &tight, "tight");
    check_groups_linear(&inp, &tight, "tight");
    assert_eq!(tight.nodes[2].rank, tight.nodes[0].rank, "tight: e joins the rest of its group");
    assert_eq!(tight.nodes[6].rank, strict.nodes[6].rank, "no rank is added");
}

#[test]
fn tight_groups_keep_every_rule_on_random_graphs() {
    for seed in 0..60u64 {
        let mut inp = random_input(seed, 6 + (seed as usize % 40), 8 + (seed as usize % 60), 1 + (seed % 4) as usize, true);
        inp.opts.tight_groups = true;
        for &or in &[Orient::LeftToRight, Orient::TopToBottom, Orient::InnerToOuter] {
            for &bias in &[false, true] {
                let mut i2 = inp.clone();
                i2.opts.orient = or;
                i2.opts.bias_end = bias;
                let o = layout(&i2);
                let label = format!("tight seed {seed} {or:?} end={bias}");
                check_basic(&i2, &o, &label);
                check_flow_direction(&i2, &o, or, &label);
                if !or.is_radial() {
                    check_groups_linear(&i2, &o, &label);
                }
            }
        }
    }
}

/// Min distance from a point to a Bézier chain (sampled).
fn dist_to_path(path: &[(f64, f64)], p: (f64, f64)) -> f64 {
    let mut best = f64::INFINITY;
    let mut i = 0;
    while i + 3 < path.len() {
        let (p0, c1, c2, p1) = (path[i], path[i + 1], path[i + 2], path[i + 3]);
        for k in 0..=64 {
            let t = k as f64 / 64.0;
            let m = 1.0 - t;
            let x = m * m * m * p0.0 + 3.0 * m * m * t * c1.0 + 3.0 * m * t * t * c2.0 + t * t * t * p1.0;
            let y = m * m * m * p0.1 + 3.0 * m * m * t * c1.1 + 3.0 * m * t * t * c2.1 + t * t * t * p1.1;
            best = best.min(((x - p.0).powi(2) + (y - p.1).powi(2)).sqrt());
        }
        i += 3;
    }
    best
}

fn check_labels(inp: &Input, o: &Output, label: &str) {
    let mut boxes: Vec<(usize, (f64, f64, f64, f64))> = Vec::new();
    for (k, e) in inp.edges.iter().enumerate() {
        let eo = &o.edges[k];
        match (e.label, eo.label) {
            (Some((w, h)), Some((x, y))) => {
                assert!(!eo.hidden, "{label}: hidden edge {k} has no label");
                assert!(dist_to_path(&eo.path, (x, y)) < 1.0, "{label}: label {k} sits on its route");
                let r = (x - w / 2.0, y - h / 2.0, x + w / 2.0, y + h / 2.0);
                for i in 0..inp.nodes.len() {
                    if o.nodes[i].visible {
                        assert!(!overlap(r, rect_of(o, inp, i), 0.5), "{label}: label {k} overlaps node {i}");
                    }
                }
                for &(j, q) in &boxes {
                    // Duplicate edges share one layout edge, so they share its label spot.
                    let dup = inp.edges[j].src == e.src && inp.edges[j].dst == e.dst;
                    assert!(dup || !overlap(r, q, 0.5), "{label}: labels {k} and {j} overlap");
                }
                boxes.push((k, r));
            }
            (Some(_), None) => assert!(eo.hidden, "{label}: visible edge {k} lost its label"),
            (None, Some(_)) => panic!("{label}: edge {k} grew a label"),
            _ => {}
        }
    }
}

#[test]
fn labels_ride_their_edge() {
    // a → b labelled: b moves one rank further, and the label sits between them on the route.
    let mut inp = Input::default();
    for _ in 0..3 {
        inp.nodes.push(node(140.0, 40.0, -1));
    }
    inp.edges = vec![edge(0, 1), edge(1, 2)];
    let plain = layout(&inp);
    inp.edges[0].label = Some((90.0, 22.0));
    for &or in &ORIENTS {
        inp.opts.orient = or;
        let o = layout(&inp);
        let l = format!("chain {or:?}");
        check_basic(&inp, &o, &l);
        check_labels(&inp, &o, &l);
        assert_eq!(o.nodes[1].rank, 2, "{l}: the labelled edge spans two ranks");
    }
    assert_eq!(plain.nodes[1].rank, 1);
    // A labelled back edge adds no rank: it already spans the loop.
    let mut inp = Input::default();
    for _ in 0..3 {
        inp.nodes.push(node(140.0, 40.0, -1));
    }
    inp.edges = vec![edge(0, 1), edge(1, 2), edge(2, 0)];
    let before = layout(&inp).ranks;
    inp.edges[2].label = Some((120.0, 22.0));
    let o = layout(&inp);
    check_basic(&inp, &o, "loop");
    check_labels(&inp, &o, "loop");
    assert!(o.edges[2].back);
    assert_eq!(o.ranks, before, "a labelled back edge keeps the flow as long as it was");
}

#[test]
fn labels_keep_every_rule_on_random_graphs() {
    for seed in 0..50u64 {
        let mut inp = random_input(seed, 6 + (seed as usize % 34), 8 + (seed as usize % 50), (seed % 3) as usize, true);
        let mut r = Rng(seed + 7);
        for e in inp.edges.iter_mut() {
            if r.below(3) == 0 {
                e.label = Some((40.0 + r.below(90) as f64, 18.0 + r.below(20) as f64));
            }
        }
        for &or in &ORIENTS {
            for &bias in &[false, true] {
                let mut i2 = inp.clone();
                i2.opts.orient = or;
                i2.opts.bias_end = bias;
                i2.opts.tight_groups = seed % 2 == 0;
                let o = layout(&i2);
                let label = format!("labels seed {seed} {or:?} end={bias}");
                check_basic(&i2, &o, &label);
                check_flow_direction(&i2, &o, or, &label);
                if !or.is_radial() {
                    check_labels(&i2, &o, &label);
                    check_groups_linear(&i2, &o, &label);
                }
            }
        }
    }
}

/// The demo's sample: Planning (specs, dod, estimates), Delivery (rework, switching, cycle), a loop.
fn sample() -> Input {
    let member = [0, 0, 0, 1, -1, 1, 1, -1, -1, -1, -1, -1];
    let tall = [true, true, false, false, true, true, false, false, true, true, true, false];
    let mut inp = Input::default();
    for i in 0..12 {
        inp.nodes.push(node(176.0, if tall[i] { 59.0 } else { 40.0 }, member[i]));
    }
    inp.edges = [(0, 3), (1, 3), (3, 6), (4, 5), (5, 6), (6, 7), (2, 8), (7, 8), (7, 11), (8, 9), (10, 9), (9, 4)]
        .iter()
        .map(|&(a, b)| edge(a, b))
        .collect();
    inp.groups = vec![group(-1, false), group(-1, false)];
    inp.opts.orient = Orient::LeftToRight;
    inp
}

#[test]
fn untangle_finds_the_crossing_free_layout_of_the_sample() {
    // Tight groups + End bias leave one crossing that no ordering of those ranks can remove
    // (checked exhaustively); moving 'Customers lose trust' (11) next to its cause removes it.
    let mut inp = sample();
    inp.opts.bias_end = true;
    inp.opts.tight_groups = true;
    let before = layout(&inp);
    assert_eq!(before.crossings, 1);
    inp.opts.untangle = true;
    let o = layout(&inp);
    check_basic(&inp, &o, "untangled");
    check_groups_linear(&inp, &o, "untangled");
    assert_eq!(o.crossings, 0, "untangled sample has no crossings");
    assert_eq!(o.nodes[11].rank, o.nodes[7].rank + 1, "the end effect moved next to its cause");
    assert_eq!(o.nodes[2].rank, o.nodes[0].rank, "the group stays tight");
}

#[test]
fn untangle_never_adds_crossings_and_keeps_every_rule() {
    for seed in 0..40u64 {
        let inp = random_input(seed, 6 + (seed as usize % 30), 8 + (seed as usize % 40), (seed % 3) as usize, true);
        for &or in &[Orient::LeftToRight, Orient::TopToBottom] {
            for &(bias, tight) in &[(false, false), (true, true), (true, false)] {
                let mut i2 = inp.clone();
                i2.opts.orient = or;
                i2.opts.bias_end = bias;
                i2.opts.tight_groups = tight;
                let plain = layout(&i2);
                i2.opts.untangle = true;
                let o = layout(&i2);
                let label = format!("untangle seed {seed} {or:?} end={bias} tight={tight}");
                check_basic(&i2, &o, &label);
                check_flow_direction(&i2, &o, or, &label);
                check_groups_linear(&i2, &o, &label);
                assert!(o.crossings <= plain.crossings, "{label}: {} > {}", o.crossings, plain.crossings);
            }
        }
    }
}

#[test]
fn crowded_radial_rings_do_not_overlap() {
    // A hub with 250 effects: one ring holds them all.
    for &or in &[Orient::InnerToOuter, Orient::OuterToInner] {
        let mut inp = Input::default();
        for i in 0..251 {
            inp.nodes.push(node(if i == 0 { 120.0 } else { 150.0 + (i % 3) as f64 * 20.0 }, 40.0, -1));
        }
        inp.edges = (1..251).map(|i| edge(0, i)).collect();
        inp.opts.orient = or;
        let o = layout(&inp);
        check_basic(&inp, &o, &format!("star {or:?}"));
    }
}

#[test]
fn labelled_edges_into_a_collapsed_group_keep_separate_labels() {
    // a -> m1 'scope' and a -> m2 'support', m1 and m2 in a collapsed group: both end at its proxy.
    let mut inp = Input::default();
    inp.nodes = vec![node(140.0, 40.0, -1), node(140.0, 40.0, 0), node(140.0, 40.0, 0)];
    inp.groups = vec![group(-1, true)];
    inp.edges = vec![edge(0, 1), edge(0, 2)];
    inp.edges[0].label = Some((60.0, 22.0));
    inp.edges[1].label = Some((70.0, 22.0));
    for &or in &ORIENTS {
        inp.opts.orient = or;
        let o = layout(&inp);
        check_basic(&inp, &o, "collapsed labels");
        let (a, b) = (o.edges[0].label.unwrap(), o.edges[1].label.unwrap());
        let ra = (a.0 - 30.0, a.1 - 11.0, a.0 + 30.0, a.1 + 11.0);
        let rb = (b.0 - 35.0, b.1 - 11.0, b.0 + 35.0, b.1 + 11.0);
        assert!(!overlap(ra, rb, 0.5), "{or:?}: the two labels overlap");
    }
}

#[test]
fn layout_many_matches_separate_layouts() {
    // Ranks and order do not depend on the direction, so one shared run must equal two separate ones.
    for seed in 0..12u64 {
        let mut inp = random_input(seed, 8 + (seed as usize % 30), 10 + (seed as usize % 40), (seed % 3) as usize, true);
        inp.opts.tight_groups = seed % 2 == 0;
        inp.opts.untangle = seed % 3 != 0;
        for &(a, b) in &[(Orient::LeftToRight, Orient::TopToBottom), (Orient::TopToBottom, Orient::InnerToOuter), (Orient::RightToLeft, Orient::BottomToTop)] {
            inp.opts.orient = a;
            let pair = layout_many(&inp, &[a, b]);
            let one = layout(&inp);
            let mut ib = inp.clone();
            ib.opts.orient = b;
            let two = layout(&ib);
            assert_eq!(codec::encode(&pair[0]), codec::encode(&one), "seed {seed} {a:?} first");
            assert_eq!(codec::encode(&pair[1]), codec::encode(&two), "seed {seed} {b:?} second");
        }
    }
}

#[test]
fn deterministic() {
    let inp = random_input(99, 60, 90, 3, true);
    let a = codec::encode(&layout(&inp));
    let b = codec::encode(&layout(&inp));
    assert_eq!(a, b);
}

#[test]
fn incremental_keeps_previous_order() {
    let mut inp = random_input(5, 20, 26, 0, false);
    let first = layout(&inp);
    // Add one node hanging off node 3 and relayout incrementally.
    for (i, n) in inp.nodes.iter_mut().enumerate() {
        n.prev = Some((first.nodes[i].x, first.nodes[i].y));
    }
    inp.nodes.push(node(120.0, 40.0, -1));
    inp.edges.push(edge(3, 20));
    inp.opts.incremental = true;
    let second = layout(&inp);
    check_basic(&inp, &second, "incremental");
    // Within every rank, old nodes keep their relative left-to-right order.
    for i in 0..20 {
        for j in 0..20 {
            if first.nodes[i].rank == first.nodes[j].rank
                && second.nodes[i].rank == second.nodes[j].rank
                && first.nodes[i].x < first.nodes[j].x
            {
                assert!(
                    second.nodes[i].x < second.nodes[j].x,
                    "order of {i},{j} kept"
                );
            }
        }
    }
}

#[test]
fn codec_round_trip() {
    let inp = random_input(3, 12, 16, 2, true);
    let mut buf = vec![0.0; codec::HEADER];
    buf[0] = 1.0;
    buf[1] = inp.opts.orient.code();
    buf[3] = inp.opts.node_sep;
    buf[4] = inp.opts.rank_sep;
    buf[5] = inp.opts.edge_sep;
    buf[6] = inp.opts.group_pad;
    buf[7] = inp.opts.group_gap;
    buf[9] = inp.opts.margin;
    buf[10] = inp.nodes.len() as f64;
    buf[11] = inp.edges.len() as f64;
    buf[12] = inp.groups.len() as f64;
    for n in &inp.nodes {
        buf.extend_from_slice(&[n.w, n.h, n.group as f64, f64::NAN, f64::NAN]);
    }
    for e in &inp.edges {
        let (lw, lh) = e.label.unwrap_or((0.0, 0.0));
        buf.extend_from_slice(&[e.src as f64, e.dst as f64, 0.0, lw, lh]);
    }
    for g in &inp.groups {
        buf.extend_from_slice(&[g.parent as f64, 0.0, g.w, g.h, g.header]);
    }
    let out = codec::run(&buf);
    assert_eq!(out, codec::encode(&layout(&inp)));
}

#[test]
fn garbage_input_does_not_panic() {
    let mut r = Rng(42);
    for _ in 0..200 {
        let len = r.below(200);
        let mut buf: Vec<f64> = (0..len).map(|_| (r.below(40) as f64) - 5.0).collect();
        if len > 12 {
            buf[10] = r.below(8) as f64;
            buf[11] = r.below(8) as f64;
            buf[12] = r.below(4) as f64;
        }
        let _ = codec::run(&buf);
    }
}

#[test]
fn perf_report() {
    for &(n, m, ng) in &[
        (100usize, 150usize, 4usize),
        (500, 800, 10),
        (2000, 3000, 20),
    ] {
        let inp = random_input(1234, n, m, ng, true);
        let t = std::time::Instant::now();
        let o = layout(&inp);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "perf: {n} nodes / {m} edges / {ng} groups → {ms:.1} ms native, {} crossings, {} ranks",
            o.crossings, o.ranks
        );
    }
}
