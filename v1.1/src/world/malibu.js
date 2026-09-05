// world/malibu.js — the house. Owned by task `world`.
//
// Reference: malibu_cliff_hero.jpg, malibu_exterior_a.jpg, malibu_living_colour.jpg,
// malibu_workshop_a.jpg.
//
// The read that had to be right, in order of how much it matters at 300 m:
//   1. STACKED THIN SLABS. Every floor is a horizontal plane 0.7 m thick with a curved
//      organic edge, and the floors are different shapes stacked off-centre. It is never
//      a box with windows.
//   2. A DARK BAND BETWEEN THEM. The glazing is almost the entire wall, and it is dark,
//      so from outside the house is white-dark-white-dark-white in horizontal stripes.
//   3. THE COLUMNS. The seaward lobe hangs off the cliff on a row of tapered concrete
//      columns of visibly different lengths, because the rock under them falls away.
//   4. IT IS THE ONLY BRIGHT THING. Everything else in frame is dusty and warm.
//
// All geometry is in world coordinates: the cliff-top plateau is y = 96, which is where
// the main floor sits.

import * as THREE from 'three';
import {
  slabMesh, blobShape, insetOutline, ribbonMesh, taperedColumn, palmTree, clamp,
  screenTexture,
} from './props.js';
import { terrainHeight } from './cliff.js';

export const L0 = 96.0;      // main floor level (top surface)
export const SLAB = 0.92;    // slab thickness
// The fascia is the single most important 40 cm in the whole building. Seen from the
// terrace or from the air, the reference house is a stack of WHITE HORIZONTAL BANDS with
// dark glass recessed between them. A bare 0.72 m slab edge, with the glazing set 7.5 m
// back under it, gave the opposite read: you saw the dark underside of an overhang and
// the house came out as a bandstand — a flat roof on sticks. A downstand at every slab
// lip turns the edge into a band you can actually see at 300 m.
export const FASCIA = 0.55;
// Floor-to-floor was 4.5 m, which after the slab and its fascia left a 3.0 m band of
// glass — and at 300 m a 3 m stripe on a 116 m building is a pencil line. The reference
// house reads white-DARK-white-DARK-white in bands of comparable weight, so the storeys
// are 5.8 m apart and the glass band is 4.3 m.
export const L1 = 101.8;     // upper floor level
export const L2 = 107.2;     // roof level
export const SHOP_FLOOR = 91.0;   // workshop slab
// 35 cm, not 5. At 5 cm the basement ceiling sat inside the tolerance of the house
// slab above it and the WHITE underside of the ground floor won the depth test — so
// standing in the workshop you looked up at a warm cream ceiling instead of black.
export const SHOP_CEIL = L0 - SLAB - 0.35;

/* The floor plates. Hand-drawn control points; the spline through them is what gives the
 * continuously curving edge instead of a polygon. Seaward is −Z. */
/* Shape notes, because this is the read that matters most at 300 m.
 *
 * The first pass made all three plates near-circular, r ≈ 35. From the hero angle the
 * house came back as a flying saucer: one disc, no wings, no direction. The reference
 * house is LONG — it runs along the cliff, roughly 110 m of frontage against 90 m of
 * depth, with a round-nosed lobe pushed out over the drop in the middle and a wing
 * running back inland to the east. That elongation is most of what makes it read as a
 * building rather than a landing pad, and it is why the plates below are asymmetric and
 * different from each other rather than three copies at three radii. */
/* 116 m of frontage against 69 m of depth — a ratio of 1.7:1, and that number is the
 * whole point. Three near-square plates stacked concentrically is a flying saucer, which
 * is exactly what the first two passes rendered: from the hero angle the house was a
 * white disc with palm trees on it. The reference house is a BAR along the cliff with
 * the upper storeys pushed east, so the west third of the main floor is open roof
 * terrace and you read three different shapes at three different heights. */
/* 116 m of frontage against 69 m of depth — a ratio of 1.7:1, and that number is the
 * whole point. Three near-square plates stacked concentrically is a flying saucer, which
 * is exactly what the first two passes rendered: from the hero angle the house was a
 * white disc with palm trees on it. The reference house is a BAR along the cliff with
 * the upper storeys pushed east, so the west third of the main floor is open roof
 * terrace and you read three different shapes at three different heights. */
const PLATE_L0 = [
  [-62, -4], [-57, -20], [-42, -31], [-20, -38], [6, -40], [30, -36],
  [46, -27], [54, -12], [52, 4], [45, 17], [29, 26], [7, 29],
  [-16, 29], [-40, 26], [-57, 16],
];
/* The upper storeys are pulled INLAND, and that is the whole fix for the silhouette.
 *
 * Previously L1 reached z=-27 and L2 — the roof — reached z=-34, which is within 6 m of
 * the main floor's own seaward lip at z=-40. Three plates that all end in the same place
 * are not stacked slabs; they are a lid. Every render from the terrace came back as a
 * bandstand: one enormous flat disc on sticks, with the two floors under it invisible.
 *
 * In malibu_aerial_colour the seaward third of the main floor is OPEN TO THE SKY — it is
 * the terrace, and the fact that you can see the sky above the cantilever is what makes
 * the cantilever read at all. So L1 stops at z=-15 and L2 at z=-16, leaving 25 m of open
 * deck outboard of the building line, and the roof overhangs the floor below it by about
 * 1.5 m the way a real slab roof does rather than being a separate larger disc. */
const PLATE_L1 = [
  [-4, -15], [9, -21], [27, -20], [41, -12], [46, 1], [41, 15],
  [25, 25], [5, 27], [-10, 15],
];
const PLATE_L2 = [
  [-6, -16], [8, -23], [28, -22], [43, -13], [48, 0], [43, 16],
  [25, 27], [4, 29], [-12, 16],
];

function scored(g, cx, cz, r0, r1, n) {
  // The entrance apron in malibu_exterior_a is scored with big concentric arcs. Thin
  // dark lines on light concrete; cheap, and it stops the apron reading as a blank plane.
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2c2c2c, transparent: true, opacity: 0.35 });
  for (let i = 0; i < n; i++) {
    const r = r0 + (r1 - r0) * (i / (n - 1));
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.07, r + 0.07, 96, 1, 0.4, 2.4), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.06, cz);
    grp.add(ring);
  }
  g.add(grp);
  return grp;
}

export function buildMalibu(ctx, M, handoff, lod) {
  const root = new THREE.Group();
  root.name = 'malibu';
  const glassPanels = [];
  const workshopLights = [];

  /* ─────────────── slabs ─────────────── */

  function addSlab(plate, topY, mat = M.slab, holes = null) {
    const m = slabMesh(plate, SLAB, mat, 0.06, holes);
    m.position.y = topY - SLAB;
    root.add(m);
    handoff.solid(m, { kind: 'slab' });
    // the white downstand at the lip — see FASCIA above
    const line = blobShape(plate).outline;
    const f = ribbonMesh(line, topY - SLAB - FASCIA, topY - SLAB + 0.02, M.slabEdge);
    f.material.side = THREE.DoubleSide;
    f.castShadow = true;
    root.add(f);
    return m;
  }

  // The stairwell opening. Cut from the slab itself so the collider has the hole too —
  // without this the stair below is unreachable: you walk over invisible floor.
  const STAIR = { x: 15, z: 16, r: 4.6 };
  const s0 = addSlab(PLATE_L0, L0, M.slab, [STAIR]);
  const s1 = addSlab(PLATE_L1, L1);
  const s2 = addSlab(PLATE_L2, L2);

  const out0 = blobShape(PLATE_L0).outline;
  const out1 = blobShape(PLATE_L1).outline;
  const out2 = blobShape(PLATE_L2).outline;

  /* ─────────────── the columns under the cantilever ───────────────
   * Their lengths are read off the terrain, which is why the row steps down as the rock
   * falls away — the thing that sells the overhang in the reference plate. */
  const colGroup = new THREE.Group();
  {
    /* The row follows the SEAWARD EDGE of the slab, read off the outline itself rather
     * than swept along a guessed arc — that is what keeps a column under the lip when
     * the plate shape changes, and what makes the row curve with the building. Their
     * lengths come from the terrain, which is why the row steps down as the rock falls
     * away: the thing that sells the overhang in the reference plate. */
    const line = insetOutline(blobShape(PLATE_L0).outline, 3.2);
    let last = null;
    for (const p of line) {
      if (p.y > -10) continue;                        // seaward half only
      // 6.5 m centres, not 10. In malibu_cliff_hero the row under the seaward lobe is
      // eight or nine columns standing close together — it reads as a colonnade, and the
      // rhythm of it is what gives the cantilever its scale. At 10 m only three or four
      // survived the height test and they read as scaffolding props.
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 6.5) continue;
      const ground = terrainHeight(p.x, p.y);
      const h = (L0 - SLAB) - ground;
      // Only where the rock is close enough to reach. A column is a prop, not a pile:
      // once the drop passes about forty metres the slab is CANTILEVERED and the empty
      // air under it is the whole drama of the building. Without this rule the seaward
      // lobe grew a forest of forty 50 m stilts and the house read as a pier.
      if (h < 3 || h > 38) continue;
      const c = taperedColumn(0.95, 1.7, h, M.column);
      c.position.set(p.x, ground + h / 2, p.y);
      colGroup.add(c);
      handoff.solid(c, { kind: 'column' });
      last = p;
    }
  }

  // a second, shorter row inland holding the mid-span
  for (let i = 0; i < 6; i++) {
    const x = -40 + i * 14, z = 22;
    const ground = terrainHeight(x, z);
    const h = (L0 - SLAB) - ground;
    if (h < 2.5) continue;
    const c = taperedColumn(0.5, 0.85, h, M.column);
    c.position.set(x, ground + h / 2, z);
    colGroup.add(c);
  }
  root.add(colGroup);

  // Structural fins between the columns, as in the plate — thin blades, not a wall.
  for (let i = 0; i < 6; i++) {
    const x = -24 + i * 11;
    const g = terrainHeight(x, -22);
    const h = clamp((L0 - SLAB) - g, 0, 40);
    if (h < 4) continue;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.35, h, 5.5), M.column);
    fin.position.set(x, g + h / 2, -22);
    fin.castShadow = true;
    root.add(fin);
  }

  /* ─────────────── glazing ───────────────
   * Built as individual panels rather than one ribbon: the destruction task needs to
   * break a single pane, and the mullion grid is half of what makes it read as a
   * curtain wall rather than a tinted plane. */
  function curtainWall(outline, y0, y1, inset, opts = {}) {
    const line = insetOutline(outline, inset);
    const n = line.length;
    const grp = new THREE.Group();
    const step = opts.step || 3;
    for (let i = 0; i < n; i += step) {
      const a = line[i], b = line[(i + step) % n];
      const dx = b.x - a.x, dz = b.y - a.y;
      const w = Math.hypot(dx, dz);
      if (w < 0.15) continue;
      const skip = opts.skip && opts.skip(a, b);
      if (skip) continue;
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, y1 - y0),
        opts.clear ? M.glassClear : M.glass
      );
      pane.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.y + b.y) / 2);
      pane.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      pane.renderOrder = 4;
      grp.add(pane);
      glassPanels.push(pane);
      handoff.breakable(pane, {
        material: 'glass', pieces: 26, mass: 90, threshold: 0.5,
        size: [w, y1 - y0, 0.02],
      });
      // mullion at the panel edge
      const mul = new THREE.Mesh(new THREE.BoxGeometry(0.09, y1 - y0, 0.14), M.mullion);
      mul.position.set(a.x, (y0 + y1) / 2, a.y);
      mul.rotation.y = pane.rotation.y;
      grp.add(mul);
    }
    // head and sill rails
    for (const y of [y0 + 0.05, y1 - 0.05]) {
      const rail = ribbonMesh(line, y - 0.055, y + 0.055, M.mullion);
      grp.add(rail);
    }
    root.add(grp);
    return grp;
  }

  /* Main level. The glazed envelope follows the UPPER floor's outline, not the main
   * plate's: glass has to have a slab over it, and the seaward quarter of L0 is now open
   * terrace. Inset 1.6 m so the floor above visibly oversails the glass line — the thin
   * shadow gap between a white slab edge and the dark band under it is most of what
   * makes the reference plate read as a modern house rather than a greenhouse. */
  curtainWall(out1, L0, L1 - SLAB - FASCIA, 1.6, {
    step: 4,
    skip: (a) => a.y > 14 && a.x < 6,            // solid wall behind the kitchen
  });
  // Upper level.
  curtainWall(out1, L1, L2 - SLAB - FASCIA, 3.4, { step: 4 });

  /* Solid inland wall segment (the one the glass skips).
   *
   * This matters more than it looks. In malibu_exterior_a the approach side of the house
   * is a long unbroken WHITE CONCRETE wall with slot windows in it — the glass is on the
   * ocean side, where the view is. A house that is glass all the way round reads as a
   * bus shelter from the driveway, which is exactly what the entrance render showed. */
  {
    const line = insetOutline(out1, 1.6).filter(p => p.y > 12 && p.x < 8);
    if (line.length > 1) {
      const w = ribbonMesh(line, L0, L1 - SLAB - FASCIA, M.boardWall);
      w.material = M.boardWall;
      w.castShadow = w.receiveShadow = true;
      root.add(w);
      handoff.solid(w, { kind: 'wall' });
      // the row of tall narrow light slots cut into it
      for (let i = 2; i < line.length - 2; i += 3) {
        const a = line[i], b = line[i + 1];
        const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 2.4), M.glass);
        slot.position.set((a.x + b.x) / 2, L0 + 2.0, (a.y + b.y) / 2);
        slot.rotation.y = Math.atan2(b.x - a.x, b.y - a.y) + Math.PI / 2;
        slot.translateZ(-0.05);
        root.add(slot);
      }
    }
  }

  /* ─────────────── the drum ───────────────
   * The white cylinder that breaks the horizontal stacking in every exterior plate. */
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(6.2, 6.2, L2 + 1.2 - (L0 - SLAB), 40, 1, true),
    M.slab
  );
  drum.material.side = THREE.DoubleSide;
  drum.position.set(15, (L0 - SLAB + L2 + 1.2) / 2, 16);
  drum.castShadow = drum.receiveShadow = true;
  root.add(drum);
  handoff.solid(drum, { kind: 'drum' });
  const drumCap = new THREE.Mesh(new THREE.CircleGeometry(6.2, 40), M.slab);
  drumCap.rotation.x = -Math.PI / 2;
  drumCap.position.set(15, L2 + 1.2, 16);
  root.add(drumCap);

  /* ─────────────── terrace, rails, pool ─────────────── */

  // Glass balustrade at the seaward slab edge. Breakable.
  {
    const line = insetOutline(out0, 0.5).filter(p => p.y < 24);
    for (let i = 0; i < line.length - 1; i += 2) {
      const a = line[i], b = line[i + 2] || line[i + 1];
      const w = Math.hypot(b.x - a.x, b.y - a.y);
      if (w < 0.2) continue;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.1), M.glassClear);
      pane.position.set((a.x + b.x) / 2, L0 + 0.58, (a.y + b.y) / 2);
      pane.rotation.y = Math.atan2(b.x - a.x, b.y - a.y) + Math.PI / 2;
      pane.renderOrder = 4;
      root.add(pane);
      glassPanels.push(pane);
      handoff.breakable(pane, { material: 'glass', pieces: 14, mass: 40, threshold: 0.3 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.11), M.steel);
      cap.position.set((a.x + b.x) / 2, L0 + 1.15, (a.y + b.y) / 2);
      cap.rotation.y = pane.rotation.y;
      root.add(cap);
    }
  }

  // Lower west terrace with the lap pool (visible bottom-left of malibu_cliff_hero).
  {
    const deck = slabMesh(
      [[-96, -24], [-74, -32], [-62, -20], [-62, 10], [-76, 18], [-94, 12]], 0.8, M.slab
    );
    deck.position.y = 93.4 - 0.8;
    root.add(deck);
    handoff.solid(deck, { kind: 'deck' });

    const shell = new THREE.Mesh(new THREE.BoxGeometry(22, 2.2, 8), M.paintWhite);
    shell.position.set(-79, 93.4 - 1.1, -6);
    root.add(shell);
    const water = new THREE.Mesh(new THREE.BoxGeometry(21, 1.9, 7), M.poolWater);
    water.position.set(-79, 93.4 - 1.15, -6);
    root.add(water);

    // the ramp/stair down from the main level
    for (let i = 0; i < 9; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 0.85), M.slab);
      st.position.set(-62, L0 - 0.15 - i * 0.29, 4 + i * 0.85);
      st.receiveShadow = true;
      root.add(st);
    }
  }

  /* ─────────────── entrance court ─────────────── */
  {
    /* The court is DARK. In malibu_exterior_a it is near-black asphalt scored with pale
     * arcs, and the white house stands out against it — that contrast is the entire
     * composition. Laid in M.concrete at radius 54 it was a 108 m disc of the same pale
     * grey as the building, so the render came back as a white house on a white plate
     * under a white sky, with nothing to look at. Darker, smaller, and its own material. */
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a68, roughness: 0.95, metalness: 0.0,
      map: M._textures.asphalt, bumpMap: M._textures.grain, bumpScale: 0.05,
    });
    const apron = new THREE.Mesh(new THREE.CircleGeometry(42, 64), courtMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(6, L0 + 0.04, 92);
    apron.receiveShadow = true;
    root.add(apron);
    handoff.solid(apron, { kind: 'ground' });
    const sc = scored(root, 6, 92, 12, 38, 5);
    sc.position.y = L0;

    // the bronze sculpture that sits left of frame in malibu_exterior_a
    const sculpt = new THREE.Group();
    const t1 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 1.05, 14, 26, Math.PI * 1.35), M.bronze);
    t1.rotation.set(0.4, 0.8, 0.3); t1.position.set(0, 3.2, 0);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.85, 12, 22, Math.PI * 1.1), M.bronze);
    t2.rotation.set(1.3, -0.4, 1.0); t2.position.set(1.4, 1.9, 0.6);
    sculpt.add(t1, t2);
    sculpt.position.set(-30, L0 + 0.7, 84);
    sculpt.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(sculpt);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1.4, 32), M.slab);
    plinth.position.set(-30, L0 + 0.7, 84);
    plinth.receiveShadow = true;
    root.add(plinth);

    // planter wall with uplights — the row of warm cones in the reference plate
    const planter = new THREE.Mesh(new THREE.BoxGeometry(34, 1.3, 3.2), M.slab);
    planter.position.set(40, L0 + 0.65, 88);
    planter.rotation.y = -0.35;
    planter.castShadow = planter.receiveShadow = true;
    root.add(planter);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), M.foliage);
      b.position.set(40 - 14 + i * 4.6, L0 + 1.6, 88);
      b.scale.y = 0.6;
      b.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0); // keep simple
      root.add(b);
      const up = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), M.lampGlow);
      up.rotation.x = -Math.PI / 2;
      up.position.set(40 - 14 + i * 4.6, L0 + 0.03, 85.6);
      root.add(up);
    }

    // driveway running off inland
    const road = new THREE.Mesh(new THREE.PlaneGeometry(11, 300), M.asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.set(24, L0 + 0.02, 250);
    road.receiveShadow = true;
    root.add(road);
  }

  /* ─────────────── the guest block ───────────────
   * A second, separate mass by the entrance court. The reference house is not one
   * object: there is a low garage-and-guest bar set back from the main volume, and
   * having two white masses of different heights is a large part of why the aerial plate
   * reads as a HOUSE and not as a landing pad. */
  {
    const gx = -44, gz = 74, gw = 30, gd = 13, gh = 4.6;
    const ground = L0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), M.slab);
    box.position.set(gx, ground + gh / 2, gz);
    box.rotation.y = -0.22;
    box.castShadow = box.receiveShadow = true;
    root.add(box);
    handoff.solid(box, { kind: 'building' });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(gw + 1.6, 0.45, gd + 1.6), M.slabEdge);
    cap.position.set(gx, ground + gh + 0.2, gz);
    cap.rotation.y = -0.22;
    cap.castShadow = true;
    root.add(cap);
    // three garage doors facing the court
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.1), M.mullion);
      const lx = -9 + i * 9;
      d.position.set(gx + lx * Math.cos(-0.22) + (gd / 2 + 0.06) * Math.sin(-0.22),
                     ground + 1.7,
                     gz - lx * Math.sin(-0.22) + (gd / 2 + 0.06) * Math.cos(-0.22));
      d.rotation.y = -0.22;
      root.add(d);
    }
  }

  /* ─────────────── palms ───────────────
   * They break the roofline in every exterior plate and give the eye a scale cue. */
  const palms = new THREE.Group();
  const palmSpots = [
    [-8, -18, 12], [16, -10, 14], [-26, 6, 10.5], [30, 30, 13],
    [-40, 50, 11], [10, 58, 15], [-56, 34, 9.5], [46, 60, 12],
    [58, 22, 10], [-20, 62, 13], [36, 70, 11],
  ];
  const inPlate = (x, z) => {
    let inside = false;
    for (let i = 0, j = out0.length - 1; i < out0.length; j = i++) {
      const xi = out0[i].x, zi = out0[i].y, xj = out0[j].x, zj = out0[j].y;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let i = 0; i < palmSpots.length; i++) {
    const [x, z, h] = palmSpots[i];
    const p = palmTree(M, h, i * 7 + 3);
    // palms grow from the ground, and the ground under the house IS the slab
    p.position.set(x, inPlate(x, z) ? L0 : terrainHeight(x, z), z);
    palms.add(p);
  }
  root.add(palms);
  lod.add(palms, 900, { center: new THREE.Vector3(0, L0, 0) });

  /* ═══════════════ INTERIOR ═══════════════
   * Minimal: white and grey planes, glass rails, warm wood, ocean light doing the work.
   * Everything sits inside the curtain wall so it is visible through the glass, which is
   * what stops the dark band reading as a painted stripe. */
  const interior = new THREE.Group();
  interior.name = 'malibu-interior';

  // stone floor inside the glass line
  {
    const inner = insetOutline(out0, 4.3);
    const sh = new THREE.Shape(inner.map(p => new THREE.Vector2(p.x, p.y)));
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.interiorFloor);
    fl.rotation.x = Math.PI / 2;
    fl.position.y = L0 + 0.02;
    fl.receiveShadow = true;
    interior.add(fl);
    handoff.solid(fl, { kind: 'floor' });
  }

  // wood ceiling soffit under the upper floor — the warm accent in malibu_living_colour
  {
    const inner = insetOutline(out1, 2.0);
    const sh = new THREE.Shape(inner.map(p => new THREE.Vector2(p.x, p.y)));
    const ce = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.wood);
    ce.rotation.x = -Math.PI / 2;
    ce.position.y = L1 - SLAB - 0.03;
    interior.add(ce);
    // recessed downlights
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = 9 + (i % 3) * 5;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), M.bulb);
      d.rotation.x = Math.PI / 2;
      d.position.set(Math.cos(a) * r + 2, L1 - SLAB - 0.05, Math.sin(a) * r + 4);
      interior.add(d);
    }
  }

  // the curved board-formed concrete feature wall
  {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(new THREE.Vector2(-4 + t * 26, 22 - Math.sin(t * 2.4) * 7));
    }
    const w = ribbonMesh(pts, L0, L0 + 3.4, M.boardWall, 0.06);
    w.material = M.boardWall;
    interior.add(w);
    handoff.solid(w, { kind: 'wall' });
  }

  // kitchen island, sofa group, low table, the boulder
  const island = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.95, 2.2), M.slab);
  island.position.set(6, L0 + 0.5, 26); island.castShadow = true;
  interior.add(island);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.08, 2.5), M.darkSteel);
  counter.position.set(6, L0 + 1.0, 26);
  interior.add(counter);

  for (const [x, z, rot, w] of [[-8, -14, 0, 6], [-14, -8, Math.PI / 2, 4.5]]) {
    const sofa = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, 1.7), M.paintWhite);
    sofa.position.set(x, L0 + 0.32, z); sofa.rotation.y = rot; sofa.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.35), M.paintWhite);
    back.position.set(0, 0.45, -0.68); sofa.add(back);
    interior.add(sofa);
  }
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 24), M.wood);
  table.position.set(-10, L0 + 0.42, -11); interior.add(table);

  const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), M.concrete);
  boulder.scale.set(1.5, 0.85, 1.1);
  boulder.position.set(24, L0 + 1.0, 8);
  boulder.castShadow = true;
  interior.add(boulder);
  handoff.solid(boulder, { kind: 'prop' });

  /* ─────────── the rest of the room ───────────
   * The first pass furnished the main floor with two sofas, a table and a boulder in a
   * 116 x 69 m plan, so standing anywhere in it you saw an empty white plane running to
   * a glass wall — the reference plate (malibu_living_colour.jpg) is the opposite: a
   * room you read in layers, floor rug, low seating, a long counter, a wall of books,
   * the piano, and the ocean behind all of it. None of this is expensive; it is boxes.
   * It is what makes the opening minute of the game look inhabited. */
  function box(w, h, d, mat, x, y, z, ry = 0, solid = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    interior.add(m);
    if (solid) handoff.solid(m, { kind: 'prop' });
    return m;
  }

  // rug under the seating group
  {
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(14, 9),
      new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1.0 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-16, L0 + 0.035, -16);
    interior.add(rug);
  }
  // a second, larger seating group facing the water
  for (const [x, z, ry, w] of [[-22, -21, 0, 7.5], [-9.5, -16, Math.PI / 2, 5.5], [-22, -11, Math.PI, 7.5]]) {
    const seat = box(w, 0.44, 1.9, M.paintWhite, x, L0 + 0.34, z, ry);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.62, 0.34), M.paintWhite);
    back.position.set(0, 0.5, -0.76);
    seat.add(back);
  }
  box(3.0, 0.34, 1.5, M.wood, -16, L0 + 0.2, -16.5);              // coffee table
  // lounge chairs out on the terrace side
  for (let i = 0; i < 4; i++) {
    box(0.75, 0.32, 2.1, M.paintWhite, -40 + i * 4.5, L0 + 0.28, -30, 0);
  }

  // dining: a long slab table and a row of chairs
  {
    const t = box(6.6, 0.12, 1.5, M.wood, -36, L0 + 0.78, -6);
    for (const sx of [-3.0, 3.0]) box(0.2, 0.76, 1.3, M.darkSteel, -36 + sx, L0 + 0.38, -6);
    for (let i = 0; i < 8; i++) {
      const cx = -36 - 2.6 + (i % 4) * 1.75;
      const cz = -6 + (i < 4 ? -1.35 : 1.35);
      box(0.55, 0.06, 0.55, M.darkSteel, cx, L0 + 0.47, cz);
      box(0.55, 0.55, 0.06, M.darkSteel, cx, L0 + 0.75, cz + (i < 4 ? -0.26 : 0.26));
    }
    t.material = M.wood;
  }

  // the bookcase wall behind the seating, and a bar
  {
    const shelf = box(0.5, 3.0, 13, M.wood, -47, L0 + 1.5, -14, 0, true);
    shelf.material = M.wood;
    // books: thin coloured slabs, cheap and they read instantly
    const cols = [0x7a4436, 0x2f4a63, 0x6d6a55, 0x8a3a30, 0x37473a, 0xb0a68e];
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i < 46; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24 + (i % 3) * 0.06, 0.05 + (i % 4) * 0.02),
          new THREE.MeshStandardMaterial({ color: cols[(i + r) % 6], roughness: 0.9 }));
        b.position.set(-46.75, L0 + 0.55 + r * 0.62, -20.2 + i * 0.27);
        interior.add(b);
      }
    }
    box(4.2, 1.05, 0.9, M.darkSteel, -47, L0 + 0.52, 4, 0, true);   // the bar
    box(4.4, 0.07, 1.1, M.wood, -47, L0 + 1.08, 4);
  }

  /* The piano. It is in the film, it is in the reference plate, and a black grand is the
   * one object in this room with a curve in it. */
  {
    const g = new THREE.Group();
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(-0.75, -0.9);
    bodyShape.bezierCurveTo(0.9, -1.0, 1.25, 0.4, 0.85, 1.35);
    bodyShape.lineTo(-0.75, 1.35);
    bodyShape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: 0.28, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, curveSegments: 10,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    const pianoMat = new THREE.MeshStandardMaterial({
      color: 0x0b0b0d, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.6,
    });
    const body = new THREE.Mesh(bodyGeo, pianoMat);
    body.position.y = 0.78;
    body.castShadow = true;
    g.add(body);
    const lid = new THREE.Mesh(bodyGeo, pianoMat);
    lid.position.set(0, 1.06, 0);
    lid.rotation.z = 0.34;
    g.add(lid);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }));
    keys.position.set(0.05, 0.79, 1.5);
    g.add(keys);
    for (const [lx, lz] of [[-0.6, -0.6], [0.7, 0.6], [-0.6, 1.2]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.78, 8), pianoMat);
      leg.position.set(lx, 0.39, lz);
      g.add(leg);
    }
    g.scale.setScalar(1.5);
    g.position.set(-44, L0, -26);
    g.rotation.y = 0.6;
    interior.add(g);
  }

  /* Partitions: a service core and the bedroom box upstairs. Without a single wall the
   * house is a car park with a view. */
  {
    box(0.28, 3.1, 11, M.interiorWall, 26, L0 + 1.55, 12, 0, true);
    box(9, 3.1, 0.28, M.interiorWall, 31, L0 + 1.55, 6.5, 0, true);
    box(0.28, 3.1, 9, M.interiorWall, -8, L0 + 1.55, 20, 0, true);
    // upstairs volume, seen from outside through the upper glazing
    box(0.25, 2.9, 12, M.interiorWall, 20, L1 + 1.45, 4, 0, true);
    box(10, 2.9, 0.25, M.interiorWall, 26, L1 + 1.45, -2, 0, true);
    const bed = box(2.6, 0.5, 2.2, M.paintWhite, 32, L1 + 0.4, 8);
    bed.material = M.paintWhite;
  }

  /* the stair down into the workshop, inside the drum */
  const stairTop = new THREE.Vector3(15, L0, 16);
  {
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const a = -0.4 - t * 2.6;
      const r = 4.2;
      const st = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 1.05), M.slab);
      st.position.set(15 + Math.cos(a) * r, L0 - 0.16 - t * (L0 - SHOP_FLOOR - 0.2), 16 + Math.sin(a) * r);
      st.rotation.y = -a;
      st.castShadow = st.receiveShadow = true;
      interior.add(st);
      handoff.solid(st, { kind: 'stair' });
    }
    // hole in the main slab so the stair actually goes somewhere
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, SLAB + 0.4, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.9, side: THREE.BackSide }));
    hole.position.set(15, L0 - SLAB / 2, 16);
    interior.add(hole);
  }

  root.add(interior);

  /* ═══════════════ WORKSHOP ═══════════════
   * Reference: malibu_workshop_a/b — a dark basement lit in POOLS. Cool practicals
   * (monitors, holograms, a couple of task lamps) with deep black falloff between them,
   * real machine-shop clutter at eye height, and the Hall of Armor behind frosted glass
   * backlit in cold cyan. */
  const shop = new THREE.Group();
  shop.name = 'workshop';
  /* The room got smaller — 48 x 42 rather than 52 x 56.
   *
   * Not for polygon count: for FOG. env.js fogs the workshop preset from 8 m to 85 m,
   * which is correct (a basement should swallow its own far wall) but it means anything
   * past about 30 m from the camera is gone. A 56 m long room therefore rendered as a
   * few lit objects floating in black with nothing between them, which is the opposite
   * of the reference — malibu_workshop_a is CLAUSTROPHOBIC, every light has three
   * silhouettes in front of it. Pulling the walls in puts the clutter inside the fog's
   * usable range from anywhere the player stands. */
  const SX0 = -28, SX1 = 22, SZ0 = -8, SZ1 = 34;

  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0, SZ1 - SZ0), M.shopFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((SX0 + SX1) / 2, SHOP_FLOOR, (SZ0 + SZ1) / 2);
    floor.receiveShadow = true;
    shop.add(floor);
    handoff.solid(floor, { kind: 'floor' });

    // Its own material, not shopWall: the ceiling is the largest surface in the room and
    // the one thing that must stay black, or the pools of light have nothing to fall off
    // into. Reference: malibu_workshop_a — you cannot see the ceiling at all.
    // The ceiling stays the darkest surface in the room — in the plate it is a black
    // tangle you never quite read — but not literally 4 % grey, which returns nothing
    // and makes the top of every frame a void with a hard edge where the wall stops.
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.96 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0, SZ1 - SZ0), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((SX0 + SX1) / 2, SHOP_CEIL, (SZ0 + SZ1) / 2);
    shop.add(ceil);

    const walls = [
      [SX0, (SZ0 + SZ1) / 2, SZ1 - SZ0, Math.PI / 2],
      [SX1, (SZ0 + SZ1) / 2, SZ1 - SZ0, -Math.PI / 2],
    ];
    for (const [x, z, len, ry] of walls) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len, SHOP_CEIL - SHOP_FLOOR), M.shopWall);
      w.position.set(x, (SHOP_FLOOR + SHOP_CEIL) / 2, z);
      w.rotation.y = ry;
      shop.add(w); handoff.solid(w, { kind: 'wall' });
    }
    for (const [z, ry] of [[SZ0, 0], [SZ1, Math.PI]]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(SX1 - SX0, SHOP_CEIL - SHOP_FLOOR), M.shopWall);
      w.position.set((SX0 + SX1) / 2, (SHOP_FLOOR + SHOP_CEIL) / 2, z);
      w.rotation.y = ry;
      shop.add(w); handoff.solid(w, { kind: 'wall' });
    }
  }

  // structural columns through the shop
  for (const [x, z] of [[-16, 4], [-16, 28], [4, 4], [4, 28]]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, SHOP_CEIL - SHOP_FLOOR, 0.9), M.concrete);
    c.position.set(x, (SHOP_FLOOR + SHOP_CEIL) / 2, z);
    shop.add(c); handoff.solid(c, { kind: 'column' });
  }

  /* Hall of Armor: five frosted cases along the west wall, backlit cold cyan from below,
   * suits mostly in silhouette. suit.js parks the armors on these marks. */
  const armorStands = [];
  for (let i = 0; i < 5; i++) {
    const z = 1 + i * 6;
    const x = SX0 + 2.4;
    const bay = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 4.4), M.shopWall);
    back.position.set(-0.9, 1.7, 0);
    bay.add(back);
    /* A backlit panel INSIDE the case, behind where the armor stands.
     * hall_of_armor_cases is lit from behind the suit: the frosted pane glows evenly and
     * the armor is a silhouette against it. Lighting the case from a point light in front
     * gave the opposite — a lit suit on a black rectangle — so the light has to be a
     * surface, not a lamp. This is a dim emissive plane; the suit occludes it, which is
     * exactly what makes the silhouette. */
    // Dim. In hall_of_armor_cases the backing is a soft cold GLOW, a couple of stops
    // above the room; at 0x2e6c8c it rendered as a flat cyan billboard and the suit in
    // front of it lost all its own modelling. This is barely brighter than the fill.
    const glowPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.1),
      new THREE.MeshBasicMaterial({ color: 0x12384c, toneMapped: false }));
    glowPanel.position.set(-0.72, 1.7, 0);
    glowPanel.rotation.y = Math.PI / 2;
    bay.add(glowPanel);
    // side reveals, so the case is a box you look INTO and not a flat panel on a wall
    for (const sz of [-2.2, 2.2]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.4, 0.16), M.shopWall);
      side.position.set(0.15, 1.7, sz);
      bay.add(side);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 4.6), M.shopDark);
    lintel.position.set(0.15, 3.5, 0);
    bay.add(lintel);
    // frosted pane in front
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.4), new THREE.MeshPhysicalMaterial({
      color: 0x9fd6ea, roughness: 0.65, transparent: true, opacity: 0.24,
      side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
    }));
    pane.position.set(1.1, 1.7, 0);
    pane.rotation.y = Math.PI / 2;
    pane.renderOrder = 5;
    bay.add(pane);
    handoff.breakable(pane, { material: 'glass', pieces: 18, mass: 60, threshold: 0.4 });
    // cold strip from below
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.14), M.stripLight);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = Math.PI / 2;
    strip.position.set(0.4, 0.06, 0);
    bay.add(strip);
    const pl = new THREE.PointLight(0x63c8ff, 3.2, 11, 2);
    pl.position.set(x + 0.6, SHOP_FLOOR + 0.7, z);
    workshopLights.push(pl);
    shop.add(pl);
    bay.position.set(x, SHOP_FLOOR, z);
    shop.add(bay);
    armorStands.push({ x: x + 0.9, y: SHOP_FLOOR, z, yaw: Math.PI / 2 });
  }

  /* Machine-shop clutter at eye height. Benches, tool trays, a lathe, cable runs. */
  function bench(x, z, len, ry) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 1.1), M.shopDark);
    top.position.y = 0.92; g.add(top);
    for (const sx of [-len / 2 + 0.4, len / 2 - 0.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.92, 0.9), M.shopDark);
      leg.position.set(sx, 0.46, 0); g.add(leg);
    }
    // clutter
    for (let i = 0; i < 7; i++) {
      const w = 0.16 + Math.random() * 0.4;
      const o = new THREE.Mesh(
        Math.random() < 0.5
          ? new THREE.BoxGeometry(w, 0.1 + Math.random() * 0.2, 0.2 + Math.random() * 0.3)
          : new THREE.CylinderGeometry(w * 0.4, w * 0.4, 0.12 + Math.random() * 0.3, 8),
        Math.random() < 0.4 ? M.paintRed : M.shopSteel
      );
      o.position.set(-len / 2 + 0.6 + Math.random() * (len - 1.2), 1.05, -0.3 + Math.random() * 0.6);
      o.rotation.y = Math.random() * 3;
      o.castShadow = true;
      g.add(o);
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.6), M.paintRed);
    tray.position.set(len * 0.2, 0.99, 0.1); g.add(tray);
    g.position.set(x, SHOP_FLOOR, z);
    g.rotation.y = ry;
    shop.add(g);
    handoff.solid(top, { kind: 'prop' });
    return g;
  }
  bench(-6, -5, 7, 0);
  bench(12, 10, 6, Math.PI / 2);
  bench(-21, 28, 6.5, 0);
  bench(2, 30, 8, 0);
  bench(6, 4, 5, Math.PI / 2);

  // the lathe — a big horizontal machine, the silhouette in malibu_workshop_a
  {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 1.2), M.shopDark);
    bed.position.y = 0.9; g.add(bed);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 18), M.shopSteel);
    head.rotation.z = Math.PI / 2; head.position.set(-1.6, 1.6, 0); g.add(head);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.2, 12), M.shopSteel);
    spindle.rotation.z = Math.PI / 2; spindle.position.set(0.6, 1.6, 0); g.add(spindle);
    for (let i = 0; i < 3; i++) {
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 16), M.shopSteel);
      flange.rotation.z = Math.PI / 2; flange.position.set(-0.4 + i * 1.1, 1.6, 0); g.add(flange);
    }
    const legs = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.9, 0.9), M.shopDark);
    legs.position.y = 0.45; g.add(legs);
    g.position.set(9, SHOP_FLOOR, 26);
    g.rotation.y = -0.5;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    shop.add(g);
    handoff.solid(bed, { kind: 'prop' });
  }

  /* ── the screen wall ──
   * In malibu_workshop_a the monitors are not decoration, they are the LIGHT. Half the
   * frame is a wall of them, each one a dark panel carrying pale-cyan UI furniture, and
   * everything in front is read as a silhouette against that. Six small flat-coloured
   * rectangles — which is what this was — gave a black room with six glowing postage
   * stamps in it, so the count goes up, the panels get drawn content, and each cluster
   * gets its own point light so the objects in front of it are actually lit by it. */
  const screenMats = [];
  function screenWall(x, z, ry, cols, rows, scale = 1, freeStanding = false) {
    const g = new THREE.Group();
    /* A bank that is not against a wall needs something holding it up. The two banks out
     * in the middle of the floor were four glowing rectangles hovering at chest height
     * with nothing under them — from the default camera that reads as a bug, not as a
     * monitor. A mast and a foot cost eight triangles. */
    if (freeStanding) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.0, 8), M.shopDark);
      mast.position.y = 1.5;
      mast.castShadow = true;
      g.add(mast);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.1, 16), M.shopDark);
      foot.position.y = 0.05;
      g.add(foot);
      const spine = new THREE.Mesh(new THREE.BoxGeometry(cols * 1.7 * scale, 0.1, 0.1), M.shopDark);
      spine.position.set(0, 1.5 + (rows - 1) * 0.6 * scale, -0.06);
      g.add(spine);
      handoff.solid(mast, { kind: 'prop' });
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = 1.55 * scale, h = 0.98 * scale;
        const mat = new THREE.MeshBasicMaterial({
          map: screenTexture(screenMats.length * 7 + r * 3 + c),
          toneMapped: false,
        });
        screenMats.push(mat);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        const lx = (c - (cols - 1) / 2) * (w + 0.16);
        const ly = 1.5 + r * (h + 0.22);
        scr.position.set(lx, ly, 0.05);
        g.add(scr);
        const bez = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.07), M.black);
        bez.position.set(lx, ly, 0);
        g.add(bez);
      }
    }
    g.position.set(x, SHOP_FLOOR, z);
    g.rotation.y = ry;
    shop.add(g);
    // one light per bank, sitting a little in front of the glass
    const pl = new THREE.PointLight(0x86c8ee, 16, 24, 2);
    pl.position.set(x + Math.sin(ry) * 1.6, SHOP_FLOOR + 2.1, z + Math.cos(ry) * 1.6);
    shop.add(pl); workshopLights.push(pl);
    return g;
  }
  screenWall(-19, SZ0 + 0.35, 0, 4, 2);
  screenWall(-5, SZ0 + 0.35, 0, 3, 2);
  // …and a third bank filling the gap between those two, so the north wall reads as one
  // continuous WALL of monitors rather than two islands with darkness between them. In
  // malibu_workshop_a the screens run right across the frame with no break.
  screenWall(-12, SZ0 + 0.35, 0, 5, 1, 1.15);
  screenWall(SX1 - 0.35, 18, -Math.PI / 2, 4, 2);
  screenWall(6, SZ1 - 0.35, Math.PI, 3, 2, 0.85);
  // free-standing screens on stalks out in the room, so the middle of the floor is lit
  // too and the camera always has a glowing rectangle behind whatever it is looking at
  screenWall(-2, 10, -1.1, 2, 2, 0.8, true);
  screenWall(-13, 24, 2.2, 2, 2, 0.8, true);

  /* A dim cool fill so the room is a DARK BLUE basement rather than a black void. In the
   * plate you can always just make out the far wall and the ceiling structure; pure black
   * negative space reads as missing geometry, not as darkness. */
  {
    /* 1.6, not 5.5. The value was pushed up and up while the practicals were switched
     * off by a bug (see applyLights at the foot of this file); with them back on, a fill
     * that strong lit every corner evenly and the room lost the thing the reference is
     * actually made of — hard pools with black between them. The fill's only job is to
     * stop unlit geometry going to pure black. */
    const fill = new THREE.HemisphereLight(0x476e88, 0x141c24, 1.6);
    fill.position.set(0, SHOP_CEIL, 12);
    shop.add(fill); workshopLights.push(fill);
  }

  /* ── ceiling: trusses and hanging droplights ──
   * The reference ceiling is a dark tangle of structure with a few hard lamps in it, and
   * the cone of a droplight is what puts a POOL on the floor instead of an even wash. */
  for (let i = 0; i < 7; i++) {
    const z = SZ0 + 4 + i * 7.5;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SX1 - SX0, 0.42, 0.22), M.shopDark);
    beam.position.set((SX0 + SX1) / 2, SHOP_CEIL - 0.24, z);
    shop.add(beam);
    for (const x of [SX0 + 9, SX0 + 26, SX0 + 42]) {
      if (((i + Math.round(x)) % 3) !== 0) continue;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), M.black);
      rod.position.set(x, SHOP_CEIL - 1.0, z);
      shop.add(rod);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 14, 1, true), M.shopDark);
      shade.material.side = THREE.DoubleSide;
      shade.position.set(x, SHOP_CEIL - 1.6, z);
      shop.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.bulb);
      bulb.position.set(x, SHOP_CEIL - 1.72, z);
      shop.add(bulb);
      const pl = new THREE.PointLight(0xffe2bc, 9, 14, 2);
      pl.position.set(x, SHOP_CEIL - 1.9, z);
      shop.add(pl); workshopLights.push(pl);
    }
  }

  // holo table — a cyan volume floating in mid air, the brightest thing down here
  const holoGroup = new THREE.Group();
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.85, 24), M.shopDark);
    base.position.set(-4, SHOP_FLOOR + 0.42, 18);
    shop.add(base);
    for (let i = 0; i < 5; i++) {
      const r = 0.5 + i * 0.32;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 40), M.holo);
      ring.rotation.x = Math.PI / 2 + (i - 2) * 0.16;
      ring.position.set(-4, SHOP_FLOOR + 1.4 + i * 0.16, 18);
      holoGroup.add(ring);
    }
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.MeshBasicMaterial({
        color: 0x6fdcff, wireframe: true, transparent: true, opacity: 0.55,
        toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    wire.position.set(-4, SHOP_FLOOR + 2.0, 18);
    holoGroup.add(wire);
    holoGroup.userData.spin = wire;
    shop.add(holoGroup);
    const pl = new THREE.PointLight(0x5fd8ff, 7, 14, 2);
    pl.position.set(-4, SHOP_FLOOR + 2.0, 18);
    shop.add(pl); workshopLights.push(pl);
  }

  // Dum-E, the robot arm
  {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.35, 16), M.paintRed);
    base.position.y = 0.18; g.add(base);
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.28), M.shopSteel);
    a1.position.set(0, 1.1, 0); a1.rotation.z = 0.24; g.add(a1);
    const a2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.22), M.shopSteel);
    a2.position.set(-0.55, 2.2, 0); a2.rotation.z = -0.8; g.add(a2);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), M.shopDark);
    claw.position.set(-1.15, 2.75, 0); claw.rotation.z = Math.PI; g.add(claw);
    g.position.set(-11, SHOP_FLOOR, 26);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
  }

  // cable runs across the ceiling
  for (let i = 0; i < 9; i++) {
    const z = SZ0 + 3 + i * 4.2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(SX0 + 1, SHOP_CEIL - 0.2, z),
      new THREE.Vector3(0, SHOP_CEIL - 0.55 - Math.random() * 0.3, z + 0.6),
      new THREE.Vector3(SX1 - 1, SHOP_CEIL - 0.2, z),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5, false), M.black);
    shop.add(tube);
  }

  // task lamps — two warm pools so the shop is not entirely cyan
  for (const [x, z] of [[-6, -5], [10, 30], [-20, 20]]) {
    const pl = new THREE.PointLight(0xffd9a8, 4.5, 10, 2);
    pl.position.set(x, SHOP_FLOOR + 2.3, z);
    shop.add(pl); workshopLights.push(pl);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.bulb);
    bulb.position.copy(pl.position);
    shop.add(bulb);
  }

  /* ── the rest of the clutter ──
   * "Real machine-shop clutter at eye height" is the brief, and the failure mode it is
   * guarding against is a big empty dark room with four benches in it, which is what the
   * first pass rendered. What makes malibu_workshop_a read is that between the camera
   * and every light there are three or four DIFFERENT silhouettes: a cabinet, a pipe, a
   * gantry leg, a machine, a chair back. Density is the effect; the individual objects
   * are all simple.
   *
   * Everything here is placed off a seeded table rather than Math.random() so the shop
   * looks the same on every load — a room that rearranges itself between reloads is
   * impossible to light and impossible for a critic to reproduce a frame of. */
  let _s = 12345;
  const rnd = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  /* ── the console run ──
   * A 16 m desk along the whole monitor wall, loaded with keyboards, tool trays, cases
   * and a couple of monitors on arms. This exists for one reason: malibu_workshop_a is
   * shot ACROSS a bench with the screens behind it, and a screen wall with nothing in
   * front of it is a lightbox, not a workshop. Everything on it is a box; the effect is
   * entirely in the count and in the fact that it sits between the lens and the light. */
  {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 1.3), M.shopDark);
    top.position.y = 0.95; g.add(top);
    const front = new THREE.Mesh(new THREE.BoxGeometry(16, 0.85, 0.08), M.shopDark);
    front.position.set(0, 0.5, 0.6); g.add(front);
    for (const ox of [-7.5, -2.5, 2.5, 7.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 1.1), M.shopDark);
      leg.position.set(ox, 0.47, 0); g.add(leg);
    }
    for (let i = 0; i < 34; i++) {
      const kind = rnd();
      const bx = -7.6 + rnd() * 15.2;
      let o;
      if (kind < 0.22) {                                   // keyboard / panel
        o = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.24), M.black);
        o.position.set(bx, 1.02, -0.1 + rnd() * 0.4);
      } else if (kind < 0.42) {                            // tool tray, red
        o = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.4), M.paintRed);
        o.position.set(bx, 1.02, -0.1 + rnd() * 0.4);
      } else if (kind < 0.68) {                            // instrument case
        const h2 = 0.2 + rnd() * 0.32;
        o = new THREE.Mesh(new THREE.BoxGeometry(0.35 + rnd() * 0.4, h2, 0.3), M.shopSteel);
        o.position.set(bx, 1.0 + h2 / 2, -0.15 + rnd() * 0.3);
      } else if (kind < 0.86) {                            // canister / bottle
        const h2 = 0.18 + rnd() * 0.28;
        o = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h2, 8),
          rnd() < 0.4 ? M.paintRed : M.shopSteel);
        o.position.set(bx, 1.0 + h2 / 2, -0.2 + rnd() * 0.5);
      } else {                                             // small screen on the desk
        o = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
          new THREE.MeshBasicMaterial({ map: screenTexture(200 + i), toneMapped: false }));
        o.position.set(bx, 1.22, -0.35);
        o.rotation.y = Math.PI;
      }
      o.rotation.y += (rnd() - 0.5) * 0.5;
      o.castShadow = true;
      g.add(o);
    }
    // two monitors on arms rising off the back of the desk
    for (const [ox, ry2] of [[-4.2, 0.25], [3.1, -0.3]]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 6), M.shopDark);
      arm.position.set(ox, 1.45, -0.5); g.add(arm);
      const bez = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.68, 0.06), M.black);
      bez.position.set(ox, 2.0, -0.5); bez.rotation.y = ry2; g.add(bez);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.6),
        new THREE.MeshBasicMaterial({ map: screenTexture(300 + ox), toneMapped: false }));
      scr.position.set(ox + Math.cos(ry2) * 0.0, 2.0, -0.5 + 0.04);
      scr.rotation.y = ry2 + Math.PI;
      g.add(scr);
    }
    // a chair, because a desk without one reads as a shelf
    {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), M.black);
      seat.position.set(-1.2, 0.5, 1.5); g.add(seat);
      const backR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.07), M.black);
      backR.position.set(-1.2, 0.85, 1.75); g.add(backR);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.46, 8), M.shopDark);
      post.position.set(-1.2, 0.25, 1.5); g.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 12), M.shopDark);
      foot.position.set(-1.2, 0.03, 1.5); g.add(foot);
    }
    g.position.set(-12, SHOP_FLOOR, SZ0 + 2.4);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    shop.add(g);
    handoff.solid(top, { kind: 'prop' });
    // a warm task light over the desk, so the near objects are LIT and not silhouettes
    /* Two of them, and hard. three.js point lights are physical since r155: intensity is
     * candela and illuminance falls off as 1/d², so 7 at a metre and a half puts about
     * three lux on the desk — which is to say nothing. Everything in front of the
     * monitor wall rendered as a pure black cut-out, and a silhouette with no surface in
     * it is the difference between "dark" and "missing". 30 lights the clutter without
     * lifting the room off its black floor. */
    for (const [lx, lz, k] of [[-4.5, SZ0 + 3.6, 30], [-16, SZ0 + 3.6, 22]]) {
      const tl = new THREE.PointLight(0xffdcae, k, 13, 2);
      tl.position.set(lx, SHOP_FLOOR + 2.5, lz);
      shop.add(tl); workshopLights.push(tl);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.bulb);
      bulb.position.copy(tl.position);
      shop.add(bulb);
    }
  }

  // Tool cabinets and chests along the walls: the red boxes in every workshop plate.
  for (const [x, z, ry, n] of [[-25, 6, 0, 4], [-25, 26, 0, 3], [19, 6, 0, 3], [-2, 31, 0, 4]]) {
    for (let i = 0; i < n; i++) {
      const w = 1.0 + rnd() * 0.5, h = 1.05 + rnd() * 0.65;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7),
        rnd() < 0.55 ? M.paintRed : M.shopDark);
      const ox = Math.cos(ry) * i * 1.55, oz = Math.sin(ry) * i * 1.55;
      body.position.set(x + ox, SHOP_FLOOR + h / 2, z + oz);
      body.castShadow = body.receiveShadow = true;
      shop.add(body);
      handoff.solid(body, { kind: 'prop' });
      // drawer fronts, so it is not a plain box
      for (let d = 0; d < 4; d++) {
        const dr = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h / 5.2, 0.05), M.shopDark);
        dr.position.set(body.position.x, SHOP_FLOOR + 0.16 + d * (h / 4.6), z + oz + 0.37);
        shop.add(dr);
      }
    }
  }

  // Shelving racks with crates — verticals that break up the far wall.
  for (const [x, z, ry] of [[-24, 18, 0], [17, 29, Math.PI / 2]]) {
    const g = new THREE.Group();
    for (let lvl = 0; lvl < 4; lvl++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.07, 1.0), M.shopDark);
      shelf.position.set(0, 0.5 + lvl * 0.85, 0);
      g.add(shelf);
      for (let i = 0; i < 4; i++) {
        if (rnd() < 0.3) continue;
        const bw = 0.4 + rnd() * 0.55;
        const box = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.3 + rnd() * 0.3, 0.6),
          rnd() < 0.3 ? M.paintRed : M.shopSteel);
        box.position.set(-2.2 + i * 1.4 + rnd() * 0.3, 0.72 + lvl * 0.85, rnd() * 0.2 - 0.1);
        box.castShadow = true;
        g.add(box);
      }
    }
    for (const sx of [-2.6, 2.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.9), M.shopDark);
      post.position.set(sx, 1.8, 0);
      g.add(post);
    }
    g.position.set(x, SHOP_FLOOR, z);
    g.rotation.y = ry;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    shop.add(g);
  }

  /* One of Tony's cars, under a dust cover. A long low silhouette on the floor is worth
   * more to this room than any amount of small clutter — it is the only object down here
   * that is bigger than a person and not a machine, so it sets the scale of everything. */
  {
    const g = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.95, 1.95), M.slabEdge);
    cover.position.y = 0.72; g.add(cover);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, 1.8), M.slabEdge);
    cab.position.set(-0.2, 1.35, 0); g.add(cab);
    for (const [wx, wz] of [[-1.6, 0.95], [-1.6, -0.95], [1.5, 0.95], [1.5, -0.95]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14), M.black);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.34, wz);
      g.add(wheel);
    }
    g.position.set(14, SHOP_FLOOR, -4);
    g.rotation.y = 0.42;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    shop.add(g);
    handoff.solid(cover, { kind: 'car' });
  }

  // An engine block on a stand, and a parts trolley beside it.
  {
    const g = new THREE.Group();
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 1.0), M.shopDark);
    stand.position.y = 0.85; g.add(stand);
    for (const [sx, sz] of [[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.07), M.shopDark);
      leg.position.set(sx, 0.42, sz); g.add(leg);
    }
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.7), M.shopSteel);
    block.position.y = 1.28; g.add(block);
    for (let i = 0; i < 4; i++) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 10), M.shopSteel);
      cyl.position.set(-0.34 + i * 0.23, 1.78, 0); g.add(cyl);
    }
    g.position.set(-13, SHOP_FLOOR, 27);
    g.rotation.y = -0.7;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
  }

  /* Pipe runs along the walls at head height. Cheap, and they are the single most
   * "workshop" silhouette there is: a horizontal line crossing everything behind it. */
  for (const [x0, z0, x1, z1, y] of [
    [SX0 + 0.5, SZ0 + 1, SX0 + 0.5, SZ1 - 1, SHOP_CEIL - 0.9],
    [SX1 - 0.5, SZ0 + 1, SX1 - 0.5, SZ1 - 1, SHOP_CEIL - 1.2],
    [SX0 + 1, SZ0 + 0.6, SX1 - 1, SZ0 + 0.6, SHOP_CEIL - 1.5],
  ]) {
    for (const [off, r, mat] of [[0, 0.11, M.shopSteel], [0.3, 0.07, M.shopDark]]) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      pipe.position.set((x0 + x1) / 2, y - off * 0.9, (z0 + z1) / 2);
      pipe.rotation.z = Math.PI / 2;
      pipe.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      shop.add(pipe);
    }
  }

  /* Pooled light on the floor.
   *
   * A point light with a 12 m range does not put a visible disc on a dark floor — the
   * floor is rough and nearly black, so the falloff is invisible and the room reads as
   * evenly dim. The reference is the opposite: hard bright pools with black between
   * them. These are additive discs laid 4 cm proud of the slab (never coplanar — that is
   * a z-fight waiting to happen) under each warm lamp, which costs nothing and is what
   * actually draws the pool.
   *
   * Kept very faint (2 %, 2 m) and warm-neutral rather than orange. At 11 % and 3.5 m
   * they stopped reading as light at all and read as MUD — brown ellipses on a dark
   * floor, which is exactly what a render of a puddle looks like. The point lights do the
   * real work now that they are bright enough; these only soften their falloff. */
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffeedd, transparent: true, opacity: 0.02, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (const [x, z, r] of [[-6, -5, 2.2], [10, 30, 2.0], [-20, 6, 2.3], [11, 20, 2.1],
                           [-6, 14, 2.8], [-13, 27, 1.8]]) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28), poolMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, SHOP_FLOOR + 0.04, z);
    disc.renderOrder = 2;
    shop.add(disc);
  }

  /* ── the middle of the room ──
   * Everything above lives against a wall, and a room whose entire contents are pushed
   * to its edges photographs as a black hole with a lit border. malibu_workshop_a has
   * three layers of junk between the lens and the nearest screen: a machine, a monitor
   * arm, a tool tray. These four objects stand in the open floor between the Hall of
   * Armor and the benches, which is precisely where the default workshop camera looks. */
  {
    // a boom arm with a monitor on it, leaning into frame
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 2.3, 8), M.shopDark);
    col.position.y = 1.15; g.add(col);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), M.shopDark);
    arm.rotation.z = Math.PI / 2; arm.position.set(0.7, 2.2, 0); g.add(arm);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshBasicMaterial({ map: screenTexture(91), toneMapped: false }));
    scr.position.set(1.4, 2.1, 0.03); scr.rotation.y = -0.5; g.add(scr);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.06), M.black);
    bez.position.set(1.4, 2.1, 0); bez.rotation.y = -0.5; g.add(bez);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 14), M.shopDark);
    base.position.y = 0.06; g.add(base);
    g.position.set(-4.5, SHOP_FLOOR, 8);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
    const pl = new THREE.PointLight(0x8fd0f0, 3.0, 7, 2);
    pl.position.set(-3.4, SHOP_FLOOR + 2.1, 8.3);
    shop.add(pl); workshopLights.push(pl);
  }
  {
    // a gas-bottle trolley: two tall cylinders, a strong vertical in the middle distance
    const g = new THREE.Group();
    for (const ox of [-0.22, 0.22]) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 12), M.paintRed);
      bottle.position.set(ox, 0.85, 0); g.add(bottle);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.3, 8), M.shopSteel);
      neck.position.set(ox, 1.72, 0); g.add(neck);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.06), M.shopDark);
    frame.position.set(0, 1.0, -0.28); g.add(frame);
    g.position.set(1.5, SHOP_FLOOR, 11);
    g.rotation.y = 0.6;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
    handoff.solid(frame, { kind: 'prop' });
  }
  {
    // a parts trolley with a red tray on it, low and wide, right in front of the gantry
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.9), M.shopDark);
    top.position.y = 0.85; g.add(top);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.9), M.shopDark);
    shelf.position.y = 0.35; g.add(shelf);
    for (const [ox, oz] of [[-0.65, -0.35], [0.65, -0.35], [-0.65, 0.35], [0.65, 0.35]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), M.shopDark);
      leg.position.set(ox, 0.42, oz); g.add(leg);
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.6), M.paintRed);
    tray.position.set(0, 0.91, 0); g.add(tray);
    for (let i = 0; i < 5; i++) {
      const tool = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.3), M.shopSteel);
      tool.position.set(-0.4 + i * 0.2, 0.96, 0.05 * i - 0.1);
      tool.rotation.y = 0.2 * i; g.add(tool);
    }
    g.position.set(-8.5, SHOP_FLOOR, 11.5);
    g.rotation.y = -0.35;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
    handoff.solid(top, { kind: 'prop' });
  }
  {
    // a suit-assembly jig: an empty A-frame with hanging clamps, straight out of
    // gantry_mk3_construction_hang. It is what the room is FOR, and it is a tall
    // silhouette in the open floor.
    const g = new THREE.Group();
    for (const ox of [-1.3, 1.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), M.shopDark);
      leg.position.set(ox, 1.6, 0); g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.18, 0.18), M.shopDark);
    beam.position.y = 3.2; g.add(beam);
    for (const [ox, len] of [[-0.8, 1.1], [0.1, 0.7], [0.9, 1.4]]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 5), M.black);
      chain.position.set(ox, 3.1 - len / 2, 0); g.add(chain);
      const clamp2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), M.shopSteel);
      clamp2.position.set(ox, 3.1 - len, 0); g.add(clamp2);
    }
    g.position.set(4, SHOP_FLOOR, 18);
    g.rotation.y = 0.9;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    shop.add(g);
    handoff.solid(beam, { kind: 'structure' });
  }

  // Loose junk on the floor: crates, drums, a stack of panels. Seeded, so it is stable.
  for (let i = 0; i < 26; i++) {
    const x = SX0 + 2 + rnd() * (SX1 - SX0 - 4);
    const z = SZ0 + 2 + rnd() * (SZ1 - SZ0 - 4);
    /* Keep-out zones. Scattering solid props by seed is fine right up until one lands on
     * a spawn point or across the only route from the stair, and then the player boots
     * inside a crate or cannot reach the Hall of Armor. Three circles, all of them
     * places the game puts the player or walks him through:
     *   the gantry pad, the workshop spawn, and the foot of the stair from the drum. */
    if (Math.hypot(x + 6, z - 14) < 6) continue;      // gantry pad
    if (Math.hypot(x + 6, z - 26) < 3.5) continue;    // ctx.world.spawns.workshop
    if (Math.hypot(x - 15, z - 16) < 5) continue;     // under the drum stair
    // …and the aisle in front of the armor cases, which runs down the west wall
    if (x < SX0 + 6 && z > -2 && z < 28) continue;
    const kind = rnd();
    let m;
    if (kind < 0.34) {
      const h = 0.55 + rnd() * 0.5;
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, h, 12),
        rnd() < 0.4 ? M.paintRed : M.shopDark);
      m.position.set(x, SHOP_FLOOR + h / 2, z);
    } else if (kind < 0.72) {
      const w = 0.5 + rnd() * 0.7, h = 0.4 + rnd() * 0.5;
      m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.8), M.shopSteel);
      m.position.set(x, SHOP_FLOOR + h / 2, z);
      m.rotation.y = rnd() * 3;
    } else {
      m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.9), M.shopDark);
      m.position.set(x, SHOP_FLOOR + 0.25, z);
      m.rotation.y = rnd() * 3;
    }
    m.castShadow = m.receiveShadow = true;
    shop.add(m);
    handoff.solid(m, { kind: 'prop' });
  }

  /* The gantry mark: the patch of floor that splits open in the Mk I/II/III sequences.
   * world only paints and publishes it; suitup animates it. */
  const gantry = new THREE.Group();
  {
    // The marker ring is INSET into the floor, not a light fitting. M.stripLight is a
    // toneMapped:false emissive and at 2.6 m radius it rendered as a blazing white hoop
    // that owned every frame of the workshop. A dim cyan line says "stand here" without
    // being the brightest thing in the basement.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2b7f9c, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.55, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(-6, SHOP_FLOOR + 0.02, 14);
    gantry.add(ring);
    for (const s of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 5.4), M.shopFloor);
      half.position.set(-6 + s * 1.27, SHOP_FLOOR - 0.06, 14);
      half.userData.gantryHalf = s;
      gantry.add(half);
    }
    shop.add(gantry);
  }

  root.add(shop);

  /* ── the practical lights ──
   * They belong to the basement and must not leak into the daylight scene, so they are
   * switched. What they are switched ON is the thing that matters, and it was wrong.
   *
   * The first version keyed off `ctx.env.current`, the environment's NAME, updated only
   * when somebody calls env.set(). But env.js also runs an automatic indoor test every
   * step — a ray straight up from the camera — and that test drives `env.k`, the actual
   * mix, WITHOUT touching `current`. So the two disagree constantly. Measured in the
   * workshop: `env.k = 0.986` (fully underground: fog, exposure and background all
   * correct) while `env.current` still read 'exterior', which meant all thirty-seven
   * practical lights were hidden. Every render of the workshop was lit by nothing but
   * emissive screens, and every attempt to fix it by turning the lamps up did exactly
   * nothing, because the lamps were off.
   *
   * `k` is the truth: it is what env.js itself uses for fog, exposure and background.
   * Read per frame, with a threshold low enough that the lights are already fading in
   * while the player is on the stairs. Cheap: a numeric compare and, on the rare frame
   * the state flips, one boolean write per light. */
  let lightsOn = null;
  const applyLights = () => {
    const k = (ctx.env && typeof ctx.env.k === 'number') ? ctx.env.k : 0;
    const on = k > 0.05;
    if (on === lightsOn) return;
    lightsOn = on;
    for (const l of workshopLights) l.visible = on;
  };
  applyLights();
  ctx.bus.on('env:changed', applyLights);

  return {
    root, interior, shop, glassPanels, gantry,
    armorStands,
    gantryPoint: { x: -6, y: SHOP_FLOOR, z: 14 },
    stairTop,
    update(dt, t) {
      applyLights();
      const w = holoGroup.userData.spin;
      if (w) { w.rotation.y = t * 0.35; w.rotation.x = Math.sin(t * 0.2) * 0.3; }
      for (let i = 0; i < holoGroup.children.length; i++) {
        const c = holoGroup.children[i];
        if (c.isMesh && c.geometry.type === 'TorusGeometry') c.rotation.z = t * (0.2 + i * 0.05);
      }
    },
  };
}
