// MARK ZERO — the mixer. Owned by task `audio`.
//
// A sound bank is a shelf of files. This is the part that makes it a game soundtrack:
// every bed is running all the time, and the game state moves its rate, its filter and
// its gain continuously, so the mix answers the controls instead of triggering at them.
//
//   thrust   crossfades five layers cut from two close-miked recordings — sub, idle,
//            mid, whine, hot — and drives the playback rate and the filter of each.
//            Throttling up changes the character of the roar; it does not just turn it
//            up. The material matters as much as the curves: the whine layer is a real
//            turbojet's compressor tone ladder, and the hot layer is a high-pressure
//            nozzle recorded a metre away, because near-field brightness is a property
//            of the recording and no amount of filtering can put it back.
//   speed    opens the wind: body first, then a hiss layer, then gusts. A hover at full
//            thrust has a loud engine and almost no wind, which is the difference
//            between hovering and flying and you can hear it with your eyes shut.
//   altitude thins both, because the air does.
//   firing   ducks the arc reactor hum and the music under the blast and lets them back.
//
// The whole thing lands on a limiter, so a glass wall coming down at 400 kg of debris
// cannot clip the output.

import { Voice, shot, clamp, smoothstep, fade } from './sources.js';

const LS_MUTE = 'mz.audio.mute';
const LS_VOL = 'mz.audio.volume';

export class Mixer {
  constructor(ac, bank) {
    this.ac = ac;
    this.bank = bank;
    this.muted = false;
    this.paused = false;
    this.volume = 0.9;
    try {
      this.muted = localStorage.getItem(LS_MUTE) === '1';
      const v = parseFloat(localStorage.getItem(LS_VOL));
      if (isFinite(v)) this.volume = clamp(v, 0, 1);
    } catch (e) { /* private browsing */ }

    // ---- master chain -------------------------------------------------------------
    // The limiter is a compressor with a hard knee and a big ratio sitting a couple of
    // dB below full scale. Its job is not tone: it is there so that the frame where a
    // wall collapses, three panes shatter and both repulsors fire does not clip.
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -7;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;

    this.limiter.connect(this.master);
    this.master.connect(ac.destination);

    // ---- buses --------------------------------------------------------------------
    // Ducked buses sit behind their own gain so a repulsor can pull them down without
    // touching the shot that caused it.
    const bus = (v) => { const g = ac.createGain(); g.gain.value = v; g.connect(this.limiter); return g; };
    this.sfx = bus(0.8);        // head-locked one-shots (your own suit)
    this.world = bus(0.85);     // positional one-shots (things out in the world)
    this.ui = bus(0.6);         // HUD / JARVIS — the reference frames are quiet
    this.duckBed = bus(1.0);
    this.duckReactor = bus(1.0);
    this.duckMusic = bus(1.0);

    // Bed trim. Measured, not guessed: with the five thruster layers and three wind
    // layers all up at cruise, a trim of 1.0 put the master at -2.2 dBFS *before* a
    // single impact — the limiter was working on the engine full time and had nothing
    // left for the transients. 0.5 puts the cruise bed near -9 dBFS and leaves the
    // limiter for what it is actually for.
    this.beds = ac.createGain(); this.beds.gain.value = 0.5; this.beds.connect(this.duckBed);
    this.reactorBus = ac.createGain(); this.reactorBus.gain.value = 0.7; this.reactorBus.connect(this.duckReactor);
    this.music = ac.createGain(); this.music.gain.value = 0.0; this.music.connect(this.duckMusic);

    // ---- the beds -----------------------------------------------------------------
    this.voices = {};
    this.servo = null;          // the currently running suit-up servo bed
    this.musicVoice = null;
    this.musicCue = null;
    this.state = { thrust: 0, speed: 0, altitude: 0, density: 1, inSuit: false, env: 'exterior' };
    // NOTE: the beds are NOT built here. The Mixer is constructed before Bank.init()
    // has decoded anything, so every buffer would be null and every voice silent —
    // which is exactly what happened the first time this ran. They are built in
    // startBeds(), once the recordings actually exist.
    this.bedsBuilt = false;
    this.bedsRunning = false;
  }

  // ---------------------------------------------------------------------------------
  _voice(name, dest, o) {
    const buf = this.bank.get(name);
    if (!buf) return null;
    const w = this.bank.loopWindow(name) || {};
    const v = new Voice(this.ac, buf, dest, { loopStart: w.start, loopEnd: w.end, ...o });
    this.voices[name] = v;
    return v;
  }

  _buildBeds() {
    // Five layers off two close-miked recordings. Each gets its own filter so the
    // crossfade is spectral, not just a level ride between identical copies.
    //
    //   sub    a deep machine rumble, felt rather than heard
    //   idle   a real turbojet at taxi idle
    //   mid    the same jet's start burst — the loudest, broadest thing on the tape
    //   whine  that jet's compressor tone ladder, band-passed out on its own so its
    //          PITCH can be swept with the throttle. This is the blade-passing buzzsaw,
    //          and it is the layer that says "spooling up" rather than "getting louder".
    //   hot    a high-pressure blasting nozzle recorded a metre away — flat from 1 kHz
    //          to 16 kHz. Near-field hiss cannot be filtered into existence, so it is
    //          the whole reason this layer has its own recording.
    this.thrSub = this._voice('thruster_sub', this.beds, { filter: 'lowpass', cutoff: 200, rate: 1 });
    this.thrIdle = this._voice('thruster_idle', this.beds, { filter: 'lowpass', cutoff: 900, rate: 1 });
    this.thrMid = this._voice('thruster_mid', this.beds, { filter: 'lowpass', cutoff: 1200, rate: 1 });
    this.thrWhine = this._voice('thruster_whine', this.beds, { filter: 'highpass', cutoff: 900, q: 0.9, rate: 0.78 });
    this.thrHot = this._voice('thruster_hot', this.beds, { filter: 'highpass', cutoff: 500, rate: 1 });

    this.windLow = this._voice('wind_low', this.beds, { filter: 'lowpass', cutoff: 700, rate: 1 });
    this.windHigh = this._voice('wind_high', this.beds, { filter: 'highpass', cutoff: 700, rate: 1 });
    this.windGust = this._voice('wind_gust', this.beds, { filter: 'lowpass', cutoff: 3000, rate: 1 });

    this.reactor = this._voice('reactor', this.reactorBus, { filter: 'lowpass', cutoff: 1600, rate: 0.92 });
    this.room = this._voice('room_workshop', this.beds, { filter: 'lowpass', cutoff: 1200, rate: 1 });
  }

  /**
   * Called once the AudioContext is allowed to make noise AND the bank has decoded.
   * Safe to call twice.
   */
  startBeds() {
    if (!this.bedsBuilt) { this._buildBeds(); this.bedsBuilt = true; }
    for (const v of Object.values(this.voices)) if (v) v.start();
    this.bedsRunning = true;
    return this.bedsCount = Object.values(this.voices).filter(Boolean).length;
  }

  // ---------------------------------------------------------------------------------
  // The per-frame drive. Everything below is a curve, not a switch.
  // ---------------------------------------------------------------------------------
  updateState(s) {
    if (!this.bedsRunning) return;
    const st = this.state;
    st.thrust = clamp(s.thrust || 0, 0, 1);
    st.speed = Math.max(0, s.speed || 0);
    st.altitude = Math.max(0, s.altitude || 0);
    st.inSuit = !!s.inSuit;
    st.density = clamp(s.density ?? 1, 0.25, 1);
    st.env = s.env || 'exterior';

    const t = st.thrust;
    const suit = st.inSuit ? 1 : 0;
    // Airspeed normalised against the flight model's ~290 m/s along the flight axis.
    const q = clamp(st.speed / 150, 0, 1.9);
    const thin = st.density;                       // 1 at sea level, less up high
    const inside = st.env === 'workshop' ? 0.45 : 1;

    // --- thruster ------------------------------------------------------------------
    // Rates climb together but not equally: the sub barely moves (a big mass spooling
    // slowly), the whine moves most (the part that spools).
    if (this.thrSub) {
      // Trimmed from 0.10 + 0.62: with the brighter layers in place the sub was holding
      // 41% of the master-bus energy at full throttle and dragging the spectral centroid
      // down out of the 2-4 kHz region a close-range engine sits in.
      this.thrSub.setGain(suit * inside * (0.08 + 0.46 * smoothstep(0.02, 0.75, t)));
      this.thrSub.setRate(0.86 + 0.22 * t);
      this.thrSub.setCutoff(120 + 220 * t);
    }
    if (this.thrIdle) {
      // Loudest just off idle, then hands over to the mid layer.
      const g = fade(smoothstep(0.0, 0.14, t)) * (1 - 0.75 * smoothstep(0.25, 0.8, t));
      this.thrIdle.setGain(suit * inside * 0.75 * g);
      this.thrIdle.setRate(0.90 + 0.34 * t);
      // Ceiling raised from 1.8 kHz. This layer is a real turbojet at taxi idle and its
      // compressor fundamental sits at ~1.6 kHz; the old ceiling cut it off, so a hover
      // sounded like the engine was in the next room. An idle should be duller than full
      // throttle, never distant.
      this.thrIdle.setCutoff(900 + 2600 * t);
    }
    if (this.thrMid) {
      this.thrMid.setGain(suit * inside * 0.95 * smoothstep(0.10, 0.72, t));
      this.thrMid.setRate(0.92 + 0.46 * t);
      // Ceiling raised from 6.9 kHz: the recording this layer is cut from actually has
      // energy up there, and lowpassing it away was throwing the new material back into
      // the old, distant-sounding band.
      this.thrMid.setCutoff(700 + 10500 * t);
    }
    if (this.thrWhine) {
      // The one layer whose PITCH does the work. A turbine spooling is a tone rising,
      // not a filter opening, so this sweeps 0.78x to 1.73x — a compressor fundamental
      // travelling roughly 1.25 kHz to 2.8 kHz as the throttle goes down.
      this.thrWhine.setGain(suit * inside * 0.62 * smoothstep(0.03, 0.48, t));
      this.thrWhine.setRate(0.78 + 0.95 * t);
      this.thrWhine.setCutoff(850 + 1500 * t);
    }
    if (this.thrHot) {
      // Cubed: the scream is the last third of the throttle and nothing before it.
      const g = Math.pow(smoothstep(0.35, 1.0, t), 2.2);
      this.thrHot.setGain(suit * inside * 1.15 * g);
      // A gentler rate ramp than the old jet layer had. That one was a 1.1 kHz-centroid
      // recording and needed the shift to brighten; this one starts at 6.9 kHz, and
      // pushing it 1.57x put the whole layer into a thin sizzle above 10 kHz.
      this.thrHot.setRate(0.90 + 0.34 * t);
      this.thrHot.setCutoff(500 + 900 * t);
    }

    // --- wind ----------------------------------------------------------------------
    // Speed only. Hovering at full thrust is loud and windless; that contrast is the
    // single most useful piece of information the mix can give a pilot.
    if (this.windLow) {
      this.windLow.setGain(suit * thin * 0.95 * Math.pow(clamp(q, 0, 1.3), 1.35));
      this.windLow.setRate(0.88 + 0.30 * clamp(q, 0, 1.4));
      this.windLow.setCutoff(380 + 900 * clamp(q, 0, 1.4));
    }
    if (this.windHigh) {
      this.windHigh.setGain(suit * thin * 1.25 * Math.pow(smoothstep(0.18, 1.5, q), 1.8));
      this.windHigh.setRate(0.92 + 0.42 * clamp(q, 0, 1.6));
      this.windHigh.setCutoff(650 + 4200 * clamp(q, 0, 1.6));
    }
    if (this.windGust) {
      this.windGust.setGain(suit * thin * 0.7 * smoothstep(0.55, 1.6, q));
      this.windGust.setRate(0.9 + 0.35 * clamp(q, 0, 1.6));
    }

    // --- the arc reactor, under everything -----------------------------------------
    if (this.reactor) {
      // Audible on foot too, once he is standing next to a live suit; loudest when worn.
      this.reactor.setGain(0.55 * suit + 0.18 * (1 - suit) * (st.env === 'workshop' ? 1 : 0), 0.25);
      this.reactor.setCutoff(1400 + 900 * t);
      this.reactor.setRate(0.90 + 0.10 * t);
    }
    if (this.room) this.room.setGain(st.env === 'workshop' ? 0.5 : 0.0, 0.5);
  }

  // ---------------------------------------------------------------------------------
  /**
   * Pull the beds, the reactor and the music down for a moment. A repulsor blast has to
   * arrive in a hole it made itself, or it is just another loud thing among loud things.
   */
  duck(depth = 0.55, hold = 0.09, release = 0.4) {
    const t = this.ac.currentTime;
    const set = (node, d) => {
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(1 - d, t + 0.02);
      g.setValueAtTime(1 - d, t + 0.02 + hold);
      g.setTargetAtTime(1, t + 0.02 + hold, release / 3);
    };
    set(this.duckReactor, depth);
    set(this.duckMusic, depth * 0.7);
    set(this.duckBed, depth * 0.35);
  }

  // ---------------------------------------------------------------------------------
  /** One-shot into a bus. `pos` makes it positional. */
  play(name, o = {}) {
    const buf = this.bank.get(name);
    if (!buf) return null;
    const dest = o.bus === 'ui' ? this.ui : o.pos ? this.world : this.sfx;
    return shot(this.ac, buf, dest, o);
  }

  /** Pick one of several recordings so the tenth pane of glass is not the first one. */
  playOneOf(names, o = {}) {
    const live = names.filter(n => this.bank.has(n));
    if (!live.length) return null;
    return this.play(live[(Math.random() * live.length) | 0], o);
  }

  // ---------------------------------------------------------------------------------
  /**
   * Start an independent looping voice on a recording. The caller owns it and must
   * stop it. Used for ambiences and for the suit-up servo bed.
   */
  startLoop(name, o = {}) {
    const buf = this.bank.get(name);
    if (!buf) return null;
    const w = this.bank.loopWindow(name) || {};
    const v = new Voice(this.ac, buf, o.bus === 'world' ? this.world : this.beds, {
      loopStart: w.start, loopEnd: w.end,
      filter: o.filter === null ? null : (o.filter || 'lowpass'),
      cutoff: o.cutoff ?? 9000, rate: o.rate ?? 1, positional: o.positional,
    });
    v.start();
    v.setGain(o.gain ?? 0.5, o.tau ?? 0.08);
    return v;
  }

  /**
   * The suit-up servo bed. Exactly one runs at a time — a second armor closing while
   * the first is still grinding is not a mix, it is a mistake.
   */
  startServo(name, o = {}) {
    this.stopServo(0.12);
    this.servo = this.startLoop(name, o);
    return this.servo;
  }
  setServo(o = {}) {
    if (!this.servo) return;
    if (o.gain != null) this.servo.setGain(o.gain, o.tau ?? 0.08);
    if (o.rate != null) this.servo.setRate(o.rate, 0.1);
    if (o.cutoff != null) this.servo.setCutoff(o.cutoff, 0.1);
  }
  stopServo(fadeSec = 0.35) {
    if (this.servo) { this.servo.stop(fadeSec); this.servo = null; }
  }

  // ---------------------------------------------------------------------------------
  /** Cross-fade the music to a cue, or to nothing. */
  setMusic(cue, o = {}) {
    if (cue === this.musicCue) return;
    const gain = o.gain ?? 0.5;
    const t = this.ac.currentTime;
    if (this.musicVoice) {
      const old = this.musicVoice;
      old.stop(o.fade ?? 1.6);
      this.musicVoice = null;
    }
    this.musicCue = cue;
    if (!cue) { this.music.gain.setTargetAtTime(0, t, 0.5); return; }
    const buf = this.bank.get(cue);
    if (!buf) return;
    const w = this.bank.loopWindow(cue) || {};
    const v = new Voice(this.ac, buf, this.music, { loopStart: w.start, loopEnd: w.end });
    v.start();
    v.setGain(1, 0.6);
    this.musicVoice = v;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(gain, t, (o.fade ?? 2.0) / 3);
  }

  // ---------------------------------------------------------------------------------
  /** Move the listener to the camera. Positional sound is meaningless without this. */
  setListener(camera) {
    const l = this.ac.listener;
    const m = camera.matrixWorld.elements;
    const px = m[12], py = m[13], pz = m[14];
    // three.js cameras look down -Z in their own space.
    const fx = -m[8], fy = -m[9], fz = -m[10];
    const ux = m[4], uy = m[5], uz = m[6];
    const t = this.ac.currentTime;
    if (l.positionX) {
      const tau = 0.02;
      l.positionX.setTargetAtTime(px, t, tau);
      l.positionY.setTargetAtTime(py, t, tau);
      l.positionZ.setTargetAtTime(pz, t, tau);
      l.forwardX.setTargetAtTime(fx, t, tau);
      l.forwardY.setTargetAtTime(fy, t, tau);
      l.forwardZ.setTargetAtTime(fz, t, tau);
      l.upX.setTargetAtTime(ux, t, tau);
      l.upY.setTargetAtTime(uy, t, tau);
      l.upZ.setTargetAtTime(uz, t, tau);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------------------------------------------------------------------------------
  setMuted(v) {
    this.muted = !!v;
    try { localStorage.setItem(LS_MUTE, this.muted ? '1' : '0'); } catch (e) {}
    this._applyMaster();
    return this.muted;
  }
  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    try { localStorage.setItem(LS_VOL, String(this.volume)); } catch (e) {}
    this._applyMaster();
  }
  setPaused(v) { this.paused = !!v; this._applyMaster(); }
  _applyMaster() {
    const target = this.muted ? 0 : this.paused ? this.volume * 0.10 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ac.currentTime, 0.08);
  }

  /** What the mixer is doing right now — for MZ.state() and for a critic. */
  report() {
    // Report the TARGETS, not the live parameter values: setTargetAtTime interpolates
    // on the audio thread, so reading the live value one line after setting it just
    // reports the old one. The target is what the game asked for.
    const g = (v) => (v ? +v.targetGain.toFixed(3) : null);
    const r = (v) => (v ? +v.targetRate.toFixed(3) : null);
    const c = (v) => (v ? Math.round(v.targetCutoff) : null);
    return {
      running: this.ac.state, bedsRunning: !!this.bedsRunning, beds: this.bedsCount || 0, muted: this.muted, volume: +this.volume.toFixed(2),
      thrust: +this.state.thrust.toFixed(3), speed: +this.state.speed.toFixed(1),
      thruster: {
        sub: [g(this.thrSub), r(this.thrSub), c(this.thrSub)],
        idle: [g(this.thrIdle), r(this.thrIdle), c(this.thrIdle)],
        mid: [g(this.thrMid), r(this.thrMid), c(this.thrMid)],
        whine: [g(this.thrWhine), r(this.thrWhine), c(this.thrWhine)],
        hot: [g(this.thrHot), r(this.thrHot), c(this.thrHot)],
      },
      wind: {
        low: [g(this.windLow), r(this.windLow), c(this.windLow)],
        high: [g(this.windHigh), r(this.windHigh), c(this.windHigh)],
        gust: [g(this.windGust), r(this.windGust)],
      },
      reactor: g(this.reactor), room: g(this.room),
      duck: { reactor: +this.duckReactor.gain.value.toFixed(3), music: +this.duckMusic.gain.value.toFixed(3) },
      music: this.musicCue, musicGain: +this.music.gain.value.toFixed(3),
      limiterReduction: +this.limiter.reduction.toFixed(2),
      servo: this.servo ? +this.servo.targetGain.toFixed(2) : null,
    };
  }

  /**
   * Measure the master bus. This exists because the thruster was once shipped built out
   * of a distant airliner recording, and nothing in report() above could have caught it:
   * every gain, rate and cutoff was correct, and the sound was still an aeroplane two
   * miles away, because a recording made at 500 m has no top half of the spectrum to
   * open up. The only thing that catches that is looking at the spectrum that actually
   * comes out.
   *
   * Averages the analyser over `ms` of wall time and returns the band split, the
   * spectral centroid and the 95% rolloff. A near-field rocket at full throttle should
   * land its centroid in the 2-4 kHz region with meaningful energy above 6 kHz; under
   * 1 kHz with nothing above 6 kHz means the source material is distant, and no filter
   * curve will fix it.
   *
   * @returns {Promise<object>}
   */
  async spectrum(ms = 900) {
    if (!this._analyser) {
      // Tapped off the limiter, not off `master`: the measurement should not move when
      // the player drags the volume slider or hits mute.
      this._analyser = this.ac.createAnalyser();
      this._analyser.fftSize = 4096;
      this._analyser.smoothingTimeConstant = 0;
      this.limiter.connect(this._analyser);
    }
    const an = this._analyser;
    const n = an.frequencyBinCount;
    const buf = new Float32Array(n);
    const acc = new Float64Array(n);
    const df = this.ac.sampleRate / an.fftSize;
    let frames = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      an.getFloatFrequencyData(buf);
      // dBFS per bin -> linear power, so the average is an average of energy.
      for (let i = 0; i < n; i++) acc[i] += Math.pow(10, buf[i] / 10);
      frames++;
      await new Promise(r => setTimeout(r, 12));
    }
    if (!frames) return null;
    let tot = 0, num = 0;
    for (let i = 1; i < n; i++) { const p = acc[i] / frames; tot += p; num += p * i * df; }
    tot = tot || 1e-30;
    const band = (a, b) => {
      let s = 0;
      for (let i = Math.max(1, Math.round(a / df)); i < Math.min(n, Math.round(b / df)); i++) s += acc[i] / frames;
      return +(s / tot).toFixed(4);
    };
    let cum = 0, ro = 0;
    for (let i = 1; i < n; i++) { cum += acc[i] / frames; if (cum >= 0.95 * tot) { ro = i * df; break; } }
    return {
      frames, thrust: +this.state.thrust.toFixed(2), speed: +this.state.speed.toFixed(1),
      centroid: Math.round(num / tot), rolloff95: Math.round(ro),
      bands: {
        '0-200': band(0, 200), '200-1k': band(200, 1000), '1-3k': band(1000, 3000),
        '3-6k': band(3000, 6000), '6-11k': band(6000, 11000), '11k+': band(11000, this.ac.sampleRate / 2),
      },
      above6k: +(band(6000, 11000) + band(11000, this.ac.sampleRate / 2)).toFixed(4),
    };
  }
}
