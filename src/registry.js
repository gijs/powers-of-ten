// Band registry.
//
// A *band* owns a contiguous run of decades and renders them as one thing. The
// star field is the reason this exists: 10^17..10^19 is a single point cloud
// seen at three scales, not three cross-faded copies of itself. Discrete
// artwork plates still get one band per level — that is just a band of width 1.
//
// Bands must tile [S_MIN, S_MAX] exactly. That is not fussiness: ScaleDirector
// normalises its per-level weights to sum to 1, so if every level belongs to
// exactly one band then the band weights sum to 1 too, and no handoff can dim
// or flare. A gap breaks that silently, hence the validation below.
//
// Instance contract, returned by band.create():
//
//   { root: Object3D,
//     ready?: Promise,            // omit for synchronous content
//     setWeight(w: number): void, // 0..1 cross-fade weight
//     update?(s: number): void,   // optional per-frame hook
//     dispose(): void }

import { S_MIN, S_MAX } from './scale-director.js';

/**
 * Aggregate a director's per-level weights into arbitrary decade ranges.
 *
 * Shared by the band registry and the audio mix, so a sound layer fades on
 * exactly the curve its matching visuals do. Ranges that tile [S_MIN, S_MAX]
 * give weights summing to 1; overlapping ones are allowed and simply do not.
 *
 * @param {import('./scale-director.js').ScaleDirector} director
 * @param {Array<{from: number, to: number}>} ranges
 * @returns {Map<object, number>} range -> weight
 */
export function weightsOverRanges(director, ranges) {
  const out = new Map();
  for (const [level, w] of director.weights()) {
    for (const r of ranges) {
      if (level >= r.from && level <= r.to) out.set(r, (out.get(r) ?? 0) + w);
    }
  }
  return out;
}

/**
 * @param {Array} bands band descriptors: { name, from, to, ref?, create() }
 * @param {(level: number) => object} fallback instance factory for uncovered levels
 */
export function createRegistry(bands, fallback) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);

  for (const b of sorted) {
    if (!Number.isInteger(b.from) || !Number.isInteger(b.to)) {
      throw new Error(`band ${b.name}: from/to must be integers`);
    }
    if (b.to < b.from) throw new Error(`band ${b.name}: to (${b.to}) precedes from (${b.from})`);
    if (b.from < S_MIN || b.to > S_MAX) {
      throw new Error(`band ${b.name}: ${b.from}..${b.to} outside [${S_MIN}, ${S_MAX}]`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) {
      throw new Error(`bands ${sorted[i - 1].name} and ${sorted[i].name} overlap`);
    }
  }

  // Fill every uncovered level with a width-1 fallback band, so the tiling is
  // complete by construction rather than by hope.
  const all = [];
  const addFallback = (level) => all.push({
    name: `level${level}`,
    from: level,
    to: level,
    ref: level,
    create: () => fallback(level),
  });

  let cursor = S_MIN;
  for (const b of sorted) {
    while (cursor < b.from) addFallback(cursor++);
    all.push({ ...b, ref: b.ref ?? b.from });
    cursor = b.to + 1;
  }
  while (cursor <= S_MAX) addFallback(cursor++);

  const byLevel = new Map();
  for (const b of all) {
    b.key = `${b.name}@${b.from}`;
    for (let n = b.from; n <= b.to; n++) byLevel.set(n, b);
  }

  for (let n = S_MIN; n <= S_MAX; n++) {
    if (!byLevel.has(n)) throw new Error(`level ${n} uncovered — band weights would not sum to 1`);
  }

  return {
    bands: all,
    bandFor: (level) => byLevel.get(level),

    /**
     * Per-band cross-fade weights, aggregated from the director's per-level
     * weights. Sums to 1 because the bands partition the levels.
     * @returns {Map<object, number>}
     */
    bandWeights(director) {
      const out = new Map();
      for (const [level, w] of director.weights()) {
        const band = byLevel.get(level);
        if (band) out.set(band, (out.get(band) ?? 0) + w);
      }
      return out;
    },

    /** Distinct bands touched by an inclusive level range. */
    bandsInRange([lo, hi]) {
      const out = new Set();
      for (let n = lo; n <= hi; n++) {
        const band = byLevel.get(n);
        if (band) out.add(band);
      }
      return out;
    },
  };
}
