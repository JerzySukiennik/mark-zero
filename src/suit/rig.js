// The armor rig. Owned by task `suitup`.
//
// Three jobs:
//   1. Load models/<id>.glb and VERIFY the exported node tree instead of trusting it.
//      matrix_parent_inverse does not survive glTF export, so a model that looked right
//      in Blender can arrive with a shoulder parked in the middle of the chest. Every
//      load prints a table; ctx.suit.report has it in structured form.
//   2. Derive limb axes FROM THE MODEL — the direction from a joint to its child in the
//      rest pose — never assuming a limb lies along a pivot's -Y. Poses are then authored
//      as "point the upper arm this way", which is correct whatever frame the modeller
//      shipped.
//   3. Provide the plate bookkeeping the suit-up sequences need: rest transform, outward
//      normal, surface flow coordinate, and helpers to drive a plate by world transform
//      while it is being carried, flown or poured on.
//
// A model that has not arrived yet falls back to a proxy figure built here from
// primitives, so the game boots and the sequences can be watched while the armor
// modellers are still working. ctx.suit.proxy tells you which you are looking at.

import * as THREE from 'three';

// The 37 plates of models/CONTRACT.md, in the order the contract lists them.
export const PLATES = [
  'bootL', 'bootR', 'thrusterL', 'thrusterR', 'shinL', 'shinR', 'kneeL', 'kneeR',
  'thighL', 'thighR', 'pelvis', 'beltL', 'beltR', 'abdomen',
  'chest', 'ribL', 'ribR', 'back', 'reactor', 'collarL', 'collarR',
  'pauldronL', 'pauldronR', 'bicepL', 'bicepR', 'elbowL', 'elbowR',
  'forearmL', 'forearmR', 'gauntletL', 'gauntletR', 'palmL', 'palmR',
  'earL', 'earR', 'helmet', 'faceplate',
];

// Pivot hierarchy of the contract: name -> parent name.
export const PIVOT_PARENT = {
  piv_root: null,
  piv_hips: 'piv_root',
  piv_chest: 'piv_hips',
  piv_neck: 'piv_chest',
  piv_head: 'piv_neck',
  piv_shoulderL: 'piv_chest', piv_elbowL: 'piv_shoulderL', piv_palmL: 'piv_elbowL',
  piv_shoulderR: 'piv_chest', piv_elbowR: 'piv_shoulderR', piv_palmR: 'piv_elbowR',
  piv_hipL: 'piv_hips', piv_kneeL: 'piv_hipL', piv_ankleL: 'piv_kneeL',
  piv_thrusterL: 'piv_ankleL',
  piv_hipR: 'piv_hips', piv_kneeR: 'piv_hipR', piv_ankleR: 'piv_kneeR',
  piv_thrusterR: 'piv_ankleR',
  piv_reactor: 'piv_hips',
};

// Which pivot each plate belongs to, used when a model ships plates flat or when the
// proxy figure is built. A loaded model's own parenting always wins.
export const PLATE_PIVOT = {
  helmet: 'piv_head', faceplate: 'piv_head', faceplateL: 'piv_head',
  faceplateR: 'piv_head', earL: 'piv_head', earR: 'piv_head',
  chest: 'piv_chest', ribL: 'piv_chest', ribR: 'piv_chest', back: 'piv_chest',
  reactor: 'piv_chest', collarL: 'piv_chest', collarR: 'piv_chest',
  pauldronL: 'piv_shoulderL', bicepL: 'piv_shoulderL', elbowL: 'piv_elbowL',
  forearmL: 'piv_elbowL', gauntletL: 'piv_elbowL', palmL: 'piv_palmL',
  pauldronR: 'piv_shoulderR', bicepR: 'piv_shoulderR', elbowR: 'piv_elbowR',
  forearmR: 'piv_elbowR', gauntletR: 'piv_elbowR', palmR: 'piv_palmR',
  abdomen: 'piv_hips', pelvis: 'piv_hips', beltL: 'piv_hips', beltR: 'piv_hips',
  thighL: 'piv_hipL', kneeL: 'piv_kneeL', shinL: 'piv_kneeL',
  bootL: 'piv_ankleL', thrusterL: 'piv_thrusterL',
  thighR: 'piv_hipR', kneeR: 'piv_kneeR', shinR: 'piv_kneeR',
  bootR: 'piv_ankleR', thrusterR: 'piv_thrusterR',
};

// ---------------------------------------------------------------------------- poses
//
// A pose is a set of LIMB DIRECTIONS, expressed in each joint's PARENT space, plus an
// optional twist about that direction. The rig converts a direction into a rotation by
// swinging the joint's own rest child-direction onto it, so the numbers below mean the
// same thing no matter how the modeller oriented the empties. Emitters (the palms) are
// aimed instead — see setPose for the three entry shapes.
//
// Reference: reference/flight/mk3_flight_a.jpg. Every number below was read off a frame,
// not invented: guessing produced a cruise pose with the arms swept back like a dart,
// which is not what the films do and looked like it.
const D = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

export const POSES = {
  stand: {},

  // Reference: flight/mk3_flight_a.jpg — head-on, above the clouds. The arms are NOT
  // tucked: they are stretched straight out to the sides, perpendicular to the spine,
  // fists closed and a little ahead of the shoulder line, legs together behind. Authored
  // straight off that frame after a first pass guessed "arms swept back like a dart" and
  // rendered a boy hailing a taxi (shots/suitup/P_pose_cruise.png, second pass).
  cruise: {
    // SWEPT BACK, not held out. The first version of this pose put the arms straight out
    // to the sides, perpendicular to the spine, authored off mk3_flight_a.jpg — and that
    // frame is a hero shot, a deliberate hold for the camera, not what the suit does when
    // it is going somewhere. Laid down at 76 degrees and travelling, arms out to the sides
    // is a crucifix sliding through the sky; Jurek's word for it was that the suit "spread
    // its arms strangely". At speed the arms run down the flanks with the fists past the
    // hips, which is also the only reading that puts the palm repulsors where their thrust
    // vector belongs — behind him.
    piv_shoulderL: { dir: D(0.20, -0.95, 0.24), twist: -8 },
    piv_shoulderR: { dir: D(-0.20, -0.95, 0.24), twist: 8 },
    piv_elbowL: { dir: D(-0.02, -0.98, 0.19) },      // all but straight
    piv_elbowR: { dir: D(0.02, -0.98, 0.19) },
    // Palms trail backwards: the hand repulsors are adding thrust, not braking.
    piv_palmL: { aimWorld: D(0.08, -0.25, 0.96) },
    piv_palmR: { aimWorld: D(-0.08, -0.25, 0.96) },
    piv_hipL: { dir: D(-0.04, -0.99, 0.09) },        // legs together, toes pointed
    piv_hipR: { dir: D(0.04, -0.99, 0.09) },
    piv_kneeL: { dir: D(0, -0.99, -0.10) },
    piv_kneeR: { dir: D(0, -0.99, -0.10) },
    piv_ankleL: { dir: D(0, -0.70, 0.71) },
    piv_ankleR: { dir: D(0, -0.70, 0.71) },
    piv_chest: { dir: D(0, 0.985, -0.17) },
    piv_neck: { dir: D(0, 0.95, -0.30) },            // head leads
  },

  // Reference: flight/mk3_flight_a.jpg for the arm line, and the classic landing beat —
  // arms out and forward, knees soft, and the palm discs pointing STRAIGHT DOWN because
  // they are what is holding him up. That last part is why aimWorld exists: the palm has
  // to be down in the suit's frame no matter what the shoulder and elbow are doing.
  hover: {
    piv_shoulderL: { dir: D(0.60, -0.62, -0.50), twist: -18 },
    piv_shoulderR: { dir: D(-0.60, -0.62, -0.50), twist: 18 },
    piv_elbowL: { dir: D(-0.12, -0.88, -0.46) },
    piv_elbowR: { dir: D(0.12, -0.88, -0.46) },
    piv_palmL: { aimWorld: D(0.06, -0.99, 0.10) },
    piv_palmR: { aimWorld: D(-0.06, -0.99, 0.10) },
    piv_hipL: { dir: D(0.07, -0.96, -0.26) },
    piv_hipR: { dir: D(-0.07, -0.96, -0.26) },
    piv_kneeL: { dir: D(0, -0.92, 0.39) },
    piv_kneeR: { dir: D(0, -0.92, 0.39) },
    piv_ankleL: { dir: D(0, -0.89, -0.45) },
    piv_ankleR: { dir: D(0, -0.89, -0.45) },
    piv_chest: { dir: D(0, 0.995, 0.10) },
  },

  // The repulsor stance: the LEFT arm punches out at the target with the palm square to
  // it, the right stays low and ready. Asymmetric on purpose — two arms out is a pose,
  // one arm out is a shot.
  fire: {
    piv_shoulderL: { dir: D(0.38, -0.30, -0.87), twist: -12 },
    piv_shoulderR: { dir: D(-0.26, -0.74, -0.62), twist: 10 },
    piv_elbowL: { dir: D(-0.04, -0.22, -0.97) },
    piv_elbowR: { dir: D(0.06, -0.90, -0.43) },
    piv_palmL: { aimWorld: D(0, -0.06, -1) },        // dead at the crosshair
    piv_palmR: { aimWorld: D(0, -0.42, -0.91) },
    piv_hipL: { dir: D(0.06, -0.99, -0.10) },
    piv_hipR: { dir: D(-0.06, -0.99, -0.10) },
    piv_kneeL: { dir: D(0, -0.97, 0.24) },
    piv_kneeR: { dir: D(0, -0.97, 0.24) },
    piv_chest: { dir: D(0, 0.99, 0.14) },
  },

  // THE STOP. poses.js has been asking for this pose by name since it was written, and
  // POSES never had a `brake` key — `POSES[name] || POSES.stand` quietly handed back the
  // standing pose instead, so holding S changed the physics slightly and the silhouette
  // not at all. That is the whole of "it tries to stop but very weakly": there was nothing
  // to see.
  //
  // The film beat: the body snaps UPRIGHT out of the dive, and all four repulsors — both
  // palms and both boots — swing round to point where he is still travelling. The arms go
  // out and forward with the palms square to the direction of flight, the legs come
  // forward underneath, and the whole armour becomes a parachute made of thrust.
  brake: {
    piv_shoulderL: { dir: D(0.34, -0.42, -0.84), twist: -20 },
    piv_shoulderR: { dir: D(-0.34, -0.42, -0.84), twist: 20 },
    piv_elbowL: { dir: D(-0.05, -0.30, -0.95) },     // straight out front
    piv_elbowR: { dir: D(0.05, -0.30, -0.95) },
    // Square to the direction of travel. This is the shot everyone remembers.
    piv_palmL: { aimWorld: D(0.05, -0.12, -0.99) },
    piv_palmR: { aimWorld: D(-0.05, -0.12, -0.99) },
    piv_hipL: { dir: D(0.12, -0.72, -0.68) },        // knees come up in front
    piv_hipR: { dir: D(-0.12, -0.72, -0.68) },
    piv_kneeL: { dir: D(0, -0.86, -0.51) },
    piv_kneeR: { dir: D(0, -0.86, -0.51) },
    piv_ankleL: { dir: D(0, -0.55, -0.83) },         // boot jets forward too
    piv_ankleR: { dir: D(0, -0.55, -0.83) },
    piv_chest: { dir: D(0, 0.98, 0.20) },            // chest open, leaning back into it
    piv_neck: { dir: D(0, 0.97, -0.24) },
  },

  // The landing. Left fist into the ground, right arm trailing, right knee down, head up.
  // Used for a hard arrival only — anything under 12 m/s just puts the feet down.
  land: {
    piv_shoulderL: { dir: D(0.30, -0.93, -0.22), twist: -14 },
    piv_shoulderR: { dir: D(-0.62, -0.44, 0.65), twist: 24 },
    piv_elbowL: { dir: D(0.06, -0.99, 0.10) },       // straight down into the ground
    piv_elbowR: { dir: D(-0.20, -0.62, 0.76) },      // trailing behind
    piv_palmL: { aimWorld: D(0, -1, 0) },
    piv_palmR: { aimWorld: D(-0.30, -0.55, 0.78) },
    piv_hipL: { dir: D(0.22, -0.83, -0.51) },        // left leg forward, deep
    piv_hipR: { dir: D(-0.16, -0.78, 0.60) },        // right knee back and down
    piv_kneeL: { dir: D(0, -0.93, 0.36) },
    piv_kneeR: { dir: D(0, -0.55, -0.84) },
    piv_ankleL: { dir: D(0, -0.96, -0.28) },
    piv_ankleR: { dir: D(0, -0.72, -0.69) },
    piv_chest: { dir: D(0, 0.94, -0.34) },           // folded forward over the fist
    piv_neck: { dir: D(0, 0.86, -0.51) },            // ...but the head is up
  },

  // Feet apart, arms a little clear of the body: what the boy stands in while the
  // gantry works around him, and what the plates fly onto for the Mk XLII.
  suitup: {
    piv_shoulderL: { dir: D(0.30, -0.94, -0.16), twist: -6 },
    piv_shoulderR: { dir: D(-0.30, -0.94, -0.16), twist: 6 },
    piv_elbowL: { dir: D(0.08, -0.99, 0.04) },
    piv_elbowR: { dir: D(-0.08, -0.99, 0.04) },
    piv_hipL: { dir: D(0.13, -0.99, 0) },
    piv_hipR: { dir: D(-0.13, -0.99, 0) },
  },
};

// --------------------------------------------------------------------------- helpers

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export { mulberry32 };

// ------------------------------------------------------------------------ the rig

export class SuitRig {
  constructor(id, root, opts = {}) {
    this.id = id;
    this.root = root;              // Object3D holding the whole armor
    this.proxy = !!opts.proxy;
    this.pivots = {};              // name -> Object3D
    this.plates = {};              // name -> Object3D (mesh or group)
    this.plateInfo = {};           // name -> { rest, normal, flow, pivot, radius }
    this.report = { id, proxy: this.proxy, missingPivots: [], missingPlates: [], notes: [] };
    this._restQ = {};              // pivot name -> rest quaternion
    this._childDir = {};           // pivot name -> unit dir to child, in pivot LOCAL space
    this._target = {};             // pivot name -> target quaternion
    this._poseName = 'stand';
    this._poseBlend = 8;           // rad/s-ish slerp rate
  }

  // ---- indexing and verification -----------------------------------------------
  index() {
    const byName = new Map();
    this.root.traverse(o => { if (o.name) byName.set(o.name, o); });

    for (const p of Object.keys(PIVOT_PARENT)) {
      const o = byName.get(p);
      if (o) this.pivots[p] = o;
      else this.report.missingPivots.push(p);
    }
    for (const p of PLATES) {
      const o = byName.get(p);
      if (o) this.plates[p] = o;
      else this.report.missingPlates.push(p);
    }
    // Mk XLII ships its faceplate as two halves.
    for (const half of ['faceplateL', 'faceplateR']) {
      const o = byName.get(half);
      if (o) this.plates[half] = o;
    }
    if (this.plates.faceplateL && this.plates.faceplateR) {
      const i = this.report.missingPlates.indexOf('faceplate');
      if (i >= 0) this.report.missingPlates.splice(i, 1);
    }

    this.root.updateMatrixWorld(true);

    // Rest state of every pivot, and the direction to its child IN THE PIVOT'S OWN
    // LOCAL SPACE. This is the number the poses are built on: never -Y by assumption.
    for (const [name, o] of Object.entries(this.pivots)) {
      this._restQ[name] = o.quaternion.clone();
      const child = this._firstChildPivot(name);
      if (child) {
        // child.position is already expressed in this pivot's local space
        this._childDir[name] = child.position.clone().normalize();
      } else {
        this._childDir[name] = new THREE.Vector3(0, -1, 0);
      }
      o.userData.restPos = o.position.clone();
    }

    // Plate bookkeeping.
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const spine = this._spineLine();
    for (const [name, o] of Object.entries(this.plates)) {
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      const worldPos = o.getWorldPosition(new THREE.Vector3());
      const local = worldPos.clone().applyMatrix4(rootInv);   // suit-root space
      // Outward normal: away from the spine at that height, horizontal, except for
      // the head pieces which come down from above and the boots which come up.
      let n;
      if (name === 'helmet' || name === 'earL' || name === 'earR') n = new THREE.Vector3(0, 1, 0);
      else if (name.startsWith('faceplate')) n = new THREE.Vector3(0, 0.25, -1).normalize();
      else if (name.startsWith('boot') || name.startsWith('thruster')) n = new THREE.Vector3(0, -1, 0);
      else {
        const onSpine = spine(local.y);
        n = new THREE.Vector3(local.x - onSpine.x, 0, local.z - onSpine.z);
        if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
        n.normalize();
      }
      this.plateInfo[name] = {
        pivot: o.parent,
        rest: { pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() },
        local, normal: n,
        radius: Math.max(size.x, size.y, size.z) * 0.5 || 0.05,
        visible: o.visible,
      };
      o.userData.plateName = name;
    }
    this._computeFlow();
    return this.report;
  }

  _firstChildPivot(name) {
    const o = this.pivots[name];
    if (!o) return null;
    // the child listed in the contract hierarchy, if the model shipped it
    for (const [child, parent] of Object.entries(PIVOT_PARENT)) {
      if (parent === name && this.pivots[child] && this.pivots[child].parent === o) {
        return this.pivots[child];
      }
    }
    for (const c of o.children) {
      if (c.name && c.name.startsWith('piv_')) return c;
    }
    return null;
  }

  // A crude spine: linear interpolation between hips and neck in suit-root space,
  // used only to work out which way is "outward" for each plate.
  _spineLine() {
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const at = n => this.pivots[n]
      ? this.pivots[n].getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv)
      : null;
    const hips = at('piv_hips') || new THREE.Vector3(0, 1.0, 0);
    const neck = at('piv_neck') || new THREE.Vector3(0, 1.66, 0);
    return (y) => {
      const t = THREE.MathUtils.clamp((y - hips.y) / Math.max(0.01, neck.y - hips.y), -1.5, 2);
      return new THREE.Vector3().lerpVectors(hips, neck, t);
    };
  }

  // Flow coordinate: distance from the arc reactor to every plate, measured ALONG the
  // body (through the joint chain) rather than through the air, so the Mk L wave
  // travels over the shoulder and down the arm instead of jumping across the gap
  // between a hand and a hip. Per-vertex flow is added by nano.js on top of this.
  _computeFlow() {
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const wp = o => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    const dist = {};
    const startName = this.pivots.piv_chest ? 'piv_chest' : 'piv_root';
    const reactor = this.pivots.piv_reactor ? wp(this.pivots.piv_reactor)
      : (this.pivots[startName] ? wp(this.pivots[startName]) : new THREE.Vector3());
    // walk the pivot tree breadth-first from the chest outwards
    const queue = [[startName, this.pivots[startName] ? wp(this.pivots[startName]).distanceTo(reactor) : 0]];
    const seen = new Set();
    while (queue.length) {
      const [name, d] = queue.shift();
      if (seen.has(name) || !this.pivots[name]) continue;
      seen.add(name);
      dist[name] = d;
      const here = wp(this.pivots[name]);
      for (const [child, parent] of Object.entries(PIVOT_PARENT)) {
        if (parent !== name || !this.pivots[child] || seen.has(child)) continue;
        queue.push([child, d + here.distanceTo(wp(this.pivots[child]))]);
      }
      // the chest reaches the hips as well, going down
      const parent = PIVOT_PARENT[name];
      if (parent && this.pivots[parent] && !seen.has(parent)) {
        queue.push([parent, d + here.distanceTo(wp(this.pivots[parent]))]);
      }
    }
    // Dramaturgy, deliberately: the helmet closes LAST. Walking the joint chain honestly
    // puts the head at 0.50 and the boot at 0.99 — geometrically true (the head is nearer
    // the chest than the foot is) and dramatically wrong: every reference frame of the
    // nano deploy has the face still bare while the legs are finished, and the helmet
    // sealing is the beat the shot is built around. So the head chain is pushed past the
    // extremities, and the reactor — the source — sits at zero.
    const HEAD_LAG = 0.95;
    for (const n of ['piv_neck', 'piv_head']) if (dist[n] !== undefined) dist[n] += HEAD_LAG;

    let max = 0.001;
    for (const [name, info] of Object.entries(this.plateInfo)) {
      const pivName = this._pivotNameOf(info.pivot) || PLATE_PIVOT[name] || 'piv_chest';
      const base = dist[pivName] !== undefined ? dist[pivName] : 1.0;
      const pv = this.pivots[pivName] ? wp(this.pivots[pivName]) : new THREE.Vector3();
      info.flow = name === 'reactor' ? 0 : base + pv.distanceTo(info.local) * 0.9;
      if (info.flow > max) max = info.flow;
    }
    for (const info of Object.values(this.plateInfo)) info.flowN = info.flow / max;
    this.flowMax = max;
    this.reactorLocal = reactor;
    // Kept: the boy's body under the armour is flowed with the SAME numbers, so the wave
    // that uncovers his sleeve and the wave that covers it with armour are one boundary
    // and not two that nearly agree. nano.js reads this.
    this.pivotFlow = dist;
  }

  // Flow value for an arbitrary point in suit-root space, using this rig's joint chain.
  // `pivotName` is the joint the point belongs to; the walk distance to that joint plus
  // the straight distance out to the point is the same measure _computeFlow uses.
  // A closure that turns a point in suit-root space into a flow value, for ONE joint.
  // Deliberately not a per-point flowAt(): inverting the root matrix and resolving the
  // joint's world position once per VERTEX blocked the main thread for twenty seconds on
  // the boy's mesh — measured, and the reason the Mk L sequence appeared not to start.
  flowSampler(pivotName) {
    const base = (this.pivotFlow && this.pivotFlow[pivotName] !== undefined)
      ? this.pivotFlow[pivotName] : 1.0;   // already carries the head lag
    const p = this.pivots[pivotName];
    const max = this.flowMax || 1;
    if (!p) return () => base / max;
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const pv = p.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    return (point) => (base + pv.distanceTo(point) * 0.9) / max;
  }

  _pivotNameOf(obj) {
    for (const [n, o] of Object.entries(this.pivots)) if (o === obj) return n;
    return null;
  }

  // ---- plates ------------------------------------------------------------------
  plate(name) { return this.plates[name]; }
  hasPlate(name) { return !!this.plates[name]; }

  setPlateVisible(name, v) {
    const p = this.plates[name];
    if (p) p.visible = v;
  }
  setAllPlates(v) {
    for (const n of Object.keys(this.plates)) this.plates[n].visible = v;
  }
  resetPlate(name) {
    const p = this.plates[name], info = this.plateInfo[name];
    if (!p || !info) return;
    p.position.copy(info.rest.pos);
    p.quaternion.copy(info.rest.quat);
    p.scale.copy(info.rest.scale);
  }
  resetAllPlates() { for (const n of Object.keys(this.plates)) this.resetPlate(n); }

  // World transform a plate should have when it is home. Cached lazily each call
  // because the body may be posed.
  plateHomeWorld(name, outPos, outQuat) {
    const p = this.plates[name], info = this.plateInfo[name];
    if (!p || !info) return false;
    const parent = p.parent;
    parent.updateWorldMatrix(true, false);
    _m.compose(info.rest.pos, info.rest.quat, info.rest.scale);
    _m.premultiply(parent.matrixWorld);
    _m.decompose(outPos, outQuat, _v);
    return true;
  }

  // Drive a plate by a WORLD transform (carried by a gantry claw, flying in, …).
  setPlateWorld(name, pos, quat) {
    const p = this.plates[name];
    if (!p) return;
    const parent = p.parent;
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert();
    p.position.copy(pos).applyMatrix4(_m);
    _q.setFromRotationMatrix(_m);
    p.quaternion.copy(_q).multiply(quat);
  }

  // Outward normal of a plate in world space (which way it faces off the body).
  plateNormalWorld(name, out) {
    const info = this.plateInfo[name];
    if (!info) return out.set(0, 0, -1);
    out.copy(info.normal).applyQuaternion(this.root.getWorldQuaternion(_q)).normalize();
    return out;
  }

  // ---- posing ------------------------------------------------------------------
  //
  // aimJoint swings the joint's rest child-direction onto `dir` (given in the joint's
  // PARENT space) — the model's own geometry decides what "forward along the limb" is.
  aimJoint(name, dir, twistDeg = 0) {
    const o = this.pivots[name];
    if (!o) return;
    const rest = this._restQ[name];
    const restDirParent = _v.copy(this._childDir[name]).applyQuaternion(rest).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(restDirParent, _v2.copy(dir).normalize());
    const q = swing.multiply(rest);
    if (twistDeg) {
      q.multiply(new THREE.Quaternion().setFromAxisAngle(
        this._childDir[name], THREE.MathUtils.degToRad(twistDeg)));
    }
    this._target[name] = q;
  }

  // Aim a pivot's own local -Y (the emitter axis of the contract: palms and boot jets)
  // at a direction given in the pivot's parent space.
  aimEmitter(name, dir) {
    const o = this.pivots[name];
    if (!o) return;
    const rest = this._restQ[name];
    const restAxis = _v.set(0, -1, 0).applyQuaternion(rest).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(restAxis, _v2.copy(dir).normalize());
    this._target[name] = swing.multiply(rest);
  }

  // A pose entry is one of:
  //   { dir, twist }  aim the limb (the joint's own rest child-direction) along `dir`,
  //                   given in the joint's PARENT space
  //   { aim }         aim the pivot's local -Y (the emitter axis) along `aim`, in the
  //                   joint's PARENT space
  //   { aimWorld }    aim that same emitter axis along a direction in the SUIT'S OWN
  //                   space. "Palms down while hovering" is only expressible this way:
  //                   the palm hangs off a shoulder and an elbow that are both rotated,
  //                   so a parent-space number would have to be re-derived by hand every
  //                   time either of them moved.
  //
  // Pivots are walked parent-first (PIVOT_PARENT is declared in that order and this.pivots
  // preserves it), accumulating each joint's TARGET rotation, so aimWorld resolves against
  // the pose being built and not against whatever the rig happens to be showing mid-blend.
  setPose(name, immediate = false) {
    const pose = POSES[name] || POSES.stand;
    this._poseName = name;
    const chain = {};                       // pivot -> its rotation in suit-root space
    for (const p of Object.keys(this.pivots)) {
      const spec = pose[p];
      const parentName = PIVOT_PARENT[p];
      const qParent = (parentName && chain[parentName]) ? chain[parentName] : new THREE.Quaternion();
      if (!spec) this._target[p] = this._restQ[p].clone();
      else if (spec.aimWorld) {
        // A LOCAL vector, not the module temporaries: aimEmitter clobbers _v and _v2 on
        // its first line, and handing it one of them as the direction hands it garbage.
        const d = spec.aimWorld.clone().applyQuaternion(qParent.clone().invert()).normalize();
        this.aimEmitter(p, d);
      } else if (spec.aim) this.aimEmitter(p, spec.aim);
      else this.aimJoint(p, spec.dir, spec.twist || 0);
      chain[p] = qParent.clone().multiply(this._target[p]);
    }
    if (immediate) {
      for (const [p, q] of Object.entries(this._target)) this.pivots[p].quaternion.copy(q);
    }
  }

  updatePose(dt) {
    const k = 1 - Math.exp(-this._poseBlend * dt);
    for (const [p, q] of Object.entries(this._target)) {
      const o = this.pivots[p];
      if (o) o.quaternion.slerp(q, k);
    }
  }

  // The arc reactor is not a static decal: it breathes. A slow ±6% on the cores only —
  // enough that a still frame and a moving one do not look like the same picture, small
  // enough that it never reads as a flicker. suit.js fills glowCores.
  updateGlow(time) {
    const cores = this.glowCores;
    if (!cores || !cores.length) return;
    const k = 1 + 0.06 * Math.sin(time * 1.9) + 0.025 * Math.sin(time * 5.3 + 1.1);
    for (const m of cores) {
      const base = m.userData.glowBase;
      if (base) m.emissiveIntensity = base * k;
    }
  }

  dispose() {
    this.root.traverse(o => {
      if (o.isMesh) {
        o.geometry && o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m && m.dispose && m.dispose();
      }
    });
  }
}

// ------------------------------------------------------------------------ loading

export async function loadArmor(ctx, id) {
  const url = 'models/' + id + '.glb';
  let gltf = null;
  try { gltf = await ctx.assets.loadModel(url); } catch (e) { gltf = null; }

  let rig;
  if (gltf && gltf.scene) {
    // The loader caches the parsed glTF, so clone before we start posing it.
    const scene = gltf.scene.clone(true);
    const holder = new THREE.Group();
    holder.name = 'armor_' + id;
    holder.add(scene);
    const fix = normaliseStance(scene);       // before index(): rest transforms depend on it
    rig = new SuitRig(id, holder, { proxy: false });
    rig.index();
    if (fix) rig.report.notes.push(fix);
  } else {
    rig = buildProxyArmor(id);
    rig.report.notes.push('models/' + id + '.glb not found — using the proxy figure');
  }

  // Verify, loudly. A model may load fine and still be unusable.
  verifyRig(rig);
  rig.setPose('stand', true);
  return rig;
}

// Walks the node tree of what was actually loaded and checks the contract. Prints a
// table because "it loaded" is not the same as "it is right".
export function verifyRig(rig) {
  const r = rig.report;
  r.plateCount = Object.keys(rig.plates).length;
  r.pivotCount = Object.keys(rig.pivots).length;

  const box = new THREE.Box3().setFromObject(rig.root);
  const size = box.getSize(new THREE.Vector3());
  r.height = +size.y.toFixed(3);
  r.feetY = +box.min.y.toFixed(3);
  if (Math.abs(size.y - 1.95) > 0.25) r.notes.push('height ' + r.height + ' m, contract says 1.95');
  if (Math.abs(box.min.y) > 0.08) r.notes.push('feet at y=' + r.feetY + ', contract says 0');

  // +X is the character's LEFT: the left shoulder must be on the +X side.
  const sl = rig.pivots.piv_shoulderL, sr = rig.pivots.piv_shoulderR;
  if (sl && sr) {
    const a = sl.getWorldPosition(new THREE.Vector3());
    const b = sr.getWorldPosition(new THREE.Vector3());
    r.handedness = a.x > b.x ? 'ok' : 'MIRRORED';
    if (a.x <= b.x) r.notes.push('piv_shoulderL is on the -X side: model is mirrored');
  } else r.handedness = 'unknown';

  // Emitter axes: palm local -Y must leave the palm, not go back up the arm.
  const axes = {};
  for (const n of ['piv_palmL', 'piv_palmR', 'piv_thrusterL', 'piv_thrusterR', 'piv_reactor']) {
    const o = rig.pivots[n];
    if (!o) continue;
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    const axis = (n === 'piv_reactor' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, -1, 0))
      .applyQuaternion(q);
    axes[n] = [+axis.x.toFixed(2), +axis.y.toFixed(2), +axis.z.toFixed(2)];
  }
  r.emitterAxes = axes;

  // Limb axes, derived from joint -> child. Reported so a wrong one is visible.
  r.limbAxes = {};
  for (const n of ['piv_shoulderL', 'piv_elbowL', 'piv_hipL', 'piv_kneeL']) {
    const d = rig._childDir[n];
    if (d) r.limbAxes[n] = [+d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)];
  }

  const bad = r.missingPivots.length || r.missingPlates.length || r.handedness === 'MIRRORED';
  const tag = '[suit ' + rig.id + ']' + (rig.proxy ? ' PROXY' : '');
  const line = tag + ' ' + r.pivotCount + '/' + Object.keys(PIVOT_PARENT).length + ' pivots, ' +
    r.plateCount + '/' + PLATES.length + ' plates, height ' + r.height + 'm, handedness ' + r.handedness;
  if (bad || rig.proxy) console.warn(line, r); else console.log(line);
  if (r.missingPlates.length) console.warn(tag + ' missing plates:', r.missingPlates.join(' '));
  if (r.missingPivots.length) console.warn(tag + ' missing pivots:', r.missingPivots.join(' '));
  for (const n of r.notes) console.warn(tag + ' ' + n);
  return r;
}

// ------------------------------------------------------- proxy figure (fallback)
//
// Not the shipped armor: a stand-in built to the same contract so the suit-up
// sequences, the gantry and the faceplates can be developed and watched before the
// five .glb files land. Palette per armor so the five are still told apart.

const PROXY_STYLE = {
  mk1: { primary: 0x6d6a63, secondary: 0x585148, trim: 0x8a7d6a, dark: 0x22201d, glow: 0xbfe8ff, rough: 0.72, metal: 0.85, bulk: 1.22 },
  mk2: { primary: 0x9aa0a6, secondary: 0x74797f, trim: 0xc3c8cd, dark: 0x14161a, glow: 0xd8ecff, rough: 0.26, metal: 1.0, bulk: 1.0 },
  mk3: { primary: 0x8e1116, secondary: 0xb08a3a, trim: 0xc9a049, dark: 0x1a1c20, glow: 0xd8f0ff, rough: 0.22, metal: 0.95, bulk: 1.0 },
  mk42: { primary: 0xb49450, secondary: 0x8d1a1e, trim: 0xd8dade, dark: 0x141518, glow: 0xeaf7ff, rough: 0.28, metal: 1.0, bulk: 0.98 },
  mk50: { primary: 0x5e1220, secondary: 0xa8863c, trim: 0x8e2a34, dark: 0x101014, glow: 0x7ff0ff, rough: 0.38, metal: 0.85, bulk: 0.94 },
};

export function buildProxyArmor(id) {
  const st = PROXY_STYLE[id] || PROXY_STYLE.mk3;
  const mats = {
    primary: new THREE.MeshStandardMaterial({ color: st.primary, metalness: st.metal, roughness: st.rough }),
    secondary: new THREE.MeshStandardMaterial({ color: st.secondary, metalness: st.metal, roughness: st.rough + 0.06 }),
    trim: new THREE.MeshStandardMaterial({ color: st.trim, metalness: 1.0, roughness: Math.max(0.1, st.rough - 0.1) }),
    dark: new THREE.MeshStandardMaterial({ color: st.dark, metalness: 0.6, roughness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({
      color: st.glow, emissive: new THREE.Color(st.glow), emissiveIntensity: 3.2,
      metalness: 0, roughness: 0.3, toneMapped: false,
    }),
  };

  const root = new THREE.Group();
  root.name = 'armor_' + id + '_proxy';
  const P = {};
  const mk = (name, parent, pos) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(pos[0], pos[1], pos[2]);
    (parent ? P[parent] : root).add(o);
    P[name] = o;
    return o;
  };
  // Contract skeleton for a 1.95 m figure. +X is the character's LEFT.
  mk('piv_root', null, [0, 0, 0]);
  mk('piv_hips', 'piv_root', [0, 1.00, 0]);
  mk('piv_chest', 'piv_hips', [0, 0.32, 0]);
  mk('piv_neck', 'piv_chest', [0, 0.34, 0]);
  mk('piv_head', 'piv_neck', [0, 0.12, 0]);
  mk('piv_shoulderL', 'piv_chest', [0.205, 0.24, 0]);
  mk('piv_elbowL', 'piv_shoulderL', [0.03, -0.33, 0]);
  mk('piv_palmL', 'piv_elbowL', [0.01, -0.31, 0]);
  mk('piv_shoulderR', 'piv_chest', [-0.205, 0.24, 0]);
  mk('piv_elbowR', 'piv_shoulderR', [-0.03, -0.33, 0]);
  mk('piv_palmR', 'piv_elbowR', [-0.01, -0.31, 0]);
  mk('piv_hipL', 'piv_hips', [0.115, -0.06, 0]);
  mk('piv_kneeL', 'piv_hipL', [0.005, -0.48, 0]);
  mk('piv_ankleL', 'piv_kneeL', [0, -0.40, 0]);
  mk('piv_thrusterL', 'piv_ankleL', [0, -0.045, 0.02]);
  mk('piv_hipR', 'piv_hips', [-0.115, -0.06, 0]);
  mk('piv_kneeR', 'piv_hipR', [-0.005, -0.48, 0]);
  mk('piv_ankleR', 'piv_kneeR', [0, -0.40, 0]);
  mk('piv_thrusterR', 'piv_ankleR', [0, -0.045, 0.02]);
  mk('piv_reactor', 'piv_hips', [0, 0.40, -0.155]);

  const b = st.bulk;
  const add = (name, pivot, geo, mat, pos, rot) => {
    const mesh = new THREE.Mesh(geo, mats[mat]);
    mesh.name = name;
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    P[pivot].add(mesh);
    return mesh;
  };
  const box = (x, y, z, r = 0.012) => {
    const g = new THREE.BoxGeometry(x, y, z, 1, 1, 1);
    return g;
  };
  const cyl = (r1, r2, h, seg = 14) => new THREE.CylinderGeometry(r1, r2, h, seg);

  // torso
  add('chest', 'piv_chest', box(0.44 * b, 0.26, 0.25 * b), 'primary', [0, 0.13, -0.01]);
  add('ribL', 'piv_chest', box(0.13 * b, 0.20, 0.24), 'secondary', [0.16 * b, -0.06, 0]);
  add('ribR', 'piv_chest', box(0.13 * b, 0.20, 0.24), 'secondary', [-0.16 * b, -0.06, 0]);
  add('back', 'piv_chest', box(0.40 * b, 0.34, 0.10), 'secondary', [0, 0.05, 0.10]);
  add('collarL', 'piv_chest', box(0.15, 0.07, 0.16), 'trim', [0.11, 0.26, 0]);
  add('collarR', 'piv_chest', box(0.15, 0.07, 0.16), 'trim', [-0.11, 0.26, 0]);
  add('reactor', 'piv_chest', cyl(0.058, 0.058, 0.035, 22), 'glow', [0, 0.08, -0.125], [Math.PI / 2, 0, 0]);
  add('abdomen', 'piv_hips', box(0.30 * b, 0.20, 0.21), 'secondary', [0, 0.20, 0]);
  add('pelvis', 'piv_hips', box(0.34 * b, 0.19, 0.24), 'primary', [0, 0.01, 0]);
  add('beltL', 'piv_hips', box(0.12, 0.10, 0.20), 'trim', [0.15 * b, 0.08, 0]);
  add('beltR', 'piv_hips', box(0.12, 0.10, 0.20), 'trim', [-0.15 * b, 0.08, 0]);

  // head
  add('helmet', 'piv_head', box(0.20, 0.24, 0.235), 'primary', [0, 0.045, 0.015]);
  add('faceplate', 'piv_head', box(0.165, 0.185, 0.055), 'trim', [0, 0.035, -0.105]);
  add('earL', 'piv_head', box(0.035, 0.10, 0.09), 'secondary', [0.104, 0.03, 0.01]);
  add('earR', 'piv_head', box(0.035, 0.10, 0.09), 'secondary', [-0.104, 0.03, 0.01]);

  // arms
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    add('pauldron' + s, 'piv_shoulder' + s, box(0.20 * b, 0.15 * b, 0.24 * b), 'primary', [sx * 0.05, 0.03, 0]);
    add('bicep' + s, 'piv_shoulder' + s, cyl(0.062 * b, 0.058 * b, 0.24), 'secondary', [sx * 0.015, -0.16, 0]);
    add('elbow' + s, 'piv_elbow' + s, cyl(0.058, 0.058, 0.06, 12), 'dark', [0, 0.0, 0], [0, 0, Math.PI / 2]);
    add('forearm' + s, 'piv_elbow' + s, cyl(0.070 * b, 0.062 * b, 0.24), 'primary', [sx * 0.005, -0.15, 0]);
    add('gauntlet' + s, 'piv_elbow' + s, box(0.115 * b, 0.10, 0.13 * b), 'secondary', [0, -0.28, 0]);
    add('palm' + s, 'piv_palm' + s, box(0.10, 0.11, 0.055), 'trim', [0, -0.05, 0]);
    const disc = new THREE.Mesh(cyl(0.028, 0.028, 0.012, 16), mats.glow);
    disc.name = 'palmglow' + s;
    disc.rotation.set(0, 0, 0);
    disc.position.set(0, -0.078, 0);
    P['piv_palm' + s].add(disc);
  }

  // legs
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    add('thigh' + s, 'piv_hip' + s, cyl(0.088 * b, 0.078 * b, 0.36), 'primary', [0, -0.20, 0]);
    add('knee' + s, 'piv_knee' + s, box(0.13, 0.11, 0.13), 'trim', [0, 0.0, -0.01]);
    add('shin' + s, 'piv_knee' + s, cyl(0.078 * b, 0.070 * b, 0.30), 'secondary', [0, -0.20, 0]);
    add('boot' + s, 'piv_ankle' + s, box(0.135 * b, 0.11, 0.28 * b), 'primary', [0, -0.02, -0.03]);
    add('thruster' + s, 'piv_thruster' + s, cyl(0.052, 0.062, 0.03, 14), 'glow', [0, 0, 0.02]);
  }

  const rig = new SuitRig(id, root, { proxy: true });
  rig.index();
  return rig;
}

// --------------------------------------------------------------- stance normalisation
//
// The contract says 1.95 m tall with the feet flat on y = 0, and the game leans on that
// everywhere: the camera frames the suit, the gantry reaches for plates, the flight model
// puts the boots on the ground. A model that arrives at 0.445 m (measured, mk1, mid-build)
// or floating 0.23 m under the floor is not a reason to show the player a doll standing in
// the concrete — it is a reason to correct it and say so.
//
// Uniform scale and a Y offset only. Anything else (a mirrored model, a missing pivot) is
// a real modelling error that verifyRig reports and nobody should paper over.
function normaliseStance(scene, want = 1.95) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (!isFinite(box.min.y) || !isFinite(box.max.y)) return null;
  const h = box.max.y - box.min.y;
  if (h < 1e-3) return null;

  const notes = [];
  if (Math.abs(h - want) > 0.15) {
    const k = want / h;
    scene.scale.multiplyScalar(k);
    notes.push('height was ' + h.toFixed(3) + ' m, wanted ' + want + ', scaled by ' + k.toFixed(3));
  }
  scene.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scene);
  if (Math.abs(box2.min.y) > 0.05) {
    scene.position.y -= box2.min.y;
    notes.push('feet were at y=' + box2.min.y.toFixed(3) + ', lifted to 0');
  }
  if (!notes.length) return null;
  scene.updateMatrixWorld(true);
  return 'stance normalised — ' + notes.join('; ');
}

// ------------------------------------------------------------------ the boy inside
//
// models/pilot.glb is the 13-year-old, built to the same pivot names and joint positions
// as the armor (models/pilot-build.py says so explicitly, and its meshes are body_* so
// they can never be mistaken for plates). The suit-up sequences need him: a Mk XLII with
// a gauntlet and one shoulder on and NOTHING ELSE is only believable if there is a boy
// in normal clothes underneath, and the Mk L nano wave is only a wave if there is skin
// ahead of it.
//
// He is a rig in his own right so he can hold the same 'suitup' stance the armor does.
export async function loadPilot(ctx) {
  let gltf = null;
  try { gltf = await ctx.assets.loadModel('models/pilot.glb'); } catch (e) { gltf = null; }
  if (!gltf || !gltf.scene) { console.warn('[suit] models/pilot.glb missing — no body under the armour'); return null; }
  const scene = gltf.scene.clone(true);
  const holder = new THREE.Group();
  holder.name = 'pilot_body';
  holder.add(scene);
  // He ships at 1.58 m — his real height, which is what he walks around the house at.
  // Inside the armour he is the INTERIOR of a 1.95 m shell, and at 1.58 the helmet floats
  // thirty centimetres above his head and every gauntlet lands past his fingers. The
  // pilot is built with the armors' pivot hierarchy for exactly this reason
  // (models/pilot-build.py: "only the scale differs"), so the constant is applied here
  // and nowhere else: this body is only ever seen during a suit-up.
  normaliseStance(scene, 1.95);
  const rig = new SuitRig('pilot', holder, { proxy: false });
  rig.index();
  rig.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  rig.setPose('stand', true);
  return rig;
}

// Every mesh under `root`, with the pivot it hangs from — what nano.js needs to give the
// boy the same flow coordinate the armour uses.
export function meshesByPivot(rig) {
  const out = [];
  for (const [name, pivot] of Object.entries(rig.pivots)) {
    pivot.traverse(o => {
      if (!o.isMesh) return;
      // charge the mesh to the deepest pivot above it, not to piv_root for everything
      let p = o.parent, owner = name;
      while (p && p !== pivot) { if (p.name && p.name.startsWith('piv_')) { owner = p.name; break; } p = p.parent; }
      out.push({ mesh: o, pivot: owner });
    });
  }
  // de-duplicate: a mesh under piv_palmL is also under piv_elbowL in the traversal above
  const seen = new Map();
  for (const e of out) {
    const prev = seen.get(e.mesh);
    if (!prev || depthOf(rig, e.pivot) > depthOf(rig, prev.pivot)) seen.set(e.mesh, e);
  }
  return [...seen.values()];
}

function depthOf(rig, pivotName) {
  let d = 0, n = pivotName;
  while (n && PIVOT_PARENT[n]) { n = PIVOT_PARENT[n]; d++; if (d > 12) break; }
  return d;
}
