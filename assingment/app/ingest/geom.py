"""Step 1: geometric correction + ink mask. All paths via pathlib (Windows safe)."""
import cv2, numpy as np
WARNINGS = []

def warn(msg):
    WARNINGS.append(msg); print("WARN:", msg)

def ink_mask(gray_or_bgr):
    """Ink = pixels darker than the locally estimated paper. Works with uneven lighting."""
    g = cv2.cvtColor(gray_or_bgr, cv2.COLOR_BGR2GRAY) if gray_or_bgr.ndim == 3 else gray_or_bgr
    g = cv2.medianBlur(g, 3)
    bg = cv2.medianBlur(cv2.resize(g, None, fx=.125, fy=.125), 31)
    bg = cv2.resize(bg, (g.shape[1], g.shape[0]), interpolation=cv2.INTER_LINEAR)
    norm = np.clip(g.astype(np.float32) / np.maximum(bg, 1) * 255, 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    t = min(t, 200)
    strong = (norm < t).astype(np.uint8)
    weak = (norm < min(t + 35, 228)).astype(np.uint8)          # hysteresis: faint pen pressure stays if it touches solid ink
    n, lab = cv2.connectedComponents(weak, connectivity=8)
    has = np.bincount(lab[strong > 0], minlength=n)
    keep = has >= 3; keep[0] = False
    m = (keep[lab]).astype(np.uint8) * 255
    m = cv2.medianBlur(m, 3)
    return m

def find_page_quad(bgr):
    g = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    cs, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    H, W = g.shape
    if cv2.contourArea(c) < .4 * H * W: return None
    peri = cv2.arcLength(c, True)
    ap = cv2.approxPolyDP(c, .02 * peri, True)
    if len(ap) != 4: return None
    q = ap.reshape(4, 2).astype(np.float32)
    # reject "quad" that is just the image frame (no real page edges seen)
    tol = .03 * max(H, W)
    corners = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32)
    if all(np.min(np.linalg.norm(corners - p, axis=1)) < tol for p in q): return None
    return q

def order_quad(q):
    s = q.sum(1); d = np.diff(q, axis=1).ravel()
    return np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]], np.float32)

def deskew_angle(mask):
    small = cv2.resize(mask, None, fx=.25, fy=.25, interpolation=cv2.INTER_AREA)
    best, ba = -1, 0.0
    h, w = small.shape
    for a in np.arange(-15, 15.01, .25):
        M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1)
        r = cv2.warpAffine(small, M, (w, h))
        v = np.var(r.sum(1).astype(np.float64))
        if v > best: best, ba = v, a
    return ba

def correct(bgr):
    """Returns (warped_bgr, info). Perspective warp if a page quad exists, else deskew (WARN)."""
    q = find_page_quad(bgr)
    if q is not None:
        q = order_quad(q)
        w = int(max(np.linalg.norm(q[0] - q[1]), np.linalg.norm(q[3] - q[2])))
        h = int(max(np.linalg.norm(q[0] - q[3]), np.linalg.norm(q[1] - q[2])))
        M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32))
        return cv2.warpPerspective(bgr, M, (w, h), borderValue=(255, 255, 255)), {"mode": "perspective"}
    ang = deskew_angle(ink_mask(bgr))
    warn(f"no page quad found; deskewed by {ang:.2f} deg. Residual perspective error stays in the data.")
    h, w = bgr.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1)
    return cv2.warpAffine(bgr, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)), {"mode": "deskew", "angle": ang}
