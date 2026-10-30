// Stars, 10^17..10^18 m (~3 to ~32 pc).
//
// One point cloud seen at two scales. Loaded from a packed binary written by
// tools/build-star-catalog.mjs. Rendering and photometry are shared with the
// procedural field it hands off to — see star-points.js.
//
// Why the band stops at 10^18. HYG is magnitude-limited, so its apparent
// stellar density falls ~26000x between the solar neighbourhood and 900 pc,
// while the real disk is roughly uniform over that range. By 10^19 m the frame
// is 324 pc wide and that selection effect dominates the image — it reads as a
// dense cluster centred on the Sun, which is an artefact of the survey and not
// a thing in the sky. galactic-field.js takes over from there.
//
// What this band buys, and why it is not simply replaced by the procedural one:
// these are the *real* nearby stars. Sirius, Alpha Centauri and Vega are where
// they actually are, at the brightnesses they actually have.
//
// Data: HYG Database (astronexus), CC BY-SA 4.0.

import { createStarPoints } from './star-points.js';

const MAGIC = 0x30315450; // "PT10"
const HEADER_BYTES = 16;

/**
 * @param {ArrayBuffer} buf
 * @returns {{count: number, ref: number, positions: Float32Array, absmag: Float32Array, colorIndex: Float32Array}}
 */
export function parseStarCatalog(buf) {
  if (buf.byteLength < HEADER_BYTES) throw new Error('star catalogue truncated');
  const head = new DataView(buf);
  if (head.getUint32(0, true) !== MAGIC) throw new Error('star catalogue: bad magic');
  const version = head.getUint32(4, true);
  if (version !== 1) throw new Error(`star catalogue: unsupported version ${version}`);
  const count = head.getUint32(8, true);
  const ref = head.getUint32(12, true);

  const expected = HEADER_BYTES + count * 5 * 4;
  if (buf.byteLength !== expected) {
    throw new Error(`star catalogue: expected ${expected} bytes for ${count} stars, got ${buf.byteLength}`);
  }

  // Zero-copy views; the header length keeps every array 4-byte aligned.
  return {
    count,
    ref,
    positions: new Float32Array(buf, HEADER_BYTES, count * 3),
    absmag: new Float32Array(buf, HEADER_BYTES + count * 12, count),
    colorIndex: new Float32Array(buf, HEADER_BYTES + count * 16, count),
  };
}

function createInstance({ url, refLevel, pixelRatio, exposureRange }) {
  const points = createStarPoints({ pixelRatio, exposureRange });
  let disposed = false;

  const ready = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => {
      if (disposed) return;
      const cat = parseStarCatalog(buf);
      if (cat.ref !== refLevel) {
        throw new Error(`catalogue reference level ${cat.ref} != band ref ${refLevel}`);
      }
      points.setData(cat.positions, cat.absmag, cat.colorIndex);
    });

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

/**
 * @param {object} [opts]
 * @param {string} [opts.url] catalogue location
 * @returns band descriptor for the registry
 */
export function starsBand({ url = './assets/stars.bin' } = {}) {
  const refLevel = 17;
  return {
    name: 'stars',
    from: 17,
    to: 18,
    ref: refLevel,
    create: () => createInstance({
      url,
      refLevel,
      exposureRange: [17, 18],
      pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
    }),
  };
}
