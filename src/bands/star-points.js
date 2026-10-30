// Shared point-star rendering: shader, photometry, exposure.
//
// Both the catalogue band and the procedural field draw stars the same way and
// must agree exactly, because they cross-fade into each other at 10^18/10^19.
// Any difference in how the two compute brightness would show up as a step in
// the dissolve, so the photometry lives here once rather than in each band.
//
// Photometry. The architecture is a recession model: the camera sits a fixed
// number of world units from the origin, and one world unit is 10^s metres, so
// the viewpoint physically backs away as s grows. Apparent magnitude is
// therefore computed from each star's distance *to the camera*, not to the Sun
// — measuring from the Sun would draw what an observer standing on the Sun
// would see, while the positions depict a viewer far outside it.

import * as THREE from 'three';

import { CAMERA_DISTANCE } from '../frame.js';

export const PARSEC = 3.0856775814913673e16;

/**
 * Canvas height the point sizes were calibrated at.
 *
 * Sizes scale against this so the field is the same picture at any window
 * size. Note that the sub-pixel flux conservation below applies at *every*
 * size, including this one, so the size values are larger than they would be
 * without it — they were re-measured against it rather than carried over.
 */
const REFERENCE_HEIGHT = 800;

const vertexShader = /* glsl */ `
  attribute float aAbsMag;
  attribute float aColorIndex;

  uniform float uPixelRatio;
  uniform float uSizeFactor;   // viewport height / reference height
  uniform float uSizeScale;
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uWorldToParsec;
  uniform float uRefMag;
  uniform float uFaintMag;
  uniform float uMinAlpha;

  varying vec3 vColor;
  varying float vAlpha;

  // B-V colour index to RGB. A ramp through the stellar sequence: hot blue,
  // through white, to cool red. Cheaper than a blackbody fit and visually
  // indistinguishable at point size.
  vec3 bvToRgb(float bv) {
    float t = clamp((clamp(bv, -0.4, 2.0) + 0.4) / 2.4, 0.0, 1.0);
    vec3 c = mix(vec3(0.61, 0.70, 1.00), vec3(1.00, 0.97, 0.94), smoothstep(0.00, 0.42, t));
    c = mix(c, vec3(1.00, 0.83, 0.60), smoothstep(0.42, 0.72, t));
    c = mix(c, vec3(1.00, 0.64, 0.42), smoothstep(0.72, 1.00, t));
    return c;
  }

  void main() {
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);

    // Distance to the camera, converted to parsecs through the current scale.
    // This is what makes the near side of the field brighter than the far side
    // as the viewpoint recedes.
    float dPc = max(length(viewPos.xyz) * uWorldToParsec, 0.01);
    float appMag = aAbsMag + 5.0 * (log2(dPc) / log2(10.0)) - 5.0;

    // Exposure. Apparent magnitude alone would make the whole field fade as
    // the viewpoint recedes, and by the outer edge of a band there would be
    // almost nothing left. uRefMag tracks the camera's own distance, so the
    // recession cancels and what survives is what should drive the image:
    // intrinsic luminosity, plus the near/far gradient across the field. A real
    // camera filming this would do the same, and every decade of the original
    // artwork is exposed to read rather than to be photometric.
    float relMag = appMag - uRefMag;

    // Radius goes as the square root of flux, and flux as 10^(-0.4 m).
    //
    // Scaled by viewport height, so the composition is the same picture at any
    // window size. Point size is in pixels, so without this the same stars
    // cover a far larger fraction of a small canvas than a large one — the
    // field measured six times brighter at 200px tall than at 800px, before
    // any post-processing, which is a different image rather than a smaller one.
    float natural = uSizeScale * pow(10.0, -0.2 * relMag) * uSizeFactor;

    // Below a pixel nothing rasterises reliably, so grow it and take the light
    // back out again — the same flux conservation the galaxy sprites use.
    float sizePx = clamp(natural, 1.0, uMaxSize * uSizeFactor);
    float dim = max(sizePx / max(natural, 1e-6), 1.0);
    gl_PointSize = sizePx * uPixelRatio;

    // A floor, so the faintest stars stay as dim points rather than vanishing.
    vAlpha = clamp(pow(10.0, -0.25 * (relMag - uFaintMag)), uMinAlpha, 1.0) / (dim * dim);
    vColor = bvToRgb(aColorIndex);

    gl_Position = projectionMatrix * viewPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uWeight;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 6.0);
    float halo = exp(-d * 2.6) * 0.22;
    float a = (core + halo) * vAlpha * uWeight;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/**
 * A star point cloud whose geometry can be supplied later.
 *
 * @param {object} opts
 * @param {number} opts.pixelRatio
 * @param {number} [opts.sizeScale] point radius at the exposure reference
 * @param {number} [opts.faintMag] relative magnitude at which alpha reaches 1
 * @param {number} [opts.minAlpha] floor, so faint stars stay visible
 * @param {[number, number]} [opts.exposureRange] decades this field is exposed
 *   for; outside them the exposure freezes. See update().
 */
export function createStarPoints({
  pixelRatio,
  sizeScale = 5.0,
  faintMag = 2.0,
  minAlpha = 0.15,
  maxSize = 34,
  exposureRange = null,
} = {}) {
  const root = new THREE.Group();

  const uniforms = {
    uWeight: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uSizeFactor: { value: 1 },
    uSizeScale: { value: sizeScale },
    uMinSize: { value: 1.0 },
    uMaxSize: { value: maxSize },
    // Both replaced every frame by update(); these are only first-frame values.
    uWorldToParsec: { value: 1 },
    uRefMag: { value: 0 },
    uFaintMag: { value: faintMag },
    uMinAlpha: { value: minAlpha },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  let geometry = null;

  return {
    root,
    uniforms,

    /**
     * @param {Float32Array} positions xyz triples, in band-local units
     * @param {Float32Array} absmag absolute magnitudes
     * @param {Float32Array} colorIndex B-V
     */
    setData(positions, absmag, colorIndex) {
      geometry?.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(absmag, 1));
      geometry.setAttribute('aColorIndex', new THREE.BufferAttribute(colorIndex, 1));
      root.clear();
      root.add(new THREE.Points(geometry, material));
    },

    setWeight(w) { uniforms.uWeight.value = w; },
    setPixelRatio(r) { uniforms.uPixelRatio.value = r; },
    /** @param {number} heightPx drawing buffer height */
    setViewport(heightPx) { uniforms.uSizeFactor.value = heightPx / REFERENCE_HEIGHT; },

    update(s) {
      uniforms.uWorldToParsec.value = 10 ** s / PARSEC;

      // Exposure is pinned to the decades this field was built for.
      //
      // Every star field here is *bounded* — a catalogue reaches only so far, a
      // generated one is sampled only so far — while the viewpoint keeps
      // receding. Letting the exposure track the camera past the edge of the
      // content means compensating for distance that the content no longer
      // spans: what is left collapses toward the centre of frame and is pumped
      // brighter the further away it gets, exactly the dense-knot artefact this
      // was all meant to avoid. Freezing the exposure at the band's own range
      // lets a band fall away naturally once the viewer has left it behind,
      // which is what the cross-fade is there to cover.
      const se = exposureRange
        ? Math.min(Math.max(s, exposureRange[0]), exposureRange[1])
        : s;
      const cameraPc = (CAMERA_DISTANCE * 10 ** se) / PARSEC;
      uniforms.uRefMag.value = 5 * Math.log10(cameraPc);
    },

    dispose() {
      geometry?.dispose();
      material.dispose();
      root.clear();
    },
  };
}
