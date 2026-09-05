// What the thrusters look like. Owned by task `flight`, driven from flight.js's update.
//
// This file exists because the armour flew with NOTHING coming out of it. The rig has had
// four correctly-oriented emitter pivots since the first model landed — piv_thrusterL/R in
// the boots, piv_palmL/R in the gauntlets, each with its local -Y pointing out of the hole
// (verified in rig.js's emitterAxes report) — and not one line of code ever drew into them.
// Flight was a man in a suit sliding through the air in silence.
//
// Three layers, in the order they read on screen:
//
//   PLUME   a cone hanging off the emitter, length driven by that emitter's share of the
//           thrust. White-hot at the throat, magenta at the mouth. Additive, never tone
//           mapped, exactly like every other emissive in the game (see combat/vfx.js).
//   GLOW    a camera-facing sprite at the throat, so the source is a blown-out point from
//           any angle and not a cone seen edge-on as a line.
//   TRAIL   the flight line. Two ribbons streaming off the boots, born only above
//           40 m/s and thickening with speed. This is the "linia lotu" — the thing that
//           makes 300 m/s look like 300 m/s instead of a static pose on a moving camera.
//
// Budget, because a 4 GB laptop is a target: 4 cones, 4 sprites, 2 point lights and 2
// ribbons of 48 segments. Everything is allocated once and re-pointed; the update loop
// makes no garbage.
import * as THREE from 'three';
import { REPULSOR, glowMaterial, glowSprite } from '../combat/vfx.js';

const TRAIL_SEG = 48;
const TRAIL_LIFE = 0.55;        // seconds of ribbon behind you
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Emitters, and how much of the airframe's thrust each one is showing. Boots carry the
// lift; palms are the stabilisers and only light up hard when you are braking or firing.
const EMITTERS = [
  { pivot: 'piv_thrusterL', radius: 0.055, boot: true },
  { pivot: 'piv_thrusterR', radius: 0.055, boot: true },
  { pivot: 'piv_palmL', radius: 0.036, boot: false },
  { pivot: 'piv_palmR', radius: 0.036, boot: false },
];

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0.0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.25, 'rgba(255,235,252,0.75)');
  rg.addColorStop(0.6, 'rgba(255,79,196,0.22)');
  rg.addColorStop(1.0, 'rgba(255,79,196,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ThrustFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'THRUST_FX';
    ctx.scene.add(this.root);

    this.tex = softDot();

    // A cone whose apex is at the origin and whose axis runs down local -Y, so it can be
    // parented straight onto an emitter pivot and point the right way with no extra
    // rotation. THREE's cone is centred on its own middle and points +Y, hence both.
    this.coneGeo = new THREE.ConeGeometry(1, 1, 16, 1, true);
    this.coneGeo.translate(0, -0.5, 0);
    this.coneGeo.rotateX(Math.PI);

    this.mCore = glowMaterial(REPULSOR.core, { additive: true, opacity: 0.60, side: THREE.DoubleSide });
    this.mBloom = glowMaterial(REPULSOR.bloom, { additive: true, opacity: 0.32, side: THREE.DoubleSide });

    this.emitters = [];
    this.attachedTo = null;

    // Two point lights, one per boot. The palms borrow the nearer of the two rather than
    // owning lights of their own: four dynamic lights on the player is four extra shader
    // permutations for every material in the scene, and the renderer compiles light count
    // into each one (see engine/renderer.js).
    this.lights = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(REPULSOR.light, 0, 9, 2);
      l.name = 'thrust_light_' + i;
      this.root.add(l);
      this.lights.push(l);
    }

    this.trails = [this._makeTrail(), this._makeTrail()];
  }

  // ---- ribbons ------------------------------------------------------------------------
  _makeTrail() {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(TRAIL_SEG * 2 * 3);
    const alpha = new Float32Array(TRAIL_SEG * 2);
    const idx = [];
    for (let i = 0; i < TRAIL_SEG - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    g.setIndex(idx);
    g.setDrawRange(0, 0);

    // A vertex-alpha ribbon. MeshBasicMaterial has no per-vertex opacity, and faking the
    // fade by shrinking the ribbon gives you a hard-ended stick hanging off the boot.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xfff0fb) } },
      vertexShader: `
        attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){ gl_FragColor = vec4(uColor, vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.root.add(mesh);
    return { mesh, pos, alpha, pts: [], n: 0 };
  }

  _pushTrail(t, p, width, dt) {
    t.pts.unshift({ x: p.x, y: p.y, z: p.z, t: 0, w: width });
    for (const q of t.pts) q.t += dt;
    while (t.pts.length > TRAIL_SEG) t.pts.pop();
    while (t.pts.length && t.pts[t.pts.length - 1].t > TRAIL_LIFE) t.pts.pop();
  }

  _writeTrail(t, camPos) {
    const n = t.pts.length;
    if (n < 2) { t.mesh.geometry.setDrawRange(0, 0); return; }
    for (let i = 0; i < n; i++) {
      const a = t.pts[i];
      const b = t.pts[Math.min(i + 1, n - 1)];
      // Ribbon width runs across the tangent and the eye, so it faces the camera without
      // being a sprite: a billboarded quad chain would twist at every turn.
      _v.set(b.x - a.x, b.y - a.y, b.z - a.z);
      if (_v.lengthSq() < 1e-9) _v.set(0, 0, 1);
      _v2.set(a.x - camPos.x, a.y - camPos.y, a.z - camPos.z);
      _v3.crossVectors(_v, _v2).normalize();
      const fade = Math.max(0, 1 - a.t / TRAIL_LIFE);
      const w = a.w * fade * 0.5;
      const o = i * 6;
      t.pos[o] = a.x + _v3.x * w; t.pos[o + 1] = a.y + _v3.y * w; t.pos[o + 2] = a.z + _v3.z * w;
      t.pos[o + 3] = a.x - _v3.x * w; t.pos[o + 4] = a.y - _v3.y * w; t.pos[o + 5] = a.z - _v3.z * w;
      t.alpha[i * 2] = t.alpha[i * 2 + 1] = fade * fade * 0.65;
    }
    t.mesh.geometry.attributes.position.needsUpdate = true;
    t.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    t.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }

  // ---- plumes -------------------------------------------------------------------------
  // Re-parent onto whatever rig is worn now. Called whenever the suit changes: the pivots
  // are new objects every time an armour loads, and a plume left on a disposed rig is a
  // plume that never appears again.
  attach(rig) {
    for (const e of this.emitters) {
      if (e.core.parent) e.core.parent.remove(e.core);
      if (e.bloom.parent) e.bloom.parent.remove(e.bloom);
      if (e.glow.parent) e.glow.parent.remove(e.glow);
    }
    this.emitters.length = 0;
    this.attachedTo = rig || null;
    if (!rig || !rig.pivots) return;
    for (const spec of EMITTERS) {
      const piv = rig.pivots[spec.pivot];
      if (!piv) continue;
      const core = new THREE.Mesh(this.coneGeo, this.mCore);
      const bloom = new THREE.Mesh(this.coneGeo, this.mBloom);
      const glow = glowSprite(this.tex, REPULSOR.core, 1);
      for (const o of [core, bloom, glow]) { o.frustumCulled = false; o.renderOrder = 2; piv.add(o); }
      this.emitters.push({ ...spec, node: piv, core, bloom, glow, level: 0 });
    }
  }

  /**
   * @param dt      seconds
   * @param model   the airframe (velocity, speed, thrustMag, grounded)
   * @param cmd     this frame's command struct
   * @param ctx     for the suit rig and the camera
   */
  update(dt, model, cmd, ctx) {
    const suit = ctx.suit;
    const rig = suit && suit.rig;
    if (rig !== this.attachedTo) this.attach(rig);
    const on = !!(ctx.state.mode === 'flight' && rig);
    this.root.visible = on;
    if (!on) {
      for (const e of this.emitters) { e.core.visible = e.bloom.visible = e.glow.visible = false; }
      for (const l of this.lights) l.intensity = 0;
      for (const t of this.trails) { t.pts.length = 0; t.mesh.geometry.setDrawRange(0, 0); }
      return;
    }

    // How hard is each hole burning. The boots carry the airframe; the palms come alive on
    // the brake and on the trigger, which is what makes a flip-and-burn read as a stop and
    // not as a man drifting backwards.
    const thrust = Math.min(1, model.thrustMag !== undefined ? model.thrustMag : 0);
    const retro = Math.max(0, -(cmd.forward || 0));
    const fire = cmd.fire ? 1 : 0;
    const bootLevel = Math.min(1.25, thrust * 0.9 + (model.grounded ? 0 : 0.22));
    const palmLevel = Math.min(1.25, thrust * 0.25 + retro * 1.0 + fire * 0.9 + 0.06);

    for (const e of this.emitters) {
      const want = e.boot ? bootLevel : palmLevel;
      // A little jitter, and a fast attack with a slow release: a repulsor that decays as
      // fast as it lights up flickers like a fault light.
      const k = want > e.level ? 1 - Math.exp(-dt / 0.035) : 1 - Math.exp(-dt / 0.13);
      e.level += (want - e.level) * k;
      const lvl = e.level * (0.92 + 0.16 * Math.sin(this.ctx.time * 47 + e.radius * 900));
      const vis = lvl > 0.02;
      e.core.visible = e.bloom.visible = e.glow.visible = vis;
      if (!vis) continue;
      const len = 0.10 + lvl * (e.boot ? 1.25 : 0.55);
      e.core.scale.set(e.radius * 0.62, len * 0.55, e.radius * 0.62);
      e.bloom.scale.set(e.radius * 1.55, len, e.radius * 1.55);
      // HALF the first pass, on both size and opacity. Additive white over a lit ocean has
      // no way to be subtle: at 5.2-10.2 radii and full opacity the four glows merged into
      // one blown-out streak from the chest to the hips and the armour vanished inside it
      // (shots/fix/6_cruise_env.png against 8_nofx.png, same frame with the plumes off —
      // red and gold in one, a white smear in the other). The cones carry the shape; the
      // sprite is only there so the source is a point and not a line seen edge-on.
      e.glow.scale.setScalar(e.radius * (2.4 + lvl * 2.4));
      e.glow.material.opacity = Math.min(1, 0.16 + lvl * 0.34);
      e.core.material.opacity = Math.min(1, 0.30 + lvl * 0.30);
    }

    // Lights: one per boot, following the real emitter, brightness from that boot's level.
    for (let i = 0; i < 2; i++) {
      const e = this.emitters[i];
      const l = this.lights[i];
      if (!e) { l.intensity = 0; continue; }
      e.node.getWorldPosition(_v);
      l.position.copy(_v);
      l.intensity = e.level * 11;
    }

    // Trails. Born at 40 m/s so hovering around the workshop is clean, full width by 55%
    // of top speed. Fed from the boots' real world position, which means they swing with
    // the pose and cross over each other in a hard roll.
    const sp = model.speed || 0;
    const f = Math.min(1, Math.max(0, (sp - 40) / (model.spec.topSpeed * 0.55 - 40)));
    const cam = ctx.camera.position;
    for (let i = 0; i < 2; i++) {
      const t = this.trails[i];
      const e = this.emitters[i];
      if (f <= 0.001 || !e) { if (t.pts.length) t.pts.length = 0; t.mesh.geometry.setDrawRange(0, 0); continue; }
      e.node.getWorldPosition(_v);
      this._pushTrail(t, _v, 0.13 + f * 0.42, dt);
      this._writeTrail(t, cam);
    }
  }
}
