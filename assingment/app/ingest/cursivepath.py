"""Step 5 + cursive part of step 4: words -> letter cuts (DP over ligature troughs) -> samples in cap units."""
import numpy as np, cv2, json, sys
from pathlib import Path
from page import *; from glyphs import *; from annotate import save_row_crop
from trace import trace_mask
from skimage.morphology import skeletonize
from geom import warn

NODESC = set("abcdehiklmnorstuvwx")          # letters whose bottom sits on the baseline (cursive)

def width_prior(manifest, base):
    p = manifest.get("width_prior"); w = {}
    if p:
        f = Path(base) / p
        if f.exists():
            for g in json.loads(f.read_text())["glyphs"]:
                if g["char"].islower() and g["strokes"]:
                    xs = [pt["x"] for s in g["strokes"] for pt in s]; w.setdefault(g["char"], []).append(max(xs))
            return {c: float(np.median(v)) + 0.1 for c, v in w.items()}
        warn(f"width_prior file {f} not found; using uniform letter widths")
    return {}

def body_band(rowmask):
    pr = (rowmask > 0).sum(1).astype(float); pr = np.convolve(pr, np.ones(5) / 5, "same")
    hi = pr >= 0.5 * pr.max()
    best, cur = (0, 0), None
    for y, v in enumerate(hi):
        if v and cur is None: cur = y
        if (not v or y == len(hi) - 1) and cur is not None:
            e = y if not v else y + 1
            if e - cur > best[1] - best[0]: best = (cur, e)
            cur = None
    return best          # (top, bottom) of the x-height band (px)

def stroke_width(mask):
    sk = skeletonize(mask > 0)
    dt = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 3)
    return float(2 * np.median(dt[sk])) if sk.any() else 4.0

def words_of(rowmask, nwords):
    xs = np.nonzero((rowmask > 0).any(0))[0]
    iv, s = [], xs[0]
    for a, b in zip(xs[:-1], xs[1:]):
        if b - a > 1: iv.append([s, a]); s = b
    iv.append([s, xs[-1]])
    if len(iv) < nwords: return None, iv
    gaps = [iv[i + 1][0] - iv[i][1] for i in range(len(iv) - 1)]
    cut = sorted(np.argsort(gaps)[::-1][:nwords - 1])
    words, st = [], 0
    for c in cut: words.append([iv[st][0], iv[c][1]]); st = c + 1
    words.append([iv[st][0], iv[-1][1]])
    g = sorted(gaps, reverse=True)
    margin = (g[nwords - 2] / max(g[nwords - 1], 1)) if len(g) >= nwords else 99
    return words, margin

def dp_cuts(prof, x0, x1, widths, sw, minsep):
    """choose n-1 cut columns minimizing trough height + deviation from width-prior positions."""
    n = len(widths); tot = float(sum(widths))
    if n == 1: return [], []
    cum = np.cumsum(widths)[:-1] / tot
    exp = [x0 + (x1 - x0) * c for c in cum]; wbar = (x1 - x0) / n
    cands = []
    for k, e in enumerate(exp):
        lo, hi = int(max(x0 + minsep, e - .55 * wbar)), int(min(x1 - minsep, e + .55 * wbar))
        cands.append([(x, min(prof[x] / (2.2 * sw), 2.0) + 0.9 * ((x - e) / wbar) ** 2) for x in range(lo, hi + 1)])
    best = [dict((x, (c, None)) for x, c in cands[0])]
    for k in range(1, len(cands)):
        d = {}
        for x, c in cands[k]:
            opts = [(pc + c, px) for px, (pc, _) in best[-1].items() if x - px >= minsep]
            if opts: d[x] = min(opts)
        best.append(d)
    if not best[-1]: return None, None
    x = min(best[-1], key=lambda t: best[-1][t][0]); cuts = [x]
    for k in range(len(best) - 1, 0, -1):
        x = best[k][x][1]; cuts.append(x)
    cuts = cuts[::-1]
    conf = [float(np.clip(1.0 - (prof[c] / sw - 1.3) / 2.2, 0, 1)) for c in cuts]
    return cuts, conf

def clip_strokes(strokes, xa, xb):
    """pieces of polylines with xa <= x <= xb (exact interpolation at the cuts)."""
    out = []
    for s in strokes:
        cur = []
        for i in range(len(s)):
            p = s[i]
            inside = xa <= p[0] <= xb
            if i > 0:
                q = s[i - 1]; qi = xa <= q[0] <= xb
                if inside != qi:
                    for xc in (xa, xb):
                        if (q[0] - xc) * (p[0] - xc) < 0:
                            t = (xc - q[0]) / (p[0] - q[0]); pt = q + t * (p - q)
                            if inside: cur = [pt]
                            else: cur.append(pt); out.append(np.array(cur)); cur = []
            if inside: cur.append(p)
        if len(cur) >= 2: out.append(np.array(cur))
    return [o for o in out if len(o) >= 2 and np.hypot(*(o[-1] - o[0])) + 0 > 0]

def body_left(colprof, xs0, sw, xh):
    """left edge of the letter BODY: skip a thin entry flick (column ink ~ one stroke wide)."""
    thr = max(2.1 * sw, 0.30 * xh)
    ink = np.nonzero(colprof > 0)[0]
    if not len(ink): return xs0, 0.0
    first = ink[0]
    run = np.nonzero(colprof[first:] >= thr)[0]
    if not len(run): return xs0 + first, 0.0
    bl = first + run[0]
    flick = bl - first
    if flick < 0.18 * xh: return xs0 + first, 0.0      # no real flick: body starts at ink edge
    return xs0 + bl, float(flick)                      # threshold crossing ~ centerline of the first body stroke

def run_cursive(image, manifest, outdir, cuts_file, rdp_tol):
    warped, mask, info, dropped = load_page(image, manifest)
    print(f"geometry: {info}; removed components: {dropped}")
    bands = discover(mask, manifest)
    text = manifest["text"]; words = text.split(); letters_per = [list(w.lower()) for w in words]
    prior = width_prior(manifest, Path(manifest.get("_dir", ".")))
    cuts_over = json.loads(Path(cuts_file).read_text()) if cuts_file else {}
    rows = []
    for bi, band, defs in expand(manifest, bands):
        masks = split_band(mask, band, len(defs)) if len(defs) > 1 else [None]
        for k, df in enumerate(defs):
            rm = masks[k]
            if rm is None: rm = np.zeros_like(mask); rm[band[0]:band[1]] = mask[band[0]:band[1]]
            rows.append((df["content"], rm))
    # cap unit: first glyph 'T' of each line (height of the leftmost connected component of word 1)
    Th = []
    for name, rm in rows:
        ws, _ = words_of(rm, len(words))
        if ws is None: sys.exit(f"ERROR {name}: fewer than {len(words)} word clusters found")
        sub = rm.copy(); sub[:, ws[0][1] + 1:] = 0
        lab, comps = components(sub); comps, _ = drop_specks(comps)
        c0 = min(comps, key=lambda c: c["x"]); Th.append(c0["h"])
    cap = float(np.median(Th)); print(f"cap unit (cursive page) = {cap:.1f} px from T heights {Th}")
    samples, report, lowconf, allcuts = [], [], [], {}
    for ri, (name, rm) in enumerate(rows):
        ws, margin = words_of(rm, len(words))
        yt, yb = body_band(rm); xh = yb - yt; sw = stroke_width(rm)
        print(f"{name}: x-height band {xh}px, stroke {sw:.1f}px, word-gap margin x{margin:.2f}")
        annot_groups, vlines = [], []
        lab, comps = components(rm)
        for wi, (wx0, wx1) in enumerate(ws):
            wm = rm[:, wx0:wx1 + 1]
            ys_, _ = np.nonzero(wm)
            wy0, wy1 = ys_.min(), ys_.max()
            sub = wm[wy0:wy1 + 1]
            strokes = [s + [wx0, wy0] for s in trace_mask(sub, cap, rdp_tol=rdp_tol, prune=False)]
            lt = letters_per[wi]; n = len(lt)
            band_prof = (wm[max(0, int(yt - .25 * xh)):int(yb + .15 * xh)] > 0).sum(0).astype(float)
            prof = np.convolve(band_prof, np.ones(3) / 3, "same")
            wd = [prior.get(c, 0.6) for c in lt]
            cuts, conf = dp_cuts(prof, 0, wx1 - wx0, wd, sw, max(3, int(0.12 * cap)))
            if cuts is None: warn(f"{name} word '{words[wi]}': cut DP found no layout"); continue
            cuts = [wx0 + c for c in cuts]
            ov = cuts_over.get(name, {}).get(words[wi], [])
            for o in ov:
                if not (wx0 < o["x"] < wx1): sys.exit(f"ERROR cuts.json {name}/{words[wi]}: x={o['x']} outside word span {wx0}..{wx1}")
                cuts[o["after"]] = o["x"]; conf[o["after"]] = 1.0
            allcuts.setdefault(name, {})[words[wi]] = [{"after": j, "x": int(c), "conf": round(cf, 2)} for j, (c, cf) in enumerate(zip(cuts, conf))]
            for c, cf in zip(cuts, conf):
                vlines.append((c, (0, 160, 0) if cf >= 0.5 else (0, 0, 220)))
            for j, cf in enumerate(conf):
                if cf < 0.5: lowconf.append(f"{name} '{words[wi]}' cut after letter {j} ('{lt[j]}'|'{lt[j+1]}') confidence {cf:.2f}")
            edges = [wx0 - 2] + cuts + [wx1 + 2]
            for li, ch in enumerate(lt):
                if wi == 0 and li == 0: continue                      # capital T is not a lowercase sample
                pieces = clip_strokes(strokes, edges[li], edges[li + 1])
                length = sum(np.sum(np.hypot(*np.diff(p, axis=0).T)) for p in pieces)
                if length < 0.15 * cap: continue
                cl = conf[li - 1] if li > 0 else 1.0; cr = conf[li] if li < n - 1 else 1.0
                jx0, jx1 = int(max(edges[li], wx0)) - wx0, int(min(edges[li + 1], wx1)) - wx0
                cp = (wm[max(0, int(yt - .25 * xh)):int(yb + .15 * xh), jx0:jx1 + 1] > 0).sum(0).astype(float)
                bl, flick = body_left(cp, wx0 + jx0, sw, xh)
                samples.append(dict(char=ch, row=ri, word=words[wi], idx=li, pieces=pieces, conf=min(cl, cr),
                                    joined=(li > 0) + (li < n - 1), bodyleft_px=float(bl if flick > 0 else min(p[:, 0].min() for p in pieces)), flick_px=flick))
        save_row_crop(Path(outdir) / "rows" / f"row_{name}.png", warped, rm, [], lab, f"{name}: cuts green=confident, red=low confidence", vlines)
    # baselines per row (robust line through bottoms of non-descender letter bodies), then conversion
    out, covered, skipped = [], {}, []
    for ri, (name, rm) in enumerate(rows):
        S = [s for s in samples if s["row"] == ri]
        pts = [(np.mean([p[:, 0].mean() for p in s["pieces"]]), max(p[:, 1].max() for p in s["pieces"])) for s in S if s["char"] in NODESC]
        a, c0 = robust_line([p[0] for p in pts], [p[1] for p in pts])
        print(f"{name}: baseline slope {np.degrees(np.arctan(a)):+.2f} deg from {len(pts)} letters")
        for s in S:
            xc = float(np.mean([p[:, 0].mean() for p in s["pieces"]])); by = a * xc + c0
            strokes = [[{"x": float((pt[0] - s["bodyleft_px"]) / cap + 0.08), "y": float((by - pt[1]) / cap)} for pt in p] for p in s["pieces"]]
            s["strokes"] = strokes; s["overhang_cap"] = float(s["flick_px"] / cap)
            del s["pieces"]
        # plausibility: skip (never invent) samples whose cut produced a fragment
        keep = []
        for s_ in S:
            xs = [pt["x"] for st in s_["strokes"] for pt in st]; ys = [pt["y"] for st in s_["strokes"] for pt in st]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            pw = prior.get(s_["char"], 0.6) - 0.1
            why = None
            if h < 0.30: why = f"height {h:.2f} cap < 0.30"
            elif w < 0.45 * pw: why = f"width {w:.2f} < 45% of print width {pw:.2f}"
            elif w > 3.2 * pw + 0.5: why = f"width {w:.2f} implausibly wide vs print {pw:.2f}"
            if why: skipped.append(f"{name} '{s_['word']}'[{s_['idx']}] '{s_['char']}': {why}")
            else: keep.append(s_)
        S = keep
        # one sample per (letter,row): prefer joined (has entry/exit flicks), then highest confidence
        best = {}
        for s in S:
            key = s["char"]; sc = (s["joined"] > 0, s["conf"], s["joined"])
            if key not in best or sc > best[key][0]: best[key] = (sc, s)
        for ch, (sc, s) in best.items(): out.append(dict(char=ch, row=ri, **{k: v for k, v in s.items() if k not in ("char", "row")})); covered.setdefault(ch, []).append(ri)
    alpha = [c for c in "abcdefghijklmnopqrstuvwxyz"]
    missing = {c: [r for r in range(len(rows)) if r not in covered.get(c, [])] for c in alpha if len(covered.get(c, [])) < len(rows)}
    for c, r in missing.items(): warn(f"cursive '{c}' missing in pangram row(s) {r}")
    Path(outdir).mkdir(parents=True, exist_ok=True)
    (Path(outdir) / 'cuts.current.json').write_text(json.dumps(allcuts, indent=1))
    for k_ in skipped: print('skipped:', k_)
    for l in lowconf: warn("low-confidence ligature cut: " + l)
    return dict(kind="cursive", skipped=skipped, cap_px=cap, rows=[r[0] for r in rows], cursive=out, missing=missing, geometry=info)
