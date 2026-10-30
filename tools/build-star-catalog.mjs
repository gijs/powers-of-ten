// Convert the HYG star catalog into the compact binary the stars band loads.
//
//   node tools/build-star-catalog.mjs <hygdata.csv.gz> [--out assets/stars.bin]
//
// JSON would be roughly 30x the size for the same numbers, and would have to be
// parsed and re-packed into typed arrays at runtime. This writes the typed
// arrays directly, so the band uploads straight from the decoded buffer.
//
// Source: HYG Database (astronexus), CC BY-SA 4.0.

import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';

/** Metres per parsec. */
const PARSEC = 3.0856775814913673e16;
/** The band's reference decade: local unit = 10^REF metres. */
const REF_LEVEL = 17;
/**
 * Keep stars out to here. The band owns 10^17..10^19 m (~3.2 to ~324 pc) and
 * stays partly visible while it cross-fades out past that, so the catalogue
 * needs headroom beyond its nominal outer edge.
 */
const MAX_PARSECS = 900;
/** HYG uses this distance for stars with no usable parallax. */
const UNKNOWN_DISTANCE = 100000;

function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'assets/stars.bin';
if (!source) {
  console.error('usage: node tools/build-star-catalog.mjs <hygdata.csv.gz> [--out path]');
  process.exit(1);
}

const stream = source.endsWith('.gz')
  ? createReadStream(source).pipe(createGunzip())
  : createReadStream(source);

const rl = createInterface({ input: stream, crlfDelay: Infinity });

let cols = null;
const xs = [];
const ys = [];
const zs = [];
const mags = [];
const cis = [];
const stats = { rows: 0, noDistance: 0, tooFar: 0, noMagnitude: 0, sol: 0 };

for await (const line of rl) {
  if (!line) continue;
  const f = splitCsv(line);
  if (!cols) {
    cols = Object.fromEntries(f.map((name, i) => [name.replace(/"/g, ''), i]));
    for (const need of ['x', 'y', 'z', 'absmag', 'ci', 'dist']) {
      if (!(need in cols)) throw new Error(`missing column: ${need}`);
    }
    continue;
  }
  stats.rows++;

  const dist = Number(f[cols.dist]);
  if (!Number.isFinite(dist) || dist <= 0) { stats.sol++; continue; } // Sol sits at 0
  if (dist >= UNKNOWN_DISTANCE) { stats.noDistance++; continue; }
  if (dist > MAX_PARSECS) { stats.tooFar++; continue; }

  const absmag = Number(f[cols.absmag]);
  if (!Number.isFinite(absmag)) { stats.noMagnitude++; continue; }

  // Parsecs -> band-local units.
  const k = PARSEC / 10 ** REF_LEVEL;
  xs.push(Number(f[cols.x]) * k);
  ys.push(Number(f[cols.y]) * k);
  zs.push(Number(f[cols.z]) * k);
  mags.push(absmag);
  // Colour index is blank for a minority; 0.65 is roughly solar, a safe default.
  const ci = Number(f[cols.ci]);
  cis.push(Number.isFinite(ci) ? ci : 0.65);
}

const count = xs.length;

// Layout: 16-byte header, then three f32 arrays. Header is a multiple of 4 so
// every array that follows stays naturally aligned for zero-copy views.
const HEADER_BYTES = 16;
const buf = Buffer.alloc(HEADER_BYTES + count * (3 + 1 + 1) * 4);
buf.writeUInt32LE(0x30315450, 0); // "PT10"
buf.writeUInt32LE(1, 4);          // format version
buf.writeUInt32LE(count, 8);
buf.writeUInt32LE(REF_LEVEL, 12);

let o = HEADER_BYTES;
for (let i = 0; i < count; i++) {
  buf.writeFloatLE(xs[i], o); o += 4;
  buf.writeFloatLE(ys[i], o); o += 4;
  buf.writeFloatLE(zs[i], o); o += 4;
}
for (let i = 0; i < count; i++) { buf.writeFloatLE(mags[i], o); o += 4; }
for (let i = 0; i < count; i++) { buf.writeFloatLE(cis[i], o); o += 4; }

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);

// Fold rather than spread: these arrays have ~10^5 entries and spreading them
// into Math.max overflows the call stack.
const extent = (arr) => arr.reduce((m, v) => (Math.abs(v) > m ? Math.abs(v) : m), 0);
const range = (arr) => arr.reduce(
  ([lo, hi], v) => [v < lo ? v : lo, v > hi ? v : hi],
  [Infinity, -Infinity],
);

const radius = Math.max(extent(xs), extent(ys), extent(zs));
const [magLo, magHi] = range(mags);
const [ciLo, ciHi] = range(cis);
console.log(`read      ${stats.rows} rows`);
console.log(`skipped   ${stats.noDistance} no parallax, ${stats.tooFar} beyond ${MAX_PARSECS} pc, ${stats.noMagnitude} no absmag, ${stats.sol} at origin`);
console.log(`kept      ${count} stars`);
console.log(`extent    +/- ${radius.toFixed(1)} local units (1 unit = 10^${REF_LEVEL} m)`);
console.log(`absmag    ${magLo.toFixed(2)} .. ${magHi.toFixed(2)}`);
console.log(`ci        ${ciLo.toFixed(2)} .. ${ciHi.toFixed(2)}`);
console.log(`wrote     ${out}  ${(buf.length / 1048576).toFixed(2)} MB  (${(buf.length / count).toFixed(1)} bytes/star)`);
