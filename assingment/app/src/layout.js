// layout.js — Phase 2/3 layout: text -> lines -> words -> letters placed with
// advance widths, wrapping at the page margin, then paginated — with bounded,
// correlated variation of the word gaps and line gaps, and (when cursive is
// on) per-letter choices of cursive extras plus bridges that join the letters
// inside a word. Randomness is seeded only (readme section 8): variant choice
// per word via rngFor(seed,'word',i), gaps via valueNoise1D keyed on the word
// / line index, cursive choices via src/cursive/choose.js streams keyed on
// the word + item index — so editing later text never moves earlier parts.
// Called by render.html. All geometry is in cap units (rasterized in draw.js).

import { rngFor, valueNoise1D } from './rng.js';
import { splitParagraphs, wordsOf } from './text.js';
import { fallbackAdvance } from './fallback.js';
import { DEFAULT_GUIDES } from './geometry.js';
import { joinMode, chooseMiscForItem, chooseForPair, joinPull, CURSIVE } from './cursive/choose.js';
import { buildBridge } from './cursive/bridge.js';

export const PAGE = {
  capPx: 40,        // pixels per cap-height unit when rasterized
  widthPx: 794,     // A4 at 96 dpi
  heightPx: 1123,
  marginX: 1.5,     // cap units
  top: 1.6,
  bottom: 1.6,
  lineHeight: 1.8,  // Phase 1's fixed spacing, kept for reference
};

// Spacing settings, in cap units. min/max are the four user controls; scale is
// the correlation length in words/lines for the smooth walk (bigger = the gaps
// drift more slowly, so neighbouring gaps look more alike).
export const SPACING = {
  wordMin: 0.35, wordMax: 0.70, wordScale: 4,
  lineMin: 1.50, lineMax: 2.10, lineScale: 3,
};

function advanceOf(item) {
  return item.kind === 'glyph' ? item.sample.advance : fallbackAdvance(item.ch);
}

// One bounded, correlated gap value in [min, max]. valueNoise1D is continuous
// in `index`, so neighbouring gaps drift together instead of jumping; `scale`
// sets how far that correlation reaches. min/max are sorted and floored at 0
// so gaps can never overlap, even if the caller passes them the wrong way.
function boundedGap(seed, name, index, min, max, scale) {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(0, Math.max(min, max));
  const t = valueNoise1D(`${seed}|${name}`, index, scale); // [-1, 1]
  return lo + (hi - lo) * (t + 1) / 2;
}

// Word-overflow behaviour at the right margin, the way handwriting actually
// does it: when a word does not fit, the writer either moves the whole word to
// the next line, or writes as much as fits, adds a hyphen, and continues the
// rest on the next line. When both are plausible, `chance` decides (seeded per
// word); the min* limits keep either split readable. dashGap is the small gap
// before the hyphen, in cap units.
const BREAK = {
  chance: 0.5,
  minWord: 4,
  minFirst: 2,
  minRest: 2,
  dashGap: 0.12,
};

function wordGapAt(seed, index, s) {
  return boundedGap(seed, 'wordgap', index, s.wordMin, s.wordMax, s.wordScale);
}

function lineGapAt(seed, index, s) {
  return boundedGap(seed, 'linegap', index, s.lineMin, s.lineMax, s.lineScale);
}

// Build the wrapped lines of the whole document. The gap before each word
// varies (Phase 2) and takes part in the wrap test. When cursive is enabled
// (Phase 3), each glyph item also carries its chosen extras (item.cursive)
// and pairs of joined letters get bridge items between them; a bridged pair
// pulls slightly closer. Each line is an array of placed items
// ({kind, sample|ch|points, x}). Returns [{ items }].
function wrapLines(store, text, seed, pageCfg, spacing, cursive) {
  const rightEdge = pageCfg.widthPx / pageCfg.capPx - pageCfg.marginX;
  const on = !!cursive?.enabled && !!store.cursive;
  const joinY = (store.metrics?.xHeight || DEFAULT_GUIDES.xHeight) * CURSIVE.joinYFrac;
  const lines = [];
  let wordIndex = 0;
  let runStamp = 0; // bridge seed index, unique across the document's runs

  for (const paragraph of splitParagraphs(text)) {
    let current = [];
    let penX = pageCfg.marginX;
    let needSpace = false;

    // Place a run of items at the pen (bridged pairs sit slightly closer) and
    // build the bridges between items of the same run. Used both for a whole
    // word and for the kept part / continuation of a split word.
    const placeRun = (items, wi) => {
      for (const item of items) {
        if (item.pull) penX -= item.pull;
        item.x = penX;
        penX += advanceOf(item);
        current.push(item);
      }
      if (!on) return;
      for (let i = 0; i < items.length - 1; i++) {
        const item = items[i];
        const suffix = item.cursive?.suffix;
        if (!suffix || items[i + 1].kind !== 'glyph') continue;
        const next = items[i + 1];
        const tip = suffix.rel[suffix.rel.length - 1];
        const a = { x: item.x + item.sample.bounds.right + tip.x, y: suffix.attach.y + tip.y };
        let b;
        const pre = next.cursive?.prefix;
        if (pre) {
          const enter = pre.rel[0];
          b = { x: next.x + next.sample.bounds.left + enter.x, y: pre.attach.y + enter.y };
        } else {
          b = { x: next.x + next.sample.bounds.left, y: joinY };
        }
        const points = buildBridge(a, b, seed, wi, runStamp++);
        if (points) current.push({ kind: 'bridge', points });
      }
    };

    // How many leading items of `items` fit inside `avail` cap units (the
    // first item always counts, so a letter wider than the line cannot stall
    // the wrap — it just overflows a little, as handwriting would).
    const fitCount = (items, avail) => {
      let w = 0;
      let n = 0;
      for (const item of items) {
        const adv = advanceOf(item) - (item.pull || 0);
        if (n > 0 && w + adv > avail) break;
        w += adv;
        n++;
      }
      return n;
    };

    for (const word of wordsOf(paragraph)) {
      // Variant choice per character, in word order, from a per-word stream.
      const rng = rngFor(seed, 'word', wordIndex);
      const gap = wordGapAt(seed, wordIndex, spacing); // gap before this word
      const wi = wordIndex++;

      const wordItems = [];
      for (let i = 0; i < word.length; i++) {
        const ch = word[i];
        const list = store.glyphs[ch];
        if (list && list.length) {
          const sample = list[Math.floor(rng() * list.length)];
          wordItems.push({ kind: 'glyph', sample });
        } else {
          wordItems.push({ kind: 'fallback', ch });
        }
      }

      // Phase 3 only: pair-based cursive choices (readme 6.5). Misc extras
      // are decided per letter; prefix / suffix / the pull of each joined
      // pair come from the PAIR decision, stored on the items themselves so
      // a split fragment carries its own pull. A suffix on letter i exists
      // only when the pair (i, i+1) actually joins, so placeRun's bridge
      // loop below stays a direct consequence of the pair table.
      if (on) {
        const mode = joinMode(seed, wi, cursive.amount);
        for (let i = 0; i < wordItems.length; i++) {
          if (wordItems[i].kind !== 'glyph') continue;
          wordItems[i].cursive = chooseMiscForItem(store, word[i], seed, wi, i, mode);
        }
        for (let i = 0; i < wordItems.length - 1; i++) {
          if (chooseForPair(store, word, wordItems, i, seed, wi, mode)) {
            wordItems[i + 1].pull = joinPull(seed, wi, i, wordItems[i].cursive.suffix);
          }
        }
      }

      // The hyphen sample used if this word is split (chosen from the same
      // per-word stream, so it is deterministic like every other variant).
      const dashList = store.glyphs['-'];
      const dash = dashList && dashList.length
        ? { kind: 'glyph', sample: dashList[Math.floor(rng() * dashList.length)] }
        : { kind: 'fallback', ch: '-' };
      const dashW = advanceOf(dash);

      let rest = wordItems;
      let shifted = false; // the word already moved to a fresh line once
      while (rest.length) {
        const space = current.length && needSpace ? gap : 0;
        const avail = rightEdge - penX - space;
        const fit = fitCount(rest, avail);
        if (fit >= rest.length) { penX += space; placeRun(rest, wi); break; }

        // The word overflows. On a line that already has content and that we
        // have not shifted to yet, the writer chooses: move the word, or
        // split it with a hyphen (only when both parts stay readable).
        if (!shifted && current.length) {
          const splittable = rest.length >= BREAK.minWord && fit >= BREAK.minFirst
            && rest.length - fit >= BREAK.minRest;
          if (!(splittable && rngFor(seed, 'break', wi)() < BREAK.chance)) {
            lines.push({ items: current });
            current = [];
            penX = pageCfg.marginX;
            needSpace = false;
            shifted = true;
            continue;
          }
        }

        // Split at the line edge: keep what fits (leaving room for the
        // hyphen), then the rest continues on the next line. A long word can
        // span several lines this way.
        const cut = Math.max(fitCount(rest, avail - BREAK.dashGap - dashW), 1);
        // The pair crossing the hyphen never joins (nothing joins onto a
        // hyphen): strip the merge bits both sides chose for it.
        if (rest[cut - 1]?.cursive) rest[cut - 1].cursive.suffix = null;
        if (rest[cut]?.cursive) rest[cut].cursive.prefix = null;
        penX += space;
        placeRun(rest.slice(0, cut), wi);
        penX += BREAK.dashGap;
        placeRun([dash], wi);
        lines.push({ items: current });
        current = [];
        penX = pageCfg.marginX;
        needSpace = false;
        shifted = true;
        rest = rest.slice(cut);
        if (rest.length) rest[0] = { ...rest[0], pull: 0 }; // no join across the hyphen
      }
      needSpace = true;
    }
    lines.push({ items: current }); // blank line for empty paragraphs
  }
  return lines;
}

// Full document: wrap, then assign each line a baseline y (cap units, y up) and
// a page index. The first baseline of each page is fixed at the top; each later
// line subtracts its own varied gap, so variation accumulates down the page and
// pagination follows from the accumulated positions. `cursive` (optional) is
// { enabled, amount }; when omitted or disabled the output is exactly Phase 2's.
// Returns { pages:[{ index, items }], page, lineCount, spacing, cursive }.
export function layoutDocument(store, text, seed, pageCfg = PAGE, spacing = SPACING, cursive = null) {
  const m = store.metrics;
  const pageH = pageCfg.heightPx / pageCfg.capPx;
  const firstBaseline = pageH - pageCfg.top - m.ascender;
  const minBaseline = pageCfg.bottom + m.descender;

  const lines = wrapLines(store, text, seed, pageCfg, spacing, cursive || { enabled: false });
  const pages = [];
  let page = null;
  let baseline = firstBaseline;

  lines.forEach((line, j) => {
    if (!page) {
      page = { index: pages.length, items: [] };
      pages.push(page);
      baseline = firstBaseline;
    } else {
      baseline -= lineGapAt(seed, j, spacing);
      if (baseline < minBaseline) {
        page = { index: pages.length, items: [] };
        pages.push(page);
        baseline = firstBaseline;
      }
    }
    for (const item of line.items) page.items.push({ ...item, y: baseline });
  });

  return { pages, page: pageCfg, lineCount: lines.length, spacing, cursive: cursive || { enabled: false } };
}
