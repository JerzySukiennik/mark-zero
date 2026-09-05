// MARK XLII suit-up — the prehensile suit, flying to him across the room.
// Owned by task `suitup`.
//
// The feel: discrete rigid plates, each with its OWN trajectory, its OWN spin, its OWN
// motion blur and its OWN specular hit as it locks. No gantry, no arms, no order that
// looks like a machine working: the gauntlet arrives first because it is nearest, a
// shoulder next, and for a full second the boy is standing there in one gauntlet and
// one shoulder plate and otherwise ordinary clothes. Every partial state has to be
// believable, so plate arrivals are deliberately spread out and never symmetric.
//
// The trails are real geometry stretched along each plate's velocity (a cheap and
// reliable motion blur that survives any post chain), and the lock flash is an
// unlit additive shell that blows to white for two frames — toneMapped:false, because
// an additive effect vanishes against a bright floor otherwise.
//
// Reference: reference/suitup/mk42_pieces_flying_onto_tony_concept.jpg,
// mk42_partial_suits_inbound_keyart.jpg.

import * as THREE from 'three';
import { mulberry32 } from '../rig.js';

// Nearest-first, deliberately unsymmetric. This ORDER is the one thing a viewer reads
// as "it is coming to him", so it must not look sorted.
const ORDER = [
  'gauntletR', 'pauldronL', 'bootR', 'forearmR', 'thighL', 'palmR',
  'chest', 'shinR', 'bicepL', 'elbowR', 'kneeL', 'back',
  'gauntletL', 'ribR', 'bootL', 'pelvis', 'forearmL', 'thighR',
  'pauldronR', 'abdomen', 'shinL', 'palmL', 'ribL', 'bicepR',
  'kneeR', 'elbowL', 'collarL', 'beltR', 'thrusterR', 'collarR',
  'beltL', 'thrusterL', 'reactor', 'earL', 'earR', 'helmet',
  'faceplate', 'faceplateL', 'faceplateR',
];

const START = 0.35;   // first plate leaves its stand
const SPREAD = 3.4;   // last plate leaves this much later

export default {
  id: 'mk42',
  origin: 'distant',
  duration: START + SPREAD + 1.7 + 0.9,

  prepare(api) {
    const { rig, ctx } = api;
    rig.setAllPlates(false);
    rig.resetAllPlates();
    rig.setPose('suitup');
    const rand = mulberry32(0x42042);
    this.rand = rand;
    this.fired = new Set();
    this.flights = {};

    for (let i = 0; i < ORDER.length; i++) {
      const name = ORDER[i];
      if (!rig.hasPlate(name)) continue;
      // Each plate is somewhere else in the room, at its own height and bearing.
      const az = rand() * Math.PI * 2;
      // Close enough to be IN THE SHOT while they fly. At 4.5-11 m every plate spent its
      // whole trajectory outside a 40-degree frame and only appeared in the last twenty
      // centimetres, so the swarm — the entire point of this armour — was invisible and
      // a mid-sequence frame showed one plate in the air (shots/suitup/S_mk42_50.png).
      const dist = 2.6 + rand() * 3.2;
      const height = 0.25 + rand() * 2.8;
      this.flights[name] = {
        t0: START + (i / ORDER.length) * SPREAD + (rand() - 0.5) * 0.22,
        dur: 1.15 + rand() * 0.60,
        from: new THREE.Vector3(
          api.origin.x + Math.sin(az) * dist,
          api.origin.y + height,
          api.origin.z + Math.cos(az) * dist),
        // launch direction: it leaves its stand sideways before it turns for him
        kick: new THREE.Vector3(rand() - 0.5, rand() * 0.6 + 0.1, rand() - 0.5)
          .normalize().multiplyScalar(1.8 + rand() * 2.2),
        spinAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spinRate: (3.5 + rand() * 7.0) * (rand() < 0.5 ? -1 : 1),
        startQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          rand() * 6.28, rand() * 6.28, rand() * 6.28)),
      };
    }

    // Effects group: trails and lock flashes live here and are torn down on finish.
    this.fx = new THREE.Group();
    this.fx.name = 'mk42_fx';
    ctx.scene.add(this.fx);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.trailGeo = new THREE.CylinderGeometry(1, 0.05, 1, 7, 1, true);
    this.flashGeo = new THREE.SphereGeometry(1, 10, 8);
    this.trails = {};
    this.flashes = [];
    this._prev = {};
    this._t = { home: new THREE.Vector3(), q: new THREE.Quaternion(), pos: new THREE.Vector3() };
  },

  update(t, dt, api) {
    const { rig } = api;
    const T = this._t;

    for (const name of ORDER) {
      const f = this.flights[name];
      if (!f || !rig.hasPlate(name)) continue;
      const u = (t - f.t0) / f.dur;
      if (u < 0) { rig.setPlateVisible(name, false); continue; }
      if (u >= 1) {
        // Landed. It is simply part of the suit now — this is what makes a partial
        // state believable: what has arrived is finished, what has not is absent.
        rig.setPlateVisible(name, true);
        rig.resetPlate(name);
        this._killTrail(name);
        continue;
      }

      rig.setPlateVisible(name, true);
      rig.plateHomeWorld(name, T.home, T.q);
      const info = rig.plateInfo[name];
      const radius = info ? info.radius : 0.08;

      // Hermite: leaves its stand along `kick`, arrives dead on the seat with no
      // velocity left, so the lock reads as a lock and not as a fly-through.
      const k = clamp01(u);
      const h00 = 2 * k * k * k - 3 * k * k + 1;
      const h10 = k * k * k - 2 * k * k + k;
      const h01 = -2 * k * k * k + 3 * k * k;
      const pos = T.pos.set(0, 0, 0)
        .addScaledVector(f.from, h00)
        .addScaledVector(f.kick, h10)
        .addScaledVector(T.home, h01);

      // Spin about its own axis, bleeding off to exactly the seated rotation.
      const settle = smoothstep(u, 0.72, 1.0);
      const spun = new THREE.Quaternion().setFromAxisAngle(
        f.spinAxis, f.spinRate * (t - f.t0) * (1 - settle));
      const quat = new THREE.Quaternion().copy(f.startQuat).premultiply(spun);
      quat.slerp(T.q, settle);

      rig.setPlateWorld(name, pos, quat);

      // ---- motion blur: geometry stretched along this frame's velocity ---------
      const prev = this._prev[name];
      if (prev) {
        const vel = new THREE.Vector3().subVectors(pos, prev);
        const speed = vel.length() / Math.max(dt, 1e-4);
        this._trail(name, pos, vel, speed, radius, 1 - settle);
      }
      this._prev[name] = pos.clone();

      // ---- specular hit on lock ----------------------------------------------
      if (u > 0.965 && !this.fired.has(name)) {
        this.fired.add(name);
        api.emitPlate(name, 0.55 + Math.min(0.45, radius * 3));
        this._flash(T.home, radius);
      }
    }

    // flashes decay
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.life -= dt;
      if (fl.life <= 0) {
        this.fx.remove(fl.mesh);
        fl.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const a = fl.life / fl.max;
      fl.mesh.material.opacity = a * a * 0.62;
      // A specular HIT, not an explosion: it stays about the size of the plate and is
      // gone in two frames. At 3.2x growth on a chest plate this was a metre-wide white
      // ellipse hanging in the room — measured on screen, then cut.
      const s = fl.r * (1.0 + (1 - a) * 1.15);
      fl.mesh.scale.set(s, s * 0.42, s);
    }
  },

  _trail(name, pos, vel, speed, radius, amount) {
    let tr = this.trails[name];
    if (!tr) {
      tr = new THREE.Mesh(this.trailGeo, this.trailMat.clone());
      tr.frustumCulled = false;
      this.fx.add(tr);
      this.trails[name] = tr;
    }
    const len = THREE.MathUtils.clamp(speed * 0.045, 0.05, 1.6);
    tr.position.copy(pos).addScaledVector(vel.clone().normalize(), -len * 0.5);
    tr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vel.clone().normalize());
    // A streak the width of the plate's edge, not of the plate: the read is speed, and a
    // fat cone behind every piece turns the room into a firework.
    const w = THREE.MathUtils.clamp(radius * 0.34, 0.012, 0.055);
    tr.scale.set(w, len, w);
    tr.material.opacity = 0.30 * amount * THREE.MathUtils.clamp(speed / 14, 0.12, 1);
    tr.visible = tr.material.opacity > 0.01;
  },

  _killTrail(name) {
    const tr = this.trails[name];
    if (!tr) return;
    this.fx.remove(tr);
    tr.material.dispose();
    delete this.trails[name];
  },

  _flash(at, r) {
    const m = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    m.position.copy(at);
    m.material.opacity = 0.9;
    this.fx.add(m);
    this.flashes.push({ mesh: m, life: 0.13, max: 0.13, r: THREE.MathUtils.clamp(r * 0.75, 0.045, 0.16) });
  },

  finish(api) {
    const { rig } = api;
    for (const name of ORDER) {
      if (!rig.hasPlate(name)) continue;
      rig.setPlateVisible(name, true);
      rig.resetPlate(name);
    }
    this.cleanup(api);
  },

  abort(api) { this.cleanup(api); },

  cleanup(api) {
    if (!this.fx) return;
    for (const n of Object.keys(this.trails)) this._killTrail(n);
    for (const fl of this.flashes) fl.mesh.material.dispose();
    this.flashes.length = 0;
    api.ctx.scene.remove(this.fx);
    this.trailGeo.dispose();
    this.flashGeo.dispose();
    this.trailMat.dispose();
    this.flashMat.dispose();
    this.fx = null;
  },
};

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function smoothstep(x, a, b) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
