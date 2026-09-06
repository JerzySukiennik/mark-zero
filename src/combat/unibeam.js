// The charged shot. Owned by task `combat`, driven from combat.js.
//
// THE BEAT, in Jurek's words: a quick click is an ordinary repulsor shot; HOLDING the
// trigger for about three seconds charges, and then every emitter the suit has — the chest
// reactor, both palms, and the two arrays that grow off the shoulders — fires a beam, and
// those beams CONVERGE into one big one that does much more damage.
//
// Two rules he was explicit about:
//
//   ONLY THE BEST SUIT. "ten najlepszy ladowany strzal powinien dzialac tylko z tym
//   najlepszym strojem" — the Mk L and nothing else. The other four are plate armour with
//   two palms; they have nowhere to grow an array from and no reactor output to spare.
//
//   IT IS NANOTECH, NOT MACHINERY. The arrays do not pop into existence and they do not
//   unfold on hinges — they flow out of the armour and melt back into it, and the suit
//   reacts while it happens (the red seams dim as the material is spent and come back as it
//   returns). That behaviour lives in flight/thrustfx.js, which owns the wing meshes; this
//   file owns the beams and the damage.
//
// Damage goes through the ordinary projectile system rather than a special case: one bolt at
// high power and very high speed, so the whole existing chain — swept collision, impact VFX,
// fracture, debris — applies with no new code and no second set of bugs.
import * as THREE from 'three';
import { REPULSOR, glowMaterial } from './vfx.js';

export const CHARGE = {
  time: 3.0,           // seconds of held trigger for a full charge
  converge: 7.0,       // metres ahead of the chest where the feeder beams meet
  life: 0.55,          // seconds the beam is on screen
  /* "jest slabe" — it was. A charged shot that takes three seconds to build has to arrive
   * like a demolition charge, and at six times an ordinary bolt it was landing like two.
   * Sixteen, and a beam wide enough to see, and a light bright enough to change the colour
   * of everything around it for a moment. The other half of "weak" was that it made no
   * sound at all; that is fixed in audio/audio.js. */
  power: 16.0,         // times an ordinary bolt
  speed: 1400,         // m/s — near enough to instant to read as a beam, still a real bolt
  recoil: 34,          // m/s of push-back on the airframe. A beam this size shoves you.
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Unibeam {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'UNIBEAM';
    this.root.visible = false;
    ctx.scene.add(this.root);

    /* A unit cylinder along +Y with its base at the origin, so a beam is drawn by pointing
     * it and scaling it — the same trick the plumes use. Built once. */
    this.geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    this.geo.translate(0, 0.5, 0);

    this.mFeed = glowMaterial(REPULSOR.inner, { additive: true, opacity: 0.75, side: THREE.DoubleSide });
    this.mCore = glowMaterial(0xffffff, { additive: true, opacity: 0.95, side: THREE.DoubleSide });
    this.mBloom = glowMaterial(REPULSOR.bloom, { additive: true, opacity: 0.5, side: THREE.DoubleSide });

    // Five feeders is the most the Mk L can have (reactor + 2 palms + 2 array tips); they
    // are allocated up front and simply hidden when an emitter is not out.
    this.feeds = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.geo, this.mFeed);
      m.frustumCulled = false; m.visible = false;
      this.root.add(m);
      this.feeds.push(m);
    }
    this.core = new THREE.Mesh(this.geo, this.mCore);
    this.bloom = new THREE.Mesh(this.geo, this.mBloom);
    for (const o of [this.core, this.bloom]) { o.frustumCulled = false; this.root.add(o); }

    /* One light, permanently in the scene at zero intensity. NEVER toggle `visible` on it:
     * a light appearing or disappearing changes the scene's light count, which recompiles
     * every material in the game. That was the multi-second freeze on the first shot —
     * the long note in combat/vfx.js has the measurements. */
    this.light = new THREE.PointLight(REPULSOR.light, 0, 60, 2);
    this.root.add(this.light);

    this.t = -1;
  }

  /** True when this armour is allowed the charged shot at all. */
  static allowed(ctx) { return ctx.state.armor === 'mk50'; }

  /**
   * Fire it. `origins` are the world points the feeders come from, `mid` the convergence
   * point, `target` where the big beam ends.
   */
  play(origins, mid, target) {
    for (let i = 0; i < this.feeds.length; i++) {
      const f = this.feeds[i];
      const o = origins[i];
      if (!o) { f.visible = false; continue; }
      f.visible = true;
      this._span(f, o, mid, 0.09);
    }
    this._span(this.core, mid, target, 0.52);
    this._span(this.bloom, mid, target, 1.5);
    this.light.position.copy(mid);
    this.root.visible = true;
    this.t = 0;
  }

  /** Point and stretch one cylinder from `a` to `b`, `r` metres across. */
  _span(mesh, a, b, r) {
    _m.copy(b).sub(a);
    const len = _m.length();
    if (len < 1e-4) { mesh.visible = false; return; }
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, _m.divideScalar(len));
    mesh.scale.set(r, len, r);
    mesh.userData.r = r;
  }

  update(dt) {
    if (this.t < 0) { this.light.intensity = 0; return; }
    this.t += dt;
    const k = this.t / CHARGE.life;
    if (k >= 1) { this.t = -1; this.root.visible = false; this.light.intensity = 0; return; }
    // Punches on, then thins out. The core holds its width almost to the end so the beam
    // reads as a beam rather than as a cone that got wider and vanished.
    const fade = 1 - k * k;
    this.mCore.opacity = 0.95 * fade;
    this.mBloom.opacity = 0.62 * fade * (1 + 0.6 * Math.sin(k * 40));
    this.mFeed.opacity = 0.75 * Math.max(0, 1 - k * 2.2);   // feeders die first: they fed it
    const w = 1 + k * 1.8;
    this.bloom.scale.x = this.bloom.scale.z = (this.bloom.userData.r || 0.85) * w;
    this.light.intensity = 2600 * fade;
  }
}
