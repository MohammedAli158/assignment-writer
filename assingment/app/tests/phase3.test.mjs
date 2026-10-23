// phase3.test.mjs — Node smoke tests for Phase 3 (cursive filter).
// Run: node tests/phase3.test.mjs  (no DOM needed; layout + extraction only).
import { fileURLToPath } from 'node:url';
import { layoutDocument, PAGE, SPACING } from '../src/layout.js';
import { extractExtras } from '../src/cursive/extract.js';
import { joinMode } from '../src/cursive/choose.js';
import { buildBridge } from '../src/cursive/bridge.js';
import { createStore, serialize, deserialize } from '../src/glyphstore.js';
import { initCursive, addCursiveSample, addExtras } from '../src/cursive/store.js';
import { cursiveLetters, contextWords, CURSIVE_WORDS } from '../src/cursive/wordlist.js';
import fs from 'node:fs';

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name + (cond ? '' : '  ' + detail));
  if (!cond) failures++;
}

// ---------- fixture: base variants + a cursive sample with obvious extras ----------
function baseVariant(w) {
  // a simple body from x=0.08 to x=0.34 (all variants identical on purpose)
  return {
    strokes: [[
      { x: 0.08, y: 0.02 }, { x: 0.10, y: 0.3 }, { x: 0.14, y: 0.45, }, { x: 0.2, y: 0.5 },
      { x: 0.28, y: 0.45 }, { x: 0.32, y: 0.3 }, { x: 0.34, y: 0.02 },
    ]],
    bounds: { left: 0.08, right: 0.34, top: 0.5, bottom: 0.02 },
    advance: 0.34 + 0.08,
    baseline: 0,
  };
}
const bases = [baseVariant(), baseVariant()];

const cursiveSample = {
  strokes: [[
    { x: -0.02, y: 0.0 }, { x: 0.02, y: 0.1 }, { x: 0.055, y: 0.2 }, // L-run (x < 0.08)
    { x: 0.09, y: 0.28 }, { x: 0.16, y: 0.31 }, { x: 0.24, y: 0.28 }, // inside
    { x: 0.30, y: 0.2 }, { x: 0.36, y: 0.08 }, { x: 0.40, y: 0.0 },   // R-run (x > 0.34)
  ]],
  bounds: { left: -0.02, right: 0.40, top: 0.31, bottom: 0.0 },
  advance: 0.5, baseline: 0,
};

// ---------- extraction ----------
{
  const extras = extractExtras(bases, cursiveSample);
  const kind = (k) => extras.filter((e) => e.kind === k).length;
  check('extract: finds a prefix', kind('prefix') >= 1, JSON.stringify(extras.map((e) => e.kind)));
  check('extract: finds a suffix', kind('suffix') >= 1);
  check('extract: no false misc', kind('misc') === 0);
  const pre = extras.find((e) => e.kind === 'prefix');
  const suf = extras.find((e) => e.kind === 'suffix');
  // design: the run itself lies left of the attach point; up to CONTEXT
  // context points are kept into the body so the shape reconnects.
  check('extract: prefix run points sit left of the attach edge', pre && pre.rel[0].x < -0.03 && pre.rel[2].x < 0, JSON.stringify(pre?.rel));
  check('extract: prefix ends inside the body (reconnects)', pre && pre.rel[pre.rel.length - 1].x >= 0, JSON.stringify(pre?.rel));
  check('extract: suffix reach positive', suf && suf.reach > 0.03);
  check('extract: no NaN fields', extras.every((e) => Number.isFinite(e.attach.x) && Number.isFinite(e.reach) && e.rel.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))));

  // a plain sample drawn exactly on the body -> no extras at all
  const plain = {
    strokes: [[
      { x: 0.08, y: 0.02 }, { x: 0.1, y: 0.3 }, { x: 0.2, y: 0.5 }, { x: 0.3, y: 0.3 }, { x: 0.34, y: 0.02 },
    ]],
    bounds: { left: 0.08, right: 0.34, top: 0.5, bottom: 0.02 },
    advance: 0.42, baseline: 0,
  };
  const none = extractExtras(bases, plain);
  check('extract: plain sample inside body -> zero extras', none.length === 0, JSON.stringify(none));

  // dense jaggy strokes are smoothed before measuring (must still find runs)
  const denseSample = {
    strokes: [
      cursiveSample.strokes[0].slice(0, 7),
      Array.from({ length: 40 }, (_, i) => ({
        x: 0.33 + 0.002 * i + 0.003 * Math.sin(i * 2.7),
        y: 0.2 - 0.005 * i + 0.002 * Math.cos(i * 3.1),
      })),
    ],
    bounds: { left: -0.02, right: 0.47, top: 0.31, bottom: 0.0 },
    advance: 0.55, baseline: 0,
  };
  const dense = extractExtras(bases, denseSample);
  check('extract: dense jittery exit stroke still yields a suffix', dense.some((e) => e.kind === 'suffix'), JSON.stringify(dense.map((e) => e.kind)));
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
  const idx = addCursiveSample(s, 'l', cursiveSample);
  const extras = extractExtras(bases, cursiveSample).map((e) => ({ ...e, from: idx - 1 }));
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
  // give every prompted letter one synthetic prefix+suffix from the fixture
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    if (!store.glyphs[ch] || !store.glyphs[ch].length) continue;
    const e = extractExtras(bases, cursiveSample);
    addExtras(store, ch, e);
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

  // fallback characters never get cursive picks
  const text2 = 'a@b@c';
  const doc2 = layoutDocument(store, text2, 7, PAGE, SPACING, { enabled: true, amount: 1 });
  const bad = doc2.pages.flatMap((p) => p.items).find((i) => i.kind === 'fallback' && i.cursive);
  check('layout: fallback chars carry no cursive picks', !bad);

  // cursive OFF reproduces the Phase 2 shape (no cursive/bridge items)
  const off = layoutDocument(store, text, 42, PAGE, SPACING, { enabled: false, amount: 0.6 });
  check('layout: disabled -> identical to Phase 2 stream', JSON.stringify(off.pages) === JSON.stringify(layoutDocument(store, text, 42, PAGE, SPACING, null).pages));
  check('layout: disabled -> no bridges or picks', bdCount(off) === 0 && cvItems(off) === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
