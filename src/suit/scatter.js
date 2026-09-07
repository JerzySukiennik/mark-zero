// The Mark III coming apart, lying on the ground, and flying back. Owned by suit/.
//
// THE BEAT, in Jurek's words: press X and the armour falls apart onto the ground. The pieces
// LIE there and are real objects — walk into them and they shift. Then, however far away you
// have walked, they come to you: each piece lights its own little repulsor, lifts off, flies
// over and clamps back on, one after another, until you are wearing it again.
//
// WHY THIS IS NOT RIGID BODIES. Every plate is already parented into the rig's pivot
// hierarchy, and rig.js can drive any of them by a WORLD transform (`setPlateWorld`) and say
// where one belongs when it is home (`plateHomeWorld`) — that is how the suit-up sequences
// fly plates in. Handing thirty-seven plates to Rapier would mean thirty-seven colliders
// created and destroyed on every doff, a second transform authority fighting the rig, and a
// pile of bodies to reconcile when they clamp back on. Ballistic integration with a ground
// plane and a push from the player is a hundred lines, allocates nothing, and is exactly as
// convincing for armour plates skittering on concrete.
//
// The whole thing is one array of plate records stepped once a frame. Nothing is allocated
// after `begin()`, and `begin()` allocates once per plate for the life of the module.
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export const SCATTER = {
  burst: 4.2,        // m/s the plates leave the body with
  spin: 7.0,         // rad/s of tumble
  gravity: 22,       // m/s^2 — heavier than real, so they settle fast and read as metal
  bounce: 0.28,      // how much of the impact comes back
  friction: 3.2,     // per second, once they are down
  pushRadius: 0.85,  // how close you have to be to shove one with your shins
  pushForce: 3.4,    // m/s imparted by walking into one
  liftTime: 0.45,    // seconds a plate hovers before it sets off
  flyTime: 0.85,     // seconds in the air on the way back
  stagger: 0.055,    // seconds between one plate leaving and the next
};

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,220,170,0.55)');
  rg.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ScatteredSuit {
  constructor(ctx) {
    this.ctx = ctx;
    this.rig = null;
    this.parts = [];
    this.phase = 'idle';        // idle | down | returning
    this.t = 0;
    this.groundY = 0;

    /* One sprite per plate for the mini repulsor that carries it home. Built lazily on the
     * first scatter and reused: a doff can happen many times a session and none of it should
     * churn the heap. */
    this.tex = null;
    this.flames = [];
    this.root = new THREE.Group();
    this.root.name = 'SCATTER_FX';
    ctx.scene.add(this.root);
  }

  /** True while pieces are on the ground or on their way back. */
  get active() { return this.phase !== 'idle'; }

  /**
   * Blow the armour apart around `origin`. The rig stays where it is — every plate is driven
   * by world transform from here until it is home again.
   */
  begin(rig, origin, groundY) {
    if (!rig) return false;
    this.rig = rig;
    this.groundY = groundY;
    this.phase = 'down';
    this.t = 0;
    this.parts.length = 0;

    if (!this.tex) this.tex = puffTexture();

    const names = Object.keys(rig.plates || {});
    let i = 0;
    for (const name of names) {
      if (!rig.hasPlate(name)) continue;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      if (!rig.plateHomeWorld(name, pos, quat)) continue;

      // Outward from the body's centre line, so the suit opens rather than piling up.
      _d.copy(pos).sub(origin);
      _d.y = 0;
      if (_d.lengthSq() < 1e-4) _d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _d.normalize();

      const part = {
        name,
        pos,
        quat,
        vel: new THREE.Vector3(
          _d.x * SCATTER.burst * (0.6 + Math.random() * 0.8),
          2.2 + Math.random() * 2.6,
          _d.z * SCATTER.burst * (0.6 + Math.random() * 0.8)
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * SCATTER.spin,
          (Math.random() - 0.5) * SCATTER.spin,
          (Math.random() - 0.5) * SCATTER.spin
        ),
        rest: false,
        home: false,
        delay: 0,
        from: new THREE.Vector3(),
        fromQ: new THREE.Quaternion(),
        order: i++,
      };
      this.parts.push(part);

      if (this.flames.length < this.parts.length) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.tex, color: 0xffb257, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        }));
        s.visible = false;
        this.root.add(s);
        this.flames.push(s);
      }
    }
    return this.parts.length > 0;
  }

  /**
   * Call them back to `target` (the player's world position). They lift, then fly home in
   * the order they came off, so the suit rebuilds around him rather than arriving as a lump.
   */
  recall(target) {
    if (this.phase !== 'down') return false;
    this.phase = 'returning';
    this.t = 0;
    // Nearest first: the pieces at your feet clamp on while the far ones are still crossing.
    const sorted = this.parts.slice().sort((a, b) =>
      a.pos.distanceToSquared(target) - b.pos.distanceToSquared(target));
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].delay = i * SCATTER.stagger;
      sorted[i].from.copy(sorted[i].pos);
      sorted[i].fromQ.copy(sorted[i].quat);
    }
    return true;
  }

  /** How much of the armour is back on, 0..1. suitup/ uses this to know when it is done. */
  get progress() {
    if (!this.parts.length) return 1;
    let n = 0;
    for (const p of this.parts) if (p.home) n++;
    return n / this.parts.length;
  }

  update(dt, playerPos) {
    if (this.phase === 'idle' || !this.rig) return;
    this.t += dt;
    const rig = this.rig;

    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      const flame = this.flames[i];
      if (flame) flame.visible = false;

      if (this.phase === 'down') {
        if (!part.rest) {
          part.vel.y -= SCATTER.gravity * dt;
          part.pos.addScaledVector(part.vel, dt);
          // Tumble about all three axes — a plate thrown off a chest spins every way at
          // once, and yaw alone reads as a spinning coin.
          _d.set(part.spin.x, part.spin.y, part.spin.z);
          const w = _d.length();
          if (w > 1e-4) {
            _q.setFromAxisAngle(_d.multiplyScalar(1 / w), w * dt);
            part.quat.multiply(_q);
          }
          if (part.pos.y <= this.groundY + 0.06) {
            part.pos.y = this.groundY + 0.06;
            if (Math.abs(part.vel.y) < 1.2) {
              // Settled. Lie flat: a plate at rest on concrete is not standing on edge.
              part.rest = true;
              part.vel.set(0, 0, 0);
              _q.setFromUnitVectors(_up, _up);
              part.quat.slerp(_q, 0.6);
            } else {
              part.vel.y = -part.vel.y * SCATTER.bounce;
              part.vel.x *= 0.6; part.vel.z *= 0.6;
              part.spin.multiplyScalar(0.5);
            }
          }
        } else if (playerPos) {
          /* WALK INTO THEM AND THEY MOVE. This is the whole reason they are objects and not
           * a decal: Jurek asked that "gdy sie na nie nachodzi, powinny sie przesuwac". A
           * horizontal shove only — kicking a plate into the air would read as a bug. */
          _d.copy(part.pos).sub(playerPos);
          _d.y = 0;
          const dd = _d.length();
          if (dd < SCATTER.pushRadius && dd > 1e-4) {
            _d.multiplyScalar(1 / dd);
            const k = (1 - dd / SCATTER.pushRadius) * SCATTER.pushForce;
            part.vel.x += _d.x * k * dt * 60;
            part.vel.z += _d.z * k * dt * 60;
          }
          // Slide and stop.
          const damp = Math.exp(-SCATTER.friction * dt);
          part.vel.x *= damp; part.vel.z *= damp;
          part.pos.x += part.vel.x * dt;
          part.pos.z += part.vel.z * dt;
          if (Math.abs(part.vel.x) + Math.abs(part.vel.z) > 0.05) {
            _q.setFromAxisAngle(_up, (part.vel.x + part.vel.z) * dt * 1.4);
            part.quat.multiply(_q);
          }
        }
      } else if (this.phase === 'returning') {
        const local = this.t - part.delay;
        if (local <= 0) { /* still waiting its turn on the ground */ }
        else if (!part.home) {
          // Where it has to end up, recomputed every frame: the body it is returning to is
          // walking around, so a target captured once would be stale by the time it arrived.
          rig.plateHomeWorld(part.name, _p, _q);
          const lift = Math.min(1, local / SCATTER.liftTime);
          const fly = Math.max(0, (local - SCATTER.liftTime) / SCATTER.flyTime);
          if (fly <= 0) {
            // The mini repulsor lights and it comes off the ground.
            part.pos.y = part.from.y + lift * 0.55;
            if (flame) {
              flame.visible = true;
              flame.position.copy(part.pos);
              flame.position.y -= 0.10;
              flame.scale.setScalar(0.16 + 0.10 * lift);
              flame.material.opacity = lift;
            }
          } else if (fly >= 1) {
            part.home = true;
            rig.resetPlate(part.name);          // hand it back to the hierarchy
          } else {
            // A shallow arc, not a straight line: it flies, it is not dragged.
            const e = fly * fly * (3 - 2 * fly);
            part.pos.lerpVectors(part.from, _p, e);
            part.pos.y += Math.sin(fly * Math.PI) * 0.9;
            part.quat.slerpQuaternions(part.fromQ, _q, e);
            if (flame) {
              flame.visible = true;
              flame.position.copy(part.pos);
              flame.position.y -= 0.10;
              flame.scale.setScalar(0.26 * (1 - fly * 0.5));
              flame.material.opacity = 1 - fly * 0.7;
            }
          }
        }
      }

      if (!part.home) rig.setPlateWorld(part.name, part.pos, part.quat);
    }

    if (this.phase === 'returning' && this.progress >= 1) this.finish();
  }

  /** Everything home: hand the plates back to the rig and stand down. */
  finish() {
    if (this.rig) for (const p of this.parts) this.rig.resetPlate(p.name);
    for (const f of this.flames) f.visible = false;
    this.parts.length = 0;
    this.phase = 'idle';
    this.rig = null;
  }

  /** Abandon without animating — a restart, or a different armour being chosen. */
  cancel() { this.finish(); }
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * NOT WIRED IN YET, ON PURPOSE.
 *
 * This module is finished and self-contained, but the doff flow it hangs off
 * (suit/suitup.js, engine/onfoot.js, main.js's X binding) is being rewritten in parallel,
 * and editing those files from two directions at once is how you get a merge that compiles
 * and does not work. Wiring is three calls once that lands:
 *
 *   on X, for an armour that comes apart:
 *       scatter.begin(ctx.suit.rig, <chest world position>, world.surfaceHeight(x, z))
 *   every frame while `scatter.active`:
 *       scatter.update(dt, <player world position>)
 *   when the player holds X again, anywhere on the map:
 *       scatter.recall(<player world position>)      // then wait for scatter.progress >= 1
 *
 * While it is active the armour must be left VISIBLE with the rig alive: this drives the
 * plates by world transform and hands them back with resetPlate() as each one clamps on.
 * `ctx.state.armor` should stay null until `progress` reaches 1 — you are not wearing a suit
 * that is lying on the floor.
 * ──────────────────────────────────────────────────────────────────────────────────────── */


/* ────────────────────────────────────────────────────────────────────────────────────────
 * THE OTHER WAY AN ARMOUR COMES OFF: IT OPENS, AND IT FLIES.
 *
 * Jurek's rule, once the three behaviours were separated: only the Mark XLII bursts into
 * pieces. The Marks I to III "open at the front, fly up, and come onto the player from
 * behind" — the suit stays ONE object the whole time. It splits down the front, the player
 * walks out of it, and it hangs there in the air; call it and it swings round behind him and
 * closes on him from the back.
 *
 * Same machinery as ScatteredSuit and for the same reasons (see the note at the top of this
 * file): every plate is driven by world transform through rig.setPlateWorld, and handed back
 * with resetPlate when it is home. The difference is that here the plates move TOGETHER —
 * one shell transform for all of them — with a small extra swing on the front pieces only.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

export const SHELL = {
  openTime: 0.9,      // seconds for the front to swing open and the shell to rise
  hoverUp: 0.55,      // metres it floats above where it was standing
  hoverBack: 0.9,     // and how far it drifts back off the player as he steps out
  openSwing: 0.62,    // radians the front plates hinge outwards
  openPush: 0.30,     // metres they also move away from the chest, so they clear the body
  approach: 1.55,     // metres BEHIND the player it lines up before closing
  flyTime: 1.15,      // seconds to cross from wherever it was to that point
  closeTime: 0.75,    // and to move in and shut
  bob: 0.06,          // idle float while it waits
};

/* The plates that make up the FRONT of the armour — the half that opens. Everything else is
 * the back and the limbs, which travel with the shell but do not swing. From
 * models/CONTRACT.md's plate list. */
const FRONT_PLATES = new Set([
  'chest', 'reactor', 'abdomen', 'ribL', 'ribR', 'pelvis', 'beltL', 'beltR',
  'collarL', 'collarR', 'faceplate', 'thighL', 'thighR', 'shinL', 'shinR', 'kneeL', 'kneeR',
]);

const _sp2 = new THREE.Vector3();
const _sq2 = new THREE.Quaternion();
const _off2 = new THREE.Vector3();
const _axis = new THREE.Vector3();

export class OpeningShell {
  constructor(ctx) {
    this.ctx = ctx;
    this.rig = null;
    this.phase = 'idle';       // idle | opening | waiting | flying | closing
    this.t = 0;
    this.names = [];
    this.anchor = new THREE.Vector3();   // where the empty shell hangs
    this.yaw = 0;
    this.from = new THREE.Vector3();
    this.fromYaw = 0;
  }

  get active() { return this.phase !== 'idle'; }
  /** 1 once it is fully back on. suitup/ waits on this exactly as it does for the scatter. */
  get progress() { return this.phase === 'idle' ? 1 : 0; }

  begin(rig, standPos, yaw) {
    if (!rig) return false;
    this.rig = rig;
    this.names = Object.keys(rig.plates || {}).filter(n => rig.hasPlate(n));
    if (!this.names.length) return false;
    this.anchor.copy(standPos);
    this.yaw = yaw || 0;
    this.phase = 'opening';
    this.t = 0;
    return true;
  }

  /** Call it back to the player. It lines up behind him first, then closes forward onto him. */
  recall(playerPos, playerYaw) {
    if (this.phase !== 'waiting' && this.phase !== 'opening') return false;
    this.target = this.target || new THREE.Vector3();
    this.from.copy(this.anchor);
    this.fromYaw = this.yaw;
    this.playerYaw = playerYaw || 0;
    this.phase = 'flying';
    this.t = 0;
    return true;
  }

  update(dt, playerPos, playerYaw) {
    if (this.phase === 'idle' || !this.rig) return;
    /* The flight home needs to know where he IS. playerStance() can come back null for a
     * frame — during a mode change, or before onfoot has a position — and a null here used
     * to throw out of the module update, which loop.js swallows: the armour froze in mid-air
     * and every armour tested after it silently did nothing. Hold station instead. */
    if ((this.phase === 'flying' || this.phase === 'closing') && !playerPos) return;
    this.t += dt;
    const rig = this.rig;
    let open = 0;              // 0 shut, 1 wide open
    let lift = 0;

    if (this.phase === 'opening') {
      const k = Math.min(1, this.t / SHELL.openTime);
      open = k; lift = k;
      if (k >= 1) { this.phase = 'waiting'; this.t = 0; }
    } else if (this.phase === 'waiting') {
      open = 1; lift = 1;
    } else if (this.phase === 'flying') {
      /* Behind him, facing the way he faces: the armour has to arrive on his back, so it
       * lines up on the far side of him first and only then moves in. */
      const k = Math.min(1, this.t / SHELL.flyTime);
      const e = k * k * (3 - 2 * k);
      const py = playerYaw !== undefined ? playerYaw : this.playerYaw;
      _off2.set(Math.sin(py), 0, Math.cos(py)).multiplyScalar(SHELL.approach);
      _sp2.copy(playerPos).add(_off2);
      this.anchor.lerpVectors(this.from, _sp2, e);
      this.anchor.y += Math.sin(k * Math.PI) * 0.7;
      this.yaw = this.fromYaw + (py - this.fromYaw) * e;
      open = 1; lift = 1;
      if (k >= 1) { this.phase = 'closing'; this.t = 0; this.from.copy(this.anchor); }
    } else if (this.phase === 'closing') {
      const k = Math.min(1, this.t / SHELL.closeTime);
      const e = k * k * (3 - 2 * k);
      const py = playerYaw !== undefined ? playerYaw : this.playerYaw;
      this.anchor.lerpVectors(this.from, playerPos, e);
      this.yaw = py;
      open = 1 - e; lift = 1 - e;
      if (k >= 1) { this.finish(); return; }
    }

    // The shell's own transform, and the idle float while it waits.
    const bob = this.phase === 'waiting' ? Math.sin(this.ctx.time * 1.7) * SHELL.bob : 0;

    for (let i = 0; i < this.names.length; i++) {
      const name = this.names[i];
      if (!rig.plateHomeWorld(name, _p, _q)) continue;
      /* Home is computed from where the RIG is; the shell hangs somewhere else. Move each
       * plate by the difference, so the whole armour travels as one rigid thing. */
      _p.y += lift * SHELL.hoverUp + bob;
      _off2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(lift * SHELL.hoverBack);
      _p.add(_off2);
      _d.copy(this.anchor).sub(rig.root.position);
      _p.add(_d);

      if (open > 0.001 && FRONT_PLATES.has(name)) {
        // The front hinges outward about the body's vertical axis, left half one way and
        // right half the other, and pushes forward so it clears the chest.
        const side = /L$/.test(name) ? 1 : (/R$/.test(name) ? -1 : 0);
        _axis.set(0, 1, 0);
        _sq2.setFromAxisAngle(_axis, side * open * SHELL.openSwing);
        _q.premultiply(_sq2);
        _off2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
          .multiplyScalar(-open * SHELL.openPush);
        _p.add(_off2);
      }
      rig.setPlateWorld(name, _p, _q);
    }
  }

  finish() {
    if (this.rig) for (const n of this.names) this.rig.resetPlate(n);
    this.names.length = 0;
    this.phase = 'idle';
    this.rig = null;
  }

  cancel() { this.finish(); }
}
