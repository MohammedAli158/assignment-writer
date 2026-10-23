// geometry.js — Pure geometry for the glyph store: ink bounds and the
// cap-height coordinate system (capital height = 1.0, baseline at y = 0, y
// pointing up). Called by capture.js, advance.js and loaders/legacyJson.js.
// No DOM, no randomness, no Date.

// Default pixels per one cap-height unit on the capture canvas. Only used to
// convert pointer pixels into cap units; everything stored is in cap units.
export const PX_PER_CAP = 180;

// Blank space kept on each side of a glyph's ink when measuring advance.
export const SIDE_BEARING = 0.08;

// The four visible guide lines of the capture canvas, in cap units (y up).
export const DEFAULT_GUIDES = { ascender: 1.0, xHeight: 0.52, baseline: 0.0, descender: -0.28 };

// Bounding box of all stroke ink. `top` is the largest y (y is up) and
// `bottom` the smallest, so a descender gives a negative `bottom`. Returns
// null when no points exist.
export function inkBounds(strokes) {
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y > top) top = p.y;
      if (p.y < bottom) bottom = p.y;
    }
  }
  if (!Number.isFinite(left)) return null;
  return { left, right, top, bottom };
}

// Deep copy so callers can never mutate the live capture buffer.
export function cloneStrokes(strokes) {
  return strokes.map((stroke) => stroke.map((p) => ({ ...p })));
}

// Move every point by (dx, dy) cap units; returns new strokes.
export function translateStrokes(strokes, dx, dy) {
  return strokes.map((stroke) => stroke.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })));
}

// Build a pixel -> cap-unit converter. `originX` is the x pixel of the left
// ink margin, `baselineY` the y pixel of the baseline.
export function pxToCap(originX, baselineY, pxPerCap = PX_PER_CAP) {
  return (pt) => ({
    x: (pt.x - originX) / pxPerCap,
    y: (baselineY - pt.y) / pxPerCap,
    t: pt.t ?? null,
    pressure: pt.pressure ?? null,
  });
}

// Inverse of pxToCap for a single point (used by debug overlays).
export function capToPx(x, y, originX, baselineY, pxPerCap = PX_PER_CAP) {
  return { x: originX + x * pxPerCap, y: baselineY - y * pxPerCap };
}
