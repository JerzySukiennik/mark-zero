// world/world.js — the PROTO stage. Owned by task `world`.
//
// The Malibu house, the town, the fairground, the donut lot, the cliff and the ocean are
// gone. They were beautiful and they were the reason the game ran badly, and none of them
// were the point: the point is the suit — putting it on, and flying it. So this is a grey
// box: a base plate, some blocks for scale and parallax, the suit-up ring and the tablet
// that drives it. Everything else in the game — suit/, suitup/, flight/, combat/, audio/ —
// is untouched and keeps working against the same world API it always used.
//
// The old world is kept beside this file as world-malibu.js.bak. It is not dead code to be
// tidied away; it is where the terrain, the house and the destructible town come back from
// when there is something worth putting them around.
//
//   ctx.world.surfaceHeight(x, z)   ground height in metres, called every 1/120 s
//   ctx.world.airDensity(alt)       0..1, scales flight drag
//   ctx.world.spawn / .spawns       start points
//   ctx.world.ring                  the suit-up circle: centre, radius, and its state
//   ctx.world.tabletAt              where the armour tablet stands
//
// It builds NO collision of its own: every solid surface goes to ctx.physics through
// props.js/Handoff, which replays the queue on 'ready' because physics initialises later.

import * as THREE from 'three';
import { buildMaterials, LODManager, Handoff } from './props.js';
import { buildSky } from './sky.js';
import { buildRing, RING } from './ring.js';
import { buildTargets } from './targets.js';

/* The plate. Big enough that you can open the throttle and still see where you started,
 * small enough to draw in one go: at 600 m a side it is two triangles and one texture. */
export const PLATE = 600;
export const GROUND = 0;

export default {
  id: 'world',

  async init(ctx) {
    const scene = ctx.scene;
    const M = buildMaterials();
    const handoff = new Handoff(ctx);
    const lod = new LODManager();
    const root = new THREE.Group();
    root.name = 'world';
    scene.add(root);

    /* ── sky ──
     * Kept, and not for the view: env.js builds its PMREM cube from it, and a metal with
     * no environment renders black. The armour needs something to reflect. */
    const sky = buildSky(scene, ctx.env && ctx.env.sun);

    /* ── the base plate ──
     * Kenney's prototype grid, CC0. A placeholder that reads as a placeholder is honest
     * about what this stage is, and the grid gives the eye something to measure speed
     * against — which a flat colour does not, and which matters when the whole game is
     * about how fast you are going. */
    const tex = new THREE.TextureLoader().load('textures/kenney/proto_dark.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(PLATE / 8, PLATE / 8);       // one tile every 8 m
    tex.anisotropy = 8;

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(PLATE, 1.2, PLATE),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0,
                                       envMapIntensity: 0.35 })
    );
    plate.name = 'base_plate';
    plate.position.y = GROUND - 0.6;
    plate.receiveShadow = true;
    root.add(plate);
    handoff.solid(plate, { kind: 'ground' });

    /* ── the blocks ──
     * Square, low-poly, deliberately dumb. They are here to give the flight model
     * something to fly between and the eye something to judge speed and height against;
     * an empty plate reads as hovering still no matter how fast you go. Seeded, so the
     * stage is the same every run and a measurement means something.
     */
    const blocks = new THREE.Group();
    blocks.name = 'blocks';
    let seed = 0x5EED;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const blockMat = new THREE.MeshStandardMaterial({
      map: (() => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(2, 2); return t; })(),
      roughness: 0.9, metalness: 0.0, envMapIntensity: 0.3,
    });
    for (let i = 0; i < 46; i++) {
      const w = 6 + Math.floor(rnd() * 5) * 4;
      const d = 6 + Math.floor(rnd() * 5) * 4;
      const h = 6 + Math.floor(rnd() * 9) * 6;
      const a = rnd() * Math.PI * 2;
      const r = 55 + rnd() * (PLATE * 0.42);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMat);
      b.position.set(Math.round(x / 4) * 4, GROUND + h / 2, Math.round(z / 4) * 4);
      b.castShadow = true; b.receiveShadow = true;
      blocks.add(b);
      handoff.solid(b, { kind: 'wall' });
    }
    root.add(blocks);

    /* ── things in the sky ──
     * Drones to shoot and gates to fly through. Without them the airspace over the plate is
     * empty and there is no reason to be up there. See world/targets.js. */
    const targets = buildTargets(ctx, handoff, { ground: GROUND, span: PLATE });
    root.add(targets.root);

    /* ── the suit-up ring ──
     * The centrepiece, and the whole reason the map went away. Built in ring.js. */
    const ring = buildRing(ctx, M, handoff);
    root.add(ring.root);

    /* ── the tablet ──
     * It went away with the house, and it is how you choose a Mark. A slate on a post
     * beside the ring, close enough to read the ring from and far enough that you have to
     * choose deliberately and then walk on. */
    {
      const g = new THREE.Group();
      g.name = 'suit_tablet';
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.05, 12),
        new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.6, metalness: 0.4 }));
      post.position.y = 0.52; g.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 20), post.material);
      foot.position.y = 0.03; g.add(foot);
      const slate = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.025), post.material);
      slate.position.set(0, 1.14, 0); slate.rotation.x = -0.42; g.add(slate);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.29),
        new THREE.MeshBasicMaterial({ color: 0x7fd4f5, toneMapped: false, fog: false }));
      screen.position.set(0, 1.147, 0.019); screen.rotation.x = -0.42; g.add(screen);
      const lamp = new THREE.PointLight(0x7fd4f5, 0.7, 4, 2);
      lamp.position.set(0, 1.25, 0.2); g.add(lamp);
      g.position.set(RING.tablet.x, GROUND, RING.tablet.z);
      g.lookAt(0, GROUND + 1.1, 0);
      g.rotation.x = 0; g.rotation.z = 0;
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      root.add(g);
      handoff.solid(post, { kind: 'prop' });
    }

    const spawn = { x: 0, y: GROUND, z: RING.radius + 6 };
    const spawns = {
      pad:    { x: 0, y: GROUND, z: RING.radius + 6, yaw: Math.PI },
      tablet: { x: RING.tablet.x + 1.2, y: GROUND, z: RING.tablet.z + 1.2, yaw: -2.2 },
      far:    { x: 0, y: GROUND, z: PLATE * 0.4, yaw: Math.PI },
      air:    { x: 0, y: 120, z: 0, yaw: 0 },
    };

    const world = {
      root, sky, materials: M, lod, plate, blocks, ring, targets,
      // The old stage's names, kept so nothing that reads them has to special-case a
      // missing map. There is no house, no basement and no display rack any more.
      malibu: null, town: null, fair: null, donut: null,
      armorStands: null, outdoor: [], basement: null,
      terrain: plate, ocean: null,
      gantryPoint: { x: 0, y: GROUND, z: 0 },
      tabletAt: { x: RING.tablet.x, y: GROUND + 1.1, z: RING.tablet.z },
      seaLevel: -40,
      spawn, spawns,
      sites: { pad: { x: 0, z: 0 } },

      /** Ground height under a point. One plate, one number — the blocks are collision,
       *  not terrain, exactly as the house never was. */
      surfaceHeight() { return GROUND; },
      /** No sea any more; keep the shape so flight.js's water checks stay valid. */
      oceanHeight() { return -1e6; },
      airDensity(alt) { return Math.exp(-Math.max(0, alt) / 8500); },
    };
    ctx.world = world;

    /* Fallback for 'debug:cam' until flight/cameraRig takes the camera. */
    ctx.bus.on('debug:cam', ({ pos, look, fov }) => {
      if (pos) ctx.camera.position.set(pos[0], pos[1], pos[2]);
      if (look) ctx.camera.lookAt(look[0], look[1], look[2]);
      if (fov) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); }
    });

    return world;
  },

  update(dt, ctx) {
    const w = ctx.world;
    if (!w) return;
    if (w.ring && w.ring.update) w.ring.update(dt, ctx);
    if (w.targets && w.targets.update) w.targets.update(dt, ctx.time);
  },

  render(ctx) {
    const w = ctx.world;
    if (!w) return;
    if (w.sky && w.sky.update) w.sky.update(ctx.camera);
    if (w.lod) w.lod.update(ctx.camera.position);
  },
};
