// world/town.js — the small coastal town. Owned by task `world`.
//
// Its job is not to be interesting on its own: it is the thing that gives the flight a
// sense of speed and scale, and it must survive being crossed in four seconds at 290 m/s.
// So: a real street grid with kerbs, centre lines and lamp posts (the lamp posts are what
// read as "town" from 300 m up), buildings whose height varies block by block, and one
// palm-lined boulevard running back toward the coast road.
//
// Everything solid goes to ctx.physics; every lamp post and shopfront window goes to
// ctx.destruction.

import * as THREE from 'three';
import { SITES, terrainHeight } from './cliff.js';
import { facadeTexture, palmTree } from './props.js';

const S = SITES.town;
const ROT = -0.32;                      // the grid is not axis-aligned; nothing ever is

function place(x, z) {
  // town-local (x,z) -> world, rotated about the site centre
  const c = Math.cos(ROT), s = Math.sin(ROT);
  return [S.x + x * c - z * s, S.z + x * s + z * c];
}

export function buildTown(ctx, M, handoff, lod) {
  const root = new THREE.Group();
  root.name = 'town';
  root.rotation.y = -ROT;
  root.position.set(S.x, S.h, S.z);

  const BLOCK = 66, ROAD = 15, N = 5;
  const span = N * (BLOCK + ROAD);

  /* ── ground ──
   * NOT one asphalt sheet. A single 405 m square of dark tarmac under the whole town is
   * what made the aerial shot read as a chessboard dropped on a desert: a hard black
   * rectangle with a straight edge that nothing in the landscape explains. Streets are
   * laid as STRIPS, the blocks get their own pavement, and the ground between and around
   * them stays terrain — so the town has a ragged edge and the desert runs into it. */
  const half0 = N * (BLOCK + ROAD) / 2;
  {
    const roadMat = M.asphalt.clone();
    roadMat.map = M.asphalt.map.clone();
    roadMat.map.repeat.set(1, 26);
    roadMat.map.needsUpdate = true;
    for (let i = 0; i <= N; i++) {
      const rz = -half0 + ROAD / 2 + i * (BLOCK + ROAD) - ROAD / 2 + ROAD / 2;
      // a little overshoot at each end so the grid frays into the scrub instead of
      // stopping dead on a line
      const over = 40 + (i % 3) * 34;
      for (const along of [true, false]) {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, N * (BLOCK + ROAD) + over), roadMat);
        r.rotation.x = -Math.PI / 2;
        if (along) { r.rotation.z = Math.PI / 2; r.position.set(0, 0.25, rz); }
        else r.position.set(rz, 0.25, 0);
        r.receiveShadow = true;
        root.add(r);
        handoff.solid(r, { kind: 'ground' });
      }
    }
  }

  const half = span / 2;
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x6e7a45, roughness: 1.0 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8cf9a, toneMapped: false });
  /* Its own material, and darker than M.concrete (0xa9a49b).
   * The sidewalk is now a ribbon around every block rather than a full paved slab, and a
   * pale ribbon around twenty-five blocks draws twenty-five bright picture frames on the
   * ground — from the air the town read as a grid of white rectangles, which is a worse
   * failure than the solid raft it replaced. Weathered grey-tan sits close enough to the
   * dirt that the frame stops being the loudest thing in the picture. */
  const kerbMat = new THREE.MeshStandardMaterial({
    color: 0x8b857a, roughness: 0.95,
    bumpMap: M._textures.grain, bumpScale: 0.03,
  });

  const buildings = new THREE.Group();
  const lamps = new THREE.Group();
  const cars = new THREE.Group();
  const trees = new THREE.Group();

  /* Nine facades, not five, and they carry real HUE difference — a warm terracotta, a
   * cool grey-blue, a bleached mint — not five shades of the same beige. From 300 m up
   * the individual windows are gone and the only thing left of a building is its colour
   * patch, so a town of one colour reads as one object. */
  const facades = [
    facadeTexture({ wall: '#c9bfae', cols: 5, rows: 3 }),
    facadeTexture({ wall: '#b0a596', cols: 7, rows: 4 }),
    facadeTexture({ wall: '#d9d2c4', cols: 4, rows: 3 }),
    facadeTexture({ wall: '#a8968a', cols: 6, rows: 5 }),
    facadeTexture({ wall: '#e0d6c0', cols: 5, rows: 4 }),
    facadeTexture({ wall: '#b9754f', cols: 5, rows: 3 }),
    facadeTexture({ wall: '#8d9aa2', cols: 6, rows: 4 }),
    facadeTexture({ wall: '#cfd6c6', cols: 4, rows: 2 }),
    facadeTexture({ wall: '#7f6f63', cols: 7, rows: 5 }),
  ];
  const facadeMats = facades.map(t => new THREE.MeshStandardMaterial({
    color: 0xffffff, map: t, roughness: 0.88,
  }));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.95 });

  let rng = 12345;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let bx = 0; bx < N; bx++) {
    for (let bz = 0; bz < N; bz++) {
      const cx = -half + ROAD / 2 + BLOCK / 2 + bx * (BLOCK + ROAD);
      const cz = -half + ROAD / 2 + BLOCK / 2 + bz * (BLOCK + ROAD);

      /* ── the block surface ──
       * Not a 69 m paved slab. That is what turned the aerial into a chessboard: twenty
       * five light grey squares separated by twenty dark grey ones, edge to edge, with a
       * dead straight boundary where it all stops. A real small town is mostly DIRT and
       * yard between its buildings, with pavement only as a four-metre ribbon at the
       * kerb — so the block gets a sidewalk frame and its interior is left as terrain,
       * which here is exactly flat (the site pad guarantees it) and already the right
       * dusty colour. The grid then reads as buildings standing in a landscape instead of
       * tiles on a board. */
      const park = rand() < 0.16;
      const B2 = BLOCK / 2 + 1.5, WALK = 2.8;
      for (const [sx, sz, sw, sd] of [
        [0, -B2 + WALK / 2, B2 * 2, WALK], [0, B2 - WALK / 2, B2 * 2, WALK],
        [-B2 + WALK / 2, 0, WALK, B2 * 2 - WALK * 2], [B2 - WALK / 2, 0, WALK, B2 * 2 - WALK * 2],
      ]) {
        const walk = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.22, sd), kerbMat);
        walk.position.set(cx + sx, 0.36, cz + sz);
        walk.receiveShadow = true;
        root.add(walk);
        handoff.solid(walk, { kind: 'ground' });
      }
      if (park) {
        const lawn = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 6, 0.16, BLOCK - 6), grassMat);
        lawn.position.set(cx, 0.33, cz);
        lawn.receiveShadow = true;
        root.add(lawn);
        handoff.solid(lawn, { kind: 'ground' });
      }

      if (park) {
        // a green square with trees. Two of these in a grid of twenty-five is the
        // difference between "a town" and "a warehouse district".
        for (let t = 0; t < 9; t++) {
          const tr = palmTree(M, 7 + rand() * 4, (bx * 7 + bz * 13 + t) * 3);
          tr.position.set(cx + (rand() - 0.5) * (BLOCK - 10), 0.45, cz + (rand() - 0.5) * (BLOCK - 10));
          trees.add(tr);
        }
        continue;
      }

      /* 2-4 buildings per block, leaving a yard — and the number and height of them
       * falls off towards the edge of the grid. A town whose outermost block is as dense
       * and as tall as its centre has no skyline and no edge; it just stops. `edge` is
       * how far this block is from the middle, 0 at the core and 1 at the rim. */
      const edge = Math.max(Math.abs(bx - (N - 1) / 2), Math.abs(bz - (N - 1) / 2)) / ((N - 1) / 2);
      const nB = Math.max(1, Math.round((2 + rand() * 3) * (1 - edge * 0.45)));
      for (let i = 0; i < nB; i++) {
        const w = 14 + rand() * 20;
        const d = 14 + rand() * 20;
        const tall = bx === 2 && bz === 2 ? 8 : 4;
        const floors = Math.max(0, Math.round((rand() * tall) * (1 - edge * 0.6)));
        const h = 4.2 + floors * 3.4;
        const ox = cx + (rand() - 0.5) * (BLOCK - w - 4);
        const oz = cz + (rand() - 0.5) * (BLOCK - d - 4);
        const mat = facadeMats[(rand() * facadeMats.length) | 0];
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        b.position.set(ox, h / 2 + 0.22, oz);
        b.castShadow = b.receiveShadow = true;
        // repeat the facade so window size stays constant across building sizes
        buildings.add(b);
        handoff.solid(b, { kind: 'building' });

        /* A plinth. The block used to be one 69 m paved slab and every building stood on
         * it; now the block interior is bare terrain, so without this each building would
         * float 22 cm above the dirt with daylight under it — visible from the ground and
         * from any low pass. The plinth is wider than the building, so it also reads as
         * the strip of concrete every shopfront in a town like this actually has. */
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 2.2, 0.24, d + 2.2), kerbMat);
        plinth.position.set(ox, 0.12, oz);
        plinth.receiveShadow = true;
        buildings.add(plinth);
        handoff.solid(plinth, { kind: 'ground' });

        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
        roof.position.set(ox, h + 0.45, oz);
        roof.castShadow = true;
        buildings.add(roof);

        // rooftop clutter: aircon boxes and a stair head. Reads from the air, which is
        // the only angle the player will ever see a roof from.
        for (let k = 0; k < 2 + (rand() * 3 | 0); k++) {
          const cw = 1.2 + rand() * 2;
          const cb = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.9 + rand(), cw * 0.8), M.steel);
          cb.position.set(ox + (rand() - 0.5) * (w - 3), h + 1.1, oz + (rand() - 0.5) * (d - 3));
          cb.castShadow = true;
          buildings.add(cb);
        }

        // ground-floor shopfront glass — breakable
        if (floors <= 3) {
          const gl = new THREE.Mesh(
            new THREE.PlaneGeometry(w * 0.8, 3.0),
            new THREE.MeshPhysicalMaterial({
              color: 0x18262e, roughness: 0.08, transparent: true, opacity: 0.5,
              envMapIntensity: 2.0, side: THREE.DoubleSide, depthWrite: false,
            })
          );
          gl.position.set(ox, 1.9, oz - d / 2 - 0.06);
          gl.renderOrder = 4;
          buildings.add(gl);
          handoff.breakable(gl, { material: 'glass', pieces: 16, mass: 55, threshold: 0.4 });
        }
      }
    }
  }

  /* ── street furniture ── */
  function lampPost(x, z, ry) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.15, 7.2, 8), M.darkSteel);
    pole.position.y = 3.6; pole.castShadow = true;
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 7.0, 0), new THREE.Vector3(0.5, 7.5, 0), new THREE.Vector3(1.6, 7.55, 0),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 8, 0.075, 6, false), M.darkSteel);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.42), M.darkSteel);
    head.position.set(1.75, 7.45, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.36), M.lampGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(1.75, 7.34, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 8), M.concrete);
    base.position.y = 0.25;
    g.add(pole, arm, head, glow, base);
    g.position.set(x, 0.47, z);
    g.rotation.y = ry;
    lamps.add(g);
    handoff.breakable(pole, {
      material: 'metal', pieces: 5, mass: 190, threshold: 1.4, group: g, topples: true,
    });
    return g;
  }

  for (let i = 0; i <= N; i++) {
    const rz = -half + ROAD / 2 + i * (BLOCK + ROAD) - ROAD / 2;
    for (let j = 0; j < 14; j++) {
      const x = -half + 14 + j * (span / 14);
      lampPost(x, rz + ROAD / 2 - 1.2, Math.PI);
      if (j % 2 === 0) lampPost(rz + ROAD / 2 - 1.2, x, -Math.PI / 2);
    }
    // centre line
    for (let j = 0; j < 40; j++) {
      const x = -half + j * (span / 40) + 2;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.28), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.27, rz + ROAD / 2 - 7.5 + 7.5);
      root.add(dash);
      const dash2 = dash.clone();
      dash2.rotation.z = Math.PI / 2;
      dash2.position.set(rz + ROAD / 2, 0.27, x);
      root.add(dash2);
    }
  }

  // parked cars along the kerbs — pure silhouette, but they scale the street
  const carColors = [0xb63a2c, 0x243447, 0xd8d4cc, 0x2b2b2e, 0x486a52, 0x8c8f94];
  for (let i = 0; i < 70; i++) {
    const rzi = (rand() * (N + 1)) | 0;
    const rz = -half + ROAD / 2 + rzi * (BLOCK + ROAD) - ROAD / 2 + ROAD / 2;
    const x = -half + rand() * span;
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 1.85),
      new THREE.MeshStandardMaterial({
        color: carColors[(rand() * carColors.length) | 0], roughness: 0.35, metalness: 0.5,
      }));
    body.position.y = 0.72;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 1.7), M.glassClear);
    cab.position.set(-0.2, 1.35, 0);
    const g = new THREE.Group();
    g.add(body, cab);
    const along = rand() < 0.5;
    g.position.set(along ? x : rz + 5.2, 0.22, along ? rz + 5.2 : x);
    g.rotation.y = along ? 0 : Math.PI / 2;
    body.castShadow = true;
    cars.add(g);
    handoff.solid(body, { kind: 'car' });
  }

  // boulevard palms
  for (let i = 0; i < 26; i++) {
    const t = palmTree(M, 8 + (i % 3), i * 5);
    const x = -half + 20 + i * (span - 40) / 25;
    t.position.set(x, 0.22, -half + ROAD / 2 + 2 * (BLOCK + ROAD) - ROAD / 2 + 4);
    trees.add(t);
  }

  root.add(buildings, lamps, cars, trees);

  // LOD: cars, trees and lamps are detail. Buildings stay: they are the silhouette.
  const centre = new THREE.Vector3(S.x, S.h, S.z);
  lod.add(cars, 900, { center: centre });
  lod.add(trees, 1400, { center: centre });
  lod.add(lamps, 1800, { center: centre });

  // sink the whole town onto its pad
  root.position.y = terrainHeight(S.x, S.z);

  return { root, lampCount: lamps.children.length };
}
