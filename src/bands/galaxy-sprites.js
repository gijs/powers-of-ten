// Galaxy sprites: shared billboard rendering for anything drawn as galaxies.
//
// Used by both the catalogued Local Group and the procedural cosmic web, which
// cross-fade into each other — so, as with the two star bands, how a galaxy is
// drawn lives in one place and cannot drift between them.
//
// Brightness is surface brightness, not magnitude. Galaxies are *extended*
// objects: total flux falls as 1/distance^2, but so does apparent area, so
// surface brightness does not change with distance at all. Drawing each at its
// intrinsic surface brightness and letting the sprite's size carry the distance
// is both simpler and more correct than the recession-and-exposure treatment
// the point bands need.

import * as THREE from 'three';

export const TYPE_ID = { spiral: 0, irregular: 1, elliptical: 2, spheroidal: 2 };

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
 * A billboard field whose instances can be supplied later.
 *
 * @param {object} [opts]
 * @param {number} [opts.exposure]
 * @param {number} [opts.gamma]
 */
export function createGalaxySprites({ exposure = 20.0, gamma = 0.70 } = {}) {
  const root = new THREE.Group();

  const uniforms = {
    uWeight: { value: 0 },
    uScale: { value: 1 },
    uExposure: { value: exposure },
    uGamma: { value: gamma },
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

    /** @param {{count:number, aPos:Float32Array, aSize:Float32Array, aShape:Float32Array, aBright:Float32Array}} data */
    setData(data) {
      geometry?.dispose();
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
      // bounds say nothing about where they end up on screen.
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      base.dispose();
      root.clear();
      root.add(new THREE.Mesh(geometry, material));
    },

    setWeight(w) { uniforms.uWeight.value = w; },
    setPixelRatio() {},
    /** @param {number} refLevel the owning band's reference decade */
    updateScale(refLevel, s) { uniforms.uScale.value = 10 ** (refLevel - s); },
    dispose() {
      geometry?.dispose();
      material.dispose();
      root.clear();
    },
  };
}
