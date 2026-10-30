// Skin, 10^-1..10^-3 m (10 cm down to a millimetre).
//
// Where the inward journey starts: the back of a hand, then the ridges and
// pores of its surface. A displaced surface rather than a volume — the light
// is reflected, not emitted — but the same march renders it, with absorption
// standing in for opacity and a cheap gradient normal for shading.

import { createVolumeBand } from './raymarch.js';

const glsl = /* glsl */ `
  // Surface height. Friction ridges run in long parallel curves, warped by
  // low-frequency noise so they never read as a grating.
  float skinHeight(vec3 p) {
    float warp = fbm(p * 3.4, 4);
    float ridge = sin((p.x * 46.0 + warp * 26.0) + sin(p.y * 7.0) * 2.2);
    ridge = 0.5 + 0.5 * ridge;
    float pores = fbm(p * 52.0, 3);
    return -0.05
      + 0.055 * fbm(p * 2.1, 4)
      + 0.014 * ridge
      - 0.010 * smoothstep(0.62, 0.95, pores);
  }

  void sampleVolume(vec3 p, out vec3 emit, out float absorb) {
    float h = skinHeight(p);
    float below = h - p.z;
    float surf = smoothstep(-0.004, 0.012, below);
    if (surf <= 0.0) { emit = vec3(0.0); absorb = 0.0; return; }

    // Gradient normal from the height field, for a single key light.
    float e = 0.004;
    vec3 n = normalize(vec3(
      skinHeight(p + vec3(e,0,0)) - skinHeight(p - vec3(e,0,0)),
      skinHeight(p + vec3(0,e,0)) - skinHeight(p - vec3(0,e,0)),
      2.0 * e));
    float key = clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);

    // Subsurface: blood under skin reddens the shadowed side rather than
    // darkening it, which is most of what makes skin look like skin.
    vec3 lit = vec3(0.98, 0.80, 0.69) * (0.25 + 0.85 * key);
    vec3 deep = vec3(0.62, 0.24, 0.21);
    emit = mix(deep, lit, key) * surf * 3.0;
    absorb = surf * 120.0;
  }
`;

export function tissueBand() {
  const refLevel = -1;
  return {
    name: 'tissue',
    from: -3,
    to: -1,
    ref: refLevel,
    create: () => createVolumeBand({ glsl, boxHalf: [2.2, 2.2, 0.22], refLevel, steps: 88, exposure: 7.2 }),
  };
}
