"""Row mask -> glyph groups (components merged by x-overlap, manifest hints applied)."""
import cv2, numpy as np

def components(rowmask, min_area=12):
    n, lab, st, cen = cv2.connectedComponentsWithStats(rowmask, 8)
    comps = [dict(id=i, x=int(st[i][0]), y=int(st[i][1]), w=int(st[i][2]), h=int(st[i][3]), a=int(st[i][4])) for i in range(1, n) if st[i][4] >= min_area]
    return lab, comps

def drop_specks(comps, frac=0.03):
    if not comps: return comps, 0
    big = [c["a"] for c in comps if c["a"] > 40] or [c["a"] for c in comps]
    med = float(np.median(big))
    keep = [c for c in comps if c["a"] >= frac * med]
    return keep, len(comps) - len(keep)

def group_by_xoverlap(comps, tol_frac=0.12):
    """merge fragments of one cell (i/j dots, broken strokes): a small component whose x-centre lies
    inside another's x-span (+ tolerance) belongs to that cell."""
    if not comps: return []
    tol = tol_frac * float(np.median([c["h"] for c in comps]))
    comps = sorted(comps, key=lambda c: -c["a"])           # big bodies seed groups, small fragments attach
    groups = []
    for c in comps:
        cx = c["x"] + c["w"] / 2
        best = None
        for g in groups:
            if g["x0"] - tol <= cx <= g["x1"] + tol and c["a"] < 0.6 * g["a"]:
                d = abs(cx - (g["x0"] + g["x1"]) / 2)
                if best is None or d < best[0]: best = (d, g)
        if best:
            g = best[1]; g["ids"].append(c["id"]); g["x0"] = min(g["x0"], c["x"]); g["x1"] = max(g["x1"], c["x"] + c["w"])
        else: groups.append(dict(ids=[c["id"]], x0=c["x"], x1=c["x"] + c["w"], a=c["a"]))
    # stray small marks (offset i/j dots): attach to the nearest cell if clearly dot-sized and close
    areas = [g["a"] for g in groups]; med = float(np.median(areas)) if areas else 0
    for g in [g for g in groups if g["a"] < 0.12 * med]:
        others = [o for o in groups if o is not g]
        if not others: continue
        gc = (g["x0"] + g["x1"]) / 2
        o = min(others, key=lambda o: 0 if o["x0"] <= gc <= o["x1"] else min(abs(gc - o["x0"]), abs(gc - o["x1"])))
        dist = 0 if o["x0"] <= gc <= o["x1"] else min(abs(gc - o["x0"]), abs(gc - o["x1"]))
        if dist < 4 * tol:
            o["ids"] += g["ids"]; o["x0"] = min(o["x0"], g["x0"]); o["x1"] = max(o["x1"], g["x1"]); groups.remove(g)
    groups.sort(key=lambda g: g["x0"])
    return groups

def apply_hints(groups, hints):
    """hints: {"merge":[[i,j],...], "drop":[i,...]} on group indices as shown in row_NN.png."""
    if not hints: return groups
    drop = set(hints.get("drop", []))
    merged = {}
    for a, b in hints.get("merge", []): merged[b] = a
    out = {}
    for i, g in enumerate(groups):
        if i in drop: continue
        t = i
        while t in merged: t = merged[t]
        if t in out:
            o = out[t]; o["ids"] += g["ids"]; o["x0"] = min(o["x0"], g["x0"]); o["x1"] = max(o["x1"], g["x1"])
        else: out[t] = dict(ids=list(g["ids"]), x0=g["x0"], x1=g["x1"])
    return [out[k] for k in sorted(out)]

def glyph_mask(lab, ids, pad=0):
    m = np.isin(lab, ids).astype(np.uint8) * 255
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    return m[y0:y1 + 1, x0:x1 + 1], (int(x0), int(y0), int(x1), int(y1))

def robust_line(xs, ys, iters=4):
    """y = a*x + c, trimmed-LS (drops outliers such as descender bottoms)."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    if len(xs) < 3 or np.ptp(xs) < 1: return 0.0, float(np.median(ys))
    keep = np.ones(len(xs), bool)
    for _ in range(iters):
        a, c = np.polyfit(xs[keep], ys[keep], 1)
        r = np.abs(ys - (a * xs + c)); s = max(1.5, 1.5 * np.median(r[keep]))
        nk = r <= s
        if nk.sum() < 3: break
        keep = nk
    return float(a), float(c)

def trimmed_median(v, lo=.2, hi=.8):
    v = np.sort(np.asarray(v, float)); n = len(v)
    s = v[int(n * lo):max(int(n * hi), int(n * lo) + 1)]
    return float(np.median(s))
