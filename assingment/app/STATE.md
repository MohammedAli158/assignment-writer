# STATE.md — resume file

Last updated: Phase 3 (cursive filter) BUILT and node-verified (32-check
suite). Browser visuals NOT verified (no browser here); Ali owes a visual
pass of cursive.html and render.html, plus his default cursive profile
capture. Do not start the speed phase or the image-uploader.

## Phase 3 locked decisions (Ali's answers, 2026-10-21)
- Cursive mapping: PER-LETTER BOXES. User writes each letter's cursive form,
  with its entry/exit flicks, alone in a guide box. Store stays open for a
  whole-word hybrid later.
- Capture words: PANGRAM + COMMONS list ("the quick brown fox jumps over the
  lazy dog" + and/of/to/in/is/for/it/than/when/them). It defines the 26 prompted
  letters and gives context words on each letter's prompt screen.
- Bridge suffix-end -> next letter: MIX, per occurrence, seeded — sometimes a
  (near-)straight segment, sometimes a bowed curve (seeded amp choice).
- Join mix per word: CHECKBOX "cursive joins" + 0-100% "cursiveness" slider;
  per-word seeded mode full/partly/separate; partly means per-letter coins.
- Default cursive file: Ali captures it HIMSELF via the new cursive.html and
  exports it; that file becomes the default profile.
- Extraction smoothing (my proposal, unvetoed): measure on a 3-point moving
  average (endpoints pinned), no Chaikin — Chaikin would stretch lengths.
- "Cursive support" will be visible on landing (index.html link) per 6.2.

## Done — prerequisite (readme section 3)
- `src/geometry.js`, `src/glyphstore.js`, `src/advance.js`, `src/capture.js`,
  `src/fallback.js`, `src/loaders/legacyJson.js`, `index.html`, `debug.html`,
  `server.mjs`, `package.json`. See PHASE_NOTES.md for details.

## Done — Phase 1 (readme section 4)
- `src/rng.js`, `src/text.js`, `src/layout.js`, `src/draw.js`, `src/pdf.js`,
  `src/persist.js`, `render.html`. pdf-lib vendored. See PHASE_NOTES.md.

## Done — Phase 2 (readme section 5)
- `src/layout.js` — replaced the constant word space and constant line height
  with bounded, correlated variation. New: `SPACING` defaults, `boundedGap`
  (uses `valueNoise1D`), `wordGapAt`, `lineGapAt`; `wrapLines` now includes the
  varied word gap in the wrap test; `layoutDocument` accumulates varied line
  gaps from a fixed first baseline and paginates from the accumulated
  positions. `perPage` return value removed (was unused).
- `render.html` — four controls (word min/max, line min/max), a `toast`
  component, and `readSpacing` which rejects `max <= min` (and negative gaps)
  with a toast. Controls default from `SPACING`.
- Decisions (Ali's answers): four separate controls; correlated slow walk;
  line gap measured baseline-to-baseline; first baseline fixed and gaps
  accumulate downward.
- Verified in Node: same seed byte-identical; different seed differs; no glyph
  past the right margin; word gaps within [0.35,0.70]; line gaps within
  [1.50,2.10]; neighbouring word gaps more alike than distant ones. Browser
  visuals (toast, controls, actual spacing) NOT VERIFIED.

## Done — Phase 2.5 (ink quality, from Ali's visual review)
- `src/humanize.js` (new) — render-time stroke treatment, called only by
  draw.js. Stores stay untouched. Three fixes: (1) light moving average on
  dense captured strokes kills micro-shakes (hand tremor too fine for a
  human to reproduce); (2) one Chaikin pass on strokes with 4+ points rounds
  the sharp artifact corners seen on 'a'/'p', endpoints pinned, intentional
  vertices on 2-3 point strokes ('v', 'y') untouched; (3) long straight
  segments of short strokes get a slight seeded organic bow (the 'J y v'
  ruler lines). Randomness via `rngFor(seed, 'humanize', <page:item>,
  <stroke>, <segment>)` — same seed renders identical pages.
- `src/draw.js` — passes `options.seed` through to humanizeStrokes; no seed
  means glyphs draw exactly as stored. BUGFIX from first attempt: drawPage
  read `pageIndex` from options (it had referenced an undefined variable,
  which blanked the whole preview).
- `render.html` — passes `seed` and `pageIndex` into drawPage (page index
  keys the humanize stream). drawPage's page-item loop is now indexed.
- Mirrored-variant repair: raster-correlation scan of every variant against
  the other variants of the same char (original vs point-mirrored) found
  'x' variant 2 and 'A' variant 3 genuinely mirrored in the profile data
  (mouse-drawn samples that came in reversed). Both were mirrored about the
  ink's x-centre and written back to `prototype/handwriting_font.json`.
  The '.' ':' '=' '+' scan hits are false positives (mirror-symmetric
  shapes). Re-scan now finds zero suspects; loader re-verified.

## Done — Phase 3 (readme section 6)
- `cursive.html` (new capture page), `src/cursive/{wordlist,store,extract,
  choose,bridge}.js` (new), `index.html` (landing cursive link),
  `render.html` (cursive checkbox + slider), `src/glyphstore.js` (cursive
  passthrough on serialize/deserialize), `src/layout.js` + `src/draw.js`
  (integration). Pipeline, trace and every decision in PHASE_NOTES.md
  "Phase 3".
- Verified in Node: extraction finds fixture flicks and rejects plain in-body
  samples (still finds flicks inside dense jittery strokes); 26-letter prompt
  list; joinMode ends exact (amount 0 -> all separate, 1 -> all full, middle
  mixes all three); bridge endpoints pinned to 1e-12, both pseudo-straight
  and bowed bridges occur; store cursive survives serialize/deserialize.
- Layout on Ali's real legacy profile: same seed byte-identical (incl. bridge
  geometry), different seed differs; bridges emitted with counts that vary by
  seed; base ink stays inside the right margin; amount 0 -> no picks, no
  bridges; amount 1 -> many; fallback chars never carry picks; cursive OFF is
  byte-identical with Phase 2; legacy self-extraction false positives cut
  from 40/354 to 11/354 by measuring against the union envelope of all
  variants (micro runs with reach < 0.04 are dropped as noise).

## Done — render bugfix (2026-10-23)
- `src/draw.js` — base glyphs were rasterized at the page origin. Stored strokes
  are relative to the pen position (origin x = item.x, baseline = item.y), but
  `strokePolylines` drew them untranslated, so all print ink piled up clipped at
  the bottom-left; only cursive extras/bridges (already absolute) were visible.
  Fix: `strokePolylines(polylines, dx, dy)`; glyph items pass `item.x, item.y`,
  extras and bridges stay at 0,0. Node check on Ali's legacy profile: glyph ink
  now spans x 61..691, y 64..864 px on the 794x1123 page (~60 px margin).
- Unrelated: added a top bar in index.html (Render pages / Capture cursive) and
  the deployment root `_redirects` (`/` -> `/app/`) for Cloudflare Pages.
- Spec update (2026-10-24): readme section 6.5 "Pair join rules" — Ali's
  explained real-handwriting join behaviour, now a hard requirement for the
  cursive filter. One join mechanism for every pair (first's suffix merges
  with second's prefix); lowercase only; pair table (`gn/ar/re/ye`, y*/*y,
  g*/*g, p*/*p, q*/*q, b*/t*/l*/d* — reverses included), and `dd` never
  joins (near-identical subtle-variation repeat). This contradicts the
  current per-letter "just attach a flick" model and must replace it in a
  pair-based round after Ali's visual pass.

## Done — bridge join bugfix (2026-10-24)
- `src/draw.js` — cursive bridges were rasterized detached from the letters (the
  joins in e.g. "keep" disappeared). Bridge points are baseline-relative (same
  frame as glyph strokes), but were drawn untranslated: `strokePolylines` passed
  dx=dy=0, so the connector sat a whole baseline below the ink. Fix: bridges now
  draw at `(points, 0, item.y)` — their stored x already contains the line's
  advance, so only y is offset. Node check (fake store, word "keep"): after the
  fix every bridge start/end equals the drawn suffix tip / prefix start exactly
  for k->e, e->e, e->p.

## Done — pair join rules (2026-10-24)
- readme section 6.5 became code. New `src/cursive/pairs.js`: Ali's pair table
  as data — EXPLICIT (gn/ng ar/ra re/er ye/ey), SOCIAL letters
  (y g p q b t l d join any lowercase neighbour either side), NEVER ('dd')
  — and `joinablePair(left, right)` (lowercase-only, blacklist wins).
- `src/cursive/choose.js`: `chooseForItem` (per-letter prefix/suffix/misc —
  the "everything joins" model Ali rejected) replaced by
  `chooseMiscForItem` (misc stays per-letter, table-independent) +
  `chooseForPair` (per pair: seeded coin in 'partly', suffix required from
  the LEFT letter, prefix optional on the right; fills both items'
  cursive records). joinMode/joinPull untouched.
- `src/layout.js`: per-word pass now does one misc pick per letter, then one
  pair decision per adjacency; a suffix on letter i exists only when pair
  (i,i+1) joined, so placeRun's bridge loop and the pull stay direct
  consequences of the table. Hyphen splits strip the crossing pair's
  suffix/prefix (nothing joins onto a '-' non-letter anyway).
- Tests: phase3 suite grown to 43 checks, all pass (pair table unit tests
  + layout-level: "gn" joins, "dd"/"ss"/"bA" get zero bridges and zero
  prefix/suffix extras, "the" joins only t->h). PHASE_NOTES updated.
- One interpretation flagged to Ali: his "reverses are also considered"
  applied to b/t/l/d too, so `*b`/`*d` etc. join; if he only meant the
  explicit pairs, delete four chars from SOCIAL and the tests adapt.

## Done — static hosting fix (2026-10-24)
- Problem: Ali deployed app/ alone to Cloudflare Pages but index/render/debug
  fetched `../prototype/handwriting_font.json`, a file OUTSIDE the deploy
  root, so the default profile (and he thought "the server feature") broke.
  The app is otherwise 100% client-side; only this fetch needed the dev
  server.
- Fix: the legacy profile now ships INSIDE the app as `default-profile.json`
  (copy of prototype/handwriting_font.json, 54 KB); new
  `src/defaultprofile.js` `fetchDefaultProfile()` tries bundled copy ->
  ../prototype (dev) -> prototype (assignment-root deploy), first hit wins.
  All three HTML call sites use it; "serve with node server.mjs" messages
  replaced. server.mjs stays as the dev convenience only.
- Note for Ali: his mouse problem -> the capture pages support phone touch/
  stylus (pointer events), so capture on the deployed site was the plan; with
  this fix it works there end to end (capture, cursive capture, render, PDF).
- Deploy recipe: upload ONLY app/ to Cloudflare Pages; root should list
  app/index.html, _redirects maps / -> /app/.

## In progress
- Nothing. Waiting on Ali:
  1. Visual pass of cursive.html and of render.html's cursive output
     (no browser in this environment — same as the Phase 2.5 recheck).
  2. Capture the default cursive profile: cursive.html -> write every
     prompted letter's cursive form (a few samples each) with real entry and
     exit flicks -> "Export profile" (default-profile.json).

## Next (after Ali's look)
- Fix anything Ali flags, then make his default-profile.json the app default
  (small loader or file drop next to the legacy font; decide then).
- Post-look tuning round: pull max 0.22 / 0.45-reach params; join-in height
  x-height*0.6 when a letter has no prefix; the 35% pseudo-straight bridge
  share; misc envelope sensitivity; whether any of those become controls.
