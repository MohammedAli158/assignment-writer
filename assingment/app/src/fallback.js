// fallback.js — What to do for characters a profile lacks: a normal-looking
// fallback font plus a non-blocking warning that lists them. Used by
// index.html now and by the Phase 1 renderer later.

import { missingChars } from './glyphstore.js';

// Handwriting-like families in preference order. Kept at a normal weight so a
// fallback character is visibly "not your handwriting" on close inspection.
export const FALLBACK_FAMILY = '"Segoe Print","Bradley Hand","Comic Sans MS",cursive';
export const FALLBACK_FONT = `italic 400 1px ${FALLBACK_FAMILY}`;

// Returns { missing:[char], message:string }. `message` is '' when nothing is
// missing.
export function fallbackReport(store, text) {
  const missing = [...missingChars(store, text)];
  if (missing.length === 0) return { missing: [], message: '' };
  return {
    missing,
    message: `No sample for: ${missing.join(' ')} — these will use a fallback font.`,
  };
}

const NARROW = new Set(['i', 'l', 'j', '1', '|', '.', ',', ':', ';', "'", '!']);
const WIDE = new Set(['m', 'w', 'M', 'W']);

// Rough advance estimate for a missing character, in cap units, so wrapping
// stays sane even though the fallback font's real width is only known at draw
// time. Deliberately coarse.
export function fallbackAdvance(ch) {
  if (ch === ' ') return 0.5;
  if (NARROW.has(ch)) return 0.25;
  if (WIDE.has(ch)) return 0.8;
  if (ch >= 'A' && ch <= 'Z') return 0.65;
  return 0.5;
}
