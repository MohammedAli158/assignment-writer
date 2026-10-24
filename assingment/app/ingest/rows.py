"""Step 2: row discovery + manifest handling."""
import cv2, numpy as np, json, sys
from pathlib import Path

def clean_mask(m):
    """Drop page-edge lines / ruled lines (long thin components or margin-hugging slivers)."""
    H, W = m.shape
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    out = np.zeros_like(m); dropped = 0
    for i in range(1, n):
        x, y, w, h, a = st[i]
        long_thin = (w > 0.25 * W and h < 0.04 * H) or (h > 0.25 * H and w < 0.04 * W)
        near_edge = x < 0.035 * W or x + w > 0.965 * W or y < 0.035 * H or y + h > 0.965 * H
        sliver = near_edge and (max(w, h) / max(1, min(w, h)) > 5) and max(w, h) > 0.02 * max(H, W)
        dash = w >= 25 and h <= 8 and w / max(h, 1) >= 6          # ruled-line fragments / page-edge dashes
        if long_thin or sliver or dash or a < 12: dropped += 1; continue
        out[lab == i] = 255
    return out, dropped

def valley_rows(m, min_gap=6):
    pr = (m > 0).sum(1).astype(float)
    pr = np.convolve(pr, np.ones(5) / 5, "same")
    thr = max(1.0, 0.01 * pr.max())
    rows, start = [], None
    for y, v in enumerate(pr):
        if v > thr and start is None: start = y
        if v <= thr and start is not None:
            rows.append([start, y]); start = None
    if start is not None: rows.append([start, len(pr)])
    merged = []
    for r in rows:
        if merged and r[0] - merged[-1][1] < min_gap: merged[-1][1] = r[1]
        else: merged.append(r)
    return [r for r in merged if r[1] - r[0] > 12]

def slanted_rows(m, k):
    """For touching/overlapping sloped lines: fit k lines to component centres (known k from manifest)."""
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    pts = np.array([cen[i] for i in range(1, n) if st[i][4] > 60])
    ids = [i for i in range(1, n) if st[i][4] > 60]
    # global slope from median regression on x vs y, then cluster residual y by k-means 1D
    A = np.c_[pts[:, 0], np.ones(len(pts))]
    slope = np.polyfit(pts[:, 0], pts[:, 1], 1)[0]
    res = pts[:, 1] - slope * pts[:, 0]
    cs = np.quantile(res, (np.arange(k) + .5) / k)
    for _ in range(30):
        asg = np.argmin(np.abs(res[:, None] - cs[None]), 1)
        cs = np.array([res[asg == j].mean() if (asg == j).any() else cs[j] for j in range(k)])
    order = np.argsort(cs)
    rank = {o: r for r, o in enumerate(order)}
    rowmask = [np.zeros_like(m) for _ in range(k)]
    for idx, a in zip(ids, asg): rowmask[rank[a]][lab == idx] = 255
    return rowmask, slope

def load_manifest(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))

def fail_rows(found, expected, extra=""):
    print("ERROR: manifest row count mismatch.\n  discovered rows (y0..y1):")
    for i, r in enumerate(found): print(f"   {i}: {r[0]}..{r[1]}")
    print(f"  manifest declares {expected} rows. Edit manifest.json and rerun. {extra}")
    sys.exit(2)
