// DNA, 10^-7..10^-9 m (100 nanometres down to an angstrom-ish).
//
// A B-form double helix: 2 nm across, 3.4 nm per turn, ten base pairs to the
// turn. Authored around 10^-8 m, so one local unit is 10 nm and the helix is
// 0.2 units wide — thin, which is correct, and why the band opens on a thread
// and only resolves into a helix as it closes.

import { createVolumeBand } from './raymarch.js';

/** One nanometre, in band-local units (1 unit = 10 nm). */
const NM = 0.1;

const glsl = /* glsl */ `
  uniform float uNm;

  // Distance to one strand of a helix running along x.
  //
  // Along x, not z: the camera looks down -z, so a helix on that axis is seen
  // end-on and renders as a disc with no helix visible in it at all.
  float strandDist(vec3 p, float phase, float radius, float pitch) {
    float a = p.x * (2.0 * PI / pitch) + phase;
    vec2 centre = vec2(cos(a), sin(a)) * radius;
    return length(p.yz - centre);
  }

  void sampleVolume(vec3 p, out vec3 emit, out float absorb) {
    float radius = 1.0 * uNm;      // 1 nm from axis
    float pitch  = 3.4 * uNm;      // one full turn
    float thick  = 0.34 * uNm;

    float d1 = strandDist(p, 0.0, radius, pitch);
    float d2 = strandDist(p, PI * 0.78, radius, pitch);   // minor groove offset
    float backbone = min(d1, d2);
    float strands = smoothstep(thick, thick * 0.45, backbone);

    // Base pairs: rungs every 0.34 nm, drawn only between the two strands.
    float rung = abs(fract(p.x / (0.34 * uNm)) - 0.5) * 2.0;
    float across = smoothstep(radius * 1.15, radius * 0.9, length(p.yz));
    float bases = smoothstep(0.62, 0.95, rung) * across;

    vec3 backboneCol = vec3(0.55, 0.78, 1.00);
    vec3 baseCol = mix(vec3(1.00, 0.72, 0.42), vec3(0.72, 1.00, 0.68),
                       step(0.5, hash13(vec3(floor(p.x / (0.34 * uNm)), 0.0, 0.0))));

    emit = backboneCol * strands * 3.2 + baseCol * bases * 2.2;
    absorb = strands * 70.0 + bases * 34.0;
  }
`;

export function moleculeBand() {
  const refLevel = -8;
  return {
    name: 'molecule',
    from: -9,
    to: -7,
    ref: refLevel,
    create: () => createVolumeBand({
      glsl, boxHalf: [2.6, 0.9, 0.9], refLevel, steps: 128, exposure: 14.0,
      uniforms: { uNm: { value: NM } },
    }),
  };
}
