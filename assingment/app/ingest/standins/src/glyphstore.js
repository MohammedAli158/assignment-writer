// STANDIN NEUTERED — see standins/README.txt. File only for offline syntax
// checking; createStore/addSample reside only in src/glyphstore.js.
if (process.env.ALLOW_STANDINS !== '1')
  throw new Error('standins are forbidden for validation; run with --app pointing at the real src/');
throw new Error('standins carry no semantics (glyphstore.js); run with --app against the real src/');
