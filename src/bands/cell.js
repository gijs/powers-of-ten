// Cells, 10^-4..10^-6 m (100 microns down to a micron).
//
// Packed cells with nuclei, then the inside of one. Built on a jittered
// lattice: each lattice point owns a cell, and the distance to the nearest
// point gives both the membrane and somewhere to hang a nucleus.

import { createVolumeBand } from './raymarch.js';

const glsl = /* glsl */ `
  // Nearest jittered lattice point: returns distance, and the cell's own id
  // so each can be tinted and sized differently.
  void nearestCell(vec3 p, float scale, out float dist, out vec3 id, out vec3 centre) {
    vec3 g = floor(p * scale);
    dist = 1e9;
    for (int i = -1; i <= 1; i++)
      for (int j = -1; j <= 1; j++)
        for (int k = -1; k <= 1; k++) {
          vec3 cell = g + vec3(float(i), float(j), float(k));
          vec3 jitter = vec3(hash13(cell), hash13(cell + 11.3), hash13(cell + 27.7));
          vec3 c = (cell + 0.25 + 0.5 * jitter) / scale;
          float d = length(p - c);
          if (d < dist) { dist = d; id = cell; centre = c; }
        }
  }

  void sampleVolume(vec3 p, out vec3 emit, out float absorb) {
    float dist; vec3 id, centre;
    nearestCell(p, 5.2, dist, id, centre);

    float radius = (0.082 + 0.030 * hash13(id + 3.1));
    // Membrane: a shell, not a filled ball, so cells read as containers.
    float body = smoothstep(radius, radius * 0.80, dist);
    float shell = smoothstep(radius, radius * 0.93, dist) - smoothstep(radius * 0.93, radius * 0.80, dist);

    // Nucleus, offset from the cell's centre.
    vec3 off = (vec3(hash13(id + 5.5), hash13(id + 9.9), hash13(id + 13.1)) - 0.5) * radius * 0.5;
    float nd = length(p - centre - off);
    float nucleus = smoothstep(radius * 0.34, radius * 0.18, nd);

    // Cytoplasm granularity.
    float grain = fbm(p * 90.0, 3);

    vec3 cyto = mix(vec3(0.30, 0.52, 0.62), vec3(0.45, 0.70, 0.74), grain);
    vec3 wall = vec3(0.82, 0.92, 0.96);
    vec3 core = vec3(0.86, 0.62, 0.78);

    emit = (cyto * body * 0.55 + wall * shell * 2.6 + core * nucleus * 2.2);
    absorb = body * 10.0 + shell * 42.0 + nucleus * 26.0;
  }
`;

export function cellBand() {
  const refLevel = -4;
  return {
    name: 'cell',
    from: -6,
    to: -4,
    ref: refLevel,
    create: () => createVolumeBand({ glsl, boxHalf: [2.4, 2.4, 0.7], refLevel, steps: 112, exposure: 4.0 }),
  };
}
