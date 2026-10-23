// rng.js — Seeded randomness toolkit (Ali's tool, reused per readme section 8).
// Pure functions only: no DOM, no unseeded randomness, no network, no Date.
// Determinism: same seed + same call sequence = identical numbers.
// Called by layout.js. Any change to these functions needs Ali's approval.
//
//   seed may be a number or string; strings are hashed (FNV-1a) to uint32.
//   rngFor(seed, ...parts) derives an independent sub-stream from the key
//   [seed, ...parts]; it is stateless, so editing one word never changes the
//   numbers used by another.

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Standard smoothstep with edge clamping. Returns 0..1.
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Quintic smootherstep (zero 1st + 2nd derivatives at the ends).
export function smootherstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// 32-bit FNV-1a hash of a string -> unsigned uint32.
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Normalize any seed to uint32.
export function seedToUint32(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return hashStr(String(seed));
}

// Mulberry32: small, fast, well-known PRNG. Returns () => [0,1).
export function mulberry32(a) {
  let t = (a >>> 0) + 0x6d2b79f5;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Primary entry: seededRng(seed) -> () => [0,1).
export function seededRng(seed) {
  return mulberry32(seedToUint32(seed));
}

// Stateless sub-streams: rngFor(seed, "word", 12) returns the same stream every
// time, regardless of call order or of other rngFor calls.
export function rngFor(seed, ...parts) {
  const key = [String(seed), ...parts.map((p) => String(p))].join('|');
  return mulberry32(hashStr(key));
}

// Box-Muller gaussian N(0,1) from a uniform rng stream.
export function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Deterministic lattice value for integer i under `seed`, in [-1, 1].
function latticeValue(seed, i) {
  const h = hashStr(String(seed) + '|' + String(i));
  const r = mulberry32(h)();
  return r * 2 - 1;
}

// Smooth 1D value noise in [-1, 1], continuous in t.
export function valueNoise1D(seed, t, scaleOrOpts = 1) {
  let scale = 1;
  if (typeof scaleOrOpts === 'number') scale = scaleOrOpts;
  else if (scaleOrOpts && typeof scaleOrOpts.scale === 'number') scale = scaleOrOpts.scale;
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
  if (!Number.isFinite(t)) return 0;
  const x = t / scale;
  const i = Math.floor(x);
  const f = x - i;
  const a = latticeValue(seed, i);
  const b = latticeValue(seed, i + 1);
  return lerp(a, b, smootherstep(f));
}

// Mean-reverting bounded random walk (discrete AR(1) + clamp).
export function boundedWalk(seed, n, opts = {}) {
  const mean = typeof opts.mean === 'number' && Number.isFinite(opts.mean) ? opts.mean : 0;
  const sigma = typeof opts.sigma === 'number' && Number.isFinite(opts.sigma) && opts.sigma >= 0 ? opts.sigma : 1;
  const rho = typeof opts.rho === 'number' && Number.isFinite(opts.rho) ? opts.rho : 0.9;
  const min = typeof opts.min === 'number' && Number.isFinite(opts.min) ? opts.min : -Infinity;
  const max = typeof opts.max === 'number' && Number.isFinite(opts.max) ? opts.max : Infinity;

  const count = Math.max(0, Math.floor(n));
  const out = new Array(count);
  if (count === 0) return out;
  const rng = rngFor(seed, 'boundedWalk');
  let x = mean;
  out[0] = clamp(x, min, max);
  for (let k = 1; k < count; k++) {
    x = mean + rho * (x - mean) + sigma * gaussian(rng);
    out[k] = clamp(x, min, max);
  }
  return out;
}
