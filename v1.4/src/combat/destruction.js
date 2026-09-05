// Breakable objects. Owned by task `destruction`.
//
// What "breakable" means here: the object you hit is replaced by REAL POLYGONAL PIECES,
// computed from the actual impact point at the moment of the hit. There is no prefab pile,
// no particle burst wearing a debris texture. Shoot the third pane of the glass wall and
// THAT pane cracks, in a pattern radiating from the exact point the bolt arrived, holds its
// crack front for a beat, and then falls as shards that tumble, land, and stay put.
//
// Four break behaviours, chosen per object:
//   glass  radial + concentric shards from the impact point, thin, light, spinning
//   wall   3D Voronoi chunks, seeds clustered at the hit, concrete density: they are HEAVY
//   post   ONE cut at the height you hit: two rigid pieces, the top one topples
//   donut  a real bite — triangles inside the blast are deleted from the source geometry
//          and come away as pastry chunks, so the hole is in the model, not on it
//
// How the world registers things (world/ owns the props, this file owns the breaking):
//
//   mesh.userData.breakable = { type: 'glass', health: 1 };   // then destruction scans it
//   // or explicitly:
//   ctx.destruction.register(mesh, { type: 'wall', chunks: 18 });
//
// Names also work as a fallback: anything called *glass*/*pane*/*window*, *lamp*/*post*,
// *wall*, *donut* is picked up by ctx.destruction.scan(root).
import * as THREE from 'three';
import { fracturePane, fractureBox, splitByPlane, carveSphere, rng } from './fracture.js';
import { DebrisField } from './debris.js';

// kg/m3. world/ names materials the way a player would ('stucco', 'metal'); this is the
// translation into something a rigid body can be given a mass from.
const DENSITY = {
  glass: 2500, concrete: 2400, steel: 7000, metal: 4200, stucco: 1600,
  pastry: 320, wood: 700, ground: 1800,
};

const TYPE_DEFAULTS = {
  // crackTime: how long the crack front stands on the intact pane before the shards let
  // go. Under about a fifth of a second it reads as a mesh swap; this is the beat.
  glass:  { material: 'glass',    density: DENSITY.glass,    health: 1, crackTime: 0.22 },
  wall:   { material: 'concrete', density: DENSITY.concrete, health: 1, chunks: 16 },
  post:   { material: 'steel',    density: DENSITY.steel,    health: 1 },
  donut:  { material: 'pastry',   density: DENSITY.pastry,   health: 6, biteRadius: 1.5 },
  prop:   { material: 'concrete', density: DENSITY.concrete, health: 1, chunks: 10 },
};

function guessType(mesh) {
  const n = (mesh.name || '').toLowerCase();
  if (/glass|pane|window|windshield/.test(n)) return 'glass';
  if (/lamp|post|pole|mast|pylon/.test(n)) return 'post';
  if (/donut|doughnut/.test(n)) return 'donut';
  if (/wall|fence|barrier|slab/.test(n)) return 'wall';
  return null;
}

export default {
  id: 'destruction',

  async init(ctx) {
    // Measured on this scene, one shard in flight costs Rapier about 0.05 ms a step, so 160
    // is roughly 8 ms of physics — the ceiling, which the governor in debris.js pulls down
    // the moment the measured cost says it should. Rested pieces cost nothing at all, which
    // is why 900 of them can stay lying in the street for good.
    const debris = new DebrisField(ctx, {
      maxActive: 160,
      maxRested: 900,
      cullDistance: 340,
    });
    const entries = [];
    const pending = [];          // breaks waiting out their crack front
    let vfx = null;              // combat/ owns the VFX; borrowed if it is there
    const _v = new THREE.Vector3();

    // ---------------------------------------------------------------------------------
    // registration
    // ---------------------------------------------------------------------------------

    function register(mesh, spec = {}) {
      if (!mesh || !mesh.isMesh || mesh.userData.__breakEntry) return null;
      const type = spec.type || guessType(mesh) || 'prop';
      const d = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.prop;
      const g = mesh.geometry;
      if (!g) return null;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      const size = new THREE.Vector3().subVectors(bb.max, bb.min);
      const center = new THREE.Vector3().addVectors(bb.max, bb.min).multiplyScalar(0.5);

      const sp = Object.assign({}, d, spec);
      // What the thing weighs decides how its pieces move. world/ states a mass in kg for
      // most props; when it does not, the bounding volume and the material density do.
      const boxVol = Math.max(1e-4, size.x * size.y * size.z);
      // How much of the bounding box is actually material. A pane is solid glass; a donut
      // is a fat torus in a fat box; a lamp post is a THIN HOLLOW TUBE in a tall thin box,
      // and calling it 75 per cent solid steel gave a street light a mass of 1.8 tonnes.
      const solidity = type === 'glass' ? 1
        : (type === 'donut' ? 0.55 : (type === 'post' ? 0.16 : 0.75));
      const dens = sp.density || DENSITY[sp.material] || DENSITY.concrete;
      const mass = sp.mass > 0 ? sp.mass : boxVol * solidity * dens;

      const entry = {
        mesh, type,
        spec: sp,
        health: spec.health ?? d.health,
        // How much punishment it takes before it comes apart. world/ calls it `threshold`:
        // a repulsor bolt lands 1.0, so a 0.5 pane goes on the first shot and a 1.4 lamp
        // post takes two. Damage accumulates, so the second shot always finishes the job.
        hp: sp.threshold ?? 0,
        damage: 0,
        size, center, mass, volume: boxVol * solidity,
        broken: false,
        seed: (entries.length * 7919 + 13) >>> 0,
        rec: null,
      };
      // Give it a collider if world/ has not already, so a bolt can hit it at all.
      if (ctx.physics && ctx.physics.ready) {
        entry.rec = mesh.userData.physicsRec || ctx.physics.addStatic(mesh, {
          shape: type === 'glass' ? 'box' : 'trimesh',
          material: entry.spec.material,
          tag: mesh.name || type,
        });
        if (entry.rec) entry.rec.breakable = entry;
        mesh.userData.physicsRec = entry.rec;
      }
      mesh.userData.__breakEntry = entry;
      entries.push(entry);
      return entry;
    }

    function scan(root) {
      const r = root || ctx.scene;
      let n = 0;
      r.traverse(o => {
        if (!o.isMesh || o.userData.__breakEntry) return;
        const spec = o.userData.breakable;
        if (spec) { register(o, spec === true ? {} : spec); n++; return; }
        const t = guessType(o);
        if (t && o.userData.breakable !== false) { register(o, { type: t }); n++; }
      });
      return n;
    }

    // ---------------------------------------------------------------------------------
    // the breaks
    // ---------------------------------------------------------------------------------

    function shardMaterial(entry) {
      if (entry._mat) return entry._mat;
      const src = entry.mesh.material;
      const m = (Array.isArray(src) ? src[0] : src).clone();
      m.side = THREE.DoubleSide;
      if (entry.type === 'glass') { m.transparent = true; m.opacity = Math.min(1, (m.opacity ?? 1) * 1.1); }
      entry._mat = m;
      return m;
    }

    // Local pane basis: u and v are the two long axes, n the thin one.
    function paneBasis(size) {
      const dims = [size.x, size.y, size.z];
      let k = 0;
      if (dims[1] < dims[k]) k = 1;
      if (dims[2] < dims[k]) k = 2;
      const iu = (k + 1) % 3, iv = (k + 2) % 3;
      const axis = i => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
      const eu = axis(iu), ev = axis(iv);
      const en = new THREE.Vector3().crossVectors(eu, ev);   // right-handed by construction
      // Real architectural glass is 12–24 mm, and world/ builds its panes as zero-thickness
      // planes. 30 mm is the floor: any thinner and the shard hulls are numerically flat,
      // which makes them both expensive and prone to sinking into whatever they land on.
      return { eu, ev, en, w: dims[iu], h: dims[iv], t: Math.max(0.03, dims[k]) };
    }

    function breakGlass(entry, worldPoint, force, opts) {
      const mesh = entry.mesh;
      const b = paneBasis(entry.size);
      const local = mesh.worldToLocal(worldPoint.clone()).sub(entry.center);
      const px = local.dot(b.eu), py = local.dot(b.ev);

      const { pieces, cracks } = fracturePane(b.w, b.h, b.t, px, py, { seed: entry.seed });

      // world transform of the pane's own basis
      mesh.updateWorldMatrix(true, false);
      const wq = new THREE.Quaternion(), ws = new THREE.Vector3(), wp = new THREE.Vector3();
      mesh.matrixWorld.decompose(wp, wq, ws);
      const basisQ = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(b.eu, b.ev, b.en)
      );
      const paneQ = wq.clone().multiply(basisQ);
      const paneOrigin = mesh.localToWorld(entry.center.clone());

      const shotDir = opts.direction
        ? opts.direction.clone().normalize()
        : new THREE.Vector3(0, 0, 1).applyQuaternion(paneQ).negate();

      // The crack front: hold the pattern on the intact pane for a beat, THEN separate.
      //
      // Which FACE of the pane it goes on is not cosmetic. The pane's own basis normal comes
      // out of a cross product, so its sign is whatever the mesh's axis order happened to
      // give; put the lines on the wrong face and the glass — a transparent material that
      // still writes depth — kills them, and the whole break reads as a mesh being swapped
      // for a pile with no fracture at all. That is exactly what it did. So the lines go on
      // the face the bolt ARRIVED at, which is both the physically right side and always the
      // side the shooter is looking at, and they are lifted a clear 25 mm off the glass.
      if (vfx) {
        const paneN = new THREE.Vector3(0, 0, 1).applyQuaternion(paneQ);
        const towardShooter = paneN.dot(shotDir) > 0 ? -1 : 1;
        const m = new THREE.Matrix4().compose(
          paneOrigin.clone().addScaledVector(paneN, towardShooter * (b.t * 0.55 + 0.025)),
          paneQ, ws
        );
        vfx.cracks(cracks, m, (entry.spec.crackTime ?? 0.22) + 0.26);
      }
      const mat = shardMaterial(entry);
      const R = rng(entry.seed + 5);
      let totalArea = 0;
      for (const p of pieces) totalArea += p.area;
      totalArea = Math.max(1e-4, totalArea);

      pending.push({
        t: entry.spec.crackTime ?? 0.13,
        run() {
          let audible = 0;
          mesh.visible = false;
          if (entry.rec) { ctx.physics.remove(entry.rec); entry.rec = null; }
          for (const piece of pieces) {
            const pos = paneOrigin.clone()
              .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(paneQ), piece.offset[0])
              .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(paneQ), piece.offset[1]);
            const away = pos.clone().sub(worldPoint);
            const dist = Math.max(0.15, away.length());
            away.normalize();
            const punch = (4.2 * force) / (1 + dist * 1.6);
            const vel = shotDir.clone().multiplyScalar(punch + 0.6)
              .addScaledVector(away, punch * 0.55 + 0.5);
            vel.y += 0.6 - dist * 0.1;
            debris.spawn({
              geometry: piece.geometry,
              material: mat,
              position: pos,
              quaternion: paneQ,
              velocity: { x: vel.x, y: vel.y, z: vel.z },
              spin: {
                x: (R() - 0.5) * 14 * force, y: (R() - 0.5) * 14 * force,
                z: (R() - 0.5) * 14 * force,
              },
              density: DENSITY.glass,
              mass: Math.max(0.02, entry.mass * (piece.area / totalArea)),
              friction: 0.55,
              restitution: 0.12,
              material_: 'glass',
              // Only the big shards report their landing. Sixty contact-force listeners on
              // one pane is sixty Rapier events a frame for one audible tinkle.
              landSound: piece.area > 0.05 && (audible++ < 5),
              contactForceThreshold: 300,
            });
          }
        },
      });
      return pieces.length;
    }

    function breakChunks(entry, worldPoint, force, opts) {
      const mesh = entry.mesh;
      const local = mesh.worldToLocal(worldPoint.clone()).sub(entry.center);
      const count = entry.spec.chunks || 16;
      const chunks = fractureBox(entry.size, local, count, { seed: entry.seed });
      const mat = shardMaterial(entry);
      mesh.updateWorldMatrix(true, false);
      const wq = new THREE.Quaternion(), ws = new THREE.Vector3(), wp = new THREE.Vector3();
      mesh.matrixWorld.decompose(wp, wq, ws);
      const shotDir = opts.direction ? opts.direction.clone().normalize()
        : new THREE.Vector3(0, 0.2, 0);
      const R = rng(entry.seed + 11);

      // Concrete fails the same way glass does, only slower and over a smaller area: a
      // crack star opens at the point of impact and the wall stands for a heartbeat before
      // it lets go. Without the beat a wall reads as a mesh swap however good the chunks
      // are. The star is drawn on the FACE THE BOLT ARRIVED AT for the same reason the
      // glass one is — the other side of an opaque wall is not a place to draw anything.
      const hold = entry.spec.crackTime ?? 0.11;
      if (vfx && opts.normal) {
        const n = opts.normal.clone().normalize();
        const span = Math.max(1.2, Math.min(4.5, Math.max(entry.size.x, entry.size.y) * 0.5));
        const star = fracturePane(span, span, 0.05, 0, 0,
          { seed: entry.seed + 3, rings: 3, rays: 9 });
        // fracturePane clips its cells to a RECTANGLE, and the rectangle's own edges come
        // back as cracks. On a pane those edges are the frame and belong there; on a wall
        // they are a square box drawn around the impact, which reads as a decal. Keep only
        // the segments inside a disc, so what is left is a crack star with a ragged edge.
        const lim = span * 0.44, lim2 = lim * lim;
        const src = star.cracks, keep = [];
        for (let i = 0; i < src.length; i += 6) {
          const ax = src[i], ay = src[i + 1], bx = src[i + 3], by = src[i + 4];
          if (ax * ax + ay * ay > lim2 && bx * bx + by * by > lim2) continue;
          keep.push(ax, ay, 0, bx, by, 0);
        }
        star.cracks = new Float32Array(keep);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        const m = new THREE.Matrix4().compose(
          worldPoint.clone().addScaledVector(n, 0.03), q, new THREE.Vector3(1, 1, 1)
        );
        vfx.cracks(star.cracks, m, hold + 0.2);
      }
      const dens = entry.spec.density || DENSITY[entry.spec.material] || DENSITY.concrete;
      let totalVol = 0;
      for (const c of chunks) totalVol += c.volume;
      totalVol = Math.max(1e-5, totalVol);
      let audible = 0;

      pending.push({ t: hold, run() {
      mesh.visible = false;
      if (entry.rec) { ctx.physics.remove(entry.rec); entry.rec = null; }
      for (const c of chunks) {
        const pos = mesh.localToWorld(entry.center.clone().add(c.offset));
        const away = pos.clone().sub(worldPoint);
        const dist = Math.max(0.2, away.length());
        away.normalize();
        // Heavy things move slowly. A concrete chunk gets a shove, not a launch.
        const punch = (3.4 * force) / (1 + dist * dist * 0.5);
        const vel = away.multiplyScalar(punch).addScaledVector(shotDir, punch * 0.7);
        vel.y += 0.5;
        debris.spawn({
          geometry: c.geometry,
          material: mat,
          position: pos,
          quaternion: wq,
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          spin: { x: (R() - 0.5) * 4, y: (R() - 0.5) * 4, z: (R() - 0.5) * 4 },
          density: dens,
          mass: Math.max(0.05, entry.mass * (c.volume / totalVol)),
          friction: 0.95,
          restitution: 0.02,
          angularDamping: 0.6,
          material_: entry.spec.material,
          landSound: c.volume > 0.02 && (audible++ < 5),
          contactForceThreshold: 1500,
        });
      }
      } });
      return chunks.length;
    }

    // A lamp post snaps AT THE HEIGHT YOU HIT IT and falls as two rigid pieces.
    function breakPost(entry, worldPoint, force, opts) {
      const mesh = entry.mesh;
      const local = mesh.worldToLocal(worldPoint.clone());
      const { upper, lower } = splitByPlane(mesh.geometry, local.y);
      if (!upper || !lower) return breakChunks(entry, worldPoint, force, opts);

      mesh.updateWorldMatrix(true, false);
      const wq = new THREE.Quaternion(), ws = new THREE.Vector3(), wp = new THREE.Vector3();
      mesh.matrixWorld.decompose(wp, wq, ws);

      // the stub stays standing, with a real torn-off top face
      const stub = new THREE.Mesh(lower, mesh.material);
      stub.position.copy(mesh.position);
      stub.quaternion.copy(mesh.quaternion);
      stub.scale.copy(mesh.scale);
      stub.castShadow = mesh.castShadow;
      stub.receiveShadow = true;
      stub.name = (mesh.name || 'post') + '_stub';
      (mesh.parent || ctx.scene).add(stub);
      if (entry.rec) { ctx.physics.remove(entry.rec); entry.rec = null; }
      if (ctx.physics && ctx.physics.ready) {
        ctx.physics.addStatic(stub, { shape: 'trimesh', material: entry.spec.material });
      }

      // the top half topples
      upper.computeBoundingBox();
      const c = new THREE.Vector3().addVectors(upper.boundingBox.max, upper.boundingBox.min)
        .multiplyScalar(0.5);
      upper.translate(-c.x, -c.y, -c.z);
      const pos = mesh.localToWorld(c.clone());
      const dir = opts.direction ? opts.direction.clone().setY(0).normalize()
        : new THREE.Vector3(0, 0, 1);
      // topple about the axis across the shot, so it falls AWAY from the muzzle
      const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
      const spin = axis.multiplyScalar(2.6 + 1.8 * force);
      mesh.visible = false;

      // Everything bolted to the top of the post comes with it. world/ builds a lamp as a
      // group — shaft, arm, head, glow — and only the shaft is registered as breakable, so
      // without this the lamp head hangs in the air over the stump. The piece is ONE rigid
      // body with a collider per part.
      const piece = new THREE.Group();
      piece.name = (mesh.name || 'post') + '_top';
      piece.quaternion.copy(wq);
      const hulls = [];
      const addPart = (geom, localPos, localQuat, localScale, material) => {
        const m = new THREE.Mesh(geom, material);
        m.position.copy(localPos);
        m.quaternion.copy(localQuat);
        m.scale.copy(localScale);
        m.castShadow = true;
        m.userData.ownGeometry = (geom === upper);   // the rest is borrowed from the scene
        piece.add(m);
        const p = geom.getAttribute('position');
        if (!p || p.count < 6) return;
        const stride = Math.max(1, Math.floor(p.count / 220));   // hulls want points, not all of them
        const pts = [];
        const v = new THREE.Vector3();
        const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
        const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < p.count; i += stride) {
          v.fromBufferAttribute(p, i).multiply(localScale).applyQuaternion(localQuat).add(localPos);
          pts.push(v.x, v.y, v.z);
          lo.min(v); hi.max(v);
        }
        if (pts.length < 12) return;
        // A FLAT part gets NO collider. The lamp's glow panel is four coplanar vertices, and
        // a convex hull of a zero-volume point set is degenerate: Rapier accepts it and then
        // the world step goes from five milliseconds to two hundred. Measured — nine lamp
        // posts with a flat quad each were enough to stop the game dead. It still renders;
        // it just does not collide.
        const ext = hi.sub(lo);
        if (Math.min(ext.x, ext.y, ext.z) < 0.03) return;
        hulls.push(new Float32Array(pts));
      };
      const ID = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
      addPart(upper, new THREE.Vector3(0, 0, 0), ID, mesh.scale.clone(), mesh.material);

      const group = entry.spec.group;
      const cutWorldY = worldPoint.y;
      const _wp = new THREE.Vector3(), _wq2 = new THREE.Quaternion(), _ws2 = new THREE.Vector3();
      const inv = new THREE.Matrix4().compose(pos, wq, ONE).invert();
      if (group && group.isObject3D) {
        const riders = [];
        group.traverse(o => {
          if (!o.isMesh || o === mesh || o.userData.__breakEntry) return;
          o.updateWorldMatrix(true, false);
          const bb = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
          const lowest = new THREE.Vector3(0, bb.min.y, 0).applyMatrix4(o.matrixWorld).y;
          if (lowest >= cutWorldY - 0.05) riders.push(o);
        });
        for (const o of riders) {
          const local = o.matrixWorld.clone().premultiply(inv);
          local.decompose(_wp, _wq2, _ws2);
          addPart(o.geometry, _wp.clone(), _wq2.clone(), _ws2.clone(), o.material);
          o.visible = false;
        }
      }

      // Break contact with the stub before the solver ever sees the two of them. Born
      // exactly on the cut, the top section starts interpenetrating what is left standing,
      // the contact solver spends its first frames pushing them apart instead of letting
      // the thing fall, and it can end up balanced upright on its own stump — which is what
      // it did, and it looks ridiculous. Six centimetres up and a nudge downrange is all it
      // takes for gravity and the topple spin to have the argument to themselves.
      pos.addScaledVector(dir, 0.14).y += 0.06;

      const spawned = debris.spawnCompound({
        object: piece,
        hulls,
        position: pos,
        quaternion: wq,
        velocity: { x: dir.x * 2.2 * force, y: 0.4, z: dir.z * 2.2 * force },
        spin: { x: spin.x, y: spin.y, z: spin.z },
        mass: Math.max(20, entry.mass * 0.6),
        density: 1400,               // hollow steel section, not solid billet
        friction: 0.9,
        restitution: 0.04,
        angularDamping: 0.05,
        material_: entry.spec.material === 'metal' ? 'metal' : 'steel',
        landSound: true,
        contactForceThreshold: 2000,
        ccd: true,
      });
      if (!spawned) {
        // compound refused (degenerate hull): fall back to the shaft alone, still real
        debris.spawn({
          geometry: upper, material: mesh.material, position: pos, quaternion: wq,
          velocity: { x: dir.x * 2.2 * force, y: 0.4, z: dir.z * 2.2 * force },
          spin: { x: spin.x, y: spin.y, z: spin.z },
          density: 1400, friction: 0.9, restitution: 0.04, angularDamping: 0.15,
          material_: 'steel', landSound: true, contactForceThreshold: 2000, ccd: true,
        });
      }
      return 2;
    }

    // A bite out of the donut: triangles inside the blast are deleted from the real mesh
    // and come away as real pastry chunks.
    function biteDonut(entry, worldPoint, force, opts) {
      const mesh = entry.mesh;
      const local = mesh.worldToLocal(worldPoint.clone());
      // The bite scales with the pastry. A 1.5 m nibble out of a seven-metre-thick donut is
      // not a bite; it is a woodpecker.
      const thickness = Math.min(entry.size.x, entry.size.y, entry.size.z);
      const base = entry.spec.biteRadius || Math.max(1.0, Math.min(2.6, thickness * 0.28));
      // A bite is a scallop out of the rim, not a tunnel through it. Randy's donut has a
      // tube about a third of its outer diameter, and a sphere anywhere near the radius of
      // that tube reaches the far wall: the crater then pokes out through both sides of the
      // silhouette and stops reading as a hole at all. Whatever the caller asks for, the
      // bite is capped at a third of the tube's thickness.
      const r = Math.min(base * (0.75 + force * 0.35), thickness * 0.33);
      const removed = carveSphere(mesh, local, r);
      if (!removed) return 0;

      // The inside of a donut is dough, not the far wall: a back-facing shell in the hole.
      if (!entry._dough) {
        const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        entry._dough = new THREE.MeshStandardMaterial({
          // Torn dough is paler and rougher than the baked, glazed outside — that contrast
          // is most of what makes a crater read as an inside rather than a dent.
          color: 0xefd6a8, roughness: 1.0, metalness: 0,
          side: THREE.BackSide, envMap: src.envMap || null,
        });
      }
      // A whole sphere is the wrong shape for a crater. Half of it sticks out through the
      // glaze, and from any angle other than dead-on that outer half reads as a beige BALL
      // stuck onto the donut rather than a bite taken out of it — which is what it looked
      // like. Only the inner half is a crater: a bowl sunk along the inward normal, drawn
      // back-facing so what you see is its concave inside.
      const nWorld = opts.normal ? opts.normal.clone().normalize()
        : (opts.direction ? opts.direction.clone().normalize().negate()
                          : new THREE.Vector3(0, 1, 0));
      const invM = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const outLocal = nWorld.clone().transformDirection(invM).normalize();
      const bowl = new THREE.SphereGeometry(r * 0.99, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
      const cap = new THREE.Mesh(bowl, entry._dough);
      // Flattened along the normal: a scoop, not a pocket. The widest ring of the bowl is
      // its rim, in the tangent plane, so nothing can ever cross back out through the glaze.
      cap.scale.set(1, 0.78, 1);
      cap.position.copy(local);
      // local +Y of the hemisphere points into the pastry
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outLocal.clone().negate());
      mesh.add(cap);

      // The collider has to follow the holes — you can fly through a bite — but rebuilding a
      // twenty-thousand-triangle trimesh BVH costs tens of milliseconds, and doing it on the
      // frame of every bolt is a visible hitch. So it is queued, coalesced, and rebuilt at
      // most once every couple of seconds; in between, the collision is one bite stale,
      // which nobody can see.
      entry._colliderStale = true;

      const size = new THREE.Vector3(r * 2, r * 2, r * 2);
      const chunks = fractureBox(size, new THREE.Vector3(0, 0, 0), 10,
        { seed: entry.seed + entry.health, reach: r * 0.8 });
      const mat = shardMaterial(entry);
      const wq = new THREE.Quaternion();
      mesh.getWorldQuaternion(wq);
      const R = rng(entry.seed + entry.health * 31);
      const shotDir = opts.direction ? opts.direction.clone().normalize()
        : new THREE.Vector3(0, 1, 0);
      // Out of the pastry, not into it. Half the bite volume lies BEHIND the surface, and
      // the donut's trimesh collider is up to a couple of seconds stale (rebuilding a
      // twenty-thousand-triangle BVH on the frame of the shot is a visible hitch), so a
      // chunk born at its own place in the sphere is born inside solid geometry: it jams,
      // stops dead, and hangs in the hole. Lifting every chunk clear along the surface
      // normal puts it in free air on the frame it exists, and it simply falls.
      const outWorld = nWorld;
      for (const c of chunks) {
        if (c.offset.length() > r) continue;         // keep the bite spherical
        // how deep into the pastry this chunk sits, 0 at the surface, 1 at the far side
        const depth = Math.max(0, -c.offset.dot(outLocal)) / Math.max(1e-3, r);
        const lift = outLocal.clone().multiplyScalar(r * (0.35 + depth * 0.9));
        const pos = mesh.localToWorld(local.clone().add(c.offset).add(lift));
        const away = pos.clone().sub(worldPoint).normalize();
        const vel = away.multiplyScalar(2.5 + R() * 3).addScaledVector(shotDir, 2.5 * force)
          .addScaledVector(outWorld, 2.2 + depth * 2.5);
        vel.y += 1.6;
        debris.spawn({
          geometry: c.geometry,
          material: mat,
          position: pos,
          quaternion: wq,
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          spin: { x: (R() - 0.5) * 8, y: (R() - 0.5) * 8, z: (R() - 0.5) * 8 },
          density: DENSITY.pastry,
          friction: 0.98,
          restitution: 0.02,
          material_: 'pastry',
          landSound: true,
          contactForceThreshold: 300,
        });
      }
      return chunks.length;
    }

    // ---------------------------------------------------------------------------------
    // public entry point
    // ---------------------------------------------------------------------------------

    function findEntry(point, opts) {
      if (opts && opts.rec && opts.rec.breakable && !opts.rec.breakable.broken) {
        return opts.rec.breakable;
      }
      if (opts && opts.entry) return opts.entry;
      // fall back to the nearest unbroken registered object within a metre
      let best = null, bestD = 1.2 * 1.2;
      for (const e of entries) {
        if (e.broken || !e.mesh.visible) continue;
        e.mesh.getWorldPosition(_v);
        const d = _v.distanceToSquared(point);
        const reach = Math.max(e.size.x, e.size.y, e.size.z) * 0.6;
        if (d < Math.max(bestD, reach * reach)) { best = e; bestD = d; }
      }
      return best;
    }

    /**
     * Break whatever is at `point`. Called by projectile impacts, by a suit collision, and
     * by anything else that wants to hurt the world.
     * @param force 0..~2, 1 is one repulsor bolt
     */
    /**
     * A hit that is not big enough to bring the whole thing down still has to take
     * something off it: a few real chips knocked out of the surface at the point of impact.
     * Small, heavy, short-lived in the budget — but they are pieces, not sparks.
     */
    function chip(entry, worldPoint, force, opts) {
      const mesh = entry.mesh;
      // A chip is a chip: it must be small next to the thing it came off, or a lamp post
      // sheds boulders. The smallest dimension of the object is the ceiling.
      const thin = Math.min(entry.size.x, entry.size.y, entry.size.z) || 0.3;
      const r = Math.max(0.05, Math.min(0.28, Math.min(0.1 + force * 0.1, thin * 0.55)));
      const chunks = fractureBox(
        new THREE.Vector3(r * 2, r * 2, r * 2), new THREE.Vector3(0, 0, 0), 5,
        { seed: (entry.seed + entry.damage * 977) >>> 0, reach: r * 0.7 }
      );
      const mat = shardMaterial(entry);
      const wq = new THREE.Quaternion();
      mesh.getWorldQuaternion(wq);
      const R = rng(entry.seed + 71 + Math.floor(entry.damage * 100));
      const n = opts.normal ? opts.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const dens = entry.spec.density || DENSITY[entry.spec.material] || DENSITY.concrete;
      let made = 0;
      for (const c of chunks) {
        if (c.offset.length() > r) continue;
        const pos = worldPoint.clone().add(c.offset).addScaledVector(n, 0.03);
        const vel = n.clone().multiplyScalar(1.5 + R() * 3.5 * force)
          .add(new THREE.Vector3((R() - 0.5) * 3, R() * 2.2, (R() - 0.5) * 3));
        debris.spawn({
          geometry: c.geometry, material: mat, position: pos, quaternion: wq,
          velocity: { x: vel.x, y: vel.y, z: vel.z },
          spin: { x: (R() - 0.5) * 10, y: (R() - 0.5) * 10, z: (R() - 0.5) * 10 },
          density: dens, friction: 0.95, restitution: 0.05,
          material_: entry.spec.material, landSound: false,
        });
        made++;
      }
      return made;
    }

    function breakAt(point, force = 1, opts = {}) {
      const entry = findEntry(point, opts);
      if (!entry || entry.broken) return 0;

      // Damage accumulates. A pane goes on the first bolt, a lamp post on the second, a
      // ferris-wheel car on the third — and every one of those hits takes real chips out of
      // the surface in the meantime, so a shot that does not break something never looks
      // like a shot that missed.
      entry.damage += force;
      if (entry.type !== 'donut' && entry.hp > 0 && entry.damage < entry.hp) {
        const made = chip(entry, point, force, opts);
        ctx.bus.emit('break', {
          point: point.clone(), force, material: entry.spec.material,
          pieces: made, type: entry.type, partial: true,
        });
        return made;
      }

      let n = 0;
      if (entry.type === 'glass') n = breakGlass(entry, point, force, opts);
      else if (entry.type === 'post') n = breakPost(entry, point, force, opts);
      else if (entry.type === 'donut') n = biteDonut(entry, point, force, opts);
      else n = breakChunks(entry, point, force, opts);

      entry.health -= force;
      // A donut is never "broken": it is eaten. Each bolt takes another real bite out of
      // the geometry, and it keeps standing with holes in it — which is the joke.
      if (entry.type !== 'donut') entry.broken = true;

      ctx.bus.emit('break', {
        point: point.clone(),
        force,
        material: entry.spec.material,
        pieces: n,
        type: entry.type,
        mass: entry.mass,
      });
      return n;
    }

    // ---------------------------------------------------------------------------------
    // flight collision surface — hitting a building must hurt
    // ---------------------------------------------------------------------------------

    const _prev = new THREE.Vector3();
    let hasPrev = false;
    let hurtCooldown = 0;

    function flightCollision(dt) {
      const fl = ctx.flight;
      if (!fl || !fl.position || !ctx.physics || !ctx.physics.ready) { hasPrev = false; return; }
      if (ctx.state.mode !== 'flight') { hasPrev = false; return; }
      const pos = fl.position;
      if (!hasPrev) { _prev.copy(pos); hasPrev = true; return; }
      hurtCooldown = Math.max(0, hurtCooldown - dt);
      const seg = new THREE.Vector3().subVectors(pos, _prev);
      const dist = seg.length();
      if (dist > 1e-4 && hurtCooldown <= 0) {
        const dir = seg.clone().multiplyScalar(1 / dist);
        // A ray has no width: clip the CORNER of a building at 200 m/s and a ray misses it
        // entirely. The suit is swept as a 1.1 m ball, so the corner hurts.
        const hit = ctx.physics.shapeCast(_prev, dir, 1.1, dist + 0.5, null)
                 || ctx.physics.raycast(_prev, dir, dist + 0.55, null);
        if (hit) {
          const speed = fl.velocity ? fl.velocity.length() : dist / Math.max(dt, 1e-4);
          const impactForce = Math.min(3, speed / 40);
          // stop dead at the surface and slide the rest off. The sweep gives the centre the
          // suit's hull actually reached, which is already outside the wall.
          if (hit.centre) pos.copy(hit.centre).addScaledVector(hit.normal, 0.15);
          else pos.copy(hit.point).addScaledVector(hit.normal, 1.2);
          if (fl.velocity) {
            const vn = hit.normal.dot(fl.velocity);
            fl.velocity.addScaledVector(hit.normal, -vn * 1.25);
            fl.velocity.multiplyScalar(0.35);
          }
          // 'impact' is emitted in the same unit flight.js uses for its own ground hits —
          // closing speed in m/s — so audio and the HUD do not have to know which module
          // hit what. Damage itself belongs to flight.js, which owns state.integrity and
          // rewrites it every tick; writing it from here would just be overwritten.
          ctx.bus.emit('impact', {
            force: speed, point: hit.point.clone(), normal: hit.normal.clone(),
            material: hit.material, source: 'surface',
          });
          if (vfx) vfx.impact(hit.point, hit.normal, hit.material, Math.min(2, impactForce));
          // a fast suit going through a wall breaks it
          if (speed > 25) {
            breakAt(hit.point, Math.min(2, impactForce),
              { rec: hit.rec, direction: dir, normal: hit.normal });
          }
          hurtCooldown = 0.25;
        }
      }
      _prev.copy(pos);
    }

    // ---------------------------------------------------------------------------------

    ctx.destruction = {
      register, scan, breakAt, debris,
      entries,
      get debrisCount() { return debris.count; },
      stats() {
        return Object.assign(debris.stats(), {
          registered: entries.length,
          broken: entries.filter(e => e.broken).length,
        });
      },
      setBudget(active, rested) {
        if (active) { debris.maxActive = active; debris.maxActiveCeiling = active; }
        if (rested) debris.maxRested = rested;
      },
      // Test bed. Not part of the game world: it is how this piece is looked at on its own,
      // before world/ has published its props.  MZ.ctx.destruction.demo()
      demo(o) { return buildDemo(ctx, o); },
    };

    ctx.bus.on('ready', () => {
      vfx = ctx.combat && ctx.combat.vfx ? ctx.combat.vfx : null;
      scan(ctx.scene);
    });
    ctx.bus.on('world:ready', () => scan(ctx.scene));
    ctx.bus.on('debug:break', p => {
      if (p && p.point) breakAt(new THREE.Vector3().copy(p.point), p.force ?? 1, p);
    });

    // Deferred, coalesced trimesh rebuilds for carved geometry (the donut).
    let rebuildCooldown = 0;
    function serviceColliders(dt) {
      rebuildCooldown -= dt;
      if (rebuildCooldown > 0 || !ctx.physics || !ctx.physics.ready) return;
      for (const e of entries) {
        if (!e._colliderStale) continue;
        e._colliderStale = false;
        rebuildCooldown = 2.0;
        if (e.rec) { ctx.physics.remove(e.rec); e.rec = null; }
        e.rec = ctx.physics.addStatic(e.mesh, {
          shape: 'trimesh', material: e.spec.material, tag: e.mesh.name || e.type,
        });
        if (e.rec) { e.rec.breakable = e; e.mesh.userData.physicsRec = e.rec; }
        return;                      // one rebuild per cooldown, never two in a frame
      }
    }

    this._tick = (dt) => {
      if (!vfx && ctx.combat && ctx.combat.vfx) vfx = ctx.combat.vfx;
      serviceColliders(dt);
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i].t -= dt;
        if (pending[i].t <= 0) { const p = pending[i]; pending.splice(i, 1); p.run(); }
      }
      debris.update(dt);
      flightCollision(dt);
    };
  },

  update(dt, ctx) { if (this._tick) this._tick(dt); },
};

// -------------------------------------------------------------------------------------
// The demo bed: a glass wall, a concrete wall, two lamp posts and a giant donut, all
// registered as breakables. Built only when asked for.
// -------------------------------------------------------------------------------------
function buildDemo(ctx, o = {}) {
  if (ctx.scene.getObjectByName('BREAK_DEMO')) return ctx.scene.getObjectByName('BREAK_DEMO');
  const THREEx = THREE;
  const g = new THREEx.Group();
  g.name = 'BREAK_DEMO';
  // A test rig, not scenery. It stands on the empty plateau east of the house — clear of
  // the house, the town, the fair and the donut, so nothing in the real world can get
  // between the camera and the thing being shot at, but still under the real sky with the
  // real sun on it, which is the only lighting worth judging a break in.
  const PAD = [600, 0, 600];
  const origin = o.origin ||
    [PAD[0], (ctx.world && ctx.world.surfaceHeight ? ctx.world.surfaceHeight(PAD[0], PAD[2]) : 0) + 0.02, PAD[2]];
  g.position.set(origin[0], origin[1], origin[2]);

  const ground = new THREEx.Mesh(
    new THREEx.BoxGeometry(120, 1, 120),
    new THREEx.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.95 })
  );
  ground.position.set(0, -0.5, 0);
  ground.receiveShadow = true;
  g.add(ground);

  // glass wall: six separate panes in a frame, so shooting one breaks ONE
  const glassMat = new THREEx.MeshPhysicalMaterial({
    color: 0xdfeef5, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.34,
    transmission: 0, side: THREEx.DoubleSide, envMapIntensity: 1.4,
  });
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const pane = new THREEx.Mesh(new THREEx.BoxGeometry(3.0, 3.4, 0.035), glassMat);
      pane.name = 'glass_pane_' + i + '_' + j;
      pane.position.set(-3.1 + i * 3.1, 1.75 + j * 3.5, -6);
      pane.castShadow = false; pane.receiveShadow = false;
      g.add(pane);
    }
  }
  const frameMat = new THREEx.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const m = new THREEx.Mesh(new THREEx.BoxGeometry(0.08, 7.1, 0.09), frameMat);
    m.position.set(-4.65 + i * 3.1, 3.5, -6);
    m.userData.breakable = false;
    g.add(m);
  }

  // concrete wall
  const wall = new THREEx.Mesh(
    new THREEx.BoxGeometry(7, 3.4, 0.55),
    new THREEx.MeshStandardMaterial({ color: 0xb9b3a7, roughness: 0.94 })
  );
  wall.name = 'wall_demo';
  wall.position.set(10, 1.7, -6);
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);

  // two lamp posts
  const steel = new THREEx.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.42, metalness: 0.85 });
  for (let i = 0; i < 2; i++) {
    const post = new THREEx.Mesh(new THREEx.CylinderGeometry(0.11, 0.15, 6.4, 12), steel);
    post.name = 'lamp_post_' + i;
    post.position.set(-9 + i * 4, 3.2, -3);
    post.castShadow = true;
    g.add(post);
  }

  // the giant donut
  const donut = new THREEx.Mesh(
    new THREEx.TorusGeometry(4.2, 1.6, 22, 60),
    new THREEx.MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.95 })
  );
  donut.name = 'donut_demo';
  donut.position.set(17, 7.5, -14);
  donut.castShadow = true;
  g.add(donut);
  const shop = new THREEx.Mesh(
    new THREEx.BoxGeometry(10, 3.2, 7),
    new THREEx.MeshStandardMaterial({ color: 0xe6ddcb, roughness: 0.9 })
  );
  shop.position.set(17, 1.6, -14);
  shop.userData.breakable = false;
  shop.castShadow = shop.receiveShadow = true;
  g.add(shop);

  ctx.scene.add(g);
  if (ctx.physics && ctx.physics.ready) {
    ctx.physics.addStatic(ground, { shape: 'box', material: 'ground' });
    ctx.physics.addStatic(shop, { shape: 'box', material: 'concrete' });
  }
  ctx.destruction.scan(g);
  return g;
}
