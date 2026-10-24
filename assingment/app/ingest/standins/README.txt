STAND-INS ARE NEUTERED. NOT APP CODE.
The four diverging modules that used to live here (advance.js normalizeToBaseline,
cursive/extract.js extractExtras, glyphstore.js, geometry.js) have been reduced
to chunks that THROW on import. They exist ONLY for offline syntax checking
(node --check). They can never validate semantics again: their old shapes
(kind-keyed extractExtras OBJECT, normalizeToBaseline that set source/
metricsEstimated itself) are exactly what masked the B1/B2 adapter bugs while
the smoke test kept passing.

Feed them nothing and import them in nothing. Any profile.json presented as
final MUST come from a run with --app pointing at the real src/:

    node build-profile.mjs --print raw-print.json --cursive raw-pangram.json \
        --out profile.json --app ../../app

Even with ALLOW_STANDINS=1 the chunks throw: they carry zero behavior.
