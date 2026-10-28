// draw.js — Rasterize one laid-out page to a canvas: white paper, ink strokes
// for glyph items, a fallback font for missing characters. This is the final
// rasterization step, where cap units become pixels. Stroke ink goes through
// humanize.js first (shakes out spikes, slight bow on straight lines).
// Phase 3: glyph items whose layout gave them a cursive pick (item.cursive)
// also draw the chosen prefix/suffix/misc shapes — extras were extracted
// against exactly the drawn base variant (extra.base === item.sampleIndex)
// in that variant's frame, so they anchor at (item.x, item.y) like the base
// strokes, with no per-kind remap; 'bridge' items are drawn as their stored
// polyline WITHOUT humanize (they were already shaped by cursive/bridge.js,
// and a re-bow would move their pinned endpoints). Called by render.html.
// Randomness only via the seeded stream given in options.seed; no seed means
// glyphs are drawn exactly as stored.
//
// options.scale (S) rasterizes at S device pixels per page pixel: the canvas
// is widthPx*S x heightPx*S, cap units multiply by S and the ink width too.
// Below ~1px a canvas line only partly covers each pixel, and antialiasing
// blends the ink with the paper — thin ink ALSO looks lighter, not just
// thinner. Drawing at S >= 2 keeps every stroke at least ~2 solid device
// pixels; the CSS-sized <canvas> still displays at the old size.

import { capToPx } from './geometry.js';
import { humanizeStrokes } from './humanize.js';
import { FALLBACK_FAMILY } from './fallback.js';

// Fallback characters have no captured strokes: they are filled text, and
// fillText ignores lineWidth, so the ink-thickness control did nothing for
// them. Instead the char is rasterized once into a small sprite (fillText),
// then its alpha mask is fattened with an outline stroke or eroded by a hard
// alpha cut (bisected until the stroke-width proxy matches) so it honours the
// same ink width as the captured strokes — at the same scale S as everything
// else, so the erosion cut happens on solid device pixels and the char does
// not fade. Sprites are cached per char, font and requested width, since a
// page reuses the same missing chars many times.
const spriteCache = new Map();

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Longest solid run (alpha >= half) per row and per column; the smaller median
// is a rough stroke-width proxy: vertical stems read well horizontally,
// horizontal bars (like '-') vertically. Grows with fattening, shrinks with
// erosion, so the same proxy calibrates both directions.
function strokeProxy(d, w, h) {
  const solid = (x, y) => d[(y * w + x) * 4 + 3] >= 120;
  const medRun = (rows) => {
    if (!rows.length) return 0;
    rows.sort((a, b) => a - b);
    return rows[Math.floor(rows.length / 2)];
  };
  const rowRuns = [];
  for (let y = 0; y < h; y++) {
    let run = 0, best = 0;
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) { run++; if (run > best) best = run; } else run = 0;
    }
    if (best) rowRuns.push(best);
  }
  const colRuns = [];
  for (let x = 0; x < w; x++) {
    let run = 0, best = 0;
    for (let y = 0; y < h; y++) {
      if (solid(x, y)) { run++; if (run > best) best = run; } else run = 0;
    }
    if (best) colRuns.push(best);
  }
  return Math.min(medRun(rowRuns), medRun(colRuns)) || 1;
}

// Erode by cutting the alpha ramp at t on each side: v' = (v-t)/(1-2t). t is
// bisected until the proxy width matches (or 0.49, the usable limit).
function remapAlpha(d, w, h, t) {
  const out = new Uint8ClampedArray(d);
  const cut = (v) => Math.max(0, Math.min(255, ((v / 255 - t) / (1 - 2 * t)) * 255));
  for (let i = 3; i < out.length; i += 4) out[i] = cut(d[i]);
  return out;
}

function fallbackSprite(ch, font, fontPx, target, rgb, scale) {
  const key = `${ch}|${font}|${Math.round(target * 10)}|${rgb.join(',')}|${scale}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d');
  pctx.font = font;
  const m = pctx.measureText(ch);
  const bl = Math.ceil(m.actualBoundingBoxLeft ?? fontPx * 0.25);
  const br = Math.ceil(m.actualBoundingBoxRight ?? fontPx * 0.9);
  const asc = Math.ceil(m.actualBoundingBoxAscent ?? fontPx);
  const desc = Math.ceil(m.actualBoundingBoxDescent ?? fontPx * 0.35);
  const w = bl + br + 8;
  const h = asc + desc + 8;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.font = font;
  octx.textBaseline = 'alphabetic';
  const ox = bl + 4;  // pen origin of the char inside the sprite
  const oy = asc + 4; // its baseline
  octx.fillStyle = '#000';
  octx.fillText(ch, ox, oy);
  let data = octx.getImageData(0, 0, w, h).data;
  const proxy = strokeProxy(data, w, h);
  if (target > proxy) {
    // The font's own weight is thinner than requested: stroke the contour to
    // fatten it (the outline adds lineWidth/2 on each side).
    octx.lineWidth = target - proxy;
    octx.strokeStyle = '#000';
    octx.lineJoin = 'round';
    octx.strokeText(ch, ox, oy);
    data = octx.getImageData(0, 0, w, h).data;
  } else if (target < proxy) {
    // Thinner than the font: bisect the erosion cut until the proxy matches.
    let data2 = null;
    for (let lo = 0, hi = 0.49, k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      data2 = remapAlpha(data, w, h, mid);
      if (strokeProxy(data2, w, h) > target) lo = mid; else hi = mid;
    }
    data = data2;
  }
  // Colour the (possibly eroded) mask with the ink and stage it on the sprite.
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = rgb[0];
    out.data[i * 4 + 1] = rgb[1];
    out.data[i * 4 + 2] = rgb[2];
    out.data[i * 4 + 3] = data[i * 4 + 3];
  }
  octx.putImageData(out, 0, 0);
  const sprite = { canvas: off, ox, oy };
  spriteCache.set(key, sprite);
  return sprite;
}

export function drawPage(page, pageCfg, options = {}) {
  const S = Math.max(1, options.scale || 1);
  const capPx = pageCfg.capPx * S;
  const canvas = document.createElement('canvas');
  canvas.width = pageCfg.widthPx * S;
  canvas.height = pageCfg.heightPx * S;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = options.paper || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const ink = options.ink || '#243b63';
  const inkWidth = (options.inkWidth || 2.2) * S;
  const pageIndex = options.pageIndex ?? 0;
  const at = (x, y) => capToPx(x, y, 0, canvas.height, capPx);

  // `dx`/`dy` move relative polylines (a stored glyph or bridge, whose origin
  // is the pen position/baseline) onto the page.
  function strokePolylines(polylines, dx = 0, dy = 0) {
    for (const stroke of polylines) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      let p = at(stroke[0].x + dx, stroke[0].y + dy);
      ctx.moveTo(p.x, p.y);
      for (let j = 1; j < stroke.length; j++) {
        p = at(stroke[j].x + dx, stroke[j].y + dy);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  // Re-anchor an extracted extra to the drawn glyph. The extra was extracted
  // against exactly this base variant (extra.base === item.sampleIndex) in
  // the same cap-unit frame (left ink edge at the side bearing, baseline 0),
  // so its attach point is already a frame coordinate: add the item position
  // and nothing else. The old per-kind edge/proportional remap is gone — it
  // existed only to paper over one extra fitting many variants.
  function anchored(extra, item) {
    return extra.rel.map((p) => ({
      x: item.x + extra.attach.x + p.x,
      y: item.y + extra.attach.y + p.y,
    }));
  }

  for (let i = 0; i < page.items.length; i++) {
    const item = page.items[i];
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (item.kind === 'glyph') {
      const key = `${pageIndex}:${i}`;
      const strokes = options.seed === undefined
        ? item.sample.strokes
        : humanizeStrokes(item.sample.strokes, options.seed, key);
      strokePolylines(strokes, item.x, item.y);
      // Phase 3: the chosen cursive extras, treated like any other ink.
      const cv = item.cursive;
      if (cv) {
        for (const extra of [cv.prefix, cv.suffix, cv.misc].filter(Boolean)) {
          const shape = anchored(extra, item);
          const treated = options.seed === undefined
            ? shape
            : humanizeStrokes([shape], options.seed, `${key}:x${extra.kind}`)[0];
          strokePolylines([treated]);
        }
      }
    } else if (item.kind === 'strike') {
      // The scribble over a rewritten word: a single polyline stroke whose
      // points are already in absolute page x / baseline-relative y.
      strokePolylines([item.points], 0, item.y);
    } else if (item.kind === 'bridge') {
      // Bridge points are baseline-relative (like glyph strokes); their stored
      // x already contains the line's advance, so only y is offset. No humanize:
      // endpoints were pinned by bridge.js and must stay joined to neighbours.
      strokePolylines([item.points], 0, item.y);
    } else {
      const fontPx = Math.round(capPx * 1.3);
      const font = `italic ${fontPx}px ${FALLBACK_FAMILY}`;
      const rgb = hexToRgb(ink);
      const p = at(item.x, item.y);
      if (rgb) {
        const sp = fallbackSprite(item.ch, font, fontPx, inkWidth, rgb, S);
        ctx.drawImage(sp.canvas, Math.round(p.x) - sp.ox, Math.round(p.y) - sp.oy);
      } else {
        ctx.fillStyle = ink;
        ctx.font = font;
        ctx.fillText(item.ch, p.x, p.y);
      }
    }
    ctx.restore();
  }
  return canvas;
}
