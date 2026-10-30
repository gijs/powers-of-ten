// Unit / time formatting for the HUD readouts.
//
// Everything here takes SI base units (metres, seconds) and returns display
// strings. Kept dependency-free and side-effect-free so it is trivially testable.

export const C_LIGHT = 299792458; // m/s
export const AU = 1.495978707e11; // m
export const LIGHT_YEAR = 9.4607304725808e15; // m
export const PARSEC = 3.0856775814913673e16; // m

const SI_PREFIXES = [
  { e: -24, sym: 'y' }, { e: -21, sym: 'z' }, { e: -18, sym: 'a' },
  { e: -15, sym: 'f' },  { e: -12, sym: 'p' }, { e: -9,  sym: 'n' },
  { e: -6,  sym: 'µ' }, { e: -3, sym: 'm' }, { e: 0, sym: '' },
  { e: 3,   sym: 'k' },  { e: 6,   sym: 'M' }, { e: 9,   sym: 'G' },
  { e: 12,  sym: 'T' },  { e: 15,  sym: 'P' }, { e: 18,  sym: 'E' },
  { e: 21,  sym: 'Z' },  { e: 24,  sym: 'Y' },
];

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Render an integer as Unicode superscript digits, e.g. -16 -> "⁻¹⁶". */
export function superscript(n) {
  return String(n).split('').map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
}

/** "10⁵" style power-of-ten label. */
export function powerLabel(n, unit = 'm') {
  return `10${superscript(n)} ${unit}`;
}

function mantissaDigits(m) {
  // Keep roughly three significant figures without trailing noise.
  if (m >= 100) return 0;
  if (m >= 10) return 1;
  return 2;
}

function trimZeros(str) {
  return str.includes('.') ? str.replace(/\.?0+$/, '') : str;
}

/**
 * Format a length in metres using SI prefixes.
 * @param {number} metres
 * @returns {string} e.g. "1.5 km", "250 pm"
 */
export function formatMetres(metres) {
  if (!Number.isFinite(metres) || metres === 0) return '0 m';
  const exp = Math.floor(Math.log10(Math.abs(metres)));
  // Snap to the nearest prefix at or below our magnitude.
  const group = Math.max(-24, Math.min(24, Math.floor(exp / 3) * 3));
  const prefix = SI_PREFIXES.find((p) => p.e === group) ?? SI_PREFIXES[8];
  const mantissa = metres / 10 ** prefix.e;
  return `${trimZeros(mantissa.toFixed(mantissaDigits(mantissa)))} ${prefix.sym}m`;
}

/**
 * Astronomical framing for a length, where one applies. Returns null below
 * planetary scales so the caller can omit the line entirely.
 */
export function formatAstronomical(metres) {
  const abs = Math.abs(metres);
  if (abs >= 1e3 * LIGHT_YEAR) {
    const ly = metres / LIGHT_YEAR;
    const exp = Math.floor(Math.log10(ly));
    const group = Math.min(9, Math.floor(exp / 3) * 3);
    const sym = { 3: 'k', 6: 'M', 9: 'G' }[group] ?? '';
    const m = ly / 10 ** group;
    return `${trimZeros(m.toFixed(mantissaDigits(m)))} ${sym}ly`;
  }
  if (abs >= 0.05 * LIGHT_YEAR) {
    const ly = metres / LIGHT_YEAR;
    return `${trimZeros(ly.toFixed(mantissaDigits(ly)))} ly`;
  }
  if (abs >= 0.05 * AU) {
    const au = metres / AU;
    return `${trimZeros(au.toFixed(mantissaDigits(au)))} AU`;
  }
  return null;
}

const TIME_UNITS = [
  { s: 1e-24, sym: 'ys' }, { s: 1e-21, sym: 'zs' }, { s: 1e-18, sym: 'as' },
  { s: 1e-15, sym: 'fs' }, { s: 1e-12, sym: 'ps' }, { s: 1e-9,  sym: 'ns' },
  { s: 1e-6,  sym: 'µs' }, { s: 1e-3, sym: 'ms' }, { s: 1, sym: 's' },
  { s: 60, sym: 'min' }, { s: 3600, sym: 'h' }, { s: 86400, sym: 'd' },
  { s: 31557600, sym: 'yr' }, { s: 31557600e3, sym: 'kyr' },
  { s: 31557600e6, sym: 'Myr' }, { s: 31557600e9, sym: 'Gyr' },
];

/**
 * Format a duration in seconds, choosing the largest unit that keeps the
 * mantissa >= 1. Spans femtoseconds to gigayears, which is what a 41-decade
 * light-travel-time readout needs.
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds === 0) return '0 s';
  const abs = Math.abs(seconds);
  let chosen = TIME_UNITS[0];
  for (const u of TIME_UNITS) if (abs >= u.s) chosen = u;
  const m = seconds / chosen.s;
  return `${trimZeros(m.toFixed(mantissaDigits(m)))} ${chosen.sym}`;
}

/** Time for light to cross a frame `metres` wide. The film shows this. */
export function lightCrossingTime(metres) {
  return metres / C_LIGHT;
}

/** mm:ss for the playhead. */
export function formatClock(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
