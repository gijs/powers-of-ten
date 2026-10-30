// Seeded random numbers.
//
// Procedural bands must regenerate identically every time they are built —
// decades get disposed and rebuilt as the viewer scrubs, and a field that
// reshuffled itself on every rebuild would be unusable.

/** Small fast PRNG with a 32-bit seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distribution helpers over a seeded stream. */
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    /** Uniform in [lo, hi). */
    range: (lo, hi) => lo + (hi - lo) * next(),
    /** -1 or +1. */
    sign: () => (next() < 0.5 ? -1 : 1),
    /** Exponential with the given mean. */
    exponential: (mean) => -mean * Math.log(1 - next()),
    /** Standard normal, Box-Muller. */
    normal() {
      const u = Math.max(next(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

/**
 * Seeded 3D value noise and fbm.
 *
 * Used to lay out large-scale structure. Not the fastest noise available, but
 * it runs once at band build time, not per frame.
 */
export function makeNoise3(seed = 1) {
  const s = seed >>> 0;
  const hash = (xi, yi, zi) => {
    let h = (xi * 374761393 + yi * 668265263 + zi * 2147483647 + s) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
    const lerp = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
    return lerp(
      lerp(lerp(c(0,0,0), c(1,0,0), xf), lerp(c(0,1,0), c(1,1,0), xf), yf),
      lerp(lerp(c(0,0,1), c(1,0,1), xf), lerp(c(0,1,1), c(1,1,1), xf), yf), zf);
  };
  const fbm = (x, y, z, octaves = 4) => {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) { v += a * noise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return v;
  };
  return { noise, fbm };
}
