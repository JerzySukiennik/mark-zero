// world/fair.js — the fairground. Owned by task `world`.
//
// The big wheel is here for one reason: it is the only thing in the world that MOVES on
// its own at a scale you can see from a kilometre up, which is what tells the player the
// world is alive rather than a diorama. It turns at a real fairground rate (one
// revolution in ~48 s) and the gondolas counter-rotate so they hang level.

import * as THREE from 'three';
import { SITES, terrainHeight } from './cliff.js';

const S = SITES.fair;

export function buildFair(ctx, M, handoff, lod) {
  const root = new THREE.Group();
  root.name = 'fair';
  root.position.set(S.x, terrainHeight(S.x, S.z), S.z);

  /* ── the field ──
   * A flat grey concrete disc 420 m across is not a fairground, it is a helipad: from
   * the air it read as a coin dropped on the desert, with a hard circular edge nothing
   * in the landscape explains. What a real fairground is, seen from 200 m up, is a
   * beaten dirt lot with a ring of parked cars round the outside and gravel paths worn
   * between the rides. So: dirt colour, a soft irregular edge, and a parking ring. */
  {
    const g = new THREE.Mesh(new THREE.CircleGeometry(196, 64), M.fairGround || M.concrete);
    g.material = new THREE.MeshStandardMaterial({
      color: 0xa08356, roughness: 0.99,
      bumpMap: M._textures.grain, bumpScale: 0.12,
    });
    // break the perfect circle: push the rim in and out so the edge reads as a worn lot
    {
      const pos = g.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const r = Math.hypot(x, y);
        if (r < 1) continue;
        const a = Math.atan2(y, x);
        const k = 1 + 0.11 * Math.sin(a * 3.0 + 1.2) + 0.07 * Math.sin(a * 7.0);
        pos.setXY(i, x * k, y * k);
      }
      pos.needsUpdate = true;
      g.geometry.computeBoundingSphere();
    }
    g.rotation.x = -Math.PI / 2;
    // 25 cm, not 2. These plazas are seen from hundreds of metres up, and at 200 m a
    // 24-bit depth buffer resolves about 2.6 cm — so a ground plane 2 cm above the
    // terrain stipples into z-fighting stripes across the whole site. A 25 cm lip is
    // invisible from the air and unambiguous to the depth test.
    g.position.y = 0.25;
    g.receiveShadow = true;
    root.add(g);
    handoff.solid(g, { kind: 'ground' });
  }

  /* ── the big wheel ── */
  /* 34 m radius, hub at 38 m. The wheel is the only moving thing in the world you can
   * see from a kilometre up, and at R = 23.5 it was smaller than the buildings in the
   * town next door — from the air it read as a bicycle wheel on a beach. A real
   * travelling big wheel is 45-70 m tall; this one is 72 m to the top. */
  const R = 34, HUB_Y = 38, SPOKES = 24;
  const wheel = new THREE.Group();
  wheel.position.set(0, HUB_Y, 0);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe4dccd, roughness: 0.45, metalness: 0.55, envMapIntensity: 1.4 });
  const rimRed = new THREE.MeshStandardMaterial({ color: 0xc03a2c, roughness: 0.5, metalness: 0.3 });
  const bulbMat = M.bulb;

  for (const r of [R, R - 4.4]) {
    for (const zo of [-2.2, 2.2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.26, 8, 84), r === R ? rimMat : rimRed);
      rim.position.z = zo;
      // No shadow from the rims or the spokes. A 47 m wheel of 16 cm tube casts a
      // stripe pattern far thinner than one shadow-map texel at this distance, so what
      // lands on the plaza is not a shadow, it is aliasing — the whole fairground came
      // out banded. The gondolas and the hub still cast, which is what reads anyway.
      rim.castShadow = false;
      wheel.add(rim);
    }
  }
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    for (const zo of [-1.6, 1.6]) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, R, 5), rimMat);
      sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, zo);
      sp.rotation.z = a - Math.PI / 2;
      wheel.add(sp);
    }
    // cross bracing between the two rims
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 5), rimMat);
    br.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    br.rotation.x = Math.PI / 2;
    wheel.add(br);
    // rim bulbs — emissive, toneMapped:false so they survive the bright sky
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), bulbMat);
    bulb.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(bulb);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6.4, 16), M.steel);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);

  const gondolas = [];
  const gondColors = [0xc8322a, 0x2f5fa8, 0xd8b02c, 0x2f8f52];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * (R - 2.2), Math.sin(a) * (R - 2.2), 0);
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 5), M.darkSteel);
    hanger.position.y = -0.7;
    const car = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 1.4, 4, 12),
      new THREE.MeshStandardMaterial({ color: gondColors[i % 4], roughness: 0.45, metalness: 0.2 }));
    car.rotation.x = Math.PI / 2;
    car.scale.set(1, 1, 0.85);
    car.position.y = -2.2;
    car.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.7 }));
    roof.position.y = -1.15;
    pivot.add(hanger, car, roof);
    wheel.add(pivot);
    gondolas.push(pivot);
    handoff.breakable(car, { material: 'metal', pieces: 8, mass: 400, threshold: 2.0 });
  }
  root.add(wheel);

  // A-frame legs
  for (const zo of [-11, 11]) {
    for (const xo of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.8, HUB_Y * 1.09, 8), M.steel);
      leg.position.set(xo * 7, HUB_Y / 2, zo);
      leg.rotation.z = -xo * 0.19;
      leg.rotation.x = -Math.sign(zo) * 0.27;
      leg.castShadow = true;
      root.add(leg);
      handoff.solid(leg, { kind: 'structure' });
    }
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 23, 12), M.steel);
  axle.rotation.x = Math.PI / 2;
  axle.position.y = HUB_Y;
  root.add(axle);

  /* ── carousel ── */
  const carousel = new THREE.Group();
  carousel.position.set(-62, 0, 38);
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.9, 28), M.paintCream);
    base.position.y = 0.45; base.receiveShadow = true;
    carousel.add(base);
    const spin = new THREE.Group();
    spin.position.y = 0.9;
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(9.2, 3.4, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd63f34, roughness: 0.7, side: THREE.DoubleSide }));
    canopy.position.y = 5.4;
    spin.add(canopy);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 5.6, 12), M.paintCream);
    post.position.y = 2.8; spin.add(post);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), M.steel);
      pole.position.set(Math.cos(a) * 6.8, 1.9, Math.sin(a) * 6.8);
      spin.add(pole);
      const horse = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.5),
        new THREE.MeshStandardMaterial({
          color: [0xf0e4d0, 0xc8544a, 0x4a6ea8][i % 3], roughness: 0.6,
        }));
      horse.position.set(Math.cos(a) * 6.8, 1.5, Math.sin(a) * 6.8);
      horse.rotation.y = -a;
      horse.castShadow = true;
      spin.add(horse);
    }
    carousel.add(spin);
    carousel.userData.spin = spin;
    root.add(carousel);
    handoff.solid(base, { kind: 'structure' });
  }

  /* ── stalls, tents, string lights ── */
  const stalls = new THREE.Group();
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.85, side: THREE.DoubleSide });
  const stripeRed = new THREE.MeshStandardMaterial({ color: 0xc4382f, roughness: 0.85, side: THREE.DoubleSide });
  /* ── the midway ──
   * Sixteen stalls spread evenly around a 100 m ring is not a fairground: it is sixteen
   * sheds in a field, each one alone, with two hundred metres of empty dirt in the
   * middle. What makes a fair read from the air is the MIDWAY — two rows of stalls
   * shoulder to shoulder, facing each other across a six-metre lane, with the wheel at
   * one end of it. That is a single strong line in the plan instead of a weak circle,
   * and it is also the thing that is fun to fly down at eye level.
   *
   * Two lanes crossing at the foot of the wheel; the stalls are packed at 9 m centres so
   * they touch, and every one is turned to face the lane. */
  function stall(x, z, ry, i) {
    const g = new THREE.Group();
    const w = 6 + (i % 3) * 1.2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 3, 4), M.paintCream);
    box.position.y = 1.5; box.castShadow = box.receiveShadow = true;
    g.add(box);
    // the awning over the counter — a flat sloping plane, the thing that reads as a stall
    const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.1, 2.4),
      i % 2 ? stripeRed : stripe);
    awn.position.set(0, 2.9, 2.6);
    awn.rotation.x = 0.22;
    awn.castShadow = true;
    g.add(awn);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 1.8, 4),
      i % 2 ? stripe : stripeRed);
    roof.position.y = 3.9; roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    // counter front, so it is not a blank box from the lane
    const counter = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.9, 0.5), M.darkSteel);
    counter.position.set(0, 1.1, 2.1);
    g.add(counter);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    stalls.add(g);
    handoff.solid(box, { kind: 'structure' });
    return g;
  }
  let sIdx = 0;
  // lane A: runs east from the wheel, stalls on both sides facing in
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 9.2;
    stall(x, -9.5, 0, sIdx++);                    // south row, faces +z (into the lane)
    if (i !== 4) stall(x, 9.5, Math.PI, sIdx++);  // north row, faces -z; one gap for a cut-through
  }
  // lane B: runs south-west from the wheel at an angle, so the plan is not a cross
  {
    const ang = 2.25;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < 7; i++) {
      const d = 42 + i * 9.2;
      const px = ca * d, pz = sa * d;
      const nx = -sa, nz = ca;                     // lane normal
      stall(px + nx * 9.5, pz + nz * 9.5, -ang - Math.PI / 2, sIdx++);
      stall(px - nx * 9.5, pz - nz * 9.5, -ang + Math.PI / 2, sIdx++);
    }
  }
  /* Catenary string lights, strung ALONG the midway lanes rather than round the outside
   * of the lot. Overhead wires closing the top of a lane is what turns two rows of sheds
   * into a street, and it is the detail you actually fly under. */
  const wirePts = [];
  for (let i = 0; i <= 9; i++) wirePts.push(new THREE.Vector3(38 + i * 9.2, 6.4, 0));
  {
    const ang = 2.25;
    for (let i = 7; i >= 0; i--) {
      const d = 40 + i * 9.2;
      wirePts.unshift(new THREE.Vector3(Math.cos(ang) * d, 6.4, Math.sin(ang) * d));
    }
  }
  for (let i = 0; i < wirePts.length - 1; i++) {
    const p0 = wirePts[i].clone(), p1 = wirePts[i + 1].clone();
    if (p0.distanceTo(p1) > 40) continue;          // do not span the gap between lanes
    const mid = p0.clone().add(p1).multiplyScalar(0.5); mid.y -= 2.4;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.03, 4, false), M.black);
    stalls.add(wire);
    for (let k = 1; k < 8; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), M.bulb);
      b.position.copy(curve.getPoint(k / 8));
      stalls.add(b);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.6, 6), M.darkSteel);
    pole.position.set(p0.x, 3.3, p0.z);
    stalls.add(pole);
    handoff.breakable(pole, { material: 'metal', pieces: 4, mass: 120, threshold: 1.2 });
  }
  root.add(stalls);

  /* ── the drop tower ──
   * A second vertical, thinner and taller than the wheel. Two verticals of different
   * heights is what makes a fairground silhouette read from a kilometre out; one on its
   * own just reads as a single object on an empty lot. */
  {
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 52, 10), M.steel);
    mast.position.y = 26;
    mast.castShadow = true;
    g.add(mast);
    for (let i = 0; i < 9; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 5, 14),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd8442f : 0xf0ebdd, roughness: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 4 + i * 5.4;
      g.add(ring);
    }
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 2.2, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.5, side: THREE.DoubleSide }));
    cab.position.y = 38;
    g.add(cab);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(5.4, 4, 14), M.paintRed);
    cap.position.y = 54;
    cap.castShadow = true;
    g.add(cap);
    g.position.set(58, 0, -46);
    root.add(g);
    handoff.solid(mast, { kind: 'structure' });
  }

  /* ── the parking ring ──
   * Sixty cars in rows around the outside. They cost almost nothing (one box and one
   * cabin each) and they are the single clearest "this place has people in it" signal
   * from the air, which is the only altitude most players will ever see it from. */
  const parking = new THREE.Group();
  {
    const cols = [0x8d2f26, 0x1e2b3a, 0xd7d2c8, 0x2f3a2c, 0x9aa0a6, 0xb8a03c, 0x35506e];
    let pr = 7717;
    const rnd = () => ((pr = (pr * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let row = 0; row < 3; row++) {
      const rr = 150 + row * 9;
      const n = Math.round(2 * Math.PI * rr / 12);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.32) continue;
        const a = (i / n) * Math.PI * 2 + rnd() * 0.02;
        const cg = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 4.6),
          new THREE.MeshStandardMaterial({
            color: cols[(rnd() * cols.length) | 0], roughness: 0.35, metalness: 0.5,
            envMapIntensity: 1.3,
          }));
        body.position.y = 0.75;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.68, 2.2), M.glassClear);
        cab.position.set(0, 1.45, -0.2);
        cg.add(body, cab);
        cg.position.set(Math.cos(a) * rr, 0.26, Math.sin(a) * rr);
        cg.rotation.y = -a;
        parking.add(cg);
      }
    }
    root.add(parking);
  }

  /* Worn gravel paths between the rides — thin darker rings and spokes on the dirt. */
  {
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x8a7150, roughness: 1.0 });
    // The two midway lanes, worn into the dirt between the stall rows, plus one loop
    // road round the rides. Concentric rings and six radial spokes — which is what was
    // here — draw a dartboard on the ground; the paths have to be where the people
    // actually walk, which is now the midway.
    const lanes = [
      { x: 78, z: 0, w: 100, d: 17, ry: 0 },
      { x: Math.cos(2.25) * 78, z: Math.sin(2.25) * 78, w: 86, d: 17, ry: -2.25 },
      { x: 0, z: 0, w: 46, d: 46, ry: 0 },
    ];
    for (const L of lanes) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.d), pathMat);
      pl.rotation.x = -Math.PI / 2;
      pl.rotation.z = L.ry;
      // 8 cm over the lot, not 2. The lot itself is 25 cm over the terrain for exactly
      // the same reason: two nearly-coplanar horizontal planes seen from 200 m up are a
      // z-fight, and 2 cm is inside the depth buffer's noise at that range.
      pl.position.set(L.x, 0.33, L.z);
      root.add(pl);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(136, 143, 72), pathMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.33;
    root.add(ring);
  }

  const centre = new THREE.Vector3(S.x, S.h, S.z);
  lod.add(stalls, 2200, { center: centre });
  lod.add(carousel, 1600, { center: centre });
  lod.add(parking, 2600, { center: centre });

  let wheelAngle = 0;
  return {
    root, wheel,
    update(dt) {
      wheelAngle += dt * (Math.PI * 2 / 48);       // one turn every 48 s
      wheel.rotation.z = wheelAngle;
      for (const g of gondolas) g.rotation.z = -wheelAngle;   // hang level
      const sp = carousel.userData.spin;
      if (sp) sp.rotation.y += dt * 0.55;
    },
  };
}
