// The Local Group, 10^22 m (~324 kpc across the frame).
//
// Instanced billboards, one per galaxy, each drawn by a procedural profile
// shader rather than a texture — so a galaxy stays sharp as the frame crosses
// a decade, and each gets its own arms, inclination and colour for free.
//
// Brightness is surface brightness, not magnitude, and that is the thing worth
// getting right here. These are *extended* objects: total flux falls as 1/d^2
// but so does apparent area, so surface brightness is distance-independent.
// Drawing each galaxy at its intrinsic surface brightness and letting the
// sprite's size carry the distance is both simpler and more correct than the
// recession-and-exposure treatment the point bands need.
//
// Why this band stops at 10^22, when the catalogue reaches 3 Mpc. By 10^23 the
// viewpoint has receded to ~9.8 Mpc, three times beyond the far edge of the
// data, so the Local Group would sit in frame as a small clump with nothing at
// all around it — the same bounded-catalogue artefact the star field had, where
// the picture becomes one of the survey's limits rather than of the sky.
// Measured, the galaxies cover 0.01% of the frame there, and no amount of
// exposure fixes it: the sprite cores are already saturated, so turning it up
// only widens a few white dots. Those decades need a procedurally extended
// field of galaxies, exactly as galactic-field.js extends the star catalogue.
//
// Data: McConnachie 2012 (AJ 144, 4), via tools/build-galaxy-catalog.mjs.

import { createGalaxySprites, TYPE_ID } from './galaxy-sprites.js';

const PARSEC = 3.0856775814913673e16;

/** Sprite extent as a multiple of the half-light radius. */
const EXTENT = 3.2;
/** Floor, so the faintest dwarfs stay as dim smudges rather than vanishing. */
const MIN_BRIGHTNESS = 0.035;

/**
 * @param {object} catalogue parsed assets/galaxies.json
 * @param {number} refLevel local unit = 10^refLevel metres
 */
export function buildInstanceData(catalogue, refLevel) {
  /** kpc to band-local units. */
  const toLocal = (1000 * PARSEC) / 10 ** refLevel;

  const list = catalogue.galaxies;
  const n = list.length;
  const aPos = new Float32Array(n * 3);
  const aSize = new Float32Array(n);
  const aShape = new Float32Array(n * 4);
  const aBright = new Float32Array(n);

  // Surface brightness relative to the Milky Way: luminosity over area, both
  // in whatever units, since only the ratio is used.
  const sb = list.map((g) => {
    const lum = 10 ** (-0.4 * (g.absMag + 20.9));
    const rh = Math.max(g.halfLightKpc, 0.01);
    return lum / (Math.PI * rh * rh);
  });
  const ref = sb[list.findIndex((g) => g.name === 'MilkyWay')] ?? Math.max(...sb);

  for (let i = 0; i < n; i++) {
    const g = list[i];
    aPos[i * 3 + 0] = g.x * toLocal;
    aPos[i * 3 + 1] = g.y * toLocal;
    aPos[i * 3 + 2] = g.z * toLocal;
    aSize[i] = Math.max(g.halfLightKpc, 0.01) * EXTENT * toLocal;
    aShape[i * 4 + 0] = g.ellipticity;
    aShape[i * 4 + 1] = (g.positionAngle * Math.PI) / 180;
    aShape[i * 4 + 2] = TYPE_ID[g.type] ?? 2;
    aShape[i * 4 + 3] = (i * 0.618033988749895) % 1;
    aBright[i] = Math.max(sb[i] / ref, MIN_BRIGHTNESS);
  }

  return { count: n, aPos, aSize, aShape, aBright };
}

function createInstance({ url, refLevel }) {
  const sprites = createGalaxySprites({ exposure: 20.0, gamma: 0.70 });
  let disposed = false;

  const ready = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    })
    .then((catalogue) => {
      if (disposed) return;
      sprites.setData(buildInstanceData(catalogue, refLevel));
    });

  return {
    root: sprites.root,
    ready,
    setWeight: sprites.setWeight,
    setPixelRatio: sprites.setPixelRatio,
    setViewport: sprites.setViewport,
    update(s) { sprites.updateScale(refLevel, s); },
    dispose() {
      disposed = true;
      sprites.dispose();
    },
  };
}

/** @returns band descriptor for the registry */
export function localGroupBand({ url = new URL('../../assets/galaxies.json', import.meta.url).href } = {}) {
  const refLevel = 22;
  return {
    name: 'local-group',
    from: 22,
    to: 22,
    ref: refLevel,
    create: () => createInstance({ url, refLevel }),
  };
}
