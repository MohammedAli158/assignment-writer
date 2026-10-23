# NOTES.md — Phase 0 audit of the CURRENT code (before any behavior change)

Scope: everything below describes the repo as found. New Phase-0 files
(`rng.js`, `tests.html`, `debug.html`, this file) add tooling only;
`index.html` was not modified (sha256 `bdd2eacaf04bb93762f7a0bc6f885569bddc3380473f95cce0936dd567cf27f1`, 39400 bytes).

## 1. File structure

- The repo root contains exactly three files: `index.html` (single-file
  vanilla-JS app, 461 lines), `handwriting_font.json` (stroke-sample data,
  ~60 KB), `README.md` (shared working rules). There is no build step, no
  package manager, no test infra, no server code — not found.
- `index.html` structure, all inside one inline `<script>` IIFE
  (`index.html:129-458`): helpers/state (`133-169`), capture tab
  (`171-206`), generation helpers (`208-270`), ink-thickness module
  (`272-328`), page/paper/pen primitives (`330-342`), glyph drawing
  (`344-372`), page layout (`374-421`), render orchestration (`423-443`),
  UI wiring (`445-457`).
- ES-module imports / `fetch` of local data — not found. The only
  `<script src>` is the jsPDF CDN (`index.html:8`). (The substring "import"
  in the file is only the Import-profile button/handler, `index.html:62,205-206`.)

## 2. How glyphs are stored

- Runtime profile lives in `state.profile` (`index.html:144-146`), persisted
  to `localStorage` under key `'handwrite.profile.v3'`
  (`index.html:137,151-152` via `loadProfile`/`persistProfile`).
- Shape: `{ char: [dataURL, ...] }` — each char maps to an array of up to 5
  PNG data-URLs (slots UI in `buildSlots`, `index.html:188`; save logic in
  `$('#saveGlyph').onclick`, `index.html:193-202`).
- Capture crops to real ink bounds plus an 18 px margin (`index.html:196-199`)
  and stores `canvas.toDataURL('image/png')` per slot (`index.html:200-201`).
  So glyph size survives only implicitly as raster pixels, not as metrics.
- Slot/variant selection at render time picks a random slot per character
  occurrence (`index.html:405` in `renderPage`).
- Image decoding is cached in `imgCache` (`index.html:269-270`, `loadImage`)
  and every unique glyph is preloaded once per render in `renderAll`
  (`index.html:430-433`); ink-thickness variants are cached in `inkCache`
  (`index.html:290,295`).

## 3. How glyphs are drawn

- `drawGlyph` (`index.html:344-372`): target height derives from `capHeight`
  (42 px base, `index.html:376`) scaled by glyph class — `lower` ×
  `opts.lowercase`, `ascender` × `clamp(lowercase+.18,.7,.98)`, `descender` ×
  `lowercase*1.01`, `digit` × `.88`, `punct` × `.62` (`index.html:345-350`,
  classes from `glyphClass`, `index.html:218-223`).
- Jitter inside `drawGlyph`: size `gaussian(rng)*.032` (`352`), slant
  `wordSlant + gaussian(rng)*slant*.020` (`354`), baseline `microY`
  `gaussian(rng)*baseline*.9` (`355`), scale `sx`/`sy` (`363`), alpha from
  pressure (`364`), ghost double-strike when `pressure*.32 > .1 && rng()<.35`
  (`365-368`), advance `w*(.88 + spacing*.08 + gaussian*spacing*.035)`
  (`370`).
- Missing glyphs fall back to `fallbackText` (`index.html:340-342`, called at
  `361`): italic `Segoe Print`/`Comic Sans MS` fillText, never a blank.
- Ink thickness is render-time morphology in `processInk`
  (`index.html:291-328`): upsample 4× (`SS`, `281`), separable min/max filter
  of radius `inkSliderToRadiusPx` (`283-289`), downsample back.
- Pen primitives: `drawPaper` (`330-336`), `roughLine` 10-segment jittered
  polyline (`338`), used for strike-throughs, heading underlines, arrows,
  boxes, margin ticks.

## 4. Where layout happens

- `renderPage` (`index.html:374-421`): creates a 794×1123 canvas
  (`PAGE_W`/`PAGE_H`, `136`), margins `marginX=72/top=82`
  (`376`), `baseH=42`, `lineH=baseH*lineSpacing` (`376`).
- Per page: one `pageDriftSign` (`381`); per line: left-edge jitter
  `marginX + gaussian*2.2` (`389`), slope `lineSign*lineTilt*(.4+rng()*.9)*.07`
  (`390-391`), baseline `y + gaussian*baseline*1.1` (`392`).
- Text pipeline per line: `preprocessLine` (list-prefix + shorthand,
  `231-236`, via `shorthandWord` map, `225-229`) → heading strip (`384`) →
  `buildLineTokens` (whitespace split + vocabulary-based struck mistakes,
  `251-265`, vocabulary from `buildVocabulary`, `240-244`) → per-word
  `wordSlant=(rng()-.5)*slant*.06` (`401`) → per-char `localBaseline`
  (`404`) + `drawGlyph` advance accumulation (`406`) → strike line (`408`),
  heading underline (`410`), remember-arrow / fix-check-important boxes
  (`412-413`) → `y += lineH + gaussian*baseline*1.3 + (rng()-.5)*lineH*.1`
  (`415`), stop at `PAGE_H-90` (`416`); margin ticks (`419`).
- `renderAll` (`index.html:423-443`): reads textarea + `settings()`
  (`209-215`) + seed (`424`), budgets pages (`438`) but actually paginates by
  23-line chunks (`440`), draws each page canvas into the DOM (`441`).

## 5. Where randomness is used

- Seeded PRNG `rand(seed)` (`index.html:154-162`, mulberry32-style),
  `gaussian(rng)` Box–Muller (`163-167`), `pick(arr,rng)` (`169`).
- One seeded stream per page: `rng=rand(seed + pageIndex*10007)` in
  `renderPage` (`375`), threaded through paper grain (`334`), `roughLine`
  (`338,408,410,412-413,419`), `drawGlyph` jitters (`352-370`), line geometry
  (`389-392,401,405,415`). Same text + seed + settings is therefore
  deterministic through layout/rendering.
- Unseeded `Math.random` appears exactly twice: `pick(arr, Math.random)` in
  `imgForChar` (`index.html:268`) — dead code, never called (the live path
  uses `pick(..., rng)` at `405` with preloaded `glyphImages`) — and the "New
  variation" seed button (`index.html:446`), which is UI-only seed picking,
  not layout/rendering. No other unseeded source was found.
- `rng.js` (new Phase-0 toolkit) contains zero randomness sources besides its
  own seeded PRNG (verified: no `document`/`window`, no unseeded calls in
  code; the string match for randomness APIs is only a code comment).

## 6. What the profile JSON contains

- `handwriting_font.json`: top-level map of 80 characters
  (`012…9a…zA…Z.,!?:;'"()-/&@#=+*`) to variant arrays (3–6 each, 354 total;
  measured with node). Each variant is `{"strokes": [...]}` — `strokes` is
  the ONLY field per glyph (example: key `"a"`, `index.html` never reads this
  file — see below).
- Point format: each stroke is an array of `[x, y]` float pairs (verified: all
  354 variants contain only length-2 numeric pairs).
- Normalization: every variant's bounding box lies inside roughly the 0–1 box
  (measured: all glyphs within [-0.05, 1.05] on both axes). Widths vary by
  letter (`i`/`l` ≈ 0.01–0.13 wide vs `m` ≈ 0.9–1.0) but HEIGHTS do not:
  `a`/`b`/`g`/`p`/`q`/`y` all span ≈ 0.85–1.0 in y with the same y-offset
  range, so ascender / x-height / descender / baseline distinctions do NOT
  survive — each glyph is normalized to its own 0–1 box (height-normalized).
  Punctuation is the partial exception (`-` height ≈ 0.0–0.05, `.` ≈ 0.11),
  but it shares the same normalized frame, not a shared em box.
- Crucially, `index.html` never loads `handwriting_font.json`: no `fetch`,
  no import, no filename reference (verified by search; the only "import"
  hits are the profile Import button). The live app uses only the
  localStorage PNG-dataURL profile described in §2. Any phase needing stroke
  vectors must define the JSON→renderer bridge explicitly — it does not exist
  today.

## 7. Where the app is slow

- `processInk` (`index.html:291-328`): per unique glyph, a 4× supersampled
  `getImageData` plus a separable min/max filter with inner loops over radius
  `r` per pixel in JS (`305-323`). This is the dominant cost on first render
  with a full profile; mitigated only by `inkCache` (`290,295,326`).
- `drawPaper` grain (`index.html:334`): 3000 individual `fillRect` calls per
  page when warm paper is on.
- `saveGlyph` scan (`index.html:197`): full 1000×340 `getImageData` pixel
  loop over ~340k pixels per save.
- `renderPage` per-character canvas state churn (`drawGlyph` save/translate/
  rotate/scale/drawImage/restore, `366-369`, plus occasional ghost redraw,
  `368`) and many `roughLine` 10-segment strokes; `renderAll` (`430-436`)
  additionally decodes every unique glyph image before drawing.
- No virtualization/pagination cap beyond the 23-line chunk rule
  (`index.html:440`); huge inputs grow DOM canvases linearly.

## 8. Noticed but not touched (out of Phase-0 scope)

- `imgForChar` (`268`) is dead code using an unseeded source; flagged, not
  removed per scope rule.
- `handwriting_font.json` is currently unused by the app; flagged, not wired
  up per scope rule.
- All Generate-panel defaults/sliders were preserved untouched in `index.html`.
