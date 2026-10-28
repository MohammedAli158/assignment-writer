// phase3.test.mjs — Node smoke tests for Phase 3 (cursive filter).
// Run: node tests/phase3.test.mjs  (no DOM needed; layout + extraction only).
import { fileURLToPath } from 'node:url';
import { layoutDocument, PAGE, SPACING } from '../src/layout.js';
import { extractExtras } from '../src/cursive/extract.js';
import { joinMode, chooseForPair, chooseMiscForItem, CURSIVE } from '../src/cursive/choose.js';
import { buildBridge } from '../src/cursive/bridge.js';
import { createStore, serialize, deserialize } from '../src/glyphstore.js';
import {
  initCursive, addCursiveSample, addExtras, cursiveSampleCount,
  variantCoverage, coverage, mergeCursive, CURSIVE_VERSION,
} from '../src/cursive/store.js';
import { cursiveLetters, contextWords, CURSIVE_WORDS } from '../src/cursive/wordlist.js';
import fs from 'node:fs';

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (cond ? '' : '  ' + detail));
  if (!cond) failures++;
}

// ---------- fixture: ONE base variant + a cursive sample traced over it ----------
function baseVariant() {
  // a simple body from x=0.08 to x=0.34 (all variants identical on purpose)
  return {
    strokes: [[
      { x: 0.08, y: 0.02 }, { x: 0.10, y: 0.3 }, { x: 0.14, y: 0.45 }, { x: 0.2, y: 0.5 },
      { x: 0.28, y: 0.45 }, { x: 0.32, y: 0.3 }, { x: 0.34, y: 0.02 },
    ]],
    bounds: { left: 0.08, right: 0.34, top: 0.5, bottom: 0.02 },
    advance: 0.34 + 0.08,
    baseline: 0,
  };
}
const bases = [baseVariant(), baseVariant()];

// The cursive sample lives in the base variant's frame (as-drawn x, baseline
// 0): entry flick clearly left of the body, body ON the base ink, a loop
// above the body (misc), exit flick clearly right. 16 points -> smoothed.
const cursiveSample = {
  strokes: [[
    { x: -0.08, y: -0.02 }, { x: -0.04, y: 0.10 }, { x: 0.0, y: 0.22 },  // prefix
    { x: 0.08, y: 0.02 }, { x: 0.10, y: 0.3 }, { x: 0.14, y: 0.45 }, { x: 0.2, y: 0.5 }, // body
    { x: 0.22, y: 0.70 }, { x: 0.23, y: 0.75 }, { x: 0.24, y: 0.70 },   // loop (misc)
    { x: 0.28, y: 0.45 }, { x: 0.32, y: 0.3 }, { x: 0.34, y: 0.02 },    // body
    { x: 0.42, y: -0.04 }, { x: 0.48, y: 0.02 }, { x: 0.54, y: -0.02 }, // suffix
  ]],
  bounds: { left: -0.08, right: 0.54, top: 0.75, bottom: -0.04 },
  advance: 0.7, baseline: 0,
};

// ---------- extraction ----------
{
  const extras = extractExtras(bases[0], cursiveSample);
  const kind = (k) => extras.filter((e) => e.kind === k).length;
  check('extract: finds the entry flick', kind('prefix') === 1, JSON.stringify(extras.map((e) => e.kind)));
  check('extract: finds the exit flick', kind('suffix') === 1);
  check('extract: finds exactly the loop', kind('misc') === 1);
  const pre = extras.find((e) => e.kind === 'prefix');
  const suf = extras.find((e) => e.kind === 'suffix');
  const misc = extras.find((e) => e.kind === 'misc');
  check('extract: prefix attaches at the body edge', pre && pre.attach.x < bases[0].bounds.left + 0.05, JSON.stringify(pre?.attach));
  check('extract: prefix run points sit left of the attach point', pre && pre.rel[0].x < -0.03, JSON.stringify(pre?.rel));
  check('extract: prefix reconnects into the body', pre && pre.rel[pre.rel.length - 1].x >= 0, JSON.stringify(pre?.rel));
  check('extract: suffix reach positive', suf && suf.reach > 0.03, String(suf?.reach));
  check('extract: misc reach measures off-body distance', misc && misc.reach > 0.03, String(misc?.reach));
  check('extract: ref comes from the ONE base variant', extras.every((e) => e.ref.left === bases[0].bounds.left && e.ref.right === bases[0].bounds.right), JSON.stringify(extras.map((e) => e.ref)));
  check('extract: no NaN fields', extras.every((e) => Number.isFinite(e.attach.x) && Number.isFinite(e.reach) && e.rel.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));

  // caller tagging (cursive.html): base = variant index, from = sample index
  const tagged = extractExtras(bases[1], cursiveSample).map((e) => ({ ...e, base: 1, from: 4 }));
  check('extract: caller tags base and from', tagged.every((e) => e.base === 1 && e.from === 4));

  // a plain sample drawn exactly on the body -> no extras at all
  const plain = {
    strokes: [[
      { x: 0.08, y: 0.02 }, { x: 0.1, y: 0.3 }, { x: 0.2, y: 0.5 }, { x: 0.3, y: 0.3 }, { x: 0.34, y: 0.02 },
    ]],
    bounds: { left: 0.08, right: 0.34, top: 0.5, bottom: 0.02 },
    advance: 0.42, baseline: 0,
  };
  const none = extractExtras(bases[0], plain);
  check('extract: plain sample inside body -> zero extras', none.length === 0, JSON.stringify(none));

  // a stroke that never touches the base is misc, wholly
  const away = {
    strokes: [[{ x: -0.3, y: -0.2 }, { x: -0.25, y: -0.1 }, { x: -0.2, y: 0.0 }]],
    bounds: { left: -0.3, right: -0.2, top: 0, bottom: -0.2 },
    advance: 0.26, baseline: 0,
  };
  const miscOnly = extractExtras(bases[0], away);
  check('extract: never-touching stroke -> one misc', miscOnly.length === 1 && miscOnly[0].kind === 'misc', JSON.stringify(miscOnly));

  // dense jaggy strokes are smoothed before measuring (must still find runs)
  const denseSample = {
    strokes: [
      cursiveSample.strokes[0].slice(0, 7),
      Array.from({ length: 40 }, (_, i) => ({
        x: 0.33 + 0.004 * i + 0.003 * Math.sin(i * 2.7),
        y: 0.0 - 0.002 * i + 0.002 * Math.cos(i * 3.1),
      })),
    ],
    bounds: { left: -0.08, right: 0.6, top: 0.5, bottom: -0.1 },
    advance: 0.75, baseline: 0,
  };
  const dense = extractExtras(bases[0], denseSample);
  check('extract: dense jittery exit stroke still yields a suffix', dense.some((e) => e.kind === 'suffix'), JSON.stringify(dense.map((e) => e.kind)));

  // a DIFFERENT base (same shape here, but the contract is per-variant) also works
  check('extract: works against the second variant too', extractExtras(bases[1], cursiveSample).length === 3);
}

// ---------- wordlist ----------
{
  const letters = cursiveLetters();
  check('wordlist: 26 prompted letters', letters.length === 26, String(letters.length));
  check('wordlist: coverage of a..z', 'abcdefghijklmnopqrstuvwxyz'.split('').every((c) => letters.includes(c)));
  check('wordlist: contexts nonempty', contextWords('b').length > 0 && contextWords('j').length > 0);
  check('wordlist: no uppercase words', CURSIVE_WORDS.every((w) => w === w.toLowerCase()));
}

// ---------- joinMode distribution ----------
{
  const n = 400;
  const count = (mode, amount) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (joinMode('t', i, amount) === mode) c++;
    return c;
  };
  check('joinMode: amount 0 -> all separate', count('separate', 0) === n);
  check('joinMode: amount 1 -> all full', count('full', 1) === n);
  const mix = [count('full', 0.5), count('partly', 0.5), count('separate', 0.5)];
  check('joinMode: amount 0.5 mixes all three', mix.every((c) => c > 60), mix.join(','));
}

// ---------- per-base choosing (the fix for strokes on the wrong variant) ----------
{
  const s = createStore();
  s.glyphs['g'] = [
    { strokes: [[{ x: 0.08, y: 0.02 }, { x: 0.3, y: 0.02 }]], bounds: { left: 0.08, right: 0.3, top: 0.02, bottom: 0.02 }, advance: 0.38, baseline: 0 },
    { strokes: [[{ x: 0.08, y: 0.05 }, { x: 0.4, y: 0.05 }]], bounds: { left: 0.08, right: 0.4, top: 0.05, bottom: 0.05 }, advance: 0.48, baseline: 0 },
  ];
  s.glyphs['n'] = [s.glyphs['g'][0], s.glyphs['g'][1]];
  initCursive(s);
  const suffix0 = { kind: 'suffix', rel: [{ x: 0.05, y: 0 }, { x: 0.1, y: 0 }], attach: { x: 0.3, y: 0.02 }, ref: { left: 0.08, right: 0.3 }, reach: 0.1, length: 0.1, base: 0, from: 0 };
  const suffix1 = { ...suffix0, reach: 0.2, base: 1, from: 1 };
  addExtras(s, 'g', [suffix0]);
  addExtras(s, 'g', [suffix1]);
  const prefix0 = { kind: 'prefix', rel: [{ x: -0.1, y: 0 }, { x: 0, y: 0 }], attach: { x: 0.08, y: 0.02 }, ref: { left: 0.08, right: 0.3 }, reach: 0.1, length: 0.1, base: 0, from: 2 };
  const prefix1 = { ...prefix0, reach: 0.25, base: 1, from: 3 };
  addExtras(s, 'n', [prefix0]);
  addExtras(s, 'n', [prefix1]);

  const items00 = [
    { kind: 'glyph', sample: s.glyphs['g'][0], sampleIndex: 0 },
    { kind: 'glyph', sample: s.glyphs['n'][0], sampleIndex: 0 },
  ];
  const joined00 = chooseForPair(s, 'gn', items00, 0, 's1', 0, 'full');
  check('choose: pair joins with per-base extras', joined00 === true, String(joined00));
  check('choose: base-0 letter gets base-0 extras', items00[0].cursive.suffix.reach === 0.1 && items00[1].cursive.prefix.reach === 0.1,
    `${items00[0].cursive.suffix.reach}/${items00[1].cursive.prefix.reach}`);

  const items11 = [
    { kind: 'glyph', sample: s.glyphs['g'][1], sampleIndex: 1 },
    { kind: 'glyph', sample: s.glyphs['n'][1], sampleIndex: 1 },
  ];
  chooseForPair(s, 'gn', items11, 0, 's1', 0, 'full');
  check('choose: base-1 letter gets base-1 extras', items11[0].cursive.suffix.reach === 0.2 && items11[1].cursive.prefix.reach === 0.25,
    `${items11[0].cursive.suffix.reach}/${items11[1].cursive.prefix.reach}`);

  // no extras for a side's own base -> that pair never joins and never borrows
  const s3 = createStore();
  s3.glyphs['g'] = s.glyphs['g'];
  s3.glyphs['n'] = s.glyphs['n'];
  initCursive(s3);
  addExtras(s3, 'g', [{ ...suffix0, base: 0 }]);
  addExtras(s3, 'n', [{ ...prefix0, base: 0 }]);
  const cases = [
    [0, 0, true],   // both sides have their own base's extras
    [1, 1, false],  // neither side has base-1 extras
    [1, 0, false],  // left has no base-1 suffix
    [0, 1, false],  // right has no base-1 prefix
  ];
  for (const [li, ri, expect] of cases) {
    const items = [
      { kind: 'glyph', sample: s3.glyphs['g'][li], sampleIndex: li },
      { kind: 'glyph', sample: s3.glyphs['n'][ri], sampleIndex: ri },
    ];
    const got = chooseForPair(s3, 'gn', items, 0, 's1', 0, 'full');
    check(`choose: g${li}->n${ri} ${expect ? 'joins on own extras' : 'stays separate, no borrowing'}`,
      got === expect && expect === !!items[0].cursive?.suffix && expect === !!items[1].cursive?.prefix,
      `got ${got}`);
  }

  // stale extras without a numeric base never match anything
  const s2 = createStore();
  s2.glyphs['g'] = s.glyphs['g'];
  s2.glyphs['n'] = s.glyphs['n'];
  initCursive(s2);
  const stale = { ...suffix0, base: undefined };
  addExtras(s2, 'g', [stale]);
  addExtras(s2, 'n', [prefix0]);
  const itemsStale = [
    { kind: 'glyph', sample: s2.glyphs['g'][0], sampleIndex: 0 },
    { kind: 'glyph', sample: s2.glyphs['n'][0], sampleIndex: 0 },
  ];
  check('choose: extras without base are ignored', chooseForPair(s2, 'gn', itemsStale, 0, 's1', 0, 'full') === false);

  // misc: own small chance, same base only, never in separate mode
  const misc = { kind: 'misc', rel: [{ x: 0, y: 0.1 }, { x: 0.02, y: 0.2 }], attach: { x: 0.2, y: 0.3 }, ref: { left: 0.08, right: 0.3 }, reach: 0.1, length: 0.1, base: 0, from: 4 };
  addExtras(s, 'g', [misc]);
  const N = 300;
  let withMisc = 0;
  for (let i = 0; i < N; i++) {
    if (chooseMiscForItem(s, 'g', 0, 'mseed', i, i, 'full')) withMisc++;
  }
  check('choose: misc fires on its own chance (~25%)', withMisc > N * 0.1 && withMisc < N * 0.45, `${withMisc}/${N}`);
  check('choose: misc never fires in separate mode', chooseMiscForItem(s, 'g', 0, 'mseed', 7, 7, 'separate') === null);
  check('choose: misc only from the same base', chooseMiscForItem(s, 'g', 1, 'mseed', 8, 8, 'full') === null);
}

// ---------- store: version gate + per-variant coverage ----------
{
  const s = createStore();
  initCursive(s);
  check('store: initCursive stamps the cursive version', s.cursive.version === CURSIVE_VERSION, String(s.cursive.version));

  // stale (v1-shaped) sections are skipped whole on merge
  const fresh = createStore();
  mergeCursive(fresh, { cursive: { samples: { a: [{ strokes: [] }] }, extras: { a: { prefix: [{ kind: 'prefix' }], suffix: [], misc: [] } } } });
  check('store: merge skips a section without the current version', cursiveSampleCount(fresh, 'a') === 0 && !fresh.cursive?.extras?.a);

  // a current-version section merges
  mergeCursive(fresh, JSON.parse(JSON.stringify(s)));
  check('store: merge accepts the current version', fresh.cursive.version === CURSIVE_VERSION);

  // per-variant coverage: done needs prefix AND suffix from that variant's sample
  const s3 = createStore();
  s3.glyphs['a'] = [bases[0], bases[1]];
  initCursive(s3);
  const mkSample = (bi) => ({
    strokes: [[{ x: 0.08, y: 0 }, { x: 0.2, y: 0 }]],
    bounds: { left: 0.08, right: 0.2, top: 0, bottom: 0 },
    advance: 0.28, baseline: 0, baseIndex: bi,
  });
  const i0 = addCursiveSample(s3, 'a', mkSample(0)) - 1;
  addExtras(s3, 'a', [
    { kind: 'prefix', rel: [{ x: 0 }], attach: { x: 0.08, y: 0 }, ref: { left: 0.08, right: 0.2 }, reach: 0.1, length: 0.1, base: 0, from: i0 },
    { kind: 'suffix', rel: [{ x: 0 }], attach: { x: 0.2, y: 0 }, ref: { left: 0.08, right: 0.2 }, reach: 0.1, length: 0.1, base: 0, from: i0 },
  ]);
  const i1 = addCursiveSample(s3, 'a', mkSample(1)) - 1;
  addExtras(s3, 'a', [
    { kind: 'suffix', rel: [{ x: 0 }], attach: { x: 0.2, y: 0 }, ref: { left: 0.08, right: 0.2 }, reach: 0.1, length: 0.1, base: 1, from: i1 },
  ]);
  const vc = variantCoverage(s3, 'a');
  check('coverage: done needs prefix AND suffix per variant', vc.length === 2 && vc[0].done === true && vc[1].done === false, JSON.stringify(vc));
  check('coverage: unfinished variant still counted as sampled', vc[1].samples === 1);
  const cov = coverage(s3, ['a']);
  check('coverage: per-variant rollup', cov[0].variants === 2 && cov[0].variantsDone === 1, JSON.stringify(cov[0]));
}

// ---------- bridge shape ----------
{
  const a = { x: 0, y: 0.2 };
  const b = { x: 0.5, y: 0.25 };
  const pts = buildBridge(a, b, 's', 3, 1);
  check('bridge: pinned endpoints', Math.hypot(pts[0].x - a.x, pts[0].y - a.y) < 1e-12 && Math.hypot(pts.at(-1).x - b.x, pts.at(-1).y - b.y) < 1e-12);
  const wobble = Math.max(...pts.map((p) => Math.abs(p.y - (a.y + (b.y - a.y) * (p.x - a.x) / (b.x - a.x)))));
  check('bridge: gentle bow present', wobble > 0.003 && wobble < 0.08, String(wobble));
  const bids = new Set();
  for (let i = 0; i < 200; i++) {
    const ps = buildBridge(a, b, 's', 3, i);
    bids.add(ps.every((p, j) => j === 0 || j === 6 ? true : Math.abs(p.y - (a.y + (b.y - a.y) * (p.x - a.x) / 0.5)) < 0.02) ? 'flat' : 'bowed');
  }
  check('bridge: both pseudo-straight and bowed occur', bids.has('flat') && bids.has('bowed'), [...bids].join(','));
}

// ---------- store round-trip with cursive ----------
{
  const s = createStore();
  initCursive(s);
  const idx = addCursiveSample(s, 'l', { ...cursiveSample, baseIndex: 0 });
  const extras = extractExtras(bases[0], cursiveSample).map((e) => ({ ...e, base: 0, from: idx - 1 }));
  addExtras(s, 'l', extras);
  const back = deserialize(serialize(s));
  check('store: cursive passes serialize/deserialize', JSON.stringify(back.cursive) === JSON.stringify(s.cursive));
}

// ---------- layout end-to-end with the real legacy profile ----------
{
  const legacy = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../prototype/handwriting_font.json', import.meta.url)), 'utf8'));
  // build a store via the legacy loader
  const { loadLegacyJson } = await import('../src/loaders/legacyJson.js');
  const store = loadLegacyJson(legacy);
  initCursive(store);
  // give every prompted letter prefix+suffix+misc extras for EVERY variant of
  // that letter (the fixture is tied to a base; layout picks variants at random)
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    if (!store.glyphs[ch] || !store.glyphs[ch].length) continue;
    const e = extractExtras(bases[0], cursiveSample);
    for (let b = 0; b < store.glyphs[ch].length; b++) {
      addExtras(store, ch, e.map((x) => ({ ...x, base: b })));
    }
    const cSample = JSON.parse(JSON.stringify(cursiveSample));
    addCursiveSample(store, ch, cSample);
  }

  const text = 'the quick brown fox jumps over the lazy dog and when them than it is for in to of\n\na second paragraph with gjpqy descenders';
  const runs = [];
  for (let k = 0; k < 2; k++) {
    runs.push(layoutDocument(store, text, 42, PAGE, SPACING, { enabled: true, amount: 0.6 }));
  }
  const same = JSON.stringify(runs[0]) === JSON.stringify(runs[1]);
  check('layout: same seed byte-identical (cursive on)', same);

  const other = layoutDocument(store, text, 43, PAGE, SPACING, { enabled: true, amount: 0.6 });
  check('layout: different seed differs', JSON.stringify(other) !== JSON.stringify(runs[0]));

  // structure: joined pairs inside words produced bridge items
  const bridgeCount = runs[0].pages.reduce((n, p) => n + p.items.filter((it) => it.kind === 'bridge').length, 0);
  const bridgesOnOther = other.pages.reduce((n, p) => n + p.items.filter((it) => it.kind === 'bridge').length, 0);
  check('layout: bridges were emitted (seed 42)', bridgeCount > 0, String(bridgeCount));
  check('layout: bridges were emitted (seed 43)', bridgesOnOther > 0, String(bridgesOnOther));

  // determinism of bridge GEOMETRY, not just count
  const fmt = (doc) => doc.pages.flatMap((p) => p.items)
    .filter((i) => i.kind === 'bridge')
    .map((i) => i.points.map((q) => +q.x.toFixed(6) + ',' + +q.y.toFixed(6)).join('#'))
    .join(';');
  check('layout: bridge geometry byte-identical per seed', fmt(runs[0]) === fmt(runs[1]));

  // bridges land on the drawn variant's own extras: both ends equal what
  // draw.js will anchor (item.x + attach + rel point). When the suffix tip
  // already reaches the entry point (< 0.02 apart, bridge.js's own threshold)
  // no bridge item is built — the flick IS the connector — so the invariant
  // is ink continuity: a pinned bridge OR coincident anchors.
  {
    let okEnds = true;
    for (const p of runs[0].pages) {
      const glyphs = p.items.filter((i) => i.kind === 'glyph');
      for (let gi = 0; gi < glyphs.length - 1; gi++) {
        const item = glyphs[gi];
        const suffix = item.cursive?.suffix;
        if (!suffix || glyphs[gi + 1].kind !== 'glyph') continue;
        const next = glyphs[gi + 1];
        const pre = next.cursive?.prefix;
        if (!pre) { okEnds = false; break; }
        const tip = suffix.rel[suffix.rel.length - 1];
        const ax = item.x + suffix.attach.x + tip.x;
        const ay = suffix.attach.y + tip.y;
        const enter = pre.rel[0];
        const bx = next.x + pre.attach.x + enter.x;
        const by = pre.attach.y + enter.y;
        const bridges = p.items.filter((i) => i.kind === 'bridge');
        const hit = bridges.some((br) =>
          Math.abs(br.points[0].x - ax) < 1e-9 && Math.abs(br.points[0].y - ay) < 1e-9 &&
          Math.abs(br.points.at(-1).x - bx) < 1e-9 && Math.abs(br.points.at(-1).y - by) < 1e-9);
        if (!hit && Math.hypot(bx - ax, by - ay) >= 0.02) { okEnds = false; break; }
      }
    }
    check('layout: joins are ink-continuous (pinned bridge or coincident tips)', okEnds);
  }

  // no glyph ink past the right margin
  const capPx = PAGE.capPx;
  const rightEdge = PAGE.widthPx / capPx - PAGE.marginX;
  let worst = -Infinity;
  for (const p of runs[0].pages) {
    for (const item of p.items) {
      if (item.kind !== 'glyph') continue;
      const r = item.x + item.sample.bounds.right;
      if (r > worst) worst = r;
    }
  }
  check('layout: base ink stays inside right margin', worst <= rightEdge + 1e-9, `worst ${worst.toFixed(4)} > ${rightEdge}`);

  // amount extremes
  const sep = layoutDocument(store, text, 42, PAGE, SPACING, { enabled: true, amount: 0 });
  const full = layoutDocument(store, text, 42, PAGE, SPACING, { enabled: true, amount: 1 });
  const cvItems = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.kind === 'glyph' && i.cursive).length;
  const bdCount = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.kind === 'bridge').length;
  check('layout: amount 0 -> no cursive items, no bridges', cvItems(sep) === 0 && bdCount(sep) === 0, `${cvItems(sep)},${bdCount(sep)}`);
  check('layout: amount 1 -> many cursive items', cvItems(full) > 50, String(cvItems(full)));
  check('layout: amount 1 -> more bridges than amount 0.6', bdCount(full) >= bridgeCount, `${bdCount(full)} vs ${bridgeCount}`);

  // misc is a per-letter coin now, not a flood: far fewer than the letters drawn
  const miscCount = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.kind === 'glyph' && i.cursive?.misc).length;
  const glyphCountIn = (doc) => doc.pages.flatMap((p) => p.items).filter((i) => i.kind === 'glyph').length;
  check('layout: misc is occasional, not every letter', miscCount(full) < glyphCountIn(full) * 0.45, `${miscCount(full)} of ${glyphCountIn(full)}`);

  // fallback characters never get cursive picks
  const text2 = 'a@b@c';
  const doc2 = layoutDocument(store, text2, 7, PAGE, SPACING, { enabled: true, amount: 1 });
  const bad = doc2.pages.flatMap((p) => p.items).find((i) => i.kind === 'fallback' && i.cursive);
  check('layout: fallback chars carry no cursive picks', !bad);

  // cursive OFF reproduces the Phase 2 shape (no cursive/bridge items)
  const off = layoutDocument(store, text, 42, PAGE, SPACING, { enabled: false, amount: 0.6 });
  check('layout: disabled -> identical to Phase 2 stream', JSON.stringify(off.pages) === JSON.stringify(layoutDocument(store, text, 42, PAGE, SPACING, null).pages));
  check('layout: disabled -> no bridges or picks', bdCount(off) === 0 && cvItems(off) === 0);

  // ---------- pair join rules (Ali, readme section 6.5) ----------
  const { joinablePair } = await import('../src/cursive/pairs.js');
  check('pairs: exact list joins, both ways', ['gn', 'ng', 'ar', 'ra', 're', 'er', 'ye', 'ey'].every((p) => joinablePair(p[0], p[1])));
  check('pairs: y g p q b t l d join any lowercase neighbour', ['by', 'yb', 'kg', 'tp', 'yd', 'ly', 'gg', 'qq', 'pp', 'bx', 'xb', 'ld', 'dl'].every((p) => joinablePair(p[0], p[1])));
  check('pairs: non-social combos stay apart', ['ss', 'xx', 'aa', 'ha', 'eh', 'sx'].every((p) => !joinablePair(p[0], p[1])));
  check('pairs: dd never joins', !joinablePair('d', 'd'));
  check('pairs: capitals and non-letters never join', !joinablePair('b', 'X') && !joinablePair('X', 'b') && !joinablePair('d', 'D') && !joinablePair('d', '5') && !joinablePair('.', 'y'));

  // layout level: amount 1 joins exactly the table's pairs. Misc extras may
  // still ride on any letter (own per-letter chance); a MERGE (prefix/suffix)
  // must only exist on joined pairs.
  const bridgesOf = (w) => layoutDocument(store, w, 42, PAGE, SPACING, { enabled: true, amount: 1 })
    .pages.flatMap((p) => p.items).filter((it) => it.kind === 'bridge').length;
  const mergeBitsOf = (w) => layoutDocument(store, w, 42, PAGE, SPACING, { enabled: true, amount: 1 })
    .pages.flatMap((p) => p.items)
    .filter((i) => i.kind === 'glyph' && i.cursive && (i.cursive.suffix || i.cursive.prefix)).length;
  check('layout: "gn" joins (1 bridge, both letters carry the merge)', bridgesOf('gn') === 1 && mergeBitsOf('gn') === 2, `bridges ${bridgesOf('gn')}, bits ${mergeBitsOf('gn')}`);
  check('layout: "yy" merges on both letters (bridge optional: the flick may already reach the entry)', mergeBitsOf('yy') === 2, `bits ${mergeBitsOf('yy')}`);
  check('layout: "dd" never joins — no bridges, no merge bits', bridgesOf('dd') === 0 && mergeBitsOf('dd') === 0, `bridges ${bridgesOf('dd')}, bits ${mergeBitsOf('dd')}`);
  check('layout: "ss" stays apart like dd', bridgesOf('ss') === 0 && mergeBitsOf('ss') === 0, `bridges ${bridgesOf('ss')}, bits ${mergeBitsOf('ss')}`);
  check('layout: "bA" stays apart (capital never joins)', bridgesOf('bA') === 0 && mergeBitsOf('bA') === 0, `bridges ${bridgesOf('bA')}, bits ${mergeBitsOf('bA')}`);
  check('layout: "the" joins only t->h (h->e is off the table)', bridgesOf('the') === 1, `bridges ${bridgesOf('the')}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
