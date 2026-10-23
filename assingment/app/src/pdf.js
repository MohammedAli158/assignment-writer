// pdf.js — Turn rendered page canvases into a PDF (A4 by default), one
// embedded PNG image per page, using the vendored pdf-lib. Called by
// render.html. No randomness.

import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';

export const A4_PT = [595.28, 841.89];

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// canvases: HTMLCanvasElement[] -> Uint8Array of PDF bytes.
export async function pagesToPdf(canvases, pageSizePt = A4_PT) {
  const doc = await PDFDocument.create();
  for (const canvas of canvases) {
    const png = await doc.embedPng(dataUrlToBytes(canvas.toDataURL('image/png')));
    const page = doc.addPage(pageSizePt);
    page.drawImage(png, { x: 0, y: 0, width: pageSizePt[0], height: pageSizePt[1] });
  }
  return doc.save();
}
