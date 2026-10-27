// glyphstore.js — The one internal glyph-set format and its operations.
// Loaders (capture.js, loaders/legacyJson.js) build samples through here and
// index.html / debug.html read statistics from it. Pure data; no DOM.

import { DEFAULT_GUIDES, SIDE_BEARING } from './geometry.js';

export const STORE_VERSION = 1;

// A Sample is:
//   { strokes: [ [ {x,y,t,pressure}, ... ], ... ],  // cap units, y up, y=0 baseline
//     bounds:  { left, right, top, bottom },        // cap units, from ink only
//     advance: number,                              // cap units, ink width + bearings
//     baseline: 0,
//     source: 'capture' | 'legacy',
//     metricsEstimated: boolean,
//     legacyClass?: string }                        // set only by the legacy loader
//
// A Store is:
//   { version, metrics:{ capHeight, xHeight, ascender, descender, sideBearing },
//     glyphs: { "<char>": [ Sample, ... ] },
//     cursive?: { samples:{...}, extras:{...} } }   // Phase 3 (src/cursive/...)
// The cursive section passes through serialize/deserialize untouched and may
// be absent entirely; the renderer treats a missing section as "no cursive".
//
// The renderer never learns where a sample came from: source/legacyClass are
// informational only.

export const DEFAULT_METRICS = {
  capHeight: 1,
  xHeight: DEFAULT_GUIDES.xHeight,
  ascender: DEFAULT_GUIDES.ascender,
  descender: Math.abs(DEFAULT_GUIDES.descender),
  sideBearing: SIDE_BEARING,
};

export function createStore(metrics) {
  return {
    version: STORE_VERSION,
    metrics: { ...DEFAULT_METRICS, ...(metrics || {}) },
    glyphs: {},
  };
}

export function addSample(store, char, sample) {
  if (!store.glyphs[char]) store.glyphs[char] = [];
  store.glyphs[char].push(sample);
}

export function glyphCount(store) {
  return Object.keys(store.glyphs).length;
}

export function totalSamples(store) {
  let n = 0;
  for (const list of Object.values(store.glyphs)) n += list.length;
  return n;
}

// Characters in `text` with no sample in the store. Whitespace is a gap, not
// a glyph, so it is never reported missing.
export function missingChars(store, text) {
  const out = new Set();
  for (const ch of String(text)) {
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue;
    if (!store.glyphs[ch] || store.glyphs[ch].length === 0) out.add(ch);
  }
  return out;
}

export function serialize(store) {
  return JSON.stringify(store);
}

// Repair stored samples whose ink was polluted at capture/extraction time.
// Two pollutions render as random blank gaps inside words (the glyph's
// advance includes ink that draw.js never puts on the page):
//   1. single-point strokes: skipped by strokePolylines (needs 2+ points),
//      a stray tap still counted in bounds/advance — dropped;
//   2. an ink cluster detached horizontally from the letter's body (ink of a
//      NEIGHBOURING letter picked up by the legacy extraction) — its advance
//      spans 2+ cap units of nothing — dropped, keeping the dominant cluster.
// Then bounds/advance are re-measured from the kept ink, left edge re-anchored
// to sideBearing like advance.js normalizeToBaseline. The cursive section is
// never touched (stored fllicks may genuinely reach far from the body).
// Idempotent; applied on deserialize so saved files and persisted
// localStorage stores self-heal on load.
const REPAIR_DETACH_GAP = 0.6;

function measureInk(strokes) {
  let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y > top) top = p.y;
      if (p.y < bottom) bottom = p.y;
    }
  }
  return Number.isFinite(left) ? { left, right, top, bottom } : null;
}

export function repairSample(sample, sideBearing) {
  const drawable = sample.strokes.filter((s) => s.length >= 2);
  if (!drawable.length) return false;
  if (drawable.length !== sample.strokes.length) sample.strokes = drawable;

  const extents = drawable
    .map((s) => ({ s, lo: Math.min(...s.map((p) => p.x)), hi: Math.max(...s.map((p) => p.x)), pts: s.length }))
    .sort((a, b) => a.lo - b.lo);
  if (extents.length > 1) {
    for (let k = 1; k < extents.length; k++) {
      if (extents[k].lo - extents[k - 1].hi > REPAIR_DETACH_GAP) {
        const groups = [extents.slice(0, k), extents.slice(k)];
        const ptCount = (g) => g.reduce((n, e) => n + e.pts, 0);
        groups.sort((a, b) => ptCount(b) - ptCount(a));
        sample.strokes = groups[0].map((e) => e.s);
        break;
      }
    }
  }

  const b = measureInk(sample.strokes);
  const dx = sideBearing - b.left;
  for (const stroke of sample.strokes) for (const p of stroke) p.x += dx;
  sample.bounds = { left: b.left + dx, right: b.right + dx, top: b.top, bottom: b.bottom };
  sample.advance = sample.bounds.right + sideBearing;
  return true;
}

// Parse text produced by serialize(). Throws on a clearly wrong shape.
export function deserialize(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object' || !obj.glyphs || typeof obj.glyphs !== 'object') {
    throw new Error('Not a glyph store: expected a "glyphs" object');
  }
  const store = {
    version: obj.version || STORE_VERSION,
    metrics: { ...DEFAULT_METRICS, ...(obj.metrics || {}) },
    glyphs: obj.glyphs,
  };
  if (obj.cursive) store.cursive = obj.cursive; // Phase 3 section passes through
  const sideBearing = store.metrics.sideBearing ?? DEFAULT_METRICS.sideBearing;
  for (const list of Object.values(store.glyphs)) {
    if (!Array.isArray(list)) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i] || !Array.isArray(list[i].strokes) || !repairSample(list[i], sideBearing)) {
        list.splice(i, 1); // nothing drawable in this variant
      }
    }
  }
  return store;
}
