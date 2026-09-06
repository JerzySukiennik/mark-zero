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
//   PLUME   REMOVED. It was a cone per emitter, and a cone cannot be fire — see the note
//           in the update loop. The geometry and materials are still built (the warm-up and
//           the pooling reference them) but they never draw.
//   GLOW    a camera-facing sprite at the throat, so the source is a blown-out point from
//           any angle and not a cone seen edge-on as a line.
//   TRAIL   the flight line. Smoke off the boots that hangs in the air for seconds after
//           the suit has gone, so you can see where you flew. Lives in flight/smoke.js,
//           which also records why the ribbon this replaced was invisible in level flight.
//
// Budget, because a 4 GB laptop is a target: 4 cones, 4 sprites, 2 point lights and one
// 700-puff point cloud in a single draw call. Everything is allocated once and re-pointed;
// the update loop makes no garbage.
import * as THREE from 'three';
import { REPULSOR, glowMaterial, glowSprite } from '../combat/vfx.js';
import { SmokeTrail } from './smoke.js';

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
  rg.addColorStop(0.22, 'rgba(255,240,208,0.85)');
  rg.addColorStop(0.55, 'rgba(255,138,36,0.30)');
  rg.addColorStop(1.0, 'rgba(214,60,5,0)');
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

    /* THE GRADIENT.
     *
     * Both cones used to be one flat colour each — white inside magenta — and from a metre
     * away that reads as a purple plastic cone, which is exactly what Jurek called it. Real
     * exhaust is a temperature ramp: blinding white where it leaves the hole, orange a hand's
     * width later, dull red as it dies. So the cone carries the ramp in its vertices and both
     * materials just modulate it. Same draw calls, same triangles, completely different thing
     * on screen.
     *
     * The geometry runs apex (throat) at z=0 to mouth at z=+1 after the rotate above, so the
     * ramp keys off the position attribute's z. */
    {
      const pos = this.coneGeo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const hot = new THREE.Color(REPULSOR.core);
      const mid = new THREE.Color(REPULSOR.bloom);
      const cool = new THREE.Color(REPULSOR.tail);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, Math.max(0, pos.getZ(i)));   // 0 at the throat, 1 at the mouth
        if (t < 0.45) c.copy(hot).lerp(mid, t / 0.45);
        else c.copy(mid).lerp(cool, (t - 0.45) / 0.55);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      this.coneGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }

    // The core is the throat itself: short, fat, and blown right out, so there is a solid
    // white source rather than a see-through cone you can read the scenery through. The
    // bloom is the long soft body around it and carries most of the colour.
    this.mCore = glowMaterial(0xffffff, {
      additive: true, opacity: 0.95, side: THREE.DoubleSide, vertexColors: true,
    });
    this.mBloom = glowMaterial(0xffffff, {
      additive: true, opacity: 0.55, side: THREE.DoubleSide, vertexColors: true,
    });

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

    this.smoke = new SmokeTrail(ctx);

    /* THE MARK L's WING ARRAY.
     *
     * Jurek's reference for the nano suit is the one with two big angled thruster blades
     * standing off the shoulders, and he wants them to GROW out of the armour when he
     * holds the trigger — nanotech doing what nanotech is for. Only the Mk L has them;
     * the other four are plate armour and have nowhere to grow them from.
     *
     * Deliberately cheap: two blades and two plumes, built once when a Mk L is worn and
     * parented to the chest so they follow the pose for free. They are scaled from zero,
     * so when they are not out they cost one matrix each.
     */
    this.wings = [];
    this.wingOut = 0;
    // A blade: wide at the root, tapering back and out. Built pointing down -Z (the
    // suit's forward) and then swept back per side when it is placed.
    this.wingGeo = new THREE.BufferGeometry();
    {
      const v = new Float32Array([
        0, 0, 0,   0.05, 0.34, 0.30,   0.05, -0.16, 0.30,
        0.05, 0.34, 0.30,   0.02, 0.20, 1.15,   0.05, -0.16, 0.30,
        0.05, -0.16, 0.30,  0.02, 0.20, 1.15,   0.02, -0.04, 1.15,
      ]);
      this.wingGeo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      /* THE FLOW COORDINATE: 0 at the root where the array leaves the armour, 1 at the tip.
       * The dissolve below reveals the blade in this order, so the material appears to run
       * outward along the spar rather than the whole shape appearing at once. Same idea, and
       * deliberately the same look, as the nano wave in suit/nano.js. */
      const flow = new Float32Array(v.length / 3);
      let zMax = 0;
      for (let i = 0; i < v.length; i += 3) zMax = Math.max(zMax, v[i + 2]);
      for (let i = 0, k = 0; i < v.length; i += 3, k++) flow[k] = zMax > 0 ? v[i + 2] / zMax : 0;
      this.wingGeo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      this.wingGeo.computeVertexNormals();
    }
    /* THE ARRAY IS NANOTECH, SO IT DISSOLVES INTO EXISTENCE — IT DOES NOT UNFOLD.
     *
     * The first version grew the blade by scaling it, which Jurek saw straight through:
     * "te rzeczy powinny nie byc tak jakby SVG, tylko powinny sie ze stroju robic
     * nanotechnologia... nie mechanicznie, tylko ze sie tak topic jakby do stroju". A shape
     * that gets bigger is a shape that was already there; a shape that is being BUILT has a
     * front edge, and material behind that edge and nothing in front of it.
     *
     * So the blade is always full size and the fragment shader decides how much of it
     * exists yet, along the flow coordinate baked into the geometry above. At the front
     * there is a hot seam in the same cyan the suit's own nano wave uses (suit/nano.js), so
     * the two read as one technology. Retracting is the same edge running back in.
     *
     * `customProgramCacheKey` matters: without it three treats this as a fresh material
     * configuration and links another program, which is the exact thing that used to cause
     * the freeze on the first shot (see combat/vfx.js). */
    this.wingUniforms = {
      uGrow: { value: 0 },
      uSeam: { value: new THREE.Color(0x49e8ff) },
      uTime: { value: 0 },
    };
    this.mWing = new THREE.MeshStandardMaterial({
      color: 0x6d1620, metalness: 0.95, roughness: 0.28, side: THREE.DoubleSide,
      emissive: new THREE.Color(0x2a90ff), emissiveIntensity: 0,
    });
    this.mWing.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.wingUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFlow;\nvarying float vFlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform float uGrow;\nuniform float uTime;\nuniform vec3 uSeam;\nvarying float vFlow;\n' +
          'float mzHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          // A ragged front, not a clean cut: the last fraction of a millimetre of material
          // is still arriving, so the edge boils rather than slicing.
          'float mzNoise = (mzHash(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 22.0)) - 0.5) * 0.06;\n' +
          'if (vFlow > uGrow + mzNoise) discard;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          // The seam: brightest exactly at the front, gone a few centimetres behind it.
          // A NARROW, BRIGHT FRONT — not a glowing blade. The first pass used a 0.16 band
          // at five times radiance, and the whole array read as backlit glass instead of as
          // dark metal with a hot edge where it is still being made.
          'float mzEdge = 1.0 - smoothstep(0.0, 0.07, uGrow - vFlow);\n' +
          'totalEmissiveRadiance += uSeam * pow(mzEdge, 2.0) * 2.4;');
    };
    this.mWing.customProgramCacheKey = () => 'mz_nanowing';
  }

  _buildWings(rig) {
    const chest = rig.pivots.piv_chest || rig.pivots.piv_hips;
    if (!chest) return;
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(side * 0.20, 0.16, 0.06);
      root.rotation.set(-0.20, side * 0.42, side * -0.30);
      root.scale.setScalar(1);
      root.visible = false;      // the dissolve hides it, not the scale
      const blade = new THREE.Mesh(this.wingGeo, this.mWing);
      blade.scale.set(side, 1, 1);            // mirror the profile for the left side
      blade.frustumCulled = false;
      root.add(blade);
      // The array's own exhaust, off the trailing tip.
      const core = new THREE.Mesh(this.coneGeo, this.mCore);
      const bloom = new THREE.Mesh(this.coneGeo, this.mBloom);
      for (const o of [core, bloom]) {
        o.position.set(side * 0.02, 0.08, 1.12);
        o.rotation.x = -Math.PI / 2;          // fire backwards, along +Z
        o.frustumCulled = false;
        root.add(o);
      }
      chest.add(root);
      this.wings.push({ root, blade, core, bloom, side });
    }
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
    for (const w of this.wings) if (w.root.parent) w.root.parent.remove(w.root);
    this.wings.length = 0;
    this.attachedTo = rig || null;
    this._seams = null; this._bleed = -1;   // seam list belongs to the rig that is worn
    if (!rig || !rig.pivots) return;
    if (rig.id === 'mk50') this._buildWings(rig);
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
      for (const w of this.wings) w.root.visible = false;
      this.wingOut = 0;
      for (const l of this.lights) l.intensity = 0;
      this.smoke.clear();
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
      /* THE DRAWN CONES ARE GONE.
       *
       * Two cones per emitter — a white core inside a coloured bloom — were the "flame".
       * Whatever colour they were given, from the original magenta to the white-hot orange
       * gradient that replaced it, Jurek's verdict never moved: "dalej sa jakies dziwne,
       * takie narysowane obrzydliwe repulsory... usun calkowicie". He is right. A cone is a
       * hard-edged solid, and a hard-edged solid pretending to be fire reads as a plastic
       * party hat stuck on the boot — the shape is the problem, not the palette.
       *
       * What stays is what actually says "thruster": the blown-out sprite at the throat,
       * which is a falloff rather than a shape and has no silhouette to look wrong, plus the
       * point light it casts and the smoke pouring out below. Kept as hidden objects rather
       * than deleted so the emitter bookkeeping, the pooling and the warm-up all stay as
       * they were; they simply never draw. */
      const vis = lvl > 0.02;
      e.core.visible = false;
      e.bloom.visible = false;
      e.glow.visible = vis;
      if (!vis) continue;
      // HALF the first pass, on both size and opacity. Additive white over a lit ocean has
      // no way to be subtle: at 5.2-10.2 radii and full opacity the four glows merged into
      // one blown-out streak from the chest to the hips and the armour vanished inside it
      // (shots/fix/6_cruise_env.png against 8_nofx.png, same frame with the plumes off —
      // red and gold in one, a white smear in the other). The cones carry the shape; the
      // sprite is only there so the source is a point and not a line seen edge-on.
      e.glow.scale.setScalar(e.radius * (2.4 + lvl * 2.4));
      // Brighter than it was: the complaint was that the thrusters do not look like they
      // emit light, and the sprite at the throat is the only part that says "source".
      e.glow.material.opacity = Math.min(1, 0.24 + lvl * 0.56);
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

    /* THE MK L's ARRAYS — they GROW WITH THE CHARGE, and they are nanotech.
     *
     * They used to track `cmd.fire`, so they snapped out on every click: "LMB zawsze otwiera
     * te dodatkowe repulsory". They now follow the charge level instead, which means an
     * ordinary tap never brings them out at all and a full three-second hold has them fully
     * grown exactly as the beam goes off. On every other armour combat/ publishes a charge
     * of zero, so they simply never appear.
     *
     * "nie instant tylko ze powinny tak sie otwierac i chowac... nie mechanicznie tylko ze
     * sie tak topic jakby do stroju". So the growth is not a hinge opening. Length runs out
     * ahead of width (material flowing along a spar and then filling it), and going back in
     * is the same curve reversed and slower — it pours back rather than snapping shut. The
     * armour pays for it too: the suit's own seams dim while the material is out of them and
     * come back as it returns, which is the "ta czerwona linia znika i potem sie pojawia".
     */
    if (this.wings.length) {
      const want = (this.ctx.combat && this.ctx.combat.charge) || 0;
      // Out is quick and eager, back in is slow and reluctant — the opposite of a machine.
      const k = want > this.wingOut ? 1 - Math.exp(-dt / 0.30) : 1 - Math.exp(-dt / 0.55);
      this.wingOut += (want - this.wingOut) * k;
      const outv = this.wingOut;
      /* NO SCALING. The blade stays full size and the shader decides how much of it has
       * been built yet — see the dissolve on mWing. Scaling was the whole reason this read
       * as a prop being pushed out of a slot instead of as material arriving. The only
       * thing that still moves is a slight twist as it takes load, which is the array
       * settling, not the array deploying. */
      this.wingUniforms.uGrow.value = outv;
      this.wingUniforms.uTime.value = this.ctx.time || 0;
      for (const w of this.wings) {
        const vis = outv > 0.005;
        w.root.visible = vis;
        if (!vis) continue;
        w.root.scale.set(1, 1, 1);
        w.blade.rotation.z = w.side * (1 - outv) * 0.22;
        // The exhaust only lights once the array is nearly built — before that it is bare
        // material with nothing to fire through.
        const lit = Math.max(0, (outv - 0.6) / 0.4);
        const lvl = lit * (0.9 + 0.2 * Math.sin(this.ctx.time * 31 + w.side));
        // Same rule as the boot plumes above: no drawn cones anywhere.
        w.core.visible = false;
        w.bloom.visible = false;
      }
      this.mWing.emissiveIntensity = Math.max(0, (outv - 0.6) / 0.4) * 1.6;
      this._bleedSuit(outv);
    }

    /* THE TRAIL. Smoke off the boots, not a ribbon — see flight/smoke.js for why the
     * ribbon was invisible and what replaced it.
     *
     * Born much lower than the ribbon was (12 m/s, not 40): the ribbon had to wait for real
     * speed because a short one looked like a stick, but smoke at a hover is just exhaust
     * pooling under the suit, which is right. The rate follows each boot's own output, so
     * hovering leaves a soft column and a hard climb leaves a rope. */
    const sp = model.speed || 0;
    const f = Math.min(1, Math.max(0, (sp - 12) / (model.spec.topSpeed * 0.4)));
    for (let i = 0; i < 2; i++) {
      const e = this.emitters[i];
      if (!e) continue;
      e.node.getWorldPosition(_v);
      // Puffs leave along the thruster axis, then inherit a little of the airframe's speed.
      _v2.set(0, -1, 0).applyQuaternion(e.node.getWorldQuaternion(_q)).multiplyScalar(6 + f * 10);
      if (model.velocity) _v2.addScaledVector(model.velocity, 0.55);
      this.smoke.emitFrom(i, _v, _v2, Math.min(1, e.level * (0.35 + f)), dt, sp);
    }
    this.smoke.update(dt);
  }

  /* THE SUIT PAYS FOR THE ARRAYS.
   *
   * Nanotech that grows two arrays has to take the material from somewhere, and Jurek asked
   * for the armour to show it: "stroj tez powinien na to reagowac, czyli na przyklad jak to
   * sie robi to troszeczke tego czerwonego taka linia jakby tam znika i potem sie pojawia".
   * So the emissive seams dim in proportion to how much is currently outside the armour, and
   * come back as it flows home. Cheap: one scalar on materials that are already there.
   */
  _bleedSuit(out) {
    const rig = this.attachedTo;
    if (!rig || !rig.root) return;
    if (this._bleed === undefined) this._bleed = -1;
    const k = 1 - 0.55 * Math.min(1, out);
    if (Math.abs(k - this._bleed) < 0.01) return;      // 120 Hz: only write when it moves
    this._bleed = k;
    if (!this._seams) {
      this._seams = [];
      rig.root.traverse(n => {
        const ms = n.material ? [].concat(n.material) : [];
        for (const m of ms) {
          if (m && m.emissive && m.emissiveIntensity > 0.01) {
            this._seams.push({ m, base: m.emissiveIntensity });
          }
        }
      });
    }
    for (const s of this._seams) s.m.emissiveIntensity = s.base * k;
  }
}
