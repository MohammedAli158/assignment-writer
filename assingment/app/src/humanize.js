// humanize.js — Render-time stroke treatment, applied as ink is drawn
// (draw.js is the only caller). The stored data is never touched. Three
// fixes, all on one glyph's strokes:
//   1. micro-shake filter: dense captured strokes carry high-frequency hand
//      tremor too fine for a human to reproduce; a light moving average on
//      strokes with many points removes it (legacy strokes are sparse, so
//      this is skipped for them);
//   2. corner smoothing: strokes with 4+ points (the drawn curves, e.g. the
//      bowls of 'a' and 'p') get ONE pass of Chaikin corner cutting with the
//      endpoints pinned — sharper edges become rounded, but after a single
//      pass the letter is still visibly not machine-perfect. Short strokes of
//      2-3 points are left alone, which protects intentional vertices like
//      the point of 'v';
//   3. straight-line bow: a long, perfectly straight run cannot come from a
//      pen. Strokes of 2-3 points get each of their long segments gently
//      bowed, so stems and arms pick up a slight organic slant while
//      endpoints stay pinned to the layout positions.
// All randomness comes from rng.js named streams, never Math.random.

import { rngFor } from './rng.js';

// Strokes with more points than this are "dense" (live capture, ~1px sampling)
// and get the shake filter. Legacy profile strokes have 2..9 points.
const DENSE_POINTS = 12;

// Only strokes with at least this many points count as drawn curves and are
// corner-smoothed. 2-3 point strokes are kept exactly, vertices included.
const CURVE_POINTS = 4;

// Segments (runs between consecutive stored points) shorter than this chord
// length in cap units are left unbowed.
const MIN_BEND_CHORD = 0.25;

// Bow depth range, as a fraction of the segment's own chord length.
const BEND_MIN = 0.045;
const BEND_MAX = 0.09;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 3-point moving average on the interior only; endpoints are pinned so the
// stroke stays where layout put it.
function shakesOut(stroke) {
  const out = stroke.map((p) => ({ ...p }));
  for (let i = 1; i < out.length - 1; i++) {
    out[i] = {
      x: (stroke[i - 1].x + 2 * stroke[i].x + stroke[i + 1].x) / 4,
      y: (stroke[i - 1].y + 2 * stroke[i].y + stroke[i + 1].y) / 4,
      t: stroke[i].t ?? null,
      pressure: stroke[i].pressure ?? null,
    };
  }
  return out;
}

// One Chaikin pass: each segment is replaced by its 1/4 and 3/4 points, first
// and last point kept. This is corner cutting, so the curve still shows its
// hand behind it — smoother edges, not a perfect spline.
function chaikinOnce(stroke) {
  const out = [{ ...stroke[0] }];
  for (let i = 0; i < stroke.length - 1; i++) {
    const a = stroke[i];
    const b = stroke[i + 1];
    out.push({
      x: 0.75 * a.x + 0.25 * b.x,
      y: 0.75 * a.y + 0.25 * b.y,
      t: a.t ?? null,
      pressure: a.pressure ?? null,
    });
    out.push({
      x: 0.25 * a.x + 0.75 * b.x,
      y: 0.25 * a.y + 0.75 * b.y,
      t: b.t ?? null,
      pressure: b.pressure ?? null,
    });
  }
  out.push({ ...stroke[stroke.length - 1] });
  return out;
}

// Point on segment a->b at fraction t, carrying point q's timestamp fields.
function along(a, b, t, q) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    t: q?.t ?? null,
    pressure: q?.pressure ?? null,
  };
}

// Replace a straight segment a->b of length `len` with a gentle arc: sampled
// by five points (endpoints kept in place), interior points pushed along the
// chord normal by amp1 * sin(pi t) plus a small second-harmonic asymmetry,
// so the arm looks guided by a hand rather than a ruler.
function bowSegment(a, b, amp1, amp2) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const len = Math.hypot(ux, uy);
  const nx = -uy / len;
  const ny = ux / len;
  const ts = [0, 0.25, 0.5, 0.75, 1];
  return ts.map((t) => {
    const off = amp1 * Math.sin(Math.PI * t) + amp2 * Math.sin(2 * Math.PI * t);
    const p = along(a, b, t, t < 0.5 ? a : b);
    return { ...p, x: p.x + nx * off, y: p.y + ny * off };
  });
}

// Bow every long, straight segment of a short (2-3 point) stroke. Each
// segment gets its own seeded stream keyed by stem/segment index, endpoints
// pinned so joins between segments and with neighbours stay put.
function bowShortStrokes(stroke, seed, glyphKey, si) {
  const out = [];
  for (let i = 0; i < stroke.length - 1; i++) {
    const a = { ...stroke[i] };
    const b = { ...stroke[i + 1] };
    const len = dist(a, b);
    if (len < MIN_BEND_CHORD) {
      if (i > 0) out.pop(); // keep the shared vertex once
      out.push(a, b);
      continue;
    }
    const rng = rngFor(seed, 'humanize', glyphKey, si, i);
    let amp1 = (BEND_MIN + rng() * (BEND_MAX - BEND_MIN)) * len;
    let amp2 = amp1 * 0.35 * (rng() < 0.5 ? -1 : 1);
    if (rng() < 0.5) amp1 = -amp1;
    const bowed = bowSegment(a, b, amp1, amp2);
    if (i > 0) out.pop();
    out.push(...bowed);
  }
  return out;
}

// Main entry: one glyph's strokes in cap units -> treated strokes.
export function humanizeStrokes(strokes, seed, glyphKey) {
  return strokes.map((stroke, si) => {
    let s = stroke;
    if (s.length > DENSE_POINTS) s = shakesOut(s);
    if (s.length >= CURVE_POINTS) {
      s = chaikinOnce(s);
    } else {
      s = bowShortStrokes(s, seed, glyphKey, si);
    }
    return s;
  });
}
