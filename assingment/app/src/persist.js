// persist.js — Save/load the glyph store in localStorage so the capture page
// and the render page share one profile. Called by index.html and render.html.
// Storage failures (private mode, quota) are ignored, never thrown.

import { serialize, deserialize } from './glyphstore.js';

const KEY = 'handwrite.store.v1';

export function saveStore(store) {
  try { localStorage.setItem(KEY, serialize(store)); } catch { /* storage unavailable */ }
}

export function loadStore() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

export function clearStore() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
