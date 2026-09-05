// world/donut.js — the gas station with the giant donut on the roof. Owned by `world`.
//
// Reference: randys_donuts_a.jpg. Everything about that photograph is scale comedy — a
// low wide lens looking UP, the donut filling the sky, the shop underneath it squat and
// ordinary. So three things are non-negotiable here:
//
//   * the donut is BIG. 22 m across, sitting on a 5 m building. Flying at it low, it has
//     to block the sky.
//   * the surface is NOT a smooth torus. It is hand-troweled stucco: gritty, pitted with
//     thumb-sized craters, beige going warm in the light and grey-brown in the pits. The
//     geometry is displaced, not just bump-mapped, so the silhouette is lumpy too.
//   * the lettering is painted black with a white outline, arced over the top and along
//     the bottom, and it is the thing that makes people recognise it instantly.
//
// The top of the donut is a landable surface: it goes to ctx.physics as a trimesh and
// ctx.world.spawns.donutTop parks you on it.

import * as THREE from 'three';
import { SITES, terrainHeight } from './cliff.js';
import { fbm, ridged, stuccoTextures } from './props.js';

const S = SITES.donut;
export const DONUT_R = 7.4;      // ring radius
export const DONUT_r = 3.6;      // tube radius
const ROOF_Y = 5.4;
// bottom of the ring tucks just behind the roof fascia, as in the photograph
const DONUT_Y = ROOF_Y + 1.0 + DONUT_R + DONUT_r * 0.55;

/* Lettering. Drawn into the same UV space the torus below is built with:
 * u = angle around the ring, v = angle around the tube (v = 0.25 is dead centre of the
 * face pointing at +Z). The two texts need opposite mirroring because at the top of the
 * ring the surface runs one way and at the bottom it runs the other — see the comments. */
function letteringCanvas() {
  const W = 2048, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);

  // u (canvas x) runs once around the RING, v (canvas y) once around the TUBE. So the
  // two axes have wildly different metric scales:
  //   ring circumference  = 2*pi*7.4  = 46.5 m over 2048 px  -> 44 px/m
  //   tube circumference  = 2*pi*3.6  = 22.6 m over  512 px  -> 22.6 px/m
  // Getting that wrong is what made the first cut illegible: the text was drawn 210 px
  // tall, which is 9.3 m of letter wrapped 40 % of the way around the tube — it ran off
  // the face and down both sides. In the photograph the letters are about 2.6 m tall and
  // the word spans roughly 115 deg of the ring, which is the pair of numbers below.
  const PX_PER_M_U = 2048 / (2 * Math.PI * 7.4);
  const PX_PER_M_V = 512 / (2 * Math.PI * 3.6);
  const LETTER_H = 2.6 * PX_PER_M_V;                // ~59 px
  const WORD_W = (115 / 360) * 2048;                // ~654 px

  // v = 0.25 is the outward face (tube normal +Z). CanvasTexture flips Y, so that is
  // canvas y = H * (1 - 0.25).
  const V_FACE = H * (1 - 0.25);

  function arcText(text, cx, cy, flipX, flipY) {
    g.save();
    g.translate(cx, cy);
    g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    g.font = `900 ${LETTER_H}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // stretch horizontally so the word covers the arc it does in the photograph
    const w = Math.max(1, g.measureText(text).width);
    g.scale(WORD_W / w, 1);
    g.lineJoin = 'round';
    g.lineWidth = LETTER_H * 0.26 * (w / WORD_W);
    g.strokeStyle = '#ffffff';
    g.strokeText(text, 0, 0);
    g.fillStyle = '#15161a';
    g.fillText(text, 0, 0);
    g.restore();
  }

  // Which way the surface runs, derived rather than guessed. At u = 0.25 (top of the
  // ring) increasing u walks the surface LEFT across the screen and increasing v walks
  // it DOWN, so the word is laid down rotated 180 deg. At u = 0.75 (bottom of the ring)
  // both axes agree with the screen and it is drawn straight.
  arcText("RANDY'S", 0.25 * W, V_FACE, true, true);
  arcText('DONUTS', 0.75 * W, V_FACE, false, false);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * A torus built by hand so the UVs are exactly what the lettering assumes, and so every
 * vertex can be pushed out along its normal by a crater field.
 */
function pittedTorus(R, r, ringSeg, tubeSeg) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= ringSeg; i++) {
    const u = i / ringSeg;
    const th = u * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j <= tubeSeg; j++) {
      const v = j / tubeSeg;
      const ph = v * Math.PI * 2;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const n = new THREE.Vector3(ct * cp, st * cp, sp);
      const p = new THREE.Vector3((R + r * cp) * ct, (R + r * cp) * st, r * sp);
      /* Craters, at TWO scales.
       *
       * The first pass used one ridged field at 2.8 m period on a 22 m donut, which is
       * three or four dents across the whole silhouette — from the hero angle that is a
       * smooth torus with a slight wobble, and the render came back looking like a
       * chocolate ring rather than troweled stucco. In randys_donuts_a the pitting is
       * fist- to head-sized and it covers EVERY square metre; the surface never reads
       * flat anywhere. So a second field three times finer carries the actual pitting
       * and the coarse one is demoted to slow lumpiness in the silhouette. */
      const crater = ridged(p.x * 0.36 + 11, p.y * 0.36 + p.z * 0.22, 3);
      const pit = ridged(p.x * 1.15 + 3, p.y * 1.15 + p.z * 0.8 + 7, 2);
      const grit = fbm(p.x * 3.4, p.y * 3.4 + p.z, 3) - 0.5;
      const d = -crater * 0.26 - pit * 0.26 + grit * 0.055 + 0.20;
      p.addScaledVector(n, d);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, v);
    }
  }
  const row = tubeSeg + 1;
  for (let i = 0; i < ringSeg; i++) {
    for (let j = 0; j < tubeSeg; j++) {
      const a = i * row + j, b = a + row, cIdx = a + 1, d = b + 1;
      idx.push(a, b, cIdx, cIdx, b, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();     // recompute so the craters actually shade
  return geo;
}

export function buildDonut(ctx, M, handoff, lod) {
  const root = new THREE.Group();
  root.name = 'donut-shop';
  root.position.set(S.x, terrainHeight(S.x, S.z), S.z);
  // Which way the ring faces decides whether the lettering is readable or a silhouette,
  // and the answer is: at the sun. world.js parks the sun out over the Pacific at
  // (-300, 320, -270); pointing the face down that bearing puts hard light across the
  // stucco and the black-on-white letters, which is exactly the reference photograph.
  // (It was 0.55 rad — edge-on and backlit, so the donut read as a brown blob.)
  root.rotation.y = Math.atan2(-300, -270);

  const SHOP_W = 26, SHOP_D = 16;

  /* ── forecourt ── */
  {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(120, 100), M.asphalt);
    lot.rotation.x = -Math.PI / 2;
    // 25 cm, not 2. These plazas are seen from hundreds of metres up, and at 200 m a
    // 24-bit depth buffer resolves about 2.6 cm — so a ground plane 2 cm above the
    // terrain stipples into z-fighting stripes across the whole site. A 25 cm lip is
    // invisible from the air and unambiguous to the depth test.
    lot.position.y = 0.22;
    lot.receiveShadow = true;
    lot.material = M.asphalt.clone();
    lot.material.map = M.asphalt.map.clone();
    lot.material.map.repeat.set(10, 8);
    lot.material.map.needsUpdate = true;
    root.add(lot);
    handoff.solid(lot, { kind: 'ground' });

    const bay = new THREE.MeshBasicMaterial({ color: 0xd9d2b4, toneMapped: false });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 5.4), bay);
      m.rotation.x = -Math.PI / 2;
      m.position.set(-11 + i * 5.6, 0.24, SHOP_D / 2 + 6.5);
      root.add(m);
    }
  }

  /* ── the shop ──
   * Squat, single storey, cream over an orange-brown base band, brown fascia with a deep
   * overhang and a big glazed corner — exactly the reference building. */
  {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W, ROOF_Y, SHOP_D), M.paintCream);
    wall.position.y = ROOF_Y / 2;
    wall.castShadow = wall.receiveShadow = true;
    root.add(wall);
    handoff.solid(wall, { kind: 'building' });

    const band = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W + 0.12, 1.5, SHOP_D + 0.12), M.paintBrown);
    band.position.y = 0.75;
    root.add(band);

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W + 3.4, 1.0, SHOP_D + 3.4),
      new THREE.MeshStandardMaterial({ color: 0x6a4128, roughness: 0.75 }));
    fascia.position.y = ROOF_Y + 0.5;
    fascia.castShadow = true;
    root.add(fascia);
    handoff.solid(fascia, { kind: 'building' });

    const roof = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W + 3.4, 0.35, SHOP_D + 3.4),
      new THREE.MeshStandardMaterial({ color: 0x8b8377, roughness: 0.95 }));
    roof.position.y = ROOF_Y + 1.15;
    roof.receiveShadow = true;
    root.add(roof);
    handoff.solid(roof, { kind: 'roof' });

    /* Shopfront glazing.
     *
     * It used to be on the −Z and −X faces, which is the BACK of the building: the ring
     * faces local +Z (that is where the lettering is), and the hero camera stands on
     * that side too, so every render of the shop came back as a blank cream trapezoid.
     * The glass, the door, the signs and the clutter all belong on the face the player
     * flies at. */
    const glassMat = new THREE.MeshPhysicalMaterial({
      // Darker and more opaque than the house glass. A shopfront under a deep awning is
      // a black hole with reflections in it, not a pale blue panel — at 0.42/2.2 the
      // envmap won and every window read as a sheet of white card.
      color: 0x14201f, roughness: 0.09, transparent: true, opacity: 0.68,
      envMapIntensity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    });
    const FZ = SHOP_D / 2 + 0.06;          // the front plane, local +Z
    const sill = 1.0, headY = 4.3;
    // the low bulkhead the glass sits on
    const kick = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W, sill, 0.35), M.paintBrown);
    kick.position.set(0, sill / 2 + 0.4, FZ - 0.1);
    root.add(kick);

    for (let i = 0; i < 6; i++) {
      const x = -SHOP_W / 2 + 2.5 + i * 4.2;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.9, headY - sill - 0.4), glassMat);
      p.position.set(x, (sill + headY) / 2 + 0.2, FZ);
      p.renderOrder = 4;
      root.add(p);
      handoff.breakable(p, { material: 'glass', pieces: 14, mass: 45, threshold: 0.35 });
      const mul = new THREE.Mesh(new THREE.BoxGeometry(0.13, headY - 0.9, 0.16), M.darkSteel);
      mul.position.set(x - 2.1, (sill + headY) / 2 + 0.2, FZ);
      root.add(mul);
      // the paper signs taped inside every window of the reference photograph
      if (i % 2 === 0) {
        const note = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62),
          new THREE.MeshBasicMaterial({ color: 0xf6f0dc, toneMapped: false }));
        note.position.set(x - 0.7, 3.3, FZ + 0.05);
        root.add(note);
      }
    }
    // head rail and the last mullion
    {
      const head = new THREE.Mesh(new THREE.BoxGeometry(SHOP_W, 0.22, 0.3), M.paintWhite);
      head.position.set(0, headY + 0.25, FZ);
      root.add(head);
      const mul = new THREE.Mesh(new THREE.BoxGeometry(0.13, headY - 0.9, 0.16), M.darkSteel);
      mul.position.set(SHOP_W / 2 - 0.3, (sill + headY) / 2 + 0.2, FZ);
      root.add(mul);
    }

    // the door, in the corner, with its own frame and a hand-lettered board beside it
    {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), glassMat);
      door.position.set(SHOP_W / 2 - 4.0, 1.6 + 0.4, FZ + 0.03);
      door.renderOrder = 4;
      root.add(door);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.5, 0.14), M.darkSteel);
      frame.position.set(SHOP_W / 2 - 4.0, 1.75 + 0.4, FZ - 0.05);
      root.add(frame);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xf2e9d2, toneMapped: false }));
      board.position.set(SHOP_W / 2 - 2.2, 2.4, FZ + 0.05);
      root.add(board);
      // step and a kerb
      const stepM = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 1.6), M.concrete);
      stepM.position.set(SHOP_W / 2 - 4.0, 0.32, FZ + 0.9);
      root.add(stepM);
    }

    /* Clutter on the forecourt in front of the glass — bins, a newspaper rack, a bench.
     * The reference photograph is full of it, and it is what stops the building reading
     * as a render of a box. */
    const binMat = new THREE.MeshStandardMaterial({ color: 0x3c4a42, roughness: 0.8 });
    for (const [bx, bz, r] of [[-9, FZ + 1.4, 0.55], [7.5, FZ + 1.2, 0.5]]) {
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, 1.2, 12), binMat);
      bin.position.set(bx, 0.85, bz);
      bin.castShadow = true;
      root.add(bin);
      handoff.solid(bin, { kind: 'prop' });
    }
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.55),
        new THREE.MeshStandardMaterial({
          color: [0xb8362c, 0x2a4a86, 0xd8b02c][i], roughness: 0.6,
        }));
      box.position.set(-3.2 + i * 0.75, 0.8, FZ + 1.5);
      box.castShadow = true;
      root.add(box);
    }
    {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.6), M.paintBrown);
      bench.position.set(11.5, 0.85, FZ + 1.6);
      root.add(bench);
      for (const bx of [10.2, 12.8]) {
        const lg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.5), M.darkSteel);
        lg.position.set(bx, 0.45, FZ + 1.6);
        root.add(lg);
      }
    }

    /* Parked cars nose-in to the shop. Silhouette only, but they set the scale of the
     * whole composition — the donut is only funny if you can see how big a car is. */
    const carCols = [0x8d2f26, 0x1e2b3a, 0xd7d2c8, 0x2f3a2c, 0x9aa0a6];
    for (let i = 0; i < 5; i++) {
      const cg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 4.7),
        new THREE.MeshStandardMaterial({
          color: carCols[i], roughness: 0.32, metalness: 0.55, envMapIntensity: 1.4,
        }));
      body.position.y = 0.78;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.72, 2.3), glassMat);
      cab.position.set(0, 1.55, -0.15);
      const wheelG = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 10);
      for (const wx of [-0.95, 0.95]) for (const wz of [-1.6, 1.6]) {
        const w = new THREE.Mesh(wheelG, M.black);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.36, wz);
        cg.add(w);
      }
      body.castShadow = true;
      cg.add(body, cab);
      cg.position.set(-11 + i * 5.6, 0.24, FZ + 6.5);
      cg.rotation.y = (i % 2 ? 0.06 : -0.05);
      root.add(cg);
      handoff.solid(body, { kind: 'car' });
    }
  }

  /* ── the donut ── */
  // reuse the stucco built once in props.js; regenerating 1024^2 of noise costs seconds
  const stucco = (M._textures && M._textures.stucco) || stuccoTextures(1024);
  const letters = letteringCanvas();
  const dMap = stucco.map.clone(); dMap.needsUpdate = true;
  const dBump = stucco.bump.clone(); dBump.needsUpdate = true;
  const donutMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: dMap,
    bumpMap: dBump,
    bumpScale: 1.15,
    roughness: 0.98,
    metalness: 0.0,
  });
  /* 12x4 tiles over a 22 m ring — a tile every 1.8 m, so the crater field in the stucco
   * texture lands at roughly a hand's width, which is the size of the pitting in
   * randys_donuts_a. This has been wrong in both directions: at 9x3 the pits were half a
   * metre across and read as pebbledash, and at 22x7 they were 3 cm and averaged out to
   * a smooth cream surface at any distance you actually see the thing from. The right
   * answer is the size the pits are in the photograph, not the size real grit is. */
  donutMat.map.repeat.set(12, 4);
  donutMat.bumpMap.repeat.set(12, 4);

  const donut = new THREE.Mesh(pittedTorus(DONUT_R, DONUT_r, 168, 60), donutMat);
  donut.position.set(0, DONUT_Y, 0);
  donut.castShadow = donut.receiveShadow = true;
  donut.name = 'randys-donut';
  root.add(donut);
  handoff.solid(donut, { kind: 'donut', trimesh: true });
  handoff.breakable(donut, {
    material: 'stucco', pieces: 40, mass: 9000, threshold: 4.0, chunky: true,
  });

  // The lettering rides as a second surface a few centimetres proud, so it takes the
  // stucco's shading but keeps crisp edges. Painted-on text on a rough wall does exactly
  // this in the photograph.
  {
    const g = pittedTorus(DONUT_R, DONUT_r + 0.035, 168, 60);
    const lm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: letters, transparent: false, alphaTest: 0.4, roughness: 0.92,
      bumpMap: stucco.bump, bumpScale: 0.25,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    lm.position.copy(donut.position);
    root.add(lm);
    donut.userData.letters = lm;
  }

  // the two steel legs that hold the donut off the roof
  for (const sx of [-6.2, 6.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.0, 0.5), M.paintWhite);
    leg.position.set(sx, ROOF_Y + 2.4, 0);
    leg.castShadow = true;
    root.add(leg);
    handoff.solid(leg, { kind: 'structure' });
  }

  /* ── the gas station: canopy and pumps ── */
  const station = new THREE.Group();
  // Beside the forecourt, not in front of it. At (0, 0, 34) the canopy sat squarely on
  // the one sightline that matters — the low wide look up at the ring — and ate the shot.
  station.position.set(42, 0, 6);
  {
    const CW = 26, CD = 13, CH = 6.2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(CW, 1.1, CD), M.paintWhite);
    deck.position.y = CH;
    deck.castShadow = true;
    station.add(deck);
    handoff.solid(deck, { kind: 'roof' });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.1, 0.42, CD + 0.1), M.paintRed);
    stripe.position.y = CH - 0.6;
    station.add(stripe);
    // The lit ceiling has to hang BELOW the red edge band. At CH-0.56 it sat inside the
    // stripe box (which spans CH-0.81..CH-0.39) and was invisible, so standing under the
    // canopy — the exact spot you land on the way to the donut — the whole sky above you
    // was a solid black rectangle.
    const under = new THREE.Mesh(new THREE.PlaneGeometry(CW - 1.2, CD - 1.2),
      new THREE.MeshBasicMaterial({ color: 0xf2ead6, toneMapped: false }));
    under.rotation.x = Math.PI / 2;
    under.position.y = CH - 0.86;
    station.add(under);

    for (const sx of [-CW / 2 + 2, CW / 2 - 2]) {
      for (const sz of [-CD / 2 + 2, CD / 2 - 2]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, CH, 0.9), M.paintWhite);
        col.position.set(sx, CH / 2, sz);
        col.castShadow = true;
        station.add(col);
        handoff.solid(col, { kind: 'column' });
      }
    }
    for (let i = 0; i < 3; i++) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 2.4), M.concrete);
      island.position.set(-8 + i * 8, 0.15, 0);
      station.add(island);
      for (const sz of [-0.55, 0.55]) {
        const pump = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.65), M.paintWhite);
        body.position.y = 1.25; body.castShadow = true;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), M.screen);
        face.position.set(0, 1.72, 0.34);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.75), M.paintRed);
        top.position.y = 2.35;
        pump.add(body, face, top);
        pump.position.set(-8 + i * 8 + (sz > 0 ? 1.6 : -1.6), 0.3, sz * 1.4);
        station.add(pump);
        handoff.breakable(body, { material: 'metal', pieces: 9, mass: 260, threshold: 1.0, explosive: true });
      }
    }
  }
  root.add(station);

  /* ── the pole sign and a few lamp standards ── */
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 12, 10), M.darkSteel);
    pole.position.set(-38, 6, 24);
    root.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.4), M.paintRed);
    board.position.set(-38, 13, 24);
    board.castShadow = true;
    root.add(board);
    handoff.breakable(board, { material: 'metal', pieces: 10, mass: 300, threshold: 1.2 });
  }
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 8.5, 8), M.darkSteel);
    pole.position.y = 4.25;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.7), M.darkSteel);
    head.position.y = 8.5;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), M.lampGlow);
    glow.rotation.x = -Math.PI / 2; glow.position.y = 8.36;
    g.add(pole, head, glow);
    g.position.set(-50 + i * 25, 0, -34);
    root.add(g);
    handoff.breakable(pole, { material: 'metal', pieces: 5, mass: 180, threshold: 1.4, group: g, topples: true });
  }

  // stand on the crown of the ring
  const g0 = terrainHeight(S.x, S.z);
  const landing = { x: S.x, y: g0 + DONUT_Y + DONUT_R + DONUT_r, z: S.z };

  /* The reference framing, computed from where the ring actually points rather than
   * guessed: stand on the forecourt on the face side, eye height, and look UP at the
   * middle of the ring. Low camera, wide lens, comedy of scale.
   *
   * 24 m, not 34, and the aim is the centre of the ring rather than a metre above it.
   * The comedy of randys_donuts_a is entirely a function of how much frame the donut
   * takes: in the plate it is about two thirds of the picture height, and at 34 m on a
   * 68 degree lens ours was under a third — a normal shop with a large sign on it, which
   * is not the joke. The 22 m ring at 24 m on a 74 degree lens fills it the way the
   * photograph does, and the shop underneath shrinks to the squat little box it should
   * be. */
  const fy = root.rotation.y;
  const hero = {
    // 27 m and a little higher: at 24 m the lens was under the awning and the shop
    // filled the bottom third as a featureless brown band. Backing off three metres puts
    // the forecourt and the parked cars back in shot, which is where the scale cue is —
    // the donut is only funny next to something whose size you already know.
    pos: [S.x + Math.sin(fy) * 27, g0 + 2.5, S.z + Math.cos(fy) * 27],
    look: [S.x, g0 + DONUT_Y - 1.5, S.z],
    fov: 74,
  };

  return { root, donut, landing, hero };
}
