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

const NAMES = ['stand', 'hover', 'cruise', 'brake', 'fire'];

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
      leanPitch: 0,    // radians, body pitch relative to the airframe (head leads)
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
    if (model.grounded && model.thrustMag < 0.1) name = 'stand';
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
    p.leanPitch = approach(p.leanPitch, b.cruise * -1.32 + b.fire * -0.5 + b.hover * 0.06, 2.5, dt);

    // Firing hands follow the trigger, with the off hand trailing slightly.
    p.fireRight = approach(p.fireRight, cmd.fire ? 1 : 0, 9, dt);
    p.fireLeft = approach(p.fireLeft, cmd.fire ? 1 : 0, 6.5, dt);

    // --- publish -------------------------------------------------------------------------
    if (ctx) {
      if (ctx.flight) { ctx.flight.pose = this.name; ctx.flight.poseParams = p; ctx.flight.poseBlend = b; }
      const suit = ctx.suit;
      if (suit) {
        if (suit.setPoseParams) suit.setPoseParams(p, b);
        if (suit.setPose && this._last !== name) suit.setPose(name);
      }
      if (this._last !== name && ctx.bus) ctx.bus.emit('flight:pose', name);
    }
    this._last = name;
    return this.name;
  }
}
