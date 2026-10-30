// Diagnostic decade content.
//
// Real art comes later; what matters now is proving the renormalisation is
// correct. Each decade draws a 10x10 grid spanning its unit square, so one
// cell of decade n is *exactly* the full extent of decade n-1's unit square.
// If the scale maths is off by even a little, adjacent decades visibly fail to
// nest — which makes this the cheapest possible correctness test for the whole
// architecture.

import * as THREE from 'three';

import { superscript } from './format.js';
import { mulberry32 } from './rng.js';

/** Deterministic PRNG so a decade looks the same on every rebuild. */
function hueForLevel(level) {
  // Large stride keeps neighbouring decades clearly distinguishable.
  return (((level * 47) % 360) + 360) % 360 / 360;
}

/**
 * A grid of 1/10-unit cells with one cell centred exactly on the origin.
 *
 * The cell count must be odd for that to be possible. An even grid spanning
 * the unit square puts a grid *line* through the origin, which offsets every
 * cell by half a cell from the next decade down and destroys the nesting the
 * whole diagnostic exists to show. The grid runs half a cell past the unit
 * outline on each side, which also mimics real content spilling past the frame.
 */
function makeGrid(cells = 11, cellSize = 0.1) {
  const half = (cells * cellSize) / 2;
  const pts = [];
  for (let i = 0; i <= cells; i++) {
    const t = -half + i * cellSize;
    pts.push(t, -half, 0, t, half, 0);
    pts.push(-half, t, 0, half, t, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

function makeOutline() {
  const h = 0.5;
  const pts = [-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

function makePoints(level, count = 260) {
  const rnd = mulberry32(level * 7919 + 13);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3 + 0] = (rnd() - 0.5) * 0.95;
    pos[i * 3 + 1] = (rnd() - 0.5) * 0.95;
    pos[i * 3 + 2] = (rnd() - 0.5) * 0.3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = '600 76px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.17, 0.0425, 1);
  return sprite;
}

/**
 * Build one decade's content.
 *
 * Authored in normalised units: 1 unit = 10^level metres. Nothing in here
 * knows what level it is beyond colour and label — that is the point. The
 * Stage decides where it lands.
 *
 * @param {number} level
 * @returns {{root: THREE.Group, setOpacity(o: number): void, dispose(): void}}
 */
export function createDiagnosticDecade(level) {
  const root = new THREE.Group();
  root.name = `decade:${level}`;

  const color = new THREE.Color().setHSL(hueForLevel(level), 0.62, 0.62);
  const materials = [];
  const geometries = [];

  const gridGeo = makeGrid();
  const gridMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  geometries.push(gridGeo);
  materials.push(gridMat);

  const outlineGeo = makeOutline();
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
  const outline = new THREE.LineSegments(outlineGeo, outlineMat);
  geometries.push(outlineGeo);
  materials.push(outlineMat);

  const pointsGeo = makePoints(level);
  const pointsMat = new THREE.PointsMaterial({
    color, size: 0.012, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(pointsGeo, pointsMat);
  geometries.push(pointsGeo);
  materials.push(pointsMat);

  // Inside the unit square's lower-left corner, where it cannot collide with
  // the HUD's square labels (which sit outside the upper-left corner).
  const label = makeLabelSprite(`10${superscript(level)}`, `#${color.getHexString()}`);
  label.position.set(-0.5 + 0.098, -0.5 + 0.038, 0);
  materials.push(label.material);

  root.add(grid, outline, points, label);

  // Base opacities differ per element; the cross-fade weight multiplies them.
  const bases = [[gridMat, 0.42], [outlineMat, 0.95], [pointsMat, 0.9], [label.material, 1]];

  return {
    level,
    root,
    setWeight(w) {
      for (const [mat, base] of bases) mat.opacity = base * w;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
      root.clear();
    },
  };
}
