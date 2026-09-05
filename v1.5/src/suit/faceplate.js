// Faceplates. Owned by task `suitup`. One mechanism per armor, all of them driven off
// the rig's pivots and the faceplate plate's own bounding box — no per-armor magic
// numbers for where the hinge is, because five modellers will not agree on that.
//
//   Mk I    heavy visor hinges UPWARD on a horizontal axis across its top edge
//   Mk II   lifts, then retracts INTO the helmet cavity
//   Mk III  same as Mk II, a little faster and tighter
//   Mk XLII the two halves slide APART sideways
//   Mk L    nanotech recedes off the face and sinks into the collar (no hinge at all)
//
// Reference: reference/armors/mk2_faceplate_annotated.jpg, mk42_faceplate_open.jpg,
// reference/suitup/mk50_helmet_hands.jpg.

import * as THREE from 'three';

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

const MECHANISM = {
  mk1: 'hinge', mk2: 'retract', mk3: 'retract', mk42: 'split', mk50: 'nano',
};

export class Faceplate {
  constructor(rig, nano = null) {
    this.rig = rig;
    this.nano = nano;
    this.kind = MECHANISM[rig.id] || 'retract';
    this.t = 0;              // current 0 closed .. 1 open
    this.target = 0;
    this.speed = { hinge: 1.7, retract: 2.6, split: 3.4, nano: 1.9 }[this.kind];
    this.parts = [];
    this._setup();
  }

  _setup() {
    const rig = this.rig;
    if (this.kind === 'split') {
      if (!rig.plates.faceplateL || !rig.plates.faceplateR) splitFaceplate(rig);
      for (const n of ['faceplateL', 'faceplateR']) {
        const p = rig.plates[n];
        if (!p) continue;
        this.parts.push({ obj: p, side: n.endsWith('L') ? 1 : -1, rest: rig.plateInfo[n] });
      }
    } else {
      const p = rig.plates.faceplate;
      if (p) this.parts.push({ obj: p, side: 1, rest: rig.plateInfo.faceplate });
    }

    // Geometry of the plate in its parent's space: gives the hinge line for the Mk I
    // and the retract direction for the Mk II/III without hard-coding anything.
    for (const part of this.parts) {
      const o = part.obj;
      const restPos = part.rest ? part.rest.rest.pos : o.position.clone();
      const restQuat = part.rest ? part.rest.rest.quat : o.quaternion.clone();
      _box.setFromObject(o);
      const size = _box.getSize(new THREE.Vector3());
      const centre = _box.getCenter(new THREE.Vector3());
      part.restPos = restPos.clone();
      part.restQuat = restQuat.clone();
      part.restScale = o.scale.clone();
      part.size = size;
      // Hinge across the TOP edge of the visor, in the plate's parent space, at its BACK
      // face — the visor pivots on the helmet shell, not in the air in front of it. The
      // plate origin is its own centre of mass (contract), so the top edge is half its
      // height above that.
      part.hinge = new THREE.Vector3(restPos.x, restPos.y + size.y * 0.5, restPos.z + size.z * 0.42);

      // Does this plate hang off a pivot the modeller put down at the COLLAR? The
      // contract asks for exactly that on the Mk L, because "sinks into the collar" is a
      // scale toward the pivot and nothing else. Read it off the model rather than
      // hard-coding mk50: if the parent joint sits well below the plate, it is a collar
      // pivot and the nano mechanism collapses the plate into it.
      const parentY = o.parent ? o.parent.getWorldPosition(new THREE.Vector3()).y : centre.y;
      part.collarPivot = (centre.y - parentY) > 0.08;
    }
  }

  set(v) { this.target = THREE.MathUtils.clamp(v, 0, 1); }
  open() { this.set(1); }
  close() { this.set(0); }
  toggle() { this.set(this.target > 0.5 ? 0 : 1); }
  snap(v) { this.t = this.target = THREE.MathUtils.clamp(v, 0, 1); this.apply(); }
  get isOpen() { return this.target > 0.5; }

  update(dt) {
    if (Math.abs(this.t - this.target) < 1e-4) { this.t = this.target; this.apply(); return false; }
    const k = 1 - Math.exp(-this.speed * 4.0 * dt);
    this.t += (this.target - this.t) * k;
    this.apply();
    return true;
  }

  apply() {
    const t = this.t;
    for (const part of this.parts) {
      const o = part.obj;
      switch (this.kind) {
        case 'hinge': {
          // Heavy slab of a visor: it lags, then swings UP AND BACK over the crown of
          // the helmet, and it does not come back flush instantly — a little overswing
          // at the end.
          //
          // The sign matters and it is not a taste call. The figure faces -Z, so a
          // POSITIVE rotation about +X swings the plate's lower edge forward, out of the
          // screen and into the camera: rendered, the visor stood up in front of the face
          // like a lectern (shots/suitup/F_mk1_open.png, first pass). Negative takes it
          // back over the top of the helmet, which is the mechanism.
          const e = easeHeavy(t);
          const ang = THREE.MathUtils.degToRad(-100) * e;
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
          o.quaternion.copy(q).multiply(part.restQuat);
          // rotate the plate about the hinge line rather than about its own origin
          _v.copy(part.restPos).sub(part.hinge).applyQuaternion(q).add(part.hinge);
          o.position.copy(_v);
          o.position.z -= 0.014 * Math.sin(Math.PI * e);   // it lifts clear of the brow
          break;
        }
        case 'retract': {
          // Lifts clear of the chin, then slides straight back into the helmet cavity.
          const lift = THREE.MathUtils.smoothstep(t, 0.0, 0.38);
          const back = THREE.MathUtils.smoothstep(t, 0.28, 1.0);
          o.position.copy(part.restPos);
          o.position.y += 0.052 * lift;
          o.position.z += 0.155 * back;
          const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-11) * lift);
          o.quaternion.copy(q).multiply(part.restQuat);
          break;
        }
        case 'split': {
          // The two halves pop forward off the seam, then slide apart sideways and
          // tuck against the sides of the helmet.
          // They tuck ALONG the helmet, they do not fly off it: 8.6 cm of lateral slide
          // put the two halves out on stalks like ears (shots/suitup/F_mk42_open.png,
          // third pass). Most of the travel is backwards, and the yaw turns each half to
          // lie flat against the side of the skull.
          const pop = THREE.MathUtils.smoothstep(t, 0.0, 0.30);
          const slide = THREE.MathUtils.smoothstep(t, 0.18, 1.0);
          o.position.copy(part.restPos);
          o.position.z -= 0.020 * pop;
          o.position.x += part.side * 0.046 * slide;
          o.position.z += 0.062 * slide;
          const q = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-34) * part.side * slide);
          o.quaternion.copy(q).multiply(part.restQuat);
          break;
        }
        case 'nano': {
          // No hinge: the same nano material that built the suit runs backwards off the
          // face and pours down into the collar. The DISSOLVE is the mechanism and the
          // motion is only its support — the contract puts this plate's pivot at the
          // collar centre so the little that is left can drain into the neck.
          //
          // The edge is walked across the plate's OWN flow band, not from far outside it.
          // Driven from 1.25 the shader ate the whole face inside the first fifth of the
          // move and the remaining eighty percent was an invisible plate shrinking
          // (shots/suitup/F_mk50_mid.png, third pass): a face that blinks out, not one
          // that recedes.
          const sink = THREE.MathUtils.smoothstep(t, 0.55, 1.0);
          o.position.copy(part.restPos);
          o.quaternion.copy(part.restQuat);
          if (part.collarPivot) {
            const k = 1 - 0.55 * sink;
            o.scale.set(part.restScale.x * k, part.restScale.y * k, part.restScale.z * k);
          } else {
            o.position.y -= 0.055 * sink;
            o.position.z += 0.030 * sink;
          }
          o.visible = t < 0.995;
          // Hands OFF the shader while the mask is shut. suit.js calls update() every
          // frame, so this branch also ran with t = 0 during a Mk L suit-up and set the
          // faceplate's uOn back to 0 on every tick — the mask then ignored the wave
          // entirely and hung on the boy's head, fully formed and glowing, from the
          // first frame of the sequence (probe X_nanofull_18: a gold face floating above
          // a boy still in his own clothes). While it is closed the deploy owns it.
          if (t <= 0.001) break;
          if (this.nano) {
            const info = this.rig.plateInfo.faceplate;
            const f0 = info ? info.flowN : 1.0;
            // from just past the plate to just short of the collar, over the whole move
            const e = THREE.MathUtils.lerp(f0 + 0.085, f0 - 0.115, t);
            this.nano.setFaceEdge(e);
            for (const b of this.nano.face) {
              b.uniforms.uOn.value = t > 0.001 ? 1 : 0;
              b.uniforms.uBand.value = 0.085;      // a ragged front, not a hairline
              b.uniforms.uSeamW.value = 0.055;
            }
          }
          break;
        }
      }
    }
  }
}

// Heavy, slightly wrong: slow to start, thumps into the stop, settles back.
function easeHeavy(t) {
  const e = t * t * (3 - 2 * t);
  return e + 0.055 * Math.sin(Math.PI * 3.0 * t) * (1 - t);
}

// If a Mk XLII arrives with one `faceplate` instead of `faceplateL`/`faceplateR`, cut
// it in half along the centre seam at load time so the mechanism still works. The
// contract asks for the halves; this is the safety net, not the plan.
export function splitFaceplate(rig) {
  const src = rig.plates.faceplate;
  if (!src || !src.isMesh || !src.geometry) return false;
  const geo = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone();
  const pos = geo.attributes.position;
  const keep = { L: [], R: [] };
  for (let f = 0; f < pos.count; f += 3) {
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    keep[cx >= 0 ? 'L' : 'R'].push(f);
  }
  const make = (side) => {
    const faces = keep[side];
    const g = new THREE.BufferGeometry();
    for (const attrName of Object.keys(geo.attributes)) {
      const a = geo.attributes[attrName];
      const out = new Float32Array(faces.length * 3 * a.itemSize);
      let k = 0;
      for (const f of faces) {
        for (let i = 0; i < 3; i++) {
          for (let c = 0; c < a.itemSize; c++) out[k++] = a.array[(f + i) * a.itemSize + c];
        }
      }
      g.setAttribute(attrName, new THREE.BufferAttribute(out, a.itemSize));
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, src.material);
    m.name = 'faceplate' + side;
    m.position.copy(src.position);
    m.quaternion.copy(src.quaternion);
    m.scale.copy(src.scale);
    m.castShadow = src.castShadow; m.receiveShadow = src.receiveShadow;
    src.parent.add(m);
    rig.plates['faceplate' + side] = m;
    const info = rig.plateInfo.faceplate;
    rig.plateInfo['faceplate' + side] = {
      ...info,
      rest: { pos: m.position.clone(), quat: m.quaternion.clone(), scale: m.scale.clone() },
    };
    return m;
  };
  make('L'); make('R');
  src.visible = false;
  rig.plateInfo.faceplate.visible = false;
  console.log('[faceplate] split faceplate into halves for', rig.id);
  return true;
}
