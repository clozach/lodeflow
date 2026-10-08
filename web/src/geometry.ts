// Camera math and path helpers. World = layout coordinates; screen = viewport pixels.

import type { Camera } from './history';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function toScreen(c: Camera, vw: number, vh: number, p: Pt): Pt {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const cos = Math.cos(c.r);
  const sin = Math.sin(c.r);
  return { x: vw / 2 + c.z * (cos * dx - sin * dy), y: vh / 2 + c.z * (sin * dx + cos * dy) };
}

export function toWorld(c: Camera, vw: number, vh: number, s: Pt): Pt {
  const dx = (s.x - vw / 2) / c.z;
  const dy = (s.y - vh / 2) / c.z;
  const cos = Math.cos(c.r);
  const sin = Math.sin(c.r);
  return { x: c.x + cos * dx + sin * dy, y: c.y - sin * dx + cos * dy };
}

/** Camera with `z`/`r` that keeps world point `w` under screen point `s`. */
export function pin(c: Camera, vw: number, vh: number, w: Pt, s: Pt, z = c.z, r = c.r): Camera {
  const dx = (s.x - vw / 2) / z;
  const dy = (s.y - vh / 2) / z;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: w.x - (cos * dx + sin * dy), y: w.y - (-sin * dx + cos * dy), z, r };
}

export function panBy(c: Camera, dx: number, dy: number): Camera {
  const cos = Math.cos(c.r);
  const sin = Math.sin(c.r);
  const wx = (cos * dx + sin * dy) / c.z;
  const wy = (-sin * dx + cos * dy) / c.z;
  return { ...c, x: c.x - wx, y: c.y - wy };
}

/** Snap within three degrees of each 45-degree display angle, in either direction. */
export function snapRotation(r: number): number {
  const step = Math.PI / 4, index = Math.round(r / step), target = index * step;
  return Math.abs(r - target) <= Math.PI / 60 + 1e-12 ? (index % 8 === 0 ? 0 : target) : r;
}

/**
 * Edge pan: how fast (screen px per second) a drag held near the frame's edge moves the view
 * toward that edge. Zero outside the `band` along each edge; inside it the speed eases in with
 * depth (quadratic) and reaches `max` at the edge, and beyond it, since a captured pointer can
 * leave the frame. Positive x shows more of what lies to the right; at a corner both are set.
 */
export function edgePanVelocity(p: Pt, vw: number, vh: number, band: number, max: number): Pt {
  if (!(band > 0)) return { x: 0, y: 0 };
  const depth = (d: number) => clamp(d / band, 0, 1) ** 2;
  return {
    x: (depth(p.x - (vw - band)) - depth(band - p.x)) * max,
    y: (depth(p.y - (vh - band)) - depth(band - p.y)) * max,
  };
}

/**
 * Edge-pan speed `v`, limited by the diagram: as the diagram's far side (`box`, on screen) comes
 * within `margin` of the frame's edge, the speed falls with the room left (`rate` per second) and
 * stops there. A diagram already in view in that direction does not pan at all, and a long hold
 * never strands the view in empty space.
 */
export function edgePanStop(v: Pt, box: Rect, vw: number, vh: number, margin: number, rate = 6): Pt {
  const limit = (s: number, room: number) => (room <= 0.5 ? 0 : Math.sign(s) * Math.min(Math.abs(s), room * rate));
  return {
    x: v.x > 0 ? limit(v.x, box.x + box.w - (vw - margin)) : v.x < 0 ? limit(v.x, margin - box.x) : 0,
    y: v.y > 0 ? limit(v.y, box.y + box.h - (vh - margin)) : v.y < 0 ? limit(v.y, margin - box.y) : 0,
  };
}

export function cssTransform(c: Camera, vw: number, vh: number): string {
  return `translate(${vw / 2}px, ${vh / 2}px) rotate(${c.r}rad) scale(${c.z}) translate(${-c.x}px, ${-c.y}px)`;
}

/** Screen-space bounding box of a world rectangle under the camera. */
export function screenBox(c: Camera, vw: number, vh: number, r: Rect): Rect {
  const pts = [
    toScreen(c, vw, vh, { x: r.x, y: r.y }),
    toScreen(c, vw, vh, { x: r.x + r.w, y: r.y }),
    toScreen(c, vw, vh, { x: r.x, y: r.y + r.h }),
    toScreen(c, vw, vh, { x: r.x + r.w, y: r.y + r.h }),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpCam(a: Camera, b: Camera, t: number): Camera {
  // Interpolate zoom geometrically so zooms feel even.
  const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * t);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z, r: a.r + angleDelta(a.r, b.r) * t };
}

export function camEqual(a: Camera, b: Camera): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 1e-5 && Math.abs(angleDelta(a.r, b.r)) < 1e-5;
}

export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Bézier chain (flat x,y pairs: p0, then c1 c2 p per segment) → SVG path data. */
export function pathData(p: ArrayLike<number>): string {
  if (p.length < 2) return '';
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(p[0])} ${f(p[1])}`;
  for (let i = 2; i + 5 < p.length + 0; i += 6) {
    d += `C${f(p[i])} ${f(p[i + 1])} ${f(p[i + 2])} ${f(p[i + 3])} ${f(p[i + 4])} ${f(p[i + 5])}`;
  }
  return d;
}

/** Sample a Bézier chain to `k` points spread over its segments (used to morph between routes). */
export function sample(p: ArrayLike<number>, k = 24): Float64Array {
  const out = new Float64Array(k * 2);
  const segs = Math.max(0, Math.floor((p.length - 2) / 6));
  if (segs === 0) {
    for (let i = 0; i < k; i++) {
      out[i * 2] = p[0] ?? 0;
      out[i * 2 + 1] = p[1] ?? 0;
    }
    return out;
  }
  for (let i = 0; i < k; i++) {
    const u = (i / (k - 1)) * segs;
    const s = Math.min(segs - 1, Math.floor(u));
    const t = u - s;
    const o = s * 6;
    const x0 = p[o], y0 = p[o + 1], x1 = p[o + 2], y1 = p[o + 3], x2 = p[o + 4], y2 = p[o + 5], x3 = p[o + 6], y3 = p[o + 7];
    const m = 1 - t;
    const a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
    out[i * 2] = a * x0 + b * x1 + c * x2 + d * x3;
    out[i * 2 + 1] = a * y0 + b * y1 + c * y2 + d * y3;
  }
  return out;
}

export function polyData(s: Float64Array): string {
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = '';
  for (let i = 0; i < s.length; i += 2) d += (i ? 'L' : 'M') + f(s[i]) + ' ' + f(s[i + 1]);
  return d;
}

export function sectorData(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  const full = span >= Math.PI * 2 - 1e-6;
  const f = (v: number) => Math.round(v * 10) / 10;
  const P = (r: number, a: number) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  if (full) {
    const outer = `M${P(r1, 0)}A${f(r1)} ${f(r1)} 0 1 1 ${P(r1, Math.PI)}A${f(r1)} ${f(r1)} 0 1 1 ${P(r1, 0)}Z`;
    if (r0 <= 0.5) return outer;
    return outer + `M${P(r0, 0)}A${f(r0)} ${f(r0)} 0 1 0 ${P(r0, Math.PI)}A${f(r0)} ${f(r0)} 0 1 0 ${P(r0, 0)}Z`;
  }
  const large = span > Math.PI ? 1 : 0;
  if (r0 <= 0.5) return `M${f(cx)} ${f(cy)}L${P(r1, a0)}A${f(r1)} ${f(r1)} 0 ${large} 1 ${P(r1, a1)}Z`;
  return `M${P(r0, a0)}L${P(r1, a0)}A${f(r1)} ${f(r1)} 0 ${large} 1 ${P(r1, a1)}L${P(r0, a1)}A${f(r0)} ${f(r0)} 0 ${large} 0 ${P(r0, a0)}Z`;
}

export function rectData(x: number, y: number, w: number, h: number, rad = 14): string {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2));
  const f = (v: number) => Math.round(v * 10) / 10;
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
