// world/world.js — the module. Owned by task `world`.
//
// Assembles the stage and publishes the API every other module depends on:
//
//   ctx.world.surfaceHeight(x, z)   ground/roof height in metres, called every 1/120 s
//   ctx.world.airDensity(alt)       0..1, scales flight drag
//   ctx.world.spawn                 the default start point (inside the house)
//   ctx.world.spawns                named start points
//   ctx.world.sites                 where the town / fair / donut are
//   ctx.world.armorStands           the five marks in the Hall of Armor
//   ctx.world.gantryPoint           the patch of workshop floor that opens
//   ctx.world.oceanHeight(x,z)      live wave height, for landing on water
//
// It builds NO collision of its own: every solid surface is handed to ctx.physics and
// every breakable prop to ctx.destruction through props.js/Handoff, which replays the
// queue on 'ready' because those modules initialise after this one.

import * as THREE from 'three';
import { buildMaterials, LODManager, Handoff, buildVegetation } from './props.js';
import { buildTerrain, buildMountains, terrainHeight, terrainSlope, SITES } from './cliff.js';
import { punchRect } from './props.js';
import { buildOcean } from './ocean.js';
import { buildSky } from './sky.js';
import { buildMalibu, L0, SHOP_FLOOR } from './malibu.js';
import { buildTown } from './town.js';
import { buildFair } from './fair.js';
import { buildDonut } from './donut.js';
import { blobShape } from './props.js';

/* The main-floor outline, used by surfaceHeight so you can stand on the house. Kept in
 * sync with PLATE_L0 in malibu.js by construction: same control points. */
const HOUSE_PLATE = [
  [-62, -4], [-57, -20], [-42, -31], [-20, -38], [6, -40], [30, -36],
  [46, -27], [54, -12], [52, 4], [45, 17], [29, 26], [7, 29],
  [-16, 29], [-40, 26], [-57, 16],
];
let housePoly = null;

function pointInPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].y, xj = pts[j].x, zj = pts[j].y;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export default {
  id: 'world',

  async init(ctx) {
    const { scene, camera, bus } = ctx;
    const root = new THREE.Group();
    root.name = 'world';
    scene.add(root);

    /* ── where the sun is ──
     * The world decides this, not because it owns the light — engine/env.js does — but
     * because the world decides which way the OCEAN is, and those two facts have to
     * agree. env.js parks the sun inland (+z). With the Pacific at −z that lights the
     * back of the headland, leaves the whole cliff face under the house in shadow, and
     * gives the water no specular band at all from anywhere you would ever stand. The
     * reference plates are the opposite: a lit ochre face and a glitter path running out
     * to the horizon. So the sun goes over the water.
     *
     * This is a one-line move of an existing light, and world.js already re-parks the
     * sun every frame to keep the shadow frustum on the player (see render() below) —
     * the offset it uses is simply this vector. */
    const SUN_OFFSET = new THREE.Vector3(-300, 320, -270);
    if (ctx.env && ctx.env.sun) ctx.env.sun.position.copy(SUN_OFFSET);

    const M = buildMaterials();
    const lod = new LODManager();
    const handoff = new Handoff(ctx);

    /* ── sky and fog first: everything else is lit and hazed by them ── */
    const sky = buildSky(scene, ctx.env && ctx.env.sun);

    /* The workshop footprint (SX0..SX1, SZ0..SZ1 in malibu.js), grown slightly so the
     * cut clears the room's own walls. */
    const BASEMENT = { x0: -29, x1: 23, z0: -9, z1: 35 };

    /* ── land ── */
    const terrain = new THREE.Mesh(
      /* 640 segments over a 420 m dense band, not 576 over 640 m.
       *
       * The grid is non-uniform (see buildTerrain), so `near` is the half-width of the
       * roughly-even middle and 2*near/segments is the spacing there. At 640/576 that was
       * 2.2 m, which renders a 96 m cliff as forty rows of quads and, once the normals
       * are smoothed, as a dune with ripples on it. 420/640 gives 1.3 m — the erosion
       * flutes in the height field are 3.6 m across, so they finally have three vertices
       * each to be a shape rather than a wobble. The cost is on the far field, which is
       * exactly the right place to pay it: at 3 km a vertex every 90 m or every 120 m is
       * the same picture. */
      // The workshop is a basement, so the ground has to be dug out of the way. Without
      // this the terrain sits flat at the house pad's 96 m right through the room, the
      // stairwell opens onto solid rock, and the whole armor bay is buried. Cut from the
      // mesh rather than lowered, so the plateau outside the house is untouched.
      punchRect(buildTerrain({ segments: 640, extent: 6400, near: 420, zCenter: -30 }), BASEMENT),
      new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.98, metalness: 0.0,
        /* Anisotropic rock rather than isotropic grain, and four times the amplitude.
         * The mesh can only ever carry metre-scale form; everything finer than a vertex
         * has to come from here, and a bump map whose features have no direction cannot
         * make a wall look eroded no matter how strong it is. */
        bumpMap: M._textures.rock, bumpScale: 1.15,
      })
    );
    terrain.name = 'terrain';
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    root.add(terrain);

    /* Physics gets a SEPARATE, coarse copy of the terrain — 26 000 triangles over the
     * 2.5 km the player actually fights in. Handing Rapier the 280 000-triangle visual
     * mesh locks the tab for a minute while it builds the BVH; measured, not guessed.
     * Long-range ground queries go through surfaceHeight() instead, which is analytic. */
    const collider = new THREE.Mesh(
      punchRect(buildTerrain({ segments: 150, extent: 2400, near: 700, zCenter: -40 }), BASEMENT),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    collider.name = 'terrain-collision';
    collider.visible = false;
    root.add(collider);
    handoff.solid(collider, { kind: 'terrain' });

    const mountains = buildMountains();
    root.add(mountains);

    /* ── chaparral ──
     * The land was bare. In malibu_cliff_hero the headland is covered in grey-green
     * scrub with rock showing only on the steep faces, and without it our cliff read as
     * a sand dune from every altitude. Two rings, both instanced:
     *
     *   near  everything the player flies over in the first minute, at 30 m spacing
     *   far   the 10 km bowl behind it, at 110 m spacing with the props scaled up so
     *         the same instance count covers thirty times the area
     *
     * Neither ring casts a shadow: a 1.5 m bush at 400 m is smaller than a shadow-map
     * texel, so what lands on the ground is aliasing, not shadow. */
    const keepOut = [
      { x: 0, z: 20, r: 105 },                                    // the house and its court
      { x: SITES.town.x, z: SITES.town.z, r: 250 },
      { x: SITES.fair.x, z: SITES.fair.z, r: 235 },
      { x: SITES.donut.x, z: SITES.donut.z, r: 105 },
    ];
    const vegNear = buildVegetation(M, {
      heightAt: terrainHeight, slopeAt: terrainSlope, keepOut,
      area: { x0: -2400, x1: 3700, z0: -420, z1: 2300 },
      step: 24, detail: 0, scale: 1, seed: 0, treeChance: 0.05,
    });
    root.add(vegNear);

    /* A THIRD ring, close in, at 9 m spacing.
     * The near ring above samples every 24 m. A 1.5 m bush every 24 m is not chaparral,
     * it is a lawn with occasional shrubs on it — from the hero angle the headland came
     * back as a smooth green field with a scattering of dark specks, and the specks read
     * as dirt rather than as plants. Coastal sage grows shoulder to shoulder. This ring
     * covers only the 1.5 x 0.7 km the player sees in the first minute (the house, the
     * cliff lip and the ground either side of it) and is culled at 900 m, so the cost is
     * paid exactly where it is visible and nowhere else. */
    const vegClose = buildVegetation(M, {
      heightAt: terrainHeight, slopeAt: terrainSlope, keepOut,
      area: { x0: -760, x1: 760, z0: -280, z1: 460 },
      step: 9, detail: 0, scale: 1.0, seed: 233, treeChance: 0.03, maxSlope: 0.75,
    });
    root.add(vegClose);
    lod.add(vegClose, 900, { center: new THREE.Vector3(0, 96, 20) });

    const vegFar = buildVegetation(M, {
      heightAt: terrainHeight, slopeAt: terrainSlope, keepOut,
      area: { x0: -5200, x1: 5200, z0: -900, z1: 5200 },
      step: 115, detail: 0, scale: 3.4, seed: 91, treeChance: 0.04, maxSlope: 0.7,
    });
    root.add(vegFar);

    /* ── ocean ── */
    const ocean = buildOcean(ctx, ctx.env && ctx.env.sun);
    root.add(ocean.mesh);

    /* ── the buildings ── */
    const malibu = buildMalibu(ctx, M, handoff, lod);
    root.add(malibu.root);

    const town = buildTown(ctx, M, handoff, lod);
    root.add(town.root);

    const fair = buildFair(ctx, M, handoff, lod);
    root.add(fair.root);

    const donut = buildDonut(ctx, M, handoff, lod);
    root.add(donut.root);

    housePoly = blobShape(HOUSE_PLATE).outline;

    /* ── the shadow camera has to follow the player, or a 90 x 90 m box out at the
     * origin shadows nothing once you fly. Cheap and it matters a lot. ── */
    const sun = ctx.env && ctx.env.sun;
    const sunOffset = SUN_OFFSET.clone();

    /* ── the API ── */
    const spawns = {
      // where the boy starts: inside the living room, looking out at the ocean
      living:    { x: 4,   y: L0 + 0.05,        z: 18,  yaw: Math.PI },
      terrace:   { x: 0,   y: L0 + 0.05,        z: -34, yaw: Math.PI },
      entrance:  { x: 6,   y: L0 + 0.05,        z: 70,  yaw: Math.PI },
      workshop:  { x: -6,  y: SHOP_FLOOR + 0.05, z: 26, yaw: 0 },
      gantry:    { x: malibu.gantryPoint.x, y: SHOP_FLOOR + 0.05, z: malibu.gantryPoint.z, yaw: 0 },
      // flight starts / debug perches
      launch:    { x: 0,   y: L0 + 30,  z: -70,  yaw: Math.PI },
      offshore:  { x: 0,   y: 260,      z: -1400, yaw: 0 },
      donutTop:  donut.landing,
      townAir:   { x: SITES.town.x, y: 320, z: SITES.town.z },
      fairAir:   { x: SITES.fair.x, y: 180, z: SITES.fair.z },
    };

    const world = {
      root, terrain, ocean, sky, malibu, town, fair, donut, materials: M, lod,
      vegetation: { close: vegClose, near: vegNear, far: vegFar },

      /**
       * Ground height under a point, in metres. This is the analytic terrain plus the
       * few walkable man-made surfaces that the player is expected to stand on. Real
       * per-triangle collision is ctx.physics' job; this is the cheap query flight.js
       * runs every step for altitude and ground proximity.
       */
      surfaceHeight(x, z) {
        let h = terrainHeight(x, z);
        if (housePoly && pointInPoly(housePoly, x, z)) h = Math.max(h, L0);
        // the donut shop roof
        const dd = Math.hypot(x - SITES.donut.x, z - SITES.donut.z);
        if (dd < 15) h = Math.max(h, terrainHeight(SITES.donut.x, SITES.donut.z) + 5.75);
        return h;
      },

      /** Air density 0..1 by altitude MSL. Flight scales drag and thrust by this. */
      airDensity(alt) {
        return Math.max(0.14, Math.exp(-Math.max(0, alt) / 8500));
      },

      /** Live ocean surface height at a point — the waves actually move. */
      oceanHeight(x, z) { return ocean.heightAt(x, z, ctx.time); },

      spawn: spawns.living,
      spawns,
      sites: SITES,
      armorStands: malibu.armorStands,
      gantryPoint: malibu.gantryPoint,
      gantry: malibu.gantry,
      glassPanels: malibu.glassPanels,
      seaLevel: 0,

      /** Named camera framings, so a critic can reproduce a reference angle exactly. */
      viewpoints: {
        /* Matched to reference/world/malibu_cliff_hero.jpg: a long lens from out over the
         * water, slightly above the house, the cliff face filling the bottom third.
         *
         * The distance is the whole shot and it was 380 m out, which made the house about
         * an eighth of the frame — put side by side with the plate, the reference is a
         * PORTRAIT of a building and ours was a landscape with a building in it. That is
         * not a modelling failure, it is a lens: at 208 m on the same 40 mm-equivalent the
         * 116 m frontage covers 45 % of the frame, which is what the plate does. */
        cliffHero:   { pos: [-118, 128, -152], look: [8, 96, 8],   fov: 40 },
        cliffFar:    { pos: [-235, 138, -305], look: [10, 94, -6], fov: 40 },
        cliffWide:   { pos: [-430, 240, -520], look: [0, 96, 20],   fov: 40 },
        heroSea:     { pos: [40, 132, -300],   look: [-2, 94, 6],   fov: 40 },
        exterior:    { pos: [60, 104, 118],    look: [0, 99, 30],   fov: 42 },
        terrace:     { pos: [-6, 98.2, -74],   look: [10, 99.6, -14], fov: 58 },
        living:      { pos: [22, 97.7, 10],    look: [-14, 96.6, -40], fov: 64 },
        /* Both of these were 25-40 m shots down a dark room that env.js fogs from 8 m.
         * Everything they framed sat behind the fog and the render came back as a black
         * rectangle with four blue dots in it. malibu_workshop_a is a short lens on a
         * bench, and hall_of_armor_cases is taken from inside the aisle — so both move
         * in close, where the clutter and the case lighting actually are. */
        /* Framed like the plate: standing at the end of the console run, shooting ALONG
         * it into the monitor wall from 9 m. The previous framing looked across 20 m of
         * open floor, which the workshop's own fog turns to black — the picture was the
         * far wall, and the far wall is the one thing in this room that is empty. */
        workshop:    { pos: [-5.5, 92.6, 1.0], look: [-15, 92.15, -6.2], fov: 48 },
        workshopWide:{ pos: [12, 93.6, 24],    look: [-8, 91.8, 8],    fov: 60 },
        hallOfArmor: { pos: [-17, 92.5, 20],   look: [-25.5, 92.1, 8], fov: 55 },
        donutLow:    donut.hero,
        fairAir:     { pos: [SITES.fair.x + 150, SITES.fair.h + 90, SITES.fair.z - 150],
                       look: [SITES.fair.x, SITES.fair.h + 25, SITES.fair.z], fov: 45 },
        townAir:     { pos: [SITES.town.x - 500, SITES.town.h + 340, SITES.town.z - 620],
                       look: [SITES.town.x, SITES.town.h, SITES.town.z], fov: 42 },
        oceanLow:    { pos: [120, 26, -700],   look: [-200, 60, -1500], fov: 55 },
        highAltitude:{ pos: [-200, 620, -900], look: [0, 90, 40],   fov: 48 },
      },
    };

    ctx.world = world;

    /* Fallback for 'debug:cam'. flight/cameraRig.js owns the camera and will overwrite
     * this the moment it lands — it runs later in the module order — but until it does,
     * a critic still needs to be able to frame a shot. */
    bus.on('debug:cam', ({ pos, look, fov }) => {
      if (pos) camera.position.set(pos[0], pos[1], pos[2]);
      if (look) camera.lookAt(look[0], look[1], look[2]);
      if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    });
    bus.on('debug:view', (name) => {
      const v = world.viewpoints[name];
      if (v) bus.emit('debug:cam', v);
    });

    /* A viewpoint can be requested in the URL: index.html#view=cliffHero — the way a
     * headless browser (which cannot type into a console) frames a reference shot. */
    const applyHash = () => {
      const m = /view=([A-Za-z]+)/.exec(location.hash || '');
      if (m) bus.emit('debug:view', m[1]);
    };
    bus.on('ready', () => { applyHash(); });
    window.addEventListener('hashchange', applyHash);

    this._ctx = ctx;
    this._sunOffset = sunOffset;
    this._fwd = new THREE.Vector3();
    // Widen the shadow box to cover what a 45-degree lens actually sees at 110 m.
    // env.js owns the light; the world owns how big the world is.
    if (sun && sun.shadow) {
      const c = sun.shadow.camera;
      c.left = -240; c.right = 240; c.top = 240; c.bottom = -240;
      c.near = 1; c.far = 1400;
      c.updateProjectionMatrix();
      sun.shadow.normalBias = 0.06;
    }
    this._sun = sun;
    this._lod = lod;
    this._frame = 0;
  },

  update(dt, ctx) {
    const w = ctx.world;
    if (!w) return;
    w.fair.update(dt);
    w.malibu.update(dt, ctx.time);
  },

  /**
   * Collapses every point light in the world onto a fixed-size pool.
   *
   * The workshop is lit in pools, which is right, but it was doing it with 64 real
   * PointLights. This renderer is forward-shaded: every active light costs shader work on
   * every one of the ~6500 meshes, and the light count is compiled INTO each material's
   * program — so 1000+ materials each got a 64-light shader, and every newly revealed
   * material (an armor plate appearing during suit-up) compiled one on the spot. That is
   * the stutter when a suit goes on, and the low frame rate underground.
   *
   * The pool is a CONSTANT eight lights. Constant matters as much as eight: if the count
   * changed as you walked, three.js would recompile every shader at the moment it changed,
   * which trades a steady low frame rate for a stutter. Each frame the eight nearest
   * sources are copied into the pool, so what you see is the lighting you had, minus the
   * lamps too far away to matter.
   */
  _buildLightPool(ctx, root) {
    const THREE_ = THREE;
    const sources = [];
    root.traverse(o => {
      if (o.isPointLight && !o.userData.poolLight) sources.push(o);
    });
    if (sources.length <= 10) return null;

    const recs = sources.map(l => {
      const p = new THREE_.Vector3();
      l.getWorldPosition(p);
      return {
        pos: p,
        color: l.color.clone(),
        intensity: l.intensity,
        distance: l.distance,
        decay: l.decay,
      };
    });
    // Detach rather than set .visible = false. Other systems (env presets, LOD) walk the
    // graph and turn lights back on, and a light that comes back is a light the shader
    // has to compile for again. Removed from the graph, it cannot be revived by accident.
    for (const l of sources) { l.userData.pooledAway = true; l.removeFromParent(); }

    const POOL = 8;
    const pool = [];
    for (let i = 0; i < POOL; i++) {
      const l = new THREE_.PointLight(0xffffff, 0, 10, 2);
      l.userData.poolLight = true;
      l.castShadow = false;
      ctx.scene.add(l);
      pool.push(l);
    }
    return { recs, pool, _tmp: new THREE_.Vector3() };
  },

  _updateLightPool(camPos, ctx) {
    const lp = this._lightPool;
    if (!lp) return;
    const { recs, pool } = lp;

    // Lights created after the pool was built (rooms stream in) would otherwise sit
    // outside it and put the shader cost straight back. Sweep occasionally and absorb.
    lp._t = (lp._t || 0) + 1;
    if (lp._t % 90 === 0 && ctx && ctx.scene) {
      const fresh = [];
      ctx.scene.traverse(o => {
        if (o.isPointLight && !o.userData.poolLight && !o.userData.pooledAway) fresh.push(o);
      });
      for (const l of fresh) {
        const p = new THREE.Vector3();
        l.getWorldPosition(p);
        recs.push({ pos: p, color: l.color.clone(), intensity: l.intensity,
                    distance: l.distance, decay: l.decay });
        l.userData.pooledAway = true;
        l.removeFromParent();
      }
    }
    this._reapDarkLights(ctx);

    for (const r of recs) r._d = r.pos.distanceToSquared(camPos);
    recs.sort((a, b) => a._d - b._d);
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i], r = recs[i];
      if (!r) { l.intensity = 0; continue; }
      l.position.copy(r.pos);
      l.color.copy(r.color);
      l.distance = r.distance;
      l.decay = r.decay;
      // Fade the last one in and out with range instead of popping it on.
      const d = Math.sqrt(r._d);
      const reach = r.distance > 0 ? r.distance : 40;
      l.intensity = r.intensity * (d > reach * 1.6 ? 0 : 1);
    }
  },

  /* A LIGHT AT ZERO INTENSITY IS NOT A FREE LIGHT.
   *
   * three's forward renderer compiles the light COUNT into every material's shader and
   * evaluates every one of them per fragment. A spotlight turned down to zero still costs
   * a full lighting term on all 1000-odd materials in the scene, for a contribution of
   * exactly nothing. Measured live: 19 lights in the scene, EIGHT of them at intensity 0 —
   * the three suit-up stage spots and five of the indoor-daylight set, all of which spend
   * most of the game switched off.
   *
   * So they come out of the graph entirely and go back the moment their owner turns them
   * up again. Their owners keep their own references and go on setting `intensity` on the
   * detached object, so nothing else has to know this is happening. The pooled point
   * lights above are excluded — they have their own manager. */
  _reapDarkLights(ctx) {
    if (!ctx || !ctx.scene) return;
    const dark = this._dark || (this._dark = []);
    for (let i = dark.length - 1; i >= 0; i--) {
      const e = dark[i];
      if (e.light.intensity > 0.001) {
        e.parent.add(e.light);
        e.light.userData.reaped = false;
        dark.splice(i, 1);
      }
    }
    this._reapT = (this._reapT || 0) + 1;
    if (this._reapT % 30 !== 0) return;
    const found = [];
    ctx.scene.traverse(o => {
      if (!o.isLight || o.userData.poolLight || o.userData.pooledAway) return;
      if (o.isHemisphereLight) return;             // one uniform, and it is always on
      if (o.intensity <= 0.001 && o.parent) found.push(o);
    });
    for (const l of found) {
      dark.push({ light: l, parent: l.parent });
      l.userData.reaped = true;
      l.removeFromParent();
    }
  },

  // Per drawn frame, not per simulation tick: purely visual bookkeeping.
  render(ctx) {
    const w = ctx.world;
    if (!w) return;
    const cam = ctx.camera;
    if (this._lightPool === undefined) this._lightPool = this._buildLightPool(ctx, ctx.scene);
    this._updateLightPool(cam.position, ctx);
    w.sky.update(cam);
    if (ctx.env && w.sky.setMix) w.sky.setMix(ctx.env.k || 0);
    w.ocean.update(ctx.dt, cam, ctx.time);
    this._lod.update(cam.position);

    /* Shadow frustum.
     *
     * It follows what you are LOOKING AT, not where you are standing. Centred on the
     * camera itself, a 180 m box leaves everything past 90 m outside the shadow map;
     * three.js clamps the lookup at the edge of the map, so the last texel row gets
     * smeared over the whole distance and the ground bands into hard diagonal stripes.
     * That is what the fairground plaza was doing — read as shadow acne, actually a
     * frustum a kilometre short of the subject.
     *
     * Pushing the centre 110 m down the view direction, and widening the box to ±240 m
     * (0.23 m per texel on a 2048 map, fine for a world whose smallest shadow caster is
     * a lamp post), puts the whole visible foreground inside it at any speed.
     * Everything is snapped to 4 m so the map does not shimmer while flying at 290 m/s.
     */
    const sun = this._sun;
    if (sun) {
      cam.getWorldDirection(this._fwd);
      const fx = cam.position.x + this._fwd.x * 110;
      const fz = cam.position.z + this._fwd.z * 110;
      const fy = cam.position.y + this._fwd.y * 110;
      const sx = Math.round(fx / 4) * 4;
      const sz = Math.round(fz / 4) * 4;
      const sy = Math.round(fy / 4) * 4;
      sun.target.position.set(sx, sy, sz);
      sun.target.updateMatrixWorld();
      sun.position.set(sx + this._sunOffset.x, sy + this._sunOffset.y, sz + this._sunOffset.z);
    }
  },
};
