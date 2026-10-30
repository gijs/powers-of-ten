// Atoms, 10^-10..10^-12 m (an angstrom down to a picometre).
//
// Electron probability clouds, drawn from the closed-form hydrogen-like
// orbitals rather than approximated — |psi|^2 for a given n, l, m is a short
// expression, so the shapes here are the real ones and cost nothing to store.
//
// The band stops at 10^-11. Below that the frame is inside the dense 1s core,
// which integrates to flat white however it is exposed — and physically there
// is nothing to see there anyway: an atom is almost entirely empty space
// between its electron cloud and a nucleus still two decades further in. Those
// decades are left to the diagnostic grid rather than faked.

import { createVolumeBand } from './raymarch.js';

const glsl = /* glsl */ `
  // Hydrogen-like radial parts, in Bohr radii, for the shells a carbon atom
  // actually occupies. Normalisation is dropped — only the shape matters once
  // the result is exposed.
  float psi2_1s(float r) { float f = exp(-r); return f * f; }
  float psi2_2s(float r) { float f = (2.0 - r) * exp(-r * 0.5); return f * f; }
  float psi2_2p(float r, float ct) { float f = r * exp(-r * 0.5) * ct; return f * f; }

  void sampleVolume(vec3 p, out vec3 emit, out float absorb) {
    // One local unit is 1 angstrom; the Bohr radius is 0.529 of one.
    float r = length(p) / 0.529;
    if (r > 14.0) { emit = vec3(0.0); absorb = 0.0; return; }
    float ct = r > 1e-5 ? p.z / max(length(p), 1e-6) : 0.0;

    float inner = psi2_1s(r) * 2.2;
    float outer = psi2_2s(r) * 0.55
                + psi2_2p(r, ct) * 0.30
                + psi2_2p(r, p.x / max(length(p), 1e-6)) * 0.30;

    // Electrons are a probability density, not a fluid; the grain keeps it
    // from reading as a solid shell.
    float grain = 0.55 + 0.9 * fbm(p * 26.0 + uTime * 0.05, 3);

    vec3 innerCol = vec3(0.72, 0.88, 1.00);
    vec3 outerCol = vec3(0.38, 0.54, 1.00);

    // Sharpen. A probability density falls off smoothly by nature, and
    // integrated along a ray it comes out as an even haze with no shape in it.
    // Raising the contrast is what lets the shells and the lobes of the p
    // orbitals read as structure rather than as fog.
    inner = pow(inner, 1.35);
    outer = pow(outer, 1.35);
    float density = (inner + outer) * grain;

    emit = (innerCol * inner + outerCol * outer) * grain * 2.4;
    absorb = density * 0.45;
  }
`;

export function atomBand() {
  const refLevel = -10;
  return {
    name: 'atom',
    from: -11,
    to: -10,
    ref: refLevel,
    create: () => createVolumeBand({ glsl, boxHalf: [4.5, 4.5, 4.5], refLevel, steps: 96, exposure: 0.55 }),
  };
}
