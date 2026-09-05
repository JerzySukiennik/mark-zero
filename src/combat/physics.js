// The Rapier world. Owned by task `destruction`.
//
// Nobody else imports rapier: every other module reaches physics through ctx.physics.
// Rules of the house:
//   - The world steps at a FIXED 1/60 s, accumulated from the 1/120 s game tick, so two
//     game ticks are one physics tick. Determinism is the whole point of the fixed loop:
//     MZ.sim(600) must break a window exactly the same way twice.
//   - Colliders carry a record in `byCollider` (rapier colliders have no userData), which
//     is how a repulsor bolt knows the thing it hit is the third pane of the glass wall.
//   - A kinematic "ground proxy" follows the action so debris always has something to land
//     on even before world/ has published its own colliders. world/ can switch it off with
//     ctx.physics.setGroundProxy(false).
import * as THREE from 'three';
import RAPIER, { init as rapierInit } from 'rapier';

const FIXED = 1 / 60;

export default {
  id: 'physics',

  async init(ctx) {
    let R = null;
    try {
      await rapierInit();
      R = RAPIER;
    } catch (e) {
      console.error('[physics] rapier failed to init', e);
    }

    const world = R ? new R.World({ x: 0, y: -9.81, z: 0 }) : null;
    if (world) world.timestep = FIXED;

    const events = R && world ? new R.EventQueue(true) : null;
    const byCollider = new Map();   // collider.handle -> record
    const dynamics = [];            // records whose mesh follows a body
    let acc = 0;
    let steps = 0;
    let groundProxy = null;
    let groundProxyOn = true;
    let staticCount = 0;            // how many real static colliders the world published
    let stepMs = 0;                 // exponentially smoothed cost of one world.step()
    const contactQueue = [];        // rec, force, other — dispatched OUTSIDE the WASM borrow

    const _q = new THREE.Quaternion();
    const _v = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _m = new THREE.Matrix4();

    // ---- collider builders -------------------------------------------------------------

    function geometryHull(geometry, scale) {
      const p = geometry.getAttribute('position');
      if (!p) return null;
      const arr = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        arr[i * 3] = p.getX(i) * scale.x;
        arr[i * 3 + 1] = p.getY(i) * scale.y;
        arr[i * 3 + 2] = p.getZ(i) * scale.z;
      }
      return arr;
    }

    function descFor(mesh, shape, scale) {
      const g = mesh.geometry;
      if (!g) return null;
      if (shape === 'box' || shape === 'auto') {
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        const hx = Math.max(0.01, (bb.max.x - bb.min.x) * 0.5 * scale.x);
        const hy = Math.max(0.01, (bb.max.y - bb.min.y) * 0.5 * scale.y);
        const hz = Math.max(0.01, (bb.max.z - bb.min.z) * 0.5 * scale.z);
        const d = R.ColliderDesc.cuboid(hx, hy, hz);
        const cx = (bb.max.x + bb.min.x) * 0.5 * scale.x;
        const cy = (bb.max.y + bb.min.y) * 0.5 * scale.y;
        const cz = (bb.max.z + bb.min.z) * 0.5 * scale.z;
        if (cx || cy || cz) d.setTranslation(cx, cy, cz);
        return d;
      }
      if (shape === 'convex') {
        // A convex hull of a flat point set is degenerate. Rapier takes it without
        // complaining and then the solver spends orders of magnitude longer on it than on a
        // real solid — this is a measured cliff, not a theoretical one. Anything with no
        // thickness gets a box instead.
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox;
        const ex = Math.abs(bb.max.x - bb.min.x) * Math.abs(scale.x);
        const ey = Math.abs(bb.max.y - bb.min.y) * Math.abs(scale.y);
        const ez = Math.abs(bb.max.z - bb.min.z) * Math.abs(scale.z);
        if (Math.min(ex, ey, ez) < 0.012) {
          return R.ColliderDesc.cuboid(
            Math.max(0.006, ex * 0.5), Math.max(0.006, ey * 0.5), Math.max(0.006, ez * 0.5)
          );
        }
        const pts = geometryHull(g, scale);
        return pts ? R.ColliderDesc.convexHull(pts) : null;
      }
      if (shape === 'trimesh') {
        const pts = geometryHull(g, scale);
        if (!pts) return null;
        let idx;
        if (g.index) idx = new Uint32Array(g.index.array);
        else { idx = new Uint32Array(pts.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i; }
        return R.ColliderDesc.trimesh(pts, idx);
      }
      if (shape === 'ball') {
        if (!g.boundingSphere) g.computeBoundingSphere();
        return R.ColliderDesc.ball(Math.max(0.02, g.boundingSphere.radius * scale.x));
      }
      return null;
    }

    function decompose(mesh) {
      mesh.updateWorldMatrix(true, false);
      mesh.matrixWorld.decompose(_v, _q, _s);
      return {
        pos: { x: _v.x, y: _v.y, z: _v.z },
        rot: { x: _q.x, y: _q.y, z: _q.z, w: _q.w },
        scale: _s.clone(),
      };
    }

    // ---- public API --------------------------------------------------------------------

    function addStatic(mesh, opts = {}) {
      if (!world || !mesh) return null;
      const t = decompose(mesh);
      const desc = descFor(mesh, opts.shape || 'trimesh', t.scale);
      if (!desc) return null;
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed().setTranslation(t.pos.x, t.pos.y, t.pos.z)
          .setRotation(t.rot)
      );
      desc.setFriction(opts.friction ?? 0.9).setRestitution(opts.restitution ?? 0.02);
      const col = world.createCollider(desc, body);
      const rec = {
        body, col, mesh, kind: 'static',
        tag: opts.tag || mesh.name || 'static',
        material: opts.material || mesh.userData?.material || 'concrete',
        breakable: opts.breakable || null,
      };
      byCollider.set(col.handle, rec);
      staticCount++;
      return rec;
    }

    function addDynamic(mesh, opts = {}) {
      if (!world || !mesh) return null;
      const t = decompose(mesh);
      const desc = descFor(mesh, opts.shape || 'convex', t.scale);
      if (!desc) return null;
      const bdesc = R.RigidBodyDesc.dynamic()
        .setTranslation(t.pos.x, t.pos.y, t.pos.z)
        .setRotation(t.rot)
        .setLinearDamping(opts.linearDamping ?? 0.06)
        .setAngularDamping(opts.angularDamping ?? 0.25)
        .setCcdEnabled(!!opts.ccd);
      // Soft CCD costs a fraction of full CCD and is what keeps a 12 mm glass shard from
      // going through a terrace slab that has no thickness at all — every world surface here
      // is a trimesh, so anything that gets under one never comes back, and the solver then
      // burns milliseconds fighting the penetration.
      if (opts.softCcd > 0) bdesc.setSoftCcdPrediction(opts.softCcd);
      const body = world.createRigidBody(bdesc);
      if (opts.velocity) body.setLinvel(opts.velocity, true);
      if (opts.spin) body.setAngvel(opts.spin, true);
      // A contact skin gives a thin piece a cushion to rest ON rather than half inside.
      if (opts.contactSkin > 0 && desc.setContactSkin) desc.setContactSkin(opts.contactSkin);
      // Debris that does not collide with other debris. Sixty shards landing in one pile is
      // a contact graph the solver has to untangle every step for a stack nobody can see
      // inside; against the world alone the cost is linear and the picture is the same.
      if (opts.groups) desc.setCollisionGroups(opts.groups);
      // Mass wins over density when the caller knows what the thing weighs: world/ states a
      // prop's mass in kg, and a chunk of it must weigh its share of that, not whatever a
      // guessed density says. Rapier clamps a zero mass to "infinite", so never pass 0.
      if (opts.mass > 0) desc.setMass(opts.mass);
      else desc.setDensity(opts.density ?? 900);
      desc.setFriction(opts.friction ?? 0.85)
        .setRestitution(opts.restitution ?? 0.06);
      if (opts.contactForceEvents) {
        desc.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
        desc.setContactForceEventThreshold(opts.contactForceThreshold ?? 400);
      }
      const col = world.createCollider(desc, body);
      const rec = {
        body, col, mesh, kind: 'dynamic',
        tag: opts.tag || 'debris',
        material: opts.material || 'concrete',
        onContact: opts.onContact || null,
      };
      byCollider.set(col.handle, rec);
      dynamics.push(rec);
      return rec;
    }

    /**
     * One rigid body, several convex colliders, one Object3D. A lamp post that snaps
     * halfway up does not become a shaft, an arm and a lamp head all falling on their own
     * clocks — it is ONE piece with a lamp on the end of it, and this is what makes it that.
     *
     * @param object   THREE.Object3D already at the world position/orientation of the piece
     * @param hulls    [Float32Array] point clouds in the piece's LOCAL space, one per part
     */
    function addDynamicCompound(object, hulls, opts = {}) {
      if (!world || !object || !hulls || !hulls.length) return null;
      const bdesc = R.RigidBodyDesc.dynamic()
        .setTranslation(object.position.x, object.position.y, object.position.z)
        .setRotation({ x: object.quaternion.x, y: object.quaternion.y,
                       z: object.quaternion.z, w: object.quaternion.w })
        .setLinearDamping(opts.linearDamping ?? 0.06)
        .setAngularDamping(opts.angularDamping ?? 0.25)
        .setCcdEnabled(!!opts.ccd);
      if (opts.softCcd > 0) bdesc.setSoftCcdPrediction(opts.softCcd);
      const body = world.createRigidBody(bdesc);
      if (opts.velocity) body.setLinvel(opts.velocity, true);
      if (opts.spin) body.setAngvel(opts.spin, true);

      const rec = {
        body, col: null, cols: [], mesh: object, kind: 'dynamic',
        tag: opts.tag || 'debris', material: opts.material || 'steel',
        onContact: opts.onContact || null,
      };
      let made = 0;
      for (const pts of hulls) {
        if (!pts || pts.length < 12) continue;
        const d = R.ColliderDesc.convexHull(pts);
        if (!d) continue;
        d.setFriction(opts.friction ?? 0.85).setRestitution(opts.restitution ?? 0.05);
        if (opts.contactSkin > 0 && d.setContactSkin) d.setContactSkin(opts.contactSkin);
        if (opts.groups) d.setCollisionGroups(opts.groups);
        if (made === 0 && opts.mass > 0) d.setMass(opts.mass);
        else d.setDensity(opts.density ?? 900);
        if (opts.contactForceEvents && made === 0) {
          d.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
          d.setContactForceEventThreshold(opts.contactForceThreshold ?? 400);
        }
        const col = world.createCollider(d, body);
        rec.cols.push(col);
        byCollider.set(col.handle, rec);
        if (!rec.col) rec.col = col;
        made++;
      }
      if (!made) { try { world.removeRigidBody(body); } catch (e) {} return null; }
      dynamics.push(rec);
      return rec;
    }

    function remove(rec) {
      if (!rec || !world || rec.dead) return;
      rec.dead = true;
      if (rec.col) byCollider.delete(rec.col.handle);
      if (rec.cols) for (const c of rec.cols) byCollider.delete(c.handle);
      try { world.removeRigidBody(rec.body); } catch (e) { /* already gone */ }
      const i = dynamics.indexOf(rec);
      if (i >= 0) dynamics.splice(i, 1);
    }

    const _ro = { x: 0, y: 0, z: 0 };
    const _rd = { x: 0, y: 0, z: 1 };

    // Ray against everything in the world. Returns null or
    // {point, normal, distance, rec, material}. `skip` is a record to ignore (the shooter).
    function raycast(origin, dir, maxDist = 1000, skip = null) {
      if (!world) return null;
      _ro.x = origin.x; _ro.y = origin.y; _ro.z = origin.z;
      _rd.x = dir.x; _rd.y = dir.y; _rd.z = dir.z;
      const ray = new R.Ray(_ro, _rd);
      const hit = world.castRayAndGetNormal(
        ray, maxDist, true, undefined, undefined,
        skip && skip.col ? skip.col : undefined,
        skip && skip.body ? skip.body : undefined
      );
      if (!hit) return null;
      const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
      const rec = byCollider.get(hit.collider.handle) || null;
      const n = hit.normal;
      return {
        point: new THREE.Vector3(
          origin.x + dir.x * toi, origin.y + dir.y * toi, origin.z + dir.z * toi
        ),
        normal: new THREE.Vector3(n.x, n.y, n.z),
        distance: toi,
        rec,
        material: rec ? rec.material : 'concrete',
      };
    }

    /**
     * Sweep a ball along a segment. A ray has no width, so a suit clipping the CORNER of a
     * building passes clean through one; a 1.1 m ball does not. This is the flight
     * collision surface, and the reason hitting a building hurts.
     * Returns the same record shape as raycast().
     */
    const _ballCache = new Map();
    function shapeCast(origin, dir, radius = 1.0, maxDist = 5, skip = null) {
      if (!world) return null;
      let ball = _ballCache.get(radius);
      if (!ball) { ball = new R.Ball(radius); _ballCache.set(radius, ball); }
      const pos = { x: origin.x, y: origin.y, z: origin.z };
      const rot = { x: 0, y: 0, z: 0, w: 1 };
      const vel = { x: dir.x, y: dir.y, z: dir.z };
      let hit = null;
      try {
        hit = world.castShape(
          pos, rot, vel, ball, 0, maxDist, true, undefined, undefined,
          skip && skip.col ? skip.col : undefined,
          skip && skip.body ? skip.body : undefined
        );
      } catch (e) { return null; }
      if (!hit) return null;
      const toi = hit.time_of_impact !== undefined ? hit.time_of_impact : hit.toi;
      const rec = byCollider.get(hit.collider.handle) || null;
      // The witness points and normals a shape cast returns live in each shape's own local
      // frame, which is a good way to place an impact a metre off the wall. So the ball's
      // centre at the moment of contact is taken from the time of impact, and the surface
      // itself is confirmed with a short ray from there — that always comes back in world
      // space with a real normal.
      const centre = new THREE.Vector3(
        origin.x + dir.x * toi, origin.y + dir.y * toi, origin.z + dir.z * toi
      );
      const confirm = raycast(centre, dir, radius + 0.6, null);
      const point = confirm ? confirm.point : centre.clone().addScaledVector(dir, radius);
      const normal = confirm ? confirm.normal
        : new THREE.Vector3(-dir.x, -dir.y, -dir.z).normalize();
      return {
        point, normal, centre, distance: toi, rec,
        material: rec ? rec.material : 'concrete',
      };
    }

    function setGroundProxy(on) {
      groundProxyOn = on;
      if (!on && groundProxy) {
        byCollider.delete(groundProxy.col.handle);
        try { world.removeRigidBody(groundProxy.body); } catch (e) {}
        groundProxy = null;
      }
    }

    // The proxy is scaffolding, not scenery. The moment world/ has published real ground it
    // must go: a 600 m slab parked at the height under the camera is an invisible floor out
    // over the cliff, and both the flight sweep and the bolt raycast would hit it.
    function ensureGroundProxy() {
      if (groundProxyOn && staticCount > 2) { setGroundProxy(false); return; }
      if (!world || !groundProxyOn) return;
      const cam = ctx.camera;
      let y = 0;
      const x = cam ? cam.position.x : 0;
      const z = cam ? cam.position.z : 0;
      if (ctx.world && ctx.world.surfaceHeight) {
        const h = ctx.world.surfaceHeight(x, z);
        if (Number.isFinite(h)) y = h;
      }
      if (!groundProxy) {
        const body = world.createRigidBody(
          R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y - 1, z)
        );
        const col = world.createCollider(
          R.ColliderDesc.cuboid(300, 1, 300).setFriction(0.95).setRestitution(0.01), body
        );
        groundProxy = { body, col, mesh: null, kind: 'static', tag: 'ground', material: 'ground' };
        byCollider.set(col.handle, groundProxy);
      } else {
        groundProxy.body.setNextKinematicTranslation({ x, y: y - 1, z });
      }
    }

    // ---- the step ----------------------------------------------------------------------

    function step(dt) {
      if (!world) return;
      acc += dt;
      let n = 0;
      while (acc >= FIXED && n < 4) {
        acc -= FIXED; n++; steps++;
        ensureGroundProxy();
        const t0 = performance.now();
        world.step(events);
        // Smoothed, because the debris budget throttles off it and a single 12 ms hitch
        // while a wall shatters must not permanently shrink the field.
        stepMs += (performance.now() - t0 - stepMs) * 0.06;
        if (events) {
          // NOTHING is called back into during the drain. A drain callback runs INSIDE the
          // Rapier WASM borrow, so a listener that touches the world — a raycast, a
          // remove(), anything — trips "recursive use of an object" and the physics world is
          // dead for the rest of the session, silently. So contacts are queued here and
          // dispatched below, outside the borrow.
          events.drainContactForceEvents(ev => {
            const a = byCollider.get(ev.collider1());
            const b = byCollider.get(ev.collider2());
            const rec = (a && a.onContact) ? a : (b && b.onContact ? b : null);
            if (rec) contactQueue.push(rec, ev.totalForceMagnitude(), rec === a ? b : a);
          });
          events.drainCollisionEvents(() => {});
        }
      }
      for (let i = 0; i < contactQueue.length; i += 3) {
        const rec = contactQueue[i];
        if (rec.dead || !rec.onContact) continue;
        try { rec.onContact(contactQueue[i + 1], contactQueue[i + 2]); }
        catch (e) { console.error('[physics onContact]', e); }
      }
      contactQueue.length = 0;
      // Push every dynamic body's transform onto its mesh.
      for (let i = 0; i < dynamics.length; i++) {
        const rec = dynamics[i];
        if (!rec.mesh || rec.dead) continue;
        const t = rec.body.translation();
        const r = rec.body.rotation();
        rec.mesh.position.set(t.x, t.y, t.z);
        rec.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }

    ctx.physics = {
      ready: !!world,
      RAPIER: R,
      world,
      byCollider,
      addStatic,
      addDynamic,
      addDynamicCompound,
      remove,
      raycast,
      shapeCast,
      step,
      setGroundProxy,
      get bodyCount() { return world ? world.bodies.len() : 0; },
      get dynamicCount() { return dynamics.length; },
      get steps() { return steps; },
      get stepMs() { return stepMs; },
    };
  },

  // physics.js sits before world/ in the registry, so it steps FIRST every tick: bodies
  // move, meshes follow, and everything downstream this frame sees the same positions.
  update(dt, ctx) {
    if (ctx.physics && ctx.physics.ready) ctx.physics.step(dt);
  },
};
