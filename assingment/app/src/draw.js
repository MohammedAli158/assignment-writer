// draw.js — Rasterize one laid-out page to a canvas: white paper, ink strokes
// for glyph items, a fallback font for missing characters. This is the final
// rasterization step, where cap units become pixels. Stroke ink goes through
// humanize.js first (shakes out spikes, slight bow on straight lines).
// Phase 3: glyph items whose layout gave them a cursive pick (item.cursive)
// also draw the chosen prefix/suffix/misc shapes, re-anchored to the chosen
// base variant's ink edges; 'bridge' items are drawn as their stored polyline
// WITHOUT humanize (they were already shaped by cursive/bridge.js, and a
// re-bow would move their pinned endpoints). Called by render.html.
// Randomness only via the seeded stream given in options.seed; no seed means
// glyphs are drawn exactly as stored.

import { capToPx } from './geometry.js';
import { humanizeStrokes } from './humanize.js';
import { FALLBACK_FAMILY } from './fallback.js';

export function drawPage(page, pageCfg, options = {}) {
  const capPx = pageCfg.capPx;
  const canvas = document.createElement('canvas');
  canvas.width = pageCfg.widthPx;
  canvas.height = pageCfg.heightPx;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = options.paper || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const ink = options.ink || '#243b63';
  const pageIndex = options.pageIndex ?? 0;
  const at = (x, y) => capToPx(x, y, 0, canvas.height, capPx);

  function strokePolylines(polylines) {
    for (const stroke of polylines) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      let p = at(stroke[0].x, stroke[0].y);
      ctx.moveTo(p.x, p.y);
      for (let j = 1; j < stroke.length; j++) {
        p = at(stroke[j].x, stroke[j].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  // Re-anchor an extracted extra to the drawn glyph: prefixes anchor on the
  // variant's left ink edge, suffixes on its right ink edge, misc on its
  // proportional position within the body width. attach.y needs no remap —
  // both frames sit on the same baseline.
  function anchored(extra, item) {
    const sample = item.sample;
    let anchorX;
    if (extra.kind === 'prefix') anchorX = item.x + sample.bounds.left;
    else if (extra.kind === 'suffix') anchorX = item.x + sample.bounds.right;
    else anchorX = item.x + sample.bounds.left + (extra.attach.x - extra.ref.left);
    const anchorY = item.y + extra.attach.y;
    return extra.rel.map((p) => ({ x: anchorX + p.x, y: anchorY + p.y }));
  }

  for (let i = 0; i < page.items.length; i++) {
    const item = page.items[i];
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = options.inkWidth || 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (item.kind === 'glyph') {
      const key = `${pageIndex}:${i}`;
      const strokes = options.seed === undefined
        ? item.sample.strokes
        : humanizeStrokes(item.sample.strokes, options.seed, key);
      strokePolylines(strokes);
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
    } else if (item.kind === 'bridge') {
      strokePolylines([item.points]); // already bowed; endpoints must stay put
    } else {
      ctx.fillStyle = ink;
      ctx.font = `italic ${Math.round(capPx * 1.3)}px ${FALLBACK_FAMILY}`;
      const p = at(item.x, item.y);
      ctx.fillText(item.ch, p.x, p.y);
    }
    ctx.restore();
  }
  return canvas;
}
