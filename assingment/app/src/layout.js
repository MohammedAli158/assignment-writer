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
  // Baseline wander: the amplitude (cap units) of the smooth per-word drift
  // above/below the nominal line — how some words visibly start higher or
  // lower than the line their neighbours sit on. 0 = perfectly straight lines.
  wander: 0.22, wanderScale: 2.5,
};

// ---- Mistaken words, scribbled out and rewritten ----------------------------
// With some probability (errors.rate, seeded per word) a word is first written
// with a real misspelling taken from the table below, that failed attempt is
// scribbled out with one pen pass, and the correct word is written beside it
// on fresh space — never on top of itself. The table holds the classic
// double-letter / ie-ei / silent-letter / letter-writing mistakes plus the
// "w family" (what where when who which how) and commonly confused pairs
// (written correctly, but the wrong partner of the pair is used).
export const ERRORS = { rate: 0.08, gapAfter: 0.18 };

const MISSPELLS = {
  // double / single letter confusion
  accommodate: ['accomodate', 'accomadate'],
  occurrence: ['occurence', 'occurrance'],
  recommend: ['recomend'],
  beginning: ['begining'],
  committee: ['committe'],
  embarrass: ['embarass'],
  tomorrow: ['tommorow'],
  until: ['untill'],
  success: ['sucess'],
  address: ['adress'],
  disappoint: ['disapoint'],
  necessary: ['neccessary', 'necesary'],
  // "ie" vs "ei"
  receive: ['recieve'],
  believe: ['beleive'],
  weird: ['wierd'],
  foreign: ['foriegn'],
  achieve: ['acheive'],
  friend: ['freind'],
  seize: ['sieze'],
  // silent / missing letters
  definitely: ['definately', 'definitly'],
  separate: ['seperate'],
  government: ['goverment'],
  environment: ['enviroment'],
  wednesday: ['wensday'],
  february: ['febuary'],
  library: ['libary'],
  probably: ['probly'],
  grammar: ['grammer'],
  calendar: ['calender'],
  publicly: ['publically'],
  independent: ['independant'],
  existence: ['existance'],
  maintenance: ['maintainance'],
  completely: ['completly'],
  sincerely: ['sincerly', 'sincerley'],
  faithfully: ['faithfuly'],
  enclosed: ['inclosed'],
  referred: ['refered'],
  transferred: ['transfered'],
  acknowledge: ['aknowledge'],
  guarantee: ['guarentee'],
  assistance: ['assistence'],
  receipt: ['reciept'],
  privilege: ['priviledge'],
  occasion: ['occassion'],
  immediately: ['immediatly'],
  opportunity: ['opportunty'],
  convenient: ['convinient'],
  apologize: ['appologize'],
  apologise: ['appologise'],
  // the "w" family and its neighbours
  what: ['whant', 'waht'],
  where: ['wher', 'whare'],
  when: ['whn', 'whem'],
  who: ['whoo', 'whou'],
  which: ['whitch', 'wich'],
  how: ['hoiw', 'hwo'],
};

// Words spelled right but picked wrong — write the partner, strike it, rewrite.
const CONFUSED_PAIRS = [
  ['their', 'there'], ['your', "you're"], ['its', "it's"],
  ['affect', 'effect'], ['accept', 'except'], ['advice', 'advise'],
  ['principal', 'principle'], ['stationary', 'stationery'],
  ['loose', 'lose'], ['then', 'than'], ['to', 'too'],
  ['whether', 'weather'], ['complement', 'compliment'],
];

const MISSPELL_TABLE = (() => {
  const t = {};
  for (const [correct, wrongs] of Object.entries(MISSPELLS)) t[correct] = wrongs;
  for (const [a, b] of CONFUSED_PAIRS) {
    (t[a] ??= []).push(b);
    (t[b] ??= []).push(a);
  }
  return t;
})();

// Decide whether word `wi` gets the misspell treatment and what it becomes.
// Leading/trailing punctuation is preserved around the misspelled core. Words
// from the table use a listed misspelling; other words of 4+ letters get a
// realistic generic slip instead (swapped or doubled letters, a dropped
// middle letter), so any text can carry the occasional mistake.
function pickMisspell(word, seed, wi, rate) {
  const m = /^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$/.exec(word);
  if (!m) return null;
  const core = m[2].toLowerCase();
  const wrongs = MISSPELL_TABLE[core];
  if (!rate || rate <= 0 || (core.length < 4 && !wrongs)) return null;
  if (rngFor(seed, 'errsel', wi)() >= rate) return null;
  const rng = rngFor(seed, 'errpick', wi);
  let bad;
  if (wrongs) {
    bad = wrongs[Math.floor(rng() * wrongs.length)] || wrongs[0];
  } else {
    bad = genericMisspell(core, rng);
  }
  const keep = m[2][0] === m[2][0].toUpperCase();
  return { bad: m[1] + (keep ? bad[0].toUpperCase() + bad.slice(1) : bad) + m[3], wrong: bad };
}

// A plausible handwritten slip for an ordinary word: swap a letter pair, copy
// a letter twice, or drop a letter — always in the interior, never on the
// first letter, so the word is clearly the intended one, half-remembered.
function genericMisspell(core, rng) {
  const picks = [];
  const swaps = [];
  for (let i = 1; i < core.length - 1; i++) swaps.push(i);
  if (swaps.length) {
    picks.push(() => {
      const i = swaps[Math.floor(rng() * swaps.length)];
      return core.slice(0, i) + core[i + 1] + core[i] + core.slice(i + 2);
    }, () => {
      const i = swaps[Math.floor(rng() * swaps.length)];
      return core.slice(0, i) + core[i] + core[i] + core.slice(i + 1);
    }, () => {
      const i = 1 + Math.floor(rng() * (core.length - 2));
      return core.slice(0, i) + core.slice(i + 1);
    });
  } else {
    picks.push(() => core.slice(0, 2) + core[1] + core.slice(1));
  }
  return picks[Math.floor(rng() * picks.length)]();
}

// The scribble over a failed word: one pen pass, roughly through the middle of
// the x-height, with a slant and a little jitter, overshooting both ends the
// way a hand does when cancelling. Absolute page x, baseline-relative y.
function strikePoints(x0, x1, seed, wi, xHeight) {
  const rng = rngFor(seed, 'strike', wi);
  const mid = (xHeight || 0.55) * 0.5;
  const overshoot = 0.06 + rng() * 0.1;
  const slant = (rng() * 2 - 1) * 0.1;
  const n = Math.max(2, Math.round((x1 - x0) / 0.4));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    pts.push({
      x: x0 - overshoot + (x1 - x0 + 2 * overshoot) * t,
      y: mid + slant * (t - 0.5) * 2 + (k > 0 && k < n ? (rng() * 2 - 1) * 0.05 : 0),
    });
  }
  return pts;
}

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
function wrapLines(store, text, seed, pageCfg, spacing, cursive, errors) {
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
        item.wi = wi; // which word this item belongs to (baseline wander)
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

    // Build one word's placed items (variant choice + cursive choices). The
    // correct word uses the 'word' stream (unchanged from before); a misspelled
    // attempt uses its own stream so neither disturbs the other's picks.
    const buildWordRun = (word, wi, streamName = 'word') => {
      const rng = rngFor(seed, streamName, wi);
      const items = [];
      for (let i = 0; i < word.length; i++) {
        const ch = word[i];
        const list = store.glyphs[ch];
        if (list && list.length) {
          const sample = list[Math.floor(rng() * list.length)];
          items.push({ kind: 'glyph', sample });
        } else {
          items.push({ kind: 'fallback', ch });
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
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind !== 'glyph') continue;
          items[i].cursive = chooseMiscForItem(store, word[i], seed, wi, i, mode);
        }
        for (let i = 0; i < items.length - 1; i++) {
          if (chooseForPair(store, word, items, i, seed, wi, mode)) {
            items[i + 1].pull = joinPull(seed, wi, i, items[i].cursive.suffix);
          }
        }
      }
      return items;
    };

    // Width of a run of items, including per-item join pull.
    const runWidth = (items) => items.reduce((w, it) => w + advanceOf(it) - (it.pull || 0), 0);

    for (const word of wordsOf(paragraph)) {
      const wi = wordIndex++;
      const gap = wordGapAt(seed, wi, spacing);
      const wordItems = buildWordRun(word, wi);

      // Phase "mistakes": occasionally write a real misspelling first, scribble
      // it out, then write the correct word beside it. The whole unit is kept
      // on one line (a strike is never split); if it cannot fit even on a
      // fresh line, the word is written plainly instead.
      const err = pickMisspell(word, seed, wi, errors?.rate);
      if (err) {
        const badItems = buildWordRun(err.bad, wi, 'errbad');
        const strikeGap = ERRORS.gapAfter;
        const unitExtra = runWidth(badItems) + strikeGap * 2;
        const space = current.length && needSpace ? gap : 0;
        const unitW = runWidth(wordItems) + unitExtra;
        const lineWidth = rightEdge - pageCfg.marginX;
        if (unitExtra + unitW - strikeGap <= lineWidth) {
          // placeRun inside placePart records x extents; place manually here
          const placePart = (items) => {
            const x0 = penX;
            placeRun(items, wi);
            return { x0, x1: penX };
          };
          if (unitW > rightEdge - penX - space && current.length) {
            lines.push({ items: current });
            current = [];
            penX = pageCfg.marginX;
            needSpace = false;
          } else {
            penX += space;
          }
          // On a fresh line everything fits by the width check above; place.
          const a = placePart(badItems);
          penX += strikeGap; // breathe before the strike's ink runs past x1
          const s = strikePoints(a.x0, a.x1, seed, wi, store.metrics?.xHeight);
          current.push({ kind: 'strike', points: s, wi, x: a.x0 });
          penX += strikeGap;
          placePart(wordItems);
          needSpace = true;
          continue;
        }
      }

      // The hyphen sample used if this word is split (chosen from the same
      // per-word stream, so it is deterministic like every other variant).
      const dashList = store.glyphs['-'];
      const dashRng = rngFor(seed, 'dashpick', wi);
      const dash = dashList && dashList.length
        ? { kind: 'glyph', sample: dashList[Math.floor(dashRng() * dashList.length)] }
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
// `errors` (optional) is { rate } — the chance a word is misspelled, struck
// out and rewritten (0 disables). Returns { pages:[{ index, items }], page,
// lineCount, spacing, cursive }.
export function layoutDocument(store, text, seed, pageCfg = PAGE, spacing = SPACING, cursive = null, errors = null) {
  const m = store.metrics;
  const pageH = pageCfg.heightPx / pageCfg.capPx;
  const firstBaseline = pageH - pageCfg.top - m.ascender;
  const minBaseline = pageCfg.bottom + m.descender;

  const lines = wrapLines(store, text, seed, pageCfg, spacing, cursive || { enabled: false }, errors);
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
    for (const item of line.items) {
      // Whole words drift smoothly above/below the nominal line (value noise
      // over the word index), so word starts visibly wander like real
      // handwriting; letters and their bridges inside one word stay together.
      const amp = spacing.wander || 0;
      const dy = amp
        ? valueNoise1D(`${seed}|wander`, item.wi ?? j, spacing.wanderScale || 2.5) * amp
        : 0;
      page.items.push({ ...item, y: baseline + dy });
    }
  });

  return { pages, page: pageCfg, lineCount: lines.length, spacing, cursive: cursive || { enabled: false } };
}
