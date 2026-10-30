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

import * as THREE from 'three';

const PARSEC = 3.0856775814913673e16;

/** Sprite extent as a multiple of the half-light radius. */
const EXTENT = 3.2;
/** Floor, so the faintest dwarfs stay as dim smudges rather than vanishing. */
const MIN_BRIGHTNESS = 0.035;

const TYPE_ID = { spiral: 0, irregular: 1, elliptical: 2, spheroidal: 2 };

const vertexShader = /* glsl */ `
  attribute vec3 aPos;        // galaxy centre, band-local units
  attribute float aSize;      // sprite half-extent, band-local units
  attribute vec4 aShape;      // ellipticity, position angle, type, seed
  attribute float aBright;

  uniform float uScale;       // the band root's uniform scale

  varying vec2 vUv;
  varying vec4 vShape;
  varying float vBright;

  void main() {
    vUv = position.xy * 2.0;  // plane spans -0.5..0.5, so this is -1..1
    vShape = aShape;
    vBright = aBright;

    // Billboard: offset in view space so the quad always faces the camera.
    // aSize is in band-local units, and the offset is applied after the model
    // matrix, so it has to be scaled the same way the model matrix scales.
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    mv.xy += position.xy * 2.0 * aSize * uScale;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec4 vShape;
  varying float vBright;

  uniform float uWeight;
  uniform float uExposure;
  uniform float uGamma;

  const float PI = 3.14159265;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; }
    return v;
  }

  void main() {
    float ellip = vShape.x;
    float pa = vShape.y;
    float type = vShape.z;
    float seed = vShape.w;

    // Inclination and orientation: rotate into the galaxy's own frame, then
    // squash the minor axis. A disk seen at an angle is an ellipse, and this
    // is enough to give the field the edge-on/face-on variety a real one has.
    float c = cos(pa), s = sin(pa);
    vec2 q = vec2(c * vUv.x + s * vUv.y, -s * vUv.x + c * vUv.y);
    q.y /= max(1.0 - ellip, 0.12);

    float r = length(q);
    if (r > 1.0) discard;

    float theta = atan(q.y, q.x);
    // Exponential disk; the sprite spans a few scale lengths.
    float prof = exp(-r * 4.2);

    vec3 warm = vec3(1.00, 0.84, 0.60);
    vec3 cool = vec3(0.74, 0.84, 1.00);
    vec3 col;

    if (type < 0.5) {
      // Spiral: logarithmic arms, faded out toward the centre where a real
      // galaxy has a bulge and the spiral would otherwise wind infinitely.
      float phase = log(max(r, 0.05)) * 5.4 + seed * 6.28;
      float arm = 0.5 + 0.5 * cos(2.0 * (theta - phase));
      arm = pow(arm, 2.2) * smoothstep(0.04, 0.42, r);
      prof *= 1.0 + 1.5 * arm;
      prof += 1.4 * exp(-r * 16.0);               // bulge
      col = mix(warm, cool, clamp(arm * 0.9 + smoothstep(0.1, 0.6, r) * 0.4, 0.0, 1.0));
    } else if (type < 1.5) {
      // Irregular: no symmetry to speak of, just clumpy star formation.
      float clump = 0.45 + 1.5 * fbm(q * 3.4 + seed * 17.0);
      prof *= clump;
      col = mix(cool, warm, 0.25 * fbm(q * 2.0 + seed * 5.0));
    } else {
      // Spheroidal and elliptical: smooth, old, red, more centrally peaked.
      prof = exp(-pow(max(r, 1e-3), 0.55) * 5.0);
      col = mix(warm, vec3(1.0, 0.90, 0.80), 0.35);
    }

    // Soft edge so the sprite's bounding circle never shows.
    prof *= smoothstep(1.0, 0.72, r);

    float lum = prof * vBright;
    float mapped = pow(1.0 - exp(-lum * uExposure), uGamma);
    gl_FragColor = vec4(col * mapped * uWeight, mapped * uWeight);
  }
`;

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
  const root = new THREE.Group();
  root.name = 'band:local-group';

  const uniforms = {
    uWeight: { value: 0 },
    uScale: { value: 1 },
    uExposure: { value: 20.0 },
    uGamma: { value: 0.70 },
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
  let disposed = false;

  const ready = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    })
    .then((catalogue) => {
      if (disposed) return;
      const data = buildInstanceData(catalogue, refLevel);

      const base = new THREE.PlaneGeometry(1, 1);
      geometry = new THREE.InstancedBufferGeometry();
      geometry.index = base.index;
      geometry.attributes.position = base.attributes.position;
      geometry.attributes.uv = base.attributes.uv;
      geometry.instanceCount = data.count;
      geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(data.aPos, 3));
      geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(data.aSize, 1));
      geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(data.aShape, 4));
      geometry.setAttribute('aBright', new THREE.InstancedBufferAttribute(data.aBright, 1));
      // Billboards are offset in the vertex shader, so the geometry's own
      // bounds say nothing useful about where it ends up.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      base.dispose();

      root.add(new THREE.Mesh(geometry, material));
    });

  return {
    root,
    ready,
    setWeight(w) { uniforms.uWeight.value = w; },
    setPixelRatio() {},
    update(s) { uniforms.uScale.value = 10 ** (refLevel - s); },
    dispose() {
      disposed = true;
      geometry?.dispose();
      material.dispose();
      root.clear();
    },
  };
}

/** @returns band descriptor for the registry */
export function localGroupBand({ url = './assets/galaxies.json' } = {}) {
  const refLevel = 22;
  return {
    name: 'local-group',
    from: 22,
    to: 22,
    ref: refLevel,
    create: () => createInstance({ url, refLevel }),
  };
}
