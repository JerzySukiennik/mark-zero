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

/* Which armours put THEMSELVES on. Kept here as a local table for the same reason as
 * SPEC_NAMES above — suit/ must not import flight/, because registry.js fixes the init
 * order the other way round and an import would make this module's load depend on a module
 * that has not been built yet. flight/'s ARMOR_SPECS carries the same `selfDon` flag for
 * the flight side; these two are a pair, so change both or neither.
 *
 * A self-donning armour gets no gantry: the plates fly in on their own arcs and close
 * around him with no machine in shot. */
const SELF_DON = { mk3: true, mk50: true };

const SEQUENCES = { mk1, mk2, mk3, mk42, mk50 };

export default {
  id: 'suitup',

  async init(ctx) {
    let active = null;         // { seq, api, t, resolve }
    let stow = 0;              // gantry retraction timer after a sequence ends
    let doffing = null;        // armour currently being taken off
    let viewBefore = null;     // the view the player chose, restored when the ritual ends
    let viewBeforeDoff = null; // ...and the same for stepping out of an armour
    let gantry = null;
    let hold = 0;              // seconds the stage lights stay up after the suit closes
    let boyOut = false;        // the pilot has been lifted out of the suit group — see below
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

    /* ── THE BOY IS INSIDE THE SUIT GROUP, AND THAT IS WHY TAKING IT OFF NEVER WORKED ──
     *
     * suit/suit.js hangs `pilot_body_holder` off `suit.root`, because normally an armour
     * is closing around him and the two must never drift apart by so much as a millimetre.
     * `followPlayer` is what walks that whole group to the player's stance.
     *
     * A doff parks the armour: it sets followPlayer = false so the empty shell stays
     * standing where you left it. The boy is in the same group, so HE STAYS STANDING IN IT
     * TOO — inside a suit he has supposedly just climbed out of, three metres behind the
     * player, not moving when the player walks. Measured before this change, identically on
     * all five marks (tools/doff-probe.html): after X the pilot's root was 3.00 m from the
     * player's feet and did not move when he walked, while 11-48 armour meshes sat in front
     * of the camera. That is every one of Jurek's three reports at once — "I can't see
     * myself", "I see myself as a different person", and the suit apparently putting itself
     * straight back on: what the chase camera framed was the parked shell with the pilot
     * standing inside it, and nothing at all where the player actually was.
     *
     * Four previous passes fixed flags around this (the per-frame `state.armor` rewrite,
     * the step-out distance, the airborne refusal, the menu's attract armour) and every one
     * of them was real — but none of them moved the boy, so the picture never changed.
     *
     * So: when the armour is parked, the pilot is lifted out of the suit group into the
     * scene and driven from the player's stance; when it is worn again he goes back in.
     * `pilot_body_holder` keeps its identity either way, so suit.js's showBody / showFace /
     * bodyVisible all go on working on exactly the object they always worked on.
     *
     * NOT done by turning followPlayer back on: the armour rig is in that same group, and
     * an empty shell that walks around after the player is not furniture, it is a ghost. */
    function boyHolder() {
      const b = ctx.suit && ctx.suit.body && ctx.suit.body.root;
      return b ? b.parent : null;      // pilot_body_holder, wherever it currently hangs
    }
    function boyStepOut() {
      if (boyOut) return;
      const holder = boyHolder();
      if (!holder) return;             // he has not finished loading; syncBoy retries
      ctx.scene.add(holder);           // three removes it from suit.root for us
      boyOut = true;
    }
    function boyStepIn() {
      if (!boyOut) return;
      const holder = boyHolder();
      boyOut = false;
      if (!holder) return;
      // Back to the identity transform: inside the group, the boy IS the armour's stance.
      holder.position.set(0, 0, 0);
      holder.rotation.set(0, 0, 0);
      ctx.suit.root.add(holder);
    }
    // Called first thing every tick. Two jobs, and the second one is the safety net: any
    // path that clears `parked` — equip() does, and so does the display-case flow — puts
    // him back where he belongs without having to know this module exists.
    function syncBoy() {
      const parked = ctx.suit && ctx.suit.parked;
      if (!boyOut) {
        // He may have loaded after the doff finished, in which case he is still in the
        // group and still standing in the shell. Take him out now.
        if (parked && ctx.suit.bodyVisible && boyHolder()) boyStepOut();
        else return;
      }
      if (!parked) { boyStepIn(); return; }
      const holder = boyHolder();
      const stand = playerStance(ctx);
      if (holder && stand) {
        holder.position.copy(stand.pos);
        holder.rotation.set(0, stand.yaw, 0);
      }
    }

    const self = {
      playing: false,
      doffing: false,      // suit/ reads this: the face logic must keep out during a doff
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
        // The ring is the machine now: it opens for the whole sequence and shuts after.
        const ring = ctx.world && ctx.world.ring;
        if (ring) ring.set(1);
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

        /* ORDER MATTERS HERE, AND IT USED TO BE BACKWARDS.
         *
         * `equip()` loads eight megabytes and takes seconds. It used to be the FIRST thing
         * this function did, while the previous armour was still on screen and onfoot/ had
         * already written the new id into ctx.state.armor. So what the player saw was:
         * himself apparently still wearing a suit, then the suit vanishing (that is
         * equip()'s unequip() finally running), and only then the ritual starting. Jurek's
         * words: "najpierw widac siebie w stroju, potem bez, a dopiero potem sie zaczyna
         * animacja".
         *
         * The load cannot be made shorter, but it can be moved behind the right picture.
         * Old armour gone first, boy standing on the deck second, stage lit and ring
         * opening third — and THEN the wait, with the machine visibly running while it
         * happens. Same seconds, and they now read as the gantry working instead of as a
         * glitch. */
        // If he was standing outside a parked shell, he is about to be inside an armour
        // again: put him back in the group before anything is placed, so the ritual is
        // authored against one transform and not two. (Not left to syncBoy: unequip()
        // below re-zeroes the holder's local position, which while he is detached would
        // put him at the world origin for however many seconds the next load takes.)
        boyStepIn();
        ctx.suit.unequip();                       // whatever was on him is gone, now
        ctx.suit.followPlayer = false;

        // Freeze the spot. He plants his feet for the ritual and does not drift with the
        // mouse for the next twenty seconds, and every sequence — plate trajectories,
        // gantry origin, the nano wave — is authored against one fixed transform.
        const stand = playerStance(ctx);
        if (stand) ctx.suit.place(stand.pos, stand.yaw);

        // The boy has to be standing there before anything lands on him — and before the
        // load, so the player is looking at himself rather than at nothing.
        const body = await ctx.suit.loadBody();
        ctx.suit.showBody(!!body);

        // Strike the stage lights on the spot he is standing on, before the floor opens.
        placeStage();
        stage.forArmor(id);
        stage.set(1);
        hold = 0;
        if (ctx.ui && ctx.ui.say) {
          ctx.ui.say((SPEC_NAMES[id] || String(id).toUpperCase()) + ' — ASSEMBLING.');
        }

        const rig = await ctx.suit.equip(id);
        if (!rig) return null;
        if (body && ctx.suit.nano) ctx.suit.nano.attachBody(body);
        // equip() resets the transform, so the stance has to be re-applied on the far side
        // of the load: the armour must close around the boy, not around the origin.
        if (stand) ctx.suit.place(stand.pos, stand.yaw);
        ctx.suit.followPlayer = false;
        ctx.suit.showBody(!!body);

        /* THE OLD WORKSHOP GANTRY, AND WHEN IT IS ALLOWED TO EXIST.
         *
         * `gantry.js` is the four-armed rig from the Malibu workshop. That map is gone and
         * the suit-up ring replaced it, but this still built the old machine and stood it on
         * the proto stage — Jurek: "pojawia sie kolejny robot wczesniejszej wersji, ktory to
         * robi, i to jest dziwne". It is a second, older-looking robot doing the ring's job
         * right next to the ring.
         *
         * SELF_DON marks mk3 and mk50: they assemble themselves and were never
         * supposed to have arms. The plate choreography in the sequences runs off bezier
         * arcs and does not need the gantry at all — every gantry call in them is already
         * behind `if (gantry)` — so a null here gives exactly what he asked for: the plates
         * fly in and close around him with no machine in sight. */
        const selfDon = !!SELF_DON[seq.id];
        if (seq.origin === 'gantry' && !selfDon) {
          if (!gantry) gantry = await Gantry.create(ctx);
          gantry.setVisible(true);
        } else if (gantry) {
          gantry.setVisible(false);
        }

        // Compile before the curtain goes up. The Mk L patches sixty-four materials and
        // the boy's sixteen, and the driver compiles them on the FIRST FRAME THAT DRAWS
        // THEM — measured at 11.9 s in a headless browser, which lands as a freeze exactly
        // on the frame the wave leaves the reactor. Doing it here spends the same time
        // while nothing is moving yet.
        // Only the armour and the boy — compiling the whole scene here costs a minute of
        // world shaders that are already compiled anyway.
        /* NEVER AWAITED. This is the fourth place the same idea was tried and the third
         * time it broke something: compileAsync resolves off a WebGL fence that a hidden
         * or throttled tab never advances, so awaiting it stops `begin()` dead — the ring
         * opened, the ritual never started, and nothing ever reported finished, so the
         * ring never shut again. It also throws an uncaught TypeError out of three's own
         * program-ready polling, which the promise's .catch() cannot see.
         *
         * Fire and forget: if it lands before the curtain goes up the hitch is gone, and
         * if it does not the frame pays for it exactly as it always did. */
        if (ctx.renderer && ctx.renderer.compileAsync) {
          try { ctx.renderer.compileAsync(ctx.suit.root, ctx.camera, ctx.scene).catch(() => {}); }
          catch (e) { /* a warm-up nobody waits on cannot break anything */ }
        }

        const api = makeApi(ctx, seq, selfDon ? null : gantry);
        seq.prepare(api);
        active = { seq, api, t: 0, done: false, resolve: null };
        self.playing = true;
        self.id = id;
        self.t = 0;
        self.progress = 0;
        stow = 0;
        ctx.state.mode = 'suitup';
        ctx.state.suitClosed = false;
        /* WATCH IT FROM OUTSIDE. Two reasons, and the second one is why it is here rather
         * than in cameraRig.
         *
         * The obvious one: the ring, the arms and the plates flying in are the best thing in
         * the game, and suiting up in first person means the player sees the inside of a
         * helmet while it happens. Nothing drove the view, so whatever you were in, you
         * stayed in.
         *
         * The measured one: the armour's textured materials compile the first time they are
         * DRAWN. In first person they are not drawn at all during the ritual, so the driver
         * linked twelve programs on the first frame of third-person flight instead — a
         * freeze at the exact moment the player is moving fastest (see engine/warmup.js for
         * the counts and for two attempts at fixing it the other way round). Showing the
         * ritual from outside pays that cost inside an animation nobody is steering.
         *
         * The player's own preference is restored when the ritual ends. */
        viewBefore = ctx.state.view;
        ctx.state.view = 'third';
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
          if (gantry && seq.origin === 'gantry' && !SELF_DON[seq.id]) gantry.setVisible(true);
        }
        self.t = active.t;
        self.progress = active.t / seq.duration;
        ctx.suit.rig.updatePose(0.5);
        return active.t;
      },

      cancel() {
        // Shut the ring whatever the reason. A ritual that ends by being abandoned leaves
        // the machine open just as surely as one that ends by finishing. The same goes for
        // the camera: an abandoned suit-up must not leave the player stuck in a view he did
        // not choose.
        { const ring = ctx.world && ctx.world.ring; if (ring) ring.set(0); }
        if (viewBefore) { ctx.state.view = viewBefore; viewBefore = null; }
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
      // Same rule as the X binding in main.js: actually flying, not merely airborne.
      const fm = ctx.flight && ctx.flight.model;
      if (ctx.state.mode === 'flight' && fm && !fm.grounded &&
          ((fm.altitude || 0) > 4 || (fm.speed || 0) > 10)) {
        if (ctx.ui) ctx.ui.say('LAND FIRST, SIR.');
        return;
      }
      const nano = ctx.state.armor === 'mk50' && suit.nano;
      doffing = { t: 0, dur: nano ? 1.1 : 1.9, nano: !!nano, id: ctx.state.armor };
      self.doffing = true;
      /* The whole boy, from the first frame of the doff — not just his face.
       * The plates are about to come off around him, and if only the head is showing what
       * you watch is a head hanging in mid-air while the armour dissolves. */
      suit.showFace(false);
      suit.showBody(true);
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
      /* THE ARMOUR COMES TO HIM, not the other way round.
       *
       * flight/ activates at wherever `suit.root` is standing when 'suitup:done' fires, so
       * re-entering used to snatch the camera off the boy and put it on the shell — up to
       * six metres away, measured, if he had walked at all since stepping out. X is meant
       * to be a toggle you press standing still; the player must not move because he
       * pressed it. Placing the shell on his stance first means the view does not jump at
       * all: the armour simply closes around him where he is.
       *
       * The F-hold route ends up here too, and there he is already within 2.4 m of it, so
       * this is at most a small nudge that also squares the suit up with his facing. */
      const stand = playerStance(ctx);
      if (stand) suit.place(stand.pos, stand.yaw);
      suit.parked = null;
      boyStepIn();                           // out of the world, back into the armour
      suit.showBody(false);                  // he is inside it again
      // Back into the view he was in before he stepped out.
      if (viewBeforeDoff) { ctx.state.view = viewBeforeDoff; viewBeforeDoff = null; }
      suit.setPose('stand', true);
      ctx.bus.emit('faceplate', { open: false });
      if (suit.faceplateCtl) suit.faceplateCtl.close();
      ctx.state.armor = id;
      ctx.state.suitClosed = true;
      ctx.state.faceplateOpen = false;
      self.id = id; self.progress = 1;
      /* The view the RITUAL saved is not restored here, and must not be: it belongs to a
       * suit-up, this is a re-entry, and applying it after viewBeforeDoff above would
       * overwrite the view the player was actually in when he stepped out. It can only be
       * non-null after a ritual that neither finished nor cancelled, so drop it. */
      viewBefore = null;
      ctx.bus.emit('suitup:done', id);
    });

    ctx.bus.on('restart', () => {
      { const ring = ctx.world && ctx.world.ring; if (ring) ring.set(0); }
      if (ctx.suit) ctx.suit.parked = null;
      boyStepIn();
      doffing = null; self.doffing = false;   // a doff interrupted by R is over, not stuck
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
      // Where the pilot stands is decided before anything else in the frame, and in every
      // mode: on foot outside a parked shell he has to be ON the player, not in the suit.
      syncBoy();
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
            /* AND THE BOY COMES OUT WITH HIM. The shell stays; he does not. See the long
             * note on boyStepOut above — this one line is the difference between stepping
             * out of an armour and watching yourself stay inside it. Done AFTER `parked`
             * is set, because syncBoy() keys off that field. onfoot/'s suitup:doffed
             * handler, fired below, is what actually moves the player away; syncBoy then
             * puts the boy on him on the very next tick. */
            boyStepOut();
          }
          /* SHOW HIM. You have just stepped out of a suit of armour and the whole point of
           * having an avatar is to see it — but in first person there is nothing to see, so
           * Jurek's report after X was "nie widac awatara" even though the boy was there and
           * visible the whole time. Same reasoning as the ritual: the interesting thing is
           * outside your own head, so put the camera outside it. The view you chose comes
           * back when you get into the armour again. */
          if (!viewBeforeDoff) viewBeforeDoff = ctx.state.view;
          ctx.state.view = 'third';
          ctx.state.armor = null;
          ctx.state.suitClosed = false;
          ctx.state.faceplateOpen = true;    // it is standing there with the visor up
          ctx.state.mode = 'onfoot';
          if (ctx.flight && ctx.flight.deactivate) ctx.flight.deactivate();
          self.doffing = false;
          ctx.bus.emit('suitup:doffed', { id: doffing.id });
          // X is the toggle, so X is what the line says. It used to name F, which is the
          // way back into a shell you did NOT take off yourself — telling the player to
          // walk somewhere and hold a second key is exactly the "it doesn't work" report.
          if (ctx.ui) ctx.ui.say('SUIT PARKED. X TO PUT IT BACK ON.');
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
          { const ring = ctx.world && ctx.world.ring; if (ring) ring.set(0); }
          if (viewBefore) { ctx.state.view = viewBefore; viewBefore = null; }
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
