// choose.js — The seeded cursive decisions made during layout: per WORD, is it
// rendered fully joined / partly joined / fully separate; per LETTER
// occurrence, its misc extra (loop / crossing on the body itself, own small
// chance); and per PAIR of adjacent letters, whether their suffix->prefix
// merge happens (Ali's pair join rules, readme 6.5 — the pair table lives in
// pairs.js), plus how much a joined pair pulls the next letter left. All
// randomness is named streams from rng.js (readme section 8), keyed on the
// word and item index, so editing later text never moves earlier decisions.
// Extras are picked PER BASE VARIANT: an extra was extracted against one
// specific print variant (extra.base), so it may only attach to an occurrence
// that drew exactly that variant (item.sampleIndex) — anything else put
// flicks on the wrong letter shapes. Called by layout.js. No DOM.

import { rngFor } from '../rng.js';
import { extrasOf } from './store.js';
import { joinablePair } from './pairs.js';

// UI-level defaults (render.html seeds its checkbox + slider from here).
export const CURSIVE_DEFAULTS = { enabled: true, amount: 0.6 };

// Renderer-side cursive settings. `enabled` and `amount` come from the UI
// (checkbox + 0..1 slider); the rest are internal constants.
export const CURSIVE = {
  pullMax: 0.22,     // cap units a bridge may pull the next letter left (max)
  pullFrac: 0.45,    // fraction of the suffix's reach used as the base pull
  pullJitter: 0.04,  // seeded +/- jitter on the pull
  miscChance: 0.25,  // per-letter chance of a misc extra (was: always in full)
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

// The extras stored for `ch` that were extracted against base variant
// `base` (an index into store.glyphs[ch]). Extras without a numeric base
// (stale v1 data) never match anything. Returns null when nothing remains.
function availableFor(store, ch, base) {
  if (!store.cursive || !ch || !Number.isInteger(base)) return null;
  const all = extrasOf(store, ch);
  const e = {
    prefix: all.prefix.filter((x) => x.base === base),
    suffix: all.suffix.filter((x) => x.base === base),
    misc: all.misc.filter((x) => x.base === base),
  };
  if (!e.prefix.length && !e.suffix.length && !e.misc.length) return null;
  return e;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// The cursive record the drawer expects, when nothing has been chosen yet.
const EMPTY = { prefix: null, suffix: null, misc: null };

// Pick the MISC extra for one letter occurrence (an extra on the body itself
// — a loop, a crossing, an extended tail), with its own small per-letter
// chance and only from the letter's own base variant (never borrowed from
// another variant). Independent of the word mode — separate words keep
// occasional loops, but the old "always in full mode" flood is gone.
// Returns item.cursive = { prefix, suffix, misc } or null; prefix/suffix are
// filled in later by chooseForPair.
export function chooseMiscForItem(store, ch, sampleIndex, seed, wordIndex, itemIndex, mode) {
  if (mode === 'separate') return null;
  const avail = availableFor(store, ch, sampleIndex);
  if (!avail || !avail.misc.length) return null;
  const take = rngFor(seed, 'curs', 'misc', wordIndex, itemIndex)() < CURSIVE.miscChance;
  if (!take) return null;
  const misc = pick(avail.misc, rngFor(seed, 'curs', 'pickM', wordIndex, itemIndex));
  if (!misc) return null;
  return { ...EMPTY, misc };
}

// Decide one PAIR of adjacent letters (readme 6.5): does letter i's suffix
// merge into letter i+1's prefix? When it does, the chosen suffix is filled
// into left.cursive and the chosen prefix into right.cursive (creating those
// records when empty), and the caller may then compute the pull for right.
// Both halves are required, each from its own letter's base variant: without
// a stored suffix there is no exit stroke, without a stored prefix the bridge
// would land on an arbitrary join height — either way the pair stays
// separate. mode: 'full' -> every joinable pair joins; 'partly' -> a seeded
// coin per PAIR; 'separate' -> nothing. Returns true exactly when joined.
export function chooseForPair(store, word, wordItems, i, seed, wordIndex, mode) {
  if (mode === 'separate') return false;
  const left = wordItems[i];
  const right = wordItems[i + 1];
  if (left.kind !== 'glyph' || right.kind !== 'glyph') return false;
  if (!joinablePair(word[i], word[i + 1])) return false;

  const take =
    mode === 'full' || (mode === 'partly' && rngFor(seed, 'curs', 'pair', wordIndex, i)() < 0.5);
  if (!take) return false;

  const leftAvail = availableFor(store, word[i], left.sampleIndex);
  if (!leftAvail || !leftAvail.suffix.length) return false;
  const rightAvail = availableFor(store, word[i + 1], right.sampleIndex);
  if (!rightAvail || !rightAvail.prefix.length) return false;

  const suffix = pick(leftAvail.suffix, rngFor(seed, 'curs', 'pickS', wordIndex, i));
  const prefix = pick(rightAvail.prefix, rngFor(seed, 'curs', 'pickP', wordIndex, i + 1));

  left.cursive = { ...(left.cursive || EMPTY), suffix };
  right.cursive = { ...(right.cursive || EMPTY), prefix };
  return true;
}

// How far the next letter is pulled left when a bridge lands on it: a
// fraction of the suffix's reach (bounded), slightly jittered per pair.
export function joinPull(seed, wordIndex, itemIndex, suffix) {
  if (!suffix) return 0;
  const rng = rngFor(seed, 'curs', 'pull', wordIndex, itemIndex);
  const base = Math.min(CURSIVE.pullMax, CURSIVE.pullFrac * (suffix.reach || 0));
  return Math.max(0, base + CURSIVE.pullJitter * (rng() * 2 - 1));
}
