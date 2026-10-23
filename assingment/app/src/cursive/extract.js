// extract.js — Static (no ML) extraction of the cursive extras from a
// per-letter cursive sample (prefix = entry stroke, suffix = exit stroke,
// misc = extra body ink such as a loop). Method (readme 6.3):
//   1. measure on strokes smoothed with a 3-point moving average on dense
//      strokes (kills mouse jitter); endpoints pinned, NO Chaikin, so lengths
//      are not stretched (locked decision);
//   2. compare the sample to the base glyph of the same letter in the shared
//      cap-unit frame (baseline y=0, y up); the body region is the median
//      left/right ink edge over the base variants;
//   3. flag every point 'L' (left of body) / 'R' (right of body) / 'M'
//      (inside the body's x-range but beyond the base's padded per-band
//      y-range); same-flag runs become extras, cropped with a few neighbouring
//      points so the shape keeps its junction with the body.
// Called by cursive.html on each saved cursive sample. Pure geometry; no DOM,
// no randomness.

import { inkBounds } from '../geometry.js';

const BINS = 24;          // x-bands used to profile the base glyph
const MIN_RUN_POINTS = 3; // a run shorter than this is noise and ignored
const MIN_RUN_LEN = 0.08; // cap units of polyline length; same noise floor
const CONTEXT = 3;        // neighbouring points kept around a run when cropping
const DENSE_POINTS = 12;  // live-capture strokes are denser than this

// 3-point moving average on interior points; endpoints stay put.
function smoothForMeasure(strokes) {
  return strokes.map((stroke) => {
    if (stroke.length <= DENSE_POINTS) return stroke;
    const out = stroke.map((p) => ({ ...p }));
    for (let i = 1; i < out.length - 1; i++) {
      out[i] = {
        ...out[i],
        x: (stroke[i - 1].x + 2 * stroke[i].x + stroke[i + 1].x) / 4,
        y: (stroke[i - 1].y + 2 * stroke[i].y + stroke[i + 1].y) / 4,
      };
    }
    return out;
  });
}

function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function strokeLen(stroke, from, to) {
  let len = 0;
  for (let i = from + 1; i <= to; i++) len += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  return len;
}

// Per-x-band y-range [min,max] of one glyph's ink, over the body region.
function profileBins(strokes, left, right, bins) {
  const w = (right - left) / bins;
  const out = Array.from({ length: bins }, () => ({ min: Infinity, max: -Infinity }));
  for (const stroke of strokes) {
    for (const p of stroke) {
      const i = Math.floor((p.x - left) / w);
      if (i < 0 || i >= bins) continue;
      if (p.y > out[i].max) out[i].max = p.y;
      if (p.y < out[i].min) out[i].min = p.y;
    }
  }
  return out;
}

// The y-range per x-band that the letter's ink can occupy across ALL of its
// variants (per-band envelope: the min of mins and the max of maxes). Only
// ink that leaves this envelope can be a cursive misc extra — a loop or an
// extended tail — because a normal variant of the letter always stays inside
// its own envelope. Bins with no variant ink fall back to the widest ink
// extent of the letter (they are body holes, not extras).
function bodyBand(variants, left, right) {
  const perVariant = variants.map((v) => profileBins(v.strokes, left, right, BINS));
  const lo = Math.min(...variants.map((v) => v.bounds.bottom));
  const hi = Math.max(...variants.map((v) => v.bounds.top));
  return Array.from({ length: BINS }, (_, i) => {
    const a = Math.min(...perVariant.map((vp) => vp[i].min));
    const b = Math.max(...perVariant.map((vp) => vp[i].max));
    return Number.isFinite(a) && Number.isFinite(b) ? { min: a, max: b } : { min: lo, max: hi };
  });
}

// Flag one point: 'L' left of body, 'R' right of body, 'M' beyond the body
// envelope inside the body, or null (confined to the body).
function flag(p, bodyLeft, bodyRight, ranges, w) {
  if (p.x < bodyLeft) return 'L';
  if (p.x > bodyRight) return 'R';
  const bin = ranges[Math.min(BINS - 1, Math.max(0, Math.floor((p.x - bodyLeft) / w)))];
  const pad = 0.04; // rounding guard only; the envelope is generous already
  if (p.y > bin.max + pad || p.y < bin.min - pad) return 'M';
  return null;
}

// Runs of one flag inside one stroke, as { flag, start, end } index pairs.
function runsOf(stroke, flags) {
  const runs = [];
  let current = null;
  let start = -1;
  const flush = (end) => {
    if (!current) return false;
    const long = (end - start + 1) >= MIN_RUN_POINTS || strokeLen(stroke, start, end) >= MIN_RUN_LEN;
    if (long) runs.push({ flag: current, start, end });
    return long;
  };
  for (let i = 0; i < stroke.length; i++) {
    const f = flags[i];
    if (f !== current) {
      if (current) flush(i - 1);
      current = f;
      start = i;
    }
  }
  if (current) flush(stroke.length - 1);
  return runs;
}

// Turn one run into an Extra record (phase 6.3 fields): shape as points
// relative to the attach point, plus length, reach and the reference edges.
function runToExtra(stroke, run, body) {
  const cStart = Math.max(0, run.start - (run.flag === 'R' ? CONTEXT : 2));
  const cEnd = Math.min(stroke.length - 1, run.end + (run.flag === 'L' ? CONTEXT : 2));
  const pts = stroke.slice(cStart, cEnd + 1).map((p) => ({ x: p.x, y: p.y }));

  // The attach point is the junction ON the body edge, so the extra reconnects
  // to the body exactly where it left it.
  let attach = null;
  if (run.flag === 'L') attach = pts.find((p) => p.x >= body.left) || pts[pts.length - 1];
  else if (run.flag === 'R') attach = pts.findLast((p) => p.x <= body.right) || pts[0];
  else attach = pts[0];

  let reach = 0;
  if (run.flag === 'L') {
    reach = Math.max(...stroke.slice(run.start, run.end + 1).map((p) => body.left - p.x));
  } else if (run.flag === 'R') {
    reach = Math.max(...stroke.slice(run.start, run.end + 1).map((p) => p.x - body.right));
  } else {
    reach = Math.max(...stroke.slice(run.start, run.end + 1).map((p) => {
      const bin = body.ranges[Math.min(BINS - 1, Math.max(0, Math.floor((p.x - body.left) / body.w)))];
      return Math.max(p.y - bin.max, bin.min - p.y);
    }));
  }

  return {
    kind: run.flag === 'L' ? 'prefix' : run.flag === 'R' ? 'suffix' : 'misc',
    rel: pts.map((p) => ({ x: +(p.x - attach.x).toFixed(4), y: +(p.y - attach.y).toFixed(4) })),
    attach: { x: +attach.x.toFixed(4), y: +attach.y.toFixed(4) },
    ref: { left: +body.left.toFixed(4), right: +body.right.toFixed(4) },
    reach: +reach.toFixed(4),
    length: +strokeLen(stroke, run.start, run.end).toFixed(4),
  };
}

// MERGE_ON_STROKE: two same-kind runs in one stroke with at most this many
// unflagged points between them are one extra (a loop can dip back into the
// padded band and fragment).
const MERGE_GAP = 2;

// Main entry: baseVariants (store.glyphs[char]) + a normalized cursive sample
// -> list of Extra records, in drawing order.
export function extractExtras(baseVariants, sample) {
  if (!baseVariants || !baseVariants.length) return [];
  const smooth = smoothForMeasure(sample.strokes);
  if (!inkBounds(smooth)) return [];

  const bodyLeft = median(baseVariants.map((v) => v.bounds.left));
  const bodyRight = median(baseVariants.map((v) => v.bounds.right));
  const body = {
    left: bodyLeft,
    right: bodyRight,
    ranges: bodyBand(baseVariants, bodyLeft, bodyRight),
    w: (bodyRight - bodyLeft) / BINS,
  };

  const extras = [];
  for (const stroke of smooth) {
    const flags = stroke.map((p) => flag(p, body.left, body.right, body.ranges, body.w));
    const runs = runsOf(stroke, flags);

    // Merge runs of the same flag separated only by a few unflagged points.
    const merged = [];
    for (const run of runs) {
      const prev = merged[merged.length - 1];
      if (prev && prev.flag === run.flag && run.start - prev.end - 1 <= MERGE_GAP) prev.end = run.end;
      else merged.push({ ...run });
    }

    for (const run of merged) {
      const extra = runToExtra(stroke, run, body);
      // A prefix/suffix barely past the body edge is capture noise, not a
      // flick a renderer can bridge with; keep only real sticks-out-shapes.
      if ((extra.kind === 'prefix' || extra.kind === 'suffix') && extra.reach < 0.04) continue;
      extras.push(extra);
    }
  }
  return extras;
}
