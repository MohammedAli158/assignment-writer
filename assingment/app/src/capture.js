// capture.js — Pointer capture on the guide-line canvas.
// Draws the four guide lines and the live ink, records raw strokes (points
// with time and pressure) in canvas pixels, and on save() returns a store
// sample converted to cap units. Used by index.html. Points are stored raw:
// no smoothing is applied (Ali's choice).

import { PX_PER_CAP, DEFAULT_GUIDES, pxToCap } from './geometry.js';
import { normalizeToBaseline } from './advance.js';

const CANVAS_W = 1000;
const CANVAS_H = 360;
const MARGIN_X = 60; // left ink margin, px
const TOP_PAD = 40;  // gap above the ascender guide, px
const INK = '#17243b';

export function createCapture(canvas, options = {}) {
  const guides = { ...DEFAULT_GUIDES, ...(options.guides || {}) };
  const pxPerCap = options.pxPerCap || PX_PER_CAP;
  const sideBearing = options.sideBearing ?? 0.08;

  const ctx = canvas.getContext('2d');
  const baselineY = TOP_PAD + guides.ascender * pxPerCap;
  let strokes = [];      // array of arrays of {x,y,t,pressure} in pixels
  let drawing = false;
  let last = null;

  const toCap = pxToCap(MARGIN_X, baselineY, pxPerCap);

  function guideLine(y, color, dash, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y);
    ctx.lineTo(CANVAS_W - MARGIN_X, y);
    ctx.stroke();
    ctx.restore();
  }

  function drawGuides() {
    guideLine(baselineY, '#243b63', [], 2.5);
    guideLine(baselineY - guides.xHeight * pxPerCap, '#7fb0e0', [6, 6], 1.5);
    guideLine(baselineY - guides.ascender * pxPerCap, '#c0cdda', [4, 6], 1.5);
    guideLine(baselineY + Math.abs(guides.descender) * pxPerCap, '#e6b3b3', [4, 6], 1.5);
  }

  function clearInk() {
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawGuides();
  }

  function drawSegment(a, b) {
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    clearInk();
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.length; i++) drawSegment(stroke[i - 1], stroke[i]);
    }
  }

  function pointFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (CANVAS_W / r.width),
      y: (e.clientY - r.top) * (CANVAS_H / r.height),
      t: e.timeStamp,
      pressure: typeof e.pressure === 'number' && e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  function onDown(e) {
    e.preventDefault();
    drawing = true;
    last = pointFromEvent(e);
    strokes.push([last]);
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1.0) return;
    drawSegment(last, p);
    strokes[strokes.length - 1].push(p);
    last = p;
  }

  function onUp(e) {
    if (!drawing) return;
    drawing = false;
    last = null;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onUp);

  clearInk();

  return {
    setChar() { strokes = []; clearInk(); },
    undo() { strokes.pop(); redraw(); },
    clear() { strokes = []; clearInk(); },
    isEmpty() { return strokes.length === 0; },
    redraw,
    // Convert raw pixels to cap units and hand back a store sample.
    save() {
      if (!strokes.length) return null;
      const capStrokes = strokes.map((stroke) => stroke.map(toCap));
      const norm = normalizeToBaseline(capStrokes, sideBearing);
      if (!norm) return null;
      strokes = [];
      clearInk();
      return {
        strokes: norm.strokes,
        bounds: norm.bounds,
        advance: norm.advance,
        baseline: norm.baseline,
        source: 'capture',
        metricsEstimated: false,
      };
    },
  };
}
