// Repulsor and impact visual effects. Owned by task `combat`.
//
// ONE RULE, learned by losing a whole shot to it: every emissive material in this file is
// `toneMapped: false` with its blending set EXPLICITLY. ACES tone mapping pulls a plain
// additive sprite down into the ocean's brightness and the shot disappears. Untone-mapped
// values above 1.0 clip to white, cross the bloom threshold in renderer.js, and read as the
// blown-out white core wrapped in pink-magenta that the reference frames show
// (flight/mk3_lifting_car_night.jpg: white-hot palm, magenta wash on the asphalt under it).
//
// Colour law for the repulsor, taken from those frames:
//   core   #ffffff   pure white, opaque, small
//   inner  #ffd9f4   white going pink
//   bloom  #ff4fc4   pink-magenta, additive, big and soft
//   light  #ff67cf   the point light that puts that magenta on the gauntlet underside
import * as THREE from 'three';
import { rng } from './fracture.js';

/* WHITE-HOT GOING ORANGE, not pink.
 *
 * This was the MCU repulsor palette — a white core wrapped in magenta — taken off the
 * night frames where the light on the asphalt really is pink. On a lit stage in daylight
 * it reads as neither fire nor light: Jurek's words were that the plumes are "purple,
 * flat, and see-through like Roblox trails". What he asked for, and what a rocket actually
 * looks like from a metre away, is the top of a flame: white at the throat where it is
 * hottest, running to orange as it cools along its length.
 *
 * The gradient is the point. One flat colour cannot be fire whatever colour it is. */
export const REPULSOR = {
  core: 0xffffff,      // the throat, blown out
  inner: 0xffe6b8,     // white going warm
  bloom: 0xff8a24,     // the body of the flame
  tail: 0xd63c05,      // where it cools out
  light: 0xffa040,
};

export function glowMaterial(color, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    toneMapped: false,                                   // never let ACES eat the shot
    transparent: opts.opacity !== undefined || opts.additive !== false,
    opacity: opts.opacity ?? 1,
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: opts.depthWrite ?? false,
    depthTest: opts.depthTest ?? true,
    side: opts.side ?? THREE.FrontSide,
    // Lets a mesh carry its own gradient. A flame is not one colour, and the cheapest way
    // to say so is to bake white-at-the-throat / orange-at-the-mouth into the geometry
    // rather than to stack ever more single-colour cones on top of each other.
    vertexColors: opts.vertexColors === true,
    fog: false,
  });
}

/**
 * A glow is a FALLOFF, not a coloured ball. A MeshBasicMaterial sphere renders as a flat
 * disc of one colour — put one over a window and you get a magenta sticker, which is
 * exactly what the first pass of this looked like. Every soft glow in the game is this: a
 * camera-facing sprite with a radial gradient, additive, and never tone mapped.
 */
export function glowSprite(texture, color, opacity = 1) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    toneMapped: false, fog: false, sizeAttenuation: true,
  }));
}

function softDot(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.35, inner);
  rg.addColorStop(1, outer);
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The bloom profile taken off the reference frames: a blown-out white centre that holds
// for about a tenth of the radius, then a long soft magenta shoulder out to nothing. A
// linear gradient gives a hard-edged disc; this does not.
function radialGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  // The long faint shoulder this used to have is a trap. Three and a half per cent alpha
  // is invisible against a dark room and a MILKY WHITE DISC WITH A HARD RIM against a lit
  // ocean — additive blending has no way to be subtle over a bright background, so the
  // veil either shows or it does not, and the edge of the veil is where it stops showing.
  // The answer is not a longer gradient, it is a shorter one: a hot core, a fast shoulder,
  // and nothing at all past two thirds of the radius.
  rg.addColorStop(0.00, 'rgba(255,255,255,1)');
  rg.addColorStop(0.07, 'rgba(255,255,255,0.95)');
  rg.addColorStop(0.18, 'rgba(255,255,255,0.52)');
  rg.addColorStop(0.34, 'rgba(255,255,255,0.19)');
  rg.addColorStop(0.52, 'rgba(255,255,255,0.055)');
  rg.addColorStop(0.70, 'rgba(255,255,255,0.012)');
  rg.addColorStop(0.86, 'rgba(255,255,255,0)');
  rg.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class VFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'COMBAT_VFX';
    ctx.scene.add(this.root);

    this.dotTex = softDot();
    this.dustTex = softDot('rgba(210,203,190,0.85)', 'rgba(210,203,190,0)');
    this.glowTex = radialGlow();

    // Materials are shared. A hundred sparks must not be a hundred materials.
    this.mFlashCore = glowMaterial(REPULSOR.core, { additive: true });
    this.mFlashBloom = glowMaterial(REPULSOR.bloom, { additive: true, opacity: 0.85 });
    this.mSpark = glowMaterial(0xffd2a0, { additive: true });
    this.mGlassGlint = glowMaterial(0xdff2ff, { additive: true, opacity: 0.9 });
    // Sea water thrown up by a bolt is lit, not glowing: normal blending, tone mapped with
    // the rest of the ocean, or the spray reads as a second repulsor going off.
    this.mSplash = new THREE.MeshBasicMaterial({
      color: 0xeef8ff, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.NormalBlending, fog: false, side: THREE.DoubleSide,
    });

    // Small on screen by design (see below), but a flash half a metre from the lens is
    // still a hundred pixels across, and at twelve segments that is a visible DECAGON.
    this.sphere = new THREE.SphereGeometry(1, 24, 16);
    // A thin hoop. The first version was 0.55–1.0, which at impact scale is not a shock
    // ring at all — it is a filled magenta disc with a hole in it pasted over the window.
    this.ring = new THREE.RingGeometry(0.90, 1, 40);
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.sharedGeo = new Set([this.sphere, this.ring, this.quad]);

    // Point lights are expensive; a small pool, oldest reused first.
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
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(REPULSOR.light, 0, 15, 2);
      this.root.add(l);
      this.lights.push({ light: l, t: 0, life: 0, base: 0, order: i });
    }
    this._lightCursor = 0;

    this.items = [];      // transient meshes with their own tiny animation
    this.dust = [];
    // Seeded, not Math.random(): MZ.sim(600) has to produce the same frame twice, and a
    // spark shower that reshuffles every replay would make a side-by-side comparison
    // against a reference frame impossible to reproduce.
    this.rand = rng(0x1EAD5EED);
    this.maxItems = 340;  // hard ceiling on live transients, so a shattered street cannot
                          // turn into a thousand animated quads
  }

  get busy() { return this.items.length > this.maxItems; }
  get _r() { return this.rand(); }

  // A flash worth of light at a point. Used by the muzzle and by every impact, because in
  // the reference the repulsor is always the light source, never a decal.
  flashLight(pos, intensity, life, color = REPULSOR.light) {
    const slot = this.lights[this._lightCursor++ % this.lights.length];
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.light.intensity = intensity;      // never `visible` — see the note in the constructor
    slot.base = intensity;
    slot.t = 0; slot.life = life;
    return slot;
  }

  // Transient meshes get their OWN material instance: several flashes are alive at once
  // and each fades on its own clock, so a shared material would make them flicker together.
  // Geometry is shared where it can be; anything one-off is disposed on removal.
  _add(mesh, life, anim, cloneMat = true) {
    mesh.frustumCulled = false;
    if (cloneMat && mesh.material && !mesh.isLineSegments && !mesh.isSprite) {
      mesh.material = mesh.material.clone();
    }
    this.root.add(mesh);
    this.items.push({ mesh, t: 0, life, anim });
    return mesh;
  }

  /** Muzzle flash at the palm emitter, thrown ALONG the emitter axis, not a ball on it. */
  muzzle(pos, dir, power = 1) {
    // A flash sized for a palm held at arm's length fills the whole frame when the emitter
    // ends up half a metre off the lens — which is exactly where it is in first person, or
    // in the no-suit fallback. So the flash shrinks as it approaches the near plane instead
    // of washing the screen pink.
    const cam = this.ctx.camera;
    const d = cam ? cam.position.distanceTo(pos) : 2;
    const near = Math.max(0.18, Math.min(1, (d - 0.12) / 0.75));
    const s = power * near;
    if (near < 0.02) return;

    // The core is the HARD WHITE CENTRE and nothing else. Letting it swell to a quarter of
    // a metre made it a milky white polygon pasted over the gauntlet — a solid additive
    // ball has no falloff, so as it grows it stops being a light and becomes a decal. All
    // the size lives in the sprite below, which has a real falloff; the core stays small
    // and goes out fast.
    const core = new THREE.Mesh(this.sphere, this.mFlashCore);
    core.position.copy(pos);
    core.scale.setScalar(0.05 * s);
    this._add(core, 0.075, (m, k) => {
      m.scale.setScalar(0.05 * s * (1 + k * 0.9));
      m.material.opacity = (1 - k) * (1 - k);
    });

    const bloom = glowSprite(this.glowTex, REPULSOR.bloom, 0.9);
    bloom.position.copy(pos).addScaledVector(dir, 0.05);
    this._add(bloom, 0.14, (m, k) => {
      m.scale.setScalar(0.46 * s * (1 + k * 1.5));
      m.material.opacity = 0.62 * near * (1 - k) * (1 - k);
    }, false);

    // the cone of light thrown forward out of the palm
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.075 * s, 0.34 * s, 12, 1, true),
      this.mFlashBloom
    );
    cone.position.copy(pos).addScaledVector(dir, 0.17 * s);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this._add(cone, 0.1, (m, k) => {
      m.scale.setScalar(1 + k * 0.7);
      m.material.opacity = 0.85 * near * (1 - k);
    });

    // The light is the part that must NOT shrink: it is what puts the magenta on the
    // underside of the gauntlet and the forearm, which is the shot in the reference frames.
    this.flashLight(pos.clone().addScaledVector(dir, 0.12), 22 * power, 0.12);
  }

  /** Impact: white core, magenta bloom, a light on the surface, sparks, dust. */
  impact(point, normal, material = 'concrete', force = 1) {
    const f = Math.max(0.4, Math.min(2.2, force));
    const core = new THREE.Mesh(this.sphere, this.mFlashCore);
    core.position.copy(point).addScaledVector(normal, 0.05);
    this._add(core, 0.1, (m, k) => {
      m.scale.setScalar(0.09 * f * (1 + k * 1.2));
      m.material.opacity = (1 - k) * (1 - k);
    });
    const bloom = glowSprite(this.glowTex, REPULSOR.bloom, 0.9);
    bloom.position.copy(core.position);
    this._add(bloom, 0.24, (m, k) => {
      m.scale.setScalar(1.15 * f * (1 + k * 2.2));
      m.material.opacity = 0.9 * (1 - k) * (1 - k);
    }, false);
    // the white heart of it, which is what actually crosses the bloom threshold
    const heart = glowSprite(this.glowTex, 0xffffff, 1);
    heart.position.copy(core.position);
    this._add(heart, 0.14, (m, k) => {
      m.scale.setScalar(0.42 * f * (1 + k * 1.7));
      m.material.opacity = 1 - k;
    }, false);
    // shock ring lying on the surface
    const ring = new THREE.Mesh(this.ring, this.mFlashBloom);
    ring.position.copy(point).addScaledVector(normal, 0.02);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this._add(ring, 0.26, (m, k) => {
      m.scale.setScalar(0.2 + k * 1.9 * f);
      m.material.opacity = 0.5 * (1 - k) * (1 - k);
    });
    this.flashLight(point.clone().addScaledVector(normal, 0.5), 26 * f, 0.2);

    if (this.busy) return;   // budget: a shattered street gets the flash, not the confetti

    const water = material === 'water';
    const sparkMat = water ? this.mSplash
      : (material === 'glass' ? this.mGlassGlint : this.mSpark);
    const n = water ? 18 : (material === 'glass' ? 14 : 10);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(this.quad, sparkMat);
      s.position.copy(point);
      const spread = water ? 0.9 : 1.6;
      const d = new THREE.Vector3(
        normal.x + (this._r - 0.5) * spread,
        normal.y + (this._r - 0.5) * spread + (water ? 1.1 : 0.35),
        normal.z + (this._r - 0.5) * spread
      ).normalize().multiplyScalar((water ? 6 : 4) + this._r * 9 * f);
      const life = (water ? 0.5 : 0.3) + this._r * 0.35;
      s.userData.v = d;
      this._add(s, life, (m, k, dt) => {
        m.userData.v.y -= 22 * dt;
        m.position.addScaledVector(m.userData.v, dt);
        const len = Math.min(0.5, m.userData.v.length() * 0.02);
        m.scale.set(0.02, len, 1);
        m.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), m.userData.v.clone().normalize()
        );
        m.material.opacity = 1 - k;
      });
    }

    if (material !== 'glass') {
      const dustColor = water ? 0xdff0f4
        : (material === 'pastry' ? 0xd9b98a
        : (material === 'metal' || material === 'steel' ? 0x9aa0a4 : 0xbdb5a6));
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.dustTex, transparent: true, opacity: water ? 0.75 : 0.5,
          depthWrite: false, toneMapped: true, blending: THREE.NormalBlending,
          color: dustColor,
        }));
        sp.position.copy(point).addScaledVector(normal, 0.1)
          .add(new THREE.Vector3((this._r - 0.5) * 0.8, (this._r - 0.5) * 0.8,
                                 (this._r - 0.5) * 0.8));
        sp.scale.setScalar(0.5 + this._r * f);
        const drift = new THREE.Vector3(
          (this._r - 0.5) * 2 + normal.x * 2,
          this._r * (water ? 3.2 : 1.6) + 0.4,
          (this._r - 0.5) * 2 + normal.z * 2
        );
        sp.userData.v = drift;
        this._add(sp, 1.4 + this._r, (m, k, dt) => {
          m.position.addScaledVector(m.userData.v, dt);
          m.userData.v.multiplyScalar(1 - dt * 1.4);
          m.scale.setScalar((0.5 + k * 2.4) * f);
          m.material.opacity = 0.5 * (1 - k) * (1 - k);
        });
      }
    }
  }

  /**
   * The crack front. Drawn on the surface of a pane the instant it is hit and held for a
   * beat before the shards separate, so the break reads as a fracture spreading, not as a
   * mesh being swapped for a pile.
   */
  cracks(positions, matrixWorld, life = 0.16) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({
      color: 0xeaf7ff, toneMapped: false, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const lines = new THREE.LineSegments(g, m);
    lines.applyMatrix4(matrixWorld);
    lines.matrixAutoUpdate = false;
    lines.updateMatrix();
    this._add(lines, life, (mesh, k) => {
      mesh.material.opacity = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
    });
    return lines;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.root.remove(it.mesh);
        if (it.mesh.geometry && !this.sharedGeo.has(it.mesh.geometry)) it.mesh.geometry.dispose();
        if (it.mesh.material) it.mesh.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      if (it.anim) it.anim(it.mesh, k, dt);
    }
    for (const s of this.lights) {
      if (s.light.intensity <= 0 && s.t >= s.life) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) { s.light.intensity = 0; continue; }
      s.light.intensity = s.base * (1 - k) * (1 - k);
    }
  }
}
