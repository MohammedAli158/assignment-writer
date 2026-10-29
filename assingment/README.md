I read your `handwrite-profile.json` before writing this, and it explains your size bug directly. The file is 80 characters, each with several variants (6 for lowercase, 4 for capitals and digits, 3 or so for punctuation), and each variant is a list of strokes made of `[x, y]` points between 0 and 1. Every glyph is stretched to fill its own box. A lowercase `a` and a capital `A` both span the full 0 to 1 range, and `g` and `p` also fill the box *including* their descenders, so their bodies come out smaller than `a`'s. The file has no baseline, x-height or advance-width information. I put a requirement in the prompt so the agent can't repeat this.

Here is the prompt:

---

# Handwriting Renderer: Agent Operating Instructions

## 0. What we are building

A web app that takes typed or AI-generated text and renders it on paper (PDF output) so it looks hand-written by a specific person. The person's handwriting comes from samples they draw themselves in the app, or from a handwriting profile JSON file. There is no neural network and no letter generation. The renderer only rearranges, places and slightly distorts the user's own strokes.

The developer (Ali) is a student who must be able to read and understand every file you write. Understanding is a hard requirement, equal in importance to correctness.

## 1. How you must work

1. **Ask before you build.** At the start of each phase, ask every question you need answered (section 9 lists the first set). Do not guess on design decisions. Several questions per round is fine.
2. **One phase at a time.** Finish a phase, stop, and wait for Ali to say "go" before starting the next.
3. **Keep code readable.** One responsibility per file, files under roughly 200 lines, plain names, and a comment at the top of each file saying what it does and what calls it. Prefer boring code over clever code.
4. **Write `PHASE_NOTES.md` at the end of every phase.** It must contain: (a) the pipeline in plain English (text → lines → words → letters → strokes → page), (b) a trace of one single letter through every function that touches it, (c) a list of files with one sentence each, (d) the decisions made and why.
5. **Maintain `STATE.md` continuously.** Your session can die mid-phase because of usage limits. Keep a short file with what is done, what is in progress, what is next, and any open questions, so a fresh session can resume from it alone. Update it after each meaningful step.
6. **Windows environment.** Ali develops on Windows. Use `path.join` and `path.resolve`, never hardcode `/` or `\` in paths, and mention any Windows-specific risk before he runs something.
7. **Non-destructive first.** If something can be fixed by restarting or reusing an existing resource, do that before deleting and recreating it.
8. **Language:** JavaScript or TypeScript. Ask which if it is not already decided.

## 2. The existing prototype: inspiration only

Ali has a working prototype that mixes many concerns together. It is a source of ideas, not a source of code.

- Do not copy, paste, port or hardcode anything from it.
- Before you adopt any idea from it, write down what you observed, what idea you want to take, and why. Then ask Ali questions about it and wait for his confirmation.
- Known bugs the prototype may or may not still have (do not assume they are fixed, and do not inherit them):
  - Capital and lowercase letters rendered at the same size because the capture canvas was the same size for both.
  - Empty space inside the capture canvas was rendered onto the paper, so a small `a` that used 25% of the canvas produced huge gaps once spacing randomness was added.

## 3. Prerequisite for everything: the capture canvas and glyph store

Build this first, before Phase 1.

### 3.1 Capture

- An empty canvas, usable with a mouse, finger or stylus (pointer events), working on a phone.
- The user is prompted to write each character. Whatever they write in a character's slot is registered as that character in their handwriting.
- Multiple samples per character are supported, and the count per character must not be assumed fixed. Ali's existing file has 6 for lowercase and 4 for capitals.
- Record the raw input as ordered strokes of points. Also keep a timestamp and pressure per point when the device provides them. Store them but do not use them yet (a later speed phase will need them).
- The user should see their strokes smoothed or at least not jagged. Ask Ali which smoothing method he prefers and propose options.

### 3.2 Size and position must be preserved (this is the main requirement)

The stored data must keep each letter's size **relative to the others** and its position **relative to the baseline**. Do not stretch every glyph to fill a unit box.

- Capture on a canvas with visible guide lines: baseline, x-height, ascender and descender. Ali already identified that capitals and lowercase need different treatment. Evaluate both approaches (guide lines vs. classifying the letter as capital/lowercase and normalizing by class), recommend one, and ask Ali.
- Store, for every glyph: the strokes in a shared coordinate system, the baseline position, and an **advance width** (how much horizontal space the letter should occupy, measured from the actual ink plus a side bearing, not from the canvas).
- Trim empty canvas space horizontally when computing advance width, so unused canvas never turns into gaps on paper.
- Descenders (`g p q y j`) must hang below the baseline instead of being shrunk to fit the box.

### 3.3 One internal format, many sources

The renderer must never know where handwriting came from. Define one internal glyph-set structure and write **loaders** that convert into it:

1. Live canvas capture (build now).
2. The existing profile JSON shape (build now). That shape is `{ "<char>": [ { "strokes": [ [ [x,y], ... ], ... ] }, ... ] }` with coordinates in 0..1 and y pointing down. Build a loader for it that is clearly marked "legacy normalization" and flags that the metrics are missing. Ask Ali how to estimate them.
3. SVG stroke files and image-derived profiles (do **not** build now, but the structure must make these loaders easy to add later).

Ali's current file has only 80 characters (no `$ % < > [ ] \ ^ _ { | } ~` and a few others). Ask what should happen when the text contains a character the profile lacks.

## 4. Phase 1: baseline human-like rendering

Text in, handwriting out, with **no randomness of any kind** beyond choosing among the user's stored variants.

- Equivalent to using a handwriting font: letters placed left to right using advance widths, on evenly spaced, perfectly horizontal lines, wrapping at the page margin.
- When a character has several variants, pick one per occurrence. Use the seeded generator described in section 8.
- Output to PDF. Ask which PDF library to use and recommend one.
- No cursive, no speed, no tilt, no spacing variation.

Done when: a paragraph renders with correct relative letter sizes, descenders below the baseline, and no oversized gaps between letters.

## 5. Phase 2: spacing randomization

The handwriting stays identical, but spacing becomes human.

- Word gaps vary from word to word, and line gaps vary from line to line.
- Variation must be bounded: never too small (words touching or overlapping) and never too large (visible holes).
- **Two user-controllable settings:** minimum word gap and minimum line gap. Ask how Ali wants the upper bound handled (derived from the minimum, or a second setting).
- Variation should feel natural, not jumpy. Consider whether neighboring gaps should be correlated (see `boundedWalk` and `valueNoise1D` in the seed toolkit) and justify your choice.
- Gaps are measured from ink and advance widths, never from the capture canvas.

## 6. Phase 3: cursive filter

### 6.1 The idea

A letter's normal shape is its **base glyph**. When people write cursively, the same letter gains extra strokes around that base shape. The filter attaches those extra strokes to the base glyph, and each letter needs its own, imperfect extras so the page looks human.

There are three kinds of extra stroke:

- **Prefix:** an entry stroke that comes in before the base glyph begins.
- **Suffix:** an exit stroke that leaves after the base glyph ends.
- **Miscellaneous:** extra ink on the body itself (a loop, a crossing, an extended tail).

Some letters may have only a prefix, some only a suffix, some only miscellaneous, some several, and some none. Never assume every letter has all three.

### 6.2 Capturing cursive from the user

- Separately from the normal capture, ask the user to write a set of letters or words in their natural cursive. Ali will provide a default file with his own handwriting so the app works before the user writes anything.
- A "cursive support" option must be visible as soon as the user lands, so they can create their own cursive samples immediately.
- Ask Ali which words to prompt for, and how to map cursive-written words back to individual letters (this is a hard problem, so propose options with trade-offs).

### 6.3 Extracting the extras statically

Compare each cursive sample to the base glyph of the same letter, in the same coordinate system:

- Find the portions of the cursive strokes that lie **beyond the base glyph's extent**. This is the "extra area".
- Classify by where the extra part sits along the stroke in drawing order: before the base shape starts, it is a prefix; after it ends, a suffix; otherwise, miscellaneous.
- Record, for each extra, its shape (as points), its length, how far it reaches beyond the base, and where it attaches to the base.
- Input drawn with a mouse will be jagged, while stylus input will be smoother. The extraction must work on both, so smooth before measuring.
- Do this with plain geometry, with no machine learning.

### 6.4 Applying it during rendering

- For each letter occurrence, choose with the seeded generator which extras to apply (none, prefix, suffix, miscellaneous, or a combination), and pick from the user's available samples for that letter.
- Apply small imperfections to the chosen extras so no two look identical.
- The decision to join two letters is about the **pair**: a suffix on letter *n* should lead into letter *n+1*. Propose how to bridge the end of one letter's suffix to the start of the next (for example, a short curve joining the two points), and ask Ali before implementing.
- Words can be fully joined, partly joined, or fully separate, as in his `user` example.

### 6.5 Pair join rules (hard requirement from Ali)

There is exactly **one join mechanism**: when a pair joins, the first letter is
drawn with its exit stroke (suffix), the second letter with its entry stroke
(prefix), and the two are **merged into one continuous flow**. The pair table
only decides *whether* a pair joins; it never changes *how* they join.

Rules, confirmed by Ali:

1. **Joining is pair-based, not per-letter.** A letter does not "always" or
   "never" join; only specific pairs do.
2. **Lowercase only.** Capitals never participate in joins.
3. **Joinable pairs** (reverse of each pair is also joinable, so `gn` implies
   `ng`): `gn`, `ar`, `re`, `ye`.
4. **y always joins** with any neighbor, on either side: `y*`, `*y`.
5. **g, p, q always join** with any neighbor, on either side (`g*`, `*g`,
   `p*`, `*p`, `q*`, `*q`) — same one-mechanism merge as above.
6. **b, t, l, d** always join left-to-right with whatever follows (`b*`, `t*`,
   `l*`, `d*`), again by the same merge.
7. **`dd` is the exception and does not join.** Two d's in a row are the same
   shape written twice, with minimal but existing variation (see section 8
   variant choice). No merge, no continuous flow.

The renderer must consult a pair-rules table when deciding to join. This table
is data Ali can extend freely; the join mechanism itself must stay the single
one described above and never be re-implemented per pair.

## 7. Explicitly out of scope for now

- The speed phase (speed-dependent letter deformation). This is an open design discussion with Ali, so do not implement it. Only make sure timestamp and pressure data are stored so it stays possible.
- Uploading an image of handwriting and deriving a profile from it. It comes later, but the loader architecture in 3.3 must not block it.
- Any neural network, handwriting synthesis model, or font generation.

## 8. Randomness rules

Ali already has a seeded randomness toolkit (`rng.js`: `seededRng`, `rngFor`, `gaussian`, `valueNoise1D`, `boundedWalk`). Reuse it rather than writing a new one.

- Never use `Math.random`, `Date`, or any unseeded source in rendering code.
- Derive every random decision from a named stream, for example `rngFor(seed, "line", i)` or `rngFor(seed, "word", i)`, so editing one part of the text never changes the rest.
- Same input, same settings and same seed must produce an identical page.

## 9. Questions to ask Ali before writing code

1. Which language: JavaScript or TypeScript?
2. Which PDF library, and do you want a live preview in the browser as well?
3. Capture canvas: guide lines, or capital/lowercase classification?
4. How should missing characters be handled?
5. How should smoothing be done for jagged mouse input?
6. Which prototype ideas do you want me to look at, and what exactly should I report back about them before using any?
7. Which words should the cursive capture prompt for?

Ask more if anything is ambiguous. Wait for answers before starting the prerequisite.

---

Two things to know before you hand this over.

**Cursive letter mapping is the hard part of Phase 3.** Getting from "the user wrote a cursive word" to "here is the cursive version of each letter" is genuinely difficult, since the letters run together. I put it in the prompt as a question for the agent to propose options on rather than letting it quietly pick something. An easier alternative is to have the user write each letter's cursive version in its own box, which loses some of the natural flow but makes extraction much more reliable.

**Speed phase.** I left it out as you asked. One idea for when we discuss it: you may not need to model speed per letter at all. If you capture a few letters at three speeds (slow, normal, fast), you can store each speed as another variant and interpolate between them. That would be a good thing to talk through next.