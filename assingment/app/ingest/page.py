"""Load + correct + discover rows for one photo (steps 1-2). Shared by print and pangram paths."""
import cv2, numpy as np, sys
from pathlib import Path
from geom import correct, ink_mask, warn
from rows import clean_mask, valley_rows, load_manifest, fail_rows

def level_by_components(bgr):
    """Rotate so sloped text lines are horizontal (slope from component centres)."""
    m, _ = clean_mask(ink_mask(bgr))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    ids = [i for i in range(1, n) if st[i][4] > 60]
    pts = np.array([cen[i] for i in ids])
    slope = np.polyfit(pts[:, 0], pts[:, 1], 1)[0]
    ang = float(np.degrees(np.arctan(slope)))
    h, w = bgr.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1)
    return cv2.warpAffine(bgr, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)), ang

def load_page(image, manifest):
    bgr = cv2.imread(str(image))
    if bgr is None: sys.exit(f"ERROR: cannot read {image}")
    warped, info = correct(bgr)
    if manifest.get("level"):
        warped, ang = level_by_components(warped); info["level_angle"] = ang
    mask, dropped = clean_mask(ink_mask(warped))
    mg = float(manifest.get("margin_frac", 0.02))                 # photo-edge shadows / page borders
    hh, ww = mask.shape; mask[:int(hh * mg)] = 0; mask[hh - int(hh * mg):] = 0
    return warped, mask, info, dropped

def discover(mask, manifest):
    bands = valley_rows(mask)
    rows = manifest["rows"]
    if len(bands) != len(rows): fail_rows(bands, len(rows))
    return bands

def expand(manifest, bands):
    """band index -> list of row definitions (a band may hold several touching text lines)."""
    out = []
    for i, b in enumerate(bands):
        d = manifest["rows"][str(i)]
        if d == "ignore" or (isinstance(d, dict) and d.get("content") == "ignore"): continue
        defs = d if isinstance(d, list) else [d]
        out.append((i, b, defs))
    return out

def split_band(mask, band, k):
    """k rows inside one band (known from manifest): 1-D k-means on component centre y."""
    y0, y1 = band
    sub = mask[y0:y1]
    n, lab, st, cen = cv2.connectedComponentsWithStats(sub, 8)
    ids = [i for i in range(1, n) if st[i][4] > 40]
    cy = np.array([cen[i][1] for i in ids]); cs = np.quantile(cy, (np.arange(k) + .5) / k)
    for _ in range(40):
        asg = np.argmin(np.abs(cy[:, None] - cs[None]), 1)
        cs = np.array([cy[asg == j].mean() if (asg == j).any() else cs[j] for j in range(k)])
    order = np.argsort(cs); rank = {o: r for r, o in enumerate(order)}
    masks = [np.zeros_like(mask) for _ in range(k)]
    for i, a in zip(ids, asg):
        masks[rank[a]][y0:y1][lab == i] = 255
    return masks
