// bridge.js — The connector between two cursive letters: from one letter's
// suffix tip to the next letter's entry point. Ali's locked choice: the mix
// is per occurrence — sometimes a pseudo-straight segment (tiny bow), mostly
// a bowed curve (Ali: "sometimes pseudo straight, sometimes bowed curve").
// Endpoints are always pinned exactly at the two anchor points, so the bridge
// meets the neighbours without seams; interior points move along the chord
// normal (same shape as humanize.js's bow). One polyline is returned, already
// in line coordinates (absolute x, baseline-relative y), or null when the two
// anchors coincide. Called by layout.js. Randomness only from the given
// seeded stream: rngFor(seed, 'bridge', ...parts).

import { rngFor } from '../rng.js';

const POINTS = 7; // interior resolution; plenty for a short connector

// Bow depth as a fraction of the chord length.
const PSEUDO = [0.004, 0.014]; // near-straight but never a ruler line
const ARC = [0.05, 0.11];      // a clearly bowed curve
const PSEUDO_SHARE = 0.35;     // the share of bridges that are pseudo-straight

export function buildBridge(a, b, seed, ...parts) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const len = Math.hypot(ux, uy);
  if (len < 0.02) return null; // the two anchors coincide; skip the bridge
  const nx = -uy / len;
  const ny = ux / len;

  const rng = rngFor(seed, 'bridge', ...parts);
  const fr = rng() < PSEUDO_SHARE ? PSEUDO : ARC;
  let amp = len * (fr[0] + rng() * (fr[1] - fr[0]));
  if (rng() < 0.5) amp = -amp;
  const amp2 = amp * 0.3 * (rng() < 0.5 ? -1 : 1);

  const out = [];
  for (let k = 0; k < POINTS; k++) {
    const t = k / (POINTS - 1);
    const off = amp * Math.sin(Math.PI * t) + amp2 * Math.sin(2 * Math.PI * t);
    out.push({ x: a.x + ux * t + nx * off, y: a.y + uy * t + ny * off });
  }
  return out;
}
