// Repulsors. Owned by task `combat`.
//
// ctx.combat.fire() launches a bolt from the PALM EMITTER — the position and axis are read
// out of the model (`piv_palmL/R`, local −Y, per models/CONTRACT.md), never guessed and
// never faked from the camera when a suit is on. The bolt then travels: 240 m/s, real time
// of flight, swept collision.
//
// Aim: the crosshair is the camera axis. We raycast down it to find what the player is
// actually looking at, then aim the palm AT THAT POINT. So the hand can sit anywhere and
// the shot still lands on the crosshair — which is the thing players notice instantly when
// it is wrong.
import * as THREE from 'three';
import { VFX } from './vfx.js';
import { ProjectileSystem } from './projectile.js';
import { Unibeam, CHARGE } from './unibeam.js';

const DOWN_LOCAL = new THREE.Vector3(0, -1, 0);   // CONTRACT: palm emitter axis
const _fwd2 = new THREE.Vector3();
const _off = new THREE.Vector3();

export default {
  id: 'combat',

  async init(ctx) {
    const vfx = new VFX(ctx);
    const _up = new THREE.Vector3();
    const _at = new THREE.Vector3();
    const bolts = new ProjectileSystem(ctx, vfx);

    let cooldown = 0;
    let nextHand = 'R';
    let boundInput = false;
    let busFireSeen = false;

    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _fwd = new THREE.Vector3();

    // --- the palm emitter, straight out of the model -----------------------------------
    // A palm is only the emitter if the palm is actually ON THE PLAYER. The rig can be
    // parked at the origin (a suit still standing in its gantry, a sequence half wired up,
    // an armor worn before the flight proxy has claimed it) while the player is a hundred
    // metres away over the ocean, and then every shot leaves from an empty patch of the
    // workshop floor and the player sees nothing at all. Two metres is a whole arm span; at
    // five the pivot is not this player's hand whatever it is called.
    const EMITTER_MAX_REACH = 5;

    function emitter(hand) {
      const cam0 = ctx.camera;
      const plausible = p => !cam0 || cam0.position.distanceTo(p) <= EMITTER_MAX_REACH;

      // suit/ owns the rig, so if it publishes an emitter query that is the authority on
      // where a palm is and which way it points — ask it first and take whatever it says.
      // Reaching into `pivots` below is the fallback for a rig that has not published one.
      if (ctx.suit && typeof ctx.suit.emitter === 'function') {
        if (ctx.suit.emitter('piv_palm' + hand, _p, _fwd) && plausible(_p)) {
          return { pos: _p.clone(), axis: _fwd.clone().normalize(), fromModel: true };
        }
      }
      const pivots = ctx.suit && ctx.suit.pivots ? ctx.suit.pivots : null;
      const piv = pivots && (pivots['piv_palm' + hand] || pivots['palm' + hand] ||
                             pivots['piv_palm' + hand.toLowerCase()]);
      if (piv && piv.isObject3D) {
        piv.updateWorldMatrix(true, false);
        piv.matrixWorld.decompose(_p, _q, _s);
        if (plausible(_p)) {
          return {
            pos: _p.clone(),
            axis: DOWN_LOCAL.clone().applyQuaternion(_q).normalize(),
            fromModel: true,
          };
        }
      }
      // No suit on (or the model has not landed yet): shoulder-width offsets off the camera.
      const cam = ctx.camera;
      cam.getWorldDirection(_fwd);
      const right = new THREE.Vector3().crossVectors(_fwd, cam.up).normalize();
      const side = hand === 'L' ? -1 : 1;
      return {
        pos: cam.position.clone()
          .addScaledVector(right, 0.38 * side)
          .addScaledVector(_fwd, 0.62)
          .addScaledVector(cam.up, -0.34),
        axis: _fwd.clone(),
        fromModel: false,
      };
    }

    // --- where the crosshair points ----------------------------------------------------
    function aimPoint(maxDist = 900) {
      const cam = ctx.camera;
      cam.getWorldDirection(_fwd);
      const origin = cam.position.clone().addScaledVector(_fwd, 0.4);
      if (ctx.physics && ctx.physics.ready) {
        const hit = ctx.physics.raycast(origin, _fwd, maxDist, null);
        if (hit) return hit.point;
      }
      if (ctx.world && ctx.world.surfaceHeight && _fwd.y < -0.01) {
        // march for the ground crossing; the terrain has no analytic solution
        let lo = 0, hi = maxDist;
        const p = new THREE.Vector3();
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) * 0.5;
          p.copy(origin).addScaledVector(_fwd, mid);
          const gy = ctx.world.surfaceHeight(p.x, p.z);
          if (Number.isFinite(gy) && p.y < gy) hi = mid; else lo = mid;
        }
        if (hi < maxDist - 0.5) return origin.clone().addScaledVector(_fwd, hi);
      }
      return origin.addScaledVector(_fwd, maxDist);
    }

    /**
     * Fire one repulsor bolt.
     * @param opts.hand  'L' | 'R'  (default: alternates)
     * @param opts.power 0..1.5
     * @param opts.target world point to aim at (default: the crosshair)
     */
    function fire(opts = {}) {
      if (cooldown > 0 && !opts.ignoreCooldown) return null;
      if (!opts.ignoreState && ctx.state.mode === 'onfoot' && !ctx.state.armor) return null;
      const hand = opts.hand || nextHand;
      nextHand = hand === 'R' ? 'L' : 'R';
      const power = opts.power ?? 1;
      const em = emitter(hand);
      const target = opts.target ? opts.target.clone() : aimPoint();

      // Aim the palm at the crosshair point. If the model's own emitter axis disagrees by
      // more than a few degrees the shot still goes to the crosshair — the axis governs the
      // muzzle flash, the crosshair governs the hit.
      const dir = target.sub(em.pos);
      if (dir.lengthSq() < 1e-6) dir.copy(em.axis);
      dir.normalize();

      /* NEVER SPAWN THE BOLT BEHIND THE EYE.
       *
       * The muzzle is the armour's real palm pivot, which is right — but at cruise the
       * arms are swept back down the flanks and the first-person camera sits 0.30 m out
       * through the faceplate, so the hands are genuinely BEHIND the view. Fire from there
       * and the bolt is born off-screen and flies away from you: "the repulsor shots come
       * out from behind the suit". It is worst on the first shot of a burst, before the
       * fire pose has swung the arm forward.
       *
       * So the muzzle keeps its real position except when it is behind the camera plane,
       * and then it slides forward along the shot line just far enough to clear it. The
       * bolt still leaves the right hand in third person, where you can see the hand. */
      if (ctx.state.view !== 'third') {
        const cam = ctx.camera;
        cam.getWorldDirection(_fwd2);
        _off.copy(em.pos).sub(cam.position);
        const ahead = _off.dot(_fwd2);
        if (ahead < 0.45) em.pos.addScaledVector(dir, 0.45 - ahead);
      }

      // A bolt fired from something already doing 290 m/s carries that speed with it, or a
      // shot taken at cruise appears to crawl out of the palm and get overtaken.
      const carry = (ctx.flight && ctx.flight.velocity)
        ? Math.max(0, ctx.flight.velocity.dot(dir)) : 0;

      vfx.muzzle(em.pos.clone().addScaledVector(em.axis, 0.06), em.axis, power);
      const bolt = bolts.fire(em.pos.clone().addScaledVector(dir, 0.12), dir,
                              { power, hand, speed: bolts.speed + carry });
      cooldown = opts.ignoreCooldown ? cooldown : 0.16;
      ctx.state.power = Math.max(0, ctx.state.power - 0.004 * power);
      /* RECOIL. "te strzaly powinny miec odrzut wplywajacy na lot, czyli strzelanie w dol
       * popycha cie do gory." A repulsor is a thruster you point at something else, so it
       * has to push back — firing downward should lift you, and a long burst forward should
       * measurably slow you down. Scaled with power, so the charged shot below shoves hard
       * and a tap is a nudge. */
      if (ctx.flight && ctx.flight.model && ctx.flight.active) {
        const kick = (opts.recoil ?? 1.6) * power;
        ctx.flight.model.velocity.addScaledVector(dir, -kick);
      }
      ctx.bus.emit('repulsor:fire', { hand, power, origin: em.pos.clone(), direction: dir.clone() });
      return bolt;
    }

    function fireAt(target, opts = {}) {
      return fire(Object.assign({ target, ignoreState: true, ignoreCooldown: true }, opts));
    }

    /* ── THE CHARGED SHOT ──────────────────────────────────────────────────────────────
     * A quick click is an ordinary shot. Holding the trigger charges, and a full charge
     * released fires every emitter at once into one converging beam. Mk L only — see
     * combat/unibeam.js for the whole rule.
     *
     * The tap fires on the DOWN edge, not on release, because a trigger that waits to see
     * whether you meant to hold feels broken at the only moment it matters. Charging then
     * runs underneath the shot you already took. */
    const beam = new Unibeam(ctx);
    let held = false, chargeT = 0;

    /** The emitters that feed the beam: reactor, both palms, both array tips. */
    function beamOrigins() {
      const out = [];
      const grab = name => {
        if (ctx.suit && typeof ctx.suit.emitter === 'function') {
          const p = new THREE.Vector3(), d = new THREE.Vector3();
          if (ctx.suit.emitter(name, p, d)) { out.push(p); return; }
        }
        out.push(null);
      };
      grab('piv_reactor'); grab('piv_palmL'); grab('piv_palmR');
      // The arrays live on the thrust FX, because that is what grows them.
      const wings = ctx.flight && ctx.flight.thrustFX && ctx.flight.thrustFX.wings;
      if (wings && wings.length) {
        for (const w of wings) { const p = new THREE.Vector3(); w.core.getWorldPosition(p); out.push(p); }
      }
      return out;
    }

    function fireCharged() {
      const em = emitter('R');
      const chest = beamOrigins()[0] || em.pos;
      const target = aimPoint();
      const dir = target.clone().sub(chest);
      if (dir.lengthSq() < 1e-6) dir.copy(em.axis);
      dir.normalize();
      const mid = chest.clone().addScaledVector(dir, CHARGE.converge);
      beam.play(beamOrigins(), mid, target);
      // Damage rides the ordinary projectile chain, at weight. Started at the convergence
      // point, so it cannot clip the suit's own shoulder on the way out.
      bolts.fire(mid.clone().addScaledVector(dir, 0.4), dir,
                 { power: CHARGE.power, hand: 'R', speed: CHARGE.speed });
      if (ctx.flight && ctx.flight.model && ctx.flight.active) {
        ctx.flight.model.velocity.addScaledVector(dir, -CHARGE.recoil);
      }
      ctx.state.power = Math.max(0, ctx.state.power - 0.22);
      ctx.bus.emit('repulsor:charged', { origin: mid.clone(), direction: dir.clone() });
    }

    function stepCharge(dt) {
      const down = !!(ctx.input && ctx.input.buttons && ctx.input.buttons[0]);
      const armed = !!ctx.state.armor && Unibeam.allowed(ctx);
      if (down && !held) {
        held = true; chargeT = 0;
        if (ctx.state.mode !== 'onfoot' || ctx.state.armor) fire();
      } else if (down && held) {
        if (armed) chargeT = Math.min(CHARGE.time, chargeT + dt);
      } else if (!down && held) {
        if (armed && chargeT >= CHARGE.time) fireCharged();
        held = false; chargeT = 0;
      }
      // Published for the arrays (they grow with the charge, not with the trigger) and the
      // HUD. Zero on every other armour, which is how the arrays stay off them.
      api.charge = armed ? chargeT / CHARGE.time : 0;
      api.charging = armed && down;
      beam.update(dt);
    }

    const api = {
      fire, fireAt, vfx, bolts, beam,
      charge: 0, charging: false,
      fireCharged, stepCharge,
      get projectiles() { return bolts.live; },
      get cooling() { return cooldown; },
      emitter, aimPoint,
    };
    ctx.combat = api;

    // --- input -------------------------------------------------------------------------
    // flight/input.js may publish 'input:fire'. If it does, we listen and nothing else.
    // If it does not, we bind the mouse ourselves so the game is playable either way.
    /**
     * THE MARK A LANDING LEAVES. flight/ has emitted 'impact' since it was written and the
     * only two listeners were a camera shake and a thud — an armour could hit a road at
     * 40 m/s and the road would be spotless. A hard arrival throws dust and cracks the
     * surface under the fist, which is the half of the superhero landing that is not pose.
     * Scaled off the closing speed and skipped below 12 m/s, so putting the feet down
     * gently stays clean.
     */
    ctx.bus.on('flight:land', ({ force, point }) => {
      if (!point) return;
      const f = Math.min(1, force);
      _up.set(0, 1, 0);
      _at.copy(point);
      _at.y -= 1.0;                       // point mass -> soles (models/CONTRACT.md)
      vfx.impact(_at, _up, 'concrete', 0.6 + f * 2.2);
      vfx.flashLight(_at, 2.4 * f, 0.22);
    });

    ctx.bus.on('input:fire', p => { busFireSeen = true; fire(p || {}); });
    /* NO pointerdown LISTENER ANY MORE. The trigger is a state machine now (stepCharge,
     * above): a click has to be told apart from a hold, and that cannot be done from an
     * edge event alone. Firing on the down edge inside the update keeps a tap as
     * responsive as it was while making the hold mean something. */
    ctx.bus.on('debug:fire', p => fire(Object.assign({ ignoreState: true }, p || {})));

    // --- self-test bed:  ?mzdemo=1  ------------------------------------------------------
    // Boots straight into the destruction demo with a scripted set of shots, so this piece
    // can be rendered and looked at on its own, deterministically, without a world or a
    // suit. ?mzcam=x,y,z:lx,ly,lz parks the camera.
    let demo = null;
    ctx.bus.on('ready', () => {
      const q = new URLSearchParams(location.search);
      if (!q.has('mzdemo')) return;
      if (!ctx.destruction || !ctx.destruction.demo) return;
      const rig = ctx.destruction.demo();
      const O = rig.position;                       // the rig stands clear of the real world

      // Every target is a point ON THE SURFACE of a rig object, in rig-local coordinates.
      // Shots are fired at them, not at the objects, so what is being tested is the whole
      // chain: palm emitter -> travelling bolt -> collider -> fracture at that exact point.
      const T = [
        [0.30, [0.55, 5.90, -5.98]],     // top-middle glass pane, deliberately off centre
        [1.40, [10.0, 2.10, -5.72]],     // concrete wall
        [2.50, [-9.0, 4.70, -2.88]],     // lamp post, high up the shaft
        [3.10, [-9.0, 4.70, -2.88]],     // and again: steel takes two
        [4.10, [21.2, 7.50, -12.4]],     // donut, first bite
        [5.00, [17.0, 11.7, -12.4]],     // donut, second bite
        [5.90, [-3.1, 1.90, -5.98]],     // lower-left glass pane
        [6.80, [-5.0, 4.70, -2.88]],     // second lamp post
        [7.30, [-5.0, 4.70, -2.88]],
      ];
      // Close enough that a shard is a shard and not a speck. At 26 m out the whole rig
      // fits in frame and nothing in it can be judged; 17 m still holds the glass wall, the
      // concrete wall and the donut, and a crack front is legible.
      let pos = [O.x + 4, O.y + 5.6, O.z + 17], look = [O.x + 6, O.y + 3.6, O.z - 7];
      if (q.has('mzcam')) {
        const [a, b] = q.get('mzcam').split(':');
        if (a) pos = a.split(',').map(Number).map((v, i) => v + [O.x, O.y, O.z][i]);
        if (b) look = b.split(',').map(Number).map((v, i) => v + [O.x, O.y, O.z][i]);
      }
      // camOverride, not camera.position: it is applied after every module has rendered, so
      // the flight camera rig cannot take the shot back.
      ctx.camOverride = { pos, look, fov: ctx.camera.fov };
      // The boy starts in the workshop, so the environment is still in its dark interior
      // mix. The rig stands outdoors; light it that way or every break is judged in a
      // basement.
      ctx.bus.emit('env:set', 'exterior');
      ctx.state.paused = false;
      demo = { t: 0, i: 0, shots: T, O, pos, look };
    });

    this._tick = (dt) => {
      cooldown = Math.max(0, cooldown - dt);
      bolts.update(dt);
      vfx.update(dt);
      if (demo) {
        // ctx.camOverride only bites at render time, and onfoot/cameraRig run AFTER this
        // module, so by the time we fire the camera is back inside the house — and the
        // palm-emitter fallback would launch every test bolt through the living room. Park
        // it here too, before anything is fired.
        ctx.camera.position.set(demo.pos[0], demo.pos[1], demo.pos[2]);
        ctx.camera.up.set(0, 1, 0);
        ctx.camera.lookAt(demo.look[0], demo.look[1], demo.look[2]);
        ctx.camera.updateMatrixWorld(true);
        // onfoot keeps asking for the workshop mix because the boy is still standing in it;
        // the rig is outdoors, so take the lighting back every tick.
        // Through the bus, not ctx.env.set(): the sky and the fog follow 'env:set', and
        // calling env.set() directly leaves them in the workshop's night mix.
        if (ctx.env && ctx.env.k > 0.001) ctx.bus.emit('env:set', 'exterior');
        demo.t += dt;
        while (demo.i < demo.shots.length && demo.t >= demo.shots[demo.i][0]) {
          const [, p] = demo.shots[demo.i++];
          fireAt(new THREE.Vector3(p[0] + demo.O.x, p[1] + demo.O.y, p[2] + demo.O.z));
        }
      }
    };
  },

  update(dt, ctx) {
    if (this._tick) this._tick(dt);
    if (ctx.combat && ctx.combat.stepCharge) ctx.combat.stepCharge(dt);
  },
};
