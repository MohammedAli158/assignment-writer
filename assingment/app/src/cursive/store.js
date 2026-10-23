// store.js — The cursive section of the glyph store and its operations.
// The store gains one section: cursive = { samples:{ char:[sample,...] },
// extras:{ char:{ prefix:[Extra], suffix:[Extra], misc:[Extra] } } }.
// A Sample is the same shape as a base glyph sample (cap units, y up,
// baseline 0, normalized left edge at the side bearing). An Extra is what
// extract.js produced: { kind, rel, attach, reach, length, from }.
// Called by cursive.html (capture + extraction preview) and by choose.js when
// rendering picks extras. Pure data; no DOM, no randomness.

export const EXTRA_KINDS = ['prefix', 'suffix', 'misc'];

// Ensure store.cursive exists (older stores predate Phase 3).
export function initCursive(store) {
  if (!store.cursive) store.cursive = { samples: {}, extras: {} };
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

// Coverage summary for the capture page: per letter, how many samples and how
// many extras of each kind. Letters are exactly cursiveLetters().
export function coverage(store, letters) {
  return letters.map((ch) => {
    const e = extrasOf(store, ch);
    return {
      ch,
      samples: cursiveSampleCount(store, ch),
      prefix: e.prefix.length,
      suffix: e.suffix.length,
      misc: e.misc.length,
    };
  });
}

// Merge a cursive section into a store (import / default profile load).
// Sources are additive: existing samples keep their indexes.
export function mergeCursive(store, other) {
  const oc = other?.cursive;
  if (!oc) return;
  initCursive(store);
  for (const ch of Object.keys(oc.samples || {})) {
    for (const sample of oc.samples[ch]) addCursiveSample(store, ch, sample);
  }
  for (const ch of Object.keys(oc.extras || {})) {
    const incoming = oc.extras[ch];
    for (const kind of EXTRA_KINDS) addExtras(store, ch, incoming[kind] || []);
  }
}
