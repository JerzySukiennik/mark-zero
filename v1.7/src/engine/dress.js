// Workshop dressing. Owned by engine-core.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN world/.
// The critic's measurement on the workshop was not "the lights are wrong", it was
// "the darkness is EMPTY". A 5-bucket luminance histogram of
// reference/world/malibu_workshop_a.jpg puts 21.5% of its pixels above the bottom fifth
// of the range with a broad 13% low-mid band; our matched frame put 3.4% above it and
// 1.1% in that band. The reference is a tight, cluttered room where every light has
// three silhouettes in front of it. Ours was a large room where the light had nothing to
// land on between the lamp and the far wall, so every frame was black with a few glowing
// rectangles floating in it.
//
// The room itself is world/'s file and another agent is writing it. So this module does
// the one thing that can be done from the engine side without touching a line world/
// owns: it reads what world/ actually built — ctx.world.armorStands, the bounds of the
// shop group, the meshes already in it — and ADDS the mid-ground. Everything here is
// placed relative to what it finds, so it still lands correctly if world/ moves or
// shrinks the room underneath it.
//
// The rule it is built to hit, taken straight from the critique: from any standing point
// in the shop, at least six distinct objects sit between 2 and 8 m of the camera with
// their mass between 0.8 and 2.0 m off the floor. That band is where the practicals'
// light actually falls; anything above or below it is decoration.
//
// It also fixes two things that are visible in the same frame and are properties of
// materials rather than of geometry, so they can be repaired in place on meshes world/
// built:
//   * the monitors read as blank pastel plates. Their mean luminance is pulled down so
//     they stop blowing out, and each bank gets one broad low-decay source so the bench
//     in front of it is grazed rather than black.
//   * the armor cases are a flat blue filter with a strip along the bottom. In
//     hall_of_armor_cases every pane is EDGE-LIT: a thin bright white-green line down
//     both verticals and across the top, and the suit reads THROUGH the glass, not
//     behind a blue wash.
//
// Wired from main.js after every module has initialised, because it needs ctx.world and
// ctx.physics and neither exists at registry-init time. registry.js is frozen, so this
// is not a module; it is cross-module wiring, exactly like the stair lights.
import * as THREE from 'three';

// Deterministic. A shop that rearranges itself between reloads cannot be lit and cannot
// have a frame of it reproduced by a critic.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function mats() {
  const m = {};
  // Everything down here is seen at 1–20 lux. Base colours are therefore LIGHTER than
  // the thing they represent: a "black" steel cabinet at 0x111111 in a room this dark is
  // not a cabinet, it is a hole. Mid-greys with high roughness are what read.
  m.steel   = new THREE.MeshStandardMaterial({ color: 0x8f979d, roughness: 0.52, metalness: 0.72 });
  m.steelD  = new THREE.MeshStandardMaterial({ color: 0x5a6167, roughness: 0.62, metalness: 0.6 });
  m.paint   = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.55, metalness: 0.25 });
  m.red     = new THREE.MeshStandardMaterial({ color: 0x8d2a24, roughness: 0.45, metalness: 0.35 });
  m.redD    = new THREE.MeshStandardMaterial({ color: 0x5c1c18, roughness: 0.55, metalness: 0.3 });
  m.rack    = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.62, metalness: 0.55 });
  m.crate   = new THREE.MeshStandardMaterial({ color: 0x7d7361, roughness: 0.85, metalness: 0.05 });
  m.crateB  = new THREE.MeshStandardMaterial({ color: 0x5d6a72, roughness: 0.8, metalness: 0.1 });
  m.rubber  = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.95, metalness: 0.0 });
  m.gold    = new THREE.MeshStandardMaterial({ color: 0x9d8046, roughness: 0.38, metalness: 0.9 });
  m.hotrod  = new THREE.MeshStandardMaterial({ color: 0x6e1418, roughness: 0.22, metalness: 0.55 });
  m.chrome  = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.16, metalness: 1.0 });
  m.board   = new THREE.MeshStandardMaterial({ color: 0x6a5f4e, roughness: 0.9, metalness: 0.0 });
  return m;
}

/* A pane edge: a thin emissive bar. toneMapped false, because at the exposure the
 * workshop runs an edge light that IS tone mapped comes out grey. */
const edgeMat = new THREE.MeshBasicMaterial({ color: 0xcaf4ff, toneMapped: false });
const edgeMatDim = new THREE.MeshBasicMaterial({ color: 0x63a8c4, toneMapped: false });

/* ── the screen face ──
 * 512x320 of dense UI: thin rules, blocked-out text rows, one wireframe silhouette, a
 * few brighter cells. Drawn dark on purpose — the mean luminance lands around 0.35, so
 * the panel reads as a monitor carrying information rather than as a lit rectangle. */
function screenFace(seed) {
  const r = rng(seed * 977 + 13);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#040a10'; g.fillRect(0, 0, 512, 320);
  // panel blocks
  const cols = 2 + Math.floor(r() * 2);
  for (let i = 0; i < cols; i++) {
    const x = 8 + i * (496 / cols), w = 496 / cols - 10;
    g.fillStyle = 'rgba(20,58,80,0.55)';
    g.fillRect(x, 8, w, 304);
    g.strokeStyle = 'rgba(120,205,240,0.55)'; g.lineWidth = 1;
    g.strokeRect(x + 0.5, 8.5, w - 1, 303);
    // header bar
    g.fillStyle = 'rgba(150,225,255,0.7)';
    g.fillRect(x + 6, 14, w * (0.3 + r() * 0.4), 5);
    // rows of blocked-out text
    let y = 30;
    while (y < 300) {
      const kind = r();
      if (kind < 0.55) {
        const n = 3 + Math.floor(r() * 5);
        for (let k = 0; k < n; k++) {
          g.fillStyle = 'rgba(130,200,235,' + (0.25 + r() * 0.4).toFixed(2) + ')';
          g.fillRect(x + 7 + k * (w / n), y, (w / n) * (0.35 + r() * 0.5), 3);
        }
        y += 7;
      } else if (kind < 0.72) {          // a thin cyan rule
        g.fillStyle = 'rgba(110,190,225,0.5)';
        g.fillRect(x + 6, y, w - 12, 1);
        y += 9;
      } else if (kind < 0.86) {          // a small bar chart
        const n = 8 + Math.floor(r() * 8);
        for (let k = 0; k < n; k++) {
          const h = 4 + r() * 22;
          g.fillStyle = 'rgba(160,225,255,' + (0.3 + r() * 0.45).toFixed(2) + ')';
          g.fillRect(x + 8 + k * ((w - 16) / n), y + 26 - h, (w - 16) / n - 2, h);
        }
        y += 34;
      } else {                            // a brighter readout cell
        g.fillStyle = 'rgba(190,240,255,0.85)';
        g.fillRect(x + 8, y, 26 + r() * 40, 12);
        g.fillStyle = 'rgba(120,195,230,0.35)';
        g.fillRect(x + 8, y + 14, w - 20, 2);
        y += 22;
      }
    }
  }
  // one wireframe silhouette — a helmet front, the thing every plate in the reference has
  {
    const cx = 120 + r() * 260, cy = 150 + r() * 40, s = 0.55 + r() * 0.4;
    g.save(); g.translate(cx, cy); g.scale(s, s);
    g.strokeStyle = 'rgba(140,225,255,0.8)'; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-30, -52); g.lineTo(30, -52); g.lineTo(38, -10); g.lineTo(26, 44);
    g.lineTo(0, 60); g.lineTo(-26, 44); g.lineTo(-38, -10); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-30, -6); g.lineTo(-9, -10); g.lineTo(-9, 2); g.lineTo(-28, 4);
    g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(30, -6); g.lineTo(9, -10); g.lineTo(9, 2); g.lineTo(28, 4);
    g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-16, 30); g.lineTo(16, 30); g.stroke();
    g.strokeStyle = 'rgba(90,160,200,0.45)';
    g.beginPath(); g.moveTo(0, -52); g.lineTo(0, 60); g.stroke();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function dressWorkshop(ctx) {
  const W = ctx.world;
  if (!W || !W.malibu || !W.malibu.shop || !W.armorStands || !W.armorStands.length) return null;
  const shop = W.malibu.shop;
  const stands = W.armorStands;
  const M = mats();
  const r = rng(20260903);

  // ---- where the room actually is -------------------------------------------------
  // Read off the meshes world/ built rather than off constants in world/'s file, so a
  // room that gets shrunk or moved by the other agent still gets dressed correctly.
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  shop.updateWorldMatrix(true, true);
  shop.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    tmp.setFromObject(o);
    if (isFinite(tmp.min.x)) box.union(tmp);
  });
  if (!isFinite(box.min.x)) return null;
  const floorY = stands[0].y;
  const X0 = box.min.x, X1 = box.max.x, Z0 = box.min.z, Z1 = box.max.z;
  const ceilY = Math.min(box.max.y, floorY + 4.6);
  const caseX = stands[0].x;                       // the mouth of the case row
  let zMin = Infinity, zMax = -Infinity;
  for (const s of stands) { zMin = Math.min(zMin, s.z); zMax = Math.max(zMax, s.z); }

  const g = new THREE.Group();
  g.name = 'workshop-dressing';
  const lights = [];
  const solids = [];

  const add = (mesh, solid) => {
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    if (solid) solids.push(mesh);
    return mesh;
  };
  const bx = (w, h, d, mat, x, y, z, ry, solid) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    return add(m, solid);
  };
  const cyl = (rt, rb, h, mat, x, y, z, rz) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    return add(m, false);
  };

  /* ─────────── 1. shelving racks with visible shelf edges ───────────
   * The reference's long wall is a wall of parts. A rack is four horizontal edges
   * catching the light at 0.5 / 1.35 / 2.2 / 3.0 m — which is exactly the 0.8–2.0 m band
   * the practicals reach — with boxes on them breaking the line. */
  function rack(x, z, len, ry, seed) {
    if (inLane(x, z, len * 0.5)) return;   // never in the walk-on lane
    const q = rng(seed);
    const grp = new THREE.Group();
    const D = 0.95;
    for (let lvl = 0; lvl < 4; lvl++) {
      const y = 0.42 + lvl * 0.82;
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, D), M.rack);
      shelf.position.set(0, y, 0); grp.add(shelf);
      // the LIP. A shelf seen edge-on in a dark room is one pixel; the lip is what
      // actually catches a grazing light and draws the horizontal.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.11, 0.04), M.steel);
      lip.position.set(0, y + 0.06, D / 2); grp.add(lip);
      const n = Math.max(2, Math.round(len / 0.9));
      for (let i = 0; i < n; i++) {
        if (q() < 0.28) continue;
        const bw = 0.35 + q() * 0.45, bh = 0.22 + q() * 0.36;
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.4 + q() * 0.3),
          q() < 0.3 ? M.crateB : (q() < 0.5 ? M.red : M.crate));
        b.position.set(-len / 2 + 0.5 + i * ((len - 1) / n), y + 0.03 + bh / 2, (q() - 0.5) * 0.3);
        b.rotation.y = (q() - 0.5) * 0.3;
        grp.add(b);
      }
    }
    for (const sx of [-len / 2 + 0.08, len / 2 - 0.08]) {
      for (const sz of [-D / 2 + 0.06, D / 2 - 0.06]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3.4, 0.09), M.rack);
        post.position.set(sx, 1.7, sz); grp.add(post);
      }
    }
    grp.position.set(x, floorY, z);
    grp.rotation.y = ry;
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(grp);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 3.4, D), M.rack);
    hull.position.set(x, floorY + 1.7, z); hull.rotation.y = ry; hull.visible = false;
    g.add(hull); solids.push(hull);
    return grp;
  }

  /* ─────────── 2. rolling tool chest ─────────── */
  function chest(x, z, ry, seed) {
    if (inLane(x, z, 1.0)) return;
    const q = rng(seed);
    const w = 1.15, h = 1.05 + q() * 0.25, d = 0.62;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), q() < 0.6 ? M.red : M.steelD);
    body.position.y = 0.13 + h / 2; grp.add(body);
    // drawer fronts + a bright pull on each: the pulls are the detail that reads at 6 m
    const rows = 5;
    for (let i = 0; i < rows; i++) {
      const y = 0.2 + i * ((h - 0.14) / rows);
      const dr = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, (h - 0.14) / rows - 0.03, 0.03), M.redD);
      dr.position.set(0, y, d / 2 + 0.015); grp.add(dr);
      const pull = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.035, 0.035), M.chrome);
      pull.position.set(0, y, d / 2 + 0.04); grp.add(pull);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06), M.steel);
    top.position.y = 0.13 + h + 0.02; grp.add(top);
    for (const sx of [-w / 2 + 0.14, w / 2 - 0.14]) for (const sz of [-d / 2 + 0.1, d / 2 - 0.1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), M.rubber);
      c.rotation.z = Math.PI / 2; c.position.set(sx, 0.09, sz); grp.add(c);
    }
    grp.position.set(x, floorY, z); grp.rotation.y = ry;
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(grp);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.2, d), M.red);
    hull.position.set(x, floorY + (h + 0.2) / 2, z); hull.rotation.y = ry; hull.visible = false;
    g.add(hull); solids.push(hull);
  }

  /* ─────────── 3. stacked crates ─────────── */
  function crates(x, z, n, seed) {
    if (inLane(x, z, 1.1)) return;
    const q = rng(seed);
    let y = floorY;
    for (let i = 0; i < n; i++) {
      const w = 0.7 + q() * 0.6, h = 0.42 + q() * 0.3, d = 0.6 + q() * 0.5;
      const c = bx(w, h, d, q() < 0.45 ? M.crateB : M.crate,
        x + (q() - 0.5) * 0.3, y + h / 2, z + (q() - 0.5) * 0.3, (q() - 0.5) * 0.7, i === 0);
      // a strap / band, so a crate is not a plain box
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.05, d + 0.02), M.steelD);
      band.position.copy(c.position); band.rotation.y = c.rotation.y; g.add(band);
      y += h;
    }
  }

  /* ─────────── 4. loose armor parts, ON the bench tops ───────────
   * The benches are bare boxes. A gauntlet, a helmet shell and a chest plate lying on one
   * is the single cheapest thing that says "somebody builds Iron Man suits here". */
  function partsOnTop(x, y, z, seed) {
    const q = rng(seed);
    const kind = Math.floor(q() * 3);
    if (kind === 0) {            // gauntlet: forearm tube + hand plate + knuckle discs
      const grp = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.34, 10), M.hotrod);
      fore.rotation.z = Math.PI / 2; grp.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, 0.15), M.gold);
      hand.position.set(0.24, -0.01, 0); grp.add(hand);
      const pal = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12),
        new THREE.MeshBasicMaterial({ color: 0x9fe0ff, toneMapped: false }));
      pal.position.set(0.29, -0.045, 0); pal.rotation.x = Math.PI / 2; grp.add(pal);
      grp.position.set(x, y + 0.13, z); grp.rotation.y = q() * 6;
      grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(grp);
    } else if (kind === 1) {     // helmet shell, faceplate off, lying on its side
      const grp = new THREE.Group();
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10, 0, Math.PI * 2, 0, 1.9),
        q() < 0.5 ? M.hotrod : M.steel);
      sh.rotation.x = Math.PI * 0.55; grp.add(sh);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.02, 0.24), M.gold);
      face.position.set(0.3, -0.13, 0.04); face.rotation.z = 0.1; grp.add(face);
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.014),
        new THREE.MeshBasicMaterial({ color: 0xbfefff, toneMapped: false }));
      slot.position.set(0.3, -0.115, 0.04); slot.rotation.x = -Math.PI / 2; grp.add(slot);
      grp.position.set(x, y + 0.05, z); grp.rotation.y = q() * 6;
      grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      g.add(grp);
    } else {                     // a chest / thigh plate and a couple of fasteners
      const p = bx(0.34, 0.045, 0.26, q() < 0.5 ? M.hotrod : M.gold, x, y + 0.03, z, q() * 6, false);
      p.rotation.x = 0.08;
      for (let i = 0; i < 3; i++)
        cyl(0.018, 0.018, 0.05, M.chrome, x + (q() - 0.5) * 0.4, y + 0.03, z + (q() - 0.5) * 0.35);
    }
  }

  /* ─────────── 5. the car ───────────
   * The single largest silhouette filler available, and it is in the reference workshop.
   * A low hot-rod: long body, separated fenders, chrome grille, four fat wheels. It is
   * not a hero asset; it is a five-metre horizontal mass that the light lands on and
   * that everything behind it becomes a silhouette against. */
  function car(x, z, ry) {
    if (inLane(x, z, 2.6)) return;
    const grp = new THREE.Group();
    const L = 4.6, Wd = 1.95;
    const sill = new THREE.Mesh(new THREE.BoxGeometry(L, 0.30, Wd * 0.78), M.hotrod);
    sill.position.y = 0.52; grp.add(sill);
    const body = new THREE.Mesh(new THREE.BoxGeometry(L * 0.94, 0.42, Wd * 0.72), M.hotrod);
    body.position.y = 0.82; grp.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(L * 0.34, 0.20, Wd * 0.66), M.hotrod);
    hood.position.set(L * 0.30, 1.08, 0); grp.add(hood);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.34, 0.42, Wd * 0.60), M.steelD);
    cabin.position.set(-L * 0.13, 1.22, 0); grp.add(cabin);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(L * 0.30, 0.30, Wd * 0.61),
      new THREE.MeshPhysicalMaterial({ color: 0x16242c, roughness: 0.12, metalness: 0.2,
                                        transparent: true, opacity: 0.55 }));
    glass.position.set(-L * 0.13, 1.24, 0); grp.add(glass);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, Wd * 0.6), M.chrome);
    grille.position.set(L * 0.48, 0.86, 0); grp.add(grille);
    for (const sz of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M.chrome);
      lamp.position.set(L * 0.40, 1.10, sz * Wd * 0.28); grp.add(lamp);
      // fenders — the shapes that make a shadow read as a car and not as a crate
      for (const sx of [L * 0.34, -L * 0.34]) {
        const f = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.13, 8, 14, Math.PI), M.hotrod);
        f.position.set(sx, 0.56, sz * Wd * 0.48);
        f.rotation.y = Math.PI / 2; grp.add(f);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.28, 16), M.rubber);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(sx, 0.46, sz * Wd * 0.48); grp.add(wheel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.30, 14), M.chrome);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(sx, 0.46, sz * Wd * 0.48); grp.add(hub);
      }
    }
    // exhaust headers down the side — chrome, and they catch every practical in the room
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), M.chrome);
      p.rotation.z = Math.PI / 2; p.rotation.y = 0.2;
      p.position.set(L * 0.22 - i * 0.22, 0.72, -Wd * 0.40); grp.add(p);
    }
    grp.position.set(x, floorY, z); grp.rotation.y = ry;
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(grp);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(L, 1.5, Wd), M.hotrod);
    hull.position.set(x, floorY + 0.75, z); hull.rotation.y = ry; hull.visible = false;
    g.add(hull); solids.push(hull);
  }

  /* ─────────── 6. wall tool board ─────────── */
  function toolBoard(x, z, ry, w) {
    const grp = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.7, 0.05), M.board);
    b.position.y = 2.0; grp.add(b);
    const q = rng(Math.round(x * 31 + z));
    for (let i = 0; i < Math.round(w * 3.2); i++) {
      const t = q();
      const px = -w / 2 + 0.25 + q() * (w - 0.5), py = 1.4 + q() * 1.15;
      let o;
      if (t < 0.4) {            // spanner
        o = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.26 + q() * 0.16, 0.02), M.chrome);
      } else if (t < 0.7) {     // hammer / driver
        o = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), M.steelD);
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.07), M.steel);
        h.position.set(0, 0.17, 0); o.add(h);
      } else {                  // clamp
        o = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI * 1.4), M.steel);
      }
      o.position.set(px, py, 0.06);
      o.rotation.z = (q() - 0.5) * 0.25;
      grp.add(o);
    }
    grp.position.set(x, floorY, z); grp.rotation.y = ry;
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(grp);
  }

  /* ─────────── 7. engine hoist, gas bottles, drums ───────────
   * Tall thin verticals. In the reference the frame is cut up by uprights — a gantry leg,
   * a stand, a pipe — and that vertical rhythm is most of what makes it read as a shop. */
  function hoist(x, z, ry) {
    if (inLane(x, z, 1.3)) return;
    const grp = new THREE.Group();
    const leg = (sx) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), M.steelD);
      l.position.set(sx, 1.15, 0); grp.add(l);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 1.5), M.steelD);
      foot.position.set(sx, 0.05, 0); grp.add(foot);
    };
    leg(-0.9); leg(0.9);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.14), M.steelD);
    beam.position.y = 2.3; grp.add(beam);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.13, 0.13), M.steel);
    boom.position.set(0.9, 2.05, 0); boom.rotation.z = -0.35; grp.add(boom);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), M.chrome);
    chain.position.set(1.75, 1.75, 0); grp.add(chain);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 10, Math.PI * 1.5), M.chrome);
    hook.position.set(1.75, 1.28, 0); grp.add(hook);
    grp.position.set(x, floorY, z); grp.rotation.y = ry;
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(grp);
  }
  function bottles(x, z, n, seed) {
    if (inLane(x, z, 0.6)) return;
    const q = rng(seed);
    const cage = bx(n * 0.36 + 0.2, 1.0, 0.5, M.steelD, x, floorY + 0.5, z, 0, true);
    cage.material = M.rack;
    for (let i = 0; i < n; i++) {
      const h = 1.25 + q() * 0.25;
      const col = q() < 0.4 ? M.red : (q() < 0.7 ? M.steel : M.crateB);
      cyl(0.12, 0.12, h, col, x - (n - 1) * 0.18 + i * 0.36, floorY + h / 2, z + (q() - 0.5) * 0.1);
      cyl(0.05, 0.05, 0.14, M.chrome, x - (n - 1) * 0.18 + i * 0.36, floorY + h + 0.07, z);
    }
  }
  function drum(x, z, seed) {
    if (inLane(x, z, 0.5)) return;
    const q = rng(seed);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.88, 16), q() < 0.5 ? M.red : M.crateB);
    d.position.set(x, floorY + 0.44, z);
    add(d, true);
    for (const y of [floorY + 0.26, floorY + 0.62]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.022, 6, 18), M.steelD);
      rib.rotation.x = Math.PI / 2; rib.position.set(x, y, z); g.add(rib);
    }
  }

  /* ═════════════ PLACEMENT ═════════════
   * All coordinates are expressed relative to the case row and the room bounds that were
   * measured above, never as literals against world/'s constants — the other agent is
   * shrinking this room and everything here has to follow it.
   *
   * `aisle` is the open lane in front of the cases the player walks down; nothing goes in
   * it. Everything else fills the middle of the floor, which is where the black was. */
  const aisleX = caseX + 3.4;                      // keep clear out to here
  const midX = Math.min(X1 - 3, aisleX + 9);       // the working middle of the shop
  const spanZ = Math.max(6, zMax - zMin);

  /* THE WALK-ON LANE.
   * Picking an armour walks the boy out of the aisle and onto the gantry pad — onfoot.js
   * drives it, and it is the beat the whole room exists for. This dressing knew about the
   * aisle and nothing about the pad, so it filled the floor between them: measured, a
   * tool chest at (-12.2, 8.9) sat squarely on his line and he ground against it for the
   * full 9.5 s until the approach timeout gave up and teleported him. Keep one corridor
   * open along the pad's row, plus the pad itself, and nothing else has to change. */
  const pad = W.gantryPoint || (W.malibu && W.malibu.gantryPoint) || null;
  const LANE = 1.9;                                // half-width of the corridor
  function inLane(x, z, half = 0) {
    if (!pad) return false;
    const r = LANE + half;
    if (Math.abs(z - pad.z) <= r &&
        x >= Math.min(caseX, pad.x) - r && x <= Math.max(caseX, pad.x) + r) return true;
    return Math.hypot(x - pad.x, z - pad.z) < 3.4 + half;   // the pad and its ring
  }

  // long-wall shelving: the far end of the case wall, and the wall opposite it
  rack(aisleX + 1.2, zMin - 4.0, 6.0, 0, 41);
  rack(midX + 3.5, zMin - 4.2, 5.0, 0, 77);
  rack(X1 - 1.4, zMin + spanZ * 0.55, 6.5, Math.PI / 2, 91);
  rack(aisleX + 0.8, zMax + 4.5, 5.5, 0, 55);

  // the car, parked in the middle of the near half — the big horizontal mass
  car(aisleX + 5.4, zMin - 2.6, 0.42);

  // a second, stripped chassis further back, so the row of shapes has depth
  {
    const c = new THREE.Group();
    for (const sz of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.18), M.steelD);
      rail.position.set(0, 0.55, sz * 0.62); c.add(rail);
      for (const sx of [1.5, -1.5]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 14), M.rubber);
        w.rotation.x = Math.PI / 2; w.position.set(sx, 0.42, sz * 0.86); c.add(w);
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.3), M.steelD);
      x.position.set(-1.6 + i * 1.05, 0.55, 0); c.add(x);
    }
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), M.steel);
    blk.position.set(1.2, 0.95, 0); c.add(blk);
    c.position.set(midX + 1.0, floorY, zMin + spanZ * 0.42);
    c.rotation.y = -0.9;
    c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(c);
  }

  hoist(aisleX + 2.0, zMin + spanZ * 0.28, 1.1);
  hoist(midX + 2.2, zMax + 2.0, -0.4);

  bottles(aisleX + 0.9, zMin - 5.2, 4, 7);
  bottles(X1 - 1.0, zMin + spanZ * 0.12, 3, 19);

  // tool chests and crates: eight of each, scattered through the middle band and never
  // in the aisle. This is the population that satisfies "six objects between 2 and 8 m".
  const spots = [
    [aisleX + 1.6, zMin - 1.2], [aisleX + 2.2, zMin + spanZ * 0.20],
    [aisleX + 1.4, zMin + spanZ * 0.52], [aisleX + 2.6, zMax + 1.4],
    [midX - 1.2, zMin - 3.4], [midX + 0.6, zMin + spanZ * 0.30],
    [midX - 0.4, zMin + spanZ * 0.72], [midX + 1.8, zMax + 3.0],
  ];
  spots.forEach(([x, z], i) => chest(x, z, (i % 3) * 0.7 - 0.7, 100 + i * 13));
  spots.forEach(([x, z], i) => crates(x + 2.3, z + 1.6, 2 + (i % 3), 400 + i * 29));
  crates(aisleX + 0.9, zMin + spanZ * 0.36, 4, 811);
  crates(midX + 2.6, zMin - 1.0, 3, 833);
  drum(aisleX + 3.0, zMin + spanZ * 0.62, 3);
  drum(aisleX + 3.6, zMin + spanZ * 0.66, 5);
  drum(midX - 2.0, zMax + 2.2, 9);

  // tool boards on the two long walls
  toolBoard(X0 + 0.2, zMin - 5.5, Math.PI / 2, 4.0);
  toolBoard(X1 - 0.2, zMin + spanZ * 0.2, -Math.PI / 2, 4.5);

  /* ─────────── 7b. three warm clamp lamps ───────────
   * Everything else down here is cyan — the cases, the monitors, the holo table, the
   * bounce standing in for them. Rendered, that came out as one uniform blue room, and
   * the reference plate is not: its background is warm olive-brown and the cool screens
   * read as cool BECAUSE something warm is next to them. Colour contrast, not level.
   * Tungsten, decay 1.6 rather than 2 so a lamp lights a bench and not a coin, and a
   * visible bulb so the source is in frame rather than implied. */
  function clampLamp(x, z, y) {
    if (inLane(x, z, 0.8)) return;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), M.steelD);
    stalk.position.set(x, floorY + y + 0.25, z); g.add(stalk);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.20, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.5, metalness: 0.6,
                                       side: THREE.DoubleSide }));
    shade.position.set(x, floorY + y, z); g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd9a8, toneMapped: false }));
    bulb.position.set(x, floorY + y - 0.07, z); g.add(bulb);
    const l = new THREE.PointLight(0xffc98e, 3.0, 8.5, 1.6);
    l.position.set(x, floorY + y - 0.12, z);
    g.add(l); lights.push(l);
  }
  clampLamp(aisleX + 2.4, zMin + spanZ * 0.10, 1.85);
  clampLamp(midX + 0.4, zMin + spanZ * 0.58, 2.05);
  clampLamp(aisleX + 1.1, zMax + 2.8, 1.75);

  /* ─────────── 8. loose parts on every bench top world/ built ───────────
   * Found by measurement, not by knowing where world/ put them: a bench top is a thin
   * horizontal slab between 0.80 and 1.05 m off the floor and at least 0.8 m across. */
  {
    const b = new THREE.Box3();
    const tops = [];
    shop.traverse(o => {
      if (!o.isMesh || !o.geometry || o.userData.gantryHalf !== undefined) return;
      b.setFromObject(o);
      const h = b.max.y - b.min.y, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (h > 0.16 || b.max.y - floorY < 0.78 || b.max.y - floorY > 1.10) return;
      if (Math.min(w, d) < 0.5 || Math.max(w, d) < 1.2) return;
      tops.push({ y: b.max.y, x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
    });
    let placed = 0;
    for (const t of tops) {
      const n = Math.min(4, 1 + Math.floor((Math.max(t.x1 - t.x0, t.z1 - t.z0)) / 2.2));
      for (let i = 0; i < n && placed < 34; i++, placed++) {
        partsOnTop(t.x0 + 0.35 + r() * Math.max(0.01, t.x1 - t.x0 - 0.7),
                   t.y,
                   t.z0 + 0.25 + r() * Math.max(0.01, t.z1 - t.z0 - 0.5),
                   900 + placed * 7);
      }
    }
  }

  /* ─────────── 9. ceiling cable trays with brackets ───────────
   * Replaces the read of "nine bare tubes" with something that has structure: a
   * perforated tray, a pair of drop brackets every 3 m, and a bundle of cable in it. */
  {
    const trayY = ceilY - 0.55;
    for (let i = 0; i < 4; i++) {
      const z = Z0 + 3 + i * ((Z1 - Z0 - 6) / 3);
      const tray = bx(X1 - X0 - 3, 0.09, 0.5, M.rack, (X0 + X1) / 2, trayY, z, 0, false);
      for (const sz of [-0.24, 0.24]) {
        const side = bx(X1 - X0 - 3, 0.16, 0.04, M.rack, (X0 + X1) / 2, trayY + 0.08, z + sz, 0, false);
        side.receiveShadow = false;
      }
      const cable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, X1 - X0 - 3.2, 8), M.rubber);
      cable.rotation.z = Math.PI / 2;
      cable.position.set((X0 + X1) / 2, trayY + 0.13, z);
      g.add(cable);
      const nB = Math.max(3, Math.round((X1 - X0) / 4));
      for (let k = 0; k < nB; k++) {
        const x = X0 + 2 + k * ((X1 - X0 - 4) / (nB - 1));
        const drop = bx(0.06, 0.5, 0.06, M.steelD, x, trayY + 0.3, z, 0, false);
        drop.castShadow = false;
        const br = bx(0.7, 0.05, 0.06, M.steelD, x, trayY - 0.02, z, 0, false);
        br.castShadow = false;
      }
    }
  }

  /* ─────────── 10. the cases: edge-lit panes ───────────
   * In hall_of_armor_cases the pane is not a blue filter, it is a sheet of glass with a
   * bright thin white-green line down each vertical edge and across the top. Ours was a
   * flat opacity-0.24 fill with a strip along the bottom only, which reads as a painted
   * panel. Drop the fill so the suit reads THROUGH it, and frame all four sides. */
  for (const s of stands) {
    const fr = new THREE.Group();
    const W2 = 2.15, H = 3.4;
    const bar = (w, h, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, w), edgeMat);
      m.position.set(0, y, z);
      fr.add(m);
      return m;
    };
    bar(0.055, H, H / 2, -W2);          // left vertical
    bar(0.055, H, H / 2, W2);           // right vertical
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, W2 * 2), edgeMat);
    top.position.set(0, H - 0.03, 0); fr.add(top);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, W2 * 2), edgeMatDim);
    bot.position.set(0, 0.05, 0); fr.add(bot);
    // the hard diagonal specular streak across the glass
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.045),
      new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.09,
                                    toneMapped: false, depthWrite: false }));
    streak.position.set(0.02, 2.05, -0.35);
    streak.rotation.y = Math.PI / 2;
    streak.rotation.z = 0.42;
    streak.renderOrder = 7;
    fr.add(streak);
    fr.position.set(s.x + 0.2, s.y, s.z);
    g.add(fr);
    // a small, TIGHT key on the suit itself. The suit was reading as a blob because the
    // only light on it came from behind; this puts a hard cold edge down its front.
    const key = new THREE.PointLight(0x9fd8f0, 2.4, 6.5, 1.7);
    key.position.set(s.x + 1.7, s.y + 2.35, s.z + 0.6);
    g.add(key); lights.push(key);
  }

  /* ─────────── 11. repairs to what world/ already built ───────────
   * Material-level, done in place on meshes world/ owns. Nothing is moved or deleted. */
  const screenBanks = [];
  {
    const b = new THREE.Box3();
    const seenMat = new Set();
    shop.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mat = o.material;
      // the frosted case panes: physical, translucent, blue
      if (mat.isMeshPhysicalMaterial && mat.transparent && mat.opacity > 0.15 && mat.opacity < 0.45) {
        mat.opacity = 0.10;
        mat.color.setHex(0xcfeaf5);
        mat.roughness = 0.45;
        return;
      }
      // the monitors: MeshBasicMaterial, toneMapped false, with or without a map
      if (mat.isMeshBasicMaterial && mat.toneMapped === false && o.geometry.type === 'PlaneGeometry') {
        b.setFromObject(o);
        const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), h = b.max.y - b.min.y;
        if (w < 0.3 || h < 0.2 || w > 3.2 || h > 2.4) return;   // not a monitor
        if (!seenMat.has(mat.uuid)) {
          seenMat.add(mat.uuid);
          // Dense content, and a mean luminance around 0.35 so it stops reading as a
          // blown white plate. The tint multiplies the map, so this is the level knob.
          mat.map = screenFace(seenMat.size);
          mat.color.setRGB(0.62, 0.70, 0.76);
          mat.needsUpdate = true;
        }
        screenBanks.push(new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2,
                                           (b.min.z + b.max.z) / 2));
      }
    });
  }

  /* One broad, LOW-DECAY source per screen cluster. The existing practicals are decay 2
   * at distance 11–24, which is physically right and useless: at 6 m from a bank they put
   * a few lux on a desk. decay 1 is a lie, and it is the correct lie here — it is
   * standing in for the fact that a wall of monitors is an area source two metres across,
   * not a point. Clusters are merged so a bank of eight screens gets one light, not
   * eight. */
  {
    const clusters = [];
    for (const p of screenBanks) {
      let c = null;
      for (const k of clusters) if (k.p.distanceTo(p) < 3.2) { c = k; break; }
      if (c) { c.p.lerp(p, 1 / (++c.n)); } else clusters.push({ p: p.clone(), n: 1 });
    }
    for (const k of clusters) {
      if (k.n < 2) continue;                     // a lone desk monitor is not a bank
      const l = new THREE.PointLight(0x8ec8e8, 2.6, 11, 1);
      // Pushed off the glass toward the middle of the room, so what it lights is what is
      // IN FRONT of the bank.
      const toMid = new THREE.Vector3((X0 + X1) / 2, k.p.y, (Z0 + Z1) / 2).sub(k.p);
      toMid.y = 0;
      if (toMid.lengthSq() > 0.01) toMid.normalize().multiplyScalar(1.8); else toMid.set(0, 0, 1.8);
      l.position.copy(k.p).add(toMid);
      l.position.y = floorY + 2.0;
      g.add(l); lights.push(l);
    }
  }

  shop.add(g);

  // Colliders, so the boy cannot walk through five metres of car. Only the hulls and the
  // big items: a crate you can clip through is not worth a Rapier body.
  if (ctx.physics && ctx.physics.ready && ctx.physics.addStatic) {
    for (const m of solids) {
      try { ctx.physics.addStatic(m, { kind: 'prop' }); } catch (e) { /* not fatal */ }
    }
  }

  /* Visibility. Every one of these lights belongs to the basement and must never leak
   * into Malibu midday, and a light at intensity 0 still costs every fragment in a 12 km
   * world a loop iteration. env.js drives this from the same `k` it uses for fog and
   * exposure — see env._apply(). `k` is the truth; env.current is a name that lags. */
  let on = null;
  const api = {
    group: g,
    lights,
    counts: { meshes: 0, lights: lights.length, solids: solids.length },
    setMix(k) {
      const want = k > 0.05;
      if (want === on) return;
      on = want;
      for (const l of lights) l.visible = want;
    },
  };
  g.traverse(o => { if (o.isMesh) api.counts.meshes++; });
  api.setMix(ctx.env && typeof ctx.env.k === 'number' ? ctx.env.k : 0);
  ctx.dress = api;
  return api;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE LIVING ROOM — surfaces, not furniture.
 *
 * world/ owns the house and it has furnished this floor properly: two seating groups, a
 * rug, a dining table, a bookcase, a bar, a piano. What the opening shot was still
 * missing is everything you can only see in a MATERIAL. Against
 * reference/world/malibu_living_colour.jpg our frame had:
 *   * a floor that is one untextured pale plane, low enough in roughness that the indoor
 *     fill lands on it as a single blown-out white blob in the middle of the picture —
 *     the reference floor is irregular stone flags, warm grey-to-rust, matte;
 *   * a ceiling soffit that is a flat tan slab — the reference is dark walnut veneer,
 *     the second brightest thing in the frame and the only warm mass in it.
 * Both are properties of a material on a mesh world/ built, so they can be repaired in
 * place from here without touching a line of world/'s file — exactly the way the monitors
 * and the case glass are repaired in dressWorkshop above.
 *
 * Everything is procedural canvas: no texture file to fetch, no second HTTP round trip
 * on the boot path, and the opening shot cannot arrive untextured because an image was
 * still loading.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/* Irregular stone flags. A Voronoi-ish scatter of seed points, each cell filled with its
 * own warm grey, then grouted dark and dusted with noise. 1024² covering 8 m, so a flag
 * lands around 60–90 cm — the size they are in the plate. */
function flagstoneCanvas(seed) {
  /* 512, not 1024. This is a per-pixel two-nearest-seed search on the boot thread: at
   * 1024 with 81 seeds it is 85 million distance tests and it stalled the whole boot for
   * seconds before the first frame — measured, the rig sat on "iframe loaded". At 512
   * with 49 seeds it is 12 million and costs about a tenth of a second, and the stone is
   * still 64 px per metre on the floor. */
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#6f6a63'; g.fillRect(0, 0, S, S);
  // seed points on a jittered grid, wrapped, so the texture tiles without a visible seam
  const N = 7, pts = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    pts.push([(i + 0.18 + r() * 0.64) / N * S, (j + 0.18 + r() * 0.64) / N * S,
              r()]);
  }
  const img = g.createImageData(S, S);
  const d = img.data;
  const tone = pts.map(p => {
    // warm limestone through to a rust-brown flag, as in the plate
    const t = p[2];
    return [176 + t * 38 - 10, 163 + t * 30 - 12, 146 + t * 22 - 16];
  });
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let b0 = 1e9, b1 = 1e9, k = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x - pts[i][0]); if (dx > S / 2) dx = S - dx;
        let dy = Math.abs(y - pts[i][1]); if (dy > S / 2) dy = S - dy;
        const dd = dx * dx + dy * dy;
        if (dd < b0) { b1 = b0; b0 = dd; k = i; } else if (dd < b1) b1 = dd;
      }
      // distance to the cell boundary → the grout line
      const edge = Math.sqrt(b1) - Math.sqrt(b0);
      const grout = Math.min(1, edge / 3.0);
      const n = 1 + (Math.sin(x * 0.37 + y * 0.11) * 0.5 + Math.sin(x * 0.07 - y * 0.53) * 0.5) * 0.035;
      const t = tone[k];
      const o = (y * S + x) * 4;
      const shade = (0.42 + 0.58 * grout) * n;
      d[o] = t[0] * shade; d[o + 1] = t[1] * shade; d[o + 2] = t[2] * shade; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // dust and wear, so the flags are not flat fills
  for (let i = 0; i < 2600; i++) {
    const x = r() * S, y = r() * S, a = 0.02 + r() * 0.05;
    g.fillStyle = r() < 0.5 ? `rgba(255,246,232,${a})` : `rgba(58,50,42,${a})`;
    g.fillRect(x, y, 1 + r() * 3, 1 + r() * 3);
  }
  return c;
}

/* Walnut veneer: long boards, warm dark brown, with grain drawn as fine arcs. */
function woodCanvas(seed) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(seed);
  const boards = 8, bw = S / boards;
  for (let i = 0; i < boards; i++) {
    const t = r();
    const base = [62 + t * 26, 38 + t * 18, 24 + t * 12];
    g.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
    g.fillRect(i * bw, 0, bw, S);
    // grain
    for (let k = 0; k < 34; k++) {
      const x = i * bw + r() * bw;
      const a = 0.05 + r() * 0.12;
      g.strokeStyle = r() < 0.55 ? `rgba(28,16,10,${a})` : `rgba(146,104,64,${a * 0.7})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(x, 0);
      const amp = (r() - 0.5) * bw * 0.5;
      g.bezierCurveTo(x + amp, S * 0.33, x - amp, S * 0.66, x + (r() - 0.5) * bw * 0.3, S);
      g.stroke();
    }
    // the joint between boards
    g.fillStyle = 'rgba(18,10,6,0.55)';
    g.fillRect(i * bw, 0, 1.6, S);
  }
  return c;
}

/* A planar UV set in WORLD METRES, written onto the mesh's own geometry.
 * The floor and the soffit of this house are hand-drawn outlines extruded by world/, and
 * their UVs are whatever the extruder happened to produce — on the floor plate, a single
 * texel stretched across fifty metres. A texture assigned to that mesh is invisible: the
 * first version of this function changed the roughness (which showed) and the map (which
 * did not), and the floor stayed a flat plane. So the UVs are rebuilt from x/z, in metres
 * divided by `scale`, and the texture repeats once per `scale` metres no matter what the
 * geometry thinks. */
function planarUV(mesh, scale) {
  const geo = mesh.geometry;
  const pos = geo.attributes && geo.attributes.position;
  if (!pos) return false;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / scale;
    uv[i * 2 + 1] = pos.getZ(i) / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.attributes.uv.needsUpdate = true;
  return true;
}

function tex(canvas, repeat, THREEns) {
  const t = new THREEns.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREEns.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if ('colorSpace' in t) t.colorSpace = THREEns.SRGBColorSpace;
  return t;
}

export function dressLiving(ctx) {
  const W = ctx.world;
  if (!W || !W.malibu) return null;
  const roots = [W.malibu.interior, W.malibu.root].filter(Boolean);
  if (!roots.length) return null;

  const box = new THREE.Box3();
  let floor = null, ceil = null;
  let floorArea = 0, ceilArea = 0;
  for (const r of roots) {
    r.updateWorldMatrix(true, true);
    r.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      box.setFromObject(o);
      if (!isFinite(box.min.x) || box.isEmpty()) return;
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
      if (sy > 1.2) return;                       // a slab, not a surface
      const area = sx * sz;
      if (area < 400) return;
      // The interior floor is the thin plate whose top is the main level; the soffit is
      // the one about four metres above it. Identified by height off world/'s own
      // authored spawn rather than by a name, because these meshes have none.
      const L0 = (W.spawns && W.spawns.living ? W.spawns.living.y : 96.05);
      const top = box.max.y;
      if (Math.abs(top - L0) < 0.6 && area > floorArea) { floor = o; floorArea = area; }
      if (top > L0 + 3.0 && top < L0 + 6.0 && area > ceilArea) { ceil = o; ceilArea = area; }
    });
  }

  const done = [];
  if (floor) {
    planarUV(floor, 7.0);                      // one 512-px stone sheet per 7 m
    const map = tex(flagstoneCanvas(881), 1, THREE);
    const m = floor.material;
    const mat = (Array.isArray(m) ? m[0] : m).clone();
    mat.map = map;
    mat.color.setHex(0xffffff);
    // Matte. The old floor was polished enough that the indoor fill landed on it as one
    // white hole in the middle of the opening frame; stone this size does not do that.
    mat.roughness = 0.82;
    mat.metalness = 0.0;
    mat.envMapIntensity = 0.45;
    floor.material = mat;
    floor.receiveShadow = true;
    done.push('floor');
  }
  if (ceil) {
    planarUV(ceil, 9.0);                       // boards about 1.1 m wide
    const map = tex(woodCanvas(412), 1, THREE);
    const m = ceil.material;
    const mat = (Array.isArray(m) ? m[0] : m).clone();
    mat.map = map;
    mat.color.setHex(0xffffff);
    mat.roughness = 0.55;
    mat.metalness = 0.0;
    mat.envMapIntensity = 0.7;
    ceil.material = mat;
    done.push('ceiling');
  }

  /* The mullions have to cast. env.js now walks a tight shadow box around the player so
   * that a 6 cm bar CAN draw a shadow indoors, but nothing in the curtain wall was
   * flagged as a caster, and a shadow nobody casts is still no shadow. The panes
   * themselves must NOT: three.js shadow maps are opaque, and a sheet of glass that
   * casts would put the whole living room in the dark. */
  const panes = new Set(Array.isArray(W.glassPanels) ? W.glassPanels : []);
  let mullions = 0;
  for (const r of roots) {
    r.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const mm = o.material;
      const clear = panes.has(o) ||
        !!(mm && (mm.transparent || mm.transmission > 0 || /glass/i.test((mm.name || '') + o.name)));
      if (clear) { o.castShadow = false; return; }
      box.setFromObject(o);
      if (!isFinite(box.min.x) || box.isEmpty()) return;
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
      if (sy < 1.6 || sy > 6) return;               // full-height only: a mullion, a post
      if (Math.min(sx, sz) > 0.6) return;           // ...and slender
      o.castShadow = true;
      mullions++;
    });
  }

  /* ── the stair down ────────────────────────────────────────────────────────
   * The descent is the one beat in the first minute that is pure lighting, and the
   * critique of the last round was blunt about what it actually looked like: "a bare
   * grey corridor with a black seam where two slabs meet". Two material facts, both
   * repairable in place:
   *   * the treads are the same untextured slab material as the floor plate, so a
   *     sixteen-step spiral reads as one grey ramp with lines on it;
   *   * the shaft liner world/ puts through the hole in the main slab is 0x111417 —
   *     near black — and where it meets the lit floor it draws exactly that seam.
   * Treads get the stone, at a tighter scale so the flags read at tread size; the liner
   * becomes a board-formed concrete wall of a stairwell, which is what it is. */
  let treads = 0, liner = 0;
  const st = W.malibu.stairTop;
  if (st) {
    const stoneMap = tex(flagstoneCanvas(2036), 1, THREE);
    const treadMat = new THREE.MeshStandardMaterial({
      color: 0xb9b2a6, map: stoneMap, roughness: 0.86, metalness: 0.0, envMapIntensity: 0.5,
    });
    for (const r of roots) {
      r.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        box.setFromObject(o);
        if (!isFinite(box.min.x) || box.isEmpty()) return;
        const cxx = (box.min.x + box.max.x) / 2, czz = (box.min.z + box.max.z) / 2;
        if (Math.hypot(cxx - st.x, czz - st.z) > 7.5) return;
        const sy = box.max.y - box.min.y;
        if (box.max.y > st.y + 0.4 || box.max.y < st.y - 8) return;
        if (sy < 0.45) {
          // a tread
          o.material = treadMat;
          planarUV(o, 2.4);
          o.castShadow = o.receiveShadow = true;
          treads++;
        } else if (sy > 0.3 && sy < 3.0) {
          // the liner ring around the hole
          const mm = Array.isArray(o.material) ? o.material[0] : o.material;
          if (mm && mm.color && mm.color.getHex() < 0x333333) {
            const c2 = mm.clone();
            c2.color.setHex(0x6c665e);
            c2.roughness = 0.94;
            o.material = c2;
            liner++;
          }
        }
      });
    }
  }

  const api = { floor: !!floor, ceiling: !!ceil, mullions, treads, liner, done };
  ctx.dressLiving = api;
  return api;
}
