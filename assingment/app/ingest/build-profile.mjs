// Step 7. node build-profile.mjs --print raw-print.json --cursive raw-pangram.json --out profile.json [--app ../../app]
// Imports the app's own code (src/geometry.js, src/advance.js, src/glyphstore.js, src/cursive/extract.js).
// ASSUMED signatures are isolated in the ADAPTER block; run with --probe to see what your app actually exports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, s) => v.startsWith('--') ? [...a, [v.slice(2), s[i + 1] && !s[i + 1].startsWith('--') ? s[i + 1] : true]] : a, []));
const appRoot = path.resolve(here, args.app || '../../app');
const imp = rel => import(pathToFileURL(path.join(appRoot, rel)).href);
const [{ inkBounds }, { normalizeToBaseline }, { createStore, addSample }, { extractExtras }] =
  await Promise.all([imp('src/geometry.js'), imp('src/advance.js'), imp('src/glyphstore.js'), imp('src/cursive/extract.js')]);
if (args.probe) { for (const [n, f] of Object.entries({ inkBounds, normalizeToBaseline, createStore, addSample, extractExtras })) console.log(n, 'arity', f.length, '\n ', String(f).split('\n').slice(0, 3).join('\n  ')); process.exit(0); }

const SB = 0.08;
// ---------------- ADAPTER (the only place that assumes app signatures) ----------------
const toApp = strokes => strokes.map(s => s.map(p => ({ x: p.x, y: p.y, t: null, pressure: null })));
function printSample(strokes) {                       // identical to the capture path: app's own normalizeToBaseline
  const s = normalizeToBaseline(toApp(strokes), SB);  // returns only {strokes,bounds,advance,baseline}; capture.js sets the source fields
  if (!s || !s.strokes || !s.bounds || typeof s.advance !== 'number') throw new Error('normalizeToBaseline result is not {strokes,bounds,advance,...}; adjust ADAPTER.printSample');
  return { ...s, source: 'capture', metricsEstimated: false };
}
function cursiveSample(strokes) {                     // Path B: raw strokes were already translated so the BODY edge is at 0.08
  const st = toApp(strokes), bounds = inkBounds(st);  // (normalizeToBaseline would clip the entry flick to 0.08)
  return { strokes: st, bounds, advance: bounds.right + SB, baseline: 0, source: 'capture', metricsEstimated: false };
}
// ---------------------------------------------------------------------------------------
const rd = f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
const pr = rd(args.print), cu = rd(args.cursive);
const store = createStore();
store.version = 1;
for (const g of pr.glyphs) addSample(store, g.char, printSample(g.strokes));
const rank = new Map(); const bySample = {};
for (const c of cu.cursive.slice().sort((a, b) => a.row - b.row)) (bySample[c.char] ||= []).push(c);
const samples = {}, extras = {}, meta = {};
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  samples[ch] = []; extras[ch] = { prefix: [], suffix: [], misc: [] }; meta[ch] = [];
  for (const [i, c] of (bySample[ch] || []).entries()) {
    const s = cursiveSample(c.strokes); samples[ch].push(s);
    meta[ch].push({ row: c.row, word: c.word, idx: c.idx, conf: c.conf, overhang: c.overhang_cap });
    if (!store.glyphs[ch]) continue;
    const ex = extractExtras(store.glyphs[ch], s);    // REAL extractExtras returns an ARRAY of extras; kind is on each record
    for (const e of ex) {
      if (e.kind !== 'prefix' && e.kind !== 'suffix' && e.kind !== 'misc')
        throw new Error(`extractExtras: unexpected kind ${JSON.stringify(e.kind)} for letter '${ch}' sample ${i}; runToExtra contract changed`);
      extras[ch][e.kind].push({ ...e, from: i });
    }
  }
}
const profile = { version: 1, metrics: { ...pr.metrics, capHeight: 1, sideBearing: SB }, glyphs: store.glyphs, cursive: { samples, extras } };
const outp = path.resolve(args.out || 'profile.json');
fs.writeFileSync(outp, JSON.stringify(profile));
fs.writeFileSync(outp.replace(/\.json$/, '.report.json'), JSON.stringify({ drift: pr.drift, printRows: pr.rows, cap_px: { print: pr.cap_px, cursive: cu.cap_px }, cursiveMeta: meta, missing: cu.missing, warnings: [...(pr.warnings || []), ...(cu.warnings || [])] }, null, 1));
console.log('wrote', outp, `(${Object.keys(store.glyphs).length} glyph keys, ${Object.values(samples).reduce((a, s) => a + s.length, 0)} cursive samples)`);
