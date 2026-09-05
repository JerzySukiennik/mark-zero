// The five suit-up sequences and the four faceplate mechanisms. Owned by task `suitup`.
//
// Each armor has its OWN sequence file under sequences/ with its own animation code —
// there is no shared "animate a plate onto the body" path, because the whole point is
// that a critic can tell which armor is being donned from a single mid-sequence frame:
//
//   mk1   one arm, one crooked plate at a time, three hammer blows each   (gantry)
//   mk2   two arms alternating, dead-straight rails, one click per plate  (gantry)
//   mk3   four arms, mirrored pairs landing on the same frame, arcs       (gantry)
//   mk42  no arms at all: rigid plates fly in from across the room        (distant)
//   mk50  no plates move: a nano wave pours out of the reactor            (reactor)
//
// Everything is driven from the fixed 1/120 s tick, never from wall-clock time, so
// sim(n) reproduces a sequence frame for frame in a headless browser.

import * as THREE from 'three';
import { Gantry, SuitStage } from './gantry.js';
import { playerStance } from './suit.js';
import { meshesByPivot, PLATE_PIVOT } from './rig.js';
import mk1 from './sequences/mk1.js';
import mk2 from './sequences/mk2.js';
import mk3 from './sequences/mk3.js';
import mk42 from './sequences/mk42.js';
import mk50 from './sequences/mk50.js';

// Display names for the parked-shell prompt. Deliberately a local table and not an import
// of flight/'s ARMOR_SPECS: suit/ must not depend on flight/ (registry.js fixes the init
// order the other way round), and five strings are cheaper than that edge.
const SPEC_NAMES = {
  mk1: 'MARK I', mk2: 'MARK II', mk3: 'MARK III', mk42: 'MARK XLII', mk50: 'MARK L',
};

const SEQUENCES = { mk1, mk2, mk3, mk42, mk50 };

export default {
  id: 'suitup',

  async init(ctx) {
    let active = null;         // { seq, api, t, resolve }
    let stow = 0;              // gantry retraction timer after a sequence ends
    let doffing = null;        // armour currently being taken off
    let gantry = null;
    let hold = 0;              // seconds the stage lights stay up after the suit closes
    const stage = new SuitStage(ctx);
    const _at = new THREE.Vector3();

    // Where the pad is. The boy's own stance wins; the suit's transform is the fallback
    // for the frames before suit.update has written it.
    function placeStage() {
      const stand = playerStance(ctx);
      if (stand) { stage.place(stand.pos, stand.yaw); return; }
      ctx.suit.root.getWorldPosition(_at);
      stage.place(_at, ctx.suit.root.rotation.y);
    }

    const self = {
      playing: false,
      id: null,
      t: 0,
      progress: 0,
      sequences: Object.keys(SEQUENCES),

      // Play a full sequence. Resolves when the suit is closed.
      // Start a sequence and return once it is RUNNING. play() waits for it to finish;
      // everything that only needs it on screen (a critic scrubbing to one frame) waits
      // for this instead — awaiting play() from scrub() deadlocked in a headless browser,
      // where rAF is throttled to nothing and the sequence therefore never advances to
      // the frame that would resolve it.
      async begin(id) {
        const seq = SEQUENCES[id];
        if (!seq) { console.warn('[suitup] no sequence for', id); return null; }
        if (active) self.cancel();

        // Nobody else may drive the armour while the ritual is running. flight/ takes
        // ownership of suit.root on 'suitup:done' and writes its transform every frame
        // from then on — so a second suit-up (a critic shooting all five, or the player
        // landing and picking another armour) played out wherever the flight model had
        // left him. Measured: the Mk XLII and Mk L sequences ran chest-deep in the ocean
        // while the boy stood in the workshop, which is why S_mk42_50.png was a shot of
        // the sea. Hand the suit back to this module before touching it.
        if (ctx.flight && ctx.flight.active && ctx.flight.deactivate) ctx.flight.deactivate();
        ctx.state.mode = 'suitup';

        const rig = await ctx.suit.equip(id);
        if (!rig) return null;

        // Freeze the spot. He plants his feet for the ritual and does not drift with the
        // mouse for the next twenty seconds, and every sequence — plate trajectories,
        // gantry origin, the nano wave — is authored against one fixed transform.
        const stand = playerStance(ctx);
        if (stand) ctx.suit.place(stand.pos, stand.yaw);
        ctx.suit.followPlayer = false;

        // Strike the stage lights on the spot he is standing on, before the floor opens.
        placeStage();
        stage.forArmor(id);
        stage.set(1);
        hold = 0;

        // The boy has to be standing there before anything lands on him.
        const body = await ctx.suit.loadBody();
        ctx.suit.showBody(!!body);
        if (body && ctx.suit.nano) ctx.suit.nano.attachBody(body);

        if (seq.origin === 'gantry') {
          if (!gantry) gantry = await Gantry.create(ctx);
          gantry.setVisible(true);
        }

        // Compile before the curtain goes up. The Mk L patches sixty-four materials and
        // the boy's sixteen, and the driver compiles them on the FIRST FRAME THAT DRAWS
        // THEM — measured at 11.9 s in a headless browser, which lands as a freeze exactly
        // on the frame the wave leaves the reactor. Doing it here spends the same time
        // while nothing is moving yet.
        // Only the armour and the boy — compiling the whole scene here costs a minute of
        // world shaders that are already compiled anyway.
        if (ctx.renderer && ctx.renderer.compileAsync) {
          try { await ctx.renderer.compileAsync(ctx.suit.root, ctx.camera, ctx.scene); }
          catch (e) { console.warn('[suitup] precompile failed', e); }
        }

        const api = makeApi(ctx, seq, gantry);
        seq.prepare(api);
        active = { seq, api, t: 0, done: false, resolve: null };
        self.playing = true;
        self.id = id;
        self.t = 0;
        self.progress = 0;
        stow = 0;
        ctx.state.mode = 'suitup';
        ctx.state.suitClosed = false;
        ctx.bus.emit('suitup:start', id);
        return seq;
      },

      // Play a full sequence and resolve when the suit is closed.
      async play(id) {
        const seq = await self.begin(id);
        if (!seq || !active) return null;
        return new Promise(res => { active.resolve = res; });
      },

      // Freeze a sequence at an absolute time. This is how a critic renders the same
      // mid-sequence beat twice, or compares two armors at the same instant.
      async scrub(id, time) {
        const seq = SEQUENCES[id];
        if (!seq) return null;
        if (!active || self.id !== id) {
          await self.begin(id);
        }
        if (!active) return null;
        // Re-run from zero in fixed steps so the sequence sees a normal timeline.
        active.seq.prepare(active.api);
        active.t = 0;
        const step = 1 / 120;
        for (let t = 0; t < time; t += step) {
          active.t = Math.min(time, t + step);
          active.seq.update(active.t, step, active.api);
          if (gantry && seq.origin === 'gantry') gantry.setVisible(true);
        }
        self.t = active.t;
        self.progress = active.t / seq.duration;
        ctx.suit.rig.updatePose(0.5);
        return active.t;
      },

      cancel() {
        if (!active) return;
        stage.set(0);
        ctx.suit.showBody(false);
        if (active.seq.abort) active.seq.abort(active.api);
        if (active.resolve) active.resolve(null);
        active = null;
        self.playing = false;
        stow = 1;
      },

      // Faceplate, per-armor mechanism, driven off ctx.suit.pivots.
      faceplate(open) {
        if (!ctx.suit || !ctx.suit.faceplateCtl) return;
        ctx.suit.faceplate(open);
        ctx.bus.emit('faceplate', { open: !!open, armor: ctx.suit.id });
      },
      toggleFaceplate() { self.faceplate(!ctx.suit.faceplateOpen); },

      get gantry() { return gantry; },
      get stage() { return stage; },
      // The critic's path: MZ.wear() puts an armour on with no sequence, and an armour
      // rendered in an unlit basement is a black silhouette. Light the pad and leave it
      // lit until somebody flies away.
      //
      // Placed from the PLAYER's stance, not from ctx.suit.root: equip() is async and
      // the suit's transform is only written by suit.update, so a lightPad() called in
      // the same turn as an equip reads a root still parked at the world origin and puts
      // the whole rig 91 m below the workshop — measured, and the reason a Mk III
      // rendered black while a Mk I rendered lit (shots/suitup, second pass).
      lightPad(on = true) {
        placeStage();
        stage.forArmor(ctx.suit.id);
        stage.set(on ? 1 : 0);
        hold = on ? Infinity : 0;
      },
      duration(id) { return SEQUENCES[id] ? SEQUENCES[id].duration : 0; },
    };

    ctx.suitup = self;

    ctx.bus.on('armor:selected', id => { self.play(id); });
    ctx.bus.on('debug:suitup', id => { self.play(id); });
    ctx.bus.on('debug:wear', () => { setTimeout(() => self.lightPad(true), 0); });
    ctx.bus.on('debug:stage', v => self.lightPad(v !== false));
    // Once he is in the air the workshop rig is behind him and must not follow.
    ctx.bus.on('debug:fly', () => { hold = 0; stage.set(0); });
    ctx.bus.on('faceplate:toggle', () => self.toggleFaceplate());

    /* R starts the morning again, and the boy is a boy again. Without this a restart in
     * the middle of a ritual left the sequence running against a player who was no longer
     * there — measured: restart, then picking a mark did nothing at all, because `active`
     * was still the previous armour's sequence and begin() had already been through
     * cancel-on-entry. The armour also has to leave the world: the boy walks back into his
     * living room, and an empty Mk III standing on the pad behind him is not the shot. */
    /* ── Taking the armour off ──────────────────────────────────────────────────────
     * There was no way out of a suit: the only exit was restarting the game. This runs
     * the closing beat backwards — the nano suits retreat into the reactor, everything
     * else opens down the front and lifts away — then hands the player back to onfoot/.
     * Refused mid-air by the shell that emits it, and refused here during a suit-up.
     */
    ctx.bus.on('suit:doff', () => {
      if (self.playing || doffing) return;
      const suit = ctx.suit;
      if (!suit || !suit.rig || !ctx.state.armor) return;
      // Not in mid-air. The armour is left standing where you stepped out of it, and
      // stepping out over the Pacific left a Mk III hanging at y = 10.2 with the boy
      // falling away underneath it and no way to reach it again — measured, doffing at
      // 1366 m out to sea. Put it down first.
      const fm = ctx.flight && ctx.flight.model;
      if (ctx.state.mode === 'flight' && fm && !fm.grounded) {
        if (ctx.ui) ctx.ui.say('LAND FIRST, SIR.');
        return;
      }
      const nano = ctx.state.armor === 'mk50' && suit.nano;
      doffing = { t: 0, dur: nano ? 1.1 : 1.9, nano: !!nano, id: ctx.state.armor };
      ctx.bus.emit('faceplate', { open: true });
      if (suit.faceplateCtl) suit.faceplateCtl.open();
      ctx.bus.emit('suitup:doff', { id: doffing.id });
    });

    /**
     * Walk back into the armour you left standing. Emitted by onfoot/ when F is held on a
     * parked shell. No gantry, no plates flying in: the suit is already assembled, so all
     * that is left is to close the faceplate and hand control back to flight/, which is
     * exactly what `suitup:done` means to every listener in the game.
     */
    ctx.bus.on('suit:reenter', () => {
      const suit = ctx.suit;
      if (self.playing || doffing || !suit || !suit.parked || !suit.rig) return;
      const id = suit.parked.id;
      suit.parked = null;
      suit.showBody(false);                  // he is inside it again
      suit.setPose('stand', true);
      ctx.bus.emit('faceplate', { open: false });
      if (suit.faceplateCtl) suit.faceplateCtl.close();
      ctx.state.armor = id;
      ctx.state.suitClosed = true;
      ctx.state.faceplateOpen = false;
      self.id = id; self.progress = 1;
      ctx.bus.emit('suitup:done', id);
    });

    ctx.bus.on('restart', () => {
      if (ctx.suit) ctx.suit.parked = null;
      self.cancel();
      stow = 0; hold = 0;
      stage.set(0);
      if (gantry) gantry.setVisible(false);
      if (ctx.suit) {
        ctx.suit.showBody(false);
        if (ctx.suit.unequip) ctx.suit.unequip();
        if (ctx.suit.setVisible) ctx.suit.setVisible(false);
        ctx.suit.followPlayer = true;
      }
      self.playing = false; self.id = null; self.t = 0; self.progress = 0;
    });

    // Keep the module's update closure able to see the locals above.
    this._tick = (dt) => {
      if (doffing) {
        doffing.t += dt;
        const k = Math.min(1, doffing.t / doffing.dur);
        const suit = ctx.suit;
        if (suit && suit.rig) {
          if (doffing.nano && suit.nano) {
            // Nano retreats to the reactor: the same edge that spread outwards, run back.
            suit.nano.setActive(true);
            suit.nano.setEdge(1.6 - k * 2.6);
          } else {
            // Plates release from the head down, so the face appears first.
            const order = Object.keys(suit.rig.plates || {});
            if (order.length) {
              // Head first, so the boy's face comes out from under the helmet before the
              // rest lets go — that is the beat worth watching.
              const n = order.length;
              for (let i = 0; i < n; i++) {
                suit.rig.setPlateVisible(order[n - 1 - i], (i / n) > k);
              }
            } else if (k > 0.5) {
              suit.setVisible(false);
            }
          }
        }
        if (k >= 1) {
          // The armour is LEFT STANDING. It used to be unequipped and hidden outright, and
          // since flight/ keeps a dark red capsule as its stand-in for "no rig loaded yet",
          // stepping out of a Mk III turned the player into a red pill — Jurek's words, and
          // exactly what the code did. An empty suit is a thing in the world: it stays
          // where you left it, open, and you walk back into it.
          if (suit) {
            if (suit.rig) {
              for (const n of Object.keys(suit.rig.plates || {})) suit.rig.setPlateVisible(n, true);
            }
            // The Mk L's nano ran back into the reactor to open; put the shell back so
            // there is something standing there to climb into.
            if (doffing.nano && suit.nano) { suit.nano.setEdge(1.6); suit.nano.setActive(false); }
            suit.showBody(true);              // the boy, standing next to it
            suit.setVisible(true);            // ...and the armour, still standing
            suit.setPose('stand', true);
            suit.followPlayer = false;        // it stays put; it is furniture now
            // Drop it onto its feet. models/CONTRACT.md puts the armour's origin at the
            // SOLES, and the flight model is a point mass one metre above them, so a root
            // left where flight/ was writing it leaves the suit standing on thin air a
            // body-length up. onfoot/ stands the boy at exactly the same y.
            if (ctx.flight && ctx.flight.model) {
              suit.root.position.copy(ctx.flight.model.position);
              suit.root.position.y -= 1.0;
              suit.root.rotation.set(0, ctx.flight.model.rotation
                ? ctx.flight.model.rotation.y : suit.root.rotation.y, 0);
            }
            suit.parked = {
              id: doffing.id,
              name: SPEC_NAMES[doffing.id] || String(doffing.id).toUpperCase(),
              pos: suit.root.position.clone(),
            };
          }
          ctx.state.armor = null;
          ctx.state.suitClosed = false;
          ctx.state.faceplateOpen = true;    // it is standing there with the visor up
          ctx.state.mode = 'onfoot';
          if (ctx.flight && ctx.flight.deactivate) ctx.flight.deactivate();
          ctx.bus.emit('suitup:doffed', { id: doffing.id });
          if (ctx.ui) ctx.ui.say('SUIT PARKED. PRESS F TO STEP BACK IN.');
          doffing = null;
        }
        return;
      }
      if (active) {
        active.t += dt;
        self.t = active.t;
        self.progress = Math.min(1, active.t / active.seq.duration);
        try {
          active.seq.update(active.t, dt, active.api);
        } catch (e) {
          console.error('[suitup ' + active.seq.id + ']', e);
          self.cancel();
          return;
        }
        if (active.t >= active.seq.duration) {
          const { seq, api, resolve } = active;
          try { seq.finish(api); } catch (e) { console.error('[suitup finish]', e); }
          active = null;
          self.playing = false;
          self.progress = 1;
          stow = 1;
          ctx.state.suitClosed = true;
          hold = 2.4;                    // he stands in the light for a beat
          ctx.suit.showBody(false);      // he is inside it now
          ctx.suit.setPose('stand');
          ctx.bus.emit('suitup:done', self.id);
          if (resolve) resolve(self.id);
        }
      } else {
        if (hold > 0 && hold !== Infinity) {
          hold -= dt;
          if (hold <= 0) stage.set(0);
        }
        if (ctx.state.mode === 'flight' && hold !== Infinity) stage.set(0);
        // Held for a critic: follow him, so MZ.wear() then MZ.goto() still lands lit.
        // Outdoors it switches itself off — a studio key rig on a cliff at noon is both
        // pointless and a second sun. env.js writes envMix: 0 is Malibu midday, 1 is the
        // workshop.
        if (hold === Infinity) {
          if (ctx.state.envMix < 0.40) stage.set(0);
          else { stage.set(1); if (ctx.suit.followPlayer) placeStage(); }
        }
      }
      stage.update(dt);
      if (!active && stow > 0 && gantry) {
        // The floor closes again behind him.
        stow = Math.max(0, stow - dt / 2.2);
        gantry.setDeploy(stow);
        if (stow <= 0) gantry.setVisible(false);
      }
    };
  },

  update(dt, ctx) {
    if (this._tick) this._tick(dt);
  },
};

// ------------------------------------------------------------------ the skin beneath
//
// The boy stands inside the armour for the whole sequence, which is the only reason a
// half-built suit reads as a suit going onto a PERSON. It also means his arm is inside
// the forearm shell and his trousers are inside the shins, and a 1.95 m boy inside a
// 1.95 m armour interpenetrates: rendered, his trouser leg came through the Mk I shin as
// a pale stripe (shots/suitup/S_mk1_50.png).
//
// So each limb of him is switched off the moment the armour that encloses it is complete
// — not before, or a torso with only the chest plate on shows daylight through the ribs.
// Counted per joint from the plates the rig actually has, so a model that ships without
// a `back` plate still resolves.
function makeCover(rig, body) {
  const remaining = {}, meshes = {};
  if (!body) return null;
  for (const { mesh, pivot } of meshesByPivot(body)) {
    (meshes[pivot] || (meshes[pivot] = [])).push(mesh);
  }
  const pivotOf = {};
  for (const name of Object.keys(rig.plates)) {
    const p = rig.plateInfo[name];
    const pivName = (p && rig._pivotNameOf(p.pivot)) || PLATE_PIVOT[name] ||
      PLATE_PIVOT[name.replace(/[LR]$/, '')] || null;
    if (!pivName || !meshes[pivName]) continue;
    pivotOf[name] = pivName;
    remaining[pivName] = (remaining[pivName] || 0) + 1;
  }
  return {
    reset() {
      for (const list of Object.values(meshes)) for (const m of list) m.visible = true;
      for (const k of Object.keys(remaining)) remaining[k] = 0;
      for (const name of Object.keys(pivotOf)) remaining[pivotOf[name]]++;
      this.done = new Set();
    },
    done: new Set(),
    land(name) {
      if (this.done.has(name)) return;
      this.done.add(name);
      const piv = pivotOf[name];
      if (!piv) return;
      if (--remaining[piv] > 0) return;
      for (const m of meshes[piv]) m.visible = false;
    },
  };
}

// The surface a sequence is allowed to touch. Nothing in sequences/ reaches into the
// rest of the game: they get the rig, the gantry, the nano material and one emitter.
function makeApi(ctx, seq, gantry) {
  const suit = ctx.suit;
  const origin = new THREE.Vector3();
  suit.root.getWorldPosition(origin);
  const yaw = suit.root.rotation.y;
  // The Mk L never hides him by plate — its shader discards the skin behind the wave, so
  // the boundary is one edge instead of two that nearly agree.
  const cover = seq.origin === 'reactor' ? null : makeCover(suit.rig, suit.body);
  if (cover) cover.reset();
  return {
    cover,
    ctx,
    rig: suit.rig,
    nano: suit.nano,
    faceplate: suit.faceplateCtl,
    gantry: seq.origin === 'gantry' ? gantry : null,
    origin,
    yaw,
    // Every contact fires this on the exact frame it happens, so audio can land a
    // servo whine and a clank on the frame and not a tenth of a second later.
    emitPlate(name, impact) {
      if (cover) cover.land(name);
      ctx.bus.emit('suitup:plate', { name, impact, armor: seq.id });
    },
  };
}
