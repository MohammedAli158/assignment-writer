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
  return store;
}
