// Convert McConnachie's Nearby Galaxies catalogue into the JSON the Local
// Group band loads.
//
//   node tools/build-galaxy-catalog.mjs <NearbyGalaxies.fits> [--out assets/galaxies.json]
//
// Source: A. W. McConnachie (2012), AJ 144, 4 — "The Observed Properties of
// Dwarf Galaxies in and around the Local Group", January 2021 public release.
// Every nearby galaxy within ~3 Mpc, which is exactly the span the band covers.
//
// Only 144 rows, so JSON rather than a packed binary: it stays readable and
// still costs a few tens of kilobytes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BLOCK = 2880;
/** The catalogue uses 999 to mean "no measurement". */
const MISSING = 999;

function readHeader(buf, off) {
  const cards = {};
  let o = off;
  let done = false;
  while (!done) {
    for (let i = 0; i < BLOCK; i += 80) {
      const card = buf.toString('ascii', o + i, o + i + 80);
      const key = card.slice(0, 8).trim();
      if (key === 'END') { done = true; break; }
      if (card[8] === '=') {
        cards[key] = card.slice(9, 80).split('/')[0].trim().replace(/^'|'$/g, '').trim();
      }
    }
    o += BLOCK;
  }
  return { cards, end: o };
}

/** Minimal FITS BINTABLE reader — enough for ASCII, float and short columns. */
function readBinTable(buf) {
  const primary = readHeader(buf, 0);
  const ext = readHeader(buf, primary.end);
  if (ext.cards.XTENSION !== 'BINTABLE') throw new Error(`expected BINTABLE, got ${ext.cards.XTENSION}`);

  const rowBytes = Number(ext.cards.NAXIS1);
  const rows = Number(ext.cards.NAXIS2);
  const cols = [];
  let off = 0;
  for (let i = 1; i <= Number(ext.cards.TFIELDS); i++) {
    const m = ext.cards[`TFORM${i}`].match(/^(\d*)([A-Z])/);
    const rep = m[1] ? Number(m[1]) : 1;
    const type = m[2];
    const width = { A: rep, E: 4, I: 2, J: 4, D: 8 }[type];
    if (width === undefined) throw new Error(`unsupported TFORM ${ext.cards[`TFORM${i}`]}`);
    cols.push({ name: ext.cards[`TTYPE${i}`], type, off, width });
    off += width;
  }
  if (off !== rowBytes) throw new Error(`column widths sum to ${off}, header says ${rowBytes}`);

  const byName = new Map(cols.map((c) => [c.name, c]));
  const get = (row, name) => {
    const c = byName.get(name);
    if (!c) throw new Error(`no column ${name}`);
    const base = ext.end + row * rowBytes + c.off;
    if (c.type === 'A') return buf.toString('ascii', base, base + c.width).trim();
    if (c.type === 'E') return buf.readFloatBE(base);
    if (c.type === 'I') return buf.readInt16BE(base);
    return null;
  };
  return { rows, get };
}

/** "13:57:12.0" in hours -> degrees; "-27:40:0.0" in degrees -> degrees. */
function sexagesimal(text, isHours) {
  const neg = text.trim().startsWith('-');
  const [a, b, c] = text.replace('-', '').split(':').map(Number);
  const v = Math.abs(a) + (b || 0) / 60 + (c || 0) / 3600;
  const deg = isHours ? v * 15 : v;
  return neg ? -deg : deg;
}

/**
 * Equatorial (J2000) unit vector to galactic cartesian, then into scene axes.
 *
 * Standard galactic cartesian puts +x toward the galactic centre. The scene
 * instead puts the *Sun* at the origin with the centre at -x, matching
 * galactic-field.js, so x and y are negated — a 180-degree turn about z, which
 * keeps the handedness.
 */
function equatorialToScene(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const e = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const M = [
    [-0.0548755604, -0.8734370902, -0.4838350155],
    [+0.4941094279, -0.4448296300, +0.7469822445],
    [-0.8676661490, -0.1980763734, +0.4559837762],
  ];
  const g = M.map((row) => row[0] * e[0] + row[1] * e[1] + row[2] * e[2]);
  return [-g[0], -g[1], g[2]];
}

/**
 * Rough morphology. The catalogue carries no type column, so this infers one
 * from HI gas mass and luminosity: gas-rich systems are star-forming and blue,
 * gas-poor ones old and red.
 *
 * Unknown gas mass must not be read as gas-poor — that is what first put M33,
 * NGC 55 and NGC 300 (all spirals) in the elliptical bucket. Only a confirmed
 * zero means gas-poor.
 *
 * Accuracy matters only for the handful of galaxies large enough to show
 * structure at these scales; below that everything is a few pixels of fuzz.
 */
function classify(absMag, mHI) {
  const known = Number.isFinite(mHI);
  const gasRich = known && mHI > 0;
  if (absMag < -17) return known && !gasRich ? 'elliptical' : 'spiral';
  if (gasRich) return 'irregular';
  if (!known && absMag < -13) return 'irregular';
  return 'spheroidal';
}

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'assets/galaxies.json';
if (!source) {
  console.error('usage: node tools/build-galaxy-catalog.mjs <NearbyGalaxies.fits> [--out path]');
  process.exit(1);
}

/**
 * The two large spirals, which the catalogue does not contain.
 *
 * It is a catalogue of *dwarf* galaxies in and around the Local Group, so the
 * Milky Way and M31 appear only as the hosts whose satellites are listed. They
 * are also the two dominant objects in the whole volume, so they are added here
 * from standard values rather than left out.
 *
 * The Milky Way is placed by its centre, which sits 8.178 kpc from the Sun
 * toward -x (GRAVITY 2019); everything else in this file is heliocentric.
 */
const SUPPLEMENTARY = [
  {
    name: 'MilkyWay',
    scene: [-8.178, 0, 0],
    distKpc: 8.178,
    absMag: -20.9,
    halfLightKpc: 5.0,
    ellipticity: 0,      // seen face-on from galactic north
    positionAngle: 0,
    type: 'spiral',
  },
  {
    name: 'M31',
    ra: '0:42:44.3',
    dec: '41:16:9',
    distKpc: 785,
    absMag: -21.2,
    halfLightKpc: 10.0,
    ellipticity: 0.73,   // inclined about 77 degrees
    positionAngle: 38,
    type: 'spiral',
  },
];

const buf = readFileSync(source);
const table = readBinTable(buf);

const galaxies = [];
const skipped = { noDistance: 0, noMagnitude: 0 };

for (let r = 0; r < table.rows; r++) {
  // Leading '*' marks candidate/unconfirmed objects in the catalogue.
  const name = table.get(r, 'GalaxyName').replace(/^\*/, '');
  const dmod = table.get(r, 'dmod');
  const vmag = table.get(r, 'Vmag');
  if (!Number.isFinite(dmod) || dmod >= MISSING) { skipped.noDistance++; continue; }
  if (!Number.isFinite(vmag) || vmag >= MISSING) { skipped.noMagnitude++; continue; }

  const distKpc = 10 ** ((dmod + 5) / 5) / 1000;
  const absMag = vmag - dmod;

  const ra = sexagesimal(table.get(r, 'RA'), true);
  const dec = sexagesimal(table.get(r, 'Dec'), false);
  const [ux, uy, uz] = equatorialToScene(ra, dec);

  // Half-light radius, arcmin -> kpc at the galaxy's distance.
  const rhArcmin = table.get(r, 'rh');
  // Where no size is measured, fall back on the dwarf size-luminosity relation:
  // brighter dwarfs are larger, very roughly as 10^(-0.2 M).
  const rhKpc = Number.isFinite(rhArcmin) && rhArcmin < MISSING
    ? distKpc * Math.tan((rhArcmin / 60) * (Math.PI / 180))
    : 0.04 * 10 ** (-0.2 * (absMag + 8));

  const ell = table.get(r, 'e=1-b');
  const pa = table.get(r, 'PA');
  const mHI = table.get(r, 'MHI');

  galaxies.push({
    name,
    // Scene position, kpc, Sun at the origin.
    x: +(distKpc * ux).toFixed(3),
    y: +(distKpc * uy).toFixed(3),
    z: +(distKpc * uz).toFixed(3),
    distKpc: +distKpc.toFixed(2),
    absMag: +absMag.toFixed(2),
    halfLightKpc: +rhKpc.toFixed(4),
    measuredSize: Number.isFinite(rhArcmin) && rhArcmin < MISSING,
    ellipticity: Number.isFinite(ell) && ell < MISSING ? +ell.toFixed(3) : 0,
    positionAngle: Number.isFinite(pa) && Math.abs(pa) < MISSING ? +pa.toFixed(1) : 0,
    type: classify(absMag, Number.isFinite(mHI) && mHI < MISSING ? mHI : NaN),
  });
}

for (const s of SUPPLEMENTARY) {
  const scene = s.scene ?? (() => {
    const [ux, uy, uz] = equatorialToScene(sexagesimal(s.ra, true), sexagesimal(s.dec, false));
    return [s.distKpc * ux, s.distKpc * uy, s.distKpc * uz];
  })();
  galaxies.push({
    name: s.name,
    x: +scene[0].toFixed(3), y: +scene[1].toFixed(3), z: +scene[2].toFixed(3),
    distKpc: s.distKpc,
    absMag: s.absMag,
    halfLightKpc: s.halfLightKpc,
    measuredSize: true,
    ellipticity: s.ellipticity,
    positionAngle: s.positionAngle,
    type: s.type,
    supplementary: true,
  });
}

galaxies.sort((a, b) => a.absMag - b.absMag);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  source: 'McConnachie 2012, AJ 144, 4 (Jan 2021 public release)',
  frame: 'heliocentric; +z galactic north, galactic centre toward -x; kpc',
  count: galaxies.length,
  galaxies,
}, null, 1));

const byType = galaxies.reduce((m, g) => ({ ...m, [g.type]: (m[g.type] ?? 0) + 1 }), {});
console.log(`read      ${table.rows} rows`);
console.log(`skipped   ${skipped.noDistance} without distance, ${skipped.noMagnitude} without magnitude`);
console.log(`kept      ${galaxies.length}`);
console.log(`types     ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`distance  ${Math.min(...galaxies.map((g) => g.distKpc)).toFixed(0)} .. ${Math.max(...galaxies.map((g) => g.distKpc)).toFixed(0)} kpc`);
console.log(`brightest ${galaxies.slice(0, 6).map((g) => `${g.name} (${g.absMag})`).join(', ')}`);
console.log(`wrote     ${out}  ${(JSON.stringify(galaxies).length / 1024).toFixed(0)} kB`);
