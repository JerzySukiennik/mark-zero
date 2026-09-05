// MARK II suit-up — the prototype, assembled by a machine that knows what it is doing.
// Owned by task `suitup`.
//
// The feel: brisk, square, metronomic. Two arms alternate strictly left / right, and
// the plates travel DEAD STRAIGHT — each one is lifted to a staging point exactly
// outboard of its final position along its own outward normal, then driven in along
// that normal at constant speed and clamped. No arcs, no spin, no wobble, one clean
// click per plate and exactly one `suitup:plate` event. Several plates are in the air
// at once in a neat rising procession, so a mid-sequence frame reads as a machine
// shop: everything square, everything level, nothing crooked. That is the opposite of
// the Mk I, which is the point.
//
// Reference: reference/armors/mk2_workshop.jpg, reference/suitup/mk4_stage_gantry.jpg.

import * as THREE from 'three';

const ORDER = [
  'bootL', 'bootR', 'thrusterL', 'thrusterR', 'shinL', 'shinR', 'kneeL', 'kneeR',
  'thighL', 'thighR', 'pelvis', 'beltL', 'beltR', 'abdomen',
  'back', 'ribL', 'ribR', 'chest', 'reactor', 'collarL', 'collarR',
  'pauldronL', 'pauldronR', 'bicepL', 'bicepR', 'elbowL', 'elbowR',
  'forearmL', 'forearmR', 'gauntletL', 'gauntletR', 'palmL', 'palmR',
  'earL', 'earR', 'helmet', 'faceplate',
];

const GAP = 0.20;        // start-to-start, strictly metronomic
const TRAVEL = 0.86;     // pit -> staging -> home
const STAND_OFF = 0.42;  // how far out on the normal the staging point sits

export default {
  id: 'mk2',
  origin: 'gantry',
  duration: 1.5 + ORDER.length * GAP + TRAVEL + 1.0,

  prepare(api) {
    const { rig, gantry } = api;
    rig.setAllPlates(false);
    rig.resetAllPlates();
    rig.setPose('suitup');
    this.floorFired = false;
    this.fired = new Set();
    if (gantry) {
      gantry.setOrigin(api.origin, api.yaw);
      for (const a of gantry.arms) a.fold();
      // Two arms, alternating strictly left / right. The other two stay in the pit.
      gantry.setArmsRaised([0, 1]);
    }
    this._t = {
      home: new THREE.Vector3(), q: new THREE.Quaternion(), n: new THREE.Vector3(),
      pos: new THREE.Vector3(), stage: new THREE.Vector3(), pit: new THREE.Vector3(),
      grip: new THREE.Vector3(),
    };
  },

  update(t, dt, api) {
    const { rig, gantry } = api;
    const T = this._t;
    if (gantry) gantry.setDeploy(clamp01(t / 1.5));
    // The floor opening is a sound in its own right, and it is the first one.
    if (!this.floorFired && t > 0.05) { this.floorFired = true; api.emitPlate('gantry:floor', 0.85); }
    if (t < 0.55) return;

    const armWork = [null, null, null, null];

    for (let i = 0; i < ORDER.length; i++) {
      const name = ORDER[i];
      if (!rig.hasPlate(name)) continue;
      const t0 = 1.5 + i * GAP;
      const u = (t - t0) / TRAVEL;
      if (u < 0) continue;
      if (u >= 1) { rig.setPlateVisible(name, true); rig.resetPlate(name); continue; }

      rig.setPlateVisible(name, true);
      rig.plateHomeWorld(name, T.home, T.q);
      rig.plateNormalWorld(name, T.n);

      // Straight-line rail: pit -> staging -> home. The plate never rotates; it is
      // held square to its own seat from the moment the claw picks it up.
      const armIndex = i % 2 === 0 ? 0 : 1;
      const arm = gantry ? gantry.arms[armIndex] : null;
      if (arm) arm.pitPoint(api.origin, T.pit);
      else T.pit.set(api.origin.x + 0.62, api.origin.y + 0.12, api.origin.z + 0.56);
      T.stage.copy(T.home).addScaledVector(T.n, STAND_OFF);

      let jaws = 0.06;
      if (u < 0.52) {
        // rise to the staging point on a straight line, trapezoidal speed profile
        const k = trapezoid(u / 0.52);
        T.pos.lerpVectors(T.pit, T.stage, k);
      } else if (u < 0.86) {
        // drive straight in along the normal, constant speed, and stop dead
        const k = trapezoid((u - 0.52) / 0.34);
        T.pos.lerpVectors(T.stage, T.home, k);
        if (k > 0.985 && !this.fired.has(name)) {
          this.fired.add(name);
          api.emitPlate(name, 0.62);           // one clean click
        }
      } else {
        // clamp holds for a beat, then releases square
        T.pos.copy(T.home);
        jaws = clamp01((u - 0.90) / 0.10);
      }

      rig.setPlateWorld(name, T.pos, T.q);

      if (arm) {
        T.grip.copy(T.pos).addScaledVector(T.n, 0.13);
        armWork[armIndex] = { grip: T.grip.clone(), n: T.n.clone(), jaws };
      }
    }

    if (gantry) {
      for (let a = 0; a < gantry.arms.length; a++) {
        const arm = gantry.arms[a];
        const job = armWork[a];
        if (job) {
          arm.reachTo(job.grip);
          arm.faceAlong(job.n.clone().negate());
          arm.setJaws(job.jaws);
        } else if (a >= 2) {
          // the two spare arms stay stowed: the Mk II needs exactly two
          arm.fold();
        }
      }
    }
  },

  finish(api) {
    const { rig } = api;
    for (const name of ORDER) {
      if (!rig.hasPlate(name)) continue;
      rig.setPlateVisible(name, true);
      rig.resetPlate(name);
    }
  },
};

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// Accelerate, cruise, decelerate — a servo under position control, not an animator's
// ease. The long flat middle is what makes the Mk II look machine-driven.
function trapezoid(x) {
  x = clamp01(x);
  const a = 0.18;
  if (x < a) return 0.5 * x * x / a / (1 - a);
  if (x > 1 - a) { const y = 1 - x; return 1 - 0.5 * y * y / a / (1 - a); }
  return (x - 0.5 * a) / (1 - a);
}
