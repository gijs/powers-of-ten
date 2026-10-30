// Audio.
//
// Entirely synthesised: no samples, no score, zero bytes of payload, and
// nothing anyone else owns. (The 1977 film's score and narration are both still
// protected, so a faithful soundtrack was never an option anyway.)
//
// The mix is driven by the same scale scalar as the picture, through the same
// window function — `weightsOverRanges` is what the band registry uses — so a
// sound layer fades on exactly the curve its matching visuals do. The layers
// tile [S_MIN, S_MAX], so their gains always sum to 1 and the mix holds a
// constant loudness across all 41 decades without a limiter doing the work.
//
// Two things are continuous rather than layered:
//
//   pitch    a drone whose fundamental tracks s directly, so zooming out
//            detunes downward across about five octaves. It is the one cue
//            that reads as motion rather than as place.
//   space    reverb wet level grows with scale. Cheap, and it does more to
//            sell "this is getting enormous" than any amount of new material.

import { weightsOverRanges } from './registry.js';

/** Octaves the drone falls per decade of scale. */
const OCTAVES_PER_DECADE = 1 / 8;
/** Drone fundamental at s = 0, Hz. */
const BASE_FREQ = 110;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Looping noise, pink-ish: white run through a one-pole lowpass. */
function noiseBuffer(ctx, seconds = 4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.98 * last + 0.02 * white;
    d[i] = last * 6;
  }
  return buf;
}

/**
 * Reverb impulse: exponentially decaying noise. A real IR would be a file;
 * this costs nothing and at these decay times nobody can tell.
 */
function impulseResponse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** decay;
    }
  }
  return buf;
}

// ---- voices -------------------------------------------------------------
// Each returns { out, setFreq?, dispose }. All of them run continuously; the
// layer gain does the fading, so nothing ever starts or stops mid-flight and
// there are no clicks.

function droneVoice(ctx, { harmonics = [1, 2, 3], detune = 6, cutoff = 1200, type = 'sine' }) {
  const out = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  filter.connect(out);

  const oscs = harmonics.map((h, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = (i - harmonics.length / 2) * detune;
    const g = ctx.createGain();
    g.gain.value = 0.5 / (h * harmonics.length) ** 0.6;
    o.connect(g).connect(filter);
    o.start();
    return { o, h };
  });

  return {
    out,
    setFreq(f) {
      for (const { o, h } of oscs) {
        o.frequency.setTargetAtTime(clamp(f * h, 0.02, 18000), ctx.currentTime, 0.08);
      }
    },
    dispose() { for (const { o } of oscs) o.stop(); },
  };
}

function noiseVoice(ctx, buffer, { type = 'bandpass', hz = 500, q = 1, lfoHz = 0, lfoDepth = 0 }) {
  const out = ctx.createGain();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  src.connect(filter).connect(out);
  src.start();

  let lfo = null;
  if (lfoHz > 0) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const depth = ctx.createGain();
    depth.gain.value = lfoDepth;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();
  }

  return { out, dispose() { src.stop(); lfo?.stop(); } };
}

function shimmerVoice(ctx, { ratios = [7, 9, 11, 13], tremoloHz = 0.3 }) {
  const out = ctx.createGain();
  const oscs = ratios.map((r, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(out);
    // Each partial breathes at its own slow rate, so the texture never
    // settles into an audible pattern.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = tremoloHz * (0.6 + i * 0.27);
    const depth = ctx.createGain();
    depth.gain.value = 0.11 / ratios.length;
    lfo.connect(depth).connect(g.gain);
    g.gain.value = 0.11 / ratios.length;
    o.start(); lfo.start();
    return { o, r, lfo };
  });
  return {
    out,
    setFreq(f) {
      for (const { o, r } of oscs) {
        o.frequency.setTargetAtTime(clamp(f * r, 0.02, 18000), ctx.currentTime, 0.12);
      }
    },
    dispose() { for (const { o, lfo } of oscs) { o.stop(); lfo.stop(); } },
  };
}

/**
 * The layers, tiling [S_MIN, S_MAX].
 *
 * `send` is how much of the layer goes to the reverb, over and above the
 * scale-driven global wet level — intimate decades stay dry, empty ones do not.
 */
const LAYERS = [
  { name: 'quantum',     from: -16, to: -11, send: 0.5,  gain: 1.98,
    build: (ctx, n) => shimmerVoice(ctx, { ratios: [11, 15, 19, 23], tremoloHz: 0.9 }) },
  { name: 'atomic',      from: -10, to:  -7, send: 0.45, gain: 2.25,
    build: (ctx, n) => shimmerVoice(ctx, { ratios: [4, 6, 9, 12], tremoloHz: 0.35 }) },
  { name: 'molecular',   from:  -6, to:  -3, send: 0.3,  gain: 0.58,
    build: (ctx, n) => droneVoice(ctx, { harmonics: [2, 3, 5], cutoff: 2600, detune: 9 }) },
  { name: 'cellular',    from:  -2, to:  -1, send: 0.25, gain: 0.68,
    build: (ctx, n) => noiseVoice(ctx, n, { type: 'bandpass', hz: 320, q: 1.6, lfoHz: 0.16, lfoDepth: 150 }) },
  // The one diegetic layer: open air at human scale. It has no reach beyond a
  // couple of decades, which is the point — leaving the ground should sound
  // like leaving the only place with air in it.
  { name: 'human',       from:   0, to:   2, send: 0.12, gain: 0.84,
    build: (ctx, n) => noiseVoice(ctx, n, { type: 'bandpass', hz: 1100, q: 0.7, lfoHz: 0.09, lfoDepth: 420 }) },
  { name: 'terrestrial', from:   3, to:   6, send: 0.3,  gain: 0.31,
    build: (ctx, n) => noiseVoice(ctx, n, { type: 'lowpass', hz: 700, q: 0.6, lfoHz: 0.05, lfoDepth: 300 }) },
  { name: 'planetary',   from:   7, to:  10, send: 0.55, gain: 0.45,
    build: (ctx, n) => droneVoice(ctx, { harmonics: [1, 2, 4], cutoff: 900, detune: 4 }) },
  { name: 'stellar',     from:  11, to:  16, send: 0.75, gain: 0.53,
    build: (ctx, n) => droneVoice(ctx, { harmonics: [1, 3, 5, 8], cutoff: 1500, detune: 3 }) },
  { name: 'galactic',    from:  17, to:  21, send: 0.85, gain: 0.59,
    build: (ctx, n) => droneVoice(ctx, { harmonics: [1, 2, 3, 6], cutoff: 2200, detune: 2, type: 'triangle' }) },
  { name: 'cosmic',      from:  22, to:  24, send: 0.95, gain: 0.31,
    build: (ctx, n) => droneVoice(ctx, { harmonics: [1, 2], cutoff: 420, detune: 1 }) },
];

export class AudioDirector {
  /**
   * @param {object} [opts]
   * @param {() => BaseAudioContext} [opts.createContext] injectable, so the mix
   *   can be rendered offline in a test
   */
  constructor({ createContext } = {}) {
    this._createContext = createContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
    this.ctx = null;
    this.layers = [];
    this.muted = false;
    this.started = false;
  }

  /**
   * An offline context is 'suspended' until rendering begins and throws if
   * resumed, so the gesture-unlock dance only applies to a live one.
   */
  async _unlock() {
    const offline = typeof this.ctx.startRendering === 'function';
    if (!offline && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Browsers only allow this from a user gesture. */
  async start() {
    if (this.started) {
      await this._unlock();
      return this;
    }
    const ctx = this._createContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = impulseResponse(ctx, 4.5, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    this.convolver.connect(this.wet).connect(this.master);

    const noise = noiseBuffer(ctx);

    for (const spec of LAYERS) {
      const voice = spec.build(ctx, noise);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      voice.out.connect(gain);
      gain.connect(this.master);
      const send = ctx.createGain();
      send.gain.value = spec.send;
      gain.connect(send).connect(this.convolver);
      this.layers.push({ spec, voice, gain });
    }

    await this._unlock();
    // Fade the master in rather than snapping, which clicks.
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, ctx.currentTime, 0.4);
    this.started = true;
    return this;
  }

  /** The clock the playhead should run on once audio exists. */
  get currentTime() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(muted) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.15);
    return this;
  }

  /** Drone fundamental for a given scale. Exposed for testing. */
  static frequencyAt(s) {
    return BASE_FREQ * 2 ** (-s * OCTAVES_PER_DECADE);
  }

  /** @param {import('./scale-director.js').ScaleDirector} director */
  update(director) {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    const s = director.s;

    const weights = weightsOverRanges(director, this.layers.map((l) => l.spec));
    for (const layer of this.layers) {
      const w = weights.get(layer.spec) ?? 0;
      // setTargetAtTime rather than assignment: a per-frame step on an
      // AudioParam is a zipper buzz, and these move every frame.
      layer.gain.gain.setTargetAtTime(w * layer.spec.gain, now, 0.09);
      layer.voice.setFreq?.(AudioDirector.frequencyAt(s));
    }

    // Bigger spaces at bigger scales.
    this.wet.gain.setTargetAtTime(0.12 + 0.68 * smoothstep(2, 19, s), now, 0.5);
  }

  dispose() {
    for (const l of this.layers) l.voice.dispose();
    this.layers = [];
    this.ctx?.close?.();
    this.started = false;
  }
}
