// extract.js — Static (no ML) extraction of the cursive extras from a
// per-letter cursive sample: prefix = entry stroke, suffix = exit stroke,
// misc = extra body ink such as a loop. Called by cursive.html on each saved
// cursive sample. Pure geometry; no DOM, no randomness.
//
// The sample is compared against ONE base print variant (store.glyphs[ch]
// [sample.baseIndex]), not the union envelope of all variants — per-variant
// edges differ too much for a shared envelope, which is what put extras on
// the wrong letter shapes. Both live in the same cap-unit frame: the cursive
// capture keeps the as-drawn x (capture.js save({ align: 'ghost' })), and the
// ghost variant was drawn exactly there, so traced body ink sits on the base
// ink and no re-anchoring is needed at draw time.
//
// Method:
//   1. measure on strokes smoothed with a 3-point moving average on dense
//      strokes (kills mouse jitter); endpoints pinned, NO Chaikin, so lengths
//      are not stretched (locked decision);
//   2. for every sample point, measure the distance to the base variant's
//      ink; a point within CONTACT_TOL counts as body contact;
//   3. per stroke: the run before the first contact is a prefix, the run
//      after the last contact is a suffix, off-body runs in between (or a
//      stroke that never touches the base) are misc. Runs below the noise
//      floor are dropped; each extra keeps a few neighbouring points so its
//      shape reconnects to the body.
//
// Extras are stored in the sample's frame (== the base variant's frame):
// rel points relative to the attach point, so draw.js anchors them at
// (item.x, item.y) exactly like the base strokes. `base` (the variant index)
// and `from` (the sample index) are attached by the caller (cursive.html).

const MIN_RUN_POINTS = 3; // a run shorter than this is noise and ignored
const MIN_RUN_LEN = 0.08; // cap units of polyline length; same noise floor
const CONTEXT = 3;        // neighbouring points kept around a run when cropping
const DENSE_POINTS = 12;  // live-capture strokes are denser than this
const CONTACT_TOL = 0.06; // cap units: a sample point this close to base ink is body
const NOISE_FLOOR = 0.04; // prefix/suffix with a smaller reach is capture noise

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

function strokeLen(stroke, from, to) {
  let len = 0;
  for (let i = from + 1; i <= to; i++) len += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  return len;
}

// The base variant's ink as segments [a, b] (2+ point strokes only).
function inkSegments(strokes) {
  const segs = [];
  for (const stroke of strokes || []) {
    for (let i = 1; i < stroke.length; i++) segs.push([stroke[i - 1], stroke[i]]);
  }
  return segs;
}

function segDist(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function distToInk(p, segs) {
  let best = Infinity;
  for (const [a, b] of segs) {
    const d = segDist(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

// Turn one run into an Extra record: shape as points relative to the attach
// point (the junction on the body), plus length, reach and the base variant's
// reference edges. `attachIdx` is the body-contact point the run left or
// reaches; null for a stroke with no contact at all.
function runToExtra(stroke, run, kind, attachIdx, base, segs) {
  const cropBefore = kind === 'suffix' ? CONTEXT : kind === 'misc' ? 2 : 0;
  const cropAfter = kind === 'prefix' ? CONTEXT : kind === 'misc' ? 2 : 0;
  const cStart = Math.max(0, run.start - cropBefore);
  const cEnd = Math.min(stroke.length - 1, run.end + cropAfter);
  const pts = stroke.slice(cStart, cEnd + 1).map((p) => ({ x: p.x, y: p.y }));

  const attach = stroke[attachIdx ?? run.start];

  let reach = 0;
  const runPts = stroke.slice(run.start, run.end + 1);
  if (kind === 'prefix') reach = Math.max(...runPts.map((p) => attach.x - p.x));
  else if (kind === 'suffix') reach = Math.max(...runPts.map((p) => p.x - attach.x));
  else reach = Math.max(...runPts.map((p) => distToInk(p, segs)));

  return {
    kind,
    rel: pts.map((p) => ({ x: +(p.x - attach.x).toFixed(4), y: +(p.y - attach.y).toFixed(4) })),
    attach: { x: +attach.x.toFixed(4), y: +attach.y.toFixed(4) },
    ref: { left: +base.bounds.left.toFixed(4), right: +base.bounds.right.toFixed(4) },
    reach: +reach.toFixed(4),
    length: +strokeLen(stroke, run.start, run.end).toFixed(4),
  };
}

// MERGE_ON_STROKE: two misc runs in one stroke with at most this many body
// contact points between them are one extra (a loop can graze the ink and
// fragment).
const MERGE_GAP = 2;

// Main entry: ONE base variant (store.glyphs[char][baseIndex]) + a normalized
// cursive sample (same frame) -> list of Extra records, in drawing order.
export function extractExtras(base, sample) {
  if (!base || !sample || !Array.isArray(sample.strokes) || !base.bounds) return [];
  const segs = inkSegments(base.strokes);
  if (!segs.length) return [];
  const smooth = smoothForMeasure(sample.strokes);

  const extras = [];
  for (const stroke of smooth) {
    if (stroke.length < 2) continue;
    const contact = stroke.map((p) => distToInk(p, segs) <= CONTACT_TOL);
    const first = contact.indexOf(true);
    const last = contact.lastIndexOf(true);

    const emit = (run, kind, attachIdx) => {
      const long = run.end - run.start + 1 >= MIN_RUN_POINTS || strokeLen(stroke, run.start, run.end) >= MIN_RUN_LEN;
      if (!long) return null;
      const extra = runToExtra(stroke, run, kind, attachIdx, base, segs);
      // A prefix/suffix barely past the body is capture noise, not a flick a
      // renderer can bridge with; keep only real sticks-out-shapes.
      if ((kind === 'prefix' || kind === 'suffix') && extra.reach < NOISE_FLOOR) return null;
      return extra;
    };

    if (first === -1) {
      // The stroke never touches the base: all of it is misc body ink.
      const extra = emit({ start: 0, end: stroke.length - 1 }, 'misc', null);
      if (extra) extras.push(extra);
      continue;
    }

    if (first > 0) {
      const pre = emit({ start: 0, end: first - 1 }, 'prefix', first);
      if (pre) extras.push(pre);
    }
    if (last < stroke.length - 1) {
      const suf = emit({ start: last + 1, end: stroke.length - 1 }, 'suffix', last);
      if (suf) extras.push(suf);
    }

    // Interior off-body runs between the first and last contact: misc.
    const runs = [];
    for (let i = first + 1; i <= last; ) {
      if (contact[i]) { i++; continue; }
      let j = i;
      while (j <= last && !contact[j]) j++;
      runs.push({ start: i, end: j - 1 });
      i = j;
    }
    const merged = [];
    for (const run of runs) {
      const prev = merged[merged.length - 1];
      if (prev && run.start - prev.end - 1 <= MERGE_GAP) prev.end = run.end;
      else merged.push({ ...run });
    }
    for (const run of merged) {
      const extra = emit(run, 'misc', run.start - 1); // the contact point just before
      if (extra) extras.push(extra);
    }
  }
  return extras;
}
