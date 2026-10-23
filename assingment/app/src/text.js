// text.js — Split raw text into paragraphs and words. Wrapping (which needs
// advance widths) is done in layout.js. Called by layout.js. No DOM.

export function splitParagraphs(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n');
}

export function wordsOf(paragraph) {
  const trimmed = paragraph.trim();
  return trimmed.length ? trimmed.split(/\s+/) : [];
}
