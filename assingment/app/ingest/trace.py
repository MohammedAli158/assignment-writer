"""Step 3: skeleton -> ordered polylines (graph tracing, spur pruning, tangent pairing, RDP)."""
import numpy as np, cv2
from skimage.morphology import skeletonize

N8 = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]

def _nbrs(p, pts):
    return [(p[0]+dy, p[1]+dx) for dy, dx in N8 if (p[0]+dy, p[1]+dx) in pts]

def _plen(path):
    a = np.asarray(path, float)
    return float(np.sum(np.hypot(*np.diff(a, axis=0).T))) if len(a) > 1 else 0.0

def build_graph(skel):
    pts = set(zip(*np.nonzero(skel)))
    deg = {p: len(_nbrs(p, pts)) for p in pts}
    # cluster junction pixels (deg>=3) 8-adjacent into nodes; endpoints (deg==1) are own nodes
    node_of, nodes = {}, []
    for p in pts:
        if deg[p] >= 3 and p not in node_of:
            comp, st = [], [p]; node_of[p] = len(nodes)
            while st:
                q = st.pop(); comp.append(q)
                for r in _nbrs(q, pts):
                    if deg[r] >= 3 and r not in node_of: node_of[r] = len(nodes); st.append(r)
            nodes.append(comp)
    for p in pts:
        if deg[p] == 1: node_of[p] = len(nodes); nodes.append([p])
    seen, edges, direct = set(), [], set()
    npos = [np.mean(c, axis=0) for c in nodes]
    for ni, comp in enumerate(nodes):
        for p in comp:
            for q in _nbrs(p, pts):
                if node_of.get(q) == ni: continue
                if q in node_of:                      # node-node adjacency
                    k = (min(ni, node_of[q]), max(ni, node_of[q]))
                    if k in direct: continue
                    direct.add(k); edges.append([ni, node_of[q], [npos[ni], npos[node_of[q]]]]); continue
                if q in seen: continue                # interior already walked from the other side
                path, prev, cur = [q], p, q; seen.add(q)
                while True:
                    nx = [r for r in _nbrs(cur, pts) if r != prev and r not in path[-2:]]
                    hit = [r for r in nx if r in node_of and node_of[r] != node_of.get(prev, -1)] or [r for r in nx if r in node_of]
                    if hit: cur = hit[0]; break
                    nx = [r for r in nx if r not in seen]
                    if not nx: cur = None; break
                    prev, cur = cur, nx[0]; path.append(cur); seen.add(cur)
                nj = node_of.get(cur, ni) if cur is not None else ni
                edges.append([ni, nj, [npos[ni]] + [np.array(x, float) for x in path] + [npos[nj]]])
    uniq = edges
    # isolated cycles (no node): pixels not seen and not nodes
    rest = [p for p in pts if p not in seen and p not in node_of]
    loops = []
    rs = set(rest)
    while rs:
        s = next(iter(rs)); path, prev, cur = [s], None, s; rs.discard(s)
        while True:
            nx = [r for r in _nbrs(cur, pts) if r in rs]
            if not nx: break
            cur = nx[0]; rs.discard(cur); path.append(cur)
        if len(path) > 6: loops.append([np.array(x, float) for x in path + [path[0]]])
    return uniq, loops, npos

def prune_spurs(edges, thr):
    """Terminal branches (one end deg-1, other end a junction) shorter than thr are removed."""
    changed = True
    while changed:
        changed = False
        deg = {}
        for a, b, _ in edges: deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
        for e in list(edges):
            a, b, path = e
            if (deg[a] == 1) != (deg[b] == 1) and max(deg[a], deg[b]) >= 3 and _plen(path) < thr:
                edges.remove(e); changed = True; break
    return edges

def contract_junctions(edges, thr):
    """Short edges between two junctions are crossing artefacts: merge both nodes into one."""
    while True:
        deg = {}
        for a, b, _ in edges: deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
        hit = None
        for e in edges:
            a, b, path = e
            if a != b and deg[a] >= 3 and deg[b] >= 3 and _plen(path) < thr: hit = e; break
        if hit is None: return edges
        a, b, path = hit
        pos = (np.asarray(path[0]) + np.asarray(path[-1])) / 2
        edges.remove(hit)
        for e in edges:
            for end in (0, 1):
                if e[end] == b:
                    e[end] = a
                    if end == 0: e[2][0] = pos
                    else: e[2][-1] = pos
            if e[0] == a: e[2][0] = pos
            if e[1] == a: e[2][-1] = pos

def _dir(path, atstart, k=8):
    a = np.asarray(path if atstart else path[::-1], float)
    j = min(len(a) - 1, k)
    v = a[j] - a[0]; n = np.linalg.norm(v)
    return v / n if n else v

def edges_to_strokes(edges, loops):
    """Pair edge ends at each node by tangent continuity; chain into strokes."""
    at = {}
    for i, (a, b, _) in enumerate(edges): at.setdefault(a, []).append((i, 0)); at.setdefault(b, []).append((i, 1))
    pair = {}
    for n, ends in at.items():
        if len(ends) < 2: continue
        cand = []
        for x in range(len(ends)):
            for y in range(x + 1, len(ends)):
                (i, ei), (j, ej) = ends[x], ends[y]
                if i == j: continue
                d1 = _dir(edges[i][2], ei == 0); d2 = _dir(edges[j][2], ej == 0)
                ang = np.degrees(np.arccos(np.clip(np.dot(d1, d2), -1, 1)))  # 180 = perfectly straight through
                cand.append((180 - ang, ends[x], ends[y]))
        used = set()
        for turn, e1, e2 in sorted(cand, key=lambda c: c[0]):
            if len(ends) > 2 and turn > 55: break   # sharp angle -> separate stroke
            if e1 in used or e2 in used: continue
            used |= {e1, e2}; pair[e1] = e2; pair[e2] = e1
    visited, strokes = set(), []
    def walk(i, ei):
        out = []
        while i not in visited:
            visited.add(i)
            p = edges[i][2]; seq = p if ei == 0 else p[::-1]
            out.extend(seq if not out else seq[1:])
            nxt = pair.get((i, 1 - ei))
            if not nxt: break
            i, ei = nxt
        return out
    for i in range(len(edges)):
        for ei in (0, 1):
            if i not in visited and (i, ei) not in pair: strokes.append(walk(i, ei))
    for i in range(len(edges)):
        if i not in visited: strokes.append(walk(i, 0))
    strokes += loops
    return strokes

def smooth(pts, w=5):
    a = np.asarray(pts, float)
    if len(a) < w + 2: return a
    k = np.ones(w) / w; h = w // 2
    pad = np.r_[a[:1].repeat(h, 0), a, a[-1:].repeat(h, 0)]
    s = np.stack([np.convolve(pad[:, c], k, "valid") for c in range(2)], 1)
    s[0], s[-1] = a[0], a[-1]
    return s

def rdp(pts, eps):
    a = np.asarray(pts, np.float32).reshape(-1, 1, 2)
    return cv2.approxPolyDP(a, eps, False).reshape(-1, 2).astype(float)

def trace_mask(mask, cap_px, rdp_tol=0.008, spur=0.03, prune=True):
    """mask: uint8 crop of ONE glyph (0/255). Returns list of strokes, each Nx2 array of (x,y) px (y down, crop coords)."""
    ys, xs = np.nonzero(mask)
    pad = 3
    m = np.pad(mask > 0, pad)
    skel = skeletonize(m)
    if skel.sum() < 2:   # dot: keep as a tiny 2-point stroke along its principal axis
        pts = np.c_[xs, ys].astype(float)
        c = pts.mean(0); u, s, vt = np.linalg.svd(pts - c, full_matrices=False)
        half = max(0.6, np.sqrt(len(pts)) * 0.35); d = vt[0] * half
        return [np.array([c - d, c + d])]
    edges, loops, _ = build_graph(skel)
    r = np.median(cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 3)[skel]) if skel.any() else 1
    if prune: edges = prune_spurs(edges, spur * cap_px + 2 * r)
    edges = contract_junctions(edges, 0.05 * cap_px + 3 * r)
    if prune: edges = prune_spurs(edges, spur * cap_px + 2 * r)
    strokes = edges_to_strokes(edges, loops)
    out = []
    for s in strokes:
        a = np.asarray(s, float)[:, ::-1] - pad          # (row,col)->(x,y), unpad
        if len(a) < 2: continue
        a = rdp(smooth(a), rdp_tol * cap_px)
        if len(a) < 2: continue
        # orient: start at the upper end (smaller y), tie -> left
        if (a[-1, 1], a[-1, 0]) < (a[0, 1], a[0, 0]) and not np.allclose(a[0], a[-1]): a = a[::-1]
        out.append(a)
    out.sort(key=lambda a: (round(a[0, 0] / max(cap_px, 1) * 8), a[0, 1]))
    return out
