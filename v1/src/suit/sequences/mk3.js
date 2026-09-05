// MARK III suit-up — the icon, and the sequence knows it. Owned by task `suitup`.
//
// The feel: theatrical and symmetric. Plates are handled in MIRRORED PAIRS — four arms
// working, two per pair, so the left and right of the body close at the same instant.
// Each plate swings in on an arc, spinning about its own outward normal, and is snapped
// down with a quarter-turn lock; the pair lands on the same frame and fires two
// `suitup:plate` events together, which is what gives this one its double-clank. After
// each pair the arms sweep outward and back in. The helmet comes down last, from above,
// on a single arm that rises higher than the rest, and the faceplate seals on its own.
//
// A frame from the middle of this sequence is unmistakable: the body is symmetric,
// everything already on is flush and paired, and there are always two plates in the air
// mirrored about the centre line. Mk I is one crooked plate at a time; Mk II is a
// square rising procession; this is a pair of hands closing a jacket.
//
// Reference: reference/suitup/gantry_mk3_construction_pair.jpg, gantry_mk3_torso_build.jpg.

import * as THREE from 'three';

// Mirrored pairs, feet upward. A lone name is a centre-line plate and goes on its own.
const PAIRS = [
  ['bootL', 'bootR'], ['thrusterL', 'thrusterR'], ['shinL', 'shinR'], ['kneeL', 'kneeR'],
  ['thighL', 'thighR'], ['pelvis'], ['beltL', 'beltR'], ['abdomen'],
  ['ribL', 'ribR'], ['back'], ['chest'], ['reactor'], ['collarL', 'collarR'],
  ['pauldronL', 'pauldronR'], ['bicepL', 'bicepR'], ['elbowL', 'elbowR'],
  ['forearmL', 'forearmR'], ['gauntletL', 'gauntletR'], ['palmL', 'palmR'],
  ['earL', 'earR'], ['helmet'], ['faceplate'],
];

const GAP = 0.30;      // pair-to-pair
const FLY = 1.05;      // one pair's arc
const ARC = 0.55;      // how far out the arc bows

export default {
  id: 'mk3',
  origin: 'gantry',
  duration: 1.3 + PAIRS.length * GAP + FLY + 1.1,

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
      gantry.setArmsRaised([0, 1, 2, 3]);   // the full ritual: four arms, mirrored pairs
    }
    this._t = {
      home: new THREE.Vector3(), q: new THREE.Quaternion(), n: new THREE.Vector3(),
      pos: new THREE.Vector3(), lift: new THREE.Vector3(), grip: new THREE.Vector3(),
      spin: new THREE.Quaternion(),
    };
  },

  update(t, dt, api) {
    const { rig, gantry } = api;
    const T = this._t;
    if (gantry) gantry.setDeploy(clamp01(t / 1.3));
    // The floor opening is a sound in its own right, and it is the first one.
    if (!this.floorFired && t > 0.05) { this.floorFired = true; api.emitPlate('gantry:floor', 0.85); }
    if (t < 0.4) return;

    const jobs = [];

    for (let i = 0; i < PAIRS.length; i++) {
      const pair = PAIRS[i];
      const t0 = 1.3 + i * GAP;
      const u = (t - t0) / FLY;
      if (u < 0) continue;

      for (let s = 0; s < pair.length; s++) {
        const name = pair[s];
        if (!rig.hasPlate(name)) continue;
        if (u >= 1) { rig.setPlateVisible(name, true); rig.resetPlate(name); continue; }
        rig.setPlateVisible(name, true);

        rig.plateHomeWorld(name, T.home, T.q);
        rig.plateNormalWorld(name, T.n);
        const isHelmetish = name === 'helmet' || name === 'faceplate';
        const side = name.endsWith('L') ? 1 : name.endsWith('R') ? -1 : (i % 2 ? 1 : -1);

        // The plate starts wide, out to its own side and low, and swings in on an arc
        // that bows outward — a presented gesture, not a rail.
        const start = T.lift.set(
          api.origin.x + side * 1.45,
          api.origin.y + (isHelmetish ? 2.55 : 0.25),
          api.origin.z + (isHelmetish ? -0.15 : 0.85));

        const k = swing(u < 0.86 ? u / 0.86 : 1);
        // quadratic bezier through a control point pushed along the outward normal
        const ctrl = T.pos.copy(T.home)
          .addScaledVector(T.n, ARC)
          .add(new THREE.Vector3(side * 0.35, isHelmetish ? 0.75 : 0.42, 0));
        const p = bezier(start, ctrl, T.home, k, new THREE.Vector3());

        // quarter-turn lock about the plate's own outward normal
        const turn = (1 - k) * Math.PI * 0.5 * (side > 0 ? 1 : -1);
        T.spin.setFromAxisAngle(T.n, turn);
        const quat = new THREE.Quaternion().copy(T.spin).multiply(T.q);

        // seat it, then a 4 cm settle
        if (u >= 0.86) {
          const set = (u - 0.86) / 0.14;
          p.copy(T.home).addScaledVector(T.n, 0.012 * (1 - set) * Math.cos(set * Math.PI * 3));
          quat.copy(T.q);
        }

        rig.setPlateWorld(name, p, quat);

        if (u > 0.855 && !this.fired.has(name)) {
          this.fired.add(name);
          // Pairs land together: two events on the same frame is the double-clank.
          api.emitPlate(name, isHelmetish ? 0.95 : 0.7);
        }

        jobs.push({
          pos: p.clone(), n: T.n.clone(),
          jaws: u < 0.80 ? 0.05 : clamp01((u - 0.86) / 0.12),
          high: isHelmetish,
        });
      }
    }

    // Four arms, assigned by proximity so the mirrored pair is served by mirrored arms.
    if (gantry) {
      const busy = new Set();
      for (const job of jobs) {
        const arm = gantry.pickArm(job.pos, busy);
        busy.add(arm.index);
        T.grip.copy(job.pos).addScaledVector(job.n, 0.13);
        arm.reachTo(T.grip);
        arm.faceAlong(job.n.clone().negate());
        arm.setJaws(job.jaws);
      }
      // The arms not holding anything sweep outward and up: the ritual is a performance.
      const sweep = 0.55 + 0.45 * Math.sin(t * 1.6);
      for (const arm of gantry.arms) {
        if (busy.has(arm.index)) continue;
        // Own side of the pad, derived from the arm's world position — see
        // Gantry.pitPoint(): a gantry-local offset added to a world point puts the
        // target across the body once the pad is yawed.
        // OUT and up, not in: a spread under 1 pulls the idle arm toward the boy, which
        // is how one ended up filling a third of the frame a metre from the camera.
        const p = arm.idlePoint(api.origin, new THREE.Vector3(),
          1.30 + sweep * 0.35, 1.35 + sweep * 0.45);
        arm.reachTo(p);
        arm.setJaws(0.5 + 0.3 * sweep);
      }
    }
  },

  finish(api) {
    const { rig } = api;
    for (const pair of PAIRS) for (const name of pair) {
      if (!rig.hasPlate(name)) continue;
      rig.setPlateVisible(name, true);
      rig.resetPlate(name);
    }
  },
};

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// Fast out of the gate, hangs at the top of the arc, drops onto the seat.
function swing(x) {
  x = clamp01(x);
  return 1 - Math.pow(1 - x, 2.4);
}
function bezier(a, c, b, t, out) {
  const it = 1 - t;
  out.set(0, 0, 0)
    .addScaledVector(a, it * it)
    .addScaledVector(c, 2 * it * t)
    .addScaledVector(b, t * t);
  return out;
}
