// The debris field. Owned by task `destruction`.
//
// Every piece here is a real solid: its own geometry, its own convex collider, a mass
// derived from its own volume. A critic can land next to a shard and look at it.
//
// The budget is the reason a 290 m/s pass over a shattered town still runs. Three tiers:
//
//   ACTIVE   simulated by Rapier. A hard cap, plus a governor that lowers the cap when the
//            measured cost of a step says it must. When the cap is hit, the OLDEST piece is
//            retired first — never the one you are standing over.
//   RESTED   a piece that has stopped moving loses its rigid body and keeps its mesh. It
//            stays exactly where it landed, for good, at zero simulation cost. This is the
//            trick that lets the town stay broken.
//   RETIRED  when even the rested cap is passed, the oldest rested pieces sink and shrink
//            away over half a second rather than popping out of existence.
//
// Rested meshes further than `cullDistance` from the camera are hidden, so flying over a
// field of a thousand shards costs a distance check, not a thousand draw calls.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

// Rapier collision groups: membership in the high 16 bits, the filter in the low 16.
// Small debris is in group 2 and collides with everything EXCEPT group 2 — shards go
// through each other, never through the floor. Big pieces stay in group 1 and collide with
// everything, because a chunk of wall coming to rest on another chunk of wall is a picture
// worth paying for.
const G_DEBRIS_SMALL = 0x0002fffd;
const G_DEBRIS_BIG   = 0x0001ffff;

/* A TEXTURED MATERIAL ON UNTEXTURED GEOMETRY IS A SMEAR.
 *
 * Voronoi fracture builds each piece as brand-new geometry from the cell hull, so a chunk
 * has positions and normals and no `uv` at all — there is no meaningful mapping for the
 * inside of a solid that was only ever mapped on its skin. Handed the source material
 * anyway, three feeds the missing attribute as (0,0): every fragment of the piece samples
 * one single texel, and the chunk comes out as a flat wash of whatever colour lives at the
 * corner of the map. On the giant donut — the one big textured thing the game invites you
 * to shoot — that is "breaking the donut destroys the texture".
 *
 * So a piece with no UVs gets a map-less version of its material. One clone per source
 * material, cached, because the whole point of sharing materials is not to make a new one
 * per piece (see engine/dedupe.js for what that costs). Pieces that DID keep their UVs —
 * anything cut by splitByPlane, which interpolates them now — keep the real material and
 * the real texture.
 */
const _unmapped = new WeakMap();
function unmappedFor(material, geometry) {
  if (!material || Array.isArray(material)) return material;
  if (!material.map) return material;
  if (geometry && geometry.getAttribute && geometry.getAttribute('uv')) return material;
  let m = _unmapped.get(material);
  if (!m) {
    m = material.clone();
    m.map = null;
    // Keep the tone: a diffuse map is usually darker than the white it multiplies, so
    // dropping it without compensating turns rubble into bright paper.
    if (m.color) m.color.multiplyScalar(0.72);
    m.name = (material.name || 'debris') + '_nomap';
    _unmapped.set(material, m);
  }
  return m;
}

export class DebrisField {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.maxActive = opts.maxActive ?? 220;
    this.maxRested = opts.maxRested ?? 700;
    this.cullDistance = opts.cullDistance ?? 340;
    this.maxShadowCasters = opts.maxShadowCasters ?? 40;
    this.active = [];
    this.rested = [];
    this.retiring = [];
    this.shadowCasters = 0;
    this.root = new THREE.Group();
    this.root.name = 'DEBRIS';
    this.root.matrixAutoUpdate = false;
    ctx.scene.add(this.root);
    this._cullTimer = 0;
    this.spawned = 0;
    // The budget governor. maxActive is a ceiling, not a promise: if Rapier starts costing
    // more than a fifth of a 60 fps frame the field shrinks itself, oldest piece first, and
    // grows back when the cost falls. This is what holds 60 fps on a 290 m/s pass over a
    // town whose every window is already on the pavement.
    this.maxActiveCeiling = this.maxActive;
    // Never throttle below one whole window. A pane of the Malibu glass wall makes
    // about 80 shards; a floor under that would mean the governor could stop a window
    // being able to shatter completely, which is worse than the frame it costs.
    this.maxActiveFloor = opts.maxActiveFloor ?? 80;
    // What matters is the cost the DEBRIS adds, not the cost of the world it lands in: this
    // scene's Rapier step is already ~1.7 ms with nothing moving in it, so an absolute
    // threshold would throttle the field to its floor before a single shard existed. The
    // empty-field cost is learned, and only the excess over it is budgeted.
    // Measured on this scene: an active piece costs Rapier 0.026 ms a step over an
    // empty-field baseline of 1.15 ms. 4 ms of excess is therefore ~155 pieces in flight,
    // which is a shattered window plus a wall plus a lamp post all in the air at once and
    // still under a quarter of a 60 fps frame.
    this.budgetMs = opts.budgetMs ?? 4.0;
    this.baselineMs = 0;
    this._budgetTimer = 0;
  }

  get count() { return this.active.length + this.rested.length; }

  stats() {
    return {
      active: this.active.length,
      rested: this.rested.length,
      retiring: this.retiring.length,
      spawnedTotal: this.spawned,
      maxActive: this.maxActive,
      maxRested: this.maxRested,
      baselineMs: +this.baselineMs.toFixed(2),
      stepMs: +(((this.ctx.physics && this.ctx.physics.stepMs) || 0)).toFixed(2),
    };
  }



  /**
   * Spawn one real piece.
   * @param o.geometry   BufferGeometry, centred on its own centre of mass
   * @param o.material   THREE material (shared — do not clone per piece)
   * @param o.position   world position of that centre of mass
   * @param o.quaternion world orientation
   * @param o.velocity   {x,y,z} initial linear velocity
   * @param o.spin       {x,y,z} initial angular velocity
   * @param o.density    kg/m3 — 2400 concrete, 2500 glass, 7800 steel, 350 pastry
   */
  spawn(o) {
    const ctx = this.ctx;
    if (!ctx.physics || !ctx.physics.ready) return null;
    const mesh = new THREE.Mesh(o.geometry, unmappedFor(o.material, o.geometry));
    mesh.position.copy(o.position);
    if (o.quaternion) mesh.quaternion.copy(o.quaternion);
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const radius = o.geometry.boundingSphere.radius;
    if (radius > 0.22 && this.shadowCasters < this.maxShadowCasters) {
      mesh.castShadow = true; this.shadowCasters++;
      mesh.userData.castsShadow = true;
    }
    this.root.add(mesh);

    const rec = ctx.physics.addDynamic(mesh, {
      shape: 'convex',
      mass: o.mass,
      density: o.density ?? 2400,
      velocity: o.velocity,
      spin: o.spin,
      friction: o.friction ?? 0.9,
      restitution: o.restitution ?? 0.05,
      linearDamping: o.linearDamping ?? 0.05,
      angularDamping: o.angularDamping ?? 0.3,
      ccd: !!o.ccd,
      // Every solid in this world is a zero-thickness trimesh, so a thin shard needs both:
      // soft CCD so it cannot pass through the terrace on the frame it lands, and a contact
      // skin so it comes to rest ON the slab rather than half sunk into it.
      // Capped hard. Soft CCD inflates the body's broadphase AABB by the prediction
      // distance, so a generous value on a body in the middle of a town multiplies the pairs
      // the solver has to look at. 0.3 m is enough to catch a shard against a slab.
      softCcd: o.softCcd ?? Math.min(0.3, Math.max(0.1, radius * 2.5)),
      contactSkin: o.contactSkin ?? Math.min(0.03, Math.max(0.008, radius * 0.25)),
      groups: (o.selfCollide ?? (radius > 0.5)) ? G_DEBRIS_BIG : G_DEBRIS_SMALL,
      material: o.material_ || 'concrete',
      tag: 'debris',
      contactForceEvents: !!o.landSound,
      contactForceThreshold: o.contactForceThreshold ?? 900,
      onContact: o.landSound
        ? (force) => {
            if (piece.landed) return;
            piece.landed = true;
            ctx.bus.emit('debris:land', {
              point: mesh.position.clone(),
              force: Math.min(1, force / 9000),
              material: o.material_ || 'concrete',
            });
          }
        : null,
    });
    if (!rec) { this.root.remove(mesh); return null; }

    const piece = {
      mesh, rec, born: ctx.time, still: 0, radius,
      baseScale: mesh.scale.x, landed: false,
      floorY: this._floorUnder(o.position),
    };
    this.active.push(piece);
    this.spawned++;
    this._enforceActive();
    return piece;
  }

  /**
   * Spawn one piece made of several parts that must stay welded — the top of a lamp post
   * with its arm and its lamp head still on it. One rigid body, several colliders.
   * @param o.object  THREE.Object3D at the world transform of the piece, parts as children
   * @param o.hulls   [Float32Array] point clouds in the piece's local space
   */
  spawnCompound(o) {
    const ctx = this.ctx;
    if (!ctx.physics || !ctx.physics.addDynamicCompound) return null;
    const obj = o.object;
    obj.position.copy(o.position);
    if (o.quaternion) obj.quaternion.copy(o.quaternion);
    this.root.add(obj);

    const box = new THREE.Box3().setFromObject(obj);
    const radius = Math.max(0.05, box.getSize(_v).length() * 0.5);

    const rec = ctx.physics.addDynamicCompound(obj, o.hulls, {
      mass: o.mass, density: o.density ?? 2400,
      velocity: o.velocity, spin: o.spin,
      friction: o.friction ?? 0.9, restitution: o.restitution ?? 0.05,
      linearDamping: o.linearDamping ?? 0.05, angularDamping: o.angularDamping ?? 0.3,
      // A four-metre lamp section is in no danger of tunnelling: full CCD and a wide soft
      // CCD prediction on a body this size cost 58 ms of world step EACH, measured, because
      // the prediction distance is added to its broadphase AABB in a town full of colliders.
      ccd: false, softCcd: 0.25, contactSkin: 0.02,
      groups: G_DEBRIS_BIG,
      material: o.material_ || 'steel', tag: 'debris',
      contactForceEvents: !!o.landSound,
      contactForceThreshold: o.contactForceThreshold ?? 900,
      onContact: o.landSound
        ? (force) => {
            if (piece.landed) return;
            piece.landed = true;
            ctx.bus.emit('debris:land', {
              point: obj.position.clone(),
              force: Math.min(1, force / 9000),
              material: o.material_ || 'steel',
            });
          }
        : null,
    });
    if (!rec) { this.root.remove(obj); return null; }

    const piece = { mesh: obj, rec, born: ctx.time, still: 0, radius,
                    baseScale: obj.scale.x, landed: false, compound: true,
                    floorY: this._floorUnder(o.position) };
    this.active.push(piece);
    this.spawned++;
    this._enforceActive();
    return piece;
  }

  // How far below its birthplace a piece is allowed to fall before it is written off.
  // Anything under the local ground (or the sea) is never coming back.
  _floorUnder(pos) {
    const w = this.ctx.world;
    let g = -400;
    if (w && w.surfaceHeight) {
      const h = w.surfaceHeight(pos.x, pos.z);
      if (Number.isFinite(h)) g = h - 6;
    }
    if (w && Number.isFinite(w.seaLevel)) g = Math.max(g, w.seaLevel - 4);
    return Math.min(g, pos.y - 3);
  }

  /**
   * Is there anything directly under this piece for it to be standing on?
   *
   * This is the question that decides whether a piece may be frozen. Freezing drops the
   * rigid body and leaves the mesh exactly where it is, for good — which is free and
   * invisible for a shard lying on the pavement, and is a rock hanging in the sky for one
   * that was still falling. Half the glass wall used to end up nailed to the air over the
   * terrace because the budget governor froze whatever was oldest without asking.
   *
   * One short downward ray, only ever cast at the moment a piece is considered for
   * freezing, so it costs nothing per frame. It also answers the awkward cases correctly:
   * a chunk resting on a rooftop finds the roof, and a chunk jammed inside the donut it
   * was carved out of finds nothing under it and is faded away instead.
   */
  _supported(p) {
    const phys = this.ctx.physics;
    if (!phys || !phys.raycast) return true;    // no way to tell: keep it, do not fade it
    const reach = p.radius * 1.15 + 0.45;
    const hit = phys.raycast(p.mesh.position, DOWN, reach, p.rec);
    if (hit) return true;
    // Nothing under it — but it may be lodged against, or hanging from, something beside
    // it. Rapier will not tell us cheaply, so take one more sample straight up: a piece
    // wedged inside a solid (the classic donut-bite jam) has geometry above it too.
    const up = phys.raycast(p.mesh.position, UP, p.radius * 0.9, p.rec);
    return !!up;
  }

  _enforceActive() {
    while (this.active.length > this.maxActive) {
      const p = this.active.shift();           // oldest first, always
      const v = p.rec && !p.rec.dead ? p.rec.body.linvel() : { x: 0, y: 0, z: 0 };
      const speed = Math.hypot(v.x, v.y, v.z);
      // A piece that has effectively landed is frozen: it keeps the picture and costs
      // nothing ever again. Anything still moving, or with nothing underneath it, is faded
      // out instead — over-budget must never mean debris nailed to the air.
      if (speed < 1.2 && this._supported(p)) this._freeze(p);
      else this._retire(p);
    }
  }

  // Drop the rigid body, keep the mesh where it is. The piece stays for good, for free.
  _freeze(p) {
    if (p.frozen) return;
    p.frozen = true;
    if (p.rec) this.ctx.physics.remove(p.rec);
    p.rec = null;
    p.mesh.matrixAutoUpdate = false;
    p.mesh.updateMatrix();
    this.rested.push(p);
    while (this.rested.length > this.maxRested) this._retire(this.rested.shift());
  }

  _retire(p) {
    if (p.retiring) return;
    p.retiring = true;
    if (p.rec) { this.ctx.physics.remove(p.rec); p.rec = null; }
    p.fade = 0;
    p.y0 = p.mesh.position.y;
    p.mesh.matrixAutoUpdate = true;
    this.retiring.push(p);
  }

  _dispose(p) {
    if (p.mesh.userData.castsShadow) this.shadowCasters--;
    this.root.remove(p.mesh);
    if (p.mesh.geometry) p.mesh.geometry.dispose();
    // A compound piece borrows geometry from the scene (a lamp head shared by forty lamps),
    // so only the geometry this break actually created may be disposed.
    if (p.compound) p.mesh.traverse(o => {
      if (o.geometry && o.userData.ownGeometry) o.geometry.dispose();
    });
  }

  update(dt) {
    const ctx = this.ctx;
    // active -> rested
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (!p.rec || p.rec.dead) { this.active.splice(i, 1); continue; }
      const v = p.rec.body.linvel(), w = p.rec.body.angvel();
      // Freeze early and freeze often. A shard that has stopped costs nothing once its body
      // is gone, and the difference between resting at 0.45 s and at 0.7 s is invisible —
      // but across a shattered street it is the difference between 60 fps and 40.
      const moving = Math.hypot(v.x, v.y, v.z) > 0.25 || Math.hypot(w.x, w.y, w.z) > 0.7;
      p.still = moving ? 0 : p.still + dt;
      if (p.still > 0.45 || p.rec.body.isSleeping()) {
        this.active.splice(i, 1);
        // Stopped is not the same as landed. A chunk carved out of the donut spawns inside
        // what is left of the donut — whose trimesh collider is one bite stale — and sits
        // there perfectly still, jammed in the pastry. Freezing it would leave it hanging
        // in the hole for the rest of the session, which is exactly what it used to do.
        if (this._supported(p)) this._freeze(p);
        else this._retire(p);
      } else if (p.mesh.position.y < p.floorY) {
        // Gone for good: over the cliff edge, or into the sea. Half the glass in this house
        // falls a hundred metres to the water, and a body that will never come to rest sits
        // in the active budget forever if nobody takes it out.
        this.active.splice(i, 1);
        this._retire(p);
      }
    }
    // retiring: sink and shrink, then gone
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const p = this.retiring[i];
      p.fade += dt / 0.55;
      if (p.fade >= 1) { this._dispose(p); this.retiring.splice(i, 1); continue; }
      const k = 1 - p.fade;
      p.mesh.scale.setScalar(p.baseScale * k);
      p.mesh.position.y = p.y0 - p.radius * 1.2 * p.fade;
    }
    // the budget governor
    this._budgetTimer += dt;
    if (this._budgetTimer > 0.25) {
      this._budgetTimer = 0;
      const raw = (ctx.physics && ctx.physics.stepMs) || 0;
      if (this.active.length <= 4 && raw > 0) {
        this.baselineMs = this.baselineMs ? Math.min(this.baselineMs, raw)
                                          : raw;
      }
      const ms = Math.max(0, raw - this.baselineMs);
      if (ms > this.budgetMs && this.maxActive > this.maxActiveFloor) {
        // Proportional, not a fixed step down. Cost is very close to linear in the number of
        // active bodies, so scaling the cap by budget/cost lands on the right number in one
        // correction instead of walking down to it over two seconds of dropped frames.
        const want = Math.round(this.active.length * (this.budgetMs / ms));
        this.maxActive = Math.max(this.maxActiveFloor, Math.min(this.maxActive - 8, want));
        this._enforceActive();
      } else if (ms < this.budgetMs * 0.6 && this.maxActive < this.maxActiveCeiling) {
        this.maxActive = Math.min(this.maxActiveCeiling, this.maxActive + 10);
      }
    }

    // distance culling of the rested field — the 290 m/s pass lives here
    this._cullTimer += dt;
    if (this._cullTimer > 0.25) {
      this._cullTimer = 0;
      const cam = ctx.camera.position;
      const d2 = this.cullDistance * this.cullDistance;
      for (const p of this.rested) {
        const dx = p.mesh.position.x - cam.x, dy = p.mesh.position.y - cam.y,
              dz = p.mesh.position.z - cam.z;
        const far = dx * dx + dy * dy + dz * dz > d2;
        if (p.mesh.visible === far) p.mesh.visible = !far;
      }
    }
  }

  clear() {
    for (const list of [this.active, this.rested, this.retiring]) {
      for (const p of list) { if (p.rec) this.ctx.physics.remove(p.rec); this._dispose(p); }
      list.length = 0;
    }
    this.shadowCasters = 0;
  }
}
