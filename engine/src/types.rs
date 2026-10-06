//! Public input/output types for the layout engine.

use alloc::vec::Vec;

/// Rule 2: every diagram flows one way.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Orient {
    TopToBottom,
    BottomToTop,
    LeftToRight,
    RightToLeft,
    /// Radial, rank 0 at the centre, flowing outwards.
    InnerToOuter,
    /// Radial, rank 0 on the outer ring, flowing inwards.
    OuterToInner,
}

impl Orient {
    pub fn from_code(c: f64) -> Orient {
        match c as i32 {
            1 => Orient::BottomToTop,
            2 => Orient::LeftToRight,
            3 => Orient::RightToLeft,
            4 => Orient::InnerToOuter,
            5 => Orient::OuterToInner,
            _ => Orient::TopToBottom,
        }
    }
    pub fn code(self) -> f64 {
        match self {
            Orient::TopToBottom => 0.0,
            Orient::BottomToTop => 1.0,
            Orient::LeftToRight => 2.0,
            Orient::RightToLeft => 3.0,
            Orient::InnerToOuter => 4.0,
            Orient::OuterToInner => 5.0,
        }
    }
    pub fn is_radial(self) -> bool {
        matches!(self, Orient::InnerToOuter | Orient::OuterToInner)
    }
    /// Left/right flows lay out in a rotated frame: node height becomes the cross-axis size.
    pub fn swaps_axes(self) -> bool {
        matches!(self, Orient::LeftToRight | Orient::RightToLeft)
    }
}

/// Layout options. Rules 4 (bias), 5 (compactness → the three spacings), 8/9 (incremental).
#[derive(Clone, Debug)]
pub struct Options {
    pub orient: Orient,
    /// Rule 4. `false` = Start (as early as possible), `true` = End (as late as possible).
    pub bias_end: bool,
    /// Gap between neighbouring entities in a rank.
    pub node_sep: f64,
    /// Gap between ranks.
    pub rank_sep: f64,
    /// Gap between an edge's bend point and its neighbours.
    pub edge_sep: f64,
    /// Inner padding of a group box.
    pub group_pad: f64,
    /// Gap between sibling group boxes.
    pub group_gap: f64,
    /// Rule 9: start from the previous layout's order instead of re-minimising crossings.
    pub incremental: bool,
    pub margin: f64,
    /// Tight groups: after ranking, a group member with room to move shifts toward the rest of
    /// its group (within what its causes and effects allow), closing empty bands in the box.
    pub tight_groups: bool,
    /// Untangle: a node with room to move (between what must come before and after it) may
    /// change rank when that removes crossing lines. Bias and tight groups give way only for that.
    pub untangle: bool,
    /// Also place the same ranks and order in this direction (see `layout_many`).
    pub also: Option<Orient>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            orient: Orient::TopToBottom,
            bias_end: false,
            node_sep: 28.0,
            rank_sep: 56.0,
            edge_sep: 12.0,
            group_pad: 14.0,
            group_gap: 24.0,
            incremental: false,
            margin: 24.0,
            tight_groups: false,
            untangle: false,
            also: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct NodeIn {
    pub w: f64,
    pub h: f64,
    /// Index into `groups`, or -1.
    pub group: i32,
    /// Previous centre (final frame) for incremental layout.
    pub prev: Option<(f64, f64)>,
}

#[derive(Clone, Debug)]
pub struct EdgeIn {
    pub src: usize,
    pub dst: usize,
    /// Prefer this edge as the back edge when it closes a cycle.
    pub back_hint: bool,
    /// Size of the edge's label (final frame), if it has one. The label rides the edge's middle
    /// bend point, which takes this size; an edge spanning one rank is lengthened to two for it.
    pub label: Option<(f64, f64)>,
}

#[derive(Clone, Debug)]
pub struct GroupIn {
    /// Index of the parent group, or -1.
    pub parent: i32,
    /// Rule 7: a collapsed group is laid out as one node.
    pub collapsed: bool,
    /// Size of the group when drawn as a single node (collapsed or empty).
    pub w: f64,
    pub h: f64,
    /// Height reserved for the group's title inside its box.
    pub header: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Input {
    pub opts: Options,
    pub nodes: Vec<NodeIn>,
    pub edges: Vec<EdgeIn>,
    pub groups: Vec<GroupIn>,
}

#[derive(Clone, Debug)]
pub struct NodeOut {
    /// Centre, final frame.
    pub x: f64,
    pub y: f64,
    pub rank: i32,
    pub order: i32,
    /// False when the node sits inside a collapsed group (x/y then give the group's centre).
    pub visible: bool,
}

#[derive(Clone, Debug)]
pub enum Shape {
    Hidden,
    /// Top-left corner and size.
    Rect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
    /// Annular sector around (cx, cy), angles in radians (y axis points down).
    Sector {
        cx: f64,
        cy: f64,
        r0: f64,
        r1: f64,
        a0: f64,
        a1: f64,
    },
    /// Group drawn as a single node: centre and size.
    Proxy {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
}

#[derive(Clone, Debug)]
pub struct GroupOut {
    pub shape: Shape,
    /// Title box: top-left and available width.
    pub label: (f64, f64, f64),
}

#[derive(Clone, Debug)]
pub struct EdgeOut {
    /// Rule 6: this edge closes a loop and was ignored for flow.
    pub back: bool,
    /// Both ends sit in the same collapsed group.
    pub hidden: bool,
    /// Cubic Bézier chain, source → target: p0, (c1, c2, p1)*.
    pub path: Vec<(f64, f64)>,
    /// Centre of the edge's label, on its route.
    pub label: Option<(f64, f64)>,
}

#[derive(Clone, Debug, Default)]
pub struct Output {
    pub width: f64,
    pub height: f64,
    pub nodes: Vec<NodeOut>,
    pub groups: Vec<GroupOut>,
    pub edges: Vec<EdgeOut>,
    pub crossings: usize,
    pub ranks: usize,
}
