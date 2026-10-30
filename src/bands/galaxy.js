// The Milky Way, 10^20..10^21 m (~3 to ~32 kpc across the frame).
//
// A raymarched emission-absorption volume, not points. Past 10^19 the viewpoint
// is far enough out that individual stars stop being resolvable and the disk
// becomes continuous light — which is both what you would actually see and the
// only tractable way to draw 10^11 stars. It also buys the thing that makes a
// galaxy read as a galaxy: dust lanes, which are *absorption*, and additive
// points can only ever add light.
//
// Structure, all in kiloparsecs and converted into band-local units by uKpc so
// the shader does not care what decade it is authored around:
//
//   stars  rho(R,z) = exp(-R/hR) * exp(-|z|/hz) * arms  +  bulge
//   dust   a thinner layer, offset to the inner edge of the arms
//
// Arms are a two-armed logarithmic spiral, which is the Milky Way's broad form.
// Its bar is deliberately not modelled: at 10^20 the frame is 3 kpc and the bar
// is off-screen, and by 10^21 it is a couple of pixels.
//
// Orientation matches the point-field band below it: local +Z is galactic
// north, so the receding viewpoint climbs out of the plane and the galaxy opens
// up face-on, which is how the original frames it.
//
// The Sun sits at the scene origin, not the galactic centre. Every band is
// heliocentric, because the whole piece holds the starting point at frame
// centre — that is what the HUD's nested squares are measuring outward from.
// Centring the galaxy itself would quietly move the viewpoint 8 kpc to the
// galactic centre somewhere during this band, and the squares would then be
// framing a place the journey never passed through. So the volume is offset
// instead, and at 10^21 the bulge sits off to one side with the Sun centred,
// which is also the truthful picture.

import * as THREE from 'three';

import { CAMERA_DISTANCE } from '../frame.js';

const PARSEC = 3.0856775814913673e16;

/** Galaxy geometry, in kiloparsecs. */
const GEO = {
  diskScaleLength: 2.6,
  diskScaleHeight: 0.30,
  dustScaleLength: 3.2,
  dustScaleHeight: 0.11,
  bulgeScale: 0.95,
  outerRadius: 15.0,
  /** Distance from the Sun to the galactic centre, kpc (GRAVITY 2019). */
  sunRadius: 8.178,
  /** Bounding box half-extents for the raymarch. */
  boxRadius: 18.0,
  boxHeight: 3.0,
};

const vertexShader = /* glsl */ `
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vObjPos;

  uniform vec3  uCamObj;      // camera position in object space
  uniform vec3  uBoxHalf;     // raymarch bounds, object space
  uniform float uKpc;         // one kiloparsec, in object-space units
  uniform float uWeight;      // cross-fade weight
  uniform float uSteps;
  uniform float uExposure;
  uniform float uGamma;
  uniform float uBulgeAmp;

  uniform float uDiskScaleLength;
  uniform float uDiskScaleHeight;
  uniform float uDustScaleLength;
  uniform float uDustScaleHeight;
  uniform float uBulgeScale;
  uniform float uOuterRadius;

  const float PI = 3.14159265;
  const float ARMS = 2.0;
  const float PITCH = 0.22;      // ~12.6 degrees
  const float ARM_SHARP = 2.1;   // higher = narrower arms
  const float ARM_AMP = 1.5;
  const float DUST_K = 5.5;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  // Logarithmic spiral: arm crests sit where theta matches ln(R) / tan(pitch).
  float armFactor(float R, float theta, float twist) {
    float phase = log(max(R, 0.4 * uKpc) / (8.0 * uKpc)) / tan(PITCH);
    float a = 0.5 + 0.5 * cos(ARMS * (theta - phase + twist));
    return pow(a, ARM_SHARP);
  }

  float starDensity(vec3 p, out float armT, out float R) {
    R = length(p.xy);
    float theta = atan(p.y, p.x);
    armT = armFactor(R, theta, 0.0);

    // Spiral structure has to be faded out toward the centre. A logarithmic
    // spiral winds infinitely as R goes to zero, so without this the innermost
    // kiloparsec fills with ever-tighter arms — and at 10^20 m, where the frame
    // is only ~3 kpc across, that fake winding is most of the picture. Real
    // galaxies have a bulge and a bar in there and no arms at all.
    float armMask = smoothstep(0.7 * uKpc, 3.5 * uKpc, R);
    float disk = exp(-R / uDiskScaleLength) * exp(-abs(p.z) / uDiskScaleHeight);
    disk *= 1.0 + ARM_AMP * armT * armMask;

    // Flattened spheroid for the bulge.
    float rb = length(vec3(p.xy, p.z / 0.62));
    float bulge = uBulgeAmp * exp(-rb / uBulgeScale);

    float n = 0.5 + 1.0 * fbm(p * (2.6 / uKpc));
    float edge = smoothstep(uOuterRadius, uOuterRadius * 0.72, R);
    return (disk * n + bulge) * edge;
  }

  float dustDensity(vec3 p) {
    float R = length(p.xy);
    float theta = atan(p.y, p.x);
    // Offset so lanes ride the inner edge of the bright arms, as they do.
    float armT = armFactor(R, theta, 0.26) * smoothstep(0.7 * uKpc, 3.5 * uKpc, R);
    float lane = exp(-R / uDustScaleLength) * exp(-abs(p.z) / uDustScaleHeight);
    float n = fbm(p * (4.4 / uKpc));
    float edge = smoothstep(uOuterRadius, uOuterRadius * 0.7, R);
    return lane * (0.22 + 1.5 * armT) * (0.35 + 1.3 * n) * edge;
  }

  vec3 tint(float R, float armT) {
    vec3 core = vec3(1.00, 0.82, 0.55);   // old, metal-rich bulge
    vec3 mid  = vec3(1.00, 0.95, 0.87);
    vec3 arm  = vec3(0.70, 0.83, 1.00);   // young blue stars along the arms
    vec3 c = mix(core, mid, smoothstep(0.0, 4.5 * uKpc, R));
    return mix(c, arm, clamp(armT * 0.8, 0.0, 1.0) * smoothstep(0.7 * uKpc, 3.5 * uKpc, R));
  }

  // Slab-method AABB intersection, centred on the origin.
  bool hitBox(vec3 ro, vec3 rd, vec3 halfExtent, out float t0, out float t1) {
    // Named halfExtent, not half: half is a reserved word in GLSL.
    vec3 inv = 1.0 / rd;
    vec3 a = (-halfExtent - ro) * inv;
    vec3 b = ( halfExtent - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    t0 = max(max(lo.x, lo.y), lo.z);
    t1 = min(min(hi.x, hi.y), hi.z);
    return t1 > max(t0, 0.0);
  }

  void main() {
    vec3 ro = uCamObj;
    vec3 rd = normalize(vObjPos - uCamObj);

    float t0, t1;
    if (!hitBox(ro, rd, uBoxHalf, t0, t1)) discard;
    t0 = max(t0, 0.0);

    float steps = uSteps;
    float dt = (t1 - t0) / steps;

    // Jitter the first sample so the step pattern does not show as banding.
    float t = t0 + dt * hash(vec3(gl_FragCoord.xy, 0.5));

    vec3 accum = vec3(0.0);
    float trans = 1.0;

    for (int i = 0; i < 160; i++) {
      if (float(i) >= steps || trans < 0.01) break;
      vec3 p = ro + rd * t;

      float armT, R;
      float d = starDensity(p, armT, R);
      if (d > 0.0005) {
        float dust = dustDensity(p);
        float absorb = dust * DUST_K;
        vec3 emit = tint(R, armT) * d;
        // Emission first, then attenuate: light from this slab is not absorbed
        // by the slab's own dust.
        accum += trans * emit * dt;
        trans *= exp(-absorb * dt);
      }
      t += dt;
    }

    // Tone curve. An exponential disk spans a huge range of surface brightness,
    // and shown linearly the bulge saturates while the disk past a couple of
    // scale lengths falls to nothing — measured, the arms died out by 5 kpc
    // when they should read to 10-15. Every astronomical image of a galaxy is
    // stretched for exactly this reason.
    //
    // Applied to luminance, with the colour ratios carried through unchanged.
    // Curving each channel separately drives them all toward 1 together, which
    // bleaches the warm core and the blue arms to the same flat white — the
    // galaxy loses the one cue that says which light is old and which is young.
    float lum = dot(accum, vec3(0.2126, 0.7152, 0.0722));
    float mapped = pow(1.0 - exp(-lum * uExposure), uGamma);
    vec3 c = lum > 1e-7 ? accum * (mapped / lum) : vec3(0.0);

    float alpha = 1.0 - trans;
    gl_FragColor = vec4(c * uWeight, alpha * uWeight);
  }
`;

function createInstance({ refLevel, steps }) {
  const root = new THREE.Group();
  root.name = 'band:galaxy';

  /** One kiloparsec, in band-local units. */
  const kpc = (1000 * PARSEC) / 10 ** refLevel;
  const half = new THREE.Vector3(GEO.boxRadius, GEO.boxRadius, GEO.boxHeight).multiplyScalar(kpc);

  const uniforms = {
    uCamObj: { value: new THREE.Vector3(0, 0, CAMERA_DISTANCE) },
    uBoxHalf: { value: half },
    uKpc: { value: kpc },
    uWeight: { value: 0 },
    uSteps: { value: steps },
    uExposure: { value: 4.0 },
    uGamma: { value: 0.70 },
    uBulgeAmp: { value: 0.7 },
    uDiskScaleLength: { value: GEO.diskScaleLength * kpc },
    uDiskScaleHeight: { value: GEO.diskScaleHeight * kpc },
    uDustScaleLength: { value: GEO.dustScaleLength * kpc },
    uDustScaleHeight: { value: GEO.dustScaleHeight * kpc },
    uBulgeScale: { value: GEO.bulgeScale * kpc },
    uOuterRadius: { value: GEO.outerRadius * kpc },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide, // so the box still covers the view from inside it
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  const geometry = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
  const mesh = new THREE.Mesh(geometry, material);
  // The box is centred on the galactic centre, which is offset from the scene
  // origin (the Sun). Keeping the box there means the raymarch still runs in a
  // space where the galaxy sits at zero, so the shader needs no offset of its
  // own and no marching steps are spent on the empty volume the offset would
  // otherwise add.
  mesh.position.set(-GEO.sunRadius * kpc, 0, 0);
  root.add(mesh);

  return {
    root,
    setWeight(w) { uniforms.uWeight.value = w; },
    setPixelRatio() {},
    update(s) {
      // The band root is uniformly scaled and sits at the origin, so the camera
      // in root-local space is its world position over the scale; subtracting
      // the mesh offset puts it in the mesh's own space, where the galaxy is
      // centred. Doing the raymarch there keeps the shader independent of which
      // of the 41 decades we are currently at.
      const scale = 10 ** (refLevel - s);
      uniforms.uCamObj.value.set(GEO.sunRadius * kpc, 0, CAMERA_DISTANCE / scale);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      root.clear();
    },
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.steps] raymarch samples per pixel
 */
export function galaxyBand({ steps = 72 } = {}) {
  const refLevel = 20;
  return {
    name: 'galaxy',
    from: 20,
    to: 21,
    ref: refLevel,
    create: () => createInstance({ refLevel, steps }),
  };
}
