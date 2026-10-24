"""Steps 3-4 for print rows: groups -> traced strokes -> cap units (translation only)."""
import numpy as np, json, sys
from pathlib import Path
from page import *; from glyphs import *; from annotate import save_row_crop
from trace import trace_mask
from geom import warn

LOWER_DESC, UPPER_DESC = set("gjpqy"), set("GJQ")

def run_print(image, manifest, outdir, rdp_tol=0.008):
    warped, mask, info, dropped = load_page(image, manifest)
    print(f"geometry: {info}; page-edge/rule components removed: {dropped}")
    bands = discover(mask, manifest)
    rows_out, bad = [], False
    for bi, band, defs in expand(manifest, bands):
        masks = split_band(mask, band, len(defs)) if len(defs) > 1 else [None]
        for k, df in enumerate(defs):
            rm = masks[k]
            if rm is None: rm = np.zeros_like(mask); rm[band[0]:band[1]] = mask[band[0]:band[1]]
            lab, comps = components(rm); comps, nspeck = drop_specks(comps)
            groups = group_by_xoverlap(comps)
            shown = groups
            groups = apply_hints(groups, df.get("hints"))
            tag = f"{bi:02d}" + (f"_{k}" if len(defs) > 1 else "")
            ok = len(groups) == len(df["chars"])
            save_row_crop(Path(outdir) / "rows" / f"row_{tag}.png", warped, rm, shown, lab,
                          f"row {tag} {df['content']} expects '{df['chars']}' ({len(df['chars'])}) groups after hints: {len(groups)}")
            if not ok:
                bad = True
                print(f"ERROR row {tag}: expected {len(df['chars'])} glyphs ('{df['chars']}'), found {len(groups)}. See rows/row_{tag}.png; add hints (merge/drop by group index) to the manifest.")
            rows_out.append(dict(tag=tag, df=df, lab=lab, groups=groups, nspeck=nspeck))
    if bad: sys.exit(2)
    # global cap unit: trimmed median of uppercase glyph bbox heights
    boxes = {}
    for r in rows_out:
        for gi, g in enumerate(r["groups"]):
            gm, (x0, y0, x1, y1) = glyph_mask(r["lab"], g["ids"]); boxes[(r["tag"], gi)] = (gm, x0, y0, x1, y1)
    up_h = [boxes[(r["tag"], gi)][4] - boxes[(r["tag"], gi)][2] + 1 for r in rows_out if r["df"]["content"] == "upper" for gi in range(len(r["groups"]))]
    dg_h = [boxes[(r["tag"], gi)][4] - boxes[(r["tag"], gi)][2] + 1 for r in rows_out if r["df"]["content"].startswith("digits") for gi in range(len(r["groups"]))]
    cap = trimmed_median(up_h)
    report = dict(cap_px=cap, upper_min=min(up_h) / cap, upper_max=max(up_h) / cap, n_upper=len(up_h))
    if dg_h: report.update(digit_min=min(dg_h) / cap, digit_max=max(dg_h) / cap)
    print(f"cap unit = {cap:.1f} px (uppercase heights {report['upper_min']:.2f}..{report['upper_max']:.2f} cap units)")
    glyphs, seen, row_info = [], {}, []
    for r in rows_out:
        chars = r["df"]["chars"]; desc = LOWER_DESC if r["df"]["content"] == "lower" else UPPER_DESC if r["df"]["content"] == "upper" else set()
        bx = [(chars[gi], boxes[(r["tag"], gi)]) for gi in range(len(chars))]
        pts = [((b[1] + b[3]) / 2, b[4]) for c, b in bx if c not in desc]
        a, c0 = robust_line([p[0] for p in pts], [p[1] for p in pts])
        res = np.std([y - (a * x + c0) for x, y in pts]) / cap if len(pts) > 2 else 0
        row_info.append(dict(row=r["tag"], slope_deg=float(np.degrees(np.arctan(a))), resid_cap=float(res), n=len(pts), specks_dropped=r["nspeck"]))
        print(f"row {r['tag']}: baseline slope {np.degrees(np.arctan(a)):+.2f} deg, residual {res:.3f} cap, {r['nspeck']} specks dropped")
        if len(pts) < 3: warn(f"row {r['tag']}: only {len(pts)} baseline points; baseline is constant-offset")
        for gi, (ch, (gm, x0, y0, x1, y1)) in enumerate(bx):
            strokes = trace_mask(gm, cap, rdp_tol=rdp_tol)
            xc = (x0 + x1) / 2; by = a * xc + c0
            out = [[{"x": float((p[0]) / cap), "y": float((by - (p[1] + y0)) / cap)} for p in s] for s in strokes]
            # x: translation only (glyph-local left edge of the *centerline*; Node applies the 0.08 bearing)
            mn = min(pt["x"] for s in out for pt in s)
            for s in out:
                for pt in s: pt["x"] -= mn
            v = seen.get(ch, 0); seen[ch] = v + 1
            glyphs.append(dict(char=ch, variant=v, row=r["tag"], strokes=out,
                               meta=dict(bbox_px=[x0, y0, x1, y1], height_cap=(y1 - y0 + 1) / cap, n_strokes=len(out))))
    def stat(chars, f):
        v = [f(g["strokes"]) for g in glyphs if g["char"] in chars and g["strokes"]]
        return float(np.median(v)) if v else None
    top = lambda S: max(p["y"] for s in S for p in s); bot = lambda S: min(p["y"] for s in S for p in s)
    metrics = dict(capHeight=1, xHeight=stat("acemnorsuvwxz", top), ascender=stat("bdhkl", top),
                   descender=-stat("gjpqy", bot) if stat("gjpqy", bot) is not None else None, sideBearing=0.08)
    print("metrics (centerline, cap units):", metrics)
    return dict(kind="print", cap_px=cap, drift=report, rows=row_info, glyphs=glyphs, metrics=metrics, geometry=info)
