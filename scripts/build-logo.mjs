// Draws the lodeflow logo: "lode" over "flow", with the two o's as diagram nodes
// joined by an edge. Writes site/logo.svg, site/logo-dark.svg and site/favicon.svg.
//   node scripts/build-logo.mjs
import { writeFileSync } from 'node:fs';

const root = new URL('../site/', import.meta.url);
const X = 100, A = 150, S = 26, GAP = 12; // x-height, ascender, stroke, letter gap (baseline y = 0)
const r = (X - S) / 2, cy = -X / 2;

const circle = (cx, y, rad) => `M${cx - rad},${y}a${rad},${rad} 0 1 0 ${2 * rad},0a${rad},${rad} 0 1 0 ${-2 * rad},0`;
// Centreline strokes per letter; `o` is drawn separately as a node.
const LETTERS = {
  l: { w: S, d: (x) => `M${x + S / 2},${-A}V0` },
  o: { w: 102, node: true },
  d: { w: 100, d: (x) => circle(x + 50, cy, r) + `M${x + 100 - S / 2},${-A}V0` },
  e: { w: 100, d: (x) => {
    const c = x + 50, a = (40 * Math.PI) / 180;
    return `M${c - r},${cy}H${c + r}A${r},${r} 0 1 0 ${c + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  } },
  f: { w: 66, d: (x) => {
    const xs = x + S / 2 + 4, h = 26, yt = -A + S / 2;
    return `M${xs},0V${yt + h}A${h},${h} 0 0 1 ${xs + h},${yt}H${x + 66}M${x},${-X + S / 2}H${x + 60}`;
  } },
  w: { w: 134, clip: true, d: (x) => `M${x + 6},${-X - 20}L${x + 37},0L${x + 67},${-X * 0.64}L${x + 97},0L${x + 128},${-X - 20}` },
};

function word(text, dx, dy, { ink, node, fill }, id) {
  let x = dx, out = '', defs = '', o = null;
  for (const ch of text) {
    const L = LETTERS[ch];
    if (L.node) {
      o = { x, cx: x + L.w / 2 };
      out += `<rect x="${x + S / 2}" y="${dy - X + S / 2}" width="${L.w - S}" height="${X - S}" rx="22" fill="${fill}" stroke="${node}" stroke-width="${S}"/>`;
    } else {
      let clip = '';
      if (L.clip) {
        defs += `<clipPath id="${id}"><rect x="${x - 4}" y="${-X}" width="${L.w + 8}" height="${X}"/></clipPath>`;
        clip = ` clip-path="url(#${id})"`;
      }
      out += `<path d="${L.d(x)}" transform="translate(0,${dy})"${clip} fill="none" stroke="${ink}" stroke-width="${S}"/>`;
    }
    x += L.w + GAP;
  }
  return { out, defs, o, width: x - GAP };
}

function lockup({ ink, node }) {
  const gapY = 210, top = A; // first baseline sits A below the top edge
  const dx = (LETTERS.f.w + GAP + S + GAP) - (S + GAP); // aligns the two o's
  const lode = word('lode', dx, top, { ink, node, fill: 'none' }, 'lf-clip-a');
  const flow = word('flow', 0, top + gapY, { ink, node, fill: node }, 'lf-clip-b');
  const cx = lode.o.cx, tip = top + gapY - X - 2, s = 20;
  const edge = `<path d="M${cx},${top}V${tip - s}" stroke="${node}" stroke-width="8"/>` +
    `<path d="M${cx},${tip}L${cx - s * 0.7},${tip - s}L${cx + s * 0.7},${tip - s}Z" fill="${node}"/>`;
  const w = Math.max(lode.width, flow.width), h = top + gapY;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="lodeflow">` +
    `<title>lodeflow</title><defs>${lode.defs}${flow.defs}</defs>${lode.out}${edge}${flow.out}</svg>\n`;
}

const favicon = (node) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="${node}"/>` +
  `<rect x="13" y="6.5" width="14" height="10.5" rx="3.5" fill="none" stroke="#fff" stroke-width="3"/>` +
  `<path d="M20 17v3" stroke="#fff" stroke-width="2"/><path d="M20 24.2 17.3 20.5h5.4z" fill="#fff"/>` +
  `<rect x="11.5" y="24" width="17" height="11" rx="3.5" fill="#fff"/></svg>\n`;

writeFileSync(new URL('logo.svg', root), lockup({ ink: '#15171c', node: '#1f5cff' }));
writeFileSync(new URL('logo-dark.svg', root), lockup({ ink: '#eef1f6', node: '#5b86ff' }));
writeFileSync(new URL('favicon.svg', root), favicon('#1f5cff'));
console.log('Wrote site/logo.svg, site/logo-dark.svg and site/favicon.svg');
