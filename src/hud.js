// HUD — the nested measuring squares and typographic readouts.
//
// The squares are the single most recognisable thing about the film, and they
// fall straight out of the scale scalar. A square that denotes 10^L metres
// occupies, as a fraction of a frame that is 10^s metres wide:
//
//     10^L / 10^s = 10^(L - s)
//
// So with L = floor(s) and f = s - L (the fractional part of the decade), the
// primary square shrinks from its nominal size to exactly 1/10 of it as f runs
// 0 -> 1, the square one decade down trails it at 1/10 the size, and the one
// decade up sweeps in from off-frame. At f = 1 the whole arrangement is
// identical to f = 0 with L incremented: the cycle closes seamlessly.

import {
  formatMetres, formatAstronomical, formatDuration, formatClock,
  lightCrossingTime, powerLabel,
} from './format.js';

import { VIEW_W, VIEW_H, CENTRE_X, CENTRE_Y, BASE_SIDE } from './frame.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Slots are offsets from floor(s): the incoming square, the primary, the trailing one. */
const SLOTS = [1, 0, -1];

const smoothstep = (u) => u * u * (3 - 2 * u);

const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const html = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

export class Hud {
  /** @param {HTMLElement} mount element that already has the 4:3 letterbox shape */
  constructor(mount) {
    this.root = html('div', 'hud');
    mount.appendChild(this.root);

    this.svg = svg('svg', {
      class: 'hud-svg',
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'xMidYMid slice',
    });
    this.root.appendChild(this.svg);

    // Clip so an incoming square that is still ten times the frame width does
    // not paint outside the letterbox.
    const defs = svg('defs');
    const clip = svg('clipPath', { id: 'hud-frame-clip' });
    clip.appendChild(svg('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H }));
    defs.appendChild(clip);
    this.svg.appendChild(defs);

    this.squareLayer = svg('g', { 'clip-path': 'url(#hud-frame-clip)' });
    this.svg.appendChild(this.squareLayer);

    this.squares = SLOTS.map((offset) => {
      const g = svg('g', { class: 'hud-square' });
      const rect = svg('rect', { class: 'hud-square-rect', x: 0, y: 0, width: 0, height: 0 });
      const label = svg('text', { class: 'hud-square-label', x: 0, y: 0 });
      const ticks = svg('path', { class: 'hud-square-ticks', d: '' });
      g.append(rect, ticks, label);
      this.squareLayer.appendChild(g);
      return { offset, g, rect, label, ticks };
    });

    // Centre reticle: fixed, marks the point the whole outbound journey holds on.
    const reticle = svg('g', { class: 'hud-reticle' });
    reticle.appendChild(svg('path', {
      d: `M${CENTRE_X - 14} ${CENTRE_Y} h9 M${CENTRE_X + 5} ${CENTRE_Y} h9`
       + ` M${CENTRE_X} ${CENTRE_Y - 14} v9 M${CENTRE_X} ${CENTRE_Y + 5} v9`,
    }));
    this.svg.appendChild(reticle);

    // --- typographic layer (plain DOM: easier to lay out, crisper text) ---
    this.fieldPower = html('div', 'readout-power');
    this.fieldMetres = html('div', 'readout-line');
    this.fieldAstro = html('div', 'readout-line readout-dim');
    const tl = html('div', 'readout readout-tl');
    tl.append(html('div', 'readout-key', 'SQUARE SPANS'), this.fieldPower, this.fieldMetres, this.fieldAstro);

    this.lightTime = html('div', 'readout-line');
    const bl = html('div', 'readout readout-bl');
    bl.append(html('div', 'readout-key', 'LIGHT CROSSES SQUARE IN'), this.lightTime);

    this.clock = html('div', 'readout-line');
    this.phase = html('div', 'readout-line readout-dim');
    const br = html('div', 'readout readout-br');
    br.append(html('div', 'readout-key', 'ELAPSED'), this.clock, this.phase);

    this.progressFill = html('div', 'progress-fill');
    this.progress = html('div', 'progress');
    this.progress.appendChild(this.progressFill);

    this.root.append(tl, bl, br, this.progress);
  }

  setVisible(visible) {
    this.root.classList.toggle('hud-hidden', !visible);
  }

  /** @param {import('./scale-director.js').ScaleDirector} director */
  update(director) {
    const s = director.s;
    const level = Math.floor(s);
    const f = s - level; // position within the current decade, [0, 1)

    for (const slot of this.squares) {
      const n = level + slot.offset;
      // Distance from the current scale, in decades. Every visual property
      // below is a function of this and nothing else — in particular never of
      // which slot a square happens to occupy, because slots renumber when f
      // wraps and anything keyed to them pops at each of the 41 boundaries.
      const d = slot.offset - f; // === n - s
      const side = BASE_SIDE * 10 ** d;
      const half = side / 2;

      slot.rect.setAttribute('x', CENTRE_X - half);
      slot.rect.setAttribute('y', CENTRE_Y - half);
      slot.rect.setAttribute('width', side);
      slot.rect.setAttribute('height', side);

      // Fade the incoming square in as it enters frame, and the trailing one
      // out as it collapses to nothing.
      const entering = side > VIEW_W * 0.92 ? Math.max(0, 1 - (side - VIEW_W * 0.92) / (VIEW_W * 0.5)) : 1;
      const tiny = Math.min(1, side / 26);
      // Emphasis peaks on whichever square currently matches the frame.
      const emphasis = 0.55 + 0.45 * smoothstep(Math.max(0, 1 - Math.abs(d)));
      slot.g.setAttribute('opacity', emphasis * entering * tiny);

      const labelled = side > 42 && side < VIEW_W * 0.99;
      const labelSize = Math.max(13, Math.min(26, side * 0.085));
      slot.label.textContent = labelled ? powerLabel(n) : '';
      slot.label.setAttribute('font-size', labelSize);

      // Normally sits outside the square's upper-left corner. When the square
      // grows large enough that "outside" would clip off the top of frame, the
      // label moves inside — and to the upper *right*, because the upper left
      // is where the SQUARE SPANS readout lives.
      const margin = 8;
      const above = CENTRE_Y - half - labelSize * 0.45;
      const flipped = above < labelSize + margin;
      slot.label.setAttribute('text-anchor', flipped ? 'end' : 'start');
      slot.label.setAttribute('y', flipped ? CENTRE_Y - half + labelSize * 1.35 : above);
      slot.label.setAttribute('x', flipped
        ? Math.min(VIEW_W - margin, CENTRE_X + half - labelSize * 0.38)
        : Math.max(margin, CENTRE_X - half + labelSize * 0.38));

      // Corner ticks on whichever square currently matches the frame.
      if (Math.abs(d) < 0.5 && side > 60) {
        const t = Math.min(26, side * 0.12);
        const x0 = CENTRE_X - half;
        const y0 = CENTRE_Y - half;
        const x1 = CENTRE_X + half;
        const y1 = CENTRE_Y + half;
        slot.ticks.setAttribute('d', [
          `M${x0} ${y0 + t} V${y0} H${x0 + t}`,
          `M${x1 - t} ${y0} H${x1} V${y0 + t}`,
          `M${x1} ${y1 - t} V${y1} H${x1 - t}`,
          `M${x0 + t} ${y1} H${x0} V${y1 - t}`,
        ].join(' '));
      } else {
        slot.ticks.setAttribute('d', '');
      }
    }

    const metres = director.metres;
    // Round, not floor: the headline must name the same square the emphasis
    // ramp is highlighting, and that ramp peaks at whichever decade is nearest
    // s. Flooring makes the big number disagree with the big square for most
    // of every decade.
    this.fieldPower.innerHTML = `10<sup>${Math.round(s)}</sup> <span class="readout-unit">m</span>`;
    this.fieldMetres.textContent = formatMetres(metres);
    const astro = formatAstronomical(metres);
    this.fieldAstro.textContent = astro ?? '';
    this.lightTime.textContent = formatDuration(lightCrossingTime(metres));

    const free = director.mode === 'free';
    this.clock.textContent = free ? '—' : formatClock(director.time);
    this.phase.textContent = free ? 'FREE SCRUB' : director.phase.toUpperCase();
    this.progress.style.opacity = free ? '0.2' : '1';
    this.progressFill.style.width = `${(director.time / director.duration) * 100}%`;
  }
}
