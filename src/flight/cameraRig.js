// Camera rig. Owned by task `flight`.
//
// TWO CAMERAS, AND A NECK
//
// First person is a HELMET, not a matrix copy of the airframe. Three things separate the
// two, and all three come straight off the reference frames in reference/flight/ and
// reference/hud/:
//
//   1. LAG. The helmet is bolted to a head that sits on a neck. When the suit snaps into
//      a turn the view arrives about 80 ms late and overshoots a hair coming back. A
//      camera welded to the body quaternion reads as a tripod on rails; this reads as a
//      person being carried by a machine.
//   2. COMPLIANCE. Acceleration pushes the head back in its cradle. Six centimetres at
//      6 g, springing back over a fifth of a second. You cannot name it while playing,
//      but pull up hard without it and the shot feels weightless.
//   3. SHAKE, driven by G and by thruster output — not by a timer. Hovering is glassy
//      still. Full boost at 380 m/s is a rattle. An impact is a single hard kick that
//      decays. Constant-amplitude "cinematic shake" is the cheap version and is banned.
//
// Third person is a sprung boom that trails the suit, widens its field of view with
// speed, and never sinks through the ground.
//
// V switches. RMB is free look: the head turns inside the helmet, the suit does not.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

// Eye point inside the helmet, in body-local metres, measured from the flight model's
// centre of mass. models/CONTRACT.md puts a model's origin at the soles and its total
// height at 1.95 m; flight.js rests that origin 1.0 m below the centre of mass. So the
// visor is at 1.78 - 1.00 = 0.78 up, and the pupil a hand's width in front of the neck.
//
// The first version used 0.62 with no feet offset at all, which put the camera somewhere
// inside the armour's own ribcage: every first-person frame was a full-screen silhouette
// of the suit's back. When the real `piv_head` pivot exists we use it instead of this,
// because then the eye follows the pose — the head leads a turn, and the view leads
// with it.
const EYE = new THREE.Vector3(0, 0.78, -0.14);
const EYE_FWD = 0.30;          // push out through the faceplate so it never clips
const _eye = new THREE.Vector3();

function damp(current, target, tau, dt) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

class Shake {
  constructor() {
    this.trauma = 0;         // 0..1 impulse energy, decays
    this.t = 0;
    this.offset = new THREE.Vector3();
    this.rot = new THREE.Vector3();
  }
  kick(amount) { this.trauma = Math.min(this.trauma + amount, 1.4); }
  update(dt, level) {
    this.t += dt;
    this.trauma = Math.max(this.trauma - dt * 1.6, 0);
    // level = sustained rattle from thrust and airspeed; trauma = impacts.
    const a = level * 0.55 + this.trauma * this.trauma * 1.6;
    if (a < 1e-4) { this.offset.set(0, 0, 0); this.rot.set(0, 0, 0); return; }
    const t = this.t;
    // Three incommensurable frequencies per axis so it never reads as a sine wave.
    this.offset.set(
      (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 19.3) * 0.4) * 0.013 * a,
      (Math.sin(t * 43.7) * 0.6 + Math.sin(t * 23.9) * 0.4) * 0.013 * a,
      (Math.sin(t * 29.3)) * 0.006 * a
    );
    this.rot.set(
      Math.sin(t * 31.7 + 1.1) * 0.0042 * a,
      Math.sin(t * 26.1 + 2.3) * 0.0042 * a,
      Math.sin(t * 17.9 + 0.4) * 0.0075 * a
    );
  }
}

export default {
  id: 'cameraRig',

  async init(ctx) {
    const cam = ctx.camera;
    cam.position.set(24, 12, 34);
    cam.lookAt(0, 2, 0);

    const rig = {
      view: 'first',
      override: false,             // MZ.cam() parked us; stop driving until released
      headQuat: new THREE.Quaternion(),
      headPos: new THREE.Vector3(),
      compliance: new THREE.Vector3(),   // metres the head has been pushed in its cradle
      complianceVel: new THREE.Vector3(),
      freeYaw: 0, freePitch: 0,
      chasePos: new THREE.Vector3(),
      chaseLook: new THREE.Vector3(),
      chaseReady: false,
      fov: 60,
      shake: new Shake(),
      lag: { x: 0, y: 0 },        // how far the view is behind the airframe; the HUD
                                  // parallaxes off this so the graphics sit in front of
                                  // the world instead of glued to the glass.
      baseFov: 60,
    };
    ctx.cameraRig = rig;

    ctx.bus.on('impact', ({ force }) => rig.shake.kick(Math.min(force / 26, 1.1)));
    ctx.bus.on('repulsor:fire', () => rig.shake.kick(0.10));
    ctx.bus.on('suitup:start', () => { rig.override = false; });
    ctx.bus.on('flight:active', () => { rig.override = false; rig.chaseReady = false; });
    ctx.bus.on('debug:fly', () => { rig.override = false; rig.chaseReady = false; });

    ctx.bus.on('debug:cam', (o) => {
      const { pos, look, fov } = o || {};
      if (!pos && !look && !fov) { rig.override = false; return; }   // MZ.cam() releases
      rig.override = true;
      if (pos) cam.position.set(pos[0], pos[1], pos[2]);
      if (look) cam.lookAt(look[0], look[1], look[2]);
      if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    });
  },

  update(dt, ctx) {
    const rig = ctx.cameraRig;
    const cam = ctx.camera;
    if (!rig || rig.override) return;

    const flight = ctx.flight;
    const model = flight && flight.model;

    if (!flight || !flight.active || !model) { followOnFoot(dt, ctx, rig); return; }

    rig.view = ctx.state.view === 'third' ? 'third' : 'first';

    // ---- free look ---------------------------------------------------------------------
    const cmdFree = !!(flight.cmd && flight.cmd.freeLook);
    if (cmdFree) {
      rig.freeYaw = THREE.MathUtils.clamp(rig.freeYaw + (flight.lastFreeLookX || 0), -2.4, 2.4);
      rig.freePitch = THREE.MathUtils.clamp(rig.freePitch + (flight.lastFreeLookY || 0), -1.1, 1.1);
    } else {
      rig.freeYaw = damp(rig.freeYaw, 0, 0.18, dt);
      rig.freePitch = damp(rig.freePitch, 0, 0.18, dt);
    }

    const speed = model.speed;
    const spec = model.spec;
    const speedFrac = Math.min(speed / spec.topSpeed, 1.3);

    // ---- shake level: sustained from thrust and airspeed, impulses from hits ------------
    const rattle = Math.min(model.thrustMag * 0.35 + Math.pow(speedFrac, 2.2) * 0.9 +
      Math.max(model.gForce - 1.6, 0) * 0.12, 1.6);
    rig.shake.update(dt, rattle);

    // ---- neck compliance: acceleration pushes the head back in its cradle ---------------
    // Critically damped spring, 22 rad/s natural frequency -> settles in ~0.2 s.
    _v.copy(model.accel); _v.y += 9.80665;                       // felt acceleration
    _v.applyQuaternion(_q.copy(model.quaternion).invert());       // into helmet axes
    _v.multiplyScalar(-0.0011);                                   // ~6 cm at 6 g
    _v.clampLength(0, 0.11);
    const k = 484, c = 2 * Math.sqrt(484);
    _v2.copy(_v).sub(rig.compliance).multiplyScalar(k)
      .addScaledVector(rig.complianceVel, -c);
    rig.complianceVel.addScaledVector(_v2, dt);
    rig.compliance.addScaledVector(rig.complianceVel, dt);

    if (rig.view === 'first') firstPerson(dt, ctx, rig, model, speedFrac);
    else thirdPerson(dt, ctx, rig, model, speedFrac);
  },
};

// =======================================================================================
function firstPerson(dt, ctx, rig, model, speedFrac) {
  const cam = ctx.camera;

  // Orientation: the helmet chases the airframe with an 80 ms time constant. That delay
  // is the whole difference between "camera" and "head".
  _q.copy(model.quaternion);
  if (rig.freeYaw || rig.freePitch) {
    _e.set(rig.freePitch, rig.freeYaw, 0, 'YXZ');
    _q.multiply(_q2.setFromEuler(_e));
  }
  rig.headQuat.slerp(_q, 1 - Math.exp(-dt / 0.080));
  rig.headQuat.normalize();

  // How far behind the view is the orientation it is CHASING. The HUD reads this and
  // slides its furniture by it, so the graphics float in front of the world instead of
  // being welded to the glass.
  //
  // Measured against `_q` — the target, free look included — and deliberately NOT against
  // model.quaternion. Free look is an intentional turn of the head inside the helmet, up
  // to 2.4 rad; comparing against the airframe called that "lag" and parked the whole
  // interface hard against one edge of the visor for as long as the right mouse button
  // was held. Against the target it does the right thing in both cases: swinging your
  // eyes around the cockpit slides nothing, and the airframe snapping into a turn slides
  // everything for the fifth of a second it takes your head to catch up.
  _q2.copy(rig.headQuat).invert().multiply(_q);
  _e.setFromQuaternion(_q2, 'YXZ');
  rig.lag.x = _e.y; rig.lag.y = _e.x;

  // Position. Prefer the armour's real head pivot: it moves with the pose, so the view
  // leads a hard turn the way the head does. Fall back to the measured offset when the
  // suit task has not loaded a model yet.
  const head = ctx.suit && ctx.suit.pivots && ctx.suit.pivots.piv_head;
  if (head) {
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(_eye).sub(model.position);
    // Out through the faceplate, along the HELMET's own forward axis — not the airframe's.
    //
    // This was the red metal filling the screen at speed. The head pivot sits INSIDE the
    // skull, so the view only works if something pushes it out through the visor. That
    // push used model.quaternion, which is the direction of flight; in cruise the body is
    // leaned 1.32 rad (76 degrees) inside the airframe, so "forward along the flight axis"
    // runs sideways through the helmet and 0.17 m of it never left the shell. Measured at
    // 342 m/s with 25 rays across the frustum: 23 of them hit helmet_1 / mat_primary, the
    // red plate, from the inside.
    //
    // Taking the axis off the helmet itself makes the push follow the lean, and 0.30 m
    // clears the deepest of the five shells (Mk I is 0.26 m from pivot to visor).
    head.getWorldQuaternion(_q3);
    _v2.set(0, 0, -EYE_FWD).applyQuaternion(_q3);
    _eye.add(_v2);
    // Back into helmet axes so compliance and shake add in the same frame as below.
    _eye.applyQuaternion(_q2.copy(model.quaternion).invert());
  } else {
    _eye.copy(EYE);
  }
  _v.copy(_eye).add(rig.compliance).add(rig.shake.offset);
  _v.applyQuaternion(model.quaternion);
  cam.position.copy(model.position).add(_v);

  cam.quaternion.copy(rig.headQuat);
  if (rig.shake.rot.lengthSq() > 0) {
    _e.set(rig.shake.rot.x, rig.shake.rot.y, rig.shake.rot.z, 'YXZ');
    cam.quaternion.multiply(_q2.setFromEuler(_e));
  }

  // Field of view opens with speed. 60 at rest, 78 flat out — the speed rush without a
  // single post-process trick.
  rig.fov = damp(rig.fov, 60 + 18 * Math.min(speedFrac, 1) + (model.boostActive ? 3 : 0), 0.35, dt);
  if (Math.abs(cam.fov - rig.fov) > 0.01) { cam.fov = rig.fov; cam.updateProjectionMatrix(); }
}

// =======================================================================================
function thirdPerson(dt, ctx, rig, model, speedFrac) {
  const cam = ctx.camera;

  // Boom: behind and above, stretching with speed so the suit shrinks into the frame the
  // way it does in mk3_dive_clouds.jpg.
  // Boom length. Shortened from 5.4 + 4.2 after putting our chase frame next to
  // reference/flight/mk3_flight_a.jpg: in the film the suit IS the subject of the shot,
  // and ours was a figure a tenth of the frame high with an ocean around it. Together
  // with the tighter chase FOV below this roughly doubles how much of the frame the
  // armour occupies without ever hiding what is in front of it.
  const dist = 4.8 + speedFrac * 3.4;
  _v.set(0, 1.35, dist);
  if (rig.freeYaw || rig.freePitch) {
    _e.set(rig.freePitch, rig.freeYaw, 0, 'YXZ');
    _v.applyEuler(_e);
  }
  _v.applyQuaternion(model.quaternion);
  _v.add(model.position);
  // Lead the boom with velocity so hard turns swing the camera wide rather than clipping.
  // CLAMPED, and the clamp is the whole point: unclamped this is 0.055 s of flight, which
  // is a metre while manoeuvring and SEVENTEEN metres at 310 m/s — it quietly tripled the
  // boom at exactly the speed you most want to see the suit, and the chase shot came back
  // with a 20-pixel figure on the horizon. Measured: camera 26.5 m back for a boom asking
  // 9.5 m, the difference being this term alone. Four metres is enough to swing the camera
  // wide in a turn and never enough to become the boom.
  _v2.copy(model.velocity).multiplyScalar(-0.055).clampLength(0, 4);
  _v.add(_v2);

  if (!rig.chaseReady) { rig.chasePos.copy(_v); rig.chaseLook.copy(model.position); rig.chaseReady = true; }
  const tau = 0.11 + 0.06 * (1 - Math.min(speedFrac, 1));

  // VELOCITY FEED-FORWARD, and it is not a nicety.
  //
  // A first-order lag chasing a target that is itself moving settles at a constant error
  // of v * tau — it never catches up, it just stops falling further behind. At 300 m/s
  // and tau = 0.13 s that is 39 metres of extra trail on top of the 9 m boom, and it is
  // exactly what shots/flight/chase.png caught: the suit was a twenty-pixel speck sitting
  // on the horizon instead of the subject of the shot. Measured off the image (angular
  // size against the vertical FOV put the camera 60 m back, not the 25 m the boom asks
  // for), then reproduced.
  //
  // Carrying the camera forward by the suit's own velocity first means the smoothing only
  // ever has to absorb the DIFFERENCE between where the boom was and where it wants to
  // be. Steady-state error goes to zero, the damping still eats every jolt, and the boom
  // length is once again the only thing that decides how big the suit is in frame.
  rig.chasePos.addScaledVector(model.velocity, dt);
  rig.chasePos.lerp(_v, 1 - Math.exp(-dt / tau));

  // Do not sink through the world.
  if (ctx.world && ctx.world.surfaceHeight) {
    const floor = ctx.world.surfaceHeight(rig.chasePos.x, rig.chasePos.z) + 0.8;
    if (rig.chasePos.y < floor) rig.chasePos.y = floor;
  }

  // Look ahead of the suit — but only just ahead, and not at all while it is shooting.
  //
  // The lead used to be 6 + 26 * speedFrac, which is thirty-two metres down the flight
  // axis at cruise. A camera aiming thirty-two metres in front of its subject does not
  // frame the subject: it frames the empty air the subject is heading into, and puts the
  // suit itself down in the corner. That is Jurek's "in third person he just keeps flying
  // forwards — he should always be in the middle of the screen", and it is worst exactly
  // when you care most, because the lead grows with speed.
  //
  // Eight metres at cruise still gives the shot somewhere to go and keeps the armour on
  // the middle third. Firing collapses it to zero: when the repulsors are out the suit IS
  // the shot, and the camera holds it dead centre.
  const firing = (ctx.flight && ctx.flight.pose === 'fire') ? 1 : 0;
  rig.lookLead = damp(rig.lookLead || 0, firing ? 0 : (2 + speedFrac * 6), 0.28, dt);
  _v2.set(0, 0, -1).applyQuaternion(model.quaternion)
    .multiplyScalar(rig.lookLead).add(model.position);
  _v2.y += 0.5;
  // Same feed-forward as the boom, for the same reason. Without it the aim point settles
  // v * 0.16 s behind where it was asked to look, which at cruise is nearly fifty metres
  // — enough to put the "look ahead of the suit" point BEHIND the suit and slide the suit
  // itself off towards the edge of frame.
  rig.chaseLook.addScaledVector(model.velocity, dt);
  rig.chaseLook.lerp(_v2, 1 - Math.exp(-dt / 0.16));

  cam.position.copy(rig.chasePos).add(rig.shake.offset);

  // Roll partially with the suit: 45% reads as flight, 100% reads as motion sickness.
  _v.set(0, 1, 0).applyQuaternion(model.quaternion).normalize().lerp(_v2.set(0, 1, 0), 0.55).normalize();
  _m.lookAt(cam.position, rig.chaseLook, _v);
  cam.quaternion.setFromRotationMatrix(_m);
  if (rig.shake.rot.lengthSq() > 0) {
    _e.set(rig.shake.rot.x * 0.5, rig.shake.rot.y * 0.5, rig.shake.rot.z * 0.5, 'YXZ');
    cam.quaternion.multiply(_q2.setFromEuler(_e));
  }

  // Tighter than the helmet's. First person wants a wide field because you are inside
  // the thing; the chase is a camera looking AT it, and 75 degrees at cruise turned the
  // armour into a speck. 52 -> 66 still opens up with speed and still reads as fast.
  rig.fov = damp(rig.fov, 52 + 14 * Math.min(speedFrac, 1), 0.35, dt);
  if (Math.abs(cam.fov - rig.fov) > 0.01) { cam.fov = rig.fov; cam.updateProjectionMatrix(); }
  rig.lag.x *= 0.9; rig.lag.y *= 0.9;
}

// =======================================================================================
// Before the suit goes on there is a boy walking around a house. If the onfoot task drives
// its own camera it sets ctx.player.ownsCamera and we keep out of the way.
function followOnFoot(dt, ctx, rig) {
  const p = ctx.player;
  if (!p || p.ownsCamera) return;
  const cam = ctx.camera;
  const pos = p.position || (p.mesh && p.mesh.position);
  if (!pos) return;
  const yaw = p.yaw || 0;
  _v.set(Math.sin(yaw) * 4.2, 2.1, Math.cos(yaw) * 4.2).add(pos);
  cam.position.lerp(_v, 1 - Math.exp(-dt / 0.18));
  _v2.copy(pos); _v2.y += 1.1;
  _m.lookAt(cam.position, _v2, _v.set(0, 1, 0));
  cam.quaternion.setFromRotationMatrix(_m);
  if (Math.abs(cam.fov - 60) > 0.01) { cam.fov = 60; cam.updateProjectionMatrix(); }
}
