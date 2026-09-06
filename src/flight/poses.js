// Flight poses. Owned by task `flight`.
//
// The reference library gives exactly two silhouettes and they are not interchangeable
// (reference/flight/, mk3_dive_clouds.jpg vs mk3_flight_a.jpg):
//
//   CRUISE  — arms swept back tight to the body, legs together, head leading. A dart.
//             The only light is the pelvic/boot glow. This is what you see at 300 m/s.
//   HOVER   — arms out and forward, palms down, knees slightly bent, hand repulsors
//             blown out white with a magenta bloom lighting the underside of the forearms.
//
// plus three the game needs: BRAKE (arms forward, palms towards where you are going —
// this is the flip-and-burn read), FIRE (one or both arms extended down the aim line),
// and STAND.
//
// This file decides WHICH pose and HOW MUCH, then hands it to whoever owns the rig. It
// never touches a bone itself: the suit task owns the skeleton, we own the intent. If
// the suit module has not landed yet, the numbers still publish on ctx.flight.pose so
// vfx/audio can read them.

import * as THREE from 'three';

// --- maths for the body-orientation law ------------------------------------------------
const Vec3 = THREE.Vector3;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const ZERO3 = new Vec3(0, 0, 0);
const UP = new Vec3(0, 1, 0);
const G_ = 9.81;
const _la = new Vec3();

function smoothstep(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Pull `v` back toward `ref` if it leans further than `maxRad` away from it. In place. */
function limitAngle(ref, v, maxRad) {
  const d = clamp(ref.dot(v), -1, 1);
  const ang = Math.acos(d);
  if (ang <= maxRad) return v;
  // Slerp from ref toward v, stopping at maxRad.
  _la.copy(v).addScaledVector(ref, -d);
  if (_la.lengthSq() < 1e-9) return v;
  _la.normalize();
  return v.copy(ref).multiplyScalar(Math.cos(maxRad)).addScaledVector(_la, Math.sin(maxRad));
}

/** Exponential damp of a unit vector toward a target, renormalised. In place on `cur`. */
function dampVec(cur, target, tau, dt) {
  const k = 1 - Math.exp(-dt / tau);
  cur.addScaledVector(_la.copy(target).sub(cur), k);
  if (cur.lengthSq() < 1e-9) cur.copy(target); else cur.normalize();
  return cur;
}

const X_AX = new Vec3(1, 0, 0);
const Z_AX = new Vec3(0, 0, 1);
const _iq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _oq = new THREE.Quaternion();
const _oq2 = new THREE.Quaternion();
const _eb = new Vec3();
const _ep = new Vec3();
const _nz = new Vec3();
const _tmp = new Vec3();
const _sw = new Vec3();
const Y_AX = new Vec3(0, 1, 0);

const NAMES = ['stand', 'hover', 'cruise', 'brake', 'fire', 'land'];

function approach(cur, target, rate, dt) {
  const d = target - cur;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

export class Poses {
  constructor() {
    this.name = 'stand';
    this.blend = Object.create(null);
    for (const n of NAMES) this.blend[n] = n === 'stand' ? 1 : 0;

    // Continuous parameters. A rig can drive limbs straight off these without ever
    // knowing the pose names.
    this.params = {
      armSweep: 0,     // 0 = arms down at sides, 1 = swept back hard against the flanks
      armForward: 0,   // 0 = neutral, 1 = arms out ahead, palms leading
      palmDown: 0,     // hover: forearms rotated so the repulsors face the ground
      legTuck: 0,      // 0 = stance apart, 1 = legs together and pointed
      kneeBend: 0,
      leanPitch: 0,   // radians, body pitch relative to the airframe (head leads)
      leanRoll: 0,     // roll of the body into a sideways slide, radians (legacy, unused)
      // The body-orientation law's outputs. `spine` is the feet->head axis in AIRFRAME
      // space; `bank` is the roll about it. flight.js composes the suit from these two.
      spine: new Vec3(0, 1, 0),
      bank: 0,
      headYaw: 0,      // the head leads a turn slightly
      headPitch: 0,
      fireLeft: 0,
      fireRight: 0,
    };
    this._last = null;
  }

  update(dt, model, cmd, ctx) {
    const p = this.params;
    const sp = model.speed;
    const spec = model.spec;
    const bv = model.bodyVelocity();
    const fast = Math.min(sp / (spec.topSpeed * 0.55), 1);
    const movingBackwards = bv.z > 12;                 // velocity is out of your back
    const retro = cmd.forward < -0.05;

    // --- pick the pose -------------------------------------------------------------------
    let name;
    // The landing beats everything: you do not get to strike a cruise pose while you are
    // still folded over your own fist.
    if (model.landHard > 0) name = 'land';
    else if (model.locomotion === 'walk') name = 'stand';
    else if (model.grounded && model.thrustMag < 0.1) name = 'stand';
    else if (cmd.fire) name = 'fire';
    else if (movingBackwards || retro) name = 'brake';
    else if (fast > 0.35) name = 'cruise';
    else name = 'hover';
    this.name = name;

    // Blends cross-fade rather than snap; a 200 ms fade is what stops the suit popping.
    for (const n of NAMES) {
      this.blend[n] = approach(this.blend[n], n === name ? 1 : 0, 5.0, dt);
    }

    // --- continuous parameters -----------------------------------------------------------
    const b = this.blend;
    const targetSweep = b.cruise * 1.0 + b.hover * 0.15 + b.brake * 0.0 + b.fire * 0.2;
    const targetFwd = b.hover * 0.55 + b.brake * 1.0 + b.fire * 0.9;
    const targetPalm = b.hover * 1.0 + b.brake * 0.7;
    const targetTuck = b.cruise * 1.0 + b.brake * 0.35 + b.fire * 0.5;
    const targetKnee = b.hover * 0.55 + b.stand * 0.15 + b.brake * 0.35;

    p.armSweep = approach(p.armSweep, targetSweep, 3.2, dt);
    p.armForward = approach(p.armForward, targetFwd, 3.2, dt);
    p.palmDown = approach(p.palmDown, targetPalm, 3.5, dt);
    p.legTuck = approach(p.legTuck, targetTuck, 2.6, dt);
    p.kneeBend = approach(p.kneeBend, targetKnee, 3.0, dt);

    // The head leads. Small: 8 degrees of yaw into a hard turn reads, 30 looks broken.
    p.headYaw = approach(p.headYaw, -model.omega.y * 0.09, 6, dt);
    p.headPitch = approach(p.headPitch, -model.omega.x * 0.07, 6, dt);
    // -1.32 rad is 76 degrees: at cruise the suit lies down and flies HEAD FIRST, which is
    // the whole silhouette of Iron Man in the air. At -0.16 it stayed upright and read as a
    // man standing in the sky being slid forwards — which is exactly what it looked like.
    // Braking keeps the body upright and feet-first, which is what makes a stop read.
    /* ═══ WHERE THE BODY POINTS ═══════════════════════════════════════════════════════
     *
     * This replaces leanPitch/leanRoll, and it replaces them because that pair was wrong
     * in a way that produced three separate bug reports from one line of composition.
     *
     * flight.js built the suit's orientation as  q_air · Rx(leanPitch) · Rz(leanRoll).
     * The roll was about the body's own Z AFTER the -1.32 rad pitch — and Rx(-1.32) maps
     * the body's Z onto (0, 0.969, 0.248) in airframe space, which is very nearly the
     * airframe's UP axis. So `leanRoll` was never a bank. It was a YAW of a body lying on
     * its face, and a positive one swung the head toward -X. Consequences, all measured:
     *   - D slid the airframe right (physics correct) while the body visibly turned LEFT.
     *     That is "the A and D controls are inverted": only the visual cue was.
     *   - Sliding changed nothing else at all — "it just rotates the body 45 degrees".
     *   - The cruise pose aims the palms at suit-space +Z, meaning "trailing behind". Run
     *     that through the same -1.32 rad pitch and +Z becomes airframe (0, 0.969, 0.248):
     *     straight UP. That is "the repulsors fire upward while flying", and it was never
     *     a bug in the plumes — they were pointing exactly where the pose told them to.
     *
     * So stop describing the body as two Euler angles bolted onto the airframe, and
     * describe it as what it physically is: THE SPINE LINES UP WITH THE THRUST. Everything
     * else falls out of that — cruise lies down head-first because the mains push from the
     * boots, braking stands up feet-first because the retro pushes the other way, and a
     * slide leans and banks into itself without anybody authoring a slide pose.
     *
     * The AIRFRAME still goes where the mouse points. That is deliberate: aiming the nose
     * with the mouse and pressing W is the whole ten-second rule in input.js, and a suit
     * whose thrust axis is separate from its aim is a two-stick spaceship. What changes is
     * that the visible armour is now allowed to be angled AWAY from its own velocity, so
     * W+A finally looks like a slide instead of a chess piece moving sideways.
     */
    const bodyF = ctx && ctx.flight && ctx.flight.model ? ctx.flight.model : model;
    const T = this._T || (this._T = new Vec3());
    T.copy(bodyF.thrustBody || ZERO3);
    const wG = spec.mass * G_;

    // How much the thrust owns the pose. At a standstill with the reactor idling the
    // spine should just be upright; under real thrust it should lie along it.
    const wT = smoothstep(T.length() / wG, 0.25, 0.9);

    // The thrust axis, biased a little "up" so cruise settles near 85 degrees rather than
    // dead flat: at a true 90 the chase boom looks straight down the spine and the head
    // disappears behind the shoulders.
    const uT = this._uT || (this._uT = new Vec3());
    uT.copy(T); uT.y += 0.35 * wG;
    if (uT.lengthSq() < 1e-6) uT.set(0, 1, 0); else uT.normalize();

    // With the engine off there is no thrust to line up with, so line up with the air:
    // a dart along the velocity vector. This is what lets him cut the mains, watch the
    // suit keep its shape through the coast, and turn around inside it.
    const bvNow = bodyF.bodyVelocity ? bodyF.bodyVelocity() : ZERO3;
    const uC = this._uC || (this._uC = new Vec3());
    if (bvNow.length() > 15) uC.copy(bvNow).normalize(); else uC.set(0, 1, 0);

    const uRaw = this._uR || (this._uR = new Vec3());
    uRaw.copy(uT).multiplyScalar(wT).addScaledVector(uC, 1 - wT);
    if (uRaw.lengthSq() < 1e-6) uRaw.set(0, 1, 0); else uRaw.normalize();
    // Never past the horizon and a bit. Without this a hard climb rolls the body over
    // backwards and the armour flies upside down.
    limitAngle(UP, uRaw, 1.745);                       // 100 degrees
    if (!this._u) this._u = new Vec3(0, 1, 0);
    // Walking, he stands up. There is no thrust to line the spine up with, and the coast
    // branch would otherwise lay him along a 2 m/s ground velocity.
    if (bodyF.locomotion === 'walk') uRaw.set(0, 1, 0);
    dampVec(this._u, uRaw, bodyF.locomotion === 'walk' ? 0.12 : 0.22, dt);

    // The bank. Sideways thrust dips that side, exactly like a skier. Independent of the
    // spine direction, so it survives the body being laid down.
    const bankRaw = clamp(Math.atan2(T.x, Math.abs(T.z) + 0.3 * wG) * 1.6, -0.785, 0.785);
    p.bank = approach(p.bank, bankRaw, 4.0, dt);
    p.spine = this._u;
    // Kept for anything still reading them, but nothing composes the body from these now.
    p.leanPitch = 0;
    p.leanRoll = 0;

    // Firing hands follow the trigger, with the off hand trailing slightly.
    p.fireRight = approach(p.fireRight, cmd.fire ? 1 : 0, 9, dt);
    p.fireLeft = approach(p.fireLeft, cmd.fire ? 1 : 0, 6.5, dt);

    // --- publish -------------------------------------------------------------------------
    if (ctx) {
      if (ctx.flight) { ctx.flight.pose = this.name; ctx.flight.poseParams = p; ctx.flight.poseBlend = b; }
      const suit = ctx.suit;
      const rig = suit && suit.rig;
      this._bus = ctx.bus;
      if (rig && rig.setPoseWeights) this.drive(rig, dt, bodyF, cmd, b, p, T);
      else if (suit && suit.setPose && this._last !== name) suit.setPose(name);
      if (this._last !== name && ctx.bus) ctx.bus.emit('flight:pose', name);
    }
    this._last = name;
    return this.name;
  }

  /* ═══ THE CONTINUOUS DRIVE ══════════════════════════════════════════════════════════
   *
   * Everything above decides intent; this turns it into a skeleton that moves every
   * frame. Three layers, in the order rig.js applies them.
   */
  drive(rig, dt, model, cmd, b, p, T) {
    // ---- layer 0: weighted blend of the authored tables ------------------------------
    rig.setPoseWeights(b);

    // ---- layer 1: procedural joint offsets -------------------------------------------
    // What the pilot FEELS: acceleration in body axes with gravity added back, which is
    // the force his arms and legs are actually being pushed around by.
    const a = this._a || (this._a = new Vec3());
    a.copy(model.accel || ZERO3); a.y += G_;
    a.applyQuaternion(_iq.copy(model.quaternion).invert());

    const fast = clamp(model.speed / (model.spec.topSpeed * 0.55), 0, 1);
    const slide = clamp(cmd.lateral || 0, -1, 1);
    const gJit = Math.max((model.gForce || 1) - 2, 0);
    this._t = (this._t || 0) + dt;
    const t = this._t;

    rig.clearJointOffsets();
    /* ACCUMULATE, never replace. Every driver below contributes to the same joint, and
     * setJointOffset() copies — so the last writer used to win outright. Measured: the
     * arm-reach IK at the bottom of this function overwrote the shoulder every frame,
     * which silently deleted the sweep, the ski lean and the idle wobble that had been
     * written a few lines earlier. The shoulder offset sat at exactly -0.1317 for as long
     * as you cared to watch it. */
    const off = (name, ax, ang) => {
      if (Math.abs(ang) < 0.0005) return;
      const cur = rig._offset && rig._offset[name];
      if (cur) cur.multiply(_oq.setFromAxisAngle(ax, ang));
      else rig.setJointOffset(name, _oq.setFromAxisAngle(ax, ang));
    };

    // Arms trail the acceleration. Push forward and they sweep back; brake and they are
    // thrown out in front of him. 0.012 rad per m/s^2, capped at 20 degrees.
    const armTrail = clamp(-a.z * 0.012, -0.35, 0.35);
    // Sweep back along the flanks with speed. This is the `armSweep` that was computed
    // every frame since the file was written and read by nothing.
    const sweep = p.armSweep * 0.42;
    // The skier: the arm on the OUTSIDE of the slide opens, the inside one tucks.
    const skiL = -slide * 0.26, skiR = slide * 0.26;
    off('piv_shoulderL', X_AX, armTrail + sweep);
    off('piv_shoulderR', X_AX, armTrail + sweep);
    off('piv_shoulderL', Z_AX, skiL);
    off('piv_shoulderR', Z_AX, skiR);

    // Elbows bend in hover and under braking; dead straight at cruise.
    const bend = (b.hover * 0.55 + b.brake * 0.85 + b.stand * 0.2) * 0.9;
    off('piv_elbowL', X_AX, -bend);
    off('piv_elbowR', X_AX, -bend);

    // Legs trail the same acceleration at 60%, and tuck together with speed.
    const legTrail = armTrail * 0.6;
    off('piv_hipL', X_AX, legTrail - p.legTuck * 0.05);
    off('piv_hipR', X_AX, legTrail - p.legTuck * 0.05);
    // Knees come up hard in a brake, proportional to how hard he is actually decelerating.
    const decel = clamp(a.z * 0.02, 0, 0.8);
    off('piv_kneeL', X_AX, -(b.hover * 0.35 + b.brake * 0.45 + decel));
    off('piv_kneeR', X_AX, -(b.hover * 0.35 + b.brake * 0.45 + decel));

    // The chest folds under forward thrust and arches back into a stop.
    off('piv_chest', X_AX, clamp(-a.z * 0.006, -0.26, 0.26));

    // The head leads, and keeps leading: it looks down the airframe's nose whatever the
    // body is doing underneath it. `spine` is that body direction in airframe space, so
    // the angle between it and the nose is exactly what the neck has to give back.
    const nose = _nz.set(0, 0, -1);
    const look = clamp(Math.asin(clamp(p.spine.dot(nose), -1, 1)), -0.8, 0.8);
    off('piv_neck', X_AX, -look * 0.55 + p.headPitch);
    off('piv_head', X_AX, -look * 0.35);

    /* IDLE LIFE. Everything above is driven by acceleration and command, so a suit in a
     * steady cruise is mathematically motionless — measured, the shoulder moved 19-38
     * degrees per quarter-second through a slide and then exactly 0.00 for the rest of
     * the run. Correct, and it reads as a statue being dragged through the air. A slow
     * incommensurate wobble on the shoulders and chest costs nothing and keeps the armour
     * alive between manoeuvres; the frequencies are deliberately unrelated so it never
     * settles into a visible loop. */
    const idle = 1 - 0.5 * b.stand;
    const w1 = Math.sin(t * 0.83) * 0.016 * idle;
    const w2 = Math.sin(t * 1.27 + 2.1) * 0.014 * idle;
    const w3 = Math.sin(t * 0.61 + 0.7) * 0.010 * idle;
    off('piv_shoulderL', X_AX, w1);
    off('piv_shoulderR', X_AX, w2);
    off('piv_chest', X_AX, w3);

    // The rattle. Only above 2 g, only a few thousandths of a radian: at 6 g the armour
    // buzzes, and below 2 it is perfectly still.
    if (gJit > 0.01) {
      const j = 0.004 * gJit * Math.sin(t * 69.1);
      for (const n of ['piv_chest', 'piv_shoulderL', 'piv_shoulderR', 'piv_hips']) {
        const q = rig._offset && rig._offset[n];
        if (q) q.multiply(_oq.setFromAxisAngle(Z_AX, j));
      }
    }

    // ---- layer 2: aim the exhaust, every frame ---------------------------------------
    // Where each nozzle has to point is a property of the CURRENT thrust, not of a table
    // authored months ago for an upright body. See the note at the top of the file for
    // what the table-authored version actually produced (palms firing at the sky).
    const bv = model.bodyVelocity ? model.bodyVelocity() : ZERO3;
    const sp = bv.length();

    // Boots: opposite the mains. Their share of the thrust is forward + vertical.
    const eb = _eb.set(0, T.y, T.z);
    if (eb.lengthSq() < 1e-4) eb.set(0, -1, 0); else eb.normalize().multiplyScalar(-1);
    // Palms: the retro, the side jets and the hover share. Empty at a steady cruise, in
    // which case they trail backwards down the flanks — which is the reference frame.
    const ep = _ep.set(T.x, 0, 0);
    if (b.brake > 0.3 && sp > 1) {
      // TOWARD THE DIRECTION OF TRAVEL. Both cases: holding S, and the flip-and-burn where
      // the nose already points the other way. Jurek: "when braking the repulsors fire the
      // wrong way, as if they wanted to keep going".
      ep.copy(bv).normalize();
    } else if (b.hover > 0.3) {
      ep.set(0, -1, 0);
      if (sp > 1) ep.addScaledVector(_tmp.copy(bv).normalize(), 0.4).normalize();
    } else if (ep.lengthSq() < 1e-4) {
      ep.set(0, 0, 1);                       // trailing aft along the flanks
    } else {
      ep.normalize().multiplyScalar(-1);
    }

    // Suit space is the body's own frame: `spine` maps airframe -> body, so undo it.
    _bq.setFromUnitVectors(UP, p.spine).invert();
    eb.applyQuaternion(_bq);
    ep.applyQuaternion(_bq);

    if (!cmd.fire) {
      rig.aimEmitterNow('piv_thrusterL', eb, 0.87);
      rig.aimEmitterNow('piv_thrusterR', eb, 0.87);
      // Two passes. The first says how far the wrist falls short, the shoulder takes most
      // of that, and the second solves the wrist again in the arm's NEW position — which
      // is the position it will actually be rendered in, now that aimEmitterNow walks the
      // offsets too. One pass alone leaves the palm chasing an arm that moved after it.
      let exL = rig.aimEmitterNow('piv_palmL', ep, 0.95);
      let exR = rig.aimEmitterNow('piv_palmR', ep, 0.95);
      if (exL > 0.01) off('piv_shoulderL', X_AX, -exL * 0.85);
      if (exR > 0.01) off('piv_shoulderR', X_AX, -exR * 0.85);
      exL = rig.aimEmitterNow('piv_palmL', ep, 0.95);
      exR = rig.aimEmitterNow('piv_palmR', ep, 0.95);
      // Two-joint IK: if the wrist could not reach, give 40% of the shortfall to the
      // shoulder so the whole arm reaches instead of the hand snapping.
      // Whatever is still out of reach after the second pass goes to the shoulder as well:
      // the arm keeps swinging rather than the wrist snapping to its limit.
      if (exL > 0.01) off('piv_shoulderL', X_AX, -exL * 0.6);
      if (exR > 0.01) off('piv_shoulderR', X_AX, -exR * 0.6);
    }

    /* ---- the walk cycle -------------------------------------------------------------
     * Driven by the stride clock in flight.js, which advances with DISTANCE COVERED, so
     * the feet stay planted whatever the speed. The swing axis comes from the direction
     * he is actually travelling rather than from the nose, which is what makes walking
     * sideways a side-step instead of a forward march performed crabwise.
     */
    if (model.locomotion === 'walk') {
      const ph = model.walkPhase || 0;
      const amp = clamp((model.walkSpeed || 0) / 2.2, 0, 1.4);
      const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
      // Which way is he stepping, in body axes.
      const wdir = _tmp.copy(bv);
      wdir.y = 0;
      const side = wdir.lengthSq() > 0.04 ? clamp(wdir.normalize().x, -1, 1) : 0;
      const swingAx = _sw.set(side, 0, 0).lerp(X_AX, 1 - Math.abs(side)).normalize();

      off('piv_hipL', swingAx, 0.45 * amp * sL);
      off('piv_hipR', swingAx, 0.45 * amp * sR);
      off('piv_kneeL', X_AX, -0.9 * amp * Math.pow(Math.max(0, sL), 1.2));
      off('piv_kneeR', X_AX, -0.9 * amp * Math.pow(Math.max(0, sR), 1.2));
      // Arms counter-swing, and the whole body rides the stride.
      off('piv_shoulderL', swingAx, 0.25 * amp * sR);
      off('piv_shoulderR', swingAx, 0.25 * amp * sL);
      off('piv_chest', Y_AX, 0.06 * amp * sL);
      rig.setRootOffset(-0.03 * amp * Math.abs(Math.sin(ph * 2)));

      // One footstep per foot per cycle, on the crossing. audio/ already owns the sixteen
      // armoured takes Jurek recorded; nothing was ever emitting this event on the ground.
      const half = ph < Math.PI ? 0 : 1;
      if (this._walkHalf !== half && amp > 0.15) {
        this._walkHalf = half;
        if (this._bus) this._bus.emit('footstep', { run: (model.walkSpeed || 0) > 3.2, speed: model.walkSpeed });
      }
      return;
    }

    // ---- the landing crouch ----------------------------------------------------------
    if (model.landHard > 0) {
      const lt = model.landT || 0;
      const drop = model.landHard * 0.35 * Math.sin(Math.PI * clamp(lt / 0.45, 0, 1));
      rig.setRootOffset(-drop);
      // The strike: the left fist is driven into the ground between 0.10 s and 0.30 s.
      if (lt > 0.10 && lt < 0.30) off('piv_shoulderL', X_AX, 0.35);
    } else {
      rig.setRootOffset(0);
    }
  }
}
