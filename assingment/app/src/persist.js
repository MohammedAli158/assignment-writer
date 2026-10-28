// persist.js — Save/load the glyph store in localStorage so the capture page
// and the render page share one profile. Called by index.html and render.html.
// Storage failures (private mode, quota) are ignored, never thrown.

import { serialize, deserialize } from './glyphstore.js';
import { CURSIVE_VERSION } from './cursive/store.js';

const KEY = 'handwrite.store.v1';

export function saveStore(store) {
  try { localStorage.setItem(KEY, serialize(store)); } catch { /* storage unavailable */ }
}

export function loadStore() {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const store = deserialize(text);
    // Cursive data from before the per-variant base model (no version, or
    // v1's union-envelope extras) cannot be tied to a variant and rendered
    // as random strokes — drop the section, keep the print glyphs. Re-import
    // or re-capture writes a fresh CURSIVE_VERSION section.
    if (store.cursive && store.cursive.version !== CURSIVE_VERSION) delete store.cursive;
    return store;
  } catch {
    return null;
  }
}

export function clearStore() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
