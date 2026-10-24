#!/usr/bin/env python3
"""python tools/ingest/main.py <image> --manifest tools/ingest/manifest.json --out tools/ingest/raw.json"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rows import load_manifest
import geom

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("--manifest", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--cuts", help="cursive cuts.json (used verbatim)"); ap.add_argument("--rdp", type=float, default=0.008)
    ap.add_argument("--debug-dir", default=None)
    a = ap.parse_args()
    man = load_manifest(a.manifest); man['_dir'] = str(Path(a.manifest).resolve().parent); out = Path(a.out); dbg = Path(a.debug_dir) if a.debug_dir else out.parent / (out.stem + "_debug")
    if man["kind"] == "print":
        from printpath import run_print
        res = run_print(a.image, man, dbg, a.rdp)
    else:
        from cursivepath import run_cursive
        res = run_cursive(a.image, man, dbg, a.cuts, a.rdp)
    res["warnings"] = geom.WARNINGS
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res), encoding="utf-8")
    print(f"wrote {out} ({len(geom.WARNINGS)} warnings)")

if __name__ == "__main__": main()
