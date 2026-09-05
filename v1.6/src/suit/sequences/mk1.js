// MARK I suit-up — the cave build, bolted on. Owned by task `suitup`.
//
// The feel: heavy, slow and slightly wrong. ONE arm does all the work, one plate at a
// time, bottom to top with no elegance. Every plate is lifted out of the pit at a crawl,
// hangs and swings on the way up, is offered up crooked, corrected, and then HAMMERED
// home with three separate blows — three `suitup:plate` events, the last one the loudest.
// Nothing seats perfectly: each plate keeps a small permanent misalignment, so a frame
// pulled from the middle of this sequence shows scrap metal hanging off a boy at angles
// no factory would allow. That is the Mk I and nothing else in the game looks like it.
//
// Reference: reference/armors/mk1_still_a.jpg, mk1_hottoys_c.jpg.

import * as THREE from 'three';
import { mulberry32 } from '../rig.js';

const ORDER = [
  'bootR', 'bootL', 'shinR', 'shinL', 'kneeR', 'kneeL', 'thighR', 'thighL',
  'pelvis', 'abdomen', 'beltR', 'beltL',
  'back', 'chest', 'reactor', 'ribR', 'ribL', 'collarR', 'collarL',
  'pauldronR', 'bicepR', 'elbowR', 'forearmR', 'gauntletR', 'palmR', 'thrusterR',
  'pauldronL', 'bicepL', 'elbowL', 'forearmL', 'gauntletL', 'palmL', 'thrusterL',
  'earR', 'earL', 'helmet', 'faceplate',
];

// Heavy and slow is the brief, but 0.40 s a plate ran the whole ritual to twenty
// seconds — half again as long as anything else in the game and, watched end to end,
// simply boring. 0.27 keeps it the slowest of the five (14.4 s against the Mk III's 9.0)
// without asking the player to stand still for a third of a minute.
// Heavy and slow, but ONE arm can only hold one thing. At 1.45 s a lift and 0.27 s
// between starts there were five plates in the air at once and the single arm could be
// with at most one of them — the other four floated onto the boy with no machine
// anywhere near them (probe X_mk1_t34). Now three are in the air, the two behind the
// working one are still down at pit level, and the arm is always on the one being
// pressed.
const PER_PLATE = 0.30;     // start-to-start gap
const LIFT = 0.90;          // how long a single plate takes from pit to bolted
const SHOW_AT = 0.22;       // before this the plate is still down in the pit, unseen

export default {
  id: 'mk1',
  origin: 'gantry',
  duration: 2.2 + ORDER.length * PER_PLATE + LIFT + 1.4,

  prepare(api) {
    const { rig, gantry } = api;
    rig.setAllPlates(false);
    rig.resetAllPlates();
    rig.setPose('suitup');
    this.floorFired = false;
    this.rand = mulberry32(0x1a1);
    this.state = {};
    this.arm = gantry ? gantry.arms[0] : null;   // ONE arm. It is a cave, not a factory.
    if (gantry) {
      gantry.setOrigin(api.origin, api.yaw);
      for (const a of gantry.arms) a.fold();
      // ONE arm out of the pit. The other three used to rise with it and stand around
      // the boy doing nothing, which reads as a car factory and hides the arm that is
      // actually working (shots/suitup/S_mk1_32.png). The Mk I was built in a cave.
      gantry.setArmsRaised([0]);
    }
    // Permanent misalignment per plate — the Mk I never sits flush.
    this.skew = {};
    for (const name of ORDER) {
      this.skew[name] = {
        pos: new THREE.Vector3(
          (this.rand() - 0.5) * 0.017, (this.rand() - 0.5) * 0.013, (this.rand() - 0.5) * 0.014),
        ang: (this.rand() - 0.5) * 0.075,
        axis: new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize(),
      };
    }
    this._tmp = {
      home: new THREE.Vector3(), q: new THREE.Quaternion(), n: new THREE.Vector3(),
      p: new THREE.Vector3(), qq: new THREE.Quaternion(),
    };
  },

  update(t, dt, api) {
    const { rig, gantry } = api;
    const T = this._tmp;

    // The floor takes its time. Two seconds of grinding before anything appears.
    if (gantry) gantry.setDeploy(clamp01(t / 2.2));
    // The floor opening is a sound in its own right, and it is the first one.
    if (!this.floorFired && t > 0.05) { this.floorFired = true; api.emitPlate('gantry:floor', 0.85); }
    if (t < 1.0) return;

    let busiest = null;
    for (let i = 0; i < ORDER.length; i++) {
      const name = ORDER[i];
      if (!rig.hasPlate(name)) continue;
      const t0 = 2.2 + i * PER_PLATE;
      const u = (t - t0) / LIFT;
      if (u < 0) continue;

      rig.plateHomeWorld(name, T.home, T.q);
      rig.plateNormalWorld(name, T.n);
      const skew = this.skew[name];

      if (u >= 1) {
        // Bolted on — and left crooked.
        const p = rig.plate(name);
        if (!p.visible) p.visible = true;
        applySkew(rig, name, skew);
        continue;
      }
      // Out of sight until the claw has it clear of the pit.
      rig.setPlateVisible(name, u >= SHOW_AT);
      if (u >= SHOW_AT && (!busiest || u > busiest.u)) busiest = { name, u };

      // ---- one plate's journey, in five heavy beats -------------------------
      const pit = this.arm ? this.arm.pitPoint(api.origin, T.p)
        : T.p.set(api.origin.x + 0.55, api.origin.y + 0.05, api.origin.z + 0.5);
      const hold = new THREE.Vector3().copy(T.home).addScaledVector(T.n, 0.34);
      hold.y += 0.06;

      let pos = new THREE.Vector3();
      let quat = new THREE.Quaternion();
      let jaws = 0.0, impactNow = 0;

      if (u < 0.42) {
        // dragged up out of the pit, swinging on the claw
        const k = ease(u / 0.42);
        pos.lerpVectors(pit, hold, k);
        pos.y += Math.sin(k * Math.PI) * 0.25;
        const swing = Math.sin(t * 5.4 + i) * 0.14 * (1 - k);
        quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), swing);
        quat.multiply(T.q);
        jaws = 0.05;
      } else if (u < 0.58) {
        // offered up wrong, then corrected by hand
        const k = (u - 0.42) / 0.16;
        pos.copy(hold);
        pos.x += Math.sin(k * Math.PI * 2.0) * 0.03;
        quat.copy(T.q).multiply(
          new THREE.Quaternion().setFromAxisAngle(skew.axis, skew.ang * 4.0 * (1 - k)));
        jaws = 0.05;
      } else if (u < 0.90) {
        // three separate blows: press, back off, press, back off, press
        const k = (u - 0.58) / 0.32;
        const blow = Math.min(2, Math.floor(k * 3));
        const kb = k * 3 - blow;
        const depth = blow === 0 ? 0.55 : blow === 1 ? 0.82 : 1.0;
        const prev = blow === 0 ? 0.0 : blow === 1 ? 0.55 : 0.82;
        const strike = kb < 0.62 ? ease(kb / 0.62) : 1.0 - (kb - 0.62) / 0.38 * 0.10;
        const d = THREE.MathUtils.lerp(prev, depth, strike);
        pos.lerpVectors(hold, T.home, d);
        pos.add(new THREE.Vector3().copy(skew.pos).multiplyScalar(1 - d));
        quat.copy(T.q).multiply(
          new THREE.Quaternion().setFromAxisAngle(skew.axis, skew.ang * (1.6 - d)));
        // recoil ring right after each hit
        // Fire on the first frame PAST the strike, not inside a window: at 1/120 s
        // steps a 0.06-wide window on a 0.1 s blow is only five milliseconds and the
        // tick stepped straight over it — 37 plates should ring 111 times and rang 75
        // (rig log, plateEvents), so a third of the hammer blows were silent.
        if (kb > 0.60) {
          const key = name + ':' + blow;
          if (this.state[key] !== 1) {
            this.state[key] = 1;
            impactNow = blow === 2 ? 1.0 : 0.42 + blow * 0.16;
          }
        }
        jaws = blow === 2 && kb > 0.7 ? (kb - 0.7) / 0.3 : 0.05;
      } else {
        // claw lets go and drags itself away
        const k = (u - 0.90) / 0.10;
        pos.copy(T.home).add(skew.pos);
        quat.copy(T.q).multiply(new THREE.Quaternion().setFromAxisAngle(skew.axis, skew.ang));
        jaws = 0.4 + k * 0.6;
      }

      rig.setPlateWorld(name, pos, quat);
      if (impactNow) api.emitPlate(name, impactNow);

      // The arm serves the MOST ADVANCED plate — the one being pressed home. That is
      // the beat of this sequence, and an arm that instead chases whatever left the pit
      // last is never touching the thing the eye is on.
      if (busiest && busiest.name === name && this.arm) {
        const grip = new THREE.Vector3().copy(pos).addScaledVector(T.n, 0.15);
        this.arm.reachTo(grip);
        this.arm.faceAlong(new THREE.Vector3().copy(T.n).negate());
        this.arm.setJaws(jaws);
        this.arm.holding = name;
      }
    }

    // Nothing in hand: the one arm hangs over the pit, waiting.
    if (gantry && !busiest && this.arm) {
      this.arm.reachTo(this.arm.idlePoint(api.origin, new THREE.Vector3(), 1.10, 0.85));
      this.arm.setJaws(0.35);
      this.arm.holding = null;
    }
  },

  finish(api) {
    const { rig } = api;
    for (const name of ORDER) {
      if (!rig.hasPlate(name)) continue;
      rig.setPlateVisible(name, true);
      applySkew(rig, name, this.skew[name]);
    }
  },
};

function applySkew(rig, name, skew) {
  const info = rig.plateInfo[name];
  const p = rig.plate(name);
  if (!info || !p) return;
  p.position.copy(info.rest.pos).add(skew.pos);
  p.quaternion.copy(info.rest.quat).multiply(
    new THREE.Quaternion().setFromAxisAngle(skew.axis, skew.ang));
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// Slow to start, slow to stop, with a dead spot in the middle: machinery that is
// working harder than it should have to.
function ease(x) {
  x = clamp01(x);
  const s = x * x * (3 - 2 * x);
  return s + 0.06 * Math.sin(x * Math.PI * 2.0) * (1 - x);
}
