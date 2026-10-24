// defaultprofile.js — Loads the bundled default handwriting profile
// (default-profile.json next to this app) wherever the app is hosted —
// a static host like Cloudflare Pages included — falling back to the
// prototype folder when developing with server.mjs. Returns the raw JSON
// object or null; callers decide how the shape is parsed/merged.
// Called by index.html, debug.html and render.html. No DOM.

const URLS = [
  'default-profile.json',                  // deployed: the profile ships in app/
  '../prototype/handwriting_font.json',    // dev (node server.mjs): the original
  'prototype/handwriting_font.json',       // an assignment-root deployment
];

export async function fetchDefaultProfile() {
  for (const url of URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* next candidate */ }
  }
  return null;
}
