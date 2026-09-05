// The armor itself: loading, verification, posing. Owned by task `suitup`.
//
// ctx.suit is the rig everything else in the game leans on:
//   equip(id)        load models/<id>.glb (or the proxy stand-in), verify it, wear it
//   setPose(name)    'stand' | 'suitup' | 'cruise' | 'hover' | 'fire'
//   pivots, plates   the contract's node names, straight from the loaded model
//   place(pos, yaw)  where the armor stands
//   faceplate(open)  the per-armor faceplate mechanism
//
// Poses are authored as limb DIRECTIONS and converted into rotations using each joint's
// own rest geometry (rig.js), so no pose assumes a limb lies along a pivot's -Y.

import * as THREE from 'three';
import { loadArmor, loadPilot, meshesByPivot, PLATES, POSES } from './rig.js';
import { Nano } from './nano.js';
import { Faceplate } from './faceplate.js';

export default {
  id: 'suit',

  async init(ctx) {
    const group = new THREE.Group();
    group.name = 'suit';
    group.visible = false;
    ctx.scene.add(group);

    // One light at the arc reactor. In the workshop it is the only warm-free source on
    // the chest and it is what makes the suit read in a dark basement.
    const reactorLight = new THREE.PointLight(0x9fe8ff, 0, 4.5, 2);
    reactorLight.name = 'reactor_light';

    // The boy. He stands inside the group the armour is placed with, so he is always in
    // exactly the same spot as the suit closing around him.
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'pilot_body_holder';
    bodyGroup.visible = false;
    group.add(bodyGroup);
    let bodyRig = null, bodyLoading = null;
    let wantBody = false;        // the whole boy is wanted (a suit-up is running)
    let faceOnly = false;        // only his head is wanted (an open faceplate)
    let headMeshes = null, faceLight = null;

    const api = {
      id: null,
      rig: null,
      root: group,
      pivots: {},
      plates: {},
      report: null,
      nano: null,
      faceplateCtl: null,
      pose: 'stand',
      followPlayer: true,
      poses: Object.keys(POSES),
      armors: ['mk1', 'mk2', 'mk3', 'mk42', 'mk50'],

      async equip(id) {
        if (!api.armors.includes(id)) { console.warn('[suit] unknown armor', id); return null; }
        if (api.id === id && api.rig) return api.rig;
        api.unequip();
        const rig = await loadArmor(ctx, id);
        api.rig = rig;
        api.id = id;
        api.pivots = rig.pivots;
        api.plates = rig.plates;
        api.report = rig.report;
        group.add(rig.root);
        group.visible = true;

        // The nano material is only wired for the armor that needs it: patching 37
        // materials is not free and only the Mk L pours.
        api.nano = null;
        if (id === 'mk50') {
          try { api.nano = await Nano.attach(rig); } catch (e) { console.warn('[suit] nano attach failed', e); }
        }
        api.faceplateCtl = new Faceplate(rig, api.nano);

        normaliseGlow(rig, id);

        const chest = rig.pivots.piv_reactor || rig.pivots.piv_chest;
        if (chest) {
          chest.add(reactorLight);
          // Far enough off the chest that the inverse-square falloff does not detonate:
          // a point light 0.1 m from a plate delivers ~100x what it delivers at 1 m, and
          // the whole torso blew to white. Measured, then moved out and turned down.
          reactorLight.position.set(0, 0, id === 'mk50' ? -0.26 : -0.30);
          reactorLight.distance = 3.2;
          reactorLight.color.set(id === 'mk50' ? 0x7ff0ff : id === 'mk1' ? 0xbfe4ff : 0xcfeeff);
          reactorLight.intensity = id === 'mk1' ? 0.30 : 0.45;
        }
        rig.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        api.setPose('stand', true);
        ctx.state.armor = id;
        ctx.bus.emit('suit:equipped', { id, report: rig.report });
        return rig;
      },

      unequip() {
        if (!api.rig) return;
        // The face fill hangs off the ARMOUR's head pivot, which is about to be disposed,
        // and faceOnly left true would leave the boy's head floating in the next armour.
        api.showFace(false);
        if (faceLight && faceLight.parent) faceLight.parent.remove(faceLight);
        if (api.nano) api.nano.detach();
        if (reactorLight.parent) reactorLight.parent.remove(reactorLight);
        group.remove(api.rig.root);
        api.rig.dispose();
        api.rig = null; api.id = null; api.nano = null; api.faceplateCtl = null;
        api.pivots = {}; api.plates = {};
        group.visible = false;
        ctx.state.suitClosed = false;
      },

      // Wear it fully closed, no sequence — the critic's entry point.
      wear(id) {
        return api.equip(id).then(rig => {
          if (!rig) return null;
          rig.setAllPlates(true);
          rig.resetAllPlates();
          if (api.nano) { api.nano.setEdge(1.6); api.nano.setActive(false); }
          if (api.faceplateCtl) api.faceplateCtl.snap(0);
          api.showBody(false);
          api.setPose('stand', true);
          group.visible = true;
          ctx.state.suitClosed = true;
          ctx.state.faceplateOpen = false;
          return rig;
        });
      },

      setPose(name, immediate = false) {
        api.pose = name;
        if (api.rig) api.rig.setPose(name, immediate);
        if (bodyRig) bodyRig.setPose(name === 'stand' ? 'stand' : 'suitup', immediate);
      },

      // ---- the boy under the armour ------------------------------------------
      // Loaded once, on the first suit-up, and reused. Everything that makes a partial
      // suit believable depends on him being there: the Mk XLII gauntlet arriving on a
      // human arm, the Mk L wave crossing from cloth to armour.
      async loadBody() {
        if (bodyRig) return bodyRig;
        if (!bodyLoading) bodyLoading = loadPilot(ctx).then(r => {
          if (!r) return null;
          bodyRig = r;
          bodyGroup.add(r.root);
          r.setPose('suitup', true);
          return r;
        });
        return bodyLoading;
      },
      get body() { return bodyRig; },
      showBody(v) {
        wantBody = !!v;
        if (v && faceOnly) api.showFace(false);   // a whole boy, not a floating head
        bodyGroup.visible = !!v || faceOnly;
      },
      get bodyVisible() { return bodyGroup.visible; },

      // ---- the face inside an open helmet -------------------------------------
      // Every reference frame of an open faceplate has a FACE in it — Tony lit by his own
      // interface, the helmet a dark frame around it (reference/armors/mk42_faceplate_open.jpg,
      // reference/hud/hud_mk3_a.jpg). Ours opened onto an empty shell: a black hole where
      // the head should be, which reads as a prop rather than as armour with a boy inside
      // (shots/suitup/F_mk3_open.png, F_mk42_open.png, third pass).
      //
      // The boy is already loaded and already standing in exactly the right place — he is
      // what the suit closes around — so the whole mechanism is: show his HEAD only, and
      // light it the way the interface would. Head only, because the rest of him is inside
      // finished armour and would z-fight straight through it.
      showFace(v) {
        v = !!v;
        if (!bodyRig) { if (v) api.loadBody(); return; }
        faceOnly = v;
        if (!headMeshes) {
          headMeshes = new Set();
          for (const { mesh, pivot } of meshesByPivot(bodyRig)) {
            if (pivot === 'piv_head' || pivot === 'piv_neck') headMeshes.add(mesh);
          }
        }
        if (v) {
          bodyGroup.visible = true;
          bodyRig.root.traverse(o => { if (o.isMesh) o.visible = headMeshes.has(o); });
          // Register his head with the ARMOUR's head. The boy is scaled to the armour's
          // height, but a helmet is not a head: the Mk I is a welded box that stands
          // 12 cm proud of the face it covers, and with the visor up you looked into an
          // empty steel cube with the tip of a nose somewhere at the back of it
          // (shots/suitup/F_mk1_open.png). Aligning the two head pivots puts the face
          // where the opening is, on every armour, with no per-armor numbers.
          const ah = api.pivots.piv_head, bh = bodyRig.pivots && bodyRig.pivots.piv_head;
          if (ah && bh) {
            ah.updateWorldMatrix(true, false);
            bh.updateWorldMatrix(true, false);
            const a = new THREE.Vector3().setFromMatrixPosition(ah.matrixWorld);
            const b = new THREE.Vector3().setFromMatrixPosition(bh.matrixWorld);
            bodyGroup.position.add(a.sub(b));
          }
          if (!faceLight) {
            // The interface is the only thing lighting his face. Cool, weak, and short
            // range so it cannot escape the helmet and light the chest.
            faceLight = new THREE.PointLight(0xbfe6ff, 1.1, 0.75, 2);
            faceLight.name = 'faceplate_fill';
          }
          const head = api.pivots.piv_head || api.pivots.piv_neck;
          if (head && faceLight.parent !== head) head.add(faceLight);
          if (faceLight) faceLight.position.set(0, 0.06, -0.12);   // in front of the face
          faceLight.visible = true;
        } else {
          bodyRig.root.traverse(o => { if (o.isMesh) o.visible = true; });
          bodyGroup.position.set(0, 0, 0);
          if (faceLight) faceLight.visible = false;
          if (!wantBody) bodyGroup.visible = false;
        }
      },
      get faceVisible() { return faceOnly; },

      // Faceplate: the mechanism itself lives in faceplate.js, one per armor.
      faceplate(open) {
        if (!api.faceplateCtl) return;
        api.faceplateCtl.set(open ? 1 : 0);
        ctx.state.faceplateOpen = !!open;
      },
      get faceplateOpen() { return api.faceplateCtl ? api.faceplateCtl.isOpen : false; },

      place(pos, yaw = 0) {
        group.position.copy(pos);
        group.rotation.set(0, yaw, 0);
      },
      setVisible(v) { group.visible = v; },

      // Emitter transforms other modules ask for: where a repulsor leaves the hand and
      // where the boot exhaust goes. Local -Y per the contract, read off the model.
      emitter(name, outPos, outDir) {
        const p = api.pivots[name];
        if (!p) return false;
        p.updateWorldMatrix(true, false);
        outPos.setFromMatrixPosition(p.matrixWorld);
        outDir.set(0, -1, 0).applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion())).normalize();
        return true;
      },
    };

    ctx.suit = api;

    // Warm the boy up once the rest of the game has booted: he is 2.4 MB and the first
    // suit-up should not stall for five seconds while he downloads. Not awaited — if he
    // is late the sequence loads him itself.
    ctx.bus.once('ready', () => { api.loadBody(); });

    ctx.bus.on('debug:wear', id => { api.wear(id); });
    ctx.bus.on('faceplate:set', v => api.faceplate(!!v));

    // Placement while the boy is still on foot: stand where he stands, so the gantry
    // ritual happens around him. Other modules can turn this off with followPlayer.
    ctx.bus.on('debug:fly', () => { api.followPlayer = false; });
  },

  update(dt, ctx) {
    const api = ctx.suit;
    if (api && api.rig) api.rig.updateGlow(ctx.time || 0);
    if (!api || !api.rig) return;
    api.rig.updatePose(dt);
    if (api.faceplateCtl) {
      api.faceplateCtl.update(dt);
      // An open faceplate shows the boy's face. Driven off the mechanism's own state
      // rather than off the open/close call, so a critic's faceplateCtl.snap(0.5) and the
      // player's key both land the same. Never while a sequence is running: during a
      // suit-up the whole boy is on show and suitup/ owns which parts of him are visible.
      if (ctx.state.suitClosed && !(ctx.suitup && ctx.suitup.playing)) {
        // Not on the Mk I. Its helmet is a welded box with a closed interior wall behind
        // the visor and no room for a head: with the visor up you saw the tip of a nose
        // floating in a steel cube, which is worse than the empty slot the reference
        // actually shows (shots/suitup/F_mk1_open.png, both passes). The other four have
        // real helmet cavities and a face belongs in them.
        const wantFace = api.faceplateCtl.kind !== 'hinge' && api.faceplateCtl.t > 0.35;
        if (wantFace !== api.faceVisible) api.showFace(wantFace);
      }
    }
    if (api.body && api.bodyVisible) api.body.updatePose(dt);
    if (api.nano) api.nano.update(dt);

    if (api.followPlayer && ctx.state.mode !== 'flight') {
      const stand = playerStance(ctx);
      if (stand) {
        api.root.position.copy(stand.pos);
        api.root.rotation.set(0, stand.yaw, 0);
      }
    }
  },
};

// ---------------------------------------------------------------- glow normalisation
//
// Five armors are modelled by five different agents and `mat_glow` arrives with whatever
// emission strength each of them liked — the contract asks for ">= 3", and one shipped 7
// across twenty meshes. Through the game's bloom that does not read as an arc reactor,
// it reads as a floodlight: measured on the terrace, the Mk L's shoulders and hips ate
// the entire suit and the burgundy never showed at all.
//
// So the game decides the final emission, not the model. Reference: the reactor is a
// small HARD white core with a tight halo that throws bounce onto the plates around it
// (reference/armors/mk1_still_a.jpg), and on the Mk L the slots are pale cyan and always
// cooler and dimmer than the gold. Discs get more than slots; the Mk I gets least,
// because in the cave it is the only light there is and it is not a lamp.
// Levels are set for the DARK case: the workshop runs bloom at 0.78 against near-black,
// where anything over ~1.6 stops being a hard core with a halo and becomes a lamp that
// eats the chest. Checked in the workshop first, then on the terrace at noon.
// Levels are set for the DARK case: the workshop runs bloom at 0.78 against near-black,
// where anything over ~1.6 stops being a hard core with a halo and becomes a lamp that
// eats the chest. Checked in the workshop first, then on the terrace at noon.
//
// NOT the cause of the Mk XLII's white helmet. Dropping its core to 0.70 and its slots to
// 0.24, and the stage exposure to half, changed that frame by nothing at all
// (shots/suitup/X_face_mk42_open.png, two passes): what is blowing out there is SPECULAR
// — champagne gold at metalness 1 and low roughness mirroring the workshop's own bright
// panels through the environment map — so it belongs to that model's roughness and to
// env.js, not to any emissive number here. Written down so the next pass does not spend
// another hour turning these knobs.
const GLOW_LEVEL = {
  mk1:  { core: 1.15, slot: 0.60 },
  mk2:  { core: 1.30, slot: 0.70 },
  mk3:  { core: 1.50, slot: 0.80 },
  mk42: { core: 1.15, slot: 0.38 },
  mk50: { core: 1.55, slot: 0.75 },
};

// A glow mesh is a "core" if it is the reactor or a palm/boot emitter — the things that
// are meant to blow out — and a "slot" otherwise (eye slits, seam strips, ridge accents).
const CORE_PLATES = new Set(['reactor', 'palmL', 'palmR', 'thrusterL', 'thrusterR']);

function normaliseGlow(rig, id) {
  const lv = GLOW_LEVEL[id] || GLOW_LEVEL.mk3;
  rig.glowCores = [];
  for (const [plateName, plate] of Object.entries(rig.plates)) {
    const core = CORE_PLATES.has(plateName);
    plate.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !m.emissive) continue;
        const lum = m.emissive.r + m.emissive.g + m.emissive.b;
        if (lum < 0.02 || (m.emissiveIntensity || 0) <= 0) continue;   // not a glow material
        m.emissiveIntensity = core ? lv.core : lv.slot;
        // An additive-looking emissive that goes through tone mapping turns to mud over
        // bright ground; unmapped, the core clips to white and the bloom does the rest.
        m.toneMapped = false;
        m.userData.glowBase = m.emissiveIntensity;
        if (core) rig.glowCores.push(m);
      }
    });
  }
}

// Where the boy is standing, and which way his body faces — the spot the armour has to
// close around. `ctx.player` is engine-core's, so read it defensively and by the names
// it actually publishes: `position` is his feet, `player.yaw` is his look direction.
// (Guessing `player.object.position` silently left the armour parked at the world origin
// while he stood in the workshop 91 m up — the sequences all played to an empty room.)
export function playerStance(ctx) {
  const pl = ctx.player;
  if (!pl) return null;
  const pos = pl.position || (pl.player && pl.player.pos);
  if (!pos || typeof pos.x !== 'number') return null;
  const yaw = (pl.player && typeof pl.player.yawSmooth === 'number') ? pl.player.yawSmooth
    : (pl.player && typeof pl.player.yaw === 'number') ? pl.player.yaw
      : (typeof pl.yaw === 'number' ? pl.yaw : 0);
  // The camera yaw and the model's facing are the same convention here: the figure faces
  // -Z at yaw 0 (CONTRACT.md), and so does the on-foot camera.
  return { pos, yaw };
}
