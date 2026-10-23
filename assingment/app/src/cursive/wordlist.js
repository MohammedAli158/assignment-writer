// wordlist.js — The default cursive capture word list and the letter prompt
// order derived from it. Used by cursive.html (capture UI) and by
// src/cursive/store.js (coverage counting). Ali's locked choice: the pangram
// covers every letter; the common words give letters varied neighbours in the
// prompt contexts. Pure data; no DOM.

// The pangram first (defines the letter set), then common words.
export const CURSIVE_WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog',
  'and', 'of', 'to', 'in', 'is', 'for', 'it', 'than', 'when', 'them',
];

// Unique lowercase letters of the word list, in first-appearance order.
// This is exactly the letter set the cursive capture page prompts for.
export function cursiveLetters() {
  const seen = new Set();
  const out = [];
  for (const word of CURSIVE_WORDS) {
    for (const ch of word) {
      if (ch >= 'a' && ch <= 'z' && !seen.has(ch)) {
        seen.add(ch);
        out.push(ch);
      }
    }
  }
  return out;
}

// Up to `max` words from the list that contain `ch`, for prompt context
// ("write cursive b — as in 'brown', 'jumps'").
export function contextWords(ch, max = 3) {
  return CURSIVE_WORDS.filter((w) => w.includes(ch)).slice(0, max);
}
