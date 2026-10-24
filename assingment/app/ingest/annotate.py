import cv2, numpy as np
from pathlib import Path

def save_row_crop(path, warped, rowmask, groups, lab, label, extra_vlines=()):
    ys, xs = np.nonzero(rowmask)
    if not len(xs): return
    y0, y1 = max(0, ys.min() - 25), min(rowmask.shape[0], ys.max() + 25)
    crop = warped[y0:y1].copy()
    ink = rowmask[y0:y1] > 0
    crop[~ink & (crop.mean(2) < 200)] = (235, 235, 235)       # grey out ink that belongs to other rows
    H, W = crop.shape[:2]
    for i, g in enumerate(groups):
        m = np.isin(lab[y0:y1], g["ids"]); yy, xx = np.nonzero(m)
        if not len(xx): continue
        cv2.rectangle(crop, (xx.min() - 2, yy.min() - 2), (xx.max() + 2, yy.max() + 2), (0, 140, 0), 1)
        cv2.putText(crop, str(i), (xx.min(), max(12, yy.min() - 5)), cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 0, 220), 1, cv2.LINE_AA)
    for x in range(0, W, 50):
        cv2.line(crop, (x, H - 8), (x, H), (120, 120, 120), 1)
        if x % 100 == 0: cv2.putText(crop, str(x), (x + 2, H - 10), cv2.FONT_HERSHEY_SIMPLEX, .35, (90, 90, 90), 1)
    for x, c in extra_vlines: cv2.line(crop, (int(x), 0), (int(x), H), c, 1)
    cv2.putText(crop, label, (4, 14), cv2.FONT_HERSHEY_SIMPLEX, .45, (200, 0, 0), 1, cv2.LINE_AA)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), crop)
