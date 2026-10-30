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
