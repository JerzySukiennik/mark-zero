// The flight trail. Owned by task `flight`, built and driven from thrustfx.js.
//
// WHAT THIS REPLACED, AND WHY.
//
// The trail used to be two ribbons: a quad chain streaming off the boots, vertex-alpha
// faded, 0.55 s long. Two things were wrong with it, both of them Jurek's words.
//
//   "nie widac bo on jest jakby pod mapa" — a ribbon is a surface, and a surface seen
//   edge-on is a line one pixel wide. Flying level, the trail streams out directly behind
//   the suit, which is exactly the angle at which a ribbon disappears. It was there the
//   whole time; you just cannot see a sheet of paper from its edge.
//
//   "nie plomieniem gradientowym tylko powinno zostawac troche w tle jakby byc takim dymem
//   ktory zostaje i zeby bylo widac gdzie sie lecialo wczesniej" — 0.55 s of ribbon shows
//   where you are, not where you have been. The point of a trail is the shape of the flight
//   still hanging in the air after the suit has gone.
//
// So: puffs, not a ribbon. Round sprites have no edge to be seen from, they linger for
// seconds instead of half of one, and they drift and swell the way exhaust actually does.
// A minute of hard flying leaves a readable line across the sky.
//
// Cost: one draw call, one geometry, no allocation after construction. The pool is a ring
// buffer — the oldest puff is reused when it runs out, so the system can never grow and
// never garbage-collects mid-flight.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export const SMOKE = {
  /* These are sized from a render, not from taste. The first cut (7 m puffs at ~0.4 alpha)
   * came back as a line of two-pixel specks a hundred metres out — legible only if you
   * already knew where to look. Exhaust from a thing doing 300 m/s is a rope you can see
   * from the far side of the map, so the puffs are twice the size and half again as opaque. */
  count: 1100,         // pool size; at the spacing below this is ~5 s of hard flying
  life: 6.5,           // seconds a puff lives — this IS "where I flew a moment ago"
  /* SPACING, NOT RATE. A fixed puffs-per-second leaves a dotted line at speed and a solid
   * blob at a hover: at 300 m/s and 40 puffs a second the gap between puffs is seven metres
   * and each one is barely two across, which rendered as a row of separate dots rather than
   * a trail. Emitting one puff every N METRES TRAVELLED instead makes the rope the same
   * density however fast you are going, which is what the eye reads as speed. */
  spacing: 2.6,        // metres between puffs along the flight path
  rateMin: 2,          // puffs/s at a standstill. A hover leaves a wisp, not a cloud:
                       // at 10 the suit wrapped itself in its own exhaust while parked.
  rateMax: 120,         // ceiling, so the pool cannot be burned through in a second
  size0: 2.2,          // metres across at birth, right out of the thruster
  size1: 10.0,         // metres across at death, having spread
  rise: 1.1,           // m/s of buoyancy, so the trail drifts up and reads as smoke
  drag: 0.82,          // per second: inherited speed bleeds off fast, the puff stays put
};

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // Soft and slightly off-centre-weighted, so a cloud of these does not read as a grid of
  // identical dots. Pure white: the colour comes from the shader, per puff, per age.
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  rg.addColorStop(0.70, 'rgba(255,255,255,0.10)');
  rg.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SmokeTrail {
  constructor(ctx) {
    this.ctx = ctx;
    this.n = SMOKE.count;
    this.next = 0;
    this.emitAcc = [0, 0];

    const pos = new Float32Array(this.n * 3);
    const vel = new Float32Array(this.n * 3);
    const age = new Float32Array(this.n);
    const seed = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { age[i] = -1; seed[i] = Math.random(); }
    this.pos = pos; this.vel = vel; this.age = age;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // never culled

    /* A puff is HOT at birth and cold a moment later — the first tenth of a second out of a
     * repulsor is still flame, and only then is it smoke. Doing that in the shader means the
     * exhaust and the trail are the same object, so there is no seam between them. */
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uLife: { value: SMOKE.life },
        uSize0: { value: SMOKE.size0 },
        uSize1: { value: SMOKE.size1 },
        uMap: { value: puffTexture() },
        uHot: { value: new THREE.Color(0xffb257) },
        uCold: { value: new THREE.Color(0xc9ced6) },   // light: it has to read against dark ground too
        uScale: { value: 600 },
      },
      vertexShader: `
        attribute float aAge; attribute float aSeed;
        uniform float uLife, uSize0, uSize1, uScale;
        varying float vT; varying float vSeed; varying float vNear;
        void main(){
          vT = aAge / uLife; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Grows along a curve, not linearly: exhaust spreads fast then settles.
          // Slower to swell than it was: at pow(0.38) a puff was already several metres wide a
          // few metres behind the boots, and the chase camera looked at a white ball with a
          // suit somewhere inside it. The trail has to be something you see BEHIND you.
          float s = mix(uSize0, uSize1, pow(clamp(vT, 0.0, 1.0), 0.62));
          // How close the camera is to this puff, 0 when inside it, 1 well clear.
          // Clear well past the third-person camera (about 9 m back), not just past the visor.
          vNear = clamp((-mv.z - 3.0) / 22.0, 0.0, 1.0);
          gl_PointSize = s * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uHot, uCold;
        varying float vT; varying float vSeed; varying float vNear;
        void main(){
          if (vT < 0.0 || vT > 1.0) discard;
          float tex = texture2D(uMap, gl_PointCoord).a;
          // Hot for the first fraction of the life, then plain smoke.
          vec3 col = mix(uHot, uCold, smoothstep(0.0, 0.10, vT));
          // In and out: a puff appears over the first blink and thins out over the rest.
          float a = smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
          a *= tex * (0.62 + 0.26 * vSeed);
          /* SOFT AGAINST THE CAMERA. A puff grows to fifteen metres, so in first person you
           * fly straight through your own exhaust and it paints the whole screen white — a
           * hover turned the visor into fog. Fading what the camera is inside of costs one
           * multiply and means the trail is something you see, never something you are in. */
          a *= vNear;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,        // smoke never occludes; it is a hundred overlapping sprites
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
      fog: false,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.name = 'THRUST_SMOKE';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;                 // under the plumes, over the world
    ctx.scene.add(this.points);
    this._geo = g;
  }

  /** Put one puff into the pool at `p`, carrying `v` (m/s) plus a little scatter. */
  emit(p, v, spread = 1.4) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const o = i * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
    this.vel[o] = v.x * 0.35 + (Math.random() - 0.5) * spread;
    this.vel[o + 1] = v.y * 0.35 + (Math.random() - 0.5) * spread;
    this.vel[o + 2] = v.z * 0.35 + (Math.random() - 0.5) * spread;
    this.age[i] = 0;
  }

  /**
   * Spawn from a boot. `level` is that thruster's 0..1 output, `speed` the airframe's.
   * Rate-based rather than one-per-frame, so the trail is the same density at 12 fps as at
   * 120 — a frame-rate-dependent trail is a trail that vanishes exactly when the machine is
   * struggling and the player is most likely to be looking at it.
   */
  emitFrom(idx, p, v, level, dt, speed = 0) {
    if (level <= 0.02) return;
    const rate = Math.min(SMOKE.rateMax, SMOKE.rateMin + speed / SMOKE.spacing);
    this.emitAcc[idx] = (this.emitAcc[idx] || 0) + dt * rate * level;
    let k = 0;
    while (this.emitAcc[idx] >= 1 && k < 16) { this.emitAcc[idx] -= 1; this.emit(p, v); k++; }
  }

  update(dt) {
    const { pos, vel, age } = this;
    const decay = Math.exp(-dt / SMOKE.drag);
    let live = false;
    for (let i = 0; i < this.n; i++) {
      const a = age[i];
      if (a < 0) continue;
      if (a > SMOKE.life) { age[i] = -1; continue; }
      live = true;
      age[i] = a + dt;
      const o = i * 3;
      vel[o] *= decay; vel[o + 1] *= decay; vel[o + 2] *= decay;
      vel[o + 1] += SMOKE.rise * dt;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
    }
    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.aAge.needsUpdate = true;
    this.points.visible = live;
    // gl_PointSize is in pixels, so a puff has to be told how big the window is or the
    // trail is twice the size on a laptop and half of it on a monitor.
    const h = this.ctx.renderer ? this.ctx.renderer.domElement.height : 600;
    this.material.uniforms.uScale.value = h * 1.15;
  }

  clear() { for (let i = 0; i < this.n; i++) this.age[i] = -1; this.points.visible = false; }
}
