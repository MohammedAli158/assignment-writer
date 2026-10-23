// loaders/legacyJson.js — Convert the legacy height-normalized profile into
// the internal glyph store. Legacy shape:
//   { "<char>": [ { "strokes": [ [ [x,y], ... ], ... ] }, ... ] }
// coordinates in 0..1, y pointing down, and EVERY glyph stretched to fill its
// own box, so real size, baseline and descender depth do not survive. Metrics
// are therefore ESTIMATED from the character class and flagged. Called by
// index.html and debug.html. (SVG/image loaders are separate, not built yet.)
//
// This is "legacy normalization": estimated, not measured, and lossy.

import { createStore, addSample } from '../glyphstore.js';
import { normalizeToBaseline } from '../advance.js';

const ASCENDERS = new Set('bdfhklt');
const DESCENDERS = new Set('gjpqy');
const WIDE_SYMBOLS = new Set(['(', ')', '/', '&', '@', '#', '=', '+', '*']);

// Nominal width in cap units that a class's full 0..1 box maps to. The legacy
// file normalized width independently, so these are estimates Ali can tune.
const WIDTH_SCALE = {
  lower: 0.62, ascender: 0.62, descender: 0.62,
  digit: 0.60, cap: 0.85, punct: 0.32, symbol: 0.55,
};

// Vertical band (cap units, y up) that a glyph's 0..1 box maps to. Punctuation
// is normalized arbitrarily in the legacy file, so its band is a fixed guess.
const PUNCT_BANDS = {
  '.': [0, 0.12], ',': [0, 0.12], ':': [0, 0.42], ';': [0, 0.42],
  '-': [0.40, 0.50], "'": [0.72, 1.0], '"': [0.72, 1.0],
  '!': [0, 0.95], '?': [0, 0.95],
};
const SYMBOL_BANDS = {
  '(': [0, 1.0], ')': [0, 1.0], '/': [0, 1.0], '&': [0, 0.9], '@': [0, 0.9],
  '#': [0, 1.0], '=': [0.32, 0.52], '+': [0.25, 0.75], '*': [0.6, 1.0],
};

export function classOf(ch) {
  if (ch >= 'A' && ch <= 'Z') return 'cap';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch >= 'a' && ch <= 'z') {
    if (ASCENDERS.has(ch)) return 'ascender';
    if (DESCENDERS.has(ch)) return 'descender';
    return 'lower';
  }
  if (WIDE_SYMBOLS.has(ch)) return 'symbol';
  return 'punct';
}

export function bandFor(cls, ch, metrics) {
  if (cls === 'lower') return [0, metrics.xHeight];
  if (cls === 'ascender') return [0, metrics.ascender];
  if (cls === 'descender') return [-metrics.descender, metrics.xHeight];
  if (cls === 'digit' || cls === 'cap') return [0, metrics.capHeight];
  if (cls === 'symbol') return SYMBOL_BANDS[ch] || [0, 0.6];
  return PUNCT_BANDS[ch] || [0, 0.4];
}

function convertVariant(variant, cls, ch, metrics) {
  const [lo, hi] = bandFor(cls, ch, metrics);
  const sx = WIDTH_SCALE[cls] ?? 0.6;
  const strokes = [];
  for (const st of variant.strokes || []) {
    const pts = [];
    for (const p of st) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const xn = Number(p[0]);
      const yn = Number(p[1]);
      if (!Number.isFinite(xn) || !Number.isFinite(yn)) continue;
      // x: scale the box width guess. y: remap the box top..bottom to the band.
      pts.push({ x: xn * sx, y: hi - yn * (hi - lo), t: null, pressure: null });
    }
    if (pts.length >= 2) strokes.push(pts);
  }
  return strokes;
}

export function loadLegacyJson(json, options = {}) {
  const store = createStore(options.metrics);
  const metrics = store.metrics;
  for (const ch of Object.keys(json)) {
    const variants = Array.isArray(json[ch]) ? json[ch] : [];
    const cls = classOf(ch);
    for (const variant of variants) {
      const raw = convertVariant(variant, cls, ch, metrics);
      const norm = normalizeToBaseline(raw, metrics.sideBearing);
      if (!norm) continue;
      addSample(store, ch, {
        strokes: norm.strokes,
        bounds: norm.bounds,
        advance: norm.advance,
        baseline: 0,
        source: 'legacy',
        metricsEstimated: true,
        legacyClass: cls,
      });
    }
  }
  return store;
}
