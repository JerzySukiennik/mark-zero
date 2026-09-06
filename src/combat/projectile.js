// Repulsor bolts. Owned by task `combat`.
//
// A bolt is an OBJECT THAT TRAVELS. It leaves the palm emitter, crosses the gap at 240 m/s,
// and arrives — you see the time of flight, and at 400 m you wait a beat and a half for the
// hit. That is the whole difference between this and a hitscan line.
//
// Collision is a swept ray over the segment the bolt covers this tick, so nothing is ever
// tunnelled through at 2 m per step. Everything glowing is toneMapped:false with explicit
// blending (see vfx.js for why).
import * as THREE from 'three';
import { glowMaterial, glowSprite, REPULSOR } from './vfx.js';

const POOL = 48;

export class ProjectileSystem {
  constructor(ctx, vfx) {
    this.ctx = ctx;
    this.vfx = vfx;
    this.root = new THREE.Group();
    this.root.name = 'REPULSOR_BOLTS';
    ctx.scene.add(this.root);

    const coreGeo = new THREE.SphereGeometry(1, 12, 10);
    // Tapered: wide and soft at the tail, pinched to nothing at the head, so the streak
    // reads as something that came FROM somewhere rather than a floating tube.
    // Local +Y is rotated onto the flight direction, so radiusTop is the HEAD: wide and hot
    // at the bolt, tapering to nothing behind it. The other way round reads as a flame.
    const tailGeo = new THREE.CylinderGeometry(0.17, 0.02, 1, 10, 1, true);

    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const g = new THREE.Group();
      g.visible = false;
      g.frustumCulled = false;
      // white-hot core: NOT additive — it must stay a hard opaque white disc against a
      // bright sky, which is exactly where an additive-only bolt disappears.
      const core = new THREE.Mesh(coreGeo, glowMaterial(REPULSOR.core, {
        additive: false, depthWrite: true, opacity: 1,
      }));
      core.scale.setScalar(0.085);
      const inner = new THREE.Mesh(coreGeo, glowMaterial(REPULSOR.inner, { opacity: 0.9 }));
      inner.scale.setScalar(0.19);
      // The halo is a sprite with a real falloff, not a coloured ball: a flat magenta disc
      // flying across the ocean reads as a sticker, a falloff reads as a light.
      const bloom = glowSprite(vfx.glowTex, REPULSOR.bloom, 0.85);
      bloom.scale.setScalar(1.5);
      const tail = new THREE.Mesh(tailGeo, glowMaterial(REPULSOR.bloom, { opacity: 0.45 }));
      g.add(core, inner, bloom, tail);
      this.root.add(g);
      this.pool.push({ g, core, inner, bloom, tail, live: false });
    }

    // Three travelling lights: the bolt has to actually light what it flies past.
    this.lights = [];
    /* NEVER TOGGLE A LIGHT'S `visible`. IT RECOMPILES THE WHOLE SCENE.
     *
     * three is a forward renderer: the number of lights is baked into EVERY material's
     * shader as a #define, so the moment that number changes, every material in the scene
     * needs a new program. And a light with `visible = false` is skipped during scene
     * traversal, so hiding one changes the count exactly as removing it would.
     *
     * That is the multi-second freeze on the first take-off and the first shot. Measured by
     * diffing three's own program cache keys across the two: the keys are identical except
     * for the light-count field, `1,10` before and `1,12` after. Not the plume shader, not
     * the bolt shader — the ENTIRE SCENE recompiling because two point lights appeared.
     *
     * So these lights are visible from construction to the end of the game and are turned
     * off by setting `intensity = 0`. A zero-intensity light still costs a little in every
     * fragment shader; paying that constantly is far cheaper than a recompile storm at the
     * exact moment the player first does something interesting. */
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(REPULSOR.light, 0, 30, 2);
      this.root.add(l);
      this.lights.push(l);
    }
    this.live = [];
    // Fast enough to outrun the suit at its 290 m/s top speed — a bolt you can overtake is
    // a bolt that ends up behind you — and slow enough that the flight across a street is
    // something you watch. 380 m/s puts a 300 m shot four fifths of a second out.
    this.speed = 380;
    this.maxLife = 3.2;
  }

  _take() {
    for (const p of this.pool) if (!p.live) return p;
    const oldest = this.live.shift();
    if (oldest) { oldest.live = false; oldest.g.visible = false; }
    return oldest;
  }

  fire(origin, dir, opts = {}) {
    const p = this._take();
    if (!p) return null;
    p.live = true;
    p.pos = origin.clone();
    p.dir = dir.clone().normalize();
    p.speed = opts.speed || this.speed;
    p.power = opts.power ?? 1;
    p.age = 0;
    p.hand = opts.hand || 'R';
    p.g.visible = true;
    p.g.position.copy(p.pos);
    p.s = 0.75 + p.power * 0.35;
    // The streak is the speed. At 380 m/s the bolt crosses three metres between physics
    // ticks, so a one-metre bullet is a dot that teleports; a five-metre tail behind a hot
    // head is what a repulsor bolt looks like in the film.
    p.tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.dir);
    this._size(p, 1);
    this.live.push(p);
    return p;
  }

  // Everything about a bolt is sized in world units, so a shot 400 m out shrinks to a pixel
  // and vanishes — the same failure as an additive effect over a bright sea, arrived at from
  // the other direction. So the visual grows with distance to hold a floor on how small it
  // can get on screen, while the near-field size stays honest.
  _size(p, dist) {
    const cam = this.ctx.camera;
    const d = cam ? Math.max(1, cam.position.distanceTo(p.pos)) : dist;
    const k = p.s * Math.max(1, d * 0.012);
    // World-sized, so these are metres. A bolt whose halo is nearly three metres across is
    // a beach ball when it leaves the palm half a metre from the lens; a metre and a half
    // still reads as a light at four hundred, which is what the distance floor above is for.
    p.core.scale.setScalar(0.10 * k);
    p.inner.scale.setScalar(0.22 * k);
    p.bloom.scale.setScalar(1.45 * k);
    p.tail.scale.set(k, 4.6 * k, k);
    p.tail.position.copy(p.dir).multiplyScalar(-2.3 * k);
  }

  _kill(p) {
    p.live = false;
    p.g.visible = false;
    const i = this.live.indexOf(p);
    if (i >= 0) this.live.splice(i, 1);
  }

  update(dt) {
    const ctx = this.ctx;
    const phys = ctx.physics;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const travel = p.speed * dt;

      let hit = null;
      if (phys && phys.ready) {
        const h = phys.raycast(p.pos, p.dir, travel + 0.3, null);
        if (h) hit = { point: h.point, normal: h.normal, material: h.material, rec: h.rec };
      }
      const next = p.pos.clone().addScaledVector(p.dir, travel);
      // ground / sea, which may have no collider at all
      if (!hit && ctx.world && ctx.world.surfaceHeight) {
        const gy = ctx.world.surfaceHeight(next.x, next.z);
        if (Number.isFinite(gy) && next.y <= gy) {
          const t = (p.pos.y - gy) / Math.max(1e-4, p.pos.y - next.y);
          const point = p.pos.clone().lerp(next, Math.max(0, Math.min(1, t)));
          point.y = gy;
          const sea = ctx.world.seaLevel;
          hit = {
            point,
            normal: new THREE.Vector3(0, 1, 0),
            material: (Number.isFinite(sea) && gy <= sea + 0.25) ? 'water' : 'ground',
            rec: null,
          };
        }
      }

      if (hit) {
        this._impact(p, hit);
        this._kill(p);
        continue;
      }

      p.pos.copy(next);
      p.g.position.copy(p.pos);
      this._size(p, travel);
      if (p.age > this.maxLife) this._kill(p);
    }

    // lights follow the three newest bolts
    for (let i = 0; i < this.lights.length; i++) {
      const p = this.live[this.live.length - 1 - i];
      const l = this.lights[i];
      if (!p) { l.intensity = 0; continue; }   // intensity, not visible: see the constructor
      l.position.copy(p.pos);
      l.intensity = 22 * p.power;
    }
  }

  _impact(p, hit) {
    const ctx = this.ctx;
    const force = 1.0 * p.power;
    this.vfx.impact(hit.point, hit.normal, hit.material, 1.1 * p.power);
    ctx.bus.emit('repulsor:hit', {
      point: hit.point.clone(),
      normal: hit.normal.clone(),
      force,
      material: hit.material,
      hand: p.hand,
    });
    if (ctx.destruction && ctx.destruction.breakAt) {
      ctx.destruction.breakAt(hit.point, force, {
        normal: hit.normal,
        direction: p.dir.clone(),
        material: hit.material,
        rec: hit.rec,
        source: 'repulsor',
      });
    }
  }
}
