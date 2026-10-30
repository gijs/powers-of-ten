// The nucleus, 10^-13..10^-16 m (down to the quark scale).
//
// Where the film ends. One local unit is 10 femtometres, so a carbon nucleus —
// about 5 fm across — is half a unit, its nucleons are a tenth of one, and by
// the innermost decade the frame is inside a single proton.
//
// Everything here is a glow rather than a surface. Nucleons have no edge to
// draw: what the last frames of the original show is energy, not objects, and
// a hard sphere would be a worse lie than a soft one.

import { createVolumeBand } from './raymarch.js';

const glsl = /* glsl */ `
  // Twelve nucleons on a shell, jittered — carbon, loosely.
  vec3 nucleonAt(float i) {
    float a = hash13(vec3(i, 1.7, 3.3)) * 2.0 * PI;
    float b = acos(2.0 * hash13(vec3(i, 7.1, 2.9)) - 1.0);
    float r = 0.16 + 0.07 * hash13(vec3(i, 4.4, 8.8));
    return vec3(sin(b) * cos(a), sin(b) * sin(a), cos(b)) * r;
  }

  void sampleVolume(vec3 p, out vec3 emit, out float absorb) {
    float d = length(p);
    if (d > 1.2) { emit = vec3(0.0); absorb = 0.0; return; }

    // Nucleons.
    float nucleons = 0.0;
    vec3 tint = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      vec3 c = nucleonAt(float(i));
      float q = length(p - c) / 0.085;
      float g = exp(-q * q * 2.4);
      nucleons += g;
      // Protons warm, neutrons cool — not visible, but the film draws them
      // differently and so does everyone since.
      tint += g * (mod(float(i), 2.0) < 0.5 ? vec3(1.00, 0.55, 0.40) : vec3(0.60, 0.72, 0.95));
    }
    if (nucleons > 1e-4) tint /= nucleons;

    // Quarks, visible only once the frame is inside a single nucleon.
    vec3 host = nucleonAt(0.0);
    float inHost = exp(-pow(length(p - host) / 0.085, 2.0) * 1.2);
    float quarks = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 2.0944 + uTime * 0.35;
      vec3 qc = host + vec3(cos(a), sin(a), sin(a * 1.7) * 0.4) * 0.030;
      float q = length(p - qc) / 0.011;
      quarks += exp(-q * q * 2.0);
    }

    // The colour field binding them, visible as a haze between.
    float flux = inHost * (0.3 + 0.7 * fbm(p * 90.0 + uTime * 0.6, 3));

    emit = tint * nucleons * 2.4
         + vec3(1.00, 0.92, 0.72) * quarks * 5.0
         + vec3(0.45, 0.85, 0.70) * flux * 0.55;
    absorb = nucleons * 1.2 + quarks * 2.0;
  }
`;

export function nucleusBand() {
  const refLevel = -14;
  return {
    name: 'nucleus',
    from: -16,
    to: -13,
    ref: refLevel,
    create: () => createVolumeBand({ glsl, boxHalf: [1.4, 1.4, 1.4], refLevel, steps: 112, exposure: 9.0 }),
  };
}
