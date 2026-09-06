// MARK ZERO — 6DOF flight model. Owned by task `flight`.
//
// THE ONE IDEA
// ------------
// Every thruster pushes along a BODY axis. Drag is anisotropic in the BODY frame: the
// suit is a dart, so it slips through the air nose-first and shoves it broadside. Put
// those two facts together and the whole feel of Iron Man falls out for free:
//
//   * pointing your body along your velocity is what makes you fast,
//   * pointing it across your velocity is what makes you slow,
//   * and turning around at 300 m/s and firing the mains is the ONLY real brake.
//
// There is no "brake key". S is a weak palm-repulsor retro (28% of main) — enough to
// nudge, useless as a stopper. If you want to stop, you flip.
//
// WHAT IS NEW versus the previous attempt (Mark Zero/js/flight.js)
// ---------------------------------------------------------------
//   * Real rotational inertia. That model integrated an angular *velocity* directly with
//     an exponential damper — rotation had no mass. Here we carry a principal inertia
//     tensor, apply torque, and integrate Euler's equations including the gyroscopic
//     term w x (I w). A flick of the mouse spins the suit up over ~0.25 s and it takes
//     the same time to stop. That quarter second is the whole difference between
//     "cursor" and "flying a 220 kg machine".
//   * Aim buffer instead of rate-mapped mouse. Mouse motion fills a small pool of
//     "rotation I still owe you"; the controller spends it at the rate the airframe can
//     actually manage. Flick the mouse at 300 m/s and the suit swings round smoothly
//     over three seconds instead of snapping. Commitment, for free.
//   * A hover that is a position servo, not a velocity damper. The old one multiplied
//     velocity by exp(-k dt) when idle, which asymptotes towards a drift you never quite
//     kill and cannot hold a spot against wind or a nudge. This one anchors a point and
//     flies a critically damped PD back to it: measured drift over 30 s is millimetres.
//     It disengages the instant you touch a translation key, so it never fights you.
//   * Hover authority is allocated through the body thrust envelope, so the assist can
//     never produce a force the actual thrusters could not.
//
// Public surface (ctx.flight):
//   model, active, position, velocity, quaternion, speed, altitude, aimRay(), thrusters
// Bus: listens 'suitup:done', 'debug:fly', 'armor:selected'; emits 'impact'.

import * as THREE from 'three';
import { Input, readCommand, emptyCommand } from './input.js';
import { Poses } from './poses.js';
import { ThrustFX } from './thrustfx.js';

const G = 9.80665;
const SPEED_OF_SOUND = 340.29;

// ---------------------------------------------------------------------------------------
// Armor specifications.
//
// `topSpeed` is a *target*, not a clamp: the forward drag constant is derived from it as
// k = mainThrust / topSpeed^2, so the suit reaches exactly that speed when thrust and drag
// balance, and reaching it takes real time. dragRatio says how much worse the other two
// body axes are: 4x sideways and 5.6x belly-first is what makes the dart a dart.
//
// That ratio is bounded from above by something easy to miss. At top speed, drag exactly
// balances thrust, so forward drag deceleration IS thrust/mass — 6.2 g for the Mk III.
// Multiply by the sideways ratio and you get the deceleration of a suit flying broadside
// at Mach 0.94. At the 6.6x first tried here that is 41 g: the airframe alone stopped you
// in under a second and the mains had nothing left to do, which quietly destroys the
// whole point of the flip. At 4x it is 25 g — violent, which it should be, but the burn
// still does most of the work. The rest of the axis anisotropy comes from thrust instead:
// the mains are 4.8x the side jets, so top speed forward stays ~4.4x top speed sideways.
// ---------------------------------------------------------------------------------------
/* SIDE AND VERTICAL AUTHORITY, RAISED. The Mk III had 2800 N sideways against 13400 N of
 * mains — 12.7 m/s^2, a fifth of what it can do forwards — and 6600 N up, which nets only
 * 20 m/s^2 once gravity is paid. Both of Jurek's "terribly slow to brake sideways / to land"
 * complaints are those two numbers. They are now 0.45 and 0.75 of the mains, so a slide is
 * a manoeuvre you can actually stop and a descent is one you can actually arrest.
 *
 * dragRatio.back is new: drag flying TAIL-FIRST. The k table was symmetric on Z, so an
 * armour going backwards was as slippery as one going nose-first and nothing ever bled a
 * reversed flight off. */
export const ARMOR_SPECS = {
  mk1: {
    name: 'MARK I', mass: 340,
    main: 9800, lateral: 4410, vertical: 7350, retro: 0.22,
    topSpeed: 150, dragRatio: { lateral: 3.2, vertical: 4.2, back: 6.5 },
    maxRate: 1.9, rollRate: 2.4, alphaMax: 8, rollAlphaMax: 12,
    rateFalloffRef: 90, stability: 0.55, integrity: 900, power: 0.8,
    boost: 1.15, flaw: null,
  },
  mk2: {
    name: 'MARK II', mass: 215,
    main: 12600, lateral: 5670, vertical: 9450, retro: 0.28,
    topSpeed: 300, dragRatio: { lateral: 4.0, vertical: 5.6, back: 8 },
    maxRate: 3.0, rollRate: 4.2, alphaMax: 14, rollAlphaMax: 24,
    rateFalloffRef: 200, stability: 1.0, integrity: 1100, power: 1.0,
    boost: 1.4, flaw: 'icing',
  },
  mk3: {
    name: 'MARK III', mass: 220,
    main: 13400, lateral: 6030, vertical: 10050, retro: 0.28,
    topSpeed: 320, dragRatio: { lateral: 4.0, vertical: 5.6, back: 8 },
    maxRate: 3.1, rollRate: 4.4, alphaMax: 14, rollAlphaMax: 25,
    rateFalloffRef: 210, stability: 1.05, integrity: 1600, power: 1.0,
    boost: 1.45, flaw: null,
  },
  mk42: {
    name: 'MARK XLII', mass: 190,
    main: 13000, lateral: 5850, vertical: 9750, retro: 0.30,
    topSpeed: 330, dragRatio: { lateral: 3.8, vertical: 5.2, back: 8 },
    maxRate: 3.4, rollRate: 5.0, alphaMax: 16, rollAlphaMax: 28,
    rateFalloffRef: 215, stability: 0.85, integrity: 1200, power: 0.9,
    boost: 1.45, flaw: 'unstable',
  },
  mk50: {
    name: 'MARK L', mass: 205,
    main: 15200, lateral: 6840, vertical: 11400, retro: 0.34,
    topSpeed: 380, dragRatio: { lateral: 4.2, vertical: 5.8, back: 8.5 },
    maxRate: 3.6, rollRate: 5.2, alphaMax: 18, rollAlphaMax: 30,
    rateFalloffRef: 240, stability: 1.2, integrity: 2000, power: 1.25,
    boost: 1.5, flaw: null,
  },
};

// Scratch vectors — this runs 120x a second, allocate nothing.
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _bv = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

// Retro authority as a fraction of the mains. 0.85 stops a Mk III from top speed in about
// three and a half seconds; the old spec.retro (0.28, forward axis only) took nineteen.
const BRAKE_K = 0.85;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// Body-local offset from the flight model's centre of mass to the soles of the boots.
// Matches the 1.0 m contact radius in resolveGround(), so a landed suit stands on the
// ground instead of hovering a metre over it. Exported because cameraRig derives the
// helmet eye point from the same origin.
export const FEET_OFFSET = new THREE.Vector3(0, -1.0, 0);
// Eye point measured up from the soles: a 1.95 m armour's visor sits at about 1.78 m,
// and the pupil is a hand's width in front of the neck. Used only when the real
// `piv_head` pivot is not available.
export const EYE_FROM_FEET = new THREE.Vector3(0, 1.78, -0.14);

// =======================================================================================
// FlightModel — pure physics. No three.js scene, no DOM, no input handling. It takes a
// command object and a world (surfaceHeight / airDensity) and steps a rigid body.
// This is what the measurement harness drives directly.
// =======================================================================================
export class FlightModel {
  constructor(spec) {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.omega = new THREE.Vector3();          // body-frame angular velocity, rad/s
    this.accel = new THREE.Vector3();          // world-frame linear acceleration
    this.aim = { pitch: 0, yaw: 0 };           // rotation still owed to the player, rad

    this.throttle = 0;
    this.thrustMag = 0;
    this.gForce = 1;
    this.power = 1;
    this.integrity = 1;
    this.ice = 0;
    this.heat = 0;
    this.grounded = false;
    this.contact = false;
    this.impact = 0;
    this.landHard = 0;      // 0..1 severity of the landing being played
    this.locomotion = 'fly';
    this.walkPhase = 0;
    this.walkSpeed = 0;
    this.lookPitch = 0;
    this.liftoffT = 0;
    this.yaw = 0;
    this._arriveSpeed = 0;
    this.landT = 0;         // seconds into it
    this.mode = 'STANDBY';
    this.boostActive = 0;
    this.boostT = 0;
    this.boostLock = false;

    this.hover = false;              // hover servo currently flying the suit
    this.hoverArmed = false;         // H pressed but too fast to engage yet
    this.hoverHold = false;          // H latched on
    this.hoverAnchor = new THREE.Vector3();
    this.hoverYaw = 0;
    this.idleTime = 0;

    this.thrusters = { lh: 0, rh: 0, lb: 0, rb: 0, back: 0 };
    this.setSpec(spec || ARMOR_SPECS.mk3);
  }

  setSpec(spec) {
    this.spec = spec;
    // Drag constants: F = k * v * |v| per body axis. k_forward from the target top speed.
    const kf = spec.main / (spec.topSpeed * spec.topSpeed);
    this.k = {
      x: kf * spec.dragRatio.lateral,
      y: kf * spec.dragRatio.vertical,
      z: kf,
      // Tail-first. Body forward is -Z, so _b.z > 0 means the air is hitting his back.
      zBack: kf * (spec.dragRatio.back || 1),
    };
    // Body lift. Calibrated, not guessed: at 250 m/s with the nose 5 degrees above the
    // flight path the lift equals the suit's weight, so a suit flying fast holds altitude
    // on a hair of nose-up and a suit flying slowly does not. See the lift block in
    // step() for why the model needs this at all.
    this.liftK = spec.mass * G / (250 * 250 * Math.sin(2 * 5 * Math.PI / 180));
    // Principal moments of inertia for a ~1.9 m tall, ~0.55 m wide armoured body,
    // scaled with mass. Roll (long axis) is the cheap one, as it is on any body.
    const s = spec.mass / 220;
    this.I = { x: 34 * s, y: 30 * s, z: 9 * s };
    this.integrityMax = spec.integrity;
    this.hardMax = spec.topSpeed * spec.boost * 1.12;
  }

  get speed() { return this.velocity.length(); }
  get mach() { return this.speed / SPEED_OF_SOUND; }

  // Speed resolved onto each body axis. This is the number that proves the model:
  // forward should be ~5x the sideways figure.
  bodyVelocity(out) {
    return (out || _b).copy(this.velocity).applyQuaternion(_qi.copy(this.quaternion).invert());
  }

  reset(position, yaw = 0) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    _e.set(0, yaw, 0, 'YXZ');
    this.quaternion.setFromEuler(_e);
    this.omega.set(0, 0, 0);
    this.aim.pitch = this.aim.yaw = 0;
    this.throttle = 0; this.ice = 0; this.heat = 0; this.integrity = 1; this.power = 1;
    this.hover = false; this.hoverHold = false; this.hoverArmed = false;
    this.hoverAnchor.copy(position);
    this.impact = 0;
  }

  // Fraction of rated thrust actually available right now.
  powerFactor() {
    let f = 1;
    if (this.spec.flaw === 'icing') f *= 1 - this.ice * 0.8;
    f *= 0.4 + 0.6 * this.integrity;
    // A flat reactor browns the thrusters out to 55%, never to zero. Limping home on a
    // dead reactor is a scene; dropping out of the sky because a meter hit zero is a bug
    // report. Boost is what actually gets locked out (see the gate in step()).
    f *= 0.55 + 0.45 * clamp(this.power / 0.30, 0, 1);
    return Math.max(f, 0);
  }

  // Angular authority falls off with speed. At 320 m/s the Mk III has ~37% of its
  // low-speed rate, so a 180 degree flip is a three-second commitment, not a twitch.
  authority() {
    const v = this.speed;
    // A COASTING SUIT TURNS FASTER. Jurek wants to cut the engine, spin round in the air
    // and burn the other way; with the mains lit the airframe is fighting its own thrust
    // vector, and with them off it is not. 60% more rate at zero throttle is what makes
    // that manoeuvre feel like a decision rather than a slow arc.
    const coast = 1 + 0.6 * (1 - clamp(this.throttle || 0, 0, 1));
    return coast / (1 + Math.pow(v / this.spec.rateFalloffRef, 1.3));
  }

  /* One tick of walking in the armour. Deliberately NOT the flight model with the engines
   * off: an armoured man walking is a yaw, a wish direction and a ground contact, and
   * running it through the 6-DOF integrator only invites the airframe to lie down at 76
   * degrees because the mains happen to be idling.
   *
   * `walkPhase` is the stride clock the pose controller reads; it advances with distance
   * covered, not with time, so the feet stay planted whatever the speed. */
  stepWalk(dt, cmd, world, power) {
    const spec = this.spec;
    // Yaw only. Pitch becomes a head/camera angle, so looking up does not tip the armour.
    this.aim.yaw = clamp(this.aim.yaw + cmd.lookX, -Math.PI, Math.PI);
    this.aim.pitch = clamp(this.aim.pitch + cmd.lookY, -Math.PI, Math.PI);
    this.yaw = (this.yaw || 0) - clamp(this.aim.yaw * 14, -6, 6) * dt;
    this.aim.yaw *= Math.exp(-dt / 0.06);
    this.lookPitch = clamp((this.lookPitch || 0) - cmd.lookY * 1.0, -1.1, 0.9);
    this.aim.pitch = 0;
    _q.setFromAxisAngle(Y_AXIS, this.yaw);
    this.quaternion.copy(_q);
    this.omega.set(0, 0, 0);

    // Armour is heavy. 2.2 m/s, 4.5 running — faster reads as skating, and the footstep
    // takes Jurek supplied were cut from a walk at about two steps a second.
    const run = cmd.boost > 0 ? 1 : 0;
    const target = run ? 4.5 : 2.2;
    _v.set(cmd.lateral || 0, 0, -(cmd.forward || 0));
    if (_v.lengthSq() > 1e-6) _v.normalize().multiplyScalar(target);
    _v.applyQuaternion(this.quaternion);
    const k = 1 - Math.exp(-dt / 0.12);
    this.velocity.x += (_v.x - this.velocity.x) * k;
    this.velocity.z += (_v.z - this.velocity.z) * k;
    this.velocity.y -= G * dt;

    this.position.addScaledVector(this.velocity, dt);
    this.resolveGround(world, dt);   // (world, dt) — not the other way round
    this.resolveSolids(dt);

    // The stride clock: one full cycle per 1.4 m covered.
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkSpeed = sp;
    this.walkPhase = ((this.walkPhase || 0) + (sp / 1.4) * Math.PI * 2 * dt) % (Math.PI * 2);

    this.speed = sp;
    this.thrustMag = 0;
    this.throttle = 0;
    this.mode = 'GROUND';
    this.gForce = 1;
    this.accel.set(0, 0, 0);
    this.aoa = 0;
    this.boostActive = 0;
    this.updateSystems(dt, cmd, 1);   // standing in the armour recharges the reactor
    return;
  }

  // -------------------------------------------------------------------------------------
  step(dt, cmd, world) {
    const spec = this.spec;
    const power = this.powerFactor();
    const alt = Math.max(this.position.y - (world ? world.surfaceHeight(this.position.x, this.position.z) : 0), 0);
    const density = world ? world.airDensity(alt) : 1;
    this.altitude = alt;

    // ---- 1. ROTATION -------------------------------------------------------------------
    const auth = this.authority() * (0.35 + 0.65 * power);
    const maxRate = spec.maxRate * auth;

    /* ═══ GROUND MODE ═══════════════════════════════════════════════════════════════
     *
     * "When the suit touches the ground let me WALK in it — only after Space do you lift
     * off." There was no ground locomotion at all: the airframe ran every tick, so W on
     * the terrace fired 13.4 kN of mains and skidded the armour across the slab.
     *
     * Walking is not flying with the thrusters off, so it does not go through the flight
     * integrator. Yaw-only steering, a velocity that chases the walk wish directly,
     * gravity, and the same resolveGround as everything else. Space is the only way out.
     */
    const wantWalk = this.contact && this.velocity.lengthSq() < 9 &&
                     (cmd.vertical || 0) <= 0 && this.landHard <= 0;
    if (this.locomotion === 'walk') {
      if ((cmd.vertical || 0) > 0.05) {
        // LIFT OFF. A real kick, so leaving the ground is an event and not a drift.
        this.locomotion = 'fly';
        this.velocity.y = 7;
        this.liftoffT = 0.25;
        this.hoverHold = false;
      } else if (!this.contact) {
        // Walked off an edge. Fall — he can catch himself with Space on the way down.
        this._airT = (this._airT || 0) + dt;
        if (this._airT > 0.15) { this.locomotion = 'fly'; this._airT = 0; }
      } else {
        this._airT = 0;
        return this.stepWalk(dt, cmd, world, power);
      }
    } else if (wantWalk && this.speed < 3) {
      this.locomotion = 'walk';
      this.hover = false;
      this.hoverHold = false;
      return this.stepWalk(dt, cmd, world, power);
    }
    if (this.liftoffT > 0) this.liftoffT = Math.max(0, this.liftoffT - dt);

    // The aim buffer: mouse motion is a debt of rotation, spent at the airframe's pace.
    // Clamped to half a turn: a big mouse sweep can command a full flip, but nothing
    // can command four of them, so a pointer-lock glitch cannot send you into a spin.
    this.aim.pitch = clamp(this.aim.pitch + cmd.lookY, -Math.PI, Math.PI);
    this.aim.yaw = clamp(this.aim.yaw + cmd.lookX, -Math.PI, Math.PI);

    let wantPitch = clamp(this.aim.pitch * 14, -maxRate, maxRate);
    let wantYaw = clamp(this.aim.yaw * 14, -maxRate, maxRate);
    let wantRoll = cmd.roll * spec.rollRate * auth;

    // Auto-level: a weak roll command towards wings-level. Weak on purpose — it must
    // never argue with the player, only tidy up after them.
    if (Math.abs(cmd.roll) < 0.01) {
      _v.set(1, 0, 0).applyQuaternion(this.quaternion);
      const bank = _v.y;                     // +1 = rolled hard right
      // MINUS. With a plus this was positive feedback: any bank commanded more of the
      // same bank, so hands-off flight rolled 25 deg -> 45 -> 69 -> 86 and kept going,
      // which is why the suit ended up flying inverted and the horizon looked wrong.
      // It also broke hover, because the hover servo clamps its force in BODY axes and
      // an upside-down suit cannot point that force at the sky.
      wantRoll -= clamp(bank * 3.2 * spec.stability, -1.6, 1.6);
    }
    // In hover the computer also holds the nose level.
    if (this.hover) {
      _v.set(0, 0, 1).applyQuaternion(this.quaternion);
      wantPitch += clamp(-_v.y * 2.6 * spec.stability, -1.4, 1.4);
    }

    // PD to torque, torque limited by what the thrusters can produce.
    const aMax = spec.alphaMax * (0.4 + 0.6 * power);
    const alpha = _w.set(
      clamp((wantPitch - this.omega.x) * 9, -aMax, aMax),
      clamp((wantYaw - this.omega.y) * 9, -aMax, aMax),
      clamp((wantRoll - this.omega.z) * 11, -spec.rollAlphaMax, spec.rollAlphaMax)
    );
    // Euler's equations: I w' = tau - w x (I w). The gyroscopic term is why a fast roll
    // makes a pitch input come out slightly as yaw. Small, but you feel it.
    const Ix = this.I.x, Iy = this.I.y, Iz = this.I.z;
    const wx = this.omega.x, wy = this.omega.y, wz = this.omega.z;
    alpha.x -= (wy * (Iz * wz) - wz * (Iy * wy)) / Ix;
    alpha.y -= (wz * (Ix * wx) - wx * (Iz * wz)) / Iy;
    alpha.z -= (wx * (Iy * wy) - wy * (Ix * wx)) / Iz;
    // Aerodynamic angular damping: the faster you go, the more the air resists a rotation.
    const angDamp = (1.6 + 0.016 * this.speed) * density;
    alpha.addScaledVector(this.omega, -angDamp);

    this.omega.addScaledVector(alpha, dt);

    const wMag = this.omega.length();
    if (wMag > 1e-6) {
      // q' = q * dq, because omega is expressed in the BODY frame.
      _q.setFromAxisAngle(_v.copy(this.omega).divideScalar(wMag), wMag * dt);
      this.quaternion.multiply(_q).normalize();
    }
    // Repay the aim debt by however much we actually turned.
    this.aim.pitch -= this.omega.x * dt;
    this.aim.yaw -= this.omega.y * dt;

    // ---- 2. THRUST, in body axes -------------------------------------------------------
    // Hysteresis: once the reactor runs the boost dry it stays locked out until there is
    // a real charge back in it, instead of stuttering on and off at the threshold.
    if (this.power < 0.12) this.boostLock = true;
    else if (this.power > 0.35) this.boostLock = false;
    /* BOOST YOU CAN FEEL. It used to be a flat x1.45 on the mains, which develops 65 m/s
     * of extra top speed over fifteen seconds and changes nothing you can see or hear in
     * the first second — every feedback channel (state.thrust, the plumes, the audio) was
     * already saturated by W alone, and the FOV moved 3 degrees. Hence "boost does
     * nothing". Two changes: a punch that decays over a third of a second so pressing it
     * is an event, and a cut in forward drag so the top end actually moves.
     * Mk III: 320 -> ~445 m/s, inside the existing hardMax of 520. */
    const boosting = cmd.boost > 0 && !this.boostLock;
    this.boostT = boosting ? (this.boostT || 0) + dt : 0;
    const boost = boosting ? spec.boost * (1 + 0.8 * Math.exp(-this.boostT / 0.35)) : 1;
    this.boostActive = boosting ? 1 : 0;

    const fwd = Math.max(cmd.forward, 0);
    const back = Math.max(-cmd.forward, 0);
    this.throttle = fwd * (boost > 1 ? 1 : 0.72);

    /* IN DRONE MODE THE KEYS MOVE THE ANCHOR, NOT THE SUIT.
     * updateHover() walks the hover anchor when you press a direction while parked. If the
     * mains fire as well, you get both: measured, a 2 s nudge travelled 160 m instead of
     * the 24 m the anchor walk asks for, because the servo was fighting 13.4 kN of thrust
     * it had not asked for. Read off LAST frame's hover state, which is what the servo is
     * about to confirm anyway. */
    const droneMode = this.hover && this.hoverHold;

    _f.set(0, 0, 0);
    if (!droneMode) _f.z -= fwd * spec.main * boost * power;   // mains: body forward is -Z

    // S is a REAL stop now, and it is a different manoeuvre from "thrust backwards".
    //
    // It used to add spec.retro (22-34%) of the mains straight down body +Z, on the theory
    // that stopping should cost you a turn. In practice that is 6 m/s^2 against a suit
    // doing 340, which is nineteen seconds and about three kilometres to come to rest —
    // Jurek's "it tries to stop, but very badly". Worse, it only ever fought the forward
    // component: sideways drift was untouchable, so a botched approach could not be
    // salvaged at all.
    //
    // What the armour actually does is swing all four repulsors round to face the way it
    // is still going and burn. So the retro force opposes the BODY-FRAME VELOCITY, all
    // three axes of it, which kills drift and forward run together and lines up exactly
    // with the brake pose the rig now holds. Capped so it can never add speed backwards
    // once the velocity it is fighting is gone.
    if (back > 0.01 && !droneMode) {
      _bv.copy(this.velocity).applyQuaternion(_q.copy(this.quaternion).invert());
      const bs = _bv.length();
      // BLEND OF STOP AND REVERSE. Capping the retro at the impulse that zeroes the
      // velocity made it a brake that can never, by construction, produce a backward
      // speed — so "you can't fly backwards any more" was the direct cost of fixing the
      // braking. beta is how much of S is "go backwards" rather than "stop": all of it
      // once you have nearly stopped or are already travelling backwards, none of it at
      // speed. One key, and it does the right thing at both ends.
      const beta = (bs > 0.05 && _bv.z > 0.7 * bs) ? 1 : 1 - clamp((bs - 4) / 8, 0, 1);
      _d.set(0, 0, beta);
      if (bs > 0.05) _d.addScaledVector(_bv, -(1 - beta) / bs);
      if (_d.lengthSq() > 1e-6) {
        _d.normalize();
        const want = back * spec.main * BRAKE_K * power;
        // Only the STOPPING part is impulse-capped; the reverse part is free to accelerate.
        const cap = beta < 0.999 ? (bs / dt) * spec.mass / (1 - beta) : Infinity;
        _f.addScaledVector(_d, Math.min(want, cap));
      }
    }
    if (!droneMode) {
      _f.x += cmd.lateral * spec.lateral * power;
      _f.y += cmd.vertical * spec.vertical * power;
    }

    const manualCmd = Math.abs(cmd.forward) + Math.abs(cmd.lateral) + Math.abs(cmd.vertical);
    this._manualCmd = manualCmd;   // resolveGround needs it; see the grounded test there

    // The thrust vector, in body axes, before drag and gravity touch it. poses.js lines the
    // suit's spine up with this — see the body-orientation law there.
    if (!this.thrustBody) this.thrustBody = new THREE.Vector3();
    this.thrustBody.copy(_f);

    // ---- 3. HOVER SERVO ----------------------------------------------------------------
    // Not a velocity damper — a position servo. It holds a point in the world.
    this.updateHover(dt, cmd, manualCmd, power, _f);

    // ---- 4. DRAG, anisotropic, in body axes --------------------------------------------
    this.bodyVelocity(_b);
    const rho = Math.max(density, 0.14);
    _d.set(
      -this.k.x * _b.x * Math.abs(_b.x),
      -this.k.y * _b.y * Math.abs(_b.y),
      -(_b.z > 0 ? this.k.zBack : this.k.z * (this.boostActive ? 0.75 : 1)) * _b.z * Math.abs(_b.z)
    ).multiplyScalar(rho);
    _f.add(_d);

    /* LATERAL FLIGHT ASSIST — the "sideways drag" that was missing.
     * Quadratic drag at a 20 m/s slide is 0.95 m/s^2: nothing. Let go of A and the suit
     * kept sliding for the rest of the flight, which is Jurek's "no drag, it doesn't lose
     * speed flying sideways". Only on X, only when you are NOT asking for a slide, and
     * never on Y or Z — so it kills drift without ever holding him up or eating his coast.
     * Sized to bleed a slide out in about 0.6 s, plus a small linear term so the last
     * centimetre per second dies instead of creeping. */
    if (Math.abs(cmd.lateral || 0) < 0.05 && Math.abs(_b.x) > 0.01) {
      const want = -_b.x * spec.mass / 0.6 - _b.x * 40;
      _f.x += clamp(want, -spec.lateral, spec.lateral);
    }

    // ---- 4b. BODY LIFT -----------------------------------------------------------------
    // Without this the model has a hole in it that a player finds in ten seconds: hold W
    // with the nose level and the suit sinks at its vertical terminal velocity — 78 m/s
    // for the Mk III — so cruising from 600 m ends in the sea in eight seconds no matter
    // how fast you are going. Measured, not argued: a level 20 s run from 300 m put the
    // suit underground with the chase camera looking at dirt.
    //
    // An armoured body flying nose-first at 300 m/s is a lifting body, and treating it as
    // one fixes the hole physically instead of with an autopilot. CL = sin(2a) is the
    // flat-plate law: zero at zero angle of attack, peak at 45 degrees, and back to zero
    // at 90 so a suit flying dead broadside gets nothing — the drag anisotropy is what
    // handles that case, exactly as before. Weighted by how nose-first the flight is, so
    // it fades out through the flip and the flip-and-burn numbers are untouched.
    const vmag = _b.length();
    const fwdComp = -_b.z;
    if (vmag > 8 && fwdComp > 0) {
      const alpha = Math.atan2(-_b.y, fwdComp);        // >0 when the air comes from below
      const lift = this.liftK * rho * vmag * vmag * Math.sin(2 * alpha) * (fwdComp / vmag);
      _f.y += clamp(lift, -3 * spec.mass * G, 3 * spec.mass * G);
      this.aoa = alpha;
    } else {
      this.aoa = 0;
    }

    this.thrustMag = clamp(
      (fwd * boost + Math.abs(cmd.lateral) * 0.4 + Math.abs(cmd.vertical) * 0.5 +
        (this.hover ? 0.34 : 0)) * power, 0, 1.6);

    // ---- 5. INTEGRATE ------------------------------------------------------------------
    _f.applyQuaternion(this.quaternion);          // body -> world
    _f.y -= G * spec.mass;
    this.accel.copy(_f).divideScalar(spec.mass);

    // G is what the pilot feels: acceleration minus gravity, i.e. the thrust vector.
    _v.copy(this.accel); _v.y += G;
    this.gForce = _v.length() / G;

    this.velocity.addScaledVector(this.accel, dt);
    const v = this.velocity.length();
    if (v > this.hardMax) this.velocity.multiplyScalar(this.hardMax / v);
    this.position.addScaledVector(this.velocity, dt);

    this.updateSystems(dt, cmd, boost);
    this.resolveGround(world, dt);
    this.resolveSolids(dt);
    this.updateThrusterMix(cmd, power);
    this.updateMode();
  }

  // -------------------------------------------------------------------------------------
  updateHover(dt, cmd, manualCmd, power, force) {
    const spec = this.spec;
    const sp = this.speed;

    if (cmd.hoverToggle) this.hoverHold = !this.hoverHold;

    /* THE SERVO ONLY EVER ENGAGES BECAUSE YOU ASKED IT TO.
     *
     * It used to catch you automatically after a third of a second hands-off below 45 m/s.
     * Three of Jurek's complaints are that one clause:
     *   - "hover lock does nothing" — H was indistinguishable from letting go, because
     *     letting go did the same thing.
     *   - "without holding thrust the suit should FALL" — it never fell. Cut the engine at
     *     40 m/s and the servo parked you in the air.
     *   - "slow to land" — a servo-held suit can never satisfy the grounded test, so it
     *     hovered a metre up forever instead of arriving.
     * So: `hoverHold` is the whole engage condition. Nothing else parks the suit. */
    this.idleTime = manualCmd > 0.01 ? 0 : this.idleTime + dt;

    if (!this.hoverHold) {
      this.hover = false;
      this.hoverArmed = false;
      return;
    }

    // H below 60 m/s parks you. Above it, H ARMS the stop — the flight computer will not
    // fake a brake you have to earn — and applies the same omnidirectional burn as S until
    // the speed is low enough for the position servo to take over.
    const canCatch = sp < 60;
    if (!this.hover && canCatch && !this.grounded) {
      this.hover = true;
      this.hoverAnchor.copy(this.position);
      this.hoverArmed = false;
    } else if (!this.hover) {
      this.hoverArmed = true;
      // Hold H at speed and the suit kills its own velocity, whatever direction it is in.
      _bv.copy(this.velocity).applyQuaternion(_q.copy(this.quaternion).invert());
      const bs = _bv.length();
      if (bs > 0.05) {
        const want = spec.main * BRAKE_K * power;
        _bv.multiplyScalar(-Math.min(want, (bs / dt) * spec.mass) / bs);
        force.add(_bv);
      }
      return;
    }
    if (!this.hover) return;

    /* DRONE MODE. A translation command used to drop the servo instantly, which made H
     * useless the moment you wanted to move an inch — and "park, then nudge into place"
     * is the entire point of a hover lock when you are trying to land on a donut. The keys
     * now WALK THE ANCHOR instead of cancelling it: 12 m/s of anchor travel in whatever
     * direction you ask, with the servo still flying the suit to it. */
    if (manualCmd > 0.01) {
      _t.set(cmd.lateral || 0, cmd.vertical || 0, -(cmd.forward || 0));
      if (_t.lengthSq() > 1e-6) {
        _t.normalize().applyQuaternion(this.quaternion).multiplyScalar(12 * dt);
        this.hoverAnchor.add(_t);
      }
    }

    // Critically damped PD on the anchor. kp=6, kd=5 gives zeta ~ 1.02.
    _t.copy(this.hoverAnchor).sub(this.position).multiplyScalar(6.0);
    _t.addScaledVector(this.velocity, -5.0);
    _t.y += G;                                   // cancel gravity
    _t.multiplyScalar(spec.mass);                // desired world force

    // Clamp through the real thrust envelope, in body axes, so the servo can never
    // command a force the thrusters do not have.
    _t.applyQuaternion(_qi.copy(this.quaternion).invert());
    _t.x = clamp(_t.x, -spec.lateral * power, spec.lateral * power);
    _t.y = clamp(_t.y, -spec.vertical * power, spec.vertical * power);
    _t.z = clamp(_t.z, -spec.main * 0.30 * power, spec.main * 0.30 * power);
    force.add(_t);
  }

  // -------------------------------------------------------------------------------------
  updateSystems(dt, cmd, boost) {
    const spec = this.spec;
    // Arc reactor. Boost is expensive, cruise is cheap, idling recharges.
    // Measured, not estimated: 34.6 s of held boost on a full charge and ~22 s to refill
    // (MZ_FLIGHT_TEST().boostSecondsOnFullCharge). Long enough to be a decision, short
    // enough that you cannot just hold Shift for the whole flight.
    const drain = (boost > 1 ? 0.050 : 0) + this.thrustMag * 0.006 + (this.hover ? 0.003 : 0);
    const regen = (boost > 1 ? 0.006 : 0.045) * spec.power;
    this.power = clamp(this.power + (regen - drain) * dt, 0, 1);

    if (spec.flaw === 'icing') {
      // Mk II has no de-icing. Above 7 km the airframe glazes over and the thrusters choke.
      const target = clamp((this.altitude - 7000) / 5200, 0, 1);
      const rate = target > this.ice ? 0.10 : 0.42;
      this.ice += (target - this.ice) * clamp(rate * dt * 4, 0, 1);
    } else if (this.ice > 0) {
      this.ice = Math.max(this.ice - dt * 0.4, 0);
    }

    if (spec.flaw === 'unstable') {
      // Mk XLII: the prehensile plates never quite settle. A tiny random torque.
      const j = 0.55 * dt;
      this.omega.x += (Math.sin(this.position.x * 0.7 + this.altitude * 0.13) * j);
      this.omega.z += (Math.sin(this.position.z * 0.9 - this.altitude * 0.11) * j);
    }
  }

  // -------------------------------------------------------------------------------------
  /* WALLS. The flight model only ever collided with the TERRAIN — `surfaceHeight` and
   * nothing else — so the armour flew straight through the house and through every
   * building in the town. Jurek found both.
   *
   * A ball sweep along this tick's travel, against the same Rapier colliders the walker
   * uses, is enough: on a hit, put the suit at the contact point and remove the component
   * of velocity going INTO the surface, so you slide along a wall instead of stopping dead
   * against it. Openings have no collider, so flying in through the terrace still works —
   * which matters, because getting back into the house is a thing he asked for.
   *
   * Skipped below 2 cm of travel per tick, which only means "not moving". The first cut
   * used half a metre — at a 1/120 s tick that is SIXTY METRES PER SECOND, so the whole
   * test silently did nothing below cruising speed and a suit could still drift through a
   * wall at 25 m/s. Measured: flying at 25 m/s straight at a town wall known to be at
   * x = 1742.8 passed clean through it and came out at 1858. */
  resolveSolids(dt) {
    const ph = this.physics;
    if (!ph || !ph.shapeCast) return;
    _v.copy(this.position).sub(this._prevPos || (this._prevPos = this.position.clone()));
    const dist = _v.length();
    if (dist < 0.02) { this._prevPos.copy(this.position); return; }
    _v.divideScalar(dist);
    const hit = ph.shapeCast(this._prevPos, _v, 0.9, dist);
    /* Two guards, and without them this locks the suit in place.
     *
     * castShape is called with stop_at_penetration, so a sweep that STARTS overlapping a
     * collider comes back with a time of impact of zero and the start point as the hit.
     * Repositioning to that point puts the suit back where it began, the next tick starts
     * from the same overlap, and the armour is pinned: measured, flying at 25 m/s in open
     * air 8 m above the town, x never left 1730.0 across 200 ticks.
     *
     * So: ignore a hit with no approach in it (distance ~ 0), and ignore any surface whose
     * normal is not actually facing the way we came from — a wall you are flying INTO has
     * a normal opposing the travel direction, and anything else is a graze or a surface
     * behind us. */
    if (hit && hit.point && hit.normal &&
        hit.distance > 0.05 && (hit.normal.x * _v.x + hit.normal.y * _v.y + hit.normal.z * _v.z) < -0.1) {
      // Sit on the surface, a hair clear of it.
      this.position.copy(hit.point).addScaledVector(hit.normal, 0.95);
      const into = this.velocity.dot(hit.normal);
      if (into < 0) {
        this.velocity.addScaledVector(hit.normal, -into);
        // Hitting a wall at speed is an impact like any other.
        if (-into > 6) this.impact = Math.max(this.impact, -into);
      }
      this.contact = true;
    }
    this._prevPos.copy(this.position);
  }

  resolveGround(world, dt) {
    this.impact = 0;
    const wasGrounded = this.grounded;
    // How fast he was travelling on the way in, before the ground took it away.
    this._arriveSpeed = this.velocity.length();
    this.grounded = false;
    this.contact = false;
    if (!world) return;

    const radius = 1.0;
    const floor = world.surfaceHeight(this.position.x, this.position.z) + radius;
    /* UNDER A FLOOR THE HEIGHTFIELD DOES NOT KNOW ABOUT.
     * surfaceHeight() is the OUTDOOR surface, and inside the house footprint it returns
     * the main slab (96 m) whether you are standing on it or in the basement 5 m below.
     * The suit-up ritual happens on the gantry pad at y = 91, so the first ground pass
     * after take-off used to shove the armour from 91 straight up to 97 — through the
     * slab, into the living room, on the frame the faceplate closed. Anything more than
     * a body-length below the reported surface is indoors, not falling through terrain:
     * leave it alone and let the room's own colliders do the work until it climbs out. */
    if (this.position.y < floor - 2.2) return;
    /* A suit standing still on the floor sits at EXACTLY `floor`, and `y < floor` is false
     * there — so resting on the ground reported no contact at all, and the walk mode above
     * would have kept deciding it had just walked off an edge. Two centimetres of
     * tolerance: still resting counts as still touching. */
    if (this.position.y <= floor + 0.02) this.contact = true;
    if (this.position.y < floor) {
      this.contact = true;
      const into = -this.velocity.y;
      this.position.y = floor;
      if (into > 0) {
        this.impact = into;
        this.velocity.y = into > 18 ? into * 0.28 : 0;
        const fr = into > 18 ? 0.8 : 1 - Math.min(dt * 7, 0.92);
        this.velocity.x *= fr; this.velocity.z *= fr;
      } else {
        this.velocity.y = Math.max(this.velocity.y, 0);
      }
      /* GROUNDED IS ABOUT YOUR HANDS, NOT ABOUT THE THRUSTERS.
       * The old test was `thrustMag < 0.08`, and the hover servo adds ~0.34 to thrustMag
       * whenever it is holding the suit up — so a servo-held armour resting on the floor
       * was never "grounded": mode never became GROUND, the pose never became `stand`, and
       * it hovered a body-length up forever. Ask instead whether the pilot is commanding
       * anything, which is the thing that actually distinguishes landing from flying. */
      this.grounded = this.velocity.lengthSq() < 6 && (this._manualCmd || 0) < 0.05;
    }

    if (this.impact > 11) {
      const dmg = Math.pow((this.impact - 11) / 85, 1.5) * 0.9 * (1400 / this.integrityMax);
      this.integrity = clamp(this.integrity - dmg, 0, 1);
    }
    // THE ARRIVAL — the superhero landing. Latched on the CROSSING into contact, so a suit
    // resting on a roof does not re-land every tick.
    //
    // Triggered on the speed the armour ARRIVED at, not on the vertical closing speed the
    // ground test reports. Measured: dropped from 120 m with a 90 m/s head start and
    // hover off, the impact figure at touchdown was 5.4 m/s — vertical drag and the body's
    // own lift bleed a fall off almost completely, so a 12 m/s threshold on that number is
    // one the game can essentially never reach and the pose would never have played once.
    // Total approach speed is both reachable and the right thing to read anyway: coming in
    // fast and stopping dead is the shot, whatever direction you came from.
    if (this.contact && !wasGrounded && this._arriveSpeed > 12) {
      this.landHard = Math.min(1, 0.25 + (this._arriveSpeed - 12) / 45);
      this.landT = 0;
    }
    if (this.landHard > 0) {
      this.landT += dt;
      // 1.05 s: the drop, the hold on the fist, and standing back up out of it.
      if (this.landT > 1.05 || (!this.grounded && this.landT > 0.25)) this.landHard = 0;
    }
    if (this.grounded && !wasGrounded) { /* landing settle handled by caller via .impact */ }

    // Ceiling. Above ~22 km there is nothing left to push against anyway.
    if (this.position.y > 22000) { this.position.y = 22000; this.velocity.y = Math.min(this.velocity.y, 0); }
  }

  // Which nozzle is doing the work. VFX and audio read this.
  updateThrusterMix(cmd, power) {
    const t = this.thrusters;
    const fwd = Math.max(cmd.forward, 0), back = Math.max(-cmd.forward, 0);
    const up = Math.max(cmd.vertical, 0) + (this.hover ? 0.45 : 0);
    const boots = clamp(fwd * (this.boostActive ? 1 : 0.8) + up * 0.9, 0, 1) * power;
    t.lb = t.rb = boots;
    const hands = clamp(back * 1.0 + up * 0.55 + (this.hover ? 0.4 : 0), 0, 1) * power;
    t.lh = clamp(hands + Math.max(-cmd.lateral, 0) * 0.6, 0, 1);
    t.rh = clamp(hands + Math.max(cmd.lateral, 0) * 0.6, 0, 1);
    t.back = clamp(fwd * 0.7 * power, 0, 1);
  }

  updateMode() {
    const s = this.speed;
    this.bodyVelocity(_b);
    if (this.hover) this.mode = this.hoverHold ? 'HOVER HOLD' : 'HOVER';
    else if (this.hoverArmed) this.mode = 'HOVER ARMED';
    else if (this.grounded) this.mode = 'GROUND';
    else if (_b.z > 25) this.mode = 'RETRO';                    // moving backwards: braking
    else if (this.boostActive && s > 60) this.mode = 'BOOST';
    else if (s > this.spec.topSpeed * 0.62) this.mode = 'CRUISE';
    else if (s > 12) this.mode = 'FLIGHT';
    else this.mode = 'STATION';
  }
}

// =======================================================================================
// The module.
// =======================================================================================
const cmd = emptyCommand();

export default {
  id: 'flight',

  async init(ctx) {
    const model = new FlightModel(ARMOR_SPECS.mk3);
    const input = new Input(ctx.renderer.domElement);
    const poses = new Poses();
    const thrustFX = new ThrustFX(ctx);

    // A stand-in body so flight is visible and testable before suit/ lands. It hides
    // itself the moment the real armour exists.
    const proxy = new THREE.Group();
    proxy.name = 'FLIGHT_PROXY';
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.30, 1.15, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0x7a1414, metalness: 0.9, roughness: 0.28 })
    );
    body.castShadow = true;
    proxy.add(body);
    const core = new THREE.Mesh(
      new THREE.CircleGeometry(0.11, 20),
      new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false })
    );
    core.position.set(0, 0.42, -0.31);
    proxy.add(core);
    proxy.visible = false;
    ctx.scene.add(proxy);

    const api = {
      model,
      input,
      poses,
      thrustFX,
      active: false,
      proxy,
      position: model.position,
      velocity: model.velocity,
      quaternion: model.quaternion,
      thrusters: model.thrusters,
      specs: ARMOR_SPECS,
      get speed() { return model.speed; },
      get altitude() { return model.altitude || 0; },
      get mode() { return model.mode; },

      // Where the crosshair points. Combat fires along this, so the reticle and the
      // repulsor bolt agree by construction rather than by luck.
      aimRay(out) {
        const o = out || { origin: new THREE.Vector3(), direction: new THREE.Vector3() };
        ctx.camera.getWorldPosition(o.origin);
        ctx.camera.getWorldDirection(o.direction);
        return o;
      },
      // Muzzle points, so combat can spawn bolts at the palms but aim them at the reticle.
      handPoint(side, out) {
        const p = (out || new THREE.Vector3()).set(side === 'left' ? -0.42 : 0.42, -0.05, -0.30);
        return p.applyQuaternion(model.quaternion).add(model.position);
      },

      activate(opts = {}) {
        const w = ctx.world;
        const spawn = opts.position ||
          (w && w.spawn ? new THREE.Vector3(w.spawn.x, w.spawn.y + 3, w.spawn.z) : new THREE.Vector3(0, 6, 0));
        model.reset(spawn, opts.yaw || 0);
        if (opts.speed) {
          _v.set(0, 0, -1).applyQuaternion(model.quaternion).multiplyScalar(opts.speed);
          model.velocity.copy(_v);
        }
        api.active = true;
        ctx.state.mode = 'flight';
        ctx.bus.emit('flight:active', true);
      },
      deactivate() { api.active = false; },

      // Drive the LIVE flight from a script instead of the keyboard. This is what lets a
      // critic prove the feel through MZ.simSeconds() against the real terrain and the
      // real air density, rather than only in the offline rig at the bottom of this file.
      //   MZ.ctx.flight.autopilot({ forward: 1 }); MZ.simSeconds(30);
      //   MZ.ctx.flight.autopilot(null);          // hand it back to the player
      autopilot(c) {
        api.forceCmd = c ? Object.assign(emptyCommand(), c) : null;
        return api.forceCmd;
      },
      forceCmd: null,
      setArmor(id) {
        const s = ARMOR_SPECS[id] || ARMOR_SPECS.mk3;
        model.setSpec(s);
      },
    };
    ctx.flight = api;

    ctx.bus.on('armor:selected', (id) => api.setArmor(id));
    // He takes off FROM THE PAD HE JUST SUITED UP ON. activate() with no position falls
    // back to world.spawn, which is the living room — so the ritual used to end in a
    // black basement and the very next frame put the player hovering eight metres up in
    // a room he never walked into, with the workshop's lighting still on the whole of
    // Malibu. Measured: suit-up finished at (-6, 91, 14) on the gantry pad and flight
    // activated at (4, 99, 18). The armour's root is at the SOLES and the flight model is
    // a point mass one metre above them (FEET_OFFSET), so lifting the root by that metre
    // hands the model the same spot the boy is standing on and nothing moves at all.
    ctx.bus.on('suitup:done', (id) => {
      api.setArmor(id);
      const opts = {};
      const root = ctx.suit && ctx.suit.root;
      if (root) {
        root.updateWorldMatrix(true, false);
        const p = new THREE.Vector3();
        root.getWorldPosition(p);
        // A root still parked at the origin means suit/ never placed it; fall back.
        if (isFinite(p.x + p.y + p.z) && p.lengthSq() > 1e-6) {
          opts.position = p.sub(FEET_OFFSET);
          opts.yaw = root.rotation.y;
        }
      }
      api.activate(opts);
    });

    // R puts the boy back in the living room. Nothing used to tell the flight model, so
    // the suit carried on flying: pressing R at 51 m/s over the Pacific respawned him on
    // the sofa and left the camera and the whole JARVIS HUD out at sea, on a state that
    // said mode 'onfoot'. Measured — shots/integration-r1/01_living.png of the first pass
    // is a HUD over open water taken immediately after a restart.
    ctx.bus.on('restart', () => api.deactivate());

    ctx.bus.on('debug:wear', (id) => api.setArmor(id));
    ctx.bus.on('debug:fly', (o) => {
      const opts = o || {};
      if (opts.armor) api.setArmor(opts.armor);
      const w = ctx.world;
      const x = opts.x !== undefined ? opts.x : 0;
      const z = opts.z !== undefined ? opts.z : 0;
      const ground = w ? w.surfaceHeight(x, z) : 0;
      const y = ground + (opts.alt !== undefined ? opts.alt : 120);
      api.activate({ position: new THREE.Vector3(x, y, z), yaw: opts.yaw || 0, speed: opts.speed || 0 });
    });

    // ---- Measurement harnesses. This is how the feel gets proved with numbers. ----------
    // MZ_FLIGHT_TEST(armor)  — the offline rig: pure FlightModel, no ground, no world,
    //                          sea-level air. Fast, exact, and the right place to compare
    //                          two armour specs against each other.
    // MZ_FLIGHT_LIVE(armor)  — the same battery flown through MZ.simSeconds() in the real
    //                          game: real terrain under the suit, real air density falling
    //                          off with altitude, every other module running. Slower, and
    //                          the only one that proves what the player will actually feel.
    window.MZ_FLIGHT_TEST = (armor = 'mk3') => runTests(ctx, armor);
    window.MZ_FLIGHT_LIVE = (armor = 'mk3') => runLive(ctx, armor);
  },

  update(dt, ctx) {
    const api = ctx.flight;
    if (!api) return;
    const model = api.model;
    const input = api.input;

    // Not flying yet: the boy is walking round the house and moving the mouse the whole
    // time. Those deltas have to be THROWN AWAY every step, not left to pile up — the
    // flight Input listens to the window from boot, so without this the suit inherits
    // every pixel of mouse travel since page load and snaps through up to half a turn on
    // the frame the armour closes. (Found by reading, then reproduced: walk to the
    // workshop, suit up, and the first thing the model did was yaw off the aim clamp.)
    // View toggle BEFORE the early return. It used to sit at the bottom of this function,
    // which meant it only ran while flying — on foot the key did nothing at all.
    if (input.tapped('KeyV')) ctx.state.view = ctx.state.view === 'first' ? 'third' : 'first';
    if (!api.active) {
      // Kill the plumes on the way out. They live on the suit's own pivots, so leaving
      // them lit would weld a repulsor flame to an armour standing in the workshop.
      api.thrustFX.update(dt, model, cmd, ctx);
      input.consumeMouse(); input.consumeWheel(); input.endStep(); return;
    }

    readCommand(input, cmd);
    if (api.forceCmd) {
      // A scripted command wins, but the mouse deltas still have to be consumed above or
      // they pile up and the suit spins the moment the autopilot is released.
      Object.assign(cmd, api.forceCmd);
      // hoverToggle is an edge, not a level: honour it once, then clear it.
      if (api.forceCmd.hoverToggle) api.forceCmd.hoverToggle = false;
    }
    if (ctx.state.paused) { for (const k in cmd) if (typeof cmd[k] === 'number') cmd[k] = 0; }
    // The camera rig reads free look from here; the model never sees it (free look moves
    // the head inside the helmet, not the airframe).
    api.lastFreeLookX = cmd.freeLookX;
    api.lastFreeLookY = cmd.freeLookY;
    api.cmd = cmd;

    model.physics = ctx.physics;      // resolveSolids sweeps against the real colliders
    model.step(dt, cmd, ctx.world);

    if (model.impact > 4) ctx.bus.emit('impact', { force: model.impact, point: model.position.clone() });

    // The crater. Emitted on the frame the landing latches, and only then.
    if (model.landHard > 0 && !api._landed) {
      api._landed = true;
      ctx.bus.emit('flight:land', { force: model.landHard, point: model.position.clone() });
      ctx.bus.emit('impact', { force: 8 + model.landHard * 22, point: model.position.clone(), source: 'land' });
    } else if (model.landHard <= 0) api._landed = false;

    // Body visual: the real armour if the suit task has landed, otherwise the proxy.
    //
    // `ctx.suit.root` is an empty holder group that exists from boot and is only filled
    // and made visible by equip(), which is async and loads a 2 MB .glb. Testing the
    // holder alone therefore hid the proxy from the first frame and drew nothing at all
    // in its place — shots/flight/chase.png came back as an empty ocean with no suit in
    // it. `rig` is the thing that only exists once an armour is actually on.
    // Poses first: the suit's placement below reads this frame's leanPitch from it.
    api.poses.update(dt, model, cmd, ctx);
    // ...and the plumes last of all, at the bottom of this function, once the rig has been
    // posed and placed: they hang off the emitter pivots and read their WORLD positions.

    const suitOn = !!(ctx.suit && ctx.suit.rig && ctx.suit.root && ctx.suit.root.visible);
    const suitRoot = suitOn ? ctx.suit.root : null;
    if (suitRoot) {
      api.proxy.visible = false;
      // models/CONTRACT.md puts every armour's origin at the SOLES, y = 0, height 1.95 m.
      // The flight model is a point mass at the body's centre, and resolveGround() rests
      // it 1.0 m above the surface — so the suit has to be dropped by that metre or the
      // whole armour floats a body-length up, and in first person the camera ends up
      // inside its own chest. (It did. See the hover screenshot that caught it.)
      // Lean the BODY inside the airframe. poses.leanPitch was computed every frame and
      // never applied to anything, so the armour flew bolt upright: a man standing in the
      // air, sliding forwards. Rotating the model about its own X lays it down head-first
      // at cruise without touching the flight model's axes, so control is unchanged.
      //
      // The offset is rotated by the SAME quaternion, which keeps the body's centre on the
      // flight model's point mass instead of swinging the whole armour out on a 1 m arm.
      /* THE BODY, composed from the spine axis and the bank — not from two Euler angles.
       *
       * The old form was q_air · Rx(leanPitch) · Rz(leanRoll), and the Rz was applied
       * about the body's own Z after a 76 degree pitch, which put it within 14 degrees of
       * the airframe's vertical: it yawed the armour instead of banking it. See the long
       * note in poses.js for the three bugs that came out of that one composition.
       *
       * `spine` is the feet->head axis the pose controller wants, in AIRFRAME space, so
       * the swing that takes the body's +Y onto it is the whole orientation; `bank` then
       * rolls about that same axis, which is a real bank at any spine angle.
       */
      const pp = ctx.flight.poseParams;
      const spine = (pp && pp.spine) || Y_AXIS;
      _q2.setFromUnitVectors(Y_AXIS, spine);
      _q3.copy(model.quaternion).multiply(_q2);
      // Sign measured, not reasoned: with a minus here, holding D slid the airframe toward
      // world +X (screen right, confirmed from the body velocity) while the suit's +X side
      // rose 0.22 — banking AWAY from the turn, the outside edge lifting like a car body
      // rolling. Into the turn is the reading everyone knows.
      if (pp && Math.abs(pp.bank) > 0.001) {
        _q3.multiply(_q4.setFromAxisAngle(Y_AXIS, pp.bank));
      }
      _v.copy(FEET_OFFSET).applyQuaternion(_q3);
      suitRoot.position.copy(model.position).add(_v);
      suitRoot.quaternion.copy(_q3);
    } else {
      // Only ever a STAND-IN for an armour that has not finished loading. Without the
      // armour test this dark red capsule is what you turn into the moment you take a suit
      // off — the red pill.
      api.proxy.visible = ctx.state.view === 'third' && !!ctx.state.armor;
      api.proxy.position.copy(model.position);
      api.proxy.quaternion.copy(model.quaternion);
    }


    // Telemetry for hud / audio / vfx.
    const s = ctx.state;
    s.speed = model.speed;
    s.altitude = model.altitude || 0;
    s.throttle = model.throttle;
    s.gForce = model.gForce;
    // 1.4, not 1. The plumes, the audio and the HUD all read this, and clamping it at 1
    // meant every one of them was already saturated by W alone — so boost had nowhere to
    // show. See the boost block in step().
    s.thrust = Math.min(model.thrustMag, 1.4);
    s.hoverLock = model.hover;
    s.icing = model.ice;
    s.integrity = model.integrity;
    s.power = model.power;

    // The suit says something when the suit is in trouble. audio/ shipped `hud_alarm` and
    // a `hud` bus listener to reach it, and nothing in the game had ever emitted that
    // event — the two pieces were built in parallel and the wire between them was never
    // run. Latched on the CROSSING, not the level, so a damaged suit does not shriek
    // every frame; re-arms once the condition clears with hysteresis.
    const bad = model.integrity < 0.35 || model.ice > 0.7;
    if (bad && !api._alarmed) {
      api._alarmed = true;
      ctx.bus.emit('hud', { sound: 'alarm', gain: 0.5 });
    } else if (api._alarmed && model.integrity > 0.5 && model.ice < 0.5) {
      api._alarmed = false;
    }

    // Plumes and flight trails, after the rig has been posed and placed above: they read
    // the emitter pivots' world positions, so anything earlier is a frame behind.
    api.thrustFX.update(dt, model, cmd, ctx);

    input.endStep();
  },
};

// =======================================================================================
// The numbers. Deterministic, no rendering, no rAF — a critic can run this headless.
// =======================================================================================
function blankCmd() { return emptyCommand(); }

export { runTests as flightTests };

// A human hand does not teleport the mouse. A 180 degree sweep arrives over about an
// eighth of a second, spread across the frames in between, so that is how the harness
// delivers it too.
function sweep(model, world, dt, radians, steps, base) {
  const c = Object.assign(blankCmd(), base || {});
  const per = radians / steps;
  for (let i = 0; i < steps; i++) { c.lookX = per; model.step(dt, c, world); }
  c.lookX = 0;
  return c;
}

function runTests(ctx, armorId) {
  const real = ARMOR_SPECS[armorId] || ARMOR_SPECS.mk3;
  // The rig has no ground, which means "altitude" is nonsense in it — so the airframe
  // battery runs on a flaw-free clone and the flaws get their own test below, at real
  // altitudes. (The first version of this harness forgot, and reported the Mk II's top
  // speed as 134 m/s because the rig had iced it solid at a notional 100 km.)
  const spec = Object.assign({}, real, { flaw: null });
  const world = {
    surfaceHeight: () => -100000,          // no ground in the test rig
    airDensity: () => 1,                   // sea level, so the numbers are comparable
  };
  const dt = 1 / 120;
  const out = { armor: real.name, mass: real.mass, ratedThrust: real.main + ' N', flaw: real.flaw || 'none' };
  const bv = new THREE.Vector3();

  // --- top speed along each body axis --------------------------------------------------
  // Reported as the component along the axis being driven, not total speed: gravity is
  // on, so a suit holding full lateral thrust is also falling at its vertical terminal
  // velocity and the total would flatter the number.
  const axes = [
    ['forward', (c) => { c.forward = 1; }, 'z', -1],
    ['retro (S alone)', (c) => { c.forward = -1; }, 'z', 1],
    ['lateral', (c) => { c.lateral = 1; }, 'x', 1],
    ['vertical', (c) => { c.vertical = 1; }, 'y', 1],
  ];
  out.topSpeedBodyAxis = {};
  for (const [name, set, axis, sign] of axes) {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    const c = blankCmd(); set(c);
    for (let i = 0; i < 120 * 150; i++) m.step(dt, c, world);
    m.bodyVelocity(bv);
    out.topSpeedBodyAxis[name] = +(bv[axis] * sign).toFixed(1);
  }
  // Boost is a burst, not a cruise setting: the reactor cannot hold it. So the honest
  // number is the peak reached on one full charge, from cruise.
  {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    const c = blankCmd(); c.forward = 1;
    for (let i = 0; i < 120 * 150; i++) m.step(dt, c, world);
    const c2 = blankCmd(); c2.forward = 1; c2.boost = 1;
    let peak = 0, held = 0;
    for (let i = 0; i < 120 * 60; i++) {
      m.step(dt, c2, world);
      m.bodyVelocity(bv); peak = Math.max(peak, -bv.z);
      if (m.boostActive) held += dt;
    }
    out.topSpeedBodyAxis['forward + boost (peak)'] = +peak.toFixed(1);
    out.boostSecondsOnFullCharge = +held.toFixed(1);
  }
  out.anisotropyForwardOverLateral =
    +(out.topSpeedBodyAxis.forward / out.topSpeedBodyAxis.lateral).toFixed(2);

  // --- level flight: does holding W keep you in the air? --------------------------------
  // The question a player asks in the first ten seconds, and the one the model used to
  // fail. Both figures are measured the same way: hold W with the nose level for 60 s and
  // read the steady vertical speed. `withoutLift` is the same model with the lifting-body
  // term switched off — that is what the suit did before, and it is why it drowned.
  {
    const sink = (lift) => {
      const m = new FlightModel(spec);
      m.reset(new THREE.Vector3(0, 0, 0), 0);
      if (!lift) m.liftK = 0;
      const c = blankCmd(); c.forward = 1;
      for (let i = 0; i < 120 * 60; i++) m.step(dt, c, world);
      return { sinkMS: +(-m.velocity.y).toFixed(1), speedMS: +m.speed.toFixed(1) };
    };
    // And the trim: how far the nose has to come up to hold altitude at cruise. A pilot
    // steering for zero vertical speed, which is what a hand on the mouse actually does.
    const trim = () => {
      const m = new FlightModel(spec);
      m.reset(new THREE.Vector3(0, 0, 0), 0);
      const c = blankCmd(); c.forward = 1;
      for (let i = 0; i < 120 * 60; i++) {
        c.lookY = clamp(-m.velocity.y * 0.0006 - m.aim.pitch * 0.02, -0.004, 0.004);
        m.step(dt, c, world);
      }
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion);
      return {
        pitchDeg: +(Math.asin(clamp(f.y, -1, 1)) * 180 / Math.PI).toFixed(1),
        verticalSpeedMS: +m.velocity.y.toFixed(2),
        speedMS: +m.speed.toFixed(1),
      };
    };
    out.levelFlight = {
      holdingWNoseLevel: sink(true),
      withoutLift: sink(false),
      trimmedForLevelFlight: trim(),
      note: 'Lift is what turns "hold W and you hit the sea in 8 s" into "hold W and you fly".',
    };
  }

  // --- flip and burn: the only brake ---------------------------------------------------
  // Flown the way a player flies it. A hand on the mouse does not put the nose on
  // retrograde in one flick and leave it there; it steers towards the retrograde vector
  // and keeps correcting. So the harness runs a proportional pilot doing exactly that,
  // with throttle cut until the nose is pointed the right way and full mains after.
  {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    const c = blankCmd(); c.forward = 1;
    for (let i = 0; i < 120 * 150; i++) m.step(dt, c, world);
    const v0 = m.speed;
    const p0 = m.position.clone();

    const d = new THREE.Vector3();
    const qi = new THREE.Quaternion();
    let t = 0, aligned = 0, vAligned = 0, peakG = 0;
    const c2 = blankCmd();
    for (let i = 0; i < 120 * 60; i++) {
      // Where the pilot wants the nose: straight down the retrograde vector.
      d.copy(m.velocity).normalize().negate().applyQuaternion(qi.copy(m.quaternion).invert());
      const yawErr = Math.atan2(-d.x, -d.z);
      const pitchErr = Math.atan2(d.y, -d.z);
      c2.lookX = (yawErr - m.aim.yaw) * 0.35;
      c2.lookY = (pitchErr - m.aim.pitch) * 0.35;
      c2.forward = aligned ? 1 : 0;
      m.step(dt, c2, world);
      t += dt;
      peakG = Math.max(peakG, m.gForce);
      if (!aligned && Math.abs(yawErr) < 0.25 && Math.abs(pitchErr) < 0.25) {
        aligned = t; vAligned = m.speed;
      }
      if (m.speed < 25) break;         // slow enough for the hover servo to catch you
    }
    const tBurn = t, dBurn = p0.distanceTo(m.position);
    // Let go of everything. The hover servo takes it from here, which is exactly what
    // happens in the game when you stop pressing keys.
    const idleAfter = blankCmd();
    for (let i = 0; i < 120 * 20; i++) { m.step(dt, idleAfter, world); t += dt; if (m.speed < 0.1) break; }
    out.flipAndBurn = {
      fromSpeedMS: +v0.toFixed(1),
      secondsToPointRetrograde: +aligned.toFixed(2),
      speedWhenPointedRetrogradeMS: +vAligned.toFixed(1),
      secondsBurningTo25MS: +tBurn.toFixed(2),
      metresBurningTo25MS: +dBurn.toFixed(1),
      secondsToDeadStop: +t.toFixed(2),
      metresToDeadStop: +p0.distanceTo(m.position).toFixed(1),
      peakG: +peakG.toFixed(1),
      note: 'S retro alone is ' + Math.round(spec.retro * 100) +
            '% thrust and cannot stop you in any useful distance. This is the flip.',
    };
  }

  // --- retro alone, for contrast: proof that S is not a brake ---------------------------
  {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    const c = blankCmd(); c.forward = 1;
    for (let i = 0; i < 120 * 150; i++) m.step(dt, c, world);
    const p0 = m.position.clone();
    const c2 = blankCmd(); c2.forward = -1;
    let t = 0;
    for (let i = 0; i < 120 * 120; i++) { m.step(dt, c2, world); t += dt; if (m.speed < 25) break; }
    out.retroOnly = {
      secondsTo25MS: t >= 119.9 ? 'never — still ' + m.speed.toFixed(0) + ' m/s after 120 s' : +t.toFixed(2),
      metresTravelled: +p0.distanceTo(m.position).toFixed(1),
    };
  }

  // --- hover drift over 30 s -----------------------------------------------------------
  // Engaged while still moving, so the servo has to catch the suit first — a hover that
  // only holds a body already at rest proves nothing.
  {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    m.velocity.set(5, -4, 3);
    const c = blankCmd(); c.hoverToggle = true;
    m.step(dt, c, world);
    const idle = blankCmd();
    for (let i = 0; i < 120 * 6; i++) m.step(dt, idle, world);   // catch and settle
    const p0 = m.position.clone();
    let maxDrift = 0;
    for (let i = 0; i < 120 * 30; i++) {
      m.step(dt, idle, world);
      maxDrift = Math.max(maxDrift, p0.distanceTo(m.position));
    }
    out.hover = {
      engagedAtMS: 7.07,
      driftMetresOver30s: +p0.distanceTo(m.position).toFixed(4),
      maxExcursionMetres: +maxDrift.toFixed(4),
      residualSpeedMS: +m.speed.toFixed(5),
    };
  }

  // --- hover must not fight you --------------------------------------------------------
  {
    const m = new FlightModel(spec);
    m.reset(new THREE.Vector3(0, 0, 0), 0);
    const c = blankCmd(); c.hoverToggle = true; m.step(dt, c, world);
    const idle = blankCmd();
    for (let i = 0; i < 120 * 3; i++) m.step(dt, idle, world);
    // Half a second of forward thrust. If the servo were still in the loop it would eat
    // most of this; it must not.
    const nudge = blankCmd(); nudge.forward = 1;
    for (let i = 0; i < 60; i++) m.step(dt, nudge, world);
    const vAfter = m.speed;
    const free = new FlightModel(spec);          // same nudge with hover never engaged
    free.reset(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 60; i++) free.step(dt, nudge, world);
    let t = 0;
    for (let i = 0; i < 120 * 30; i++) { m.step(dt, idle, world); t += dt; if (m.speed < 0.05) break; }
    out.hoverDoesNotFightYou = {
      nudgeFromHoverMS: +vAfter.toFixed(2),
      sameNudgeWithNoHoverMS: +free.speed.toFixed(2),
      lossPercent: +(100 * (1 - vAfter / free.speed)).toFixed(1),
      secondsToReparkAfterwards: +t.toFixed(2),
    };
  }

  // --- angular authority: committed at speed --------------------------------------------
  {
    const measure = (atSpeed) => {
      const m = new FlightModel(spec);
      m.reset(new THREE.Vector3(0, 0, 0), 0);
      const hold = blankCmd(); hold.forward = atSpeed ? 1 : 0;
      if (atSpeed) for (let i = 0; i < 120 * 150; i++) m.step(dt, hold, world);
      const v0 = m.speed;
      const start = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion);
      const now = new THREE.Vector3();
      const c = blankCmd(); c.forward = hold.forward;
      let t = 0, turned = 0;
      const per = Math.PI / 16;
      for (let i = 0; i < 120 * 30; i++) {
        c.lookX = i < 16 ? per : 0;
        m.step(dt, c, world); t += dt;
        now.set(0, 0, -1).applyQuaternion(m.quaternion);
        turned = Math.acos(clamp(now.dot(start), -1, 1));
        if (turned > Math.PI * 0.97) break;
      }
      return { atMS: +v0.toFixed(0), seconds: +t.toFixed(2) };
    };
    out.flip180 = { fromRest: measure(false), fromTopSpeed: measure(true) };
  }

  // --- Mk II icing, at real altitudes ---------------------------------------------------
  if (real.flaw === 'icing') {
    const sample = (alt) => {
      const w = { surfaceHeight: () => 0, airDensity: () => 1 };
      const m = new FlightModel(real);
      m.reset(new THREE.Vector3(0, alt, 0), 0);
      const c = blankCmd(); c.forward = 1;
      for (let i = 0; i < 120 * 60; i++) { m.position.y = alt; m.step(dt, c, w); }
      m.bodyVelocity(bv);
      return { ice: +(m.ice * 100).toFixed(0) + '%', thrustAvailable: +(m.powerFactor() * 100).toFixed(0) + '%', topSpeedMS: +(-bv.z).toFixed(0) };
    };
    out.mkIIIcing = { at3km: sample(3000), at9km: sample(9000), at13km: sample(13000) };
  }

  return out;
}

// =======================================================================================
// The LIVE battery. Same questions, asked of the running game instead of a rig.
//
// Why both? The rig says the model is correct; this says the game is. They disagree in
// two ways that matter, and both disagreements are the point:
//
//   * Air density. The rig pins rho = 1 so two armours can be compared. In the world the
//     Mk III tops out at 320 m/s near the sea and 385 m/s at 3 km, because there is less
//     air up there to push. That is the number the player meets.
//   * The ground. The first version of this harness held W for 150 s with the nose level
//     and reported a top speed of 6.7 m/s — because with no altitude hold the suit flies
//     into a hillside after forty seconds and spends the rest of the test skidding along
//     it. Correct physics, useless measurement. `cruise()` below flies level the way a
//     pilot would, which is what makes the number mean anything.
//
// Everything here goes through MZ.simSeconds(), so it is deterministic and works in a
// headless browser where requestAnimationFrame never fires.
// =======================================================================================
function runLive(ctx, armorId) {
  const MZ = window.MZ;
  if (!MZ || !MZ.simSeconds) return { error: 'MZ.simSeconds() is not available' };
  const F = ctx.flight;
  const V3 = THREE.Vector3;
  const out = { armor: (ARMOR_SPECS[armorId] || ARMOR_SPECS.mk3).name, where: 'live world' };
  const speed = () => F.model.speed;
  const pos = () => F.model.position.clone();
  const fly = (alt) => { MZ.ctx.bus.emit('debug:wear', armorId); F.setArmor(armorId); MZ.fly({ alt, speed: 0, yaw: 0 }); };

  // Level cruise: hold the altitude and kill the sink, as a pilot flying level would.
  // One MZ.simSeconds(1) per iteration keeps the render count sane — MZ.sim() renders a
  // frame on every call, and stepping one tick at a time crashed the renderer.
  // Five-second chunks rather than one-second ones: MZ.sim() renders a frame per call and
  // in a software-rasterised headless browser that render is the whole cost. The first
  // version of this battery ticked one second at a time and took over twenty minutes,
  // which is the same as not being runnable.
  const cruise = (secs) => {
    const y = F.model.position.y;
    for (let i = 0; i < secs; i += 5) {
      MZ.simSeconds(Math.min(5, secs - i));
      F.model.position.y = y; F.model.velocity.y = 0;
    }
  };

  // ---- top speed along each body axis, at 3 km -----------------------------------------
  const axis = (name, c, key, sign) => {
    fly(3000); F.autopilot(c); cruise(45);
    out[name] = +(F.model.bodyVelocity()[key] * sign).toFixed(1);
    F.autopilot(null);
  };
  axis('topSpeedForwardMS', { forward: 1 }, 'z', -1);
  axis('topSpeedLateralMS', { lateral: 1 }, 'x', 1);
  axis('topSpeedRetroOnlyMS', { forward: -1 }, 'z', 1);
  out.anisotropyForwardOverLateral =
    +(out.topSpeedForwardMS / out.topSpeedLateralMS).toFixed(2);

  // ---- level flight over the real world ------------------------------------------------
  // No altitude help of any kind: start at 900 m over the map, hold W with the nose level
  // for 25 s, and see where the suit is. This is the number that used to say "in the sea".
  {
    fly(900); MZ.simSeconds(0.5);
    const a0 = F.model.altitude;
    F.autopilot({ forward: 1 });
    for (let i = 0; i < 5; i++) MZ.simSeconds(5);
    F.autopilot(null);
    out.levelFlight = {
      startAltitudeM: +a0.toFixed(0),
      altitudeAfter25sM: +F.model.altitude.toFixed(0),
      sinkRateMS: +(-F.model.velocity.y).toFixed(1),
      speedMS: +speed().toFixed(1),
      stillFlying: F.model.altitude > 5,
    };
  }

  // ---- flip and burn: the only brake ---------------------------------------------------
  // A pilot steering the nose onto retrograde four times a second, throttle up once
  // pointed. Deliberately coarse: a human does not correct at 120 Hz either.
  {
    fly(6000); F.autopilot({ forward: 1 }); cruise(45);
    const v0 = speed(), p0 = pos();
    const d = new V3(), qi = new THREE.Quaternion();
    const c = F.autopilot({});
    let t = 0, aligned = 0, peakG = 0;
    for (let i = 0; i < 160; i++) {
      d.copy(F.model.velocity).normalize().negate()
        .applyQuaternion(qi.copy(F.model.quaternion).invert());
      const yawErr = Math.atan2(-d.x, -d.z), pitchErr = Math.atan2(d.y, -d.z);
      c.lookX = (yawErr - F.model.aim.yaw) * 0.35;
      c.lookY = (pitchErr - F.model.aim.pitch) * 0.35;
      c.forward = aligned ? 1 : 0;
      MZ.simSeconds(0.25); t += 0.25;
      peakG = Math.max(peakG, F.model.gForce);
      if (!aligned && Math.abs(yawErr) < 0.25 && Math.abs(pitchErr) < 0.25) aligned = t;
      if (speed() < 25) break;
    }
    F.autopilot(null);
    out.flipAndBurn = {
      fromSpeedMS: +v0.toFixed(1),
      secondsToPointRetrograde: +aligned.toFixed(2),
      secondsToStop: +t.toFixed(2),
      metresToStop: +p0.distanceTo(pos()).toFixed(1),
      peakG: +peakG.toFixed(1),
      note: 'S alone tops out at ' + out.topSpeedRetroOnlyMS + ' m/s and never stops you.',
    };
  }

  // ---- hover: parks you, and does not fight you ----------------------------------------
  {
    fly(220);
    F.model.velocity.set(5, -4, 3);                 // engaged while still moving
    F.autopilot({ hoverToggle: true }); MZ.simSeconds(0.05);
    F.autopilot({}); MZ.simSeconds(6);              // catch and settle
    const p0 = pos();
    let maxDrift = 0;
    for (let i = 0; i < 6; i++) { MZ.simSeconds(5); maxDrift = Math.max(maxDrift, p0.distanceTo(pos())); }
    const h = {
      engagedWhileMovingAtMS: 7.07,
      driftMetresOver30s: +p0.distanceTo(pos()).toFixed(4),
      maxExcursionMetres: +maxDrift.toFixed(4),
      residualSpeedMS: +speed().toFixed(5),
      mode: F.model.mode,
    };
    F.autopilot({ forward: 1 }); MZ.simSeconds(0.5);
    h.speedAfterHalfSecondNudgeMS = +speed().toFixed(2);
    F.autopilot({}); MZ.simSeconds(12);
    h.reparkedToMS = +speed().toFixed(4);
    F.autopilot(null);
    out.hover = h;
  }

  // ---- angular authority falls off with speed ------------------------------------------
  {
    const flip = (fast) => {
      fly(3000);
      if (fast) { F.autopilot({ forward: 1 }); cruise(45); }
      const v = speed();
      const start = new V3(0, 0, -1).applyQuaternion(F.model.quaternion);
      const now = new V3();
      const c = F.autopilot({ forward: fast ? 1 : 0 });
      let t = 0;
      for (let i = 0; i < 150; i++) {
        c.lookX = i === 0 ? Math.PI * 0.13 : 0;
        MZ.simSeconds(0.2); t += 0.2;
        now.set(0, 0, -1).applyQuaternion(F.model.quaternion);
        if (Math.acos(clamp(now.dot(start), -1, 1)) > Math.PI * 0.97) break;
      }
      F.autopilot(null);
      return { atMS: +v.toFixed(0), seconds: +t.toFixed(2) };
    };
    out.flip180 = { fromRest: flip(false), fromCruise: flip(true) };
  }

  return out;
}
