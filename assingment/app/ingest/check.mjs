// Step 8. node check.mjs profile.json [--digits required|optional] [--strict]
// exit 1 = hard failure, exit 2 = structurally valid but with coverage gaps (reported), exit 0 = clean.
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2] || 'profile.json';
const flags = Object.fromEntries(process.argv.slice(3).reduce((a, v, i, s) => v.startsWith('--') ? [...a, [v.slice(2), s[i + 1] && !s[i + 1].startsWith('--') ? s[i + 1] : true]] : a, []));
const P = JSON.parse(fs.readFileSync(file, 'utf8'));
const rp = file.replace(/\.json$/, '.report.json'); const R = fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, 'utf8')) : null;
const fails = [], gaps = [], warns = [];
const EPS = 1e-6, fin = Number.isFinite;
const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const L = 'abcdefghijklmnopqrstuvwxyz', U = L.toUpperCase(), D = '0123456789';

// 1. coverage
for (const c of L + U) if (!(P.glyphs[c] || []).length) fails.push(`glyphs: '${c}' missing`);
const digitsReq = flags.digits === 'required';
for (const c of D) { const n = (P.glyphs[c] || []).length; if (n !== 3) (digitsReq ? fails : gaps).push(`digit '${c}': ${n} variants (need 3)`); }

// 2. per-sample structure
function checkSample(tag, s, { cursive = false } = {}) {
  if (!s.strokes?.length) return fails.push(`${tag}: no strokes`);
  let l = Infinity, r = -Infinity, t = -Infinity, b = Infinity;
  for (const [si, st] of s.strokes.entries()) {
    if (st.length < 2) fails.push(`${tag}: stroke ${si} has ${st.length} point(s)`);
    else if (!(Math.hypot(st[st.length - 1].x - st[0].x, st[st.length - 1].y - st[0].y) > 0 || st.length > 3)) fails.push(`${tag}: stroke ${si} is degenerate (zero length)`);
    for (const p of st) {
      if (!fin(p.x) || !fin(p.y)) fails.push(`${tag}: non-finite point`);
      if (p.t !== null || p.pressure !== null) fails.push(`${tag}: t/pressure must be null`);
      l = Math.min(l, p.x); r = Math.max(r, p.x); t = Math.max(t, p.y); b = Math.min(b, p.y);
    }
  }
  const B = s.bounds;
  for (const [k, v] of [['left', l], ['right', r], ['top', t], ['bottom', b]]) if (Math.abs(B[k] - v) > EPS) fails.push(`${tag}: bounds.${k} ${B[k]} != points ${v}`);
  if (Math.abs(s.advance - (B.right + 0.08)) > EPS) fails.push(`${tag}: advance ${s.advance} != right+0.08`);
  if (!(s.advance > 0)) fails.push(`${tag}: advance <= 0`);
  if (s.baseline !== 0) fails.push(`${tag}: baseline != 0`);
  if (s.source !== 'capture' || s.metricsEstimated !== false) fails.push(`${tag}: source/metricsEstimated wrong`);
  if (!cursive && Math.abs(B.left - 0.08) > EPS) fails.push(`${tag}: print bounds.left ${B.left} != 0.08`);
}
for (const [c, arr] of Object.entries(P.glyphs)) arr.forEach((s, i) => checkSample(`glyph ${c}[${i}]`, s));
// stroke-count sanity (warnings: exclusion is a human decision)
const EXPECT = { x: [2, 6], k: [2, 6], X: [2, 6], K: [2, 6], i: [1, 6], j: [1, 6] };
for (const [c, arr] of Object.entries(P.glyphs)) arr.forEach((s, i) => {
  const n = s.strokes.length, e = EXPECT[c] || [1, 6];
  if (n < e[0] || n > e[1]) warns.push(`stroke count odd: '${c}'[${i}] has ${n}`);
});

// 3. cursive
const CS = P.cursive?.samples || {}, CE = P.cursive?.extras || {};
for (const c of L) {
  const arr = CS[c] || []; if (arr.length !== 3) gaps.push(`cursive '${c}': ${arr.length} samples (need 3)`);
  arr.forEach((s, i) => checkSample(`cursive ${c}[${i}]`, s, { cursive: true }));
  if (!CE[c]) { fails.push(`extras: missing entry for '${c}'`); continue; }
  // attach/rel are measured by src/cursive/extract.js on its measure-time copy of
  // the sample: dense strokes (>12 points) get a 3-point moving average with
  // pinned endpoints, and every stored coordinate is quantized to 4 decimals.
  // The REL of an extra therefore is NOT a raw sample point by construction; the
  // match below mirrors that measurement smoothing exactly and allows the
  // 1e-4 worst case of the two independent toFixed(4) roundings (attach, rel).
  const smooth = strokes => strokes.map(st => {
    if (st.length <= 12) return st;
    const out = st.map(p => ({ ...p }));
    for (let i = 1; i < out.length - 1; i++) {
      out[i] = { x: (st[i - 1].x + 2 * st[i].x + st[i + 1].x) / 4, y: (st[i - 1].y + 2 * st[i].y + st[i + 1].y) / 4 };
    }
    return out;
  });
  arr.forEach(s => { s._smooth = smooth(s.strokes); s._measurePts = s._smooth.flat(); });
  for (const k of ['prefix', 'suffix', 'misc']) for (const e of CE[c][k] || []) {
    const s = arr[e.from]; if (!s) { fails.push(`extras ${c}.${k}: from=${e.from} has no sample`); continue; }
    if (e.kind !== k) fails.push(`extras ${c}.${k}: kind mismatch`);
    if (!(e.reach >= 0) || !(e.length >= 0)) fails.push(`extras ${c}.${k}: reach/length must be >= 0`);
    const pts = s._measurePts;
    for (const q of e.rel) {
      const x = e.attach.x + q.x, y = e.attach.y + q.y;
      // 1.05e-4 > the 1e-4 worst case of attach-round + rel-round drift
      if (!pts.some(p => Math.abs(p.x - x) < 1.05e-4 && Math.abs(p.y - y) < 1.05e-4)) { fails.push(`extras ${c}.${k} from ${e.from}: attach+rel point (${x.toFixed(3)},${y.toFixed(3)}) not in sample`); break; }
    }
  }
}
// 3b. frame check per sample (v2): bodyEdge = median print bounds.left (what extract.js uses)
const table = [];
for (const c of L) {
  const body = med((P.glyphs[c] || []).map(s => s.bounds.left));
  (CS[c] || []).forEach((s, i) => {
    const reach = Math.max(0, ...(CE[c]?.prefix || []).filter(e => e.from === i).map(e => e.reach));
    const bl = s.bounds.left; table.push({ c, i, bl, body, reach });
    if (bl > body + EPS) fails.push(`frame: cursive ${c}[${i}] bounds.left ${bl.toFixed(4)} > bodyEdge ${body.toFixed(4)} (sample clipped right of frame)`);
    // reach is quantized by extract.js to 0.0001 (toFixed(4), 5e-5 steps) AND measured
    // on its smoothed copy of dense strokes; smoothing only pulls interior points
    // inward (endpoints pinned), so extracted reach can never exceed the raw
    // overhang body-bounds.left by more than the rounding band. A reach that DOES
    // would mean a broken body-edge (hard fail); a reach that falls SHORT of the
    // raw overhang means the far tip's run was under the noise floor at measure
    // time (by design) - report for human review, never synthesize:
    if (reach > 0) {
      const overhang = body - bl;
      if (reach > overhang + 5.1e-5) fails.push(`frame: cursive ${c}[${i}] prefix reach ${reach.toFixed(4)} exceeds the sample's raw overhang ${overhang.toFixed(4)}`);
      else if (reach < overhang - 5.1e-5) warns.push(`frame: cursive ${c}[${i}] prefix reach ${reach.toFixed(4)} under-covers raw overhang ${overhang.toFixed(4)} (tip run below the noise floor at measure time)`);
    }
    if (reach === 0 && bl < body - 0.02) warns.push(`frame: cursive ${c}[${i}] sticks out ${(body - bl).toFixed(3)} left but no prefix extracted`);
  });
}

// 4. reports
const out = [];
if (R) {
  const d = R.drift; out.push(`page drift (print page): cap ${R.cap_px.print.toFixed(1)}px; uppercase height ${d.upper_min.toFixed(2)}..${d.upper_max.toFixed(2)} cap units (n=${d.n_upper}); cursive page cap ${R.cap_px.cursive.toFixed(1)}px`);
  if (R.missing && Object.keys(R.missing).length) out.push('cursive coverage gaps: ' + Object.entries(R.missing).map(([k, v]) => `${k}(rows ${v})`).join(', '));
}
out.push('metrics: ' + JSON.stringify(P.metrics));
if (!(P.metrics.xHeight < P.metrics.ascender) || !(P.metrics.descender > 0)) fails.push('metrics inconsistent (xHeight<ascender, descender>0)');
out.push('extras per letter (prefix/suffix/misc):');
out.push(L.split('').map(c => `${c}: ${(CE[c]?.prefix || []).length}/${(CE[c]?.suffix || []).length}/${(CE[c]?.misc || []).length}`).join('  '));
for (const c of L) if (CE[c] && !(CE[c].prefix.length + CE[c].suffix.length + CE[c].misc.length) && (CS[c] || []).length) warns.push(`extras: '${c}' has no extra ink in any sample`);
out.push('frame table  letter[i]: bounds.left / bodyEdge / prefixReach'); out.push(table.map(t => `${t.c}[${t.i}] ${t.bl.toFixed(3)}/${t.body.toFixed(3)}/${t.reach.toFixed(3)}`).join('  '));
console.log(out.join('\n'));
const show = (n, a) => { if (a.length) { console.log(`\n${n} (${a.length}):`); [...new Set(a)].slice(0, 60).forEach(x => console.log('  - ' + x)); } };
show('FAILURES', fails); show('COVERAGE GAPS', gaps); show('WARNINGS', warns);
const code = fails.length ? 1 : (gaps.length ? (flags.strict ? 1 : 2) : 0);
console.log(code === 0 ? '\nCHECK CLEAN' : code === 2 ? '\nCHECK PASSED WITH COVERAGE GAPS (exit 2)' : '\nCHECK FAILED');
process.exit(code);
