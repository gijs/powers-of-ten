// Large-scale structure, 10^23..10^24 m (~3 to ~32 Mpc across the frame).
//
// The outermost band, and where the original film ends: 10^24 m is about 100
// million light years, the scale of the local supercluster — not the edge of
// the observable universe, which is two more decades out.
//
// Procedural, because no catalogue survives out here. The McConnachie data
// stops at 3 Mpc, and past that a real survey's own selection effects would
// dominate the picture exactly as they did for the stars. What this draws
// instead is a density field: galaxies are rejection-sampled against banded
// noise, so they fall into clusters strung along filaments with voids between
// them, which is the actual shape of matter at this scale.
//
// One real relation is modelled, because it is visible: the morphology-density
// relation. Galaxies in dense cluster cores are mostly old, red ellipticals;
// those out in the field are mostly blue spirals. It is what keeps the clusters
// reading as clusters rather than as a denser scatter of the same thing.

import { createGalaxySprites, TYPE_ID } from './galaxy-sprites.js';
import { makeRng, makeNoise3 } from '../rng.js';

const PARSEC = 3.0856775814913673e16;

/** Sampling radius, Mpc. Must reach past the frame at the band's outer edge. */
const RADIUS = 220;
/** Characteristic size of superclusters and voids, Mpc. */
const STRUCTURE_SCALE = 42;
/** How many galaxies to draw. */
const COUNT = 120000;

/** Sprite extent as a multiple of the half-light radius. */
const EXTENT = 3.2;
const SEED = 0xc05b1c;

/** Luminosity function: faint galaxies vastly outnumber bright ones. */
const MAG_BRIGHT = -23;
const MAG_FAINT = -15;
const BETA = 0.33;

/**
 * Generate the field, yielding between chunks so the work spreads over frames
 * rather than stalling one.
 */
/** Resolution of the precomputed density grid, per axis. */
const GRID = 64;

/**
 * Sample the structure field onto a grid once, so the rejection sampler can
 * look density up instead of evaluating fbm per attempt.
 *
 * Evaluating noise inside the sampling loop costs a multiple of the accepted
 * count — several million fbm calls for 120k galaxies, which is over a second
 * of blocking work. The grid costs 64^3 evaluations flat and the sampler then
 * does trilinear lookups. At 440 Mpc across, a cell is ~7 Mpc, which is fine
 * against a 42 Mpc structure scale.
 */
function buildDensityGrid(seed) {
  const { fbm } = makeNoise3(seed ^ 0x9e3779b9);
  const grid = new Float32Array(GRID * GRID * GRID);
  const step = (2 * RADIUS) / (GRID - 1);
  let max = 0;
  for (let k = 0; k < GRID; k++) {
    const z = -RADIUS + k * step;
    for (let j = 0; j < GRID; j++) {
      const y = -RADIUS + j * step;
      for (let i = 0; i < GRID; i++) {
        const x = -RADIUS + i * step;
        const w = fbm(x / STRUCTURE_SCALE, y / STRUCTURE_SCALE, z / STRUCTURE_SCALE);
        // Cubing sharpens the contrast between filament and void; without it
        // the result is an even mist with no web in it at all.
        const d = Math.max(0, (w - 0.42) / 0.38) ** 3;
        grid[(k * GRID + j) * GRID + i] = d;
        if (d > max) max = d;
      }
    }
  }
  return { grid, max: max || 1 };
}

function sampleGrid(grid, x, y, z) {
  const t = (v) => ((v + RADIUS) / (2 * RADIUS)) * (GRID - 1);
  const fx = Math.min(GRID - 1.001, Math.max(0, t(x)));
  const fy = Math.min(GRID - 1.001, Math.max(0, t(y)));
  const fz = Math.min(GRID - 1.001, Math.max(0, t(z)));
  const i = fx | 0, j = fy | 0, k = fz | 0;
  const dx = fx - i, dy = fy - j, dz = fz - k;
  const at = (a, b, c) => grid[((c * GRID + b) * GRID + a)];
  const lerp = (a, b, u) => a + (b - a) * u;
  return lerp(
    lerp(lerp(at(i,j,k), at(i+1,j,k), dx), lerp(at(i,j+1,k), at(i+1,j+1,k), dx), dy),
    lerp(lerp(at(i,j,k+1), at(i+1,j,k+1), dx), lerp(at(i,j+1,k+1), at(i+1,j+1,k+1), dx), dy), dz);
}

/**
 * Generate the field, yielding between chunks so the work spreads over frames
 * rather than stalling one.
 */
export function* generateCosmicWebChunks(refLevel, { seed = SEED, count = COUNT, chunk = 15000 } = {}) {
  const rng = makeRng(seed);
  const { grid, max } = buildDensityGrid(seed);

  /** Mpc to band-local units. */
  const toLocal = (1e6 * PARSEC) / 10 ** refLevel;

  const aPos = new Float32Array(count * 3);
  const aSize = new Float32Array(count);
  const aShape = new Float32Array(count * 4);
  const aBright = new Float32Array(count);

  const magLo = 10 ** (BETA * MAG_BRIGHT);
  const magHi = 10 ** (BETA * MAG_FAINT);
  const r2 = RADIUS * RADIUS;

  for (let i = 0; i < count; i++) {
    // Only ever commit coordinates that passed the sphere test. Writing back
    // whatever the loop happened to hold last let rejected points outside the
    // sphere through, and the field ended up 70% wider than its own radius.
    let x = 0, y = 0, z = 0, density = 0;
    let have = false;
    for (let tries = 0; tries < 128; tries++) {
      const cx = (rng.next() * 2 - 1) * RADIUS;
      const cy = (rng.next() * 2 - 1) * RADIUS;
      const cz = (rng.next() * 2 - 1) * RADIUS;
      if (cx * cx + cy * cy + cz * cz > r2) continue;
      const d = sampleGrid(grid, cx, cy, cz);
      x = cx; y = cy; z = cz; density = d; have = true;
      if (rng.next() * max < d) break;
    }
    if (!have) { x = y = z = 0; density = max; }

    aPos[i * 3 + 0] = x * toLocal;
    aPos[i * 3 + 1] = y * toLocal;
    aPos[i * 3 + 2] = z * toLocal;

    // Luminosity, by inverse CDF of the power-law faint end.
    const absMag = Math.log10(rng.next() * (magHi - magLo) + magLo) / BETA;
    // Size-luminosity relation: brighter galaxies are bigger.
    const rhKpc = 3.5 * 10 ** (-0.16 * (absMag + 20.5));

    // Morphology-density relation: cluster cores are red and old, the field is
    // blue and star-forming.
    const clustered = Math.min(density / max, 1);
    const roll = rng.next();
    const type = roll < 0.18 + 0.62 * clustered
      ? 'elliptical'
      : (roll < 0.86 ? 'spiral' : 'irregular');

    aShape[i * 4 + 0] = rng.range(0, 0.72);              // ellipticity
    aShape[i * 4 + 1] = rng.range(0, Math.PI * 2);       // position angle
    aShape[i * 4 + 2] = TYPE_ID[type];
    aShape[i * 4 + 3] = rng.next();

    aSize[i] = rhKpc * 1e-3 * EXTENT * toLocal;          // kpc -> Mpc -> local

    // Surface brightness, relative to an L* galaxy, as in the Local Group band.
    const lum = 10 ** (-0.4 * (absMag + 20.9));
    aBright[i] = Math.min(lum / (Math.PI * (rhKpc / 5) ** 2), 2.5);

    if ((i + 1) % chunk === 0) yield (i + 1) / count;
  }

  return { count, aPos, aSize, aShape, aBright };
}

/** Drain the generator in one go. For tests. */
export function generateCosmicWeb(refLevel, opts = {}) {
  const gen = generateCosmicWebChunks(refLevel, opts);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

function createInstance({ refLevel }) {
  const sprites = createGalaxySprites({ exposure: 16.0, gamma: 0.72 });
  let disposed = false;

  const ready = (async () => {
    const gen = generateCosmicWebChunks(refLevel);
    let step = gen.next();
    while (!step.done) {
      await new Promise((r) => setTimeout(r, 0));
      if (disposed) return;
      step = gen.next();
    }
    sprites.setData(step.value);
  })();

  return {
    root: sprites.root,
    ready,
    setWeight: sprites.setWeight,
    setPixelRatio: sprites.setPixelRatio,
    update(s) { sprites.updateScale(refLevel, s); },
    dispose() { disposed = true; sprites.dispose(); },
  };
}

/** @returns band descriptor for the registry */
export function cosmicWebBand() {
  const refLevel = 23;
  return {
    name: 'cosmic-web',
    from: 23,
    to: 24,
    ref: refLevel,
    create: () => createInstance({ refLevel }),
  };
}
