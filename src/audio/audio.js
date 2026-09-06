// MARK ZERO — the soundtrack. Owned by task `audio`.
//
// Every sound this module can make is a REAL RECORDED FILE, downloaded from a free,
// permissively licensed library by tools/fetch-audio.sh, stored under audio/ and
// credited in audio/CREDITS.md. There is no oscillator, no noise buffer, no synthesis
// anywhere in src/audio/. That approach was tried in an earlier version of this project
// and the user rejected it; do not quietly reintroduce it, not even as a fallback for a
// missing file. A missing file is silence.
//
// This module owns:
//   * the AudioContext and the unlock-on-first-gesture handshake browsers require
//   * the master limiter, so a collapsing wall cannot clip the output
//   * the beds — thruster, wind, arc reactor, room tone, servos — driven every tick
//     from ctx.state.thrust / .speed / .altitude
//   * one-shots for repulsors, destruction, the armor closing and the HUD
//   * positional placement, so a lamp post falling behind you is behind you
//   * M to mute, remembered across sessions
//
// It talks to the rest of the game only through ctx and ctx.bus, per ARCHITECTURE.md.

import { Bank } from './bank.js';
import { Mixer } from './mixer.js';
import { clamp } from './sources.js';

// ------------------------------------------------------------------------------------
// Per-armor character. The brief asks for a distinct servo/clank pair per suit and it is
// the cheapest way to make five suit-ups feel like five machines: Mk I is scrap iron
// grinding on scrap iron, Mk L barely exists.
// ------------------------------------------------------------------------------------
const ARMOR = {
  mk1: {
    servo: 'servo_heavy', servoRate: 0.70, servoGain: 0.62, servoCutoff: 2600,
    clank: ['clank_scrap', 'metal_heavy'], clankGain: 1.00, clankRate: 0.78, clankLp: 3000,
    latch: 0.55, ready: 0.8,
    face: { open: 'clank_scrap', close: 'metal_heavy', gain: 0.9, rate: 0.72 },
  },
  mk2: {
    servo: 'servo_fine', servoRate: 0.92, servoGain: 0.44, servoCutoff: 9000,
    clank: ['clank_plate', 'metal_a'], clankGain: 0.72, clankRate: 1.00,
    latch: 0.7, ready: 0.9,
    face: { open: 'latch', close: 'clank_plate', gain: 0.6, rate: 1.05 },
  },
  mk3: {
    servo: 'servo_fine', servoRate: 1.06, servoGain: 0.40, servoCutoff: 11000,
    clank: ['clank_plate', 'metal_b', 'metal_a'], clankGain: 0.70, clankRate: 1.08,
    latch: 0.75, ready: 1.0,
    face: { open: 'latch', close: 'clank_plate', gain: 0.62, rate: 1.12 },
  },
  mk42: {
    servo: 'servo_fast', servoRate: 1.30, servoGain: 0.36, servoCutoff: 12000,
    clank: ['clank_light', 'metal_light', 'metal_d'], clankGain: 0.55, clankRate: 1.18,
    latch: 0.5, ready: 1.0, intro: 'plates_swarm',
    face: { open: 'clank_light', close: 'clank_light', gain: 0.45, rate: 1.25 },
  },
  mk50: {
    // Nanotech. It pours; it does not bolt on. The servo bed is running water,
    // high-passed until it reads as liquid metal, and the "clank" is barely a sound.
    servo: 'nano_flow', servoRate: 1.00, servoGain: 0.34, servoCutoff: 14000,
    clank: ['nano_seal'], clankGain: 0.26, clankRate: 1.0, clankHp: 500,
    latch: 0.18, ready: 0.7, quiet: true,
    face: { open: 'nano_seal', close: 'nano_seal', gain: 0.22, rate: 0.9 },
  },
};

// Which recordings a material breaks with, smallest first. force picks the tier.
const MATERIAL = {
  glass: { small: ['glass_tiny', 'glass_small'], mid: ['glass_med_a', 'glass_med_b', 'glass_med_c'], big: ['glass_large_a', 'glass_large_b'], debris: 'glass_debris' },
  concrete: { small: ['concrete_c'], mid: ['concrete_a', 'concrete_b'], big: ['concrete_a', 'concrete_b'], debris: 'rubble_a' },
  stone: { small: ['concrete_c'], mid: ['concrete_a', 'concrete_b'], big: ['concrete_a', 'concrete_b'], debris: 'rubble_b' },
  metal: { small: ['metal_light', 'metal_d'], mid: ['metal_a', 'metal_b', 'metal_c'], big: ['metal_heavy'], debris: 'metal_debris' },
  wood: { small: ['wood_break'], mid: ['wood_break'], big: ['wood_break'], debris: 'rubble_a' },
  ground: { small: ['gravel_land'], mid: ['gravel_land', 'rubble_b'], big: ['rubble_b'], debris: 'rubble_a' },
};
const DEFAULT_MATERIAL = 'concrete';

// ------------------------------------------------------------------------------------

export default {
  id: 'audio',

  async init(ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { ctx.audio = stub('no Web Audio in this browser'); return; }

    const ac = new AC({ latencyHint: 'interactive' });
    const bank = new Bank(ac);
    const mixer = new Mixer(ac, bank);
    const self = { ac, bank, mixer, unlocked: false, armor: null, lastImpact: 0 };
    this._s = self;

    // ---- the public API on ctx ----------------------------------------------------
    const api = {
      get ready() { return bank.ready; },
      ac, bank, mixer,

      /** One-shot by bank name. opts pass straight through to sources.shot(). */
      play: (name, o) => mixer.play(name, o),
      playOneOf: (names, o) => mixer.playOneOf(names, o),

      /** A looping voice the caller owns. Returns a handle even if the file is missing. */
      loop: (name, o = {}) => {
        const v = mixer.startLoop(name, o);
        return v
          ? { stop: (f) => v.stop(f), set: (p) => { if (p.gain != null) v.setGain(p.gain); if (p.rate != null) v.setRate(p.rate); if (p.cutoff != null) v.setCutoff(p.cutoff); } }
          : { stop() {}, set() {} };
      },

      setThrust: (t) => { self.thrustOverride = clamp(t, 0, 1); },
      setSpeed: (v) => { self.speedOverride = Math.max(0, v); },

      /** Force in newtons-ish; the flight model and destruction both feed this. */
      impact: (force, o = {}) => impact(self, force, o),
      break: (o) => breakAt(self, o),
      music: (cue, o) => mixer.setMusic(cue, o),

      duck: (d, h, r) => mixer.duck(d, h, r),
      mute: (v) => mixer.setMuted(v == null ? !mixer.muted : v),
      volume: (v) => (v == null ? mixer.volume : mixer.setVolume(v)),
      report: () => ({ bank: bank.report(), mix: mixer.report(), unlocked: self.unlocked }),
      /* A headless browser never produces the gesture that unlocks WebAudio, so every
       * verification rig sees `update()` bail on the first line and can prove nothing
       * about the mix. This lets one say "assume the gesture happened"; the AudioContext
       * stays suspended, so nothing is actually audible and no autoplay policy is dodged
       * — the point is only to let the scheduling logic run so it can be measured. */
      forceUnlockedForTests: (v = true) => { self.unlocked = !!v; },
    };
    ctx.audio = api;

    // ---- load the recordings ------------------------------------------------------
    await bank.init();
    if (bank.error) console.warn('[audio]', bank.error);
    if (bank.failed.length) console.warn('[audio] could not load:', bank.failed.join(', '));

    // ---- the browser gesture gate -------------------------------------------------
    // Nothing is allowed to make a sound before the player has touched the page. The
    // beds are not started until then either, or the first click plays four loops from
    // wherever they happened to be, at full level, at once.
    const unlock = () => {
      if (self.unlocked) return;
      self.unlocked = true;
      ac.resume().then(() => {
        mixer.startBeds();
        mixer.updateState(readState(ctx, self));
        cueMusic(self, ctx);
        ctx.bus.emit('audio:ready', api.report());
      }).catch(() => { self.unlocked = false; });
    };
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) {
      addEventListener(ev, unlock, { once: false, passive: true });
    }
    // Some browsers hand us a running context outright (desktop Chrome with a previous
    // gesture on the origin). Take it.
    if (ac.state === 'running') unlock();
    self.unlock = unlock;

    // ---- mute key -----------------------------------------------------------------
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyM') {
        const m = mixer.setMuted(!mixer.muted);
        ctx.bus.emit('audio:mute', m);
        if (ctx.ui && ctx.ui.say) ctx.ui.say(m ? 'AUDIO MUTED.' : 'AUDIO ON.');
      }
    });

    wire(ctx, self);
  },

  update(dt, ctx) {
    const self = this._s;
    if (!self || !self.unlocked) return;
    const { mixer } = self;
    mixer.updateState(readState(ctx, self));
    // The simulation ticks at 120 Hz and can run several ticks per drawn frame. Nine
    // listener AudioParams at that rate is a lot of scheduling for no audible gain;
    // 60 Hz is already finer than the head can hear moving.
    self.listenerClock = (self.listenerClock || 0) + dt;
    if (ctx.camera && self.listenerClock >= 1 / 60) { self.listenerClock = 0; mixer.setListener(ctx.camera); }
    cueMusic(self, ctx);
    sonicBoom(self, ctx, dt);
  },
};

/* THE BANG WHEN YOU LIGHT THE BOOST.
 *
 * Jurek asked for a sonic boom. There is no usable one to download: Wikimedia Commons has
 * exactly one F-18 boom recording and it is clipped (peak 1.50) and flat from the first
 * sample to the last — attack ratio 1.1x, no transient at all, which is a wall of
 * distorted roar and not a bang. Its only thunder-clap alternative is CC BY-SA, which
 * audio/CREDITS.md rules out on purpose. Auditioning and rejecting is the house rule here
 * and both were rejected the same way the flat "crash hit" was in the first pass.
 *
 * So this is built out of recordings ALREADY in the bank and already credited, layered the
 * way a real boom is shaped: a hard transient for the crack, pitched well down so it reads
 * as pressure rather than as an impact, and the deep engine rumble underneath for the tail
 * that rolls away after it. Real files, mixed — the same thing tools/fetch-audio.sh does
 * when it cuts and layers, and nothing synthesised.
 *
 * Fired on the RISING EDGE of boost and rate-limited, because holding Shift is a
 * continuous state and a bang every frame is a machine gun.
 */
function sonicBoom(self, ctx, dt) {
  const on = !!(ctx.state && ctx.state.mode === 'flight' && ctx.flight &&
                ctx.flight.model && ctx.flight.model.boostActive);
  self.boomCool = Math.max(0, (self.boomCool || 0) - dt);
  if (on && !self.boomWas && self.boomCool <= 0) {
    const { mixer } = self;
    const fast = Math.min(1, (ctx.state.speed || 0) / 260);
    const g = 0.55 + 0.45 * fast;
    // The crack: a heavy impact dropped two octaves. Low enough that the ear reads a
    // pressure front rather than something being hit.
    mixer.play('concrete_a', { gain: 0.95 * g, rate: 0.26 });
    mixer.play('metal_heavy', { gain: 0.40 * g, rate: 0.30, delay: 0.012 });
    // The tail: the same deep rumble the thruster sub layer is cut from, rolling away.
    mixer.play('thruster_sub', { gain: 0.55 * g, rate: 0.62, delay: 0.03 });
    // Everything else ducks out of the way of it, hard and briefly.
    mixer.duck(0.35, 0.05, 0.55);
    self.boomCool = 2.5;
  }
  self.boomWas = on;
}

// ------------------------------------------------------------------------------------

function stub(why) {
  console.warn('[audio] disabled:', why);
  const noop = () => {};
  return {
    ready: false, disabled: why,
    play: noop, playOneOf: noop, loop: () => ({ stop: noop, set: noop }),
    setThrust: noop, setSpeed: noop, impact: noop, break: noop, music: noop,
    duck: noop, mute: noop, volume: noop, report: () => ({ disabled: why }),
  };
}

function readState(ctx, self) {
  const s = ctx.state || {};
  const alt = s.altitude || 0;
  // Air thins with height; the wind and the jet both lose body as he climbs. Ask the
  // world for the real number if it has one — it owns the atmosphere, not us.
  let density = 1;
  if (ctx.world && typeof ctx.world.airDensity === 'function') {
    const d = ctx.world.airDensity(alt);
    if (isFinite(d) && d > 0) density = clamp(d, 0.25, 1);
  } else {
    density = clamp(Math.exp(-alt / 7000), 0.3, 1);
  }
  return {
    thrust: self.thrustOverride != null ? self.thrustOverride : (s.thrust || 0),
    speed: self.speedOverride != null ? self.speedOverride : (s.speed || 0),
    altitude: alt,
    density,
    inSuit: s.mode === 'flight' || s.suitClosed === true,
    env: self.env || (s.mode === 'onfoot' && s.envMix > 0.5 ? 'workshop' : 'exterior'),
  };
}

/* ONE TRACK, AND IT IS NOT A CUE SYSTEM.
 *
 * There used to be three beds — house, suitup, flight — cross-faded as the state changed.
 * Jurek picked Ramin Djawadi's "First Flight" from the Iron Man score and asked for that
 * and nothing else, running from the moment the suit-up starts through to its own end.
 * So this function no longer chooses anything: the track is started once, by the
 * `suitup:start` handler, and left alone. Wandering back to a house bed when he lands
 * would be exactly the thing he asked not to happen.
 *
 * Kept as a function because the update loop calls it every frame; it now only makes sure
 * nothing else has quietly set a different cue. */
function cueMusic(self, ctx) {
  const cue = self.mixer.musicCue;
  if (cue && cue !== 'first_flight') self.mixer.setMusic(null, { fade: 0.6 });
}

// ------------------------------------------------------------------------------------
// Impacts. One recording, many sizes: force sets the gain, and it sets the playback rate
// downward, because a slower copy of a rock breaking is a bigger rock breaking.
// ------------------------------------------------------------------------------------
function tierFor(force) {
  return force < 350 ? 'small' : force < 3000 ? 'mid' : 'big';
}
function loudness(force) {
  // log so that a 100x range of forces spans a usable ~20 dB rather than clipping
  // instantly and then never changing again.
  return clamp(0.16 + 0.30 * Math.log10(1 + force / 120), 0.12, 1.25);
}
function heaviness(force) {
  return clamp(1.28 - 0.20 * Math.log10(1 + force / 120), 0.66, 1.32);
}

function impact(self, force, o = {}) {
  const { mixer } = self;
  const f = Math.max(1, force || 0);
  const mat = MATERIAL[o.material] || MATERIAL[DEFAULT_MATERIAL];
  const tier = tierFor(f);
  const names = mat[tier] || mat.mid;
  const now = self.ac.currentTime;
  // Debris physics fires dozens of contacts in one frame; without a gate the mix turns
  // into white noise and the limiter just squashes everything.
  if (now - self.lastImpact < 0.012) return null;
  self.lastImpact = now;

  const g = loudness(f) * (o.gain ?? 1);
  const r = heaviness(f) * (o.rate ?? 1);
  const shot = mixer.playOneOf(names, {
    gain: g, rate: r, pos: o.pos, pan: o.pan,
    // Something struck softly is dull; something struck hard is bright.
    lp: tier === 'small' ? 9000 : 20000,
    refDistance: 10, rolloff: 1.0,
  });
  if (f > 2500 && mat.debris) {
    mixer.play(mat.debris, { gain: g * 0.55, rate: 0.9 + Math.random() * 0.2, delay: 0.13 + Math.random() * 0.12, pos: o.pos });
  }
  if (f > 6000) mixer.duck(0.3, 0.06, 0.35);
  return shot;
}

function breakAt(self, o = {}) {
  return impact(self, o.force ?? 1200, {
    material: o.material, pos: o.point && toArr(o.point),
    gain: 1.05,
  });
}

/**
 * Pan a hand-fired sound. combat/combat.js publishes `hand` as 'L' | 'R' (see its own
 * @param doc); this module was written expecting 'left' | 'right'. Neither is wrong, they
 * were simply written by two people at the same time — and the cost was that every
 * repulsor shot in the game panned to dead centre, because 'R' matched neither branch of
 * the ternary that used to be here. Accept both spellings rather than renaming a public
 * value another module already returns to its callers.
 */
function handPan(hand, amount) {
  if (!hand) return 0;
  const h = String(hand).toLowerCase();
  if (h === 'l' || h === 'left') return -amount;
  if (h === 'r' || h === 'right') return amount;
  return 0;
}

function toArr(p) {
  if (!p) return undefined;
  if (Array.isArray(p)) return p;
  if (typeof p.x === 'number') return [p.x, p.y, p.z];
  return undefined;
}

// ------------------------------------------------------------------------------------
// Bus wiring. Everything the rest of the game emits, and nothing it has to know about us.
// ------------------------------------------------------------------------------------
function wire(ctx, self) {
  const { bus } = ctx;
  const { mixer } = self;

  bus.on('env:set', (which) => { self.env = which; });

  // ---- suit-up ------------------------------------------------------------------
  bus.on('suitup:start', (id) => {
    const a = ARMOR[id] || ARMOR.mk3;
    self.armor = id;
    self.suitingUp = true;
    self.plateCount = 0;
    self.unlock && self.unlock();
    if (a.intro) mixer.play(a.intro, { gain: 0.8 });
    mixer.startServo(a.servo, { rate: a.servoRate, gain: a.servoGain, cutoff: a.servoCutoff });
    mixer.play('hud_scan', { bus: 'ui', gain: 0.7 });
    // Jurek's own 33 s recording of the whole ritual, laid over the top and running for as
    // long as the sequence does. It was on disk and referenced by nothing at all — like
    // every other file he supplied, it was never in audio/manifest.json, so the bank never
    // fetched it and every `mixer.play` naming one of them was a silent no-op.
    self.suitupVoice = mixer.play('jurek_suitup', { gain: 0.85 });
    // The one piece of music in the game, from here to its own end. 187 s, not looped.
    mixer.setMusic('first_flight', { gain: 0.55, fade: 0.4 });
  });

  // One servo/clank per plate. The servo rides up as the sequence gets busier so the
  // gantry sounds like it is working harder as it closes, then the clank lands on top.
  bus.on('suitup:plate', (p = {}) => {
    const a = ARMOR[self.armor] || ARMOR.mk3;
    const n = ++self.plateCount;
    const impactAmt = clamp(p.impact ?? 0.6, 0, 1.5);
    mixer.setServo({
      gain: a.servoGain * (0.75 + 0.35 * Math.min(1, n / 8)),
      rate: a.servoRate * (0.95 + 0.10 * Math.random()),
    });
    mixer.play(pick(a.clank), {
      gain: a.clankGain * (0.55 + 0.6 * impactAmt),
      rate: a.clankRate * (0.94 + 0.12 * Math.random()),
      lp: a.clankLp, hp: a.clankHp,
      pan: (Math.random() - 0.5) * 0.5,
      delay: 0.01 + Math.random() * 0.02,
    });
    if (a.latch > 0.4 && Math.random() < 0.45) {
      mixer.play('latch', { gain: a.latch * 0.5, rate: 0.95 + Math.random() * 0.2, delay: 0.06 });
    }
  });

  bus.on('suitup:done', (id) => {
    const a = ARMOR[id || self.armor] || ARMOR.mk3;
    self.suitingUp = false;
    // The ritual recording is longer than most sequences; let it finish rather than cut.
    self.suitupVoice = null;
    mixer.stopServo(a.quiet ? 0.8 : 0.3);
    mixer.play('latch', { gain: a.latch, rate: a.clankRate });
    mixer.play('suit_ready', { bus: 'ui', gain: 0.55 * a.ready, delay: 0.18 });
    mixer.play('hud_confirm', { bus: 'ui', gain: 0.5, delay: 0.05 });
  });

  // ---- footsteps ---------------------------------------------------------------------
  // Sixteen takes supplied by Jurek, of the player walking IN an armor. Rotating through
  // them without repeating the last two is what stops a walk cycle sounding like a loop.
  bus.on('footstep', (p = {}) => {
    /* ARMOUR ONLY. All sixteen takes are Jurek walking IN a suit — he said so himself when
     * an earlier pass filed them as the boy's footsteps. Playing them pitched up for the
     * un-suited boy does not make them sound like trainers, it makes a thirteen-year-old
     * in a t-shirt clank across his own living room. There is no un-suited footstep
     * recording in the bank, so the honest answer is silence until there is one. */
    if (!self.armor) return;
    const n = 16;
    let i = 1 + Math.floor(Math.random() * n);
    let guard = 0;
    while ((i === self.lastStep || i === self.prevStep) && guard++ < 8) {
      i = 1 + Math.floor(Math.random() * n);
    }
    self.prevStep = self.lastStep;
    self.lastStep = i;

    const suited = !!self.armor;
    const run = p.run ? 1 : 0;
    // Heavier armors land harder and lower. Un-suited, the same recording is pitched up
    // and quietened so the boy does not clank like a robot.
    const heavy = self.armor === 'mk1' ? 1 : self.armor === 'mk2' || self.armor === 'mk3' ? 0.6 : 0.35;
    const rate = suited ? 0.88 - 0.10 * heavy + 0.06 * run : 1.14;
    const gain = (suited ? 0.55 + 0.25 * heavy : 0.20) * (p.crouch ? 0.45 : 1) * (0.9 + 0.2 * run);

    mixer.play(`step_${String(i).padStart(2, '0')}`, {
      gain, rate, pan: (i % 2 ? 1 : -1) * 0.08,
    });
  });

  bus.on('faceplate', (p = {}) => {
    const a = ARMOR[self.armor] || ARMOR.mk3;
    const f = a.face;
    if (p.open) {
      mixer.play(f.open, { gain: f.gain, rate: f.rate * 1.06 });
    } else {
      // Closing is Jurek's recording. Per-armor rate still applies, so the Mk I visor
      // drops lower and heavier than the Mk L nanotech sealing.
      mixer.play('jurek_faceplate_close', { gain: 0.95 * f.gain, rate: f.rate * 0.96 });
      mixer.play(f.close, { gain: f.gain * 0.35, rate: f.rate * 0.96, delay: 0.012 });
    }
    mixer.play(p.open ? 'hud_click' : 'hud_blip', { bus: 'ui', gain: 0.4, delay: 0.05 });
  });

  // ---- repulsors ------------------------------------------------------------------
  bus.on('repulsor:charge', (p = {}) => {
    const heavy = self.armor === 'mk1' || p.chest;
    mixer.play(heavy ? 'repulsor_charge_big' : 'repulsor_charge', {
      gain: 0.5 * (p.power ?? 1), rate: 0.95 + 0.15 * (p.power ?? 1),
      pan: handPan(p.hand, 0.3),
    });
  });

  bus.on('repulsor:fire', (p = {}) => {
    const power = clamp(p.power ?? 1, 0.2, 2);
    const pan = handPan(p.hand, 0.35);
    // Two recordings stacked: the punch and the discharge. Layering at play time rather
    // than baking a composite keeps both credits honest and lets power move the balance.
    // The shot itself is one of Jurek's six recordings, rotated so repeat fire never
    // machine-guns the same waveform. The downloaded layers sit underneath for body.
    let r = 1 + Math.floor(Math.random() * 6);
    if (r === self.lastRepulsor) r = 1 + (r % 6);
    self.lastRepulsor = r;
    const charged = power > 1.1 || p.chest;
    mixer.play(charged ? 'jurek_repulsor_charged' : `jurek_repulsor_${String(r).padStart(2, '0')}`, {
      gain: 0.95 * power, rate: 1.04 - 0.12 * power, pan,
    });
    mixer.play('repulsor_fire_b', { gain: 0.32 * power, rate: 1.15 - 0.2 * power, pan, delay: 0.005 });
    mixer.play('repulsor_tail', { gain: 0.22 * power, rate: 1.1, pan, delay: 0.03 });
    // The reactor hum gets out of the way. This is the sound of the suit spending power.
    mixer.duck(0.45 + 0.2 * power, 0.07, 0.45);
  });

  bus.on('repulsor:hit', (p = {}) => {
    const pos = toArr(p.point);
    mixer.play('repulsor_hit', { gain: 0.7, rate: 0.95 + Math.random() * 0.2, pos });
    impact(self, (p.force ?? 1500), { material: p.material, pos });
  });

  // ---- destruction ------------------------------------------------------------------
  bus.on('break', (p = {}) => breakAt(self, p));

  // A fragment coming to rest. combat/debris.js has emitted this since it was written and
  // nothing listened: the two pieces were built in parallel and never met, so every
  // shattered wall fell to the floor in silence after the initial crash. debris.js
  // already rate-limits it to one event per piece (`piece.landed`), so this can play
  // straight through — the settle is the quiet tail of a break, so it is deliberately
  // much softer than the break itself and never ducks the mix.
  bus.on('debris:land', (p = {}) => {
    const f = clamp(p.force ?? 0.3, 0, 1);
    if (f < 0.06) return;
    impact(self, 220 + 1400 * f, {
      material: p.material, pos: toArr(p.point), gain: 0.34 + 0.3 * f,
    });
  });

  // ---- flight ------------------------------------------------------------------------
  bus.on('impact', (p) => {
    const f = typeof p === 'number' ? p : (p && p.force) || 0;
    if (f < 40) return;
    impact(self, f, { material: (p && p.material) || 'ground', gain: 1.1 });
    if (f > 900) mixer.play('hud_warn', { bus: 'ui', gain: 0.5, delay: 0.08 });
  });

  // ---- HUD / JARVIS ------------------------------------------------------------------
  // The reference frames are dark and sparse. These are small, dry and quiet on purpose.
  const UI = {
    blip: 'hud_blip', tick: 'hud_tick', select: 'hud_select', confirm: 'hud_confirm',
    warn: 'hud_warn', alarm: 'hud_alarm', notify: 'hud_notify', click: 'hud_click',
    scan: 'hud_scan', ready: 'suit_ready',
  };
  bus.on('hud', (p = {}) => {
    const n = UI[p.sound || p.cue] || UI.blip;
    mixer.play(n, { bus: 'ui', gain: p.gain ?? 0.5, rate: p.rate ?? (0.97 + Math.random() * 0.06) });
  });
  bus.on('sfx', (p) => {
    if (typeof p === 'string') return mixer.play(p);
    if (p && p.name) return mixer.play(p.name, p);
  });

  // ---- shell -------------------------------------------------------------------------
  bus.on('pause', () => mixer.setPaused(true));
  bus.on('resume', () => mixer.setPaused(false));
  bus.on('restart', () => {
    self.armor = null; self.suitingUp = false;
    mixer.stopServo(0.1);
    mixer.setMusic(null, { fade: 0.8 });        // restart: silence until the next suit-up
  });

  // ---- the critic's entry point -------------------------------------------------------
  // Honouring debug:* the way ARCHITECTURE.md asks, plus a global so a headless browser
  // can read the mix without a frame ever being drawn.
  bus.on('debug:audio', (p = {}) => {
    if (p.thrust != null) self.thrustOverride = clamp(p.thrust, 0, 1.4);
    if (p.speed != null) self.speedOverride = Math.max(0, p.speed);
    if (p.clear) { self.thrustOverride = null; self.speedOverride = null; }
    if (p.play) mixer.play(p.play, p);
    bus.emit('debug:audio:report', ctx.audio.report());
  });
  window.MZaudio = {
    report: () => ctx.audio.report(),
    set: (thrust, speed) => { self.thrustOverride = thrust; self.speedOverride = speed; mixer.updateState(readState(ctx, self)); return ctx.audio.report(); },
    clear: () => { self.thrustOverride = null; self.speedOverride = null; },
    play: (n, o) => mixer.play(n, o),
    names: () => [...self.bank.meta.keys()],
    mute: (v) => mixer.setMuted(v),
    // Measure what actually leaves the mixer. `await MZaudio.spectrum(0.8, 0)` holds the
    // throttle open and reports the master-bus band split — the check that would have
    // caught the first thruster, whose curves were right and whose recording was a jet
    // half a kilometre away with no top half of the spectrum left in it.
    spectrum: async (thrust, speed, ms) => {
      if (thrust != null) { self.thrustOverride = thrust; self.speedOverride = speed ?? 0; mixer.updateState(readState(ctx, self)); }
      return mixer.spectrum(ms);
    },
    // A whole throttle sweep in one call, so "does it change character?" is answerable
    // with numbers and not with an opinion.
    sweep: async (steps = 5, speed = 0, ms = 700) => {
      const out = [];
      for (let i = 0; i < steps; i++) {
        const t = steps === 1 ? 1 : i / (steps - 1);
        self.thrustOverride = t; self.speedOverride = speed;
        mixer.updateState(readState(ctx, self));
        out.push(await mixer.spectrum(ms));
      }
      self.thrustOverride = null; self.speedOverride = null;
      return out;
    },
  };
}

function pick(a) { return Array.isArray(a) ? a[(Math.random() * a.length) | 0] : a; }
