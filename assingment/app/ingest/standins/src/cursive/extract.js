// STANDIN NEUTERED — see standins/README.txt. File only for offline syntax
// checking. extractExtras resides only in src/cursive/extract.js and returns
// an ARRAY of extras (kind on each record); this standin's old OBJECT shape
// was what masked the B1 indexing bug. Nothing here may re-mimic it, not
// even when ALLOW_STANDINS=1.
if (process.env.ALLOW_STANDINS !== '1')
  throw new Error('standins are forbidden for validation; run with --app pointing at the real src/');
throw new Error('standins carry no semantics (cursive/extract.js); run with --app against the real src/');
