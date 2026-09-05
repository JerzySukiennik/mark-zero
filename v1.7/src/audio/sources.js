// MARK ZERO — voices. Owned by task `audio`.
//
// Two ways a recorded buffer reaches the mixer:
//
//   Voice      a bed that never stops — the thruster, the wind, the arc reactor, a servo
//              while the armor is closing. It owns one looping AudioBufferSourceNode and
//              a filter and a gain, and the game drives its rate / cutoff / gain every
//              tick. This is the whole point of the piece: throttling up must change what
//              you hear, not just how loud it is.
//
//   shot()     a one-off — a repulsor blast, a pane of glass, a HUD blip. Created, played,
//              and left to be collected. Optionally positional, so a lamp post falling
//              behind you is behind you.
//
// Nothing in this file makes a waveform. Every sound is a decoded recording from the bank.

/** Equal-power-ish curve for crossfading two layers of the same recording. */
export const fade = (x) => Math.sin(Math.max(0, Math.min(1, x)) * Math.PI * 0.5);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };

/**
 * A continuously running layer of one looping recording.
 *
 * Parameters are set with setTargetAtTime rather than setValueAtTime: the game ticks at
 * 120 Hz but the audio thread runs at 44.1 kHz, so stepping a gain once per tick makes
 * a 120 Hz buzz. A time constant does the interpolation on the audio thread instead.
 */
export class Voice {
  /**
   * @param {AudioContext} ac
   * @param {AudioBuffer}  buffer   a real recording
   * @param {AudioNode}    dest     the bus to feed
   * @param {object}       o        { loopStart, loopEnd, filter:'lowpass'|'highpass'|null,
   *                                  cutoff, q, rate, gain, positional }
   */
  constructor(ac, buffer, dest, o = {}) {
    this.ac = ac;
    this.buffer = buffer;
    this.dest = dest;
    this.o = o;
    this.playing = false;
    this.targetGain = 0;
    this.targetRate = o.rate ?? 1;
    this.targetCutoff = o.cutoff ?? 20000;

    this.gain = ac.createGain();
    this.gain.gain.value = 0;

    if (o.filter) {
      this.filter = ac.createBiquadFilter();
      this.filter.type = o.filter;
      this.filter.frequency.value = o.cutoff ?? 20000;
      this.filter.Q.value = o.q ?? 0.7;
      this.filter.connect(this.gain);
      this.head = this.filter;
    } else {
      this.head = this.gain;
    }

    if (o.positional) {
      this.panner = makePanner(ac, o.positional);
      this.gain.connect(this.panner);
      this.panner.connect(dest);
    } else {
      this.gain.connect(dest);
    }
    this.src = null;
  }

  start(when = 0) {
    if (this.playing || !this.buffer) return this;
    const s = this.ac.createBufferSource();
    s.buffer = this.buffer;
    s.loop = true;
    // Stay off the MP3 encoder's padding at both ends — see bank.loopWindow().
    s.loopStart = this.o.loopStart ?? 0.03;
    s.loopEnd = this.o.loopEnd ?? Math.max(0.1, this.buffer.duration - 0.03);
    s.playbackRate.value = this.o.rate ?? 1;
    s.connect(this.head);
    // Random start offset: four thruster layers cut from one recording would otherwise
    // phase-lock and comb-filter each other into a hollow tube.
    const off = s.loopStart + Math.random() * (s.loopEnd - s.loopStart);
    s.start(when || this.ac.currentTime, off);
    this.src = s;
    this.playing = true;
    return this;
  }

  stop(fadeSec = 0.25) {
    if (!this.playing) return;
    const t = this.ac.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, Math.max(0.01, fadeSec / 3));
    const s = this.src;
    this.src = null;
    this.playing = false;
    try { s.stop(t + fadeSec + 0.1); } catch (e) { /* already stopped */ }
  }

  /** 0..1 (times the voice's own trim). Smoothed on the audio thread. */
  setGain(v, tau = 0.06) {
    this.targetGain = v;
    this.gain.gain.setTargetAtTime(Math.max(0, v), this.ac.currentTime, tau);
  }

  /** Playback rate — this is what makes a throttle sound like a throttle and not a fader. */
  setRate(v, tau = 0.12) {
    this.targetRate = clamp(v, 0.25, 3.5);
    if (!this.src) return;
    this.src.playbackRate.setTargetAtTime(clamp(v, 0.25, 3.5), this.ac.currentTime, tau);
  }

  setCutoff(hz, tau = 0.08) {
    this.targetCutoff = hz;
    if (!this.filter) return;
    this.filter.frequency.setTargetAtTime(clamp(hz, 30, 20000), this.ac.currentTime, tau);
  }

  setPosition(x, y, z) {
    const p = this.panner;
    if (!p) return;
    if (p.positionX) {
      const t = this.ac.currentTime;
      p.positionX.setTargetAtTime(x, t, 0.02);
      p.positionY.setTargetAtTime(y, t, 0.02);
      p.positionZ.setTargetAtTime(z, t, 0.02);
    } else p.setPosition(x, y, z);   // Safari still ships the deprecated form
  }
}

/**
 * A world-space panner. Inverse rolloff with a generous reference distance: the game's
 * scale is metres over a cliff and an ocean, so a lamp post at 40 m must still be
 * audible while a wall coming down at 400 m must not dominate.
 */
export function makePanner(ac, o = {}) {
  const p = ac.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = o.refDistance ?? 8;
  p.rolloffFactor = o.rolloff ?? 1.05;
  p.maxDistance = o.maxDistance ?? 4000;
  p.coneInnerAngle = 360;
  return p;
}

/**
 * Fire one recording once.
 *
 * @param {AudioContext} ac
 * @param {AudioBuffer}  buffer
 * @param {AudioNode}    dest
 * @param {object} o
 *   gain      linear
 *   rate      playback rate — heavier impacts play slower, which is what makes a big
 *             piece of concrete sound bigger than a small one out of the same recording
 *   offset    seconds into the buffer
 *   duration  seconds to play
 *   delay     seconds to wait
 *   pos       [x,y,z] world position; omit for a head-locked sound
 *   pan       -1..1 stereo pan for head-locked sounds (your own left/right repulsor)
 *   lp, hp    filter the shot — distance dulls a sound, and a thing hit softly is duller
 *   attack, release  envelope shaping in seconds
 * @returns the source node, or null if there was nothing to play
 */
export function shot(ac, buffer, dest, o = {}) {
  if (!buffer) return null;
  const t0 = ac.currentTime + (o.delay || 0);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = clamp(o.rate ?? 1, 0.25, 4);
  if (o.detune && src.detune) src.detune.value = o.detune;

  let node = src;
  if (o.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node.connect(f); node = f; }
  if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7; node.connect(f); node = f; }

  const g = ac.createGain();
  const peak = Math.max(0.0001, o.gain ?? 1);
  const atk = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + atk);
  node.connect(g);
  node = g;

  const dur = (o.duration ?? (buffer.duration - (o.offset || 0))) / src.playbackRate.value;
  if (o.release) {
    const rel = Math.min(o.release, dur);
    g.gain.setValueAtTime(peak, t0 + Math.max(atk, dur - rel));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  }

  if (o.pos) {
    const p = makePanner(ac, o);
    if (p.positionX) { p.positionX.value = o.pos[0]; p.positionY.value = o.pos[1]; p.positionZ.value = o.pos[2]; }
    else p.setPosition(o.pos[0], o.pos[1], o.pos[2]);
    node.connect(p); node = p;
  } else if (o.pan) {
    const sp = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (sp) { sp.pan.value = clamp(o.pan, -1, 1); node.connect(sp); node = sp; }
  }

  node.connect(dest);
  src.start(t0, o.offset || 0, o.duration || undefined);
  src.onended = () => { try { node.disconnect(); g.disconnect(); src.disconnect(); } catch (e) {} };
  return src;
}
