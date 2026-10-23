# SHARED RULES: read before doing anything

You are improving an existing vanilla-JS "handwriting humanizer": it renders
typed text as pages that look handwritten, using the user's own captured
handwriting (stroke data). The code may come from earlier attempts and may be
messy. Work only on the CURRENT PHASE below. Do not start later phases, and
do not refactor things the phase doesn't touch.

1. SCOPE. Do only what the phase asks. If you notice a problem outside the
   phase, list it under "Noticed but not touched" in your report.
2. PRESERVE EXISTING FEATURES. Do not remove, rename, or silently change the
   default of any existing control: baseline, slant, spacing, ink thickness,
   pressure, line tilt, margin jitter, mistakes with strike-throughs,
   shorthand, heading underlines, "remember" arrows, boxes around
   fix/check/important, warm paper, handwriting capture, JSON import. If a new
   behavior overlaps an old slider, keep the slider working as a multiplier or
   offset on the new behavior.
3. STACK. Vanilla JS, ES modules (served over http), no frameworks, no LLM or
   network calls at runtime, no new dependency without asking me first. Never
   invent CDN URLs or version numbers.
4. DETERMINISM. Same text + same seed + same settings = identical pixels.
   Never call Math.random in layout or rendering. Use the seeded RNG module.
5. UNITS. Keep geometry in cap-height units (capital letter height = 1.0)
   until the final rasterization step. Never hard-code pixel values for jitter.
   Pixel amounts I quote are only examples at a typical size (cap height
   about 40 px).
6. NO UNVERIFIED CLAIMS. Do not write "works" unless you ran it and saw the
   result. If you cannot run a browser, say "not verified" for that item.
   Never invent function names, file names, or data fields. Read the code,
   then reference what exists. If the data you need is not in the profile
   JSON, stop and tell me instead of guessing.
7. EVERY PHASE LEAVES A VISIBLE TEST PAGE (debug.html or a debug panel) that
   renders a fixed specimen text with overlays and prints measured numbers.
   I judge the phase by looking at this page.
8. REPORT FORMAT at the end: (a) files changed, (b) each acceptance item with
   PASS / FAIL / NOT VERIFIED and the number you measured, (c) deviations from
   this spec and why, (d) noticed but not touched.