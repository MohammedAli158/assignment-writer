// STANDIN NEUTERED — see standins/README.txt. This file is kept on disk ONLY
// so offline syntax checks (node --check) still see a file. It implements
// NOTHING: normalizeToBaseline resides only in src/advance.js, and nothing
// here may ever re-mimic its semantics behind an env-set trick.
if (process.env.ALLOW_STANDINS !== '1')
  throw new Error('standins are forbidden for validation; run with --app pointing at the real src/');
throw new Error('standins carry no semantics (advance.js); run build-profile.mjs with --app against the real src/');
