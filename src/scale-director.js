// ScaleDirector — the single source of truth for "where are we" in the film.
//
// The whole piece is a function of one scalar:
//
//     s = log10(width of the frame, in metres)
//
// The camera never moves and nothing is ever stored in absolute coordinates.
// Content is authored per decade in normalised units (1 unit = 10^level metres)
// and placed into the scene scaled by 10^(level - s). Because only decades
// within ~1.5 of s are ever live, that exponent stays inside [-1.5, 1.5] and
// every number handed to WebGL sits comfortably in float32 — which is the only
// reason a 41-order-of-magnitude journey is renderable at all.

/** Innermost scale: quarks inside a nucleus. */
export const S_MIN = -16;
/** Outermost scale: edge of the observable universe. */
export const S_MAX = 24;

const EASE = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => u * (2 - u),
};

/**
 * The film's shape, as (from, to, duration) segments. s is interpolated
 * linearly within a segment, which makes the *perceived* zoom rate constant —
 * exponential in metres, linear in decades. That is what the original does.
 *
 * Durations are deliberately tunable; these approximate the 1977 cut:
 * ~10 s/decade outbound, a fast return, then a slower run inward.
 */
export const DEFAULT_TIMELINE = [
  { from: 0, to: 0, duration: 8, phase: 'open' },
  { from: 0, to: S_MAX, duration: 240, phase: 'outbound' },
  { from: S_MAX, to: S_MAX, duration: 6, phase: 'apex' },
  { from: S_MAX, to: 0, duration: 36, phase: 'return', ease: 'smooth' },
  { from: 0, to: S_MIN, duration: 128, phase: 'inbound' },
  { from: S_MIN, to: S_MIN, duration: 10, phase: 'close' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class ScaleDirector {
  /**
   * @param {object} [opts]
   * @param {Array} [opts.timeline] segment list, see DEFAULT_TIMELINE
   * @param {number} [opts.blendRadius] decades within this distance of s are live
   */
  constructor({ timeline = DEFAULT_TIMELINE, blendRadius = 1.5 } = {}) {
    this.blendRadius = blendRadius;
    this.setTimeline(timeline);

    this._time = 0;
    this._s = this.timeline[0].from;
    this._playing = false;
    this._mode = 'timeline'; // 'timeline' | 'free'

    // Anchor-based playback: we never accumulate per-frame deltas, we derive
    // the playhead from an external monotonic clock. Swapping that clock for
    // audioContext.currentTime is then a one-line change, and a 7-minute run
    // cannot drift away from the score.
    this._anchorClock = 0;
    this._anchorTime = 0;

    this._listeners = new Set();
  }

  setTimeline(timeline) {
    let acc = 0;
    this.timeline = timeline.map((seg) => {
      const start = acc;
      acc += seg.duration;
      return { ...seg, start, end: acc, ease: seg.ease ?? 'linear' };
    });
    this.duration = acc;
    return this;
  }

  // ---- state ------------------------------------------------------------

  /** Current scale, log10(metres across the frame). */
  get s() { return this._s; }
  get time() { return this._time; }
  get playing() { return this._playing; }
  get mode() { return this._mode; }
  /** Frame width in metres. Display only — never feed this to the GPU. */
  get metres() { return 10 ** this._s; }

  get phase() {
    if (this._mode === 'free') return 'free';
    return this._segmentAt(this._time)?.phase ?? 'close';
  }

  /** Signed zoom rate in decades/second, handy for motion blur and audio. */
  get velocity() {
    if (this._mode === 'free') return 0;
    const seg = this._segmentAt(this._time);
    if (!seg || seg.duration === 0) return 0;
    return (seg.to - seg.from) / seg.duration;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _emit() { for (const fn of this._listeners) fn(this); }

  // ---- timeline evaluation ---------------------------------------------

  _segmentAt(t) {
    for (const seg of this.timeline) if (t < seg.end) return seg;
    return this.timeline[this.timeline.length - 1];
  }

  /** s at an arbitrary point on the timeline. Pure. */
  scaleAtTime(t) {
    const time = clamp(t, 0, this.duration);
    const seg = this._segmentAt(time);
    if (seg.duration === 0) return seg.to;
    const u = clamp((time - seg.start) / seg.duration, 0, 1);
    return seg.from + (seg.to - seg.from) * EASE[seg.ease](u);
  }

  // ---- playback --------------------------------------------------------

  /**
   * Drive the playhead from an external monotonic clock, in seconds.
   * Call every frame; it is a no-op when paused or scrubbing.
   */
  syncTo(clockSeconds) {
    if (this._playing && this._mode === 'timeline') {
      this.setTime(this._anchorTime + (clockSeconds - this._anchorClock));
    }
    this._lastClock = clockSeconds;
    return this;
  }

  play(clockSeconds = this._lastClock ?? 0) {
    if (this._mode === 'free') this._mode = 'timeline';
    this._playing = true;
    this._anchorClock = clockSeconds;
    this._anchorTime = this._time;
    this._emit();
    return this;
  }

  /**
   * Re-anchor the playhead to a new clock source without moving it.
   *
   * Playback is derived from an external clock rather than accumulated deltas,
   * so swapping that clock — rAF time for the audio context's, once the score
   * starts — would otherwise jump the playhead by the difference between them.
   */
  rebase(clockSeconds) {
    this._anchorClock = clockSeconds;
    this._anchorTime = this._time;
    this._lastClock = clockSeconds;
    return this;
  }

  pause() {
    this._playing = false;
    this._emit();
    return this;
  }

  toggle(clockSeconds) { return this._playing ? this.pause() : this.play(clockSeconds); }

  setTime(t) {
    this._mode = 'timeline';
    this._time = clamp(t, 0, this.duration);
    this._s = this.scaleAtTime(this._time);
    // Re-anchor so a scrub mid-playback does not snap back.
    this._anchorTime = this._time;
    this._anchorClock = this._lastClock ?? this._anchorClock;
    if (this._time >= this.duration) this._playing = false;
    this._emit();
    return this;
  }

  /**
   * Jump straight to a scale, detaching from the timeline. This is the debug
   * affordance that matters: s is non-monotonic over the film (0 → 24 → 0 →
   * -16), so there is no single inverse of scaleAtTime to scrub against.
   */
  setScale(s) {
    this._mode = 'free';
    this._playing = false;
    this._s = clamp(s, S_MIN, S_MAX);
    this._emit();
    return this;
  }

  /** Nudge by whole decades while in free mode. */
  stepDecade(delta) { return this.setScale(Math.round(this._s) + delta); }

  reset() { this._playing = false; return this.setTime(0); }

  // ---- what to render --------------------------------------------------

  /** 10^(level - s): the factor that puts a decade's local units on screen. */
  scaleFor(level) { return 10 ** (level - this._s); }

  /**
   * Live decades and their cross-fade weights, normalised to sum to 1 so the
   * composite never dims or flares at a handoff.
   * @returns {Map<number, number>} level -> weight in [0,1]
   */
  weights() {
    const r = this.blendRadius;
    const out = new Map();
    let sum = 0;
    const lo = Math.max(S_MIN, Math.ceil(this._s - r));
    const hi = Math.min(S_MAX, Math.floor(this._s + r));
    for (let n = lo; n <= hi; n++) {
      const d = Math.abs(n - this._s) / r; // 0 at centre, 1 at the edge
      const w = EASE.smooth(1 - clamp(d, 0, 1));
      if (w > 0) { out.set(n, w); sum += w; }
    }
    if (sum > 0) for (const [k, v] of out) out.set(k, v / sum);
    return out;
  }

  /**
   * Levels that should be *built*, which is a wider band than the ones being
   * drawn. Two radii gives hysteresis: content is ready before it is needed
   * and is not torn down the instant it fades out, so scrubbing across a
   * boundary does not thrash the loader.
   */
  buildRange({ build = 2, dispose = 3 } = {}) {
    const span = (r) => [
      Math.max(S_MIN, Math.ceil(this._s - r)),
      Math.min(S_MAX, Math.floor(this._s + r)),
    ];
    const [bLo, bHi] = span(build);
    const [dLo, dHi] = span(dispose);
    return { build: [bLo, bHi], keep: [dLo, dHi] };
  }
}
