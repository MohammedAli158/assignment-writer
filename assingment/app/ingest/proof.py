#!/usr/bin/env python3
"""python proof.py profile.json proof-sheet.png
Print glyphs with baseline / x-height / cap guides at the profile's metrics; cursive letters with extras colored
(grey body ink, green prefix, blue suffix, red misc; circle = attach point)."""
import json, sys, cv2, numpy as np
from pathlib import Path
S = 100                                   # px per cap unit
COL = {"prefix": (60, 170, 60), "suffix": (200, 90, 20), "misc": (40, 40, 220)}   # BGR

def cell(w, h, base, label):
    c = np.full((h, w, 3), 255, np.uint8); cv2.rectangle(c, (0, 0), (w - 1, h - 1), (225, 225, 225), 1)
    cv2.putText(c, label, (3, 12), cv2.FONT_HERSHEY_SIMPLEX, .4, (120, 120, 120), 1, cv2.LINE_AA)
    return c

def guides(c, base, M, w):
    for y, col in ((0, (0, 0, 200)), (M["xHeight"], (0, 150, 0)), (1.0, (200, 120, 0)), (M["ascender"], (180, 180, 180)), (-M["descender"], (180, 180, 180))):
        yy = int(base - y * S); cv2.line(c, (0, yy), (w, yy), col, 1)

def poly(c, pts, base, ox, col, th):
    p = np.array([[ox + q["x"] * S, base - q["y"] * S] for q in pts], np.int32)
    cv2.polylines(c, [p], False, col, th, cv2.LINE_AA)

def draw_sample(c, s, base, ox, col=(60, 60, 60), th=2):
    for st in s["strokes"]: poly(c, st, base, ox, col, th)

def grid(cells, cols, W, H):
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    img = np.full((len(rows) * H, cols * W, 3), 255, np.uint8)
    for r, row in enumerate(rows):
        for k, c in enumerate(row): img[r * H:(r + 1) * H, k * W:(k + 1) * W] = c
    return img

def main(pf, out):
    P = json.loads(Path(pf).read_text()); M = P["metrics"]
    W, H, base = 120, 190, 135
    pc = []
    for ch in sorted(P["glyphs"], key=lambda c: (c.isdigit() is False, c.isupper(), c)):
        for i, s in enumerate(P["glyphs"][ch]):
            c = cell(W, H, base, f"{ch}[{i}] adv {s['advance']:.2f}"); guides(c, base, M, W); draw_sample(c, s, base, 8); pc.append(c)
    CW = 240; cc = []
    for ch, arr in P["cursive"]["samples"].items():
        for i, s in enumerate(arr):
            c = cell(CW, H, base, f"{ch}[{i}] adv {s['advance']:.2f}"); guides(c, base, M, CW)
            ox = 60; cv2.line(c, (ox + int(0.08 * S), 14), (ox + int(0.08 * S), H), (230, 200, 200), 1)   # body edge (0.08)
            draw_sample(c, s, base, ox, (150, 150, 150), 2)
            for k in ("prefix", "suffix", "misc"):
                for e in P["cursive"]["extras"].get(ch, {}).get(k, []):
                    if e["from"] != i: continue
                    pts = [{"x": e["attach"]["x"] + q["x"], "y": e["attach"]["y"] + q["y"]} for q in e["rel"]]
                    poly(c, pts, base, ox, COL[k], 3)
                    cv2.circle(c, (int(ox + e["attach"]["x"] * S), int(base - e["attach"]["y"] * S)), 4, COL[k], 1, cv2.LINE_AA)
            cc.append(c)
    a = grid(pc, 13, W, H); b = grid(cc, 8, CW, H)
    Wd = max(a.shape[1], b.shape[1]); pad = lambda im: cv2.copyMakeBorder(im, 0, 0, 0, Wd - im.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255))
    title = lambda t: cv2.putText(np.full((30, Wd, 3), 255, np.uint8), t, (6, 21), cv2.FONT_HERSHEY_SIMPLEX, .6, (0, 0, 0), 1, cv2.LINE_AA)
    sheet = np.vstack([title("PRINT (red=baseline, green=xHeight, blue=cap 1.0, grey=ascender/descender)"), pad(a),
                       title("CURSIVE (grey body ink, green prefix, blue suffix, red misc, circle=attach, pink line = body edge 0.08)"), pad(b)])
    cv2.imwrite(out, sheet); print("wrote", out, sheet.shape)

if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
