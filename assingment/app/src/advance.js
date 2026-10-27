// advance.js — Turns raw stroke geometry into a placeable glyph sample:
// advances are measured from real ink plus a side bearing (never from the
// capture canvas), and the baseline stays at y = 0 so descenders hang below
// it instead of being shrunk. Called by capture.js and loaders/legacyJson.js.

import { inkBounds, translateStrokes } from './geometry.js';

// Shift strokes so the left ink edge sits at `sideBearing`, then measure the
// advance as ink width + a bearing on each side.
// Returns { strokes, bounds, advance, baseline } or null for empty ink.
export function normalizeToBaseline(strokes, sideBearing) {
  // Strokes shorter than two points are never drawn (strokePolylines needs at
  // least two points), so they must not be counted in bounds/advance either —
  // a stray tap would otherwise inflate a glyph's advance and leave random
  // blank gaps inside words.
  const drawable = strokes.filter((stroke) => stroke.length >= 2);
  const b = inkBounds(drawable);
  if (!b) return null;
  const dx = sideBearing - b.left;
  const moved = translateStrokes(drawable, dx, 0);
  const bounds = { left: b.left + dx, right: b.right + dx, top: b.top, bottom: b.bottom };
  return {
    strokes: moved,
    bounds,
    advance: bounds.right + sideBearing,
    baseline: 0,
  };
}
