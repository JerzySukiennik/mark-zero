// MARK L suit-up — nanotech. Owned by task `suitup`. This is the one that matters.
//
// It does NOT snap on as plates. The armour pours out of the chest reactor as a
// directional wave: a band of tiny dark shapes riding a leading edge, with finished
// smooth surface resolving BEHIND it and cyan light leaking out of the seams that have
// not closed yet. Ahead of the edge there is nothing — skin and clothing, still visible.
//
// Mechanically that is one number: `edge`, a position along the flow coordinate the rig
// computes (geodesic distance from the reactor measured through the joint chain, so the
// wave travels over the shoulder and down the arm rather than jumping across the air).
// src/suit/nano.js drives the shader sweep and the particle band from it. There are no
// 37 plates fading in here, and no plate ever moves.
//
// The velocity profile is the whole performance: it bursts out of the reactor, floods
// the torso in half a second, then SLOWS as it runs out along the limbs — the far end
// of an arm takes as long as the whole chest did — and finally closes over the face.
//
// Reference: reference/suitup/mk50_nano_deploy.jpg, mk50_nano_flowing_face.jpg.

import * as THREE from 'three';

export default {
  id: 'mk50',
  origin: 'reactor',
  duration: 5.0,

  prepare(api) {
    const { rig, nano, faceplate } = api;
    rig.resetAllPlates();
    rig.setAllPlates(true);          // nothing is hidden; the shader decides what exists
    rig.setPose('suitup');
    this.milestones = new Set();
    this.edge = -0.03;
    if (faceplate) faceplate.snap(0);
    if (nano) {
      nano.setActive(true);
      nano.setEdge(this.edge);
      nano.setFaceEdge(this.edge);
      nano.setBand(0.05);
    }
    // The reactor itself is the source, so it is the one thing already there.
    //
    // Give it a material of its OWN before pumping it. mat_glow is shared with the eye
    // slits and the ridge accents, and nano.js deliberately patches one material per
    // SOURCE material, so writing emissiveIntensity on the reactor writes it on every
    // cyan slot on the armour — the whole suit surges instead of the chest.
    const reactor = rig.plate('reactor');
    this.reactorMat = null;
    if (reactor) {
      reactor.traverse(o => {
        if (!o.isMesh || this.reactorMat) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || !m.emissive || m.emissiveIntensity === undefined) return;
        let own = m;
        if (!m.userData.mzReactorOwn) {          // clone once per equip, not per play
          own = m.clone();
          own.userData = { ...m.userData, mzReactorOwn: true };
          own.onBeforeCompile = m.onBeforeCompile;
          own.customProgramCacheKey = m.customProgramCacheKey;
          o.material = own;
          // keep it breathing with the rest of the cores once the sequence is over
          own.userData.glowBase = own.emissiveIntensity;
          if (rig.glowCores) rig.glowCores.push(own);
        }
        this.reactorMat = own;
        this.reactorBase = own.userData.glowBase || own.emissiveIntensity || 1.5;
      });
    }
    api.emitPlate('nano:reactor', 0.9);
  },

  update(t, dt, api) {
    const { nano, rig } = api;
    const D = this.duration;

    // ---- the wave -----------------------------------------------------------
    // Piecewise speed along the flow coordinate. It is not an ease curve; it is a
    // material with momentum: a burst, a flood, a long slow run out to the fingers.
    const u = clamp01(t / D);
    let edge;
    if (u < 0.10) {
      edge = -0.03 + 0.10 * (u / 0.10);                       // burst out of the reactor
    } else if (u < 0.34) {
      const k = (u - 0.10) / 0.24;
      edge = 0.10 + 0.32 * (1 - Math.pow(1 - k, 1.6));        // floods the torso
    } else if (u < 0.72) {
      const k = (u - 0.34) / 0.38;
      edge = 0.42 + 0.40 * k;                                  // runs out along the limbs
    } else {
      const k = (u - 0.72) / 0.28;
      edge = 0.82 + 0.36 * (k * k * (3 - 2 * k));              // closes over the head
    }
    // a little surge, so the boundary is alive rather than a linear ramp
    edge += Math.sin(t * 9.0) * 0.006 * (1 - u);
    const speed = Math.max(0, (edge - this.edge) / Math.max(dt, 1e-4));
    this.edge = edge;

    if (nano) {
      nano.setEdge(edge);
      nano.setFaceEdge(edge);
      // The faster the boundary moves, the deeper the fringe of loose material ahead
      // of it: matter piling up at the front of the wave.
      // A tight fringe. At 0.115 of the flow range the band is ~20 cm of crawling cells,
      // which reads as a cuff of static rather than as an edge (probe X_nano_18).
      nano.setBand(THREE.MathUtils.clamp(0.022 + speed * 0.07, 0.022, 0.062));
      nano.update(dt);
    }

    // ---- audio milestones ---------------------------------------------------
    // Not plates: this armour has no clanks. These are the beats a sound designer
    // needs — the surge, the shoulders, the hands, the seal.
    this._mile(api, 'torso', edge > 0.30, 0.45);
    this._mile(api, 'shoulders', edge > 0.52, 0.55);
    this._mile(api, 'hands', edge > 0.80, 0.5);
    this._mile(api, 'seal', edge > 1.02, 1.0);

    // The reactor brightens as it feeds the wave and settles once the suit is closed:
    // a hard surge on the burst, then a long decay back to the level the armour wears.
    if (this.reactorMat) {
      const base = this.reactorBase;
      this.reactorMat.emissiveIntensity =
        base * (1 + 0.85 * Math.exp(-Math.pow((u - 0.10) * 5.5, 2)) + 0.20 * (1 - u));
    }
  },

  _mile(api, name, cond, impact) {
    if (!cond || this.milestones.has(name)) return;
    this.milestones.add(name);
    api.emitPlate('nano:' + name, impact);
  },

  finish(api) {
    const { rig, nano, faceplate } = api;
    if (this.reactorMat) this.reactorMat.emissiveIntensity = this.reactorBase;
    rig.setAllPlates(true);
    rig.resetAllPlates();
    if (nano) {
      nano.setEdge(1.6);          // fully formed: the shader is now inert
      nano.setFaceEdge(1.6);
      nano.setActive(false);
    }
    if (faceplate) faceplate.snap(0);
  },

  abort(api) { this.finish(api); },
};

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
