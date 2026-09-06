// The 13-year-old boy. Owned by engine-core.
//
// He is 1.45 m tall with his eyes at 1.32 m, and that number is the whole point of this
// module. An adult first-person camera sits at 1.70–1.75; at 1.32 the glass rails of the
// Malibu house come up past his chest, a workshop bench top crosses his chest, and the
// armors in their cases look DOWN at him. You are meant to feel short before you ever put
// on a suit that makes you three metres of metal.
//
// What is in here:
//   * a walk with a real acceleration curve — not a lerp, a bounded acceleration, so
//     starting and stopping take time and a change of direction costs momentum;
//   * head bob driven by DISTANCE TRAVELLED, not by a clock: the stride is 0.68 m, so at
//     1.4 m/s the head bobs at 2.06 steps a second and footstep events fire on the beat.
//     Bob the head off a timer and it desynchronises from the feet the moment you slow;
//   * mouse look built as a YXZ euler — yaw, then pitch, then roll — which cannot gimbal
//     flip inside the +/-88 degree pitch clamp;
//   * collision against the REAL house: every wall, stair, column and bench world/ builds
//     is handed to Rapier, so the boy walks the actual geometry through ctx.physics —
//     a down ray for the floor and two ball sweeps for the walls, with slide. There is no
//     second, invisible copy of the house in this file;
//   * the descent: env.k, the lighting mix, is driven off how far the player is below the
//     main slab every step, so Malibu midday drains away with the stairs instead of
//     switching at a trigger volume;
//   * the armor bay: the five marks come from ctx.world.armorStands — world/ builds the
//     frosted cases, this module stands an armour inside each one, and walking up and
//     holding F walks him onto the gantry pad and fires 'armor:selected'.
//
// What is NOT in here: the house. That is world/. `buildFallbackDescent` is a stairwell
// and a dark room that exists only so the game is walkable if world/ ever fails to init;
// it deletes itself the moment ctx.world.armorStands shows up.
import { mergeStatic } from './dedupe.js';
import * as THREE from 'three';

// --- the body ----------------------------------------------------------------------
// A THIRTEEN-YEAR-OLD, MEASURED, NOT GUESSED.
// The first pass here read 1.58 m eye / 1.70 m tall. That is not a boy, it is a grown
// man: 1.70 m is the median height of an adult male, and rendered from a case the camera
// sat ABOVE the armor's chest reactor, which is the exact thing that was supposed to
// make you feel small. A 13-year-old boy at the 50th percentile is about 1.56 m tall
// with his eyes ~0.085 m below the crown, so:
//   stand   1.45 m tall, eyes at 1.32   (deliberately at the shorter end — he reads as a
//                                        kid in a room built for Tony Stark)
//   crouch  0.95 m tall, eyes at 0.82
// Two checks that must both hold after any change here, and both are read off a RENDER,
// never off a number: standing at an armor case the eye lands BELOW the suit's chest
// reactor, and a workshop bench top (0.92 + 0.09 m) sits at roughly chest height in
// frame. composeOpeningShot()'s eyeOf() reads EYE_STAND, so the opening-shot search
// moves whenever these move — re-shoot the opening and the stair descent too.
const EYE_STAND = 1.32;
const EYE_CROUCH = 0.82;
const HEIGHT_STAND = 1.45;
const HEIGHT_CROUCH = 0.95;
const RADIUS = 0.28;

const WALK = 2.55;           // m/s
const RUN = 4.60;
const CROUCH_SPEED = 1.25;
const ACCEL = 11.0;          // m/s^2 toward the wish velocity, on the ground
const ACCEL_RUN = 13.5;
const BRAKE = 18.0;          // m/s^2 when there is no input
const AIR_ACCEL = 3.0;
const GRAVITY = 20.5;
const JUMP = 4.70;           // ~1.07 m apex
const STEP_UP = 0.44;        // stairs he can walk up without jumping
const SNAP_DOWN = 0.55;      // how far he is pulled back down onto a descending step
const SKIN = 0.02;

const STRIDE = 0.68;         // metres per step — sets the head-bob frequency
const BOB_Y = 0.030;
const BOB_X = 0.022;
const BOB_ROLL = 0.016;      // radians

const LOOK_SENS = 0.0021;
const PITCH_LIMIT = 1.535;   // 87.9 deg — clamped well short of straight up
const LOOK_SMOOTH = 42;      // 1/s; high enough to feel direct, enough to kill jitter

const HOLD_TIME = 1.0;       // seconds to hold F on an armor case
const REACH = 4.2;           // metres
const STAND_OFF = 2.9;       // where he stops in front of a case, in metres
const APPROACH_TIMEOUT = 13; // give up walking him to the pad after this and just start
const APPROACH_SPEED = 4.2;  // he RUNS to the platform: the rack is 18 m from the pad,
                             // and a walk turns the best beat in the game into a commute

const ARMORS = [
  { id: 'mk1',  name: 'MARK I',    sub: 'CAVE BUILD  ·  IRON',         tint: 0x4a4640, reactor: 0xbfe6ff, glow: 0.55 },
  { id: 'mk2',  name: 'MARK II',   sub: 'PROTOTYPE  ·  BARE METAL',    tint: 0x9aa2a8, reactor: 0xdff2ff, glow: 0.70 },
  { id: 'mk3',  name: 'MARK III',  sub: 'RED / GOLD  ·  FLIGHT READY', tint: 0x6d1418, reactor: 0xeaf7ff, glow: 1.00 },
  { id: 'mk42', name: 'MARK XLII', sub: 'PREHENSILE  ·  MODULAR',      tint: 0x9a7a3a, reactor: 0xffffff, glow: 1.50 },
  { id: 'mk50', name: 'MARK L',    sub: 'NANOTECH  ·  BLEEDING EDGE',  tint: 0x4a1620, reactor: 0x9fe8ff, glow: 1.25 },
];

// Fallback geometry only. Overridden entirely the moment world/ is alive.
const BAY = {
  floorY: -4.60, ceilY: -1.15,
  minX: -10.5, maxX: 10.5, minZ: -14.5, maxZ: -3.6,
  caseZ: -13.4, caseSpacing: 3.05,
};
const SHAFT = { minX: 6.0, maxX: 9.6, topZ: 4.4, botZ: -4.2, topY: 0.70, botY: BAY.floorY, steps: 18 };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export default {
  id: 'onfoot',

  async init(ctx) {
    const P = {
      pos: new THREE.Vector3(0, 0, 6),
      vel: new THREE.Vector3(),
      yaw: Math.PI, pitch: 0,
      yawSmooth: Math.PI, pitchSmooth: 0,
      grounded: true,
      crouch: false, crouchAmt: 0,
      stride: 0, stepIndex: 0,
      bobY: 0, bobX: 0, roll: 0,
      landDip: 0, landVel: 0,
      breathe: 0,
      speed: 0,
    };
    // Extra collision this module owns. world/ may push into either list; the fallback
    // stairwell fills them when there is no world at all.
    const colliders = [];   // {min:Vector3, max:Vector3}
    const floors = [];      // {x0,x1,z0,z1,y}
    const suppress = [];    // XZ rects where ctx.world.surfaceHeight must be ignored
    const cases = [];

    const root = new THREE.Group();
    root.name = 'ONFOOT';
    ctx.scene.add(root);

    // ---- what world/ gave us -------------------------------------------------
    const W = ctx.world || null;
    const stands = (W && Array.isArray(W.armorStands) && W.armorStands.length) ? W.armorStands : null;
    const spawns = (W && W.spawns) || null;
    // The spawn is MUTABLE: composeOpeningShot() below may replace it, and restart has
    // to put him back where the game actually opened, not where world/ proposed.
    const sp = (W && W.spawn) || { x: 0, y: 1, z: 6, yaw: Math.PI };
    const spawnPoint = { x: sp.x, y: sp.y, z: sp.z, camYaw: null, pitch: 0 };
    const spawnHeading = () => spawnPoint.camYaw != null ? spawnPoint.camYaw : camYaw(sp.yaw);
    // The two floor levels, read off the world rather than hard-coded, because they are
    // what the lighting mix is measured between.
    const MAIN_Y = spawns && spawns.living ? spawns.living.y : 0.70;
    const SHOP_Y = spawns && spawns.workshop ? spawns.workshop.y : BAY.floorY;
    const gantryPoint = (W && W.gantryPoint) || null;

    // world/ writes yaw in the OBJECT convention — the direction a model with its face
    // along +Z would point after rotation.y — which is what its armorStands use too. The
    // first-person camera is the opposite convention: at yaw 0 it looks down -Z. So every
    // yaw that comes out of world/ is turned by half a turn on the way in. Miss this and
    // the boy spawns with his nose against the back wall while the ocean is behind him.
    const camYaw = y => (y == null ? Math.PI : y + Math.PI);

    P.pos.set(sp.x, sp.y, sp.z);
    P.yaw = P.yawSmooth = camYaw(sp.yaw);

    // ---- geometry -----------------------------------------------------------
    if (!stands) buildFallbackDescent(root, colliders, floors, suppress);
    buildArmorFigures(root, cases, stands);
    // Where the ritual happens. world/ built a pad in the workshop floor; the gantry
    // rises around wherever the boy is standing, so he has to be standing on it.
    if (gantryPoint) {
      for (const c of cases) {
        c.gantry = { x: gantryPoint.x, z: gantryPoint.z };
        // Face the rack from the pad, so the case he just chose is in shot behind the
        // arms as they come up.
        const dx = c.pos.x - gantryPoint.x, dz = c.pos.z - gantryPoint.z;
        c.padYaw = Math.atan2(-dx, -dz);
      }
    }

    // ---- public API ---------------------------------------------------------
    const api = {
      player: P,
      position: P.pos,
      velocity: P.vel,
      eyeHeight: () => THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, P.crouchAmt),
      cases,
      active: true,
      // flight/cameraRig.js drops a third-person camera onto the player every step
      // unless this flag is up. On foot the camera is FIRST person and it is ours; the
      // moment the suit takes over, cameraRig owns it again. Missing this flag looked
      // exactly like a broken level: the view drifted four metres behind the boy and
      // every wall he was standing in front of filled the screen.
      ownsCamera: true,
      get yaw() { return P.yaw; },
      get pitch() { return P.pitch; },
      // world/ hooks. Push an AABB or a floor plate and the boy respects it at once.
      addCollider(min, max) { colliders.push({ min: min.clone(), max: max.clone() }); },
      addFloor(x0, z0, x1, z1, y) { floors.push({ x0, z0, x1, z1, y }); },
      suppressWorldFloor(x0, z0, x1, z1) { suppress.push({ x0, z0, x1, z1 }); },
      teleport(x, y, z, yaw) {
        P.pos.set(x, y, z); P.vel.set(0, 0, 0);
        if (yaw != null) P.yaw = P.yawSmooth = yaw;
        P.landDip = P.landVel = 0; P.grounded = true;
        ctx.env.mix(envMixAt(P.pos));
      },
      // Everything a critic (or a bug) needs to see, without reaching into closures.
      status() {
        return {
          pos: [P.pos.x, P.pos.y, P.pos.z],
          yaw: P.yaw, pitch: P.pitch,
          speed: P.speed, grounded: P.grounded, crouch: P.crouchAmt,
          envMix: envMixAt(P.pos),
          hold, holdTarget: holdTarget && holdTarget.id,
          near: (pickCase(cases, P.pos, ctx.camera) || {}).id || null,
          chosen: chosen && chosen.id, approach,
          interact: !!(ctx.input && ctx.input.action('interact')),
          active: api.active, ownsCamera: api.ownsCamera, mode: ctx.state.mode,
        };
      },

      // MZ.goto(where). The names a critic actually wants: the four beats of the walk,
      // plus any armor id, plus anything world/ named in ctx.world.spawns.
      goto(where) {
        const c = cases.find(c => c.id === where || c.id === String(where).replace('case:', ''));
        if (c) { api.teleport(c.pos.x, c.pos.y, c.pos.z, c.faceYaw); return; }
        if ((where === 'bay' || where === 'hall') && cases.length) {
          const mid = cases[Math.floor(cases.length / 2)];
          api.teleport(mid.pos.x + 2.2, mid.pos.y, mid.pos.z, mid.faceYaw);
          return;
        }
        if (where === 'gantry' && gantryPoint) {
          api.teleport(gantryPoint.x, gantryPoint.y, gantryPoint.z, Math.PI); return;
        }
        if (where === 'stairs') {
          const t = W && W.malibu && W.malibu.stairTop;
          // stand back from the mouth of the stair and look down it
          if (t) { api.teleport(t.x + 2.4, t.y, t.z + 2.4, Math.PI / 4); return; }
          api.teleport(7.8, SHAFT.topY, 4.0, Math.PI); return;
        }
        // 'living', 'spawn' and 'opening' all mean THE OPENING SHOT — the composed
        // stand, not world/'s proposal. A critic asking to see where the game starts
        // must be shown where the game actually starts.
        if (where === 'living' || where === 'spawn' || where === 'opening') {
          api.teleport(spawnPoint.x, spawnPoint.y, spawnPoint.z, spawnHeading());
          P.pitch = P.pitchSmooth = spawnPoint.pitch || 0;
          return;
        }
        // 'workshop' means THE ARRIVAL FRAME — the composed one, not world/'s
        // proposal, for the same reason 'living' means the composed opening: a critic
        // asking to see where the descent lands must be shown where it actually lands.
        if (where === 'workshop') {
          const a = getArrival();
          if (a) {
            api.teleport(a.x, a.y, a.z, a.yaw);
            P.pitch = P.pitchSmooth = a.pitch;
            ctx.env.set('workshop', 0);
            return;
          }
        }
        const sn = spawns && spawns[where];
        if (sn) { api.teleport(sn.x, sn.y, sn.z, camYaw(sn.yaw)); return; }
        // no world at all: the fallback rooms
        if (where === 'workshop') { api.teleport(7.8, BAY.floorY, -5.6, Math.PI); return; }
        api.teleport(spawnPoint.x, spawnPoint.y, spawnPoint.z, spawnHeading());
      },
    };
    ctx.player = api;
    ctx.onfoot = api;

    // ---- interaction state --------------------------------------------------
    let hold = 0, holdTarget = null, chosen = null, approach = -1;
    let doffGrace = 0;      // seconds before a just-doffed armour may be stepped back into
    // The scripted walk onto the gantry pad: the planned route, which waypoint he is
    // heading for, and how long he has been going nowhere. See the `scripted` block below.
    let approachPath = null, approachIdx = 0, approachStall = 0, approachSide = 0;
    let rackLit = true;   // the case lights start in the graph; the first step takes them out
    let suitupWatch = -1, sawSuitup = false, saidDescend = false, saidWorkshop = false;
    ctx.bus.on('suitup:start', () => { sawSuitup = true; });
    ctx.bus.on('suitup:done', () => { sawSuitup = true; });

    // Debug: MZ.wear() puts you in the suit with no ritual. suit/ owns the model; this
    // side owns leaving on-foot mode and remembering which one you took.
    ctx.bus.on('debug:wear', id => {
      if (!id) return;
      /* NOT `ctx.state.armor = id`. That is suit/'s to write, and it writes it when the
       * model has actually landed — this handler runs the instant the event is emitted,
       * eight megabytes before there is any armour.
       *
       * Two owners writing the same field at two different times desynchronised it: a
       * regression run that wore all five Marks and then explicitly wore the Mk III ended
       * up with `state.armor = 'mk50'` and `suit.rig.id = 'mk3'`. That is not cosmetic —
       * the parked-shell prompt reads the wrong name, re-entering restores the wrong id,
       * and flight/ picks its thrust, mass and top speed from ARMOR_SPECS by that id, so
       * a Mk III would have been flying on the Mk L's numbers.
       *
       * The rest of this handler is genuinely onfoot's business: stop walking, give up the
       * camera, take the prompt down. */
      ctx.state.mode = 'flight'; ctx.state.suitClosed = true;
      api.active = false; api.ownsCamera = false; chosen = id; approach = -1;
      if (ctx.ui) ctx.ui.prompt(null);
    });
    ctx.bus.on('debug:suitup', () => { api.active = false; approach = -1; });

    // Coming back out of an armour. suitup/ runs the doff and hands the player back here;
    // without this the boy is standing in his living room with the controls dead.
    ctx.bus.on('suitup:doffed', () => {
      /* A moment during which the armour you just stepped out of cannot be stepped back
       * into. Belt and braces alongside the longer stride out: X is pressed with a hand that
       * is often already resting on F, and re-donning on the same gesture that removed the
       * suit makes the whole mechanism look broken. */
      doffGrace = 1.0;
      api.active = true;
      chosen = null; hold = 0; holdTarget = null; approach = -1;
      sawSuitup = false; suitupWatch = -1;
      const s = ctx.suit;
      if (s && s.showBody) s.showBody(true);
      if (ctx.flight && ctx.flight.model) {
        /* A STEP OUT, not a teleport into the same spot.
         * Standing him exactly where the armour is puts the boy and the empty suit in the
         * same cubic metre: the first thing you see after taking it off is the inside of
         * its chest. A stride forward of the armour's own facing, turned back to look at
         * it, reads as stepping out of the thing and leaves it in frame — which matters
         * now that it stays standing there waiting to be walked back into.
         */
        const m = ctx.flight.model;
        const yaw = (ctx.suit && ctx.suit.root) ? ctx.suit.root.rotation.y : 0;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);      // the armour faces -Z locally
        /* FAR ENOUGH OUT TO ACTUALLY BE OUT.
         *
         * This was 1.25 m while the re-entry radius further down is 2.4 m, so the instant
         * you took an armour off you were still standing "at" it: the step-back-in prompt
         * was already up and an F held from anything else put the suit straight back on.
         * Three metres clears it, so getting back in is a decision you walk into. */
        P.pos.set(m.position.x + fx * 3.0, m.position.y - 1.0, m.position.z + fz * 3.0);
        P.vel.set(0, 0, 0);
        // Turn round and look at what you just climbed out of.
        P.yaw = P.yawSmooth = yaw + Math.PI;
        P.pitch = P.pitchSmooth = 0;
      }
    });
    ctx.bus.on('restart', () => {
      chosen = null; hold = 0; holdTarget = null; approach = -1;
      approachPath = null; approachIdx = 0; approachStall = 0; approachSide = 0;
      api.active = true; sawSuitup = false; suitupWatch = -1;
      saidDescend = false; saidWorkshop = false;
      api.teleport(spawnPoint.x, spawnPoint.y, spawnPoint.z, spawnHeading());
      P.pitch = P.pitchSmooth = spawnPoint.pitch || 0;
      // Recompose: the house may have lost a wall to the repulsors since the last time,
      // and the opening shot is worth being right twice.
      if (api.compose) { try { api.compose(); } catch (e) { /* keep the old stand */ } }
      ctx.env.set('exterior', 0.5);
    });

    ctx.bus.on('ready', () => {
      // If suit/ can hand us real display models, swap them into the cases.
      if (ctx.suit && typeof ctx.suit.displayModel === 'function') {
        for (const c of cases) {
          try {
            const m = ctx.suit.displayModel(c.id);
            if (m) {
              c.figure.visible = false;
              m.position.copy(c.figure.position);
              m.rotation.copy(c.figure.rotation);
              c.group.add(m); c.real = m;
            }
          } catch (e) { /* the placeholder silhouette stays; not fatal */ }
        }
      }
      /* If it cannot, load the armour .glb files straight through the asset cache and
       * put the REAL suits in the cases. The critique of the hall was that the figures
       * behind the glass were "a capsule-limbed blob", and no amount of lighting fixes
       * that — the reference frame is legible as three specific Marks at six metres.
       * This is an asset load, not a module call: no import of suit/, and the cache is
       * the same one suit/ uses, so a suit the player later equips is already resident.
       * Deliberately AFTER 'ready' and deliberately not awaited by anything: the game is
       * fully playable with the silhouettes standing in, and each case upgrades itself
       * the moment its file arrives. */
      upgradeCaseFigures(ctx, cases).then(r => {
        api.caseModels = r;
        console.log('[onfoot] case models', JSON.stringify(r));
      });
      // The house is only now real to the physics engine, so this is the first moment
      // the opening shot can be composed against it.
      if (ctx.state.mode === 'onfoot' && api.active) {
        try { api.compose(); } catch (e) { console.warn('[onfoot] opening shot', e); }
      }
      if (ctx.ui) {
        ctx.ui.say('GOOD MORNING. THE HOUSE IS YOURS, SIR.');
        setTimeout(() => ctx.ui && ctx.ui.say('THE WORKSHOP IS DOWN THE STAIRS.'), 4600);
      }
    });

    // ---- the step -----------------------------------------------------------
    this._step = (dt) => {
      const input = ctx.input;
      const st = ctx.state;
      const onFoot = st.mode === 'onfoot' && api.active;
      // Give the camera up when the player asks for third person: the pedestrian camera
      // is first-person only, so while it owns the camera V appeared to do nothing on
      // foot. cameraRig's followOnFoot does the chase shot, but only if it is allowed to.
      api.ownsCamera = onFoot && !ctx.camOverride && ctx.state.view !== 'third';

      /* THE BOY HAS TO EXIST TO BE LOOKED AT.
       * Third person on foot pointed a chase camera at a player who is not modelled at
       * all in first person: suit/ keeps the pilot body hidden except during a suit-up,
       * so V on foot gave a camera orbiting thin air. It follows the stance already
       * (suit.followPlayer), so all that is missing is showing it — and hiding it again
       * the moment the view goes back inside his own head, or you would be looking at the
       * inside of your own skull. Never touched while a suit-up is running: suitup/ owns
       * which parts of him are visible for the length of that ritual. */
      /* THE AVATAR. He is `models/pilot.glb`, already loaded and already standing exactly
       * where the player is (suit/ keeps him at the stance so the armour can close around
       * him) — he was simply never shown outside a suit-up. Third person on foot pointed a
       * chase camera at nobody. */
      const wantBoy = onFoot && !st.armor && st.view === 'third';
      /* Compare against what is ACTUALLY on screen, not against a flag we set last time.
       *
       * This used to latch on `api._boyShown`, so it only ever acted when its own idea of
       * the state changed. Anything else that hid the boy — unequip() does, and so does the
       * end of a suit-up — left this module believing he was still shown, and it never
       * asked again. The avatar stayed switched off with nothing reporting anything wrong.
       * `bodyVisible` is the truth; ask it. */
      if (ctx.suit && ctx.suit.showBody && !(ctx.suitup && ctx.suitup.playing) &&
          !(ctx.suit.parked) && wantBoy !== ctx.suit.bodyVisible) {
        api._boyShown = wantBoy;
        ctx.suit.showBody(wantBoy);
      }
      /* AND HE HAS TO BE WHERE THE PLAYER IS.
       *
       * The boy lives inside the suit group, because normally an armour is closing around
       * him. `followPlayer` is what walks that group to the player's stance, and it gets
       * switched OFF whenever an armour is left standing somewhere (a doff parks it; the
       * menu's attract flies it). With no armour on and none parked, there is nothing in
       * that group but the avatar, so it must track the player again — otherwise he is
       * loaded, flagged visible, and standing wherever the group was abandoned. Measured:
       * bodyVisible true, and zero visible meshes within three metres of the player. */
      if (ctx.suit && wantBoy && !ctx.suit.parked && !ctx.suit.rig && !ctx.suit.followPlayer) {
        ctx.suit.followPlayer = true;
      }
      if (!api.active || (st.mode !== 'onfoot' && approach < 0)) {
        if (ctx.ui && st.mode !== 'onfoot') ctx.ui.prompt(null);
        // The environment mix is measured off the BOY's feet further down this function,
        // and this early return is where the boy stops existing. Nothing else in the game
        // drives ctx.env, so the moment he suited up the workshop's night lighting froze
        // on and stayed on: measured env.current 'workshop', k = 1, while the suit hovered
        // in daylight over the cliff, which is why every take-off frame came back black.
        // Same rule, same function, applied to the suit instead of the feet.
        if (st.mode === 'flight') envFollow(ctx.flight && ctx.flight.position, dt);
        return;
      }

      // ------------- look ----------------------------------------------------
      if (input && input.locked && !st.paused) {
        const m = input.consumeMouse();
        P.yaw -= m.x * LOOK_SENS;
        P.pitch = clamp(P.pitch - m.y * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
      }
      if (doffGrace > 0) doffGrace -= dt;
      P.yawSmooth = damp(P.yawSmooth, P.yaw, LOOK_SMOOTH, dt);
      P.pitchSmooth = damp(P.pitchSmooth, P.pitch, LOOK_SMOOTH, dt);

      // ------------- wish direction -----------------------------------------
      let fwd = 0, side = 0, wantRun = false, wantJump = false;
      const scripted = approach >= 0;
      if (input && !st.paused && !scripted) {
        fwd = input.axis('forward', 'back');
        side = input.axis('right', 'left');
        wantRun = input.action('run');
        wantJump = input.action('jump');
        P.crouch = input.action('crouch');
      } else {
        P.crouch = false;
      }
      P.crouchAmt = damp(P.crouchAmt, P.crouch && P.grounded ? 1 : 0, 12, dt);

      const maxSpeed = P.crouch ? CROUCH_SPEED : (wantRun ? RUN : WALK);
      const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
      // forward = -Z at yaw 0, the three.js camera convention
      const wish = new THREE.Vector3(-sy * fwd + cy * side, 0, -cy * fwd - sy * side);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(maxSpeed);

      // The scripted walk onto the gantry pad. Same physics, no input: he really walks
      // there, decelerating into the mark, rather than being teleported.
      if (scripted && chosen) {
        approach += dt;
        const g = chosen.gantry;

        /* A ROUTE, NOT A BEELINE.
         * He starts in front of the case row; the pad is 19 m away across a floor that
         * world/ fills with benches and dress.js fills with tool chests, crates, drums
         * and a car. A straight line from the Mk I case walks him into the corner of a
         * chest at (-12.2, 8.9), and the wall-slide gives him nothing back because the
         * wish keeps pointing into the box — measured at 9.5 s of grinding on the spot
         * before APPROACH_TIMEOUT gave up and teleported him onto the mark. Nine and a
         * half seconds of standing still in a dark room is the beat this room exists for.
         * planApproach() finds the way through (it is there: out along z ≈ 2.5 to the
         * pad's column, then straight up it) and he walks it. */
        let tx = g.x, tz = g.z;
        if (approachPath && approachIdx < approachPath.length) {
          const w = approachPath[approachIdx];
          if (Math.hypot(w.x - P.pos.x, w.z - P.pos.z) < 0.6) approachIdx++;
          const w2 = approachPath[Math.min(approachIdx, approachPath.length - 1)];
          tx = w2.x; tz = w2.z;
        }
        const dx = tx - P.pos.x, dz = tz - P.pos.z;
        const d = Math.hypot(dx, dz);
        const want = Math.min(APPROACH_SPEED, d * 1.8);
        if (d > 1e-3) { wish.set(dx / d * want, 0, dz / d * want); }

        /* Belt and braces. The dressing is seeded, world/ can move the room, and a
         * scripted walk that can be stopped dead by one crate is a beat that fails
         * silently. If he has been going nowhere for most of a second, fan the wish
         * sideways so the slide has something to slide ALONG. */
        if (Math.hypot(P.vel.x, P.vel.z) < 0.45) approachStall += dt;
        else approachStall = Math.max(0, approachStall - dt * 3);
        if (approachStall > 0.55) {
          if (!approachSide) approachSide = (P.pos.x < g.x) === (P.pos.z < g.z) ? 1 : -1;
          const a = approachSide * 1.05;                 // ~60 degrees off the blocked line
          const cs = Math.cos(a), sn = Math.sin(a);
          const wx = wish.x * cs - wish.z * sn, wz = wish.x * sn + wish.z * cs;
          wish.set(wx, 0, wz);
          if (approachStall > 2.2) { approachStall = 0; approachSide = 0; }
        }

        // turn to face the rack while he walks onto the pad
        const faceYaw = chosen.padYaw != null ? chosen.padYaw : chosen.faceYaw;
        let dy = ((faceYaw - P.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        P.yaw += dy * (1 - Math.exp(-3.2 * dt));
        P.pitch = damp(P.pitch, 0, 2.4, dt);
        // Arrival is judged against the PAD, never against the current leg's waypoint.
        const dPad = Math.hypot(g.x - P.pos.x, g.z - P.pos.z);
        if ((dPad < 0.22 && Math.hypot(P.vel.x, P.vel.z) < 0.5) || approach > APPROACH_TIMEOUT) {
          P.pos.x = g.x; P.pos.z = g.z; P.vel.set(0, 0, 0);
          approach = -1;
          startSuitup(chosen);
        }
      }

      // ------------- the acceleration curve ----------------------------------
      // Bounded acceleration toward the wish velocity. This is what makes the start of
      // a walk take ~0.25 s and a change of direction cost you momentum. A lerp would
      // make both instant at speed and mushy at rest, which is the arcade feel.
      const moving = wish.lengthSq() > 1e-6;
      const a = P.grounded ? (moving ? (wantRun ? ACCEL_RUN : ACCEL) : BRAKE) : AIR_ACCEL;
      const dvx = wish.x - P.vel.x, dvz = wish.z - P.vel.z;
      const dvLen = Math.hypot(dvx, dvz);
      if (dvLen > 1e-6) {
        const stepAmt = Math.min(a * dt, dvLen);
        P.vel.x += dvx / dvLen * stepAmt;
        P.vel.z += dvz / dvLen * stepAmt;
      }

      if (wantJump && P.grounded && !P.crouch) { P.vel.y = JUMP; P.grounded = false; }
      P.vel.y -= GRAVITY * dt;

      // ------------- move horizontally, sliding along walls -------------------
      const h = bodyHeight(P);
      moveHorizontal(ctx, P, colliders, h, dt);

      // ------------- floor ---------------------------------------------------
      const wasGrounded = P.grounded;
      P.pos.y += P.vel.y * dt;
      const floor = floorAt(ctx, P.pos.x, P.pos.z, P.pos.y, floors, suppress);
      if (P.pos.y <= floor + 1e-4) {
        if (!P.grounded && P.vel.y < -1.6) {
          // Landing. Dip the camera by the impact and let a spring push it back.
          P.landVel -= clamp(-P.vel.y * 0.030, 0, 0.20);
          ctx.bus.emit('impact', { force: -P.vel.y, source: 'feet' });
        }
        P.pos.y = floor; P.vel.y = 0; P.grounded = true;
      } else if (wasGrounded && P.vel.y <= 0 && P.pos.y - floor < SNAP_DOWN) {
        // Walking down a staircase: pull him onto the next tread instead of letting him
        // launch off every nosing. Without this a descent is a series of little jumps.
        P.pos.y = floor; P.vel.y = 0; P.grounded = true;
      } else {
        P.grounded = false;
      }

      // Ceilings: stop a jump dead rather than letting him pass through a slab.
      const ceil = ceilingAt(ctx, P.pos, h, colliders);
      if (ceil != null && P.pos.y + h > ceil) {
        P.pos.y = Math.max(floor, ceil - h);
        if (P.vel.y > 0) P.vel.y = 0;
      }

      // ------------- head bob, timed off the feet ----------------------------
      const hs = Math.hypot(P.vel.x, P.vel.z);
      P.speed = hs;
      if (P.grounded && hs > 0.15) {
        P.stride += (hs * dt) / STRIDE * Math.PI;   // PI radians == one footfall
        const idx = Math.floor(P.stride / Math.PI);
        if (idx !== P.stepIndex) {
          P.stepIndex = idx;
          ctx.bus.emit('footstep', { speed: hs, crouch: P.crouch, run: wantRun,
                                     indoors: ctx.env ? ctx.env.k : 0 });
        }
      } else {
        // Settle the phase back to a footfall so the next step starts on the beat.
        P.stride = damp(P.stride, Math.round(P.stride / Math.PI) * Math.PI, 8, dt);
      }
      const amt = clamp(hs / WALK, 0, 1.35) * (1 - 0.45 * P.crouchAmt);
      P.bobY = damp(P.bobY, BOB_Y * amt * Math.cos(2 * P.stride), 20, dt);
      P.bobX = damp(P.bobX, BOB_X * amt * Math.sin(P.stride), 20, dt);
      P.roll = damp(P.roll, BOB_ROLL * amt * Math.sin(P.stride), 14, dt);

      // Idle breathing so a standing player is never a frozen tripod.
      P.breathe += dt * 1.7;
      const idle = (1 - clamp(hs / 0.6, 0, 1)) * 0.0055 * Math.sin(P.breathe);

      // Landing spring: stiff, heavily damped, one bounce and done.
      P.landVel += (-P.landDip * 190 - P.landVel * 22) * dt;
      P.landDip += P.landVel * dt;

      // ------------- camera --------------------------------------------------
      // Third person on foot is cameraRig's job, not this module's. Driving the camera
      // here regardless of the view setting is why V did nothing while walking: the eye
      // was re-planted on the player's head every single tick.
      if (!ctx.camOverride && ctx.state.mode === 'onfoot' && ctx.state.view !== 'third') {
        const cam = ctx.camera;
        const eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, P.crouchAmt);
        cam.position.set(
          P.pos.x + P.bobX * Math.cos(P.yawSmooth),
          P.pos.y + eye + P.bobY + P.landDip + idle,
          P.pos.z - P.bobX * Math.sin(P.yawSmooth)
        );
        cam.rotation.set(P.pitchSmooth, P.yawSmooth, P.roll, 'YXZ');
        if (cam.fov !== 68) { cam.fov = 68; cam.updateProjectionMatrix(); }
      }

      // ------------- the descent: light follows his feet ---------------------
      const k = envFollow(P.pos, dt);
      // The rack only glows once you are actually down there; up in the daylight the
      // cases are dark shapes seen through the stairwell.
      // Ten point lights — two per case — that nobody can see for the whole first
      // minute of the game. Every one of them is a loop iteration in the fragment
      // shader of every surface in Malibu, so the rack's lighting is not in the scene
      // graph at all until the player is on his way down. Hysteresis on the threshold
      // keeps a boy standing on the top step from thrashing shader recompiles.
      const wantRack = k > (rackLit ? 0.015 : 0.05);
      if (wantRack !== rackLit) {
        rackLit = wantRack;
        for (const c of cases) {
          if (wantRack) c.group.add(c.light, c.rim);
          else c.group.remove(c.light, c.rim);
        }
      }
      if (rackLit) {
        for (const c of cases) {
          c.light.intensity = c.baseIntensity * (0.2 + 0.8 * k);
          c.rim.intensity = c.baseRim * (0.2 + 0.8 * k);
        }
      }
      if (ctx.ui) {
        if (!saidDescend && k > 0.18 && k < 0.9) { saidDescend = true; ctx.ui.say('LIGHTS, SIR.'); }
        if (!saidWorkshop && k > 0.96) {
          saidWorkshop = true;
          ctx.ui.say('WORKSHOP ONLINE. FIVE MARKS ON THE RACK.');
        }
      }

      /* ------------- the tablet -------------------------------------------
       * Same hold-F as a display case, but it opens the picker instead of choosing the
       * one suit you happen to be standing at. Picking from it runs the ordinary
       * selection flow — walk to the pad, gantry, suit-up — so there is one code path
       * for "which armour" no matter how you asked. */
      const tablet = ctx.world && ctx.world.tabletAt;
      if (tablet && !chosen && !(ctx.ui && ctx.ui.pickerOpen)) {
        const dt2 = Math.hypot(P.pos.x - tablet.x, P.pos.z - tablet.z);
        if (dt2 < 2.2 && Math.abs(P.pos.y - tablet.y) < 2.6) {
          const holding = input && input.action('interact') && !st.paused;
          if (holding) {
            hold = Math.min(HOLD_TIME, hold + dt);
            if (hold >= HOLD_TIME) {
              hold = 0;
              if (ctx.ui) {
                ctx.ui.prompt(null);
                if (ctx.input && ctx.input.releaseLock) ctx.input.releaseLock(0);
                ctx.ui.picker(ARMORS.map(a => ({
                  id: a.id, name: a.name, sub: a.sub,
                  tint: ('000000' + a.tint.toString(16)).slice(-6),
                })), (id) => {
                  if (ctx.input && ctx.input.requestLock) ctx.input.requestLock();
                  /* THE TABLET ONLY CHOOSES. It used to walk you to the pad itself, which
                   * is the game deciding when you are ready. Jurek's rule for the new ring
                   * is "you step on when YOU want to", so picking here arms the ring and
                   * nothing else happens until you walk onto it. */
                  api.pending = id;
                  /* START THE DOWNLOAD NOW, WHILE HE WALKS.
                   *
                   * The armour GLB is several megabytes and used to be fetched, parsed and
                   * indexed by `equip()` at the moment the player stepped onto the ring —
                   * so the ritual began with a multi-second freeze, every time. Jurek: "jak
                   * już wybrałem strój i podchodzę do tej platformy, to mi laguje".
                   *
                   * ctx.assets.loadModel caches the parsed glTF, so this is not a second
                   * load: it is the SAME load, moved to the moment of choosing. The walk
                   * from the tablet to the ring is several seconds of cover for it, and
                   * equip() then only has to clone. Fire and forget — a failure here is
                   * simply the old behaviour, and equip() reports it properly. */
                  if (ctx.assets && ctx.assets.loadModel) {
                    ctx.assets.loadModel('models/' + id + '.glb').catch(() => {});
                  }
                  if (ctx.ui) ctx.ui.say((ARMORS.find(a => a.id === id) || {}).name +
                                         ' READY. STEP ONTO THE RING.');
                });
              }
              return;
            }
          } else hold = Math.max(0, hold - dt * 2.2);
          if (ctx.ui) {
            ctx.ui.prompt({ name: 'ARMOUR TABLET', sub: 'SELECT A MARK', key: 'F',
                            progress: hold / HOLD_TIME });
          }
          return;
        }
      }

      /* ------------- the ring -------------------------------------------
       * Armed by the tablet, fired by your own feet. Nothing here decides when. */
      const wring = ctx.world && ctx.world.ring;
      if (api.pending && wring && wring.contains(P.pos.x, P.pos.z) && !chosen) {
        const id = api.pending;
        api.pending = null;
        st.armor = id;
        chosen = { id };
        startSuitup({ id });
        return;
      }
      if (ctx.ui && api.pending && wring && !chosen) {
        const d = Math.hypot(P.pos.x - 0, P.pos.z - 0);
        if (d < 14) ctx.ui.prompt({ name: 'THE RING', sub: 'STEP ON TO SUIT UP', key: '', progress: 0 });
      }

      // ------------- step back into a parked suit ---------------------------
      // An armour you climbed out of stands where you left it (suit/suitup.js). It is not
      // one of the display cases, so pickCase never sees it; it gets its own prompt.
      const parked = ctx.suit && ctx.suit.parked;
      const parkedNear = parked &&
        Math.hypot(P.pos.x - parked.pos.x, P.pos.z - parked.pos.z) < 2.4 &&
        Math.abs(P.pos.y - parked.pos.y) < 2.6;
      // ONLY while standing at it. Taking the branch whenever a shell existed anywhere in
      // the world swallowed the display cases' own prompt, so after stepping out of a Mk
      // III you could get back into that one and never pick a different armour — which is
      // the exact thing taking it off was for.
      if (parkedNear && !chosen && doffGrace <= 0) {
        const inRange = true;
        const holding = input && input.action('interact') && !st.paused;
        if (inRange && holding) {
          hold = Math.min(HOLD_TIME, hold + dt);
          if (hold >= HOLD_TIME) {
            hold = 0;
            api.active = false;
            api.ownsCamera = false;
            if (ctx.ui) ctx.ui.prompt(null);
            ctx.bus.emit('suit:reenter');
            return;
          }
        } else if (!inRange) hold = 0;
        else hold = Math.max(0, hold - dt * 2.2);
        if (ctx.ui) {
          ctx.ui.prompt(inRange
            ? { name: parked.name, sub: 'STEP BACK IN', key: 'F', progress: hold / HOLD_TIME }
            : null);
        }
        return;
      }

      // ------------- armor selection ----------------------------------------
      if (!chosen) {
        const near = pickCase(cases, P.pos, ctx.camera);
        const holding = input && input.action('interact') && !st.paused;
        if (near && holding) {
          if (holdTarget !== near) { holdTarget = near; hold = 0; }
          hold = Math.min(HOLD_TIME, hold + dt);
          if (hold >= HOLD_TIME) {
            chosen = near;
            st.armor = near.id;
            if (ctx.ui) {
              ctx.ui.prompt(null);
              ctx.ui.say(near.name + ' SELECTED.');
            }
            if (near.gantry) {
              approach = 0;                 // walk him onto the pad first
              approachStall = 0; approachSide = 0; approachIdx = 0;
              approachPath = planApproach(P.pos, near.gantry);
              if (ctx.ui) ctx.ui.say('STEP ONTO THE PLATFORM, SIR.');
            } else {
              startSuitup(near);
            }
          }
        } else {
          hold = Math.max(0, hold - dt * 2.2);
          if (hold === 0) holdTarget = null;
        }
        // `chosen` may have been set three lines up, in which case the prompt has
        // already been taken down on purpose — do not put a full ring back on screen
        // and leave it there for the whole walk to the platform.
        if (ctx.ui && !chosen) {
          if (near) ctx.ui.prompt({ name: near.name, sub: near.sub, key: 'F',
                                    progress: (holdTarget === near ? hold : 0) / HOLD_TIME });
          else ctx.ui.prompt(null);
        }
      }
    };

    function startSuitup(c) {
      // suit/ holds exactly one rig, so a new armour replaces whatever shell was standing
      // in the world. Clear the marker with it or the prompt outlives the suit it names.
      if (ctx.suit) ctx.suit.parked = null;
      ctx.state.mode = 'suitup';
      api.active = false;
      api.ownsCamera = false;   // hand the camera to cameraRig for the ritual
      suitupWatch = 0;
      if (ctx.ui) ctx.ui.prompt(null);
      ctx.bus.emit('armor:selected', c.id);
    }

    // Watchdog: if nothing picks up 'armor:selected' — suit/ still a stub — hand control
    // back rather than leaving the player frozen in a dark room.
    this._watch = (dt) => {
      if (suitupWatch < 0) return;
      suitupWatch += dt;
      if (sawSuitup || ctx.state.mode === 'flight') { suitupWatch = -1; return; }
      if (suitupWatch > 1.6) {
        suitupWatch = -1; chosen = null; hold = 0; holdTarget = null;
        ctx.state.mode = 'onfoot'; api.active = true;
        if (ctx.ui) ctx.ui.say('SUIT-UP SEQUENCE OFFLINE. STANDING BY.');
      }
    };

    /* ---- planApproach: the way from here to the gantry pad -----------------------
     * A breadth-first search on a half-metre grid whose edges are tested with the SAME
     * sweep the walk itself uses, so the route it returns is one the mover can actually
     * follow — through world/'s benches and dress.js's crates, both of which are placed
     * by other code that knows nothing about this walk. Returns an array of waypoints
     * (string-pulled, so it is usually three or four corners, not sixty cells) or null if
     * there is genuinely no way through, in which case the caller falls back to the
     * beeline and the approach timeout.
     * Measured at 37 ms for the 19 m rack-to-pad route: one hitch, once, on the frame the
     * player commits to an armour, while the UI is putting up "STEP ONTO THE PLATFORM".
     */
    const _pp = { pos: new THREE.Vector3() };
    const _pdir = new THREE.Vector3();
    function planApproach(from, to) {
      if (!to) return null;
      const S = 0.5, PAD = 5;
      const X0 = Math.min(from.x, to.x) - PAD, X1 = Math.max(from.x, to.x) + PAD;
      const Z0 = Math.min(from.z, to.z) - PAD, Z1 = Math.max(from.z, to.z) + PAD;
      const nx = Math.round((X1 - X0) / S) + 1, nz = Math.round((Z1 - Z0) / S) + 1;
      if (nx < 2 || nz < 2 || nx * nz > 16000) return null;
      const y = from.y, h = HEIGHT_STAND;

      // `first` forgives a zero-distance hit out of the start cell: he stands 2.9 m off a
      // case whose frame his own body radius already overlaps, and the mover nudges out of
      // that every tick. Without the exception the search never leaves the first cell.
      const walkable = (cx, cz, dx, dz, first) => {
        const len = Math.hypot(dx, dz);
        _pdir.set(dx / len, 0, dz / len);
        _pp.pos.set(cx, y, cz);
        const hit = sweep(ctx, _pp, _pdir, len, h);
        if (!hit) return true;
        return !!(first && hit.distance < 1e-3);
      };

      const key = (i, j) => i * nz + j;
      const si = Math.round((from.x - X0) / S), sj = Math.round((from.z - Z0) / S);
      const ti = Math.round((to.x - X0) / S), tj = Math.round((to.z - Z0) / S);
      const start = key(si, sj), goal = key(ti, tj);
      const prev = new Int32Array(nx * nz).fill(-1);
      prev[start] = start;
      const q = [start];
      let found = false;
      for (let head = 0; head < q.length && head < 20000; head++) {
        const c = q[head];
        if (c === goal) { found = true; break; }
        const ci = (c / nz) | 0, cj = c % nz;
        const cx = X0 + ci * S, cz = Z0 + cj * S;
        for (let d = 0; d < 4; d++) {
          const di = d === 0 ? 1 : d === 1 ? -1 : 0;
          const dj = d === 2 ? 1 : d === 3 ? -1 : 0;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const k = key(i, j);
          if (prev[k] !== -1) continue;
          if (!walkable(cx, cz, di * S, dj * S, c === start)) continue;
          prev[k] = c; q.push(k);
        }
      }
      if (!found) return null;

      const cells = [];
      for (let c = goal; ; c = prev[c]) {
        const ci = (c / nz) | 0, cj = c % nz;
        cells.push(new THREE.Vector3(X0 + ci * S, y, Z0 + cj * S));
        if (prev[c] === c) break;
      }
      cells.reverse();

      // String-pull: keep a cell only when the straight line from the last kept point can
      // no longer reach the next one. Sixty cells of stair-stepping becomes a handful of
      // corners, and he walks them as a walk rather than as a zigzag.
      const out = [];
      let anchor = cells[0];
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        const dx = c.x - anchor.x, dz = c.z - anchor.z;
        const len = Math.hypot(dx, dz);
        let clear = len < 1e-4;
        if (!clear) {
          _pdir.set(dx / len, 0, dz / len);
          _pp.pos.copy(anchor);
          const hit = sweep(ctx, _pp, _pdir, len, h);
          clear = !hit || hit.distance >= len - 1e-3;
        }
        if (!clear) { anchor = cells[i - 1]; out.push(anchor.clone()); }
      }
      out.push(new THREE.Vector3(to.x, y, to.z));
      return out;
    }

    /* Drive ctx.env from a point in the world, and hand back the mix that was applied.
     * Split out of the walk so the SUIT can be handed to it once the boy is inside the
     * armour — see the early return in _step(). Called with a null point (no flight
     * model yet) it does nothing rather than lighting Malibu from the origin. */
    function envFollow(pos, dt) {
      if (!pos || !ctx.env) return ctx.env ? ctx.env.target : 0;
      const k = envMixAt(pos);
      ctx.env.target = k;
      ctx.env.rate = 1 / 0.45;
      if (k > 0.92 && ctx.env.current !== 'workshop') ctx.env.set('workshop', 0.45);
      if (k < 0.08 && ctx.env.current !== 'exterior') ctx.env.set('exterior', 0.6);
      ctx.env.target = k;   // set() clamps to 0/1; the depth mix wins
      return k;
    }

    // 0 = Malibu midday, 1 = the basement. world/ can own this entirely by exposing
    // envMix(x, y, z); otherwise it is measured off the two floor levels world/ told us
    // about, and only counts while he is actually under the house footprint.
    function envMixAt(pos) {
      if (W && typeof W.envMix === 'function') {
        const v = W.envMix(pos.x, pos.y, pos.z);
        if (typeof v === 'number') return clamp(v, 0, 1);
      }
      if (stands) {
        // Inside the footprint the house plate is the surface, which is how we know he
        // is under the roof rather than out on the cliff.
        const surf = W && W.surfaceHeight ? W.surfaceHeight(pos.x, pos.z) : -Infinity;
        const under = surf >= MAIN_Y - 0.6;
        if (!under) return 0;
        return clamp((MAIN_Y - 0.35 - pos.y) / (MAIN_Y - 0.35 - (SHOP_Y + 1.1)), 0, 1);
      }
      const inShaft = pos.x > SHAFT.minX - 0.6 && pos.x < SHAFT.maxX + 0.6 &&
                      pos.z > SHAFT.botZ - 0.6 && pos.z < SHAFT.topZ + 0.9;
      const inBay = pos.x > BAY.minX - 0.6 && pos.x < BAY.maxX + 0.6 &&
                    pos.z > BAY.minZ - 0.6 && pos.z < BAY.maxZ + 0.6 && pos.y < 0.2;
      if (!inShaft && !inBay) return 0;
      return clamp((SHAFT.topY - pos.y) / (SHAFT.topY - (BAY.floorY + 1.0)), 0, 1);
    }
    this._envMixAt = envMixAt;

    // ------------------------------------------------------------------------
    // THE OPENING SHOT
    // ------------------------------------------------------------------------
    // The first frame of this game is the entire premise: a boy standing in Tony Stark's
    // living room with the Pacific right there through the glass. A spawn that is merely
    // LEGAL — on the floor, not inside a column — is not enough. The round before this
    // one opened on flat grey concrete because the authored spawn sat 70 cm on the inland
    // side of the curved board-formed feature wall, facing it, and every one of the four
    // cardinal headings from there was wall, ceiling wedge or floor.
    //
    // So the stand is COMPOSED, not asserted. We score candidate positions by what the
    // camera would actually SEE from them — a fan of rays through the house with glass
    // counted as a view rather than as an obstacle, because the whole seaward wall is
    // glass and a ray that stopped at the curtain wall would score the best shot in the
    // game as a 25 m dead end. The authored spawn is candidate zero and the tie-break;
    // if it wins, nothing moves and world/ keeps authorship.
    // ---- the visibility oracle ---------------------------------------------
    // Two implementations, chosen at run time by a calibration ray.
    //
    //   1. Rapier, if it answers. It is exact and it is the same surface the player
    //      will collide with.
    //   2. Otherwise an axis-aligned box set built from the house's own meshes. This
    //      exists because world/ does not hand its colliders to Rapier until the
    //      'ready' event and, in some boots, not even then — and a spawn chooser that
    //      silently scores every candidate identically is worse than no chooser, which
    //      is exactly the bug this replaced. Boxes are coarse (the drum becomes a
    //      square) but they cannot be empty, and for "is there a wall in front of my
    //      face" coarse is enough.
    let boxes = null;      // [{min:Vector3, max:Vector3, glass:bool, big:bool}]
    let plates = null;     // the storey slabs, as their REAL curved outlines
    const _bo = new THREE.Vector3(), _bd = new THREE.Vector3();

    /* Every floor and roof in this house is one continuous mesh with a hand-drawn
     * curved edge, and its bounding box is a rectangle that covers a great deal of open
     * air. Asking that box "is there a roof above me" answers yes while standing at the
     * glass line with nothing overhead — twice, in two different spots, that is exactly
     * how the opening shot came back as a balustrade over water. world/ leaves the real
     * outline on the mesh (slabMesh writes userData.outline), so the plates are kept
     * separately and answered exactly. */
    function pointInPoly(poly, x, z) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const zi = poly[i].y, zj = poly[j].y;
        if ((zi > z) !== (zj > z)) {
          const xi = poly[i].x + (z - zi) / (zj - zi) * (poly[j].x - poly[i].x);
          if (x < xi) inside = !inside;
        }
      }
      return inside;
    }

    /** Distance to the underside of the first plate a ray leaving (x,y,z) passes under. */
    function plateHit(x, y, z, dx, dy, dz, maxDist) {
      if (!plates || dy <= 1e-6) return maxDist;
      let best = maxDist;
      for (const p of plates) {
        if (p.bottom <= y + 0.01) continue;
        const t = (p.bottom - y) / dy;
        if (t <= 0 || t >= best) continue;
        if (pointInPoly(p.outline, x + dx * t, z + dz * t)) best = t;
      }
      return best;
    }

    function buildBoxes() {
      const out = [];
      plates = [];
      const roots = [];
      if (W && W.malibu && W.malibu.root) roots.push(W.malibu.root);
      if (W && W.malibu && W.malibu.interior) roots.push(W.malibu.interior);
      if (!roots.length && W && W.root) roots.push(W.root);
      const box = new THREE.Box3();
      // world/ publishes every pane it built. Identity beats guessing at a material
      // flag: whether the curtain wall counts as a view or as a wall is the single
      // decision this whole search turns on.
      const panes = new Set(Array.isArray(W && W.glassPanels) ? W.glassPanels : []);
      for (const r of roots) {
        r.updateWorldMatrix(true, true);
        r.traverse(o => {
          if (!o.isMesh || !o.geometry) return;
          // Only things world/ actually declared as collision. Handoff stamps
          // userData.worldSolid / userData.breakable on exactly those, which keeps the
          // decorative shells out — the dark cylinder lining the stairwell is a mesh
          // with no collider, and treating it as a wall would seal the stairs.
          if (!(o.userData.worldSolid || o.userData.breakable)) return;
          const m = o.material;
          const name = ((m && m.name) || '') + ' ' + (o.name || '');
          const glass = panes.has(o) ||
            !!(m && (m.transparent || m.transmission > 0 || /glass/i.test(name)));
          box.setFromObject(o);
          if (!isFinite(box.min.x) || box.isEmpty()) return;
          const size = box.getSize(new THREE.Vector3());
          // Filter on the LARGEST dimension, never on volume. world/ builds the workshop
          // floor, its walls and the living-room floor as PlaneGeometry — zero thickness,
          // zero volume — and a volume test throws away the floor of the room the whole
          // game ends up in. Only genuinely tiny things go.
          if (Math.max(size.x, size.y, size.z) < 0.12) return;
          // A storey slab is one mesh spanning the whole house, so its box has no hole
          // where the stair goes through it. Flagged, and ignored for the floor inside
          // the stairwell.
          const big = (size.x * size.z) > 250;
          const outline = o.userData.outline;
          if (outline && outline.length > 2 && size.y < 2.5 && big) {
            plates.push({ outline, bottom: box.min.y, top: box.max.y });
          }
          out.push({ min: box.min.clone(), max: box.max.clone(), glass, big });
        });
      }
      return out;
    }

    /* ── what is actually IN the room ──────────────────────────────────────────
     * The shot scorer above measures the SHAPE of a frame — how far the rays get, is
     * there a ceiling, how far off the glass you are. It cannot tell a furnished living
     * room from an empty slab of the same room, and on this plan that is the difference
     * between the reference plate and a car park: world/ put every sofa, the rug, the
     * dining table, the bookcase and the piano in the WESTERN half of the floor, and a
     * purely geometric search happily opened the game standing in the empty eastern half
     * with a beautiful, completely unfurnished view.
     *
     * So the room's contents are harvested too: every mesh at furniture scale, binned
     * into a 2.5 m grid so that a bookcase holding 230 individual book meshes counts as
     * one piece of furniture and not as two hundred. Weight is capped per cell for the
     * same reason. This is deliberately NOT the collision set — a sofa you can walk
     * through is still something to look at. */
    let propCells = null;
    function buildProps() {
      const cells = new Map();
      const roots = [];
      if (W && W.malibu && W.malibu.interior) roots.push(W.malibu.interior);
      if (W && W.malibu && W.malibu.root) roots.push(W.malibu.root);
      if (!roots.length && W && W.root) roots.push(W.root);
      const box = new THREE.Box3();
      const CELL = 2.5;
      const panes = new Set(Array.isArray(W && W.glassPanels) ? W.glassPanels : []);
      const levelY = MAIN_Y;
      for (const r of roots) {
        r.updateWorldMatrix(true, true);
        r.traverse(o => {
          if (!o.isMesh || !o.geometry || o.visible === false) return;
          box.setFromObject(o);
          if (!isFinite(box.min.x) || box.isEmpty()) return;
          const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
          const big = Math.max(sx, sy, sz);
          // Furniture scale. Below this it is a bolt head; above it, it is the building.
          if (big < 0.30 || big > 11) return;
          if (sx * sz > 120) return;                 // a floor plate, not a thing on it
          // NOT the curtain wall. Every pane and every mullion in this house passes the
          // size test above — a 5 x 4.3 m sheet of glass is "furniture scale" — and the
          // first version of this scored the glass wall as a room full of objects, which
          // is the exact opposite of the thing it was written to detect. Furniture SITS
          // ON THE FLOOR and is shorter than a person and a half.
          if (panes.has(o)) return;
          const mm = o.material;
          if (mm && (mm.transparent || mm.transmission > 0)) return;
          if (sy > 3.2) return;
          if (Math.min(sx, sz) < 0.12 && sy > 1.2) return;    // a post or a mullion
          if (box.min.y > levelY + 1.5 || box.min.y < levelY - 0.5) return;
          const y = (box.min.y + box.max.y) * 0.5;
          const x = (box.min.x + box.max.x) * 0.5, z = (box.min.z + box.max.z) * 0.5;
          const key = Math.round(x / CELL) + ',' + Math.round(y / CELL) + ',' + Math.round(z / CELL);
          let c = cells.get(key);
          if (!c) { c = { x, y, z, w: 0, n: 0 }; cells.set(key, c); }
          c.n++;
          // First mesh in a cell is worth the most; a cell saturates at ~1.6 so a wall
          // of books cannot outscore the ocean.
          c.w = Math.min(1.6, c.w + (c.n === 1 ? 1.0 : 0.14));
          c.top = Math.max(c.top || -Infinity, box.max.y);
        });
      }
      return [...cells.values()];
    }

    /* How much furniture is in a 68-degree frame from here, looking this way? Angular:
     * a chair two metres away fills more of the picture than a piano at twenty, and the
     * scorer should know that. Distance window 2.2–30 m — closer than that it is in your
     * face (the frame scorer already penalises that) and further it is scenery. */
    function propScore(x, y, z, yaw) {
      if (!propCells || !propCells.length) return 0;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let s = 0;
      for (const c of propCells) {
        if (c.y < y - 3.0 || c.y > y + 3.2) continue;       // another storey
        const dx = c.x - x, dz = c.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 2.2 || d > 30) continue;
        const dot = (dx * fx + dz * fz) / d;
        if (dot < 0.66) continue;                            // outside the frame
        s += c.w * (dot - 0.6) * Math.min(1, 9 / d);
      }
      return s;
    }

    /* The stairwell mouth in XZ. Inside it, the main floor slab is not a floor: the
     * stair goes through a hole the slab's bounding box knows nothing about, and both
     * ctx.world.surfaceHeight and the slab's own box would otherwise hold the boy up on
     * thin air at the top step and make the descent impossible. */
    let shaftRect = null;
    function shaftAt(x, z) {
      return !!shaftRect && x > shaftRect.x0 && x < shaftRect.x1 &&
                            z > shaftRect.z0 && z < shaftRect.z1;
    }

    /** Highest solid box top at or below `limit`. Metres, or -Infinity. */
    function boxFloorAt(x, z, limit) {
      if (!boxes) return -Infinity;
      const inShaft = shaftAt(x, z);
      let best = -Infinity;
      for (const b of boxes) {
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        if (inShaft && b.big && Math.abs(b.max.y - MAIN_Y) < 0.4) continue;
        if (b.max.y <= limit && b.max.y > best) best = b.max.y;
      }
      return best;
    }

    /** Nearest blocking box along `dir` from a point, expanded by the body radius. */
    function boxSweep(x, y, z, dx, dz, dist) {
      if (!boxes) return null;
      let best = dist, nx = 0, nz = 0;
      const ix = 1 / (dx || 1e-9), iz = 1 / (dz || 1e-9);
      for (const b of boxes) {
        // Broad phase: four comparisons that throw away ~99% of the house before any
        // arithmetic. This runs three times a step, 120 steps a second.
        if (x < b.min.x - RADIUS - dist || x > b.max.x + RADIUS + dist) continue;
        if (z < b.min.z - RADIUS - dist || z > b.max.z + RADIUS + dist) continue;
        if (y < b.min.y - 0.02 || y > b.max.y + 0.02) continue;   // not at this height
        let t0 = (b.min.x - RADIUS - x) * ix, t1 = (b.max.x + RADIUS - x) * ix;
        let axis = 0;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
        let u0 = (b.min.z - RADIUS - z) * iz, u1 = (b.max.z + RADIUS - z) * iz;
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        if (u0 > t0) { t0 = u0; axis = 1; }
        if (u1 < t1) t1 = u1;
        if (t0 > t1 || t1 < 0) continue;
        const hit = t0 > 0 ? t0 : 0;
        if (hit < best) {
          best = hit;
          if (axis === 0) { nx = dx > 0 ? -1 : 1; nz = 0; }
          else { nx = 0; nz = dz > 0 ? -1 : 1; }
        }
      }
      if (best >= dist) return null;
      return { distance: best, normal: { x: nx, y: 0, z: nz } };
    }

    /* Does ctx.physics answer a ray we know the answer to?
     *
     * Rapier's query structures are only rebuilt when the world is STEPPED, so between
     * world/ handing over its 601 colliders on 'ready' and the first simulation tick,
     * every raycast into that world returns null — measured, not guessed. Anything that
     * asks the physics engine about the house at boot therefore gets a confident,
     * uniform, wrong answer. So: shoot one ray at the floor the boy is provably standing
     * on, and believe physics only if it comes back. Re-checked once a second while the
     * fallback is in charge, so collision hands itself back the moment physics wakes up. */
    function calibrate(y) {
      const ph = ctx.physics;
      if (!ph || !ph.ready || !ph.raycast) return false;
      _vo.set(P.pos.x, y + 1.4, P.pos.z); _vd.set(0, -1, 0);
      const cal = ph.raycast(_vo, _vd, 3.2, null);
      return !!(cal && Math.abs(y + 1.4 - cal.distance - y) < 0.7);
    }
    let recalT = 0, fallbackFor = 0;
    this._recalibrate = (dt) => {
      if (!api.geom.ready) return;          // physics already in charge
      fallbackFor += dt;
      recalT -= dt;
      if (recalT > 0) return;
      recalT = 1.0;
      if (calibrate(P.pos.y)) {
        useRapier = true;
        api.geom.ready = false;             // give collision back to Rapier
        return;
      }
      // Six seconds of a physics world that holds colliders and answers nothing is not
      // a warm-up, it is a fault — and a silent one, because walking through a wall
      // looks like a level that was built wrong. Say it on screen, once.
      if (fallbackFor > 6 && !api._warned) {
        api._warned = true;
        if (ctx.ui) ctx.ui.error(
          'ctx.physics.raycast returns nothing at a point the player is demonstrably ' +
          'standing on, with ' + (ctx.physics && ctx.physics.bodyCount) + ' bodies in ' +
          'the world. Collision and the opening shot are running on engine/onfoot.js\u2019s ' +
          'own bounding-box fallback (' + (boxes ? boxes.length : 0) + ' boxes).');
      }
    };

    /* Did this ray leave through the building envelope, or was it never inside one?
     * The difference between standing in the living room looking at the sea and
     * standing on the terrace looking at the sea is entirely this: indoors there is a
     * pane of glass between you and the water. It does not show up in a distance
     * measurement, because glass is transparent to the composition search — which is
     * exactly how the first pass at this put the boy outside on the balcony. */
    function crossesEnvelope(x, y, z, dx, dz, maxDist) {
      if (!boxes) return false;
      const ix = 1 / (dx || 1e-9), iz = 1 / (dz || 1e-9);
      let glassAt = Infinity, solidAt = Infinity;
      for (const b of boxes) {
        let t0 = (b.min.x - x) * ix, t1 = (b.max.x - x) * ix;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
        let u0 = (b.min.z - z) * iz, u1 = (b.max.z - z) * iz;
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        if (u0 > t0) t0 = u0;
        if (u1 < t1) t1 = u1;
        if (t0 > t1 || t1 < 0.05 || t0 > maxDist) continue;
        if (y < b.min.y - 0.02 || y > b.max.y + 0.02) continue;
        const hit = t0 > 0.05 ? t0 : t1;
        if (b.glass) { if (hit < glassAt) glassAt = hit; }
        else if (hit < solidAt) solidAt = hit;
      }
      _env.glass = glassAt; _env.solid = solidAt;
      return glassAt < maxDist || solidAt < maxDist;
    }
    const _env = { glass: Infinity, solid: Infinity };

    // Hand the whole fallback to the step functions, which live outside this closure.
    /* Is this point under a roof AND inside the envelope? env.js asks, because the
     * interior daylight rig must not pour Pacific bounce onto the terrace, and its own
     * fallback (a house-footprint test) says yes out there. */
    function indoorAt(x, y, z) {
      if (!boxes) return null;
      if (seeThrough(x, y + 0.2, z, 0, 1, 0, 16) >= 16) return false;
      let enclosed = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        if (crossesEnvelope(x, y, z, Math.sin(a), Math.cos(a), 70)) enclosed++;
      }
      return enclosed >= 5;
    }

    api.geom = { boxFloorAt, boxSweep, shaftAt, indoorAt, ready: false };

    // Slab method. Returns the distance to the first BLOCKING box, or maxDist.
    function boxSeeThrough(x, y, z, dx, dy, dz, maxDist) {
      let best = maxDist;
      const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
      for (const b of boxes) {
        if (b.glass) continue;
        // A plate is answered by its real outline in plateHit(); its box would only
        // ever be wrong here, and wrong in the direction that says "roof" over thin air.
        if (b.big && dy > 0.05) continue;
        let t0 = (b.min.x - x) * ix, t1 = (b.max.x - x) * ix;
        if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
        let u0 = (b.min.y - y) * iy, u1 = (b.max.y - y) * iy;
        if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
        if (u0 > t0) t0 = u0;
        if (u1 < t1) t1 = u1;
        if (t0 > t1) continue;
        let v0 = (b.min.z - z) * iz, v1 = (b.max.z - z) * iz;
        if (v0 > v1) { const t = v0; v0 = v1; v1 = t; }
        if (v0 > t0) t0 = v0;
        if (v1 < t1) t1 = v1;
        if (t0 > t1 || t1 < 0.05) continue;
        const hit = t0 > 0.05 ? t0 : t1;
        if (hit < best) best = hit;
      }
      return best;
    }

    // Distance to the first thing that actually BLOCKS the view, in metres. Panes of
    // glass are stepped through, not stopped at: the whole seaward wall of this house
    // is glass, and a ray that stopped at the curtain wall would score the best shot in
    // the game as a 25 m dead end.
    const _vo = new THREE.Vector3(), _vd = new THREE.Vector3();
    let useRapier = false;
    function seeThrough(x, y, z, dx, dy, dz, maxDist) {
      if (!useRapier) {
        const d = boxSeeThrough(x, y, z, dx, dy, dz, maxDist);
        // Upward rays get the exact plate answer too, and the nearer wins: the boxes
        // over-report roofs, the plates never do.
        return dy > 0.05 ? Math.min(d, plateHit(x, y, z, dx, dy, dz, maxDist)) : d;
      }
      const ph = ctx.physics;
      _vo.set(x, y, z); _vd.set(dx, dy, dz);
      let travelled = 0;
      for (let pane = 0; pane < 5; pane++) {
        const hit = ph.raycast(_vo, _vd, maxDist - travelled, null);
        if (!hit) return maxDist;
        travelled += hit.distance;
        if (hit.material !== 'glass') return travelled;
        _vo.addScaledVector(_vd, hit.distance + 0.06);
        travelled += 0.06;
        if (travelled >= maxDist) return maxDist;
      }
      return travelled;
    }

    // How good is the frame from here, looking this way? Five rays across the field and
    // four heights, so a shot is only good if the WHOLE frame is, not just the centre
    // pixel. VISTA is the distance past which more distance stops helping.
    const VISTA = 150;
    const FAN_WIDE = [-0.50, -0.25, 0, 0.25, 0.50];
    const FAN_FAST = [-0.42, 0, 0.42];
    const TILT_TALL = [0.20, 0.05, -0.10, -0.26];
    const TILT_FAST = [0.10, -0.14];
    function viewScore(x, y, z, yaw, fast) {
      const fan = fast ? FAN_FAST : FAN_WIDE;
      const tilt = fast ? TILT_FAST : TILT_TALL;
      let total = 0, n = 0, open = 0, near = 0, nearest = VISTA;
      for (const a of fan) {
        const sy = Math.sin(yaw + a), cy = Math.cos(yaw + a);
        for (const p of tilt) {
          const cp = Math.cos(p);
          const d = seeThrough(x, y, z, -sy * cp, Math.sin(p), -cy * cp, VISTA);
          total += Math.min(d, VISTA); n++;
          if (d > 55) open++;                 // this ray left the building
          if (d > 3.2 && d < 30) near++;      // ...and this one landed on the room
          if (d < nearest) nearest = d;
        }
      }
      const mean = total / n;
      const openness = open / n;
      // Openness is the ocean — but it SATURATES. The reference plate is roughly two
      // thirds daylight and one third room: curved glass, the Pacific, and a piece of
      // stone floor and board-formed wall to give it a foreground. Rewarding openness
      // without a ceiling is what walks the camera up to the glass until the room is
      // gone, and then out onto the balcony.
      // A layered frame — something near, something far — is what makes a still read as
      // a place rather than a backdrop. In the reference plate the ceiling soffit, the
      // board-formed wall and the stone floor are all inside twenty metres while the
      // Pacific is at infinity, and the picture is the two of them together.
      const layered = near / n;
      let s = mean * 0.38 + Math.min(openness, 0.60) / 0.60 * 115
                          + Math.min(layered, 0.45) / 0.45 * 95;
      // Is there a CEILING in the top of this frame? One ray, aimed where the top edge
      // of a 68-degree field lands. It is asked here rather than in stand() because it
      // is a fact about the shot, not about the spot: at the seaward tip of this house
      // the soffit is overhead looking inland and gone looking out, and only the frame
      // knows the difference. Without it the opening reads as a balcony railing over
      // water — twice, in two different places, before this line existed.
      const cc = Math.cos(0.45);
      const ceiling = seeThrough(x, y, z, -Math.sin(yaw) * cc, Math.sin(0.45),
                                 -Math.cos(yaw) * cc, 30);
      if (ceiling > 18) s -= 95;
      else if (ceiling > 9) s -= 30;
      // How far away is the curtain wall in THIS direction? In the reference plate the
      // camera is about ten metres off the glass, which is what makes it read as a wall
      // of glass floor to ceiling. From thirty metres back the same wall is a thin
      // horizontal band with a fence's worth of mullions in it, and the shot loses the
      // one piece of architecture it is supposed to be about.
      crossesEnvelope(x, y, z, -Math.sin(yaw), -Math.cos(yaw), 120);
      const g = _env.glass;
      if (isFinite(g)) {
        const e = (g - 11) / 10;
        s += 70 * Math.exp(-e * e);
      }
      // What is IN the room. Capped, because the shot is still the ocean: at full
      // saturation this is worth about as much as the glass-distance term, enough to
      // decide between two frames of the Pacific but never enough to win facing inland.
      s += Math.min(propScore(x, y, z, yaw), 1.2) / 1.2 * 165;
      // Something in your face ruins the frame no matter how good the rest of it is.
      if (nearest < 1.7) s -= 150;
      else if (nearest < 3.0) s -= 40 * (3.0 - nearest);
      return s;
    }

    function composeOpeningShot() {
      const ph = ctx.physics;
      const floorY0 = P.pos.y;
      // Calibrate. If a ray straight down from the player's own feet does not find the
      // floor he is demonstrably standing on, Rapier does not have the house yet and
      // every score it produces would be the same number.
      useRapier = calibrate(floorY0);
      if (!boxes) boxes = buildBoxes();
      if (!propCells) propCells = buildProps();
      api.geom.ready = !useRapier && boxes.length > 0;
      if (!useRapier && !boxes.length) return { why: 'nothing to see with', moved: false };
      // Whether that is a fault or just a physics world that has not been stepped yet
      // is decided by _recalibrate over the next few seconds, not here: a red panel at
      // the bottom of the screen for a condition that clears itself in one tick is
      // noise, and noise is how a real warning gets ignored.
      // This is a synchronous search on the boot thread. Give it a hard wall-clock
      // budget: a spawn that is 5% worse is invisible, a page that freezes for four
      // seconds while it looks for a better one is the whole first impression.
      const t0 = performance.now();
      const outOfTime = () => performance.now() - t0 > 140;
      const floorY = floorY0;
      const eyeOf = y => y + EYE_STAND;

      /* Which way is the Pacific? Derived from world/'s own named points rather than
       * hard-coded, but it is not optional: the reference plate, and the premise, are a
       * boy looking at the SEA. Left purely to a view score the search will happily pick
       * the longest sightline in the house, which on this plan is inland across the
       * kitchen — a perfectly composed frame of the wrong thing. */
      const seaPt = (spawns && (spawns.offshore || spawns.launch || spawns.terrace)) ||
                    { x: 0, z: -400 };
      const seaYaw = Math.atan2(-(seaPt.x - P.pos.x), -(seaPt.z - P.pos.z));
      const towardSea = (yaw) => Math.cos(yaw - seaYaw);
      // 66 degrees either side. Wide enough that the search still gets to choose the
      // composition — the curve of the glass, what the frame includes — and narrow
      // enough that the water is always in it.
      const SEA_CONE = 0.42;

      // Can he stand here, is it the main floor, and is there a roof over it? The last
      // one is what keeps the opening INSIDE the house instead of out on the terrace.
      function stand(x, z) {
        // The main floor is flat and world/ told us its height; the interesting
        // questions are whether he is INSIDE (a roof over him, not out on the terrace)
        // and whether he is standing in the sofa.
        const y = floorY;
        const headroom = seeThrough(x, y + 1.75, z, 0, 1, 0, 20);
        if (headroom >= 20) return null;                 // open sky: this is outdoors
        if (headroom < 0.6) return null;                 // under a counter, in a slab
        // There has to be a CEILING you can read, not a void eight metres up. The
        // seaward tip of this house is double height, and standing in it the frame is a
        // glass balustrade over water with no room attached — which is a nice picture of
        // the sea and a terrible picture of a boy inside Tony Stark's house.
        if (headroom > 5.0) return null;
        let minClear = 99;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const d = seeThrough(x, y + 1.1, z, Math.sin(a), 0, Math.cos(a), 3.0);
          if (d < minClear) minClear = d;
        }
        if (minClear < 1.05) return null;                // inside furniture or a wall
        // And the floor really is under him: walking room below the knees too.
        if (seeThrough(x, y + 0.35, z, 0, -1, 0, 1.2) > 1.1) return null;
        // Inside the envelope, not out on the terrace. Seven of eight directions have
        // to meet either a wall or a pane of glass — a balcony fails the seaward ones.
        let enclosed = 0, glassNear = Infinity;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          if (crossesEnvelope(x, y + 1.2, z, Math.sin(a), Math.cos(a), 70)) enclosed++;
          if (_env.glass < glassNear) glassNear = _env.glass;
        }
        if (enclosed < 7) return null;
        // Stand BACK from the curtain wall. Pressed against it there is no room in the
        // frame and no sense of being indoors — the glass stops reading as a wall of
        // glass and starts reading as a balcony rail, which is how the search kept
        // wandering to the very edge of the plate.
        if (glassNear < 4.0) return null;
        return { x, y, z, headroom, enclosed, glassNear };
      }

      // Candidates: everything world/ authored, plus a polar sweep of the main floor
      // centred between the room and the sea so the seaward lobe is sampled densely.
      const seen = new Set();
      const raw = [];
      let rejected = false;
      const push = (x, z) => {
        const key = Math.round(x) + ',' + Math.round(z);
        if (seen.has(key)) return;
        seen.add(key); raw.push([x, z]);
      };
      push(P.pos.x, P.pos.z);
      if (spawns) for (const n of ['living', 'terrace', 'entrance']) {
        if (spawns[n]) push(spawns[n].x, spawns[n].z);
      }
      /* Candidates aimed at the FURNITURE. The polar sweep below samples the plan
       * evenly, which on a 116 x 69 m floor plate means most of its candidates stand in
       * the empty half of the room; the reference plate is a frame with a seating group
       * in the middle distance and the Pacific behind it, and the only way to get one is
       * to stand where a seating group is BETWEEN you and the water. So every cluster of
       * furniture also proposes the two stands that put it in frame: six and eleven
       * metres back from it, directly away from the sea. */
      if (propCells) {
        const inland = [Math.sin(seaYaw), Math.cos(seaYaw)];   // away from the water
        for (const c of propCells) {
          if (Math.abs(c.y - floorY) > 3.0) continue;
          for (const back of [6, 11]) {
            push(c.x + inland[0] * back, c.z + inland[1] * back);
          }
        }
      }
      const cx = P.pos.x * 0.4, cz = (spawns && spawns.terrace ? spawns.terrace.z : -30) * 0.45
                                    + P.pos.z * 0.15;
      for (let r = 6; r <= 32; r += 5.2) {
        const steps = Math.max(8, Math.round(r * 0.62));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
        }
      }

      // Pass 1 — cheap: three rays, eight headings, keep the best few positions.
      const scored = [];
      for (const [x, z] of raw) {
        if (outOfTime() && scored.length) break;
        const st = stand(x, z);
        if (!st) continue;
        let best = -Infinity, bestYaw = seaYaw;
        for (let i = 0; i < 8; i++) {
          const yaw = (i / 8) * Math.PI * 2;
          if (towardSea(yaw) < SEA_CONE) continue;
          const s = viewScore(st.x, eyeOf(st.y), st.z, yaw, true);
          if (s > best) { best = s; bestYaw = yaw; }
        }
        if (best === -Infinity) continue;
        scored.push({ ...st, score: best, yaw: bestYaw });
      }
      // Every candidate was rejected. Do not silently keep a bad spawn: relax the
      // standing test (which is the fussy part — headroom rays, furniture clearance)
      // and score the authored point plus its neighbours on view alone.
      if (!scored.length) {
        for (const [x, z] of raw.slice(0, 60)) {
          const y = floorY;
          let best = -Infinity, bestYaw = 0;
          for (let i = 0; i < 8; i++) {
            const yaw = (i / 8) * Math.PI * 2;
            const sc = viewScore(x, eyeOf(y), z, yaw, true);
            if (sc > best) { best = sc; bestYaw = yaw; }
          }
          scored.push({ x, y, z, headroom: 0, score: best, yaw: bestYaw, relaxed: true });
        }
        rejected = true;
      }
      if (!scored.length) return { why: 'no candidates', moved: false };
      scored.sort((a, b) => b.score - a.score);

      // Pass 2 — expensive: the full fan over 32 headings, on the survivors only.
      const finals = [];
      for (const c of scored.slice(0, 7)) {
        if (outOfTime() && finals.length) break;
        let best = -Infinity, bestYaw = c.yaw;
        for (let i = 0; i < 32; i++) {
          const yaw = (i / 32) * Math.PI * 2;
          const t = towardSea(yaw);
          if (t < SEA_CONE) continue;
          const s = viewScore(c.x, eyeOf(c.y), c.z, yaw, false) + t * 30;
          if (s > best) { best = s; bestYaw = yaw; }
        }
        if (best === -Infinity) continue;
        // A stand is only worth opening on if he can turn around and still see something.
        // The gap the critic found was not one bad heading, it was four.
        let worst = Infinity;
        for (let i = 0; i < 4; i++) {
          worst = Math.min(worst, viewScore(c.x, eyeOf(c.y), c.z, bestYaw + i * Math.PI / 2, true));
        }
        finals.push({ ...c, yaw: bestYaw, score: best + worst * 0.55, front: best, worst });
      }
      finals.sort((a, b) => b.score - a.score);
      const win = finals[0];

      // The authored stand keeps the game if it is within a whisker of the winner —
      // world/ knows things about its own house that a raycast does not.
      const authored = finals.find(f => Math.hypot(f.x - P.pos.x, f.z - P.pos.z) < 1.2);
      const keep = authored && authored.score > win.score - 25 ? authored : win;

      // Look very slightly down: the boy is 1.58 m and the stone floor is part of the
      // shot. A dead-level horizon reads as a camera on a tripod.
      return {
        x: keep.x, y: keep.y, z: keep.z, yaw: keep.yaw, pitch: -0.062,
        score: Math.round(keep.score), front: Math.round(keep.front || 0),
        worst: Math.round(keep.worst || 0),
        props: Math.round(propScore(keep.x, eyeOf(keep.y), keep.z, keep.yaw) * 100) / 100,
        top: finals.slice(0, 4).map(f => [Math.round(f.x), Math.round(f.z), Math.round(f.score),
                                          Math.round(propScore(f.x, eyeOf(f.y), f.z, f.yaw) * 100) / 100]),
        moved: Math.hypot(keep.x - P.pos.x, keep.z - P.pos.z) > 0.3 ||
               Math.abs(((keep.yaw - P.yaw + Math.PI) % (Math.PI * 2)) - Math.PI) > 0.05,
        candidates: scored.length, tried: raw.length, relaxed: rejected,
        why: useRapier ? 'composed(rapier)' : 'composed(boxes:' + boxes.length + ')',
      };
    }

    /* ─────────────── the workshop arrival ───────────────
     * THE BEAT THAT WAS A BLACK FRAME.
     * The first thing you see at the bottom of the stair was, measured, 98% of its
     * pixels in the bottom fifth of the luminance range: world/'s authored
     * spawns.workshop points at an empty corner of a fifty-metre room, and a basement
     * corner with nothing in it is indistinguishable from a page that failed to render.
     *
     * So the arrival is COMPOSED, exactly the way the opening shot is, and for the same
     * reason: no constant written in any file can know what the room looks like after
     * another agent has moved everything in it. The score below asks three questions of
     * every candidate, and all three are answered by casting rays at the geometry that
     * is actually there:
     *
     *   1. is the Hall of Armor in this frame, and off to one side rather than dead
     *      centre — the reference plate is an oblique down the row, not a mugshot;
     *   2. does the MID-GROUND have things in it — how many of a fan of rays stop
     *      between 2 and 9 metres. This is the whole critique of the room in one number:
     *      light needs something to land on, and a frame whose rays all fly 30 m before
     *      hitting a wall is a black frame no matter how the lamps are set;
     *   3. is there still some depth — at least one ray that gets a long way, so the
     *      room reads as a room and not as a cupboard.
     *
     * It runs once, on 'ready', on the boot thread, so it gets a hard wall-clock budget
     * like the opening search does. */
    function composeWorkshopArrival() {
      const st = spawns && spawns.workshop;
      const marks = cases.length ? cases.map(c => c.pos) : null;
      if (!st || !marks || !marks.length) return null;
      const eye = st.y + EYE_STAND;
      const t0 = performance.now();

      // the centroid of the case row, and the gantry pad, are the two landmarks
      let cx = 0, cz = 0;
      for (const m of marks) { cx += m.x; cz += m.z; }
      cx /= marks.length; cz /= marks.length;
      const gp = gantryPoint || { x: cx + 8, z: cz };

      const signed = (yaw, x, z, px, pz) => {
        // angle of (px,pz) relative to the camera's forward, positive to the RIGHT of
        // frame. Forward for yaw is (-sin, -cos), which is this file's convention.
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const dx = px - x, dz = pz - z;
        return Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
      };

      // Candidate stands: a 1.6 m grid over the region the case row implies, thinned to
      // the points that are actually standable.
      let zLo = Infinity, zHi = -Infinity;
      for (const m of marks) { zLo = Math.min(zLo, m.z); zHi = Math.max(zHi, m.z); }
      const stands = [];
      for (let x = cx + 3.0; x <= cx + 24.0; x += 1.6) {
        for (let z = zLo - 8; z <= zHi + 10; z += 1.6) {
          if (performance.now() - t0 > 90) break;
          // floor right here, headroom above, and not standing inside a machine
          if (seeThrough(x, st.y + 0.35, z, 0, -1, 0, 1.2) > 1.0) continue;
          const head = seeThrough(x, eye, z, 0, 1, 0, 8);
          if (head < 1.2 || head > 7) continue;
          let clear = 99;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            clear = Math.min(clear, seeThrough(x, eye - 0.5, z, Math.sin(a), 0, Math.cos(a), 2.4));
          }
          if (clear < 0.95) continue;
          stands.push({ x, z });
        }
      }
      if (!stands.length) return null;

      const FAN = [-0.52, -0.34, -0.17, 0, 0.17, 0.34, 0.52];
      const TILT = [0.12, -0.02, -0.16];
      function score(x, z, yaw) {
        let mid = 0, far = 0, n = 0, nearest = 99, centre = 99;
        for (const a of FAN) {
          const sy = Math.sin(yaw + a), cy = Math.cos(yaw + a);
          for (const p of TILT) {
            const cp = Math.cos(p);
            const d = seeThrough(x, eye, z, -sy * cp, Math.sin(p), -cy * cp, 60);
            n++;
            if (d > 2.0 && d < 9.0) mid++;       // something in the mid-ground
            else if (d > 14) far++;              // ...and somewhere for the eye to go
            if (d < nearest) nearest = d;
            if (Math.abs(a) < 0.2 && d < centre) centre = d;
          }
        }
        /* Three ways a frame fails that a raw mid-ground COUNT cannot see, and all three
         * were in the render this replaced: the boy stood with his nose in the car, a
         * partition wall filled the left half, and not one case was visible. Clutter in
         * front of the lens scores exactly the same as clutter at six metres unless the
         * distances are checked, so they are. */
        if (nearest < 2.1) return -1e9;          // face-first into a cabinet
        if (centre < 4.0) return -1e9;           // a blocker parked in the middle of frame
        if (far < 2) return -1e9;                // no depth at all: a cupboard, or a wall

        /* Mid-ground is wanted BETWEEN a third and a half of the frame, not maximised.
         * Maximising it is what walks the camera into the nearest machine. */
        const midR = mid / n;
        let s = (1 - Math.min(1, Math.abs(midR - 0.42) / 0.42)) * 230
              + Math.min(far / n, 0.30) / 0.30 * 70;

        /* The cases must be SEEN, not merely be within the field of view. Each one gets
         * a ray: if something stops it well short of the stand, that case is behind a
         * partition and does not count. Two of the five have to survive. */
        let vis = 0, sumAng = 0, sumDist = 0;
        for (const m of marks) {
          const dx = m.x - x, dz = m.z - z;
          const dist = Math.hypot(dx, dz);
          /* 13 m, not 20. A case twenty metres down a dark basement is two pixels of
           * cyan: it satisfies "in frame" and shows the player nothing. The frame this
           * bound was written for had its nearest case at 17 m and rendered 93% black. */
          if (dist < 4.0 || dist > 13.0) continue;
          const ang = signed(yaw, x, z, m.x, m.z);
          if (Math.abs(ang) > 0.58) continue;
          const d = seeThrough(x, eye, z, dx / dist, 0, dz / dist, dist + 0.6);
          if (d < dist - 1.3) continue;          // occluded on the way
          vis++; sumAng += ang; sumDist += dist;
        }
        if (vis < 2) return -1e9;
        s += 55 * Math.min(vis, 3);

        // the row: off to one side, in the left third, and readable at 6–10 m
        const ac = sumAng / vis;
        const dc = sumDist / vis;
        s += 130 * (1 - Math.abs(Math.abs(ac) - 0.30) / 0.30);   // best around 17 deg off
        if (ac < 0) s += 45;                                     // left third, as asked
        s -= Math.abs(dc - 8.0) * 6;                             // 6–10 m from the row

        // the gantry / holo side: a bonus, not a requirement. In a room this shape the
        // two landmarks can be far enough apart that no single frame holds both, and a
        // hard constraint there would simply return nothing.
        const ag = signed(yaw, x, z, gp.x, gp.z);
        const dg = Math.hypot(gp.x - x, gp.z - z);
        if (Math.abs(ag) < 0.62 && dg > 4 && dg < 22) s += 70 + (ag > 0 ? 30 : 0) - Math.abs(dg - 9) * 3;
        return s;
      }

      let best = null;
      for (const c of stands) {
        if (performance.now() - t0 > 220) break;
        for (let i = 0; i < 24; i++) {
          const yaw = (i / 24) * Math.PI * 2;
          const s = score(c.x, c.z, yaw);
          if (!best || s > best.s) best = { s, x: c.x, z: c.z, yaw };
        }
      }
      if (!best || best.s <= -1e8) return null;
      return { x: best.x, y: st.y, z: best.z, yaw: best.yaw, pitch: -0.055,
               score: Math.round(best.s), candidates: stands.length };
    }
    /* Computed LAZILY, and re-computed once if the first attempt had to run on the
     * bounding-box fallback. Rapier only rebuilds its query structures when the world is
     * stepped, so at 'ready' — before a single tick — every raycast into the workshop
     * comes back null and the search would score a room it cannot see. Asking for it the
     * first time anybody wants it, and again once physics is demonstrably answering, is
     * what makes it see the real room including engine/dress.js's crates. */
    let arrival = null, arrivalRapier = false;
    function getArrival() {
      if (arrival && (arrivalRapier || !useRapier)) return arrival;
      const a = composeWorkshopArrival();
      if (a) { arrival = a; arrivalRapier = useRapier; api.arrival = a; }
      return arrival;
    }
    api.arrival = null;

    // Composing the shot needs the world's colliders, and world/ does not hand them to
    // Rapier until the 'ready' event — at init() time every raycast in this file returns
    // null and the search silently finds nothing. This is called from the 'ready'
    // listener above instead, and exposed so a critic can re-run it.
    api.compose = () => {
      // The collision fallback is built here too, because this is the first moment the
      // house exists as geometry AND we can tell whether ctx.physics is answering.
      if (!boxes) boxes = buildBoxes();
      const st = W && W.malibu && W.malibu.stairTop;
      if (st && !shaftRect) {
        const R = 5.0;
        shaftRect = { x0: st.x - R, x1: st.x + R, z0: st.z - R, z1: st.z + R };
        // ctx.world.surfaceHeight reports the main slab everywhere inside the house
        // footprint, stairwell included. Left alone it is a glass floor over the hole.
        api.suppressWorldFloor(shaftRect.x0, shaftRect.z0, shaftRect.x1, shaftRect.z1);
      }
      const opening = composeOpeningShot();
      api.opening = opening;
      if (opening && opening.moved) {
        spawnPoint.x = opening.x; spawnPoint.y = opening.y; spawnPoint.z = opening.z;
        spawnPoint.camYaw = opening.yaw; spawnPoint.pitch = opening.pitch;
        P.pos.set(opening.x, opening.y, opening.z);
        P.vel.set(0, 0, 0);
        P.yaw = P.yawSmooth = opening.yaw;
        P.pitch = P.pitchSmooth = opening.pitch;
        ctx.env.mix(envMixAt(P.pos));
      }
      return opening;
    };

    // Start the lighting at whatever the spawn implies, with no fade.
    ctx.env.mix(envMixAt(P.pos));
  },

  update(dt, ctx) { this._step(dt); this._watch(dt); if (this._recalibrate) this._recalibrate(dt); },
};

// ------------------------------------------------------------------------------------
// body / collision helpers
// ------------------------------------------------------------------------------------
function bodyHeight(P) {
  return HEIGHT_STAND + (HEIGHT_CROUCH - HEIGHT_STAND) * P.crouchAmt;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

// Nearest wall along `dir`, using two ball sweeps — one at knee height, one at chest.
// A single ray has no width and lets him walk through the corner of a column; a ball
// does not. Hits whose normal points mostly up are FLOOR, not wall, and are ignored, or
// every bump in the terrain would stop him dead.
function sweep(ctx, P, dir, dist, h) {
  // Fallback first: if ctx.physics is not answering, the boy still has to be stopped by
  // walls. onfoot builds a bounding-box set of everything world/ declared solid, and
  // this is the same sweep against that.
  const g = ctx.player && ctx.player.geom;
  if (g && g.ready) {
    let best = null;
    for (const hy of [0.55 * (h / HEIGHT_STAND), h - 0.35]) {
      const hit = g.boxSweep(P.pos.x, P.pos.y + hy, P.pos.z, dir.x, dir.z, dist + SKIN);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
  const ph = ctx.physics;
  if (!ph || !ph.ready || !ph.shapeCast) return null;
  let best = null;
  for (const hy of [0.55 * (h / HEIGHT_STAND), h - 0.35]) {
    _o.set(P.pos.x, P.pos.y + hy, P.pos.z);
    const hit = ph.shapeCast(_o, dir, RADIUS - 0.04, dist + SKIN, null);
    if (!hit) continue;
    if (hit.normal.y > 0.6 || hit.normal.y < -0.6) continue;   // floor or ceiling
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best;
}

// Move in XZ with slide. Three passes: hit a wall, lose the velocity into it, keep the
// rest of the move along the wall. That is what makes a corridor feel like a corridor
// instead of flypaper.
function moveHorizontal(ctx, P, colliders, h, dt) {
  let rx = P.vel.x * dt, rz = P.vel.z * dt;
  for (let i = 0; i < 3; i++) {
    const len = Math.hypot(rx, rz);
    if (len < 1e-6) break;
    _d.set(rx / len, 0, rz / len);
    const hit = sweep(ctx, P, _d, len, h);
    if (!hit) { P.pos.x += rx; P.pos.z += rz; break; }
    const adv = Math.max(0, hit.distance - SKIN);
    P.pos.x += _d.x * adv; P.pos.z += _d.z * adv;
    // Already touching, or already slightly inside: nudge out along the wall normal.
    // Without this, spawning half a step inside a column means the sweep returns a zero
    // time of impact for ever and the boy is welded to the spot.
    if (adv < 1e-4) { P.pos.x += hit.normal.x * 0.02; P.pos.z += hit.normal.z * 0.02; }
    // remaining move, projected onto the wall
    const nx = hit.normal.x, nz = hit.normal.z;
    const nl = Math.hypot(nx, nz) || 1;
    const ux = nx / nl, uz = nz / nl;
    let remx = rx - _d.x * adv, remz = rz - _d.z * adv;
    const dp = remx * ux + remz * uz;
    rx = remx - ux * dp; rz = remz - uz * dp;
    const vd = P.vel.x * ux + P.vel.z * uz;
    if (vd < 0) { P.vel.x -= ux * vd; P.vel.z -= uz * vd; }
  }
  resolveAABB(P, colliders, h);
}

// The fallback stairwell's boxes. No-op once world/ is alive, because nothing is in
// `colliders` then.
function resolveAABB(P, colliders, h) {
  const feet = P.pos.y, head = P.pos.y + h;
  for (const c of colliders) {
    if (c.max.y <= feet + STEP_UP || c.min.y >= head) continue;
    const cx = clamp(P.pos.x, c.min.x, c.max.x);
    const cz = clamp(P.pos.z, c.min.z, c.max.z);
    const dx = P.pos.x - cx, dz = P.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > RADIUS * RADIUS) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, push = RADIUS - d;
      P.pos.x += nx * push; P.pos.z += nz * push;
      const into = P.vel.x * nx + P.vel.z * nz;
      if (into < 0) { P.vel.x -= into * nx; P.vel.z -= into * nz; }
    } else {
      const ox = Math.min(P.pos.x - c.min.x, c.max.x - P.pos.x);
      const oz = Math.min(P.pos.z - c.min.z, c.max.z - P.pos.z);
      if (ox < oz) { P.pos.x += (P.pos.x < (c.min.x + c.max.x) / 2 ? -1 : 1) * (ox + RADIUS); P.vel.x = 0; }
      else { P.pos.z += (P.pos.z < (c.min.z + c.max.z) / 2 ? -1 : 1) * (oz + RADIUS); P.vel.z = 0; }
    }
  }
}

// The floor under a point. Three sources, highest wins, and only candidates at or below
// the feet plus STEP_UP count — which is what lets him walk up a stair tread without
// jumping and stops him snapping onto the slab over his head.
//   1. Rapier: every wall, stair, floor and column world/ built
//   2. a floor plate registered by the fallback or by world/
//   3. ctx.world.surfaceHeight(x, z) — analytic terrain
function floorAt(ctx, x, z, feetY, floors, suppress) {
  const limit = feetY + STEP_UP;
  let best = -Infinity;

  // Work out the suppression first: inside the stairwell shaft every BULK floor source is
  // wrong. boxFloorAt reports the main slab across the whole house footprint, stairwell
  // included, exactly as surfaceHeight does — so suppressing only the latter still left an
  // invisible floor over the hole, which is what the player hits and stands on. In the
  // shaft the only thing that should hold you up is a real collider: a stair tread.
  let suppressed = false;
  for (const s of suppress) {
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) { suppressed = true; break; }
  }

  const g = ctx.player && ctx.player.geom;
  if (g && g.ready && !suppressed) {
    const y = g.boxFloorAt(x, z, limit);
    if (y > best) best = y;
  } else {
    const ph = ctx.physics;
    if (ph && ph.ready && ph.raycast) {
      _o.set(x, limit + 0.02, z);
      _d.set(0, -1, 0);
      const hit = ph.raycast(_o, _d, 6.0, null);
      if (hit && hit.point.y > best) best = hit.point.y;
    }
  }
  for (const f of floors) {
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    if (f.y <= limit && f.y > best) best = f.y;
  }
  if (!suppressed && ctx.world && typeof ctx.world.surfaceHeight === 'function') {
    const hgt = ctx.world.surfaceHeight(x, z);
    if (typeof hgt === 'number' && isFinite(hgt) && hgt <= limit && hgt > best) best = hgt;
  }
  if (best === -Infinity) {
    // Nothing underfoot at a walkable height — fall toward whatever is lowest rather
    // than hovering on nothing.
    let low = Infinity;
    for (const f of floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) low = Math.min(low, f.y);
    if (!suppressed && ctx.world && ctx.world.surfaceHeight) {
      const hgt = ctx.world.surfaceHeight(x, z);
      if (typeof hgt === 'number' && isFinite(hgt)) low = Math.min(low, hgt);
    }
    best = low === Infinity ? -1000 : low;
  }
  return best;
}

function ceilingAt(ctx, pos, h, colliders) {
  let best = null;
  const g = ctx.player && ctx.player.geom;
  if (g && g.ready) {
    // no box ceiling test: the storey slab's box has no stairwell hole in it, and a
    // false ceiling at the top of the stairs is worse than no ceiling at all
    for (const c of colliders) {
      if (pos.x < c.min.x - RADIUS || pos.x > c.max.x + RADIUS) continue;
      if (pos.z < c.min.z - RADIUS || pos.z > c.max.z + RADIUS) continue;
      if (c.min.y >= pos.y + 0.3 && (best === null || c.min.y < best)) best = c.min.y;
    }
    return best;
  }
  const ph = ctx.physics;
  if (ph && ph.ready && ph.raycast) {
    _o.set(pos.x, pos.y + 0.35, pos.z);
    _d.set(0, 1, 0);
    const hit = ph.raycast(_o, _d, h + 0.6, null);
    if (hit && hit.normal.y < -0.3) best = hit.point.y;
  }
  for (const c of colliders) {
    if (pos.x < c.min.x - RADIUS || pos.x > c.max.x + RADIUS) continue;
    if (pos.z < c.min.z - RADIUS || pos.z > c.max.z + RADIUS) continue;
    if (c.min.y >= pos.y + 0.3 && (best === null || c.min.y < best)) best = c.min.y;
  }
  return best;
}

// ------------------------------------------------------------------------------------
// the armor bay
// ------------------------------------------------------------------------------------
function pickCase(cases, pos, camera) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  let best = null, bestScore = -1;
  for (const c of cases) {
    // Measure to the CASE, never to the spot you stand on to use it: those two points
    // are three metres apart, and measuring to the standing spot makes the distance zero
    // exactly when you have arrived, which is the one moment the prompt has to appear.
    const dx = c.mark.x - pos.x, dz = c.mark.z - pos.z;
    if (Math.abs(c.mark.y - pos.y) > 3.0) continue;   // a case on another floor
    const dist = Math.hypot(dx, dz);
    if (dist > REACH) continue;
    let dot = 1;
    if (dist > 0.25) dot = (dx / dist) * fwd.x + (dz / dist) * fwd.z;
    if (dot < 0.45) continue;                          // must be roughly in front of him
    const score = dot * 2 - dist / REACH;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Stand an armour inside each of world/'s frosted cases (or, with no world, inside the
// fallback bay's own cases). Reference: reference/world/hall_of_armor_cases.jpg — the
// suits are not displayed, they are HIDDEN: each is a dark silhouette behind angled
// frosted glass, lit only by a cold strip from the floor and its own reactor.
function buildArmorFigures(root, cases, stands) {
  const n = ARMORS.length;
  // Each mark carries its own facing. world/ sets stand.yaw so the suits look out into
  // the shop; the fallback bay is built facing +Z. Do NOT infer the direction from the
  // geometry — the five marks are collinear, so their centroid is on the rack itself and
  // the perpendicular is a coin flip that lands in the wall half the time.
  const marks = stands ? stands.slice(0, n) : ARMORS.map((a, i) => ({
    x: (i - (n - 1) / 2) * BAY.caseSpacing, y: BAY.floorY, z: BAY.caseZ, yaw: 0,
  }));

  for (let i = 0; i < n; i++) {
    const a = ARMORS[i];
    const m = marks[i];
    const faceYaw = m.yaw != null ? m.yaw : 0;
    const g = new THREE.Group();
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = faceYaw;
    root.add(g);

    const figure = buildSilhouette(a);
    g.add(figure);

    // A plinth edge light under the feet — in the reference every suit stands on a lit
    // sill, and it is what separates the boots from the black floor.
    const sill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.40),
      new THREE.MeshBasicMaterial({ color: 0x6fd0f2, transparent: true, opacity: 0.14,
                                    toneMapped: false, blending: THREE.AdditiveBlending,
                                    depthWrite: false })
    );
    sill.rotation.x = -Math.PI / 2;
    sill.position.set(0, 0.012, 0.28);
    g.add(sill);

    // A cold key from below and in front — never from the front at head height, or the
    // silhouette turns into a shop-window mannequin.
    // Deliberately soft. world/ already hangs a 3.2-intensity practical in every bay;
    // this is the second, lower source that shapes the legs and boots, not a key. Run it
    // any hotter and the frosted pane in front scatters it into a white slab with a
    // vaguely person-shaped hole in it — which is what the first three passes looked like.
    const light = new THREE.PointLight(0x7fd0f0, 1.8, 5.0, 2.0);
    light.position.set(0, 0.40, 0.80);
    g.add(light);
    // and a tight rim behind, so the shoulders separate from the niche
    const rim = new THREE.PointLight(0x9fe4ff, 1.2, 3.0, 2.0);
    rim.position.set(0, 2.05, -0.62);
    g.add(rim);

    // Where the player stands to take it, straight out in front of the case. The
    // yaw that looks back AT the case from there is exactly the figure's own yaw.
    const px = m.x + Math.sin(faceYaw) * STAND_OFF;
    const pz = m.z + Math.cos(faceYaw) * STAND_OFF;
    cases.push({
      id: a.id, name: a.name, sub: a.sub, group: g, figure, light, rim,
      // Read the built intensity rather than assuming it. The per-step fade below
      // multiplies this, and a hard-coded 1.0 here silently threw away the case
      // lighting every single tick — the rack rendered black from straight on while
      // looking fine in a still taken between steps.
      baseIntensity: light.intensity,
      baseRim: rim.intensity,
      pos: new THREE.Vector3(px, m.y, pz),
      mark: new THREE.Vector3(m.x, m.y, m.z),
      faceYaw,
      padYaw: null,
      gantry: null,
    });
  }
}

/* Swap the stand-in silhouettes for the real armour models, one at a time, as they load.
 *
 * Everything here is defensive on purpose. The five .glb files are written by another
 * task while this one runs, so at any given minute one of them may be missing, half
 * exported, or a different size than the contract says. A case that cannot be upgraded
 * keeps the silhouette it already has and the room still reads.
 *
 * Two things must be right or the hall looks wrong in a way that is hard to diagnose
 * from a still: the model faces −Z by the model contract while the silhouette (and
 * therefore the case, and therefore stand.yaw) faces +Z, so it gets turned around; and
 * the model is fitted to the contract's 1.95 m rather than trusted, because a model
 * exported in centimetres is a 195 m suit standing through the roof of the house. */
async function upgradeCaseFigures(ctx, cases) {
  const report = {};
  if (!ctx.assets || !ctx.assets.loadModel) return report;
  for (const c of cases) {
    try {
      const gltf = await ctx.assets.loadModel('models/' + c.id + '.glb');
      if (!gltf || !gltf.scene) { report[c.id] = 'no file'; continue; }
      // clone(true) shares geometry and materials with the copy suit/ equips — cheap,
      // and it must be a clone: reparenting the cached scene would take the suit out of
      // the case the moment the player equips it.
      const root = gltf.scene.clone(true);
      const box = new THREE.Box3().setFromObject(root);
      const h = box.max.y - box.min.y;
      if (!isFinite(h) || h < 0.05) { report[c.id] = 'empty bbox'; continue; }
      if (Math.abs(h - 1.95) > 0.1) root.scale.setScalar(1.95 / h);
      root.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(root);
      root.position.y -= b2.min.y;                       // feet on the plinth
      root.rotation.y = Math.PI;                         // model faces −Z, the case +Z
      root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      if (c.figure) c.figure.visible = false;
      c.group.add(root);
      /* BAKE THE DISPLAY SUIT. Each of these is a full armour — about 120 named plates —
       * standing perfectly still behind glass, and five of them are more than half of
       * everything the workshop submits. `allowNamed` is safe HERE and nowhere else: this
       * is a clone(true) that nothing ever reads back by plate name (the wearable rig has
       * its own), and the clone SHARES geometry with the copy suit/ equips, which is
       * exactly why mergeStatic must never free a geometry something still points at —
       * see the note in dedupe.js. */
      root.updateMatrixWorld(true);
      let baked = null;
      try { baked = mergeStatic(root, 2, { allowNamed: true, cellSize: 1e6 }); } catch (e) { /* keep the suit */ }
      c.real = root;
      c.figure = root;
      report[c.id] = 'ok h=' + h.toFixed(2) +
        (baked ? ' baked ' + baked.before + '->' + baked.left : '');
    } catch (e) {
      report[c.id] = 'ERR ' + (e && e.message);
      console.warn('[onfoot] case model ' + c.id + ' not upgraded', e);
    }
  }
  return report;
}

// A stand-in armour. Deliberately only a silhouette with a reactor: behind frosted glass
// in a near-black room that is all you see of the real thing either, and modelling a fake
// Mark III would put a bad one on screen next to the real ones.
function buildSilhouette(a) {
  const g = new THREE.Group();
  // NOT metalness 0.85. A near-mirror in a black room reflects nothing and renders as
  // a hole: the first pass of this rack came back as five glowing dots with no bodies
  // between them. Half-metal with a broad roughness lets the cyan sill actually model
  // the form, which is what the reference frame is made of.
  const mat = new THREE.MeshStandardMaterial({
    color: a.tint, roughness: 0.52, metalness: 0.45, envMapIntensity: 1.7,
  });
  const add = (geo, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz;
    m.castShadow = false; g.add(m); return m;
  };
  add(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), -0.13, 0.42, 0);   // legs
  add(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), 0.13, 0.42, 0);
  add(new THREE.BoxGeometry(0.30, 0.16, 0.34), -0.13, 0.09, 0.04);     // boots
  add(new THREE.BoxGeometry(0.30, 0.16, 0.34), 0.13, 0.09, 0.04);
  add(new THREE.BoxGeometry(0.52, 0.30, 0.30), 0, 0.90, 0);            // hips
  add(new THREE.BoxGeometry(0.62, 0.60, 0.36), 0, 1.36, 0);            // torso
  add(new THREE.BoxGeometry(0.86, 0.22, 0.36), 0, 1.60, 0);            // shoulder yoke
  add(new THREE.CapsuleGeometry(0.115, 0.34, 4, 10), -0.40, 1.34, 0, 0, 0.10); // arms
  add(new THREE.CapsuleGeometry(0.115, 0.34, 4, 10), 0.40, 1.34, 0, 0, -0.10);
  add(new THREE.CapsuleGeometry(0.105, 0.28, 4, 10), -0.45, 0.98, 0.02);
  add(new THREE.CapsuleGeometry(0.105, 0.28, 4, 10), 0.45, 0.98, 0.02);
  add(new THREE.BoxGeometry(0.14, 0.12, 0.34), 0, 1.76, 0);            // neck
  add(new THREE.BoxGeometry(0.28, 0.32, 0.30), 0, 1.96, 0.01);         // helmet

  // the arc reactor — the only light on the figure, exactly as in the reference
  // A hot white core with a tight halo, not a floodlight. Bloom does the rest; a big
  // bright disc here simply erases the chest it is supposed to be mounted in.
  const reactor = new THREE.Mesh(
    new THREE.CircleGeometry(0.034, 20),
    new THREE.MeshBasicMaterial({ color: a.reactor, toneMapped: false })
  );
  reactor.position.set(0, 1.45, 0.183);
  g.add(reactor);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.044, 0.070, 24),
    new THREE.MeshBasicMaterial({ color: a.reactor, transparent: true, opacity: 0.22,
                                  toneMapped: false, blending: THREE.AdditiveBlending,
                                  depthWrite: false })
  );
  halo.position.set(0, 1.45, 0.182);
  g.add(halo);
  // Short range: it is meant to spill onto the chest plates around it, nothing further.
  const rl = new THREE.PointLight(a.reactor, a.glow * 0.22, 0.9, 2.0);
  rl.position.set(0, 1.45, 0.34);
  g.add(rl);

  // eye slits
  const eyes = new THREE.Mesh(
    new THREE.PlaneGeometry(0.155, 0.022),
    new THREE.MeshBasicMaterial({ color: 0xd8f2ff, toneMapped: false })
  );
  eyes.position.set(0, 2.00, 0.161);
  g.add(eyes);

  /* BAKE IT. A silhouette is about seventy-five little boxes and every one of them is a
   * draw call, five times over for the five cases. Measured in the workshop: 371 of the
   * 679 meshes passing the frustum belonged to this group — more than half the room's
   * submissions were the display rack.
   *
   * Merged INSIDE `g`, not into the rack above it, and that scoping is the whole safety
   * argument: onfoot holds each figure as `c.figure` and hides it with `c.figure.visible
   * = false` when the real armour model arrives to take its place. Collapse the parts into
   * the same group and that reference still means what it meant. Collapse them into the
   * rack and it silently stops hiding anything. */
  try { mergeStatic(g, 2, { cellSize: 1e6 }); } catch (e) { /* a rack that draws slowly still draws */ }
  return g;
}

// ------------------------------------------------------------------------------------
// FALLBACK ONLY. A stairwell and a dark room, so the game is walkable end to end even if
// world/ fails to initialise. Never built when ctx.world.armorStands exists. This is not
// the Malibu workshop and is not trying to be.
// ------------------------------------------------------------------------------------
function buildFallbackDescent(root, colliders, floors, suppress) {
  const g = new THREE.Group();
  g.name = 'ONFOOT_FALLBACK_DESCENT';
  root.add(g);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x171b1f, roughness: 0.92, metalness: 0.02 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d1013, roughness: 0.30, metalness: 0.15 });
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.7, metalness: 0.05 });

  const box = (mat, x0, y0, z0, x1, y1, z1, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.receiveShadow = true;
    g.add(m);
    if (solid) colliders.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
    return m;
  };

  suppress.push({ x0: SHAFT.minX, z0: SHAFT.botZ, x1: SHAFT.maxX, z1: SHAFT.topZ });
  suppress.push({ x0: BAY.minX, z0: BAY.minZ, x1: BAY.maxX, z1: BAY.maxZ });

  const n = SHAFT.steps;
  const runZ = (SHAFT.topZ - SHAFT.botZ) / n;
  const dropY = (SHAFT.topY - SHAFT.botY) / n;
  for (let i = 0; i < n; i++) {
    const y = SHAFT.topY - dropY * (i + 1);
    const z1 = SHAFT.topZ - runZ * i, z0 = z1 - runZ;
    box(stepMat, SHAFT.minX + 0.15, y - 0.12, z0, SHAFT.maxX - 0.15, y, z1, false);
    floors.push({ x0: SHAFT.minX, z0, x1: SHAFT.maxX, z1, y });
  }
  box(concrete, SHAFT.minX - 0.3, BAY.floorY, SHAFT.botZ, SHAFT.minX, SHAFT.topY + 1.1, SHAFT.topZ);
  box(concrete, SHAFT.maxX, BAY.floorY, SHAFT.botZ, SHAFT.maxX + 0.3, SHAFT.topY + 1.1, SHAFT.topZ);
  box(concrete, SHAFT.minX - 0.3, BAY.ceilY, SHAFT.botZ - 3.0, SHAFT.maxX + 0.3, BAY.ceilY + 0.3, SHAFT.botZ);

  const F = BAY;
  const fl = box(floorMat, F.minX, F.floorY - 0.4, F.minZ, F.maxX, F.floorY, F.maxZ, false);
  fl.receiveShadow = true;
  floors.push({ x0: F.minX, z0: F.minZ, x1: F.maxX, z1: F.maxZ, y: F.floorY });
  box(concrete, F.minX - 0.4, F.floorY, F.minZ - 0.4, F.minX, F.ceilY + 0.3, F.maxZ);
  box(concrete, F.maxX, F.floorY, F.minZ - 0.4, F.maxX + 0.4, F.ceilY + 0.3, F.maxZ);
  box(concrete, F.minX - 0.4, F.floorY, F.minZ - 0.4, F.maxX + 0.4, F.ceilY + 0.3, F.minZ);
  box(concrete, F.minX - 0.4, F.floorY, F.maxZ, SHAFT.minX, F.ceilY + 0.3, F.maxZ + 0.4);
  box(concrete, SHAFT.maxX, F.floorY, F.maxZ, F.maxX + 0.4, F.ceilY + 0.3, F.maxZ + 0.4);
  box(concrete, F.minX - 0.4, F.ceilY, F.minZ - 0.4, F.maxX + 0.4, F.ceilY + 0.3, F.maxZ + 0.4);

  for (const [x, z, c, i] of [[-7, -6.5, 0x7ec4e6, 4.5], [7, -7.5, 0x6fb6dc, 3.6], [0, -5.0, 0x5f9fc4, 2.4]]) {
    const l = new THREE.PointLight(c, i, 13, 2.0);
    l.position.set(x, BAY.ceilY - 0.55, z);
    g.add(l);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16),
      new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    bulb.position.copy(l.position); bulb.position.y -= 0.02; bulb.rotation.x = -Math.PI / 2;
    g.add(bulb);
  }
  const sl = new THREE.PointLight(0x8fd0ea, 2.0, 8, 2.0);
  sl.position.set((SHAFT.minX + SHAFT.maxX) / 2, -1.9, (SHAFT.topZ + SHAFT.botZ) / 2);
  g.add(sl);
}
