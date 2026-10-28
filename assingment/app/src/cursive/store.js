// store.js — The cursive section of the glyph store and its operations.
// The store gains one section:
//   cursive = { version, samples:{ char:[sample,...] }, extras:{ char:{ prefix:[Extra], suffix:[Extra], misc:[Extra] } } }
// A Sample is the same shape as a base glyph sample (cap units, y up, baseline
// 0, same frame as the print variant it was traced over) plus `baseIndex`:
// the index into store.glyphs[char] of the variant it was captured against.
// An Extra is what extract.js produced: { kind, rel, attach, ref, reach,
// length, base, from } — `base` is the variant index the extra was extracted
// against, `from` the sample index it came from. The renderer only uses
// extras whose `base` matches the drawn variant (choose.js).
// Called by cursive.html (capture + extraction preview) and by choose.js when
// rendering picks extras. Pure data; no DOM, no randomness.

export const EXTRA_KINDS = ['prefix', 'suffix', 'misc'];

// v1 was the union-envelope model: samples had no baseIndex and extras no
// base, so they cannot be tied to the variant they belong to. Such sections
// are dropped on load (persist.js, mergeCursive) instead of rendering as
// random strokes.
export const CURSIVE_VERSION = 2;

// Ensure store.cursive exists (older stores predate Phase 3).
export function initCursive(store) {
  if (!store.cursive || store.cursive.version !== CURSIVE_VERSION) {
    // A stale section (no version, or the v1 union-envelope model) is dropped,
    // never partially kept: its extras carry no base and would render randomly.
    store.cursive = { version: CURSIVE_VERSION, samples: {}, extras: {} };
  }
  return store.cursive;
}

export function addCursiveSample(store, char, sample) {
  const c = initCursive(store);
  if (!c.samples[char]) c.samples[char] = [];
  c.samples[char].push(sample);
  return c.samples[char].length;
}

// Append extracted candidates for one char. Duplicates every field deeply
// (json round-trip) so the caller's working copy can never mutate the store.
export function addExtras(store, char, extras) {
  const c = initCursive(store);
  if (!c.extras[char]) c.extras[char] = { prefix: [], suffix: [], misc: [] };
  for (const extra of extras) {
    c.extras[char][extra.kind].push(JSON.parse(JSON.stringify(extra)));
  }
}

export function extrasOf(store, char) {
  return store.cursive?.extras?.[char] || { prefix: [], suffix: [], misc: [] };
}

export function cursiveSampleCount(store, char) {
  return (store.cursive?.samples?.[char] || []).length;
}

// True when the renderer has anything at all to attach for `char`.
export function hasAnyExtra(store, char) {
  const e = extrasOf(store, char);
  return e.prefix.length > 0 || e.suffix.length > 0 || e.misc.length > 0;
}

// Per-variant coverage for one char: one entry per print variant
// (store.glyphs[char][i]), where `done` requires at least one cursive sample
// captured against that variant (baseIndex === i) whose extraction produced
// BOTH a prefix and a suffix — a variant without an entry or an exit cannot
// take part in joins. Extras are matched to their sample via `from`.
export function variantCoverage(store, char) {
  const list = store.glyphs?.[char] || [];
  const out = Array.from({ length: list.length }, () => ({ done: false, samples: 0 }));
  const cs = store.cursive;
  const samples = cs?.samples?.[char] || [];
  const ex = cs?.extras?.[char] || { prefix: [], suffix: [], misc: [] };
  for (let i = 0; i < samples.length; i++) {
    const bi = samples[i].baseIndex;
    if (!Number.isInteger(bi) || bi < 0 || bi >= out.length) continue;
    out[bi].samples++;
    const kinds = new Set();
    for (const kind of EXTRA_KINDS) {
      for (const e of ex[kind] || []) if (e.from === i) kinds.add(kind);
    }
    if (kinds.has('prefix') && kinds.has('suffix')) out[bi].done = true;
  }
  return out;
}

// Coverage summary for the capture page: per letter, how many samples, how
// many extras of each kind, and how many of its print variants are done (see
// variantCoverage). Letters are exactly cursiveLetters().
export function coverage(store, letters) {
  return letters.map((ch) => {
    const e = extrasOf(store, ch);
    const perVariant = variantCoverage(store, ch);
    return {
      ch,
      samples: cursiveSampleCount(store, ch),
      prefix: e.prefix.length,
      suffix: e.suffix.length,
      misc: e.misc.length,
      variants: perVariant.length,
      variantsDone: perVariant.filter((v) => v.done).length,
    };
  });
}

// Merge a cursive section into a store (import / default profile load).
// Sources are additive: existing samples keep their indexes. A section that
// is not at CURSIVE_VERSION (e.g. an old union-envelope export) is skipped
// whole: its extras have no base and would render as random strokes.
export function mergeCursive(store, other) {
  const oc = other?.cursive;
  if (!oc || oc.version !== CURSIVE_VERSION) return;
  initCursive(store);
  for (const ch of Object.keys(oc.samples || {})) {
    for (const sample of oc.samples[ch]) addCursiveSample(store, ch, sample);
  }
  for (const ch of Object.keys(oc.extras || {})) {
    const incoming = oc.extras[ch];
    for (const kind of EXTRA_KINDS) addExtras(store, ch, incoming[kind] || []);
  }
}
