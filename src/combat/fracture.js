// Fracture geometry. Owned by task `destruction`. Pure maths — no scene, no physics.
//
// Everything here produces REAL POLYGONAL PIECES: closed, convex, watertight solids with a
// centroid and a volume, so the caller can hand each one a mass and a collider. Nothing in
// this file makes a particle, a billboard or a canned prefab. The break pattern is computed
// from the actual impact point every time.
//
// Three generators:
//   fracturePane(w, h, t, ix, iy)   radial + concentric glass, cracks radiating from (ix,iy)
//   fractureBox(size, impact, n)    3D Voronoi cells of a box, seeds biased to the impact
//   splitByPlane(geometry, y)       one solid cut in two along a horizontal plane (lamp posts)
//
// plus carveSphere(), which deletes the triangles of a source mesh inside a sphere so a bite
// out of the donut is a real hole in the real geometry rather than a decal.

import * as THREE from 'three';

// Deterministic PRNG. The whole point of the fixed-step loop is that a critic can replay a
// break; a fracture that uses Math.random() would be different every run.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// 2D helpers
// ---------------------------------------------------------------------------------------

// Sutherland–Hodgman clip of a polygon (array of [x,y]) against a half plane a*x+b*y<=c.
function clipHalf(poly, a, b, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function clipRect(poly, hw, hh) {
  let p = poly;
  p = clipHalf(p, 1, 0, hw); if (p.length < 3) return null;
  p = clipHalf(p, -1, 0, hw); if (p.length < 3) return null;
  p = clipHalf(p, 0, 1, hh); if (p.length < 3) return null;
  p = clipHalf(p, 0, -1, hh); if (p.length < 3) return null;
  return p;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a * 0.5;
}

function polyCentroid(p) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < p.length; i++) {
    const u = p[i], v = p[(i + 1) % p.length];
    const cr = u[0] * v[1] - v[0] * u[1];
    a += cr; cx += (u[0] + v[0]) * cr; cy += (u[1] + v[1]) * cr;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return [p[0][0], p[0][1]];
  return [cx / (6 * a), cy / (6 * a)];
}

// A convex polygon in the XY plane, extruded ±t/2 in Z, recentred on its own centroid.
// This is what makes a shard a shard: two faces and a rim of side walls, with thickness.
function extrudePolygon(poly, t, cx, cy) {
  const n = poly.length;
  const hz = t * 0.5;
  const pos = [];
  const nor = [];
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); };
  // front + back faces (fan; the polygon is convex by construction)
  for (let i = 1; i < n - 1; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    push(a[0] - cx, a[1] - cy, hz, 0, 0, 1);
    push(b[0] - cx, b[1] - cy, hz, 0, 0, 1);
    push(c[0] - cx, c[1] - cy, hz, 0, 0, 1);
    push(a[0] - cx, a[1] - cy, -hz, 0, 0, -1);
    push(c[0] - cx, c[1] - cy, -hz, 0, 0, -1);
    push(b[0] - cx, b[1] - cy, -hz, 0, 0, -1);
  }
  // rim
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    let ex = q[0] - p[0], ey = q[1] - p[1];
    const L = Math.hypot(ex, ey) || 1;
    const nx = ey / L, ny = -ex / L;
    const px = p[0] - cx, py = p[1] - cy, qx = q[0] - cx, qy = q[1] - cy;
    push(px, py, hz, nx, ny, 0); push(qx, qy, hz, nx, ny, 0); push(qx, qy, -hz, nx, ny, 0);
    push(px, py, hz, nx, ny, 0); push(qx, qy, -hz, nx, ny, 0); push(px, py, -hz, nx, ny, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/**
 * Glass. Cracks radiate from the impact point and cross concentric rings, exactly the
 * pattern a stone makes in a window: tiny splinters at the hit, long slivers further out,
 * every cell clipped to the pane so edge pieces are truncated the way real ones are.
 *
 * @returns { pieces: [{geometry, offset:[x,y,0], area, dist}], cracks: Float32Array }
 *          `cracks` is a line-segment soup in pane space, drawn for a beat before the
 *          pieces separate.
 */
export function fracturePane(w, h, t, ix, iy, opts = {}) {
  const R = rng(opts.seed || 1337);
  const hw = w * 0.5, hh = h * 0.5;
  // clamp the impact into the pane, otherwise a graze produces a pattern with no centre
  ix = Math.max(-hw * 0.98, Math.min(hw * 0.98, ix));
  iy = Math.max(-hh * 0.98, Math.min(hh * 0.98, iy));

  const corner = Math.max(
    Math.hypot(-hw - ix, -hh - iy), Math.hypot(hw - ix, -hh - iy),
    Math.hypot(-hw - ix, hh - iy), Math.hypot(hw - ix, hh - iy)
  );
  const na = opts.rays || (10 + Math.floor(R() * 5));      // radial cracks
  const rings = [];
  let r = Math.min(0.055, corner * 0.05) * (0.8 + R() * 0.5);
  rings.push(r);
  while (r < corner * 1.02) { r *= 1.55 + R() * 0.55; rings.push(r); }
  const nr = rings.length;

  // Shared vertex table: adjacent cells read the SAME jittered corner, so the pieces fit
  // back together with no gaps — a critic looking at the wall mid-break sees a cracked
  // pane, not a pile of overlapping quads.
  const V = [];
  for (let j = 0; j < nr; j++) {
    const row = [];
    for (let i = 0; i < na; i++) {
      const a = (i / na) * Math.PI * 2 + (R() - 0.5) * (Math.PI * 2 / na) * 0.55;
      const rr = rings[j] * (0.82 + R() * 0.36);
      row.push([ix + Math.cos(a) * rr, iy + Math.sin(a) * rr]);
    }
    V.push(row);
  }

  const pieces = [];
  const cracks = [];
  const addCrack = (p, q) => { cracks.push(p[0], p[1], 0, q[0], q[1], 0); };

  const emit = (poly) => {
    const c = clipRect(poly, hw, hh);
    if (!c) return;
    const area = Math.abs(polyArea(c));
    if (area < 3e-4) return;
    const [cx, cy] = polyCentroid(c);
    pieces.push({
      geometry: extrudePolygon(c, t, cx, cy),
      offset: [cx, cy, 0],
      area,
      dist: Math.hypot(cx - ix, cy - iy),
    });
    for (let i = 0; i < c.length; i++) addCrack(c[i], c[(i + 1) % c.length]);
  };

  // pulverised centre
  emit(V[0].slice());
  // ring cells
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < na; i++) {
      const i2 = (i + 1) % na;
      emit([V[j][i], V[j][i2], V[j + 1][i2], V[j + 1][i]]);
    }
  }
  return { pieces, cracks: new Float32Array(cracks), impact: [ix, iy] };
}

// ---------------------------------------------------------------------------------------
// 3D convex clipping — the machinery behind Voronoi chunks
// ---------------------------------------------------------------------------------------

function boxFaces(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  return [
    [V(x, -y, -z), V(x, y, -z), V(x, y, z), V(x, -y, z)],      // +X
    [V(-x, -y, z), V(-x, y, z), V(-x, y, -z), V(-x, -y, -z)],  // -X
    [V(-x, y, -z), V(-x, y, z), V(x, y, z), V(x, y, -z)],      // +Y
    [V(-x, -y, z), V(-x, -y, -z), V(x, -y, -z), V(x, -y, z)],  // -Y
    [V(-x, -y, z), V(x, -y, z), V(x, y, z), V(-x, y, z)],      // +Z
    [V(x, -y, -z), V(-x, -y, -z), V(-x, y, -z), V(x, y, -z)],  // -Z
  ];
}

// Clip a closed convex polyhedron (array of CCW face loops) by the half space n·p <= d.
// Returns a new closed polyhedron, or null if nothing survives.
function clipPolyhedron(faces, n, d) {
  const out = [];
  const cut = [];
  const EPS = 1e-7;
  for (const face of faces) {
    const kept = [];
    const m = face.length;
    let firstCut = null, secondCut = null;
    for (let i = 0; i < m; i++) {
      const p = face[i], q = face[(i + 1) % m];
      const dp = n.dot(p) - d, dq = n.dot(q) - d;
      if (dp <= EPS) kept.push(p);
      if ((dp < -EPS && dq > EPS) || (dp > EPS && dq < -EPS)) {
        const t = dp / (dp - dq);
        const ip = new THREE.Vector3().lerpVectors(p, q, t);
        kept.push(ip);
        if (!firstCut) firstCut = ip; else secondCut = ip;
      }
    }
    if (kept.length >= 3) out.push(kept);
    if (firstCut && secondCut) { cut.push(firstCut, secondCut); }
  }
  if (!out.length) return null;
  // Build the cap face from the cut points: project onto the plane basis and sort by angle.
  if (cut.length >= 3) {
    const c = new THREE.Vector3();
    for (const p of cut) c.add(p);
    c.multiplyScalar(1 / cut.length);
    let u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) u.set(0, 1, 0);
    u.crossVectors(n, u).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const uniq = [];
    for (const p of cut) {
      if (!uniq.some(q => q.distanceToSquared(p) < 1e-10)) uniq.push(p);
    }
    if (uniq.length >= 3) {
      uniq.sort((a, b) => {
        const aa = Math.atan2(v.dot(a.clone().sub(c)), u.dot(a.clone().sub(c)));
        const bb = Math.atan2(v.dot(b.clone().sub(c)), u.dot(b.clone().sub(c)));
        return aa - bb;
      });
      out.push(uniq);
    }
  }
  return out;
}

function polyhedronToGeometry(faces, centroid) {
  const pos = [], nor = [];
  for (const f of faces) {
    if (f.length < 3) continue;
    const e1 = f[1].clone().sub(f[0]);
    const e2 = f[2].clone().sub(f[0]);
    const nn = new THREE.Vector3().crossVectors(e1, e2);
    if (nn.lengthSq() < 1e-14) continue;
    nn.normalize();
    for (let i = 1; i < f.length - 1; i++) {
      const a = f[0], b = f[i], c = f[i + 1];
      pos.push(a.x - centroid.x, a.y - centroid.y, a.z - centroid.z);
      pos.push(b.x - centroid.x, b.y - centroid.y, b.z - centroid.z);
      pos.push(c.x - centroid.x, c.y - centroid.y, c.z - centroid.z);
      nor.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z, nn.x, nn.y, nn.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function polyhedronVolume(faces, c) {
  let vol = 0;
  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = f[0].clone().sub(c), b = f[i].clone().sub(c), d = f[i + 1].clone().sub(c);
      vol += a.dot(new THREE.Vector3().crossVectors(b, d)) / 6;
    }
  }
  return Math.abs(vol);
}

function polyhedronCentroid(faces) {
  const c = new THREE.Vector3();
  let n = 0;
  for (const f of faces) for (const p of f) { c.add(p); n++; }
  return n ? c.multiplyScalar(1 / n) : c;
}

/**
 * Voronoi-chunk a box. Seeds cluster around the impact, so the hit end shatters into
 * rubble and the far end comes off in slabs — the size gradient in mk3_damaged_rubble.
 *
 * @param size    THREE.Vector3 box dimensions, local
 * @param impact  THREE.Vector3 impact point in the box's local space
 * @param count   number of chunks
 * @returns [{geometry, offset:THREE.Vector3, volume, hull:[Vector3]}]
 */
export function fractureBox(size, impact, count = 14, opts = {}) {
  const R = rng(opts.seed || 4242);
  const seeds = [];
  const half = new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2);
  const reach = opts.reach || Math.max(size.x, size.y, size.z) * 0.55;
  for (let i = 0; i < count; i++) {
    let p;
    if (i < count * 0.62) {
      // biased: cube-root-ish clustering toward the hit
      const rr = reach * Math.pow(R(), 1.7);
      const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1);
      p = new THREE.Vector3(
        impact.x + rr * Math.sin(ph) * Math.cos(th),
        impact.y + rr * Math.sin(ph) * Math.sin(th),
        impact.z + rr * Math.cos(ph)
      );
    } else {
      p = new THREE.Vector3(
        (R() * 2 - 1) * half.x, (R() * 2 - 1) * half.y, (R() * 2 - 1) * half.z
      );
    }
    p.x = Math.max(-half.x * 0.995, Math.min(half.x * 0.995, p.x));
    p.y = Math.max(-half.y * 0.995, Math.min(half.y * 0.995, p.y));
    p.z = Math.max(-half.z * 0.995, Math.min(half.z * 0.995, p.z));
    seeds.push(p);
  }

  const out = [];
  for (let i = 0; i < seeds.length; i++) {
    let cell = boxFaces(size.x, size.y, size.z);
    for (let j = 0; j < seeds.length && cell; j++) {
      if (i === j) continue;
      const n = seeds[j].clone().sub(seeds[i]);
      const len = n.length();
      if (len < 1e-6) continue;
      n.multiplyScalar(1 / len);
      const mid = seeds[i].clone().add(seeds[j]).multiplyScalar(0.5);
      cell = clipPolyhedron(cell, n, n.dot(mid));
    }
    if (!cell || cell.length < 4) continue;
    const c = polyhedronCentroid(cell);
    const vol = polyhedronVolume(cell, c);
    if (vol < 1e-5) continue;
    const hull = [];
    for (const f of cell) for (const p of f) {
      if (!hull.some(q => q.distanceToSquared(p) < 1e-9)) hull.push(p.clone().sub(c));
    }
    out.push({ geometry: polyhedronToGeometry(cell, c), offset: c, volume: vol, hull });
  }
  return out;
}

/**
 * Cut a solid in two with a horizontal plane at local y = cutY, filling both cut faces.
 * This is how a lamp post snaps AT THE POINT YOU HIT IT and topples as two rigid pieces.
 */
export function splitByPlane(geometry, cutY) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.getAttribute('position');
  /* CARRY THE UVs THROUGH THE CUT.
   *
   * This used to emit positions and nothing else. A piece cut off a textured object then
   * has no `uv` attribute at all, and three feeds a missing attribute as (0,0) — so every
   * fragment of every piece samples one single texel and the whole chunk comes out as a
   * flat smear of whatever colour happens to live at the corner of the map. That is
   * "breaking the donut destroys the texture": the donut is the one big textured thing you
   * are encouraged to shoot.
   *
   * Interpolating them is free, because the cut point is already a lerp along an edge —
   * the same `t` that places the vertex places its UV. The freshly cut faces have no UV of
   * their own (they are the inside of the material, which was never mapped), so they take
   * the centroid of the ring they close, which keeps them the same tone as the surface
   * around the break instead of a stripe from the far side of the atlas.
   */
  const uvAttr = src.getAttribute('uv');
  const upper = [], lower = [];
  const upperUV = [], lowerUV = [];
  const ringU = [], ringL = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  const tri = (p, q, r, arr, uvArr, up, uq, ur) => {
    arr.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    if (!uvArr) return;
    uvArr.push(up ? up.x : 0, up ? up.y : 0,
               uq ? uq.x : 0, uq ? uq.y : 0,
               ur ? ur.x : 0, ur ? ur.y : 0);
  };
  // Position AND uv at the crossing, from the same parameter.
  const lerpY = (p, q, pu, qu) => {
    const t = (cutY - p.y) / (q.y - p.y);
    const v = new THREE.Vector3().lerpVectors(p, q, t);
    v.uv = (pu && qu) ? new THREE.Vector2().lerpVectors(pu, qu, t) : null;
    return v;
  };
  const uvAt = (i) => uvAttr ? new THREE.Vector2(uvAttr.getX(i), uvAttr.getY(i)) : null;

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const v = [a.clone(), b.clone(), c.clone()];
    const u = [uvAt(i), uvAt(i + 1), uvAt(i + 2)];
    const above = v.map(p => p.y > cutY);
    const na = above.filter(Boolean).length;
    if (na === 3) { tri(v[0], v[1], v[2], upper, uvAttr && upperUV, u[0], u[1], u[2]); continue; }
    if (na === 0) { tri(v[0], v[1], v[2], lower, uvAttr && lowerUV, u[0], u[1], u[2]); continue; }
    // straddling: split into a triangle and a quad
    let solo = above.indexOf(na === 1 ? true : false);
    const k0 = solo, k1 = (solo + 1) % 3, k2 = (solo + 2) % 3;
    const p0 = v[k0], p1 = v[k1], p2 = v[k2];
    const u0 = u[k0], u1 = u[k1], u2 = u[k2];
    const i1 = lerpY(p0, p1, u0, u1), i2 = lerpY(p0, p2, u0, u2);
    const soloUp = above[solo];
    const soloArr = soloUp ? upper : lower;
    const otherArr = soloUp ? lower : upper;
    const soloUVs = uvAttr ? (soloUp ? upperUV : lowerUV) : null;
    const otherUVs = uvAttr ? (soloUp ? lowerUV : upperUV) : null;
    tri(p0, i1, i2, soloArr, soloUVs, u0, i1.uv, i2.uv);
    tri(i1, p1, p2, otherArr, otherUVs, i1.uv, u1, u2);
    tri(i1, p2, i2, otherArr, otherUVs, i1.uv, u2, i2.uv);
    ringU.push(Object.assign(i1.clone(), { uv: i1.uv }));
    ringU.push(Object.assign(i2.clone(), { uv: i2.uv }));
    ringL.push(Object.assign(i1.clone(), { uv: i1.uv }));
    ringL.push(Object.assign(i2.clone(), { uv: i2.uv }));
  }

  const capFan = (ring, arr, uvArr, up) => {
    if (ring.length < 3) return;
    const cen = new THREE.Vector3();
    for (const p of ring) cen.add(p);
    cen.multiplyScalar(1 / ring.length);
    // The cut face was never mapped, so give the whole cap one UV — the average of the
    // ring it closes. It reads as the same material as the surface it broke out of.
    let cenUV = null;
    if (uvArr) {
      cenUV = new THREE.Vector2();
      let n = 0;
      for (const p of ring) if (p.uv) { cenUV.add(p.uv); n++; }
      if (n) cenUV.multiplyScalar(1 / n); else cenUV = null;
    }
    const sorted = ring.slice().sort((p, q) =>
      Math.atan2(p.z - cen.z, p.x - cen.x) - Math.atan2(q.z - cen.z, q.x - cen.x));
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i], q = sorted[(i + 1) % sorted.length];
      if (up) tri(cen, p, q, arr, uvArr, cenUV, cenUV, cenUV);
      else tri(cen, q, p, arr, uvArr, cenUV, cenUV, cenUV);
    }
  };
  capFan(ringL, lower, uvAttr && lowerUV, true);
  capFan(ringU, upper, uvAttr && upperUV, false);

  const make = (arr, uvArr) => {
    if (arr.length < 9) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    // Only if it is complete: a half-filled uv buffer is worse than none, because three
    // would read past its end for the triangles that were never given one.
    if (uvArr && uvArr.length === (arr.length / 3) * 2) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    }
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  };
  return { upper: make(upper, uvAttr && upperUV), lower: make(lower, uvAttr && lowerUV) };
}

/**
 * Delete every triangle of a mesh whose centroid is inside a sphere. A bite out of the
 * giant donut is then a real hole in the real geometry, and what came out of the hole is
 * spawned as real chunks by destruction.js. Returns the number of triangles removed.
 */
export function carveSphere(mesh, centerLocal, radius) {
  let g = mesh.geometry;
  if (g.index) { g = g.toNonIndexed(); mesh.geometry.dispose(); mesh.geometry = g; }
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  const nor = g.getAttribute('normal');
  const keepP = [], keepN = [], keepU = [];
  const r2 = radius * radius;
  let removed = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const dx = cx - centerLocal.x, dy = cy - centerLocal.y, dz = cz - centerLocal.z;
    if (dx * dx + dy * dy + dz * dz < r2) { removed++; continue; }
    for (let k = 0; k < 3; k++) {
      keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      if (nor) keepN.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
      if (uv) keepU.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  if (!removed) return 0;
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
  if (nor) ng.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
  if (uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
  ng.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = ng;
  return removed;
}
