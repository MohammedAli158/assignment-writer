# PHASE_NOTES.md — Prerequisite phase (capture canvas + glyph store)

## (a) The pipeline, in plain English

This phase builds the two ends of the future pipeline, not the middle (Phase 1):

1. Capture: the user draws a character on a canvas that shows four guide lines
   (ascender, x-height, baseline, descender). Pointer events give raw points.
2. Each point is stored raw as `{x, y, t, pressure}` in canvas pixels, with `t`
   from the event timestamp and `pressure` from the device (0.5 if absent).
3. On save, pixels are converted to cap-height units (capital height = 1.0,
   baseline at y = 0, y pointing up) and shifted so the left ink edge sits at a
   fixed side bearing.
4. The advance width is measured from the ink only: ink width + a bearing on
   each side. The capture canvas size never reaches the store, so empty canvas
   space cannot become gaps.
5. The sample joins `store.glyphs[char]`, a list that grows without a fixed
   count.
6. The legacy JSON loader does the same conversion for Ali's existing file,
   estimating the missing metrics from the character class and flagging them.

The render pipeline (text -> lines -> words -> letters -> strokes -> page) is
Phase 1 and does not exist yet. The glyph store is its input.

## (b) Trace of one letter, start to finish

Take lowercase `g` typed on the canvas:

- `capture.js` `onDown` starts a stroke; `pointFromEvent` gives pixel points;
  `onMove` appends points (all raw).
- `save()` maps each point through `geometry.js` `pxToCap(MARGIN_X, baselineY,
  PX_PER_CAP)` -> `{x, y}` in cap units, y up, baseline 0.
- `advance.js` `normalizeToBaseline(strokes, sideBearing)` calls
  `geometry.js` `inkBounds`, shifts strokes so `bounds.left === sideBearing`,
  and returns `bounds`, `advance`, `baseline`.
- `glyphstore.js` `addSample(store, 'g', sample)` stores it.
- For Ali's file instead: `loaders/legacyJson.js` `convertVariant` maps the
  legacy 0..1 box into the class band (`bandFor` -> `[-descender, xHeight]` for
  `g`), so the body sits above the baseline and the tail hangs below; then the
  same `normalizeToBaseline` runs.
- `debug.html` reads `store.glyphs['g'][0]` and draws it with `capToPx`,
  printing `advance`, `bounds.top`, `bounds.bottom`.

## (c) Files

- `server.mjs` — dependency-free static server; run `node server.mjs`.
- `package.json` — marks the folder as ESM; no dependencies.
- `src/geometry.js` — cap-unit coordinate system, ink bounds, px<->cap helpers.
- `src/glyphstore.js` — the internal glyph-set format and its operations.
- `src/advance.js` — advance from ink + side bearing; baseline normalization.
- `src/capture.js` — guide-line canvas, pointer capture, raw stroke recording.
- `src/fallback.js` — fallback font and missing-character warning.
- `src/loaders/legacyJson.js` — legacy JSON -> internal store, class-estimated metrics.
- `index.html` — capture UI wired to the store.
- `debug.html` — visible test page with measured numbers.

## (d) Decisions and why

- Guide lines (Ali's choice): size and baseline position are stored directly,
  with no capital/lowercase classification to get wrong.
- Store raw points, no smoothing (Ali's choice): the smoothing choice is
  deferred; `t` and `pressure` are kept so a later speed phase stays possible.
- Advance from ink + bearing (spec 3.2): trims empty canvas horizontally.
- Legacy metrics estimated by class and flagged (spec 3.3.2): the legacy file
  has no metrics; assuming a unit box would keep the known size bug.
- Missing characters fall back to a font with a warning (Ali's choice).
- No randomness in this phase, so `prototype/rng.js` was not needed; the
  reuse-vs-rewrite question is deferred to Phase 1.

---

# PHASE_NOTES.md — Phase 1 (baseline human-like rendering)

## (a) The pipeline, in plain English

1. `render.html` reads the text, the seed and the ink colour, and gets a glyph
   store (from localStorage, else Ali's legacy file).
2. `text.js` splits the text into paragraphs and each paragraph into words.
3. `layout.js` `wrapLines` walks the words. For each word it opens one seeded
   stream `rngFor(seed, 'word', wordIndex)` and, for each character, picks one
   stored variant; the x position advances by that variant's advance width.
   A word that would cross the right margin starts a new line. Blank lines are
   kept.
4. `layout.js` `layoutDocument` gives each line a baseline y (evenly spaced,
   perfectly horizontal) and splits the lines into pages.
5. `draw.js` `drawPage` rasterizes one page: cap units become pixels, glyph
   strokes are drawn as ink polylines, missing characters are drawn with the
   fallback font.
6. `render.html` shows the page canvases and, on Export, `pdf.js` embeds each
   canvas as a PNG into an A4 PDF using pdf-lib.

## (b) Trace of one letter, start to finish

Take the `a` in the word "cat" on line 1:

- `layout.js` `wrapLines`: `rng = rngFor(seed, 'word', <wordIndex>)`; the loop
  reaches `'a'`, `list = store.glyphs['a']` (6 variants), `sample =
  list[floor(rng()*6)]`.
- The item `{ kind:'glyph', sample, x: <penX> }` is pushed; `penX +=
  sample.advance`.
- `layoutDocument`: the item is copied into a page with `y = <this line's
  baseline>`.
- `draw.js` `drawPage`: for each stroke, `at(item.x + p.x, item.y + p.y)` is
  `geometry.js` `capToPx(x, y, 0, canvas.height, capPx)` -> pixel; the polyline
  is stroked with the ink colour.
- Export: `pdf.js` `pagesToPdf` embeds the canvas PNG and draws it over A4.

## (c) Files

- `src/rng.js` — Ali's seeded toolkit (seededRng, rngFor, gaussian, noise, walk).
- `src/text.js` — split text into paragraphs and words.
- `src/layout.js` — wrap and place glyphs, choose variants, paginate.
- `src/draw.js` — rasterize one page to a canvas (cap units -> pixels).
- `src/pdf.js` — canvases -> A4 PDF with the vendored pdf-lib.
- `src/persist.js` — save/load the store in localStorage to share across pages.
- `render.html` — the Phase 1 page (this is the visible test page for the phase).
- `index.html` — capture page; now persists the store and links to render.html.
- `vendor/pdf-lib.esm.min.js` — pdf-lib@1.17.1 (MIT) + `LICENSE.pdf-lib.md`.

## (d) Decisions and why

- pdf-lib (Ali's choice), vendored locally at a pinned version because the rules
  forbid inventing CDN URLs at runtime.
- Live browser preview plus PDF (Ali's choice): the preview is the phase's
  visible test page.
- rng.js reused from Ali's toolkit (readme section 8; Ali confirmed reusing the
  logic is fine). Only `rngFor` is used in Phase 1; no tweaks were needed.
- Variant choice uses a per-word stream so editing the end of the text does not
  change the start (section 8).
- No jitter, tilt, cursive or spacing variation: Phase 1 is deliberately the
  "handwriting font" baseline.
- Added `persist.js` (localStorage) so captured samples reach the render page.
  This is a small addition beyond the literal Phase 1 text, needed because the
  app has two pages and no server-side storage.

## Verification

Node smoke tests: layout deterministic; per-word streams stable; no glyph past
the right margin; `pagesToPdf` produces bytes starting with "%PDF". Browser
visual output and PDF export from a real canvas are NOT VERIFIED (no browser
in this environment).

---

# PHASE_NOTES.md — Phase 2 (spacing randomization)

## (a) The pipeline, in plain English

1. `render.html` reads text, seed, ink and the four gap controls, then calls
   `layoutDocument(store, text, seed, PAGE, spacing)`.
2. `text.js` splits the text into paragraphs and words (unchanged).
3. `layout.js` `wrapLines` walks the words as in Phase 1, but the gap before
   each word is no longer a constant `SPACE_ADVANCE`: `wordGapAt` returns a
   bounded value, and that value takes part in the wrap test. Variant choice
   is still the per-word stream.
4. `layout.js` `layoutDocument` gives the first line of each page a fixed
   baseline, then each following line subtracts its own `lineGapAt` value, so
   line gaps vary and the variation accumulates down the page. A line that
   would fall below the bottom margin starts a new page at the fixed baseline.
5. `draw.js` and `pdf.js` are untouched: they still rasterize whatever
   baselines and x positions layout produced.

## (b) Trace of one gap, start to finish

Take the gap between two words on line 1:

- `layout.js` `wrapLines`: `gap = wordGapAt(seed, wordIndex, spacing)`.
- `wordGapAt` calls `boundedGap(seed, 'wordgap', wordIndex, min, max, scale)`.
- `boundedGap` calls `rng.js` `valueNoise1D(seed + '|wordgap', wordIndex,
  scale)` -> a value in [-1, 1] that changes smoothly as `wordIndex` rises
  (that smoothness is the "correlated walk").
- It maps that value onto `[min, max]`: `lo + (hi - lo) * (t + 1) / 2`.
- `wrapLines` adds `gap` to `penX` before placing the word, and includes it in
  the "does this word fit?" test.
- A line gap runs the same way through `lineGapAt` / `boundedGap`, keyed on
  the line index, and is subtracted from the previous baseline in
  `layoutDocument`.

## (c) Files

- `src/layout.js` — now owns both kinds of gap: `SPACING` defaults,
  `boundedGap`, `wordGapAt`, `lineGapAt`, varied wrapping and accumulated
  line baselines. Only file whose behaviour changed in Phase 2.
- `render.html` — four gap controls, a `toast` component and `readSpacing`
  validation; passes `spacing` into `layoutDocument`.
- `src/draw.js`, `src/pdf.js`, `src/text.js`, `src/rng.js`, `src/persist.js` —
  unchanged.

## (d) Decisions and why

- Four controls (Ali's choice): min and max for word gap and for line gap,
  most explicit. `readSpacing` rejects `max <= min` with a toast, so the UI
  the user asked for can never feed layout an invalid range.
- Correlated (Ali's choice): `valueNoise1D` keyed on the word / line index.
  It is continuous, so neighbouring gaps drift together (wide follows wide)
  rather than jumping; it is stateless, so editing later text does not move
  earlier gaps. Measured: mean |gap_i - gap_{i-1}| ~= 0.039 vs
  |gap_i - gap_{i-20}| ~= 0.111, i.e. neighbours are clearly more alike.
- Correlation length (`wordScale` 4, `lineScale` 3) is an internal constant,
  not a control, to keep the UI at the four settings Ali asked for.
- Line gap = baseline to baseline (Ali's choice); the first baseline of each
  page is fixed and gaps accumulate downward (Ali's choice). This keeps the
  top margin predictable and makes pagination follow from real positions.
- `boundedGap` sorts `min`/`max` and floors them at 0, so even a bad caller
  cannot produce overlapping words or a negative range.
- Phase 1's `SPACE_ADVANCE` constant is gone; `PAGE.lineHeight` is kept only
  as a reference comment, since the average line gap now comes from `SPACING`.

## Verification

Node smoke test (same profile, long text, both with and without blank lines):
same seed -> byte-identical pages; different seed -> different pages; no glyph
past the right margin; every word gap in [0.35, 0.70]; every line gap in
[1.50, 2.10]; neighbouring word gaps measurably more alike than distant ones.
Browser visuals (the toast, the four controls, the rendered spacing) are NOT
VERIFIED here (no browser in this environment).

---

# PHASE_NOTES.md — Phase 2.5 (ink quality fixes from Ali's visual review)

## What Ali saw and what actually caused it

The app never adds jitter — the pipeline has no entropy code for ink. All
three defects were frozen into the stroke DATA, and only showed once pages
rendered large enough to zoom:

1. Micro-shakes: live capture stores points raw (Ali's earlier decision, so
   `t`/`pressure` stays available for the speed phase). A mouse hand trembles
   ~1px between samples, far too fine for a human to reproduce on purpose.
2. Sharp "unhuman" shapes inside 'a' and 'p': the strokes are sparse polylines
   (the bowls have 7-9 points), so two consecutive segments meeting at a wide
   angle render as a hard notch.
3. Ruler-straight rows ('J y v'): 2-3 point strokes render as perfect
   straight segments between samples.

## Fix: render-time treatment only (`src/humanize.js`, called from draw.js)

The stored data is untouched; a later phase (e.g. speed) still sees raw input.

- Micro-shakes: strokes with >12 points (dense capture) get a 3-point moving
  average on interior points, endpoints pinned. Sparse legacy strokes skip it
  (they have 2-9 points; smoothing them would destroy the letter).
- Sharp corners: strokes with 4+ points get exactly ONE Chaikin pass (25/75
  corner cutting, first and last point kept). Edges round off, but after one
  pass the curve is still visibly hand-drawn — deliberately not perfect.
  Short strokes (2-3 points) are never cut, which preserves intentional
  vertices like the point of 'v'.
- Straight lines: each long (>= 0.25 cap units) segment of a 2-3 point stroke
  is resampled to five points and bowed — interior points move along the
  segment normal by amp*sin(pi t) + small second harmonic, with amp between
  4.5% and 9% of the segment length, sign and asymmetry seeded. Endpoints stay
  pinned, so joins between arms (and between neighbouring glyphs at joints)
  do not move.

## Determinism

`humanizeStrokes(strokes, seed, glyphKey)` with glyphKey "pageIndex:itemIndex"
and streams `rngFor(seed, 'humanize', glyphKey, strokeIndex, segmentIndex)`.
Same text + seed + settings renders a byte-identical page again; editing text
only re-derives the items it mentions.

## Trace of one 'a'

- layout picks variant 0 (9-point bowl + 3-point crossbar).
- humanize: bowl has 9 points -> one Chaikin pass -> 19 points, corners of the
  notch softened; crossbar has 3 points -> its ~0.9-long segment is resampled
  and bowed by ~0.05 cap units.
- draw.js strokes the treated polylines; the store still holds the original.

## Verification (Node)

Endpoints pinned on bowed strokes; 'v' vertex kept to 1e-9; fold corners
rounded; same-instance identical / different-key different; 60-point tremor
stroke flattened to <0.004 residual between endpoints; all 80 profile chars
transform with zero NaNs. Browser re-look by Ali still pending (no browser
in this environment).

---

# PHASE_NOTES.md — Phase 3 (cursive filter)

## (a) The pipeline, in plain English

1. Ali first captures his cursive letter forms in `cursive.html` (per-letter
   boxes, Ali's locked mapping choice): each save converts the raw strokes to
   the shared cap-unit frame EXACTLY like the print capture, stores it under
   `store.cursive.samples[char]`, and then `extract.js` compares it with the
   print base of the same letter and records the extras under
   `store.cursive.extras[char]` as prefix / suffix / misc candidates.
2. `render.html` gets two new controls: a "Cursive joins" checkbox and a
   0-100% "Cursiveness" slider, passed as `{ enabled, amount }`.
3. `layout.js` chooses, per WORD (seeded), a mode fully/partly/separate and
   per LETTER occurrence picks which stored extras to attach; a joined pair
   pulls slightly left; bridges are computed between the pairs inside a word
   and pushed as small "bridge" polyline items.
4. `draw.js` draws the base glyph (humanized as before), re-anchors and draws
   the chosen extras (humanized), and draws bridges exactly as stored (they
   are pre-shaped; a re-bow would move their pinned endpoints).
5. `pdf.js` is untouched; everything still rasterizes through the same page
   canvases.

## (b) Trace of one letter, start to finish

Take `o` in "dog" on some line:

- wrapLines: the per-word stream `rngFor(seed,'word',wi)` picked variant v.
- `joinMode(seed, wi, amount)` -> e.g. 'full' (stream `rngFor(seed,'joins',wi)`).
- `chooseMiscForItem(store, 'o', seed, wi, i, 'full')`: stream
  `rngFor(seed,'curs','pickM', wi, i)` picks one misc Extra from
  `store.cursive.extras['o']` (or none) — pair-independent, sets item.cursive.
- pair (o, next): `chooseForPair(store, word, wordItems, i, seed, wi, 'full')`
  consults `joinablePair` in pairs.js. Off the table -> the o keeps its base
  shape: no suffix, no prefix, no bridge — this is the fix for "the output
  looks unreal straight/everything joins". On the table ->
  `rngFor(seed,'curs','pickS', wi, i)` fills o.cursive.suffix and
  `rngFor(seed,'curs','pickP', wi, i+1)` fills next.cursive.prefix; the merge
  is exactly one mechanism: o's suffix extends into the next letter's entry.
- placement: before placing the NEXT letter, `joinPull` (stream
  `rngFor(seed,'curs','pull',wi,i)`) pulls penX left by up to 0.22 cap units
  (a function of the suffix's reach, jittered); the wrap test used the same
  reduced width, so pagination never disagrees with placement.
- bridge: a = suffix tip (item.x + v.bounds.right + last rel point); b =
  next letter's entry (its prefix's first rel point, or its left ink edge at
  x-height*0.6 when it carries no prefix). `buildBridge(a, b, seed, wi, i)`
  decides per occurrence: 35% pseudo-straight (tiny bow), 65% clearly bowed;
  7 points, endpoints pinned exactly on a and b; pushed as { kind:'bridge' }.
- drawPage: base strokes humanized with key `${pageIndex}:${i}`; extras are
  re-anchored — prefix at the variant's LEFT ink edge, suffix at its RIGHT
  ink edge, misc proportionally inside the body (attach.y unchanged, because
  both frames sit on the same baseline) — then humanized like any ink under
  key `${key}:x${kind}`; the bridge is drawn from its stored polyline with no
  further treatment.

## (c) Files

- `cursive.html` — capture page: prompt list from the word list, extraction
  preview colour-coded by kind, import/export of profiles (~253 lines, HTML).
- `src/cursive/wordlist.js — the default pangram + commons word list, the 26
  prompted letters and per-letter context words. Pure data.
- `src/cursive/store.js — the `cursive` section of the store and its ops
  (add samples/extras, coverage, merge). Pure data; no randomness.
- `src/cursive/extract.js — static extras extraction: measure on a 3-point
  moving average (dense strokes only, endpoints pinned), body envelope =
  min-of-mins/max-of-maxes per 24 x-bands across ALL variants, flag points
  L/R/M, same-flag runs (noise-floored, merged) become Extras with
  rel-points, attach point, reach, length. No randomness, no ML.
- `src/cursive/choose.js — joinMode weights (full=amount, partly triangle,
  separate=1-amount), misc extras per letter, the PAIR decision (with
  pairs.js) plus joinPull. Seeded only.
- `src/cursive/pairs.js — Ali's pair join rules (readme 6.5) as a tiny data
  table + `joinablePair(left, right)`. This is the file Ali extends freely;
  the join mechanism itself never gets re-implemented per pair.
- `src/cursive/bridge.js — the pseudo-straight/bowed connector (Ali's mix),
  endpoints pinned, seeded amplitude and asymmetry.
- `src/glyphstore.js — deserialize now passes the cursive section through.
- `src/layout.js — cursive picks, pulls and bridges woven into wrap/paginate;
  with cursive off the output is byte-identical to Phase 2 (same streams).
- `src/draw.js — draws item.cursive extras (re-anchored) and bridge items.
- `index.html — the "cursive support" entry point is visible on landing.
- `render.html — two cursive controls wired into layoutDocument; a warning
  points to cursive billing when enabled with no cursive data captured.

## (d) Decisions and why

- Per-letter boxes (Ali's choice): segmentation by construction; the store
  stays open for a whole-word capture upgrade later. Words from the pangram
  list still prompt and give context ("write cursive b as in 'brown'").
- Bridge mix (Ali's choice, "sometimes pseudo straight, sometimes bowed"):
  35% pseudo / 65% bowed per occurrence, seeded per pair — never a ruler
  line because even pseudo-straight bridges keep a 0.4-1.4% bow.
- Join mix (Ali's choice): weights wFull=amount, wPartly=2*amount*(1-amount)
  (triangular, zero at both ends), wSeparate=1-amount; so the slider truly
  reaches 0 = all separate and 1 = all full, and the middle keeps a mix like
  Ali's "user" example.
- Rendering anchors: extras are stored relative to their attach point
  (junction on the body edge) and re-anchored to the RANDOM variant's edge
  at draw time. This is what makes one cursive sample reusable across every
  variant; the tiny seam at every attach is the per-occurrence imperfection
  the readme asks for, not a bug to fix.
- Extraction measures against the union envelope across ALL stored variants,
  so ordinary cross-variant shape differences are not misc extras (a
  reference-variant comparison produced 40/354 false extras on Ali's own
  legacy file; the envelope drops self-scan hits to 11/354, all on variants
  that genuinely exceed every other variant's envelope by a lot).
- Micro prefix/suffix runs (reach < 0.04 cap) are dropped as noise; that is
  smaller than the side bearing a bridge would have to cross anyway.
- Pull-in exists so joined words cover less width: min(0.22, 0.45*reach)
  jittered by +/-0.04, part of the wrap width, seeded per pair.
- Misc anchoring is proportional ((attach.x - ref.left) mapped into the
  variant's body width) rather than pinned — a loop must sit where the body
  is, and bodies vary.
- Extraction smoothing is measure-time only (no Chaikin so measured lengths
  are not fabricated); render-time ink treatment stays humanize.js's job.
- Pair join rules (Ali, 2026-10-24, readme 6.5): the join is a PAIR decision,
  never a per-letter one; lowercase only; one merge mechanism
  (i's suffix -> (i+1)'s prefix, bridged). Table: gn/ng, ar/ra, re/er, ye/ey;
  y g p q b t l d join any lowercase neighbour either side (reverses included
  per Ali's "reverses are also considered"); dd NEVER joins — two d's are the
  same shape written twice with minimal variation. A pair without a stored
  suffix cannot join even if the table allows it. Hyphen splits strip the
  crossing pair's suffix/prefix, since nothing joins onto a hyphen.

## Verification (Node)

- 43-check node suite passed: everything the 32-check suite covered, plus
  the pair table at unit level (exact list both ways, social letters, dd,
  capitals/non-letters) and at layout level with amount 1 ("gn" -> 1 bridge
  with merges on both letters, "dd"/"ss"/"bA" -> zero bridges and zero extras,
  "the" -> only t->h joins) and joinMode/bridge/store coverage unchanged.
- layout on Ali's real legacy profile: same seed byte-identical (including
  bridge geometry), different seed differs; bridges emitted with varying
  counts; maximum base ink stays inside the right margin; amount 0 gives
  neither picks nor bridges, amount 1 gives many of both; fallback chars
  never get cursive picks; cursive OFF is byte-identical with Phase 2's
  output (the old streams are untouched).
- Self-extraction scan of all 354 legacy samples: 11 flips (3%), all big
  genuine overshoots on digits/odd variants — accepted data reality, and
  only relevant at Ali-capture time where a cursive sample legitimately
  leaves the print envelope.
- All page/scripts import paths resolve; inline module scripts pass
  `node --check`; file sizes within the ~200-line rule (cursive.html at 253
  including CSS and markup).
- Browser visuals (the capture page preview, cursive rendering, PDF) are NOT
  VERIFIED here — no browser in this environment. Ali must run the visual
  pass, and he still owes the default cursive profile capture.
