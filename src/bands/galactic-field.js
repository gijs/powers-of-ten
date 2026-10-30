// Procedural galactic star field, 10^19 m (~324 pc across the frame).
//
// Picks up where the HYG catalogue gives out. The problem it solves is not
// "more stars" — it is that HYG's limit is an *apparent* magnitude limit set by
// the instruments that built it, so the depth to which it is complete falls off
// with distance. Viewed from a receding camera that reads as a dense knot of
// stars around the Sun thinning into emptiness, which is a picture of the
// survey rather than of the sky.
//
// This field instead samples a density model and applies a *uniform* cutoff, so
// it is volume-complete for the luminosity range it draws: no false gradient,
// because the incompleteness no longer depends on where you look.
//
// Structure (thin disk):
//   rho(R, z) = exp(-(R - R0) / h_R) * exp(-|z| / h_z)
//
// Orientation: local +Z is galactic north, so the receding viewpoint climbs out
// of the plane and looks down on the disk — which is how the original frames
// the galaxy as it pulls away.
//
// What is deliberately missing: spiral structure, which has kiloparsec scale
// and cannot show in a 324 pc frame. It belongs to the volumetric band that
// takes 10^20 and beyond.

import { createStarPoints, PARSEC } from './star-points.js';
import { makeRng } from '../rng.js';

/** Sun's galactocentric radius, pc (GRAVITY 2019). */
const R0 = 8178;
/** Radial scale length of the disk, pc. */
const H_R = 2600;
/** Thin-disk scale height, pc. */
const H_Z = 300;
/**
 * Sampling radius around the Sun, pc.
 *
 * Matched to the band's own decade. Sampling much further out sounds more
 * generous but makes the field under-fill the frame at 10^19 and over-fill it
 * half a decade later, because most of the volume sits outside the view cone
 * until the viewpoint has receded well past this band. The volumetric galaxy
 * that takes 10^20 and beyond is what covers the larger scales.
 */
const RADIUS = 1200;

/**
 * Bright end of the stellar luminosity function, N(M) proportional to
 * 10^(BETA * M). Faint stars vastly outnumber bright ones; this is the slope
 * over the range worth drawing individually.
 */
const BETA = 0.30;
const MAG_MIN = -7;
/**
 * Faint cutoff. This has to be deep. Truncating near the bright end gives every
 * star nearly the same luminosity, so every point renders nearly the same size
 * and the field turns into a carpet of identical overlapping blobs. A real
 * population is overwhelmingly faint with a thin bright tail, and it is that
 * spread — many small points, a few large ones — that makes a star field read
 * as one. The faint majority costs almost nothing in ink; they land on the size
 * and alpha floors and become the unresolved background.
 */
const MAG_MAX = 8;

/**
 * How many stars to draw. This is the one honest knob: the real volume holds
 * billions, and what a photograph shows is a magnitude-limited subset of them.
 * Stars too faint to resolve still contribute at the alpha floor, which is what
 * produces the unresolved background glow.
 *
 * Calibrated against the catalogue band rather than guessed, on two measures
 * that have to be satisfied together:
 *
 *   ink per in-frame star  — how fat each point is. Matching coverage alone is
 *     degenerate: half as many stars at four times the size gives the same
 *     total ink and looks like mush, because the points overlap. The catalogue
 *     view that reads well sits at ~23 px^2 per star; MAX_POINT_SIZE is what
 *     actually controls this, far more than the count does.
 *   total coverage — ink as a fraction of frame area, target ~0.45.
 *
 * Together with the sampling radius and point size, these hold the combined
 * coverage of both bands within 0.30-0.51 across the whole 10^18-to-10^19
 * handoff — flat enough that the dissolve does not read as a density change.
 *
 * Note that GIANT_FRACTION moves this hard: giants are bright by construction,
 * so they carry a large share of the ink, and changing it means recalibrating
 * here.
 */
const COUNT = 450000;

/**
 * Point size ceiling. Deliberately well below the catalogue band's, which
 * needs headroom for Sirius and friends sitting a few parsecs away. Nothing in
 * a field sampled from hundreds of parsecs out has any business being that
 * large, and letting it be is what turns the field into overlapping blobs.
 */
const MAX_POINT_SIZE = 14;

/**
 * Fraction of stars placed on the giant branch.
 *
 * This number is far more sensitive than it looks, and must be set against the
 * *luminous* population rather than the whole sample. The luminosity function
 * makes stars brighter than absmag 2 only about 0.4% of the field, while giants
 * are bright by construction — so a giant fraction of a few percent means
 * essentially every star large enough to resolve is a red giant, and the field
 * comes out uniformly orange. At ~1% the mix of the luminous population lands
 * near the catalogue's: a minority blue, a third white, and the rest red.
 */
const GIANT_FRACTION = 0.012;

/** Absolute magnitude to B-V, following the main sequence. */
function mainSequenceColour(absMag, rng) {
  const bv = absMag < 0
    ? -0.30 + (absMag + 6) * 0.05
    : absMag * 0.15;
  return bv + rng.normal() * 0.06;
}

/** Thin-disk truncation, in scale heights. */
const MAX_Z_SCALE_HEIGHTS = 5;

const SEED = 0x5eed1e;

/**
 * Generate the field, yielding progress between chunks.
 *
 * Deterministic for a given seed, so a band that is disposed and rebuilt comes
 * back identical. Written as a generator so the ~150 ms of work can be spread
 * across frames instead of stalling one: bands are built a couple of decades
 * ahead of where the viewer is, but a single long synchronous block would still
 * show up as a hitch while scrubbing.
 *
 * @param {number} refLevel local unit = 10^refLevel metres
 * @returns {Generator<number, {count: number, positions: Float32Array, absmag: Float32Array, colorIndex: Float32Array}>}
 */
export function* generateGalacticFieldChunks(refLevel, {
  seed = SEED, chunk = 50000, count = COUNT, magMax = MAG_MAX, radius = RADIUS,
} = {}) {
  const rng = makeRng(seed);
  const positions = new Float32Array(count * 3);
  const absmag = new Float32Array(count);
  const colorIndex = new Float32Array(count);

  /** pc to band-local units. */
  const toLocal = PARSEC / 10 ** refLevel;

  // Rejection bound: density peaks at the point of the sampling disc nearest
  // the galactic centre.
  const maxDensity = Math.exp(radius / H_R);

  const magLo = 10 ** (BETA * MAG_MIN);
  const magHi = 10 ** (BETA * magMax);

  for (let i = 0; i < count; i++) {
    // Position in the plane, with the radial disc profile applied by rejection.
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 64; tries++) {
      const r = radius * Math.sqrt(rng.next());
      const th = rng.range(0, Math.PI * 2);
      x = r * Math.cos(th);
      y = r * Math.sin(th);
      // Galactic centre sits at local (-R0, 0, 0).
      const rGal = Math.hypot(x + R0, y);
      if (rng.next() * maxDensity < Math.exp(-(rGal - R0) / H_R)) break;
    }
    // Exponential has a long tail: over 400k draws it reaches several
    // kiloparsecs, which is not thin-disk structure. Resample the far tail
    // rather than clamping it, which would pile stars onto one plane.
    let z = 0;
    for (let tries = 0; tries < 64; tries++) {
      z = rng.exponential(H_Z);
      if (z <= H_Z * MAX_Z_SCALE_HEIGHTS) break;
    }
    z *= rng.sign();

    positions[i * 3 + 0] = x * toLocal;
    positions[i * 3 + 1] = y * toLocal;
    positions[i * 3 + 2] = z * toLocal;

    // Luminosity, by inverse CDF of the power-law bright end.
    const m = Math.log10(rng.next() * (magHi - magLo) + magLo) / BETA;
    absmag[i] = m;

    // A minority of evolved stars sit off the main sequence: luminous and red.
    if (rng.next() < GIANT_FRACTION) {
      // Reaching down to 0.85 rather than 1.0 covers the subgiants and G/K
      // giants; without them the luminous population jumps straight from
      // blue-white to deep red with nothing in between.
      absmag[i] = rng.range(-2, 1);
      colorIndex[i] = rng.range(0.85, 1.65);
    } else {
      colorIndex[i] = mainSequenceColour(m, rng);
    }

    if ((i + 1) % chunk === 0) yield (i + 1) / COUNT;
  }

  return { count, positions, absmag, colorIndex };
}

/** Drain the generator in one go. For tests and tools. */
export function generateGalacticField(refLevel, opts = {}) {
  const gen = generateGalacticFieldChunks(refLevel, opts);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

function createInstance({ refLevel, pixelRatio }) {
  // A lower alpha floor than the catalogue band: there are far more stars here
  // that are too faint to resolve, and they should read as background glow
  // rather than as a carpet of identical dots.
  const points = createStarPoints({
    pixelRatio, minAlpha: 0.04, sizeScale: 2.8,
    maxSize: MAX_POINT_SIZE, exposureRange: [19, 19],
  });
  let disposed = false;

  // The band contract's `ready` is not just for network fetches — anything
  // that cannot finish inside one frame belongs behind it.
  const ready = (async () => {
    const gen = generateGalacticFieldChunks(refLevel);
    let step = gen.next();
    while (!step.done) {
      await new Promise((r) => setTimeout(r, 0));
      if (disposed) return;
      step = gen.next();
    }
    const field = step.value;
    points.setData(field.positions, field.absmag, field.colorIndex);
  })();

  return {
    root: points.root,
    ready,
    setWeight: points.setWeight,
    setPixelRatio: points.setPixelRatio,
    update: points.update,
    dispose() {
      disposed = true;
      points.dispose();
    },
  };
}

/** @returns band descriptor for the registry */
export function galacticFieldBand() {
  const refLevel = 19;
  return {
    name: 'galactic-field',
    from: 19,
    to: 19,
    ref: refLevel,
    create: () => createInstance({
      refLevel,
      pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
    }),
  };
}
