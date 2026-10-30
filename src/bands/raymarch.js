// Shared scaffolding for raymarched bands.
//
// The inward journey is almost entirely volumes and surfaces with no data
// behind them — skin, cells, molecules, electron clouds, nucleons — so the
// same box-and-ray boilerplate would otherwise be copied five times. Each band
// supplies only its own GLSL: a `scene` function and a colour.
//
// Marching happens in object space, which is what keeps a band independent of
// which of the 41 decades it is currently being viewed at: the only per-frame
// input is where the camera sits in that space.

import * as THREE from 'three';

import { CAMERA_DISTANCE } from '../frame.js';

const COMMON = /* glsl */ `
  precision highp float;

  varying vec3 vObjPos;

  uniform vec3  uCamObj;
  uniform vec3  uBoxHalf;
  uniform float uWeight;
  uniform float uSteps;
  uniform float uTime;
  uniform float uDetail;   // 10^(ref - s): how deep into the band we are
  uniform float uExposure;
  uniform float uGamma;

  const float PI = 3.14159265;

  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i+vec3(0,0,0)), hash13(i+vec3(1,0,0)), f.x),
          mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x),
          mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p, int octaves) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  // Slab-method AABB intersection, centred on the origin. Named halfExtent
  // because 'half' is a reserved word in GLSL.
  bool hitBox(vec3 ro, vec3 rd, vec3 halfExtent, out float t0, out float t1) {
    vec3 inv = 1.0 / rd;
    vec3 a = (-halfExtent - ro) * inv;
    vec3 b = ( halfExtent - ro) * inv;
    vec3 lo = min(a, b), hi = max(a, b);
    t0 = max(max(lo.x, lo.y), lo.z);
    t1 = min(min(hi.x, hi.y), hi.z);
    return t1 > max(t0, 0.0);
  }
`;

const VERTEX = /* glsl */ `
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * An emission-absorption volume march. The band's GLSL must define:
 *
 *   void sample(vec3 p, out vec3 emit, out float absorb)
 *
 * @param {object} opts
 * @param {string} opts.glsl the band's own shader body
 * @param {[number,number,number]} opts.boxHalf extent to march, local units
 * @param {number} opts.refLevel
 * @param {number} [opts.steps]
 * @param {Record<string, THREE.IUniform>} [opts.uniforms] extra uniforms
 */
export function createVolumeBand({
  glsl, boxHalf, refLevel, steps = 64, exposure = 3.0, gamma = 0.8, uniforms = {},
}) {
  const root = new THREE.Group();

  const half = new THREE.Vector3(...boxHalf);
  const u = {
    uCamObj: { value: new THREE.Vector3(0, 0, CAMERA_DISTANCE) },
    uBoxHalf: { value: half },
    uWeight: { value: 0 },
    uSteps: { value: steps },
    uTime: { value: 0 },
    uDetail: { value: 1 },
    uExposure: { value: exposure },
    uGamma: { value: gamma },
    ...uniforms,
  };

  const fragment = `${COMMON}\n${glsl}\n` + /* glsl */ `
    void main() {
      vec3 ro = uCamObj;
      vec3 rd = normalize(vObjPos - uCamObj);
      float t0, t1;
      if (!hitBox(ro, rd, uBoxHalf, t0, t1)) discard;
      t0 = max(t0, 0.0);

      // March only out to a few times the viewing distance. These bands span
      // three or four decades, so deep into one the camera sits very close to
      // the origin while the box still spans the whole band — spreading the
      // step budget over all of it would leave almost no samples where the
      // detail actually is.
      t1 = min(t1, max(length(uCamObj) * 14.0, t0 + 1e-6));

      float dt = (t1 - t0) / uSteps;
      float t = t0 + dt * hash13(vec3(gl_FragCoord.xy, 0.5));

      vec3 accum = vec3(0.0);
      float trans = 1.0;
      for (int i = 0; i < 224; i++) {
        if (float(i) >= uSteps || trans < 0.01) break;
        vec3 emit; float absorb;
        sampleVolume(ro + rd * t, emit, absorb);
        if (absorb > 0.0 || emit.r + emit.g + emit.b > 0.0) {
          accum += trans * emit * dt;
          trans *= exp(-absorb * dt);
        }
        t += dt;
      }
      // Tone curve, on luminance with the colour ratios carried through.
      // Raw accumulation is in units of emission times step length, and the
      // step length changes with the box and the scale, so the raw value is not
      // something a band can usefully reason about. Mapping it here means each
      // band only has to pick an exposure. Curving each channel separately
      // would drive them to white together and flatten every colour the bands
      // are using to say what they are made of.
      float lum = dot(accum, vec3(0.2126, 0.7152, 0.0722));
      float mapped = pow(1.0 - exp(-lum * uExposure), uGamma);
      vec3 c = lum > 1e-7 ? accum * (mapped / lum) : vec3(0.0);

      float alpha = 1.0 - trans;
      gl_FragColor = vec4(c * uWeight, alpha * uWeight);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: VERTEX,
    fragmentShader: fragment,
    side: THREE.BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  const geometry = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
  root.add(new THREE.Mesh(geometry, material));

  return {
    root,
    uniforms: u,
    setWeight(w) { u.uWeight.value = w; },
    setPixelRatio() {},
    update(s) {
      const scale = 10 ** (refLevel - s);
      u.uCamObj.value.set(0, 0, CAMERA_DISTANCE / scale);
      u.uDetail.value = scale;
      u.uTime.value = performance.now() / 1000;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      root.clear();
    },
  };
}
