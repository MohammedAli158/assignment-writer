// choose.js — The seeded cursive decisions made during layout: per WORD, is it
// rendered fully joined / partly joined / fully separate; per LETTER
// occurrence, which stored extras (prefix / suffix / misc) are attached; and
// how much a joined letter pulls the next letter left. All randomness is
// named streams from rng.js (readme section 8), keyed on the word and item
// index, so editing later text never moves earlier decisions.
// Called by layout.js. No DOM.

import { rngFor } from '../rng.js';
import { extrasOf } from './store.js';

// UI-level defaults (render.html seeds its checkbox + slider from here).
export const CURSIVE_DEFAULTS = { enabled: true, amount: 0.6 };

// Renderer-side cursive settings. `enabled` and `amount` come from the UI
// (checkbox + 0..1 slider); the rest are internal constants.
export const CURSIVE = {
  pullMax: 0.22,     // cap units a bridge may pull the next letter left (max)
  pullFrac: 0.45,    // fraction of the suffix's reach used as the base pull
  pullJitter: 0.04,  // seeded +/- jitter on the pull
  joinYFrac: 0.6,    // no prefix available: the bridge enters the base at this
                     // fraction of the x-height above the baseline
  pseudoFrac: 0.35,  // share of bridges that are pseudo-straight (Ali's mix)
};

// Weights for the three word modes as a function of the 0..1 slider:
//   separate = 1 - amount            (0 at amount 1, all at amount 0)
//   partly   = 2 * amount*(1-amount) (triangular, 0 at both ends)
//   full     = amount                (0 at amount 0, all at amount 1)
// so 0 -> all separate, 1 -> all full, and the middle keeps a realistic mix
// (Ali's "user" mix in readme 6.4).
export function joinMode(seed, wordIndex, amount) {
  const a = Math.min(1, Math.max(0, amount));
  const u = rngFor(seed, 'joins', wordIndex)();
  const wFull = a;
  const wPartly = 2 * a * (1 - a);
  const wSep = 1 - a;
  const total = wFull + wPartly + wSep || 1;
  const hit = u * total;
  if (hit < wPartly) return 'partly';
  if (hit < wPartly + wSep) return 'separate';
  return 'full';
}

// Quick look: does this character have anything stored at all?
function available(store, ch) {
  if (!store.cursive || !ch) return null;
  const e = extrasOf(store, ch);
  if (!e.prefix.length && !e.suffix.length && !e.misc.length) return null;
  return e;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// Pick the extras for one letter occurrence. Returns a plain record stored on
// the layout item as item.cursive = { prefix, suffix, misc }, holding only
// what the drawer needs (Extra records; the drawer re-anchors them).
// mode: 'full' -> every kind that exists; 'partly' -> a coin per kind;
// 'separate' -> nothing.
export function chooseForItem(store, ch, seed, wordIndex, itemIndex, mode) {
  const avail = available(store, ch);
  if (!avail) return null;

  const r = (name) => rngFor(seed, 'curs', name, wordIndex, itemIndex);
  const take = {
    prefix: mode === 'full' || (mode === 'partly' && r('prefix')() < 0.5),
    suffix: mode === 'full' || (mode === 'partly' && r('suffix')() < 0.6),
    misc:
      mode === 'full' || (mode === 'partly' && r('misc')() < 0.5),
  };

  const chosen = {
    prefix: take.prefix && avail.prefix.length ? pick(avail.prefix, r('pickP')) : null,
    suffix: take.suffix && avail.suffix.length ? pick(avail.suffix, r('pickS')) : null,
    misc: take.misc && avail.misc.length ? pick(avail.misc, r('pickM')) : null,
  };
  if (!chosen.prefix && !chosen.suffix && !chosen.misc) return null;
  return chosen;
}

// How far the next letter is pulled left when a bridge lands on it: a
// fraction of the suffix's reach (bounded), slightly jittered per pair.
export function joinPull(seed, wordIndex, itemIndex, suffix) {
  if (!suffix) return 0;
  const rng = rngFor(seed, 'curs', 'pull', wordIndex, itemIndex);
  const base = Math.min(CURSIVE.pullMax, CURSIVE.pullFrac * (suffix.reach || 0));
  return Math.max(0, base + CURSIVE.pullJitter * (rng() * 2 - 1));
}
