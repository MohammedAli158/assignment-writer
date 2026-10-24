// pairs.js — Ali's pair join rules (readme section 6.5): which adjacent letter
// pairs join. Joining is pair-based, lowercase-only, and there is exactly ONE
// join mechanism (the first letter's suffix merges into the second's prefix —
// built by bridge.js); this table only decides WHETHER a pair joins, never
// how. Ali extends this file directly; the rest of the cursive code never
// re-implements the mechanism per pair.
// Called by src/cursive/choose.js (chooseForPair). No importers elsewhere.

// Specific pairs that join (each pair also holds reversed — Ali: "whatever
// pairs I'm writing, the reverse is also considered" — so both ways are used).
const EXPLICIT = ['gn', 'ng', 'ar', 'ra', 're', 'er', 'ye', 'ey'];

// Letters that join with any lowercase neighbour, on either side. Ali's list:
// "*y and y*" (y always joins), "g*, *g", "p*, *p", "q*, *q", and "b*, t*, l*,
// d*" — where these letters pass their stroke on to whatever follows, and the
// same "reverses also considered" rule gives their *-side joins ("ll", "rd",
// "bl", ... all join).
const SOCIAL = 'ygpqbtld';

// Pairs that NEVER join, overriding everything above. Ali: two d's in a row
// are the same shape written twice with minimal, subtle variation — not a
// merge (the repeat look comes from choosing among the stored variants).
const NEVER = ['dd'];

const isLower = (ch) => ch >= 'a' && ch <= 'z';

// Do these two adjacent characters join? Anything that is not a lowercase
// letter (capitals, digits, punctuation, fallback chars) never joins.
export function joinablePair(left, right) {
  if (!isLower(left) || !isLower(right)) return false;
  const pair = left + right;
  if (NEVER.includes(pair)) return false;
  if (EXPLICIT.includes(pair)) return true;
  return SOCIAL.includes(left) || SOCIAL.includes(right);
}
