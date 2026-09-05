// Environment lighting. Owned by engine-core.
//
// This file exists because of one hard-won fact: a metallic PBR material with no
// environment map renders BLACK. Every armor in this game is metallic ~0.9. The env map
// is not decoration, it is what makes the suit visible at all — and per the reference
// bar, the light must come from somewhere real: warm high sun, blue sky dome, sand-ochre
// cliff bounce from below, and a bright ocean specular band.
//
// Two environments — 'exterior' (Malibu midday) and 'workshop' (near-black basement lit
// in cool pools) — but they are NOT a switch. They are the two ends of a single
// continuous mix, `env.k`, 0 = outside, 1 = underground. Walking down the stairs drives
// that number directly from the player's depth, so the light falls away with the steps
// instead of flipping at a trigger volume. `env.set(name)` still exists for anyone who
// just wants to arrive somewhere; it animates the same mix over 0.9 s.
//
// Everything that changes is a scalar or a colour, so it can be lerped: sun intensity,
// hemisphere bounce, tone-mapping exposure, background, fog colour and fog distances.
// The one thing that cannot be lerped is the PMREM cube itself — so it is swapped at the
// midpoint of the mix, under a dip in environmentIntensity that hides the cut.
import * as THREE from 'three';

function gradientEnv(renderer, stops, sun) {
  // Paints a small equirect sky and converts it to a PMREM cube. Cheap, and it gives
  // the broad soft specular sweeps the reference lacquer needs.
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  if (sun) {
    const rg = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, sun.r);
    rg.addColorStop(0, sun.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rg; g.fillRect(0, 0, 512, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose(); tex.dispose();
  return rt.texture;
}

// The two ends of the mix. Anything a module wants to fade with the descent goes here.
const PRESETS = {
  exterior: {
    sun: 2.3, bounce: 0.62, exposure: 0.92, envInt: 1.0,
    bg: 0x9dc0e0, fog: 0xb8cbdd, fogNear: 900, fogFar: 14000,
    bounceSky: 0xbfd8f5, bounceGround: 0x8a6a48, bloom: 0.55,
  },
  // The workshop reference is dark, but it is not black: you can read the lathe, the
  // benches and the cable runs between the pools of light. Measured against
  // reference/world/malibu_workshop_a.jpg, the first pass here (bounce 0.16, envInt
  // 0.85) rendered a literally black frame — the practicals are all short-range point
  // lights, so anything more than four metres from one received nothing at all. These
  // numbers are the floor that keeps the room legible without flattening the pools.
  workshop: {
    sun: 0.0, bounce: 0.22, exposure: 1.08, envInt: 1.05,
    bg: 0x04080b, fog: 0x04080b, fogNear: 8, fogFar: 85,
    bounceSky: 0x3a6d88, bounceGround: 0x11181e, bloom: 0.62,
  },
};

const _up = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
// Ease so the middle of the staircase is where most of the light is lost — the beat
// lands as you pass under the slab, not at the top step and not at the bottom one.
const ease = t => t * t * (3 - 2 * t);

export async function buildEnvironment(ctx) {
  const { renderer, scene, bus } = ctx;

  const exterior = gradientEnv(renderer, [
    [0.00, '#4d86c8'], [0.34, '#9dc0e0'], [0.49, '#e9e2d2'],
    [0.51, '#b39876'], [1.00, '#6b5a44'],
  ], { x: 150, y: 60, r: 90, color: 'rgba(255,246,225,0.95)' });

  // Cool, dim, and lit from the side rather than from above: the workshop's own key is
  // its monitors and strip lights, so the cube is there to give metal something to
  // reflect, not to light the room.
  const workshop = gradientEnv(renderer, [
    [0.00, '#16242e'], [0.45, '#1b2c37'], [0.55, '#121a21'], [1.00, '#080c10'],
  ], { x: 300, y: 120, r: 160, color: 'rgba(96,180,220,0.62)' });

  // Key light. Warm, high, and the only shadow caster — matches malibu_cliff_hero.
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
  sun.position.set(-260, 340, 180);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -90; s.right = 90; s.top = 90; s.bottom = -90; s.near = 1; s.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // The light's offset from whatever it is aimed at. _followSun keeps this vector
  // constant as the box travels, so the sun angle never changes — only where it can
  // afford to draw shadows.
  const SUN_OFF = sun.position.clone();

  // Ochre bounce from the cliff, cool fill from the sky. Cheap and it does a lot.
  const bounce = new THREE.HemisphereLight(0xbfd8f5, 0x8a6a48, 0.55);
  scene.add(bounce);

  /* ───────────────── the interior daylight rig ─────────────────
   * Three.js has no global illumination. Outdoors that does not matter — the sun and
   * the sky dome do everything. Indoors it matters enormously: the roof slab shadows
   * the whole main floor, so the living room received nothing but the hemisphere and
   * rendered as a near-black concrete box. The reference plate
   * (reference/world/malibu_living_colour.jpg) is the opposite of that: a BRIGHT room,
   * lit almost entirely by light coming off the Pacific through the curtain wall, with
   * warm sun rakes on the stone floor.
   *
   * So there is a second, indoors-only rig, and its intensity is driven by a single
   * `indoor` factor measured off the camera — is there a roof over your head — and
   * faded, so walking out onto the terrace is a dissolve rather than a pop. Outdoors it
   * is exactly zero, which is why the world task's approved exterior renders are
   * untouched by any of it.
   *
   *   oceanFill  the Pacific: a huge cool sheet of light from seaward and high.
   *   warmFill   the sun's own colour, bounced off the stone floor back up onto faces
   *              and undersides — the reason the wood soffit in the plate glows.
   * There is deliberately no third "sky" light: the hemisphere IS the sky, and every
   * extra light in the scene is paid for by every fragment of every surface in the game.
   * None of them cast shadows: they are stand-ins for bounce, and a bounce light with a
   * shadow map is just a second sun in the wrong place. */
  const indoorRig = new THREE.Group();
  indoorRig.name = 'indoor-daylight';

  // Placed HIGH rather than at sea level. A grazing light and a polished stone floor
  // make one enormous specular streak pointing straight at the camera, which the bloom
  // pass then turns into a white hole in the middle of the opening shot — measured, and
  // it is the difference between "sunlit room" and "overexposed". From above the lobe
  // spreads and the floor reads as stone.
  const oceanFill = new THREE.DirectionalLight(0xd9e8f6, 0);
  oceanFill.position.set(-70, 105, -260);
  indoorRig.add(oceanFill, oceanFill.target);

  // From BELOW, and it matters more than it sounds: in the reference plate the wood
  // ceiling soffit is the second brightest thing in the room, lit entirely by sun
  // coming off the stone floor. Without it every ceiling in this house renders as a
  // flat dark slab, because nothing else in the scene points upward at all.
  const warmFill = new THREE.DirectionalLight(0xffe9c8, 0);
  warmFill.position.set(-120, -90, 60);
  indoorRig.add(warmFill, warmFill.target);

  // A soft ambient floor so a corner with nothing pointing at it is still readable
  // rather than crushed to black. Deliberately small — it is the last 8%, not the key.
  const indoorAmbient = new THREE.AmbientLight(0xc4d6e6, 0);
  indoorRig.add(indoorAmbient);

  /* The stairwell. The descent into the workshop is the one beat in the first minute
   * that is pure lighting, and it only reads if there is something to lose: a warm pool
   * at the top of the stair that hands over to a cold one at the bottom. Both live here
   * so the fade is driven by the same `k` as everything else. */
  const stairWarm = new THREE.PointLight(0xffdcae, 0, 26, 2.0);
  const stairCool = new THREE.PointLight(0x74c8ee, 0, 22, 2.0);

  /* ───────────── the workshop bounce pair ─────────────
   * Measured problem, not a taste call. A 5-bucket luminance histogram of
   * reference/world/malibu_workshop_a.jpg puts 21.5% of its pixels ABOVE the bottom
   * fifth of the range, with a broad 13% low-mid band. Our matched frame put 3.4% and
   * 1.1%. Every practical in that basement is a point light with decay 2, which is
   * physically correct and means that four metres from a lamp there is nothing at all —
   * so the mid-ground of every workshop frame was pure black no matter how much clutter
   * was standing in it.
   *
   * The fix is NOT an AmbientLight. An ambient term lifts every fragment by the same
   * amount regardless of which way it faces, and the result is the flat grey that reads
   * instantly as a lighting failure — the far wall, the floor and the ceiling all go the
   * same value and the room loses its shape. These are two DIRECTIONAL lights instead:
   * they have no falloff, so they reach the far corner, but they are directional, so a
   * surface still gets brighter or darker depending on where it points, and the pools
   * from the practicals still sit on top as the brightest thing in frame.
   *
   * One cool, raking across the room from the case wall — the colour of the case
   * backlights and the monitors, which is what a real bounce off them would be. One
   * warm and much weaker from the task-lamp side, low, so the undersides of the benches
   * and the machine bodies are not solid black.
   *
   * Neither casts a shadow. A bounce light with a shadow map is just a second sun in the
   * wrong place, and it would cost a second 2048² depth pass in the darkest room in the
   * game. Both are folded into the mix by `k`, so they do not exist above ground. */
  const shopCool = new THREE.DirectionalLight(0x4a7d9c, 0);
  shopCool.position.set(-100, 46, 16);
  shopCool.castShadow = false;
  const shopWarm = new THREE.DirectionalLight(0x8a6a48, 0);
  shopWarm.position.set(22, 34, -100);
  shopWarm.castShadow = false;
  let shopIn = false;
  let stairsIn = false;
  let rigIn = false;   // the whole rig leaves the scene graph outdoors, see _applyIndoor

  const INDOOR = {
    ocean: 1.15, warm: 1.05, ambient: 0.26,
    stairWarm: 26, stairCool: 20,
  };

  /* Tuned against the acceptance test, not chosen: render
   * shots/shell2/A_workshop_sideon.png through tools/shell-r2.html and run
   * `python3 tools/hist.py` on it. Target is bucket 0 <= 80% and bucket 1 (52..104)
   * >= 12%, which is what the reference plate measures. Raise these and the histogram
   * moves the right way, but past about double the room goes flat and grey and the
   * pools stop being pools — look at the frame, never only at the number. */
  const SHOP = { cool: 0.62, warm: 0.34 };

  scene.background = new THREE.Color(PRESETS.exterior.bg);
  scene.fog = new THREE.Fog(PRESETS.exterior.fog, PRESETS.exterior.fogNear, PRESETS.exterior.fogFar);

  const envs = { exterior, workshop };
  const cBg = new THREE.Color(), cFog = new THREE.Color();
  const cSky = new THREE.Color(), cGnd = new THREE.Color();
  const A = PRESETS.exterior, B = PRESETS.workshop;

  const env = {
    sun, bounce, envs, indoorRig,
    k: 0,             // 0 exterior .. 1 workshop — the single source of truth
    target: 0,
    indoor: 0,        // 0 outdoors .. 1 under a roof — drives the interior daylight rig
    _indoorRaw: 0,
    _probeT: 0,
    rate: 1 / 0.9,    // how fast set() walks k to its target, per second
    current: 'exterior',
    // null, NOT 'exterior'. The swap below is guarded on `wantCube !== this._cube`, and
    // seeding this with the state the game boots in meant the guard was false on the very
    // first _apply() and every one after it: scene.environment was never assigned at all
    // unless you walked down to the workshop and back up again, which is the only way the
    // value ever changed. Every metal in the game outdoors — all five armours, at
    // metalness 1 with nothing to reflect — rendered as a black silhouette with a specular
    // highlight, which is exactly what the chase shots came back with.
    _cube: null,

    // Drive the mix directly. This is what onfoot.js calls every step while the player
    // is on the stairs, so the light tracks his feet.
    mix(k) {
      k = Math.max(0, Math.min(1, k));
      this.k = k;
      this.target = k;
      this._apply();
    },

    // Animate to one end. Used by the 'env:set' bus event and by anything that
    // teleports (debug hooks, suit-up, restart).
    set(name, seconds = 0.9) {
      if (!envs[name]) return;
      this.current = name;
      this.target = name === 'workshop' ? 1 : 0;
      this.rate = seconds > 0 ? 1 / seconds : 1e9;
      if (seconds <= 0) { this.k = this.target; this._apply(); }
      bus.emit('env:changed', name);
    },

    // Called from the fixed simulation step by Loop, before any module updates.
    update(dt) {
      this._updateIndoor(dt);
      this._followSun();
      if (this.k === this.target) { this._applyIndoor(); return; }
      const d = this.target - this.k;
      const stepAmt = this.rate * dt;
      this.k = Math.abs(d) <= stepAmt ? this.target : this.k + Math.sign(d) * stepAmt;
      this._apply();
    },

    /* ── the shadow camera follows the player ──────────────────────────────────
     * A directional light in three.js casts inside one orthographic box, and this world
     * is twelve kilometres across. Parked on the origin with a +-90 m box, the sun's
     * shadow map covered a patch of cliff and nothing else: stand in the living room and
     * the curtain wall's mullions cast NOTHING on the floor, so the one thing the
     * reference plate of this room is made of — hard sun rakes across stone — could not
     * happen at any exposure. Measured, not guessed: the opening frame had no cast
     * shadow anywhere in it.
     *
     * So the box travels with the camera, and it is TIGHT when we are indoors (34 m
     * across a 2048 map is a 1.7 cm texel — a mullion is 6 cm wide and has to survive)
     * and wide outdoors, where the subject is a house on a cliff seen from the air.
     * The centre is snapped to a texel grid; without that the whole shadow map crawls
     * as the player walks and every edge in the room shimmers. */
    _shadowExtent: 0,
    _followSun() {
      const cam = ctx.camera;
      if (!cam) return;
      const want = this.indoor > 0.5 ? 34 : 150;
      if (want !== this._shadowExtent) {
        const c = sun.shadow.camera;
        c.left = -want; c.right = want; c.top = want; c.bottom = -want;
        c.near = 1; c.far = 900;
        c.updateProjectionMatrix();
        sun.shadow.needsUpdate = true;
        this._shadowExtent = want;
      }
      const grid = want > 60 ? 4 : 0.25;
      const tx = Math.round(cam.position.x / grid) * grid;
      const ty = Math.round(cam.position.y / grid) * grid;
      const tz = Math.round(cam.position.z / grid) * grid;
      if (sun.target.position.x === tx && sun.target.position.y === ty &&
          sun.target.position.z === tz) return;
      sun.target.position.set(tx, ty, tz);
      sun.position.set(tx + SUN_OFF.x, ty + SUN_OFF.y, tz + SUN_OFF.z);
      sun.target.updateMatrixWorld();
    },

    /* Are we under a roof? Answered by a single ray straight up from the camera, which
     * is exact where a footprint polygon is a guess — the terrace is inside the house
     * outline and has no roof, and that is precisely the case a polygon gets wrong.
     * Probed ten times a second, not every step: it is a 1/120 s loop and this is a
     * physics query. Falls back to the house-plate test when physics is not up yet. */
    _updateIndoor(dt) {
      this._probeT -= dt;
      if (this._probeT <= 0) {
        this._probeT = 0.1;
        const cam = ctx.camera;
        const ph = ctx.physics;
        let inside = this._indoorRaw > 0.5;
        const geom = ctx.player && ctx.player.geom;
        const boxed = cam && geom && geom.ready && geom.indoorAt
          ? geom.indoorAt(cam.position.x, cam.position.y, cam.position.z) : null;
        if (boxed !== null && boxed !== undefined) {
          // onfoot's own bounding-box model of the house. Preferred when it exists,
          // because it knows the terrace is outdoors and a footprint polygon does not.
          inside = boxed;
        } else if (cam && ph && ph.ready && ph.raycast) {
          _up.set(cam.position.x, cam.position.y + 0.35, cam.position.z);
          const hit = ph.raycast(_up, UP, 16, null);
          inside = !!(hit && hit.material !== 'glass');
        } else if (cam && ctx.world && ctx.world.surfaceHeight) {
          // No physics: the house plate is the best guess available.
          const surf = ctx.world.surfaceHeight(cam.position.x, cam.position.z);
          inside = cam.position.y < surf + 9 && cam.position.y > surf - 1.5;
        }
        this._indoorRaw = inside ? 1 : 0;
      }
      // 0.55 s dissolve. Fast enough that stepping through a door is not a slow pump,
      // slow enough that walking under a beam does not strobe the room.
      const rate = dt / 0.55;
      const d = this._indoorRaw - this.indoor;
      this.indoor = Math.abs(d) <= rate ? this._indoorRaw : this.indoor + Math.sign(d) * rate;
      this._applyIndoor();
    },

    _applyIndoor() {
      // Underground the rig is off entirely: the workshop preset owns that room, and
      // pouring Pacific daylight into a basement would undo the whole descent.
      const daylight = this.indoor * (1 - ease(this.k));
      // Outdoors the rig is not dimmed, it is GONE. Three lights at intensity zero
      // still cost a loop iteration in the fragment shader of every surface in a 12 km
      // world, and the player spends most of this game outside at 300 m/s.
      const wantRig = daylight > 0.004 || this.k > 0.004;
      if (wantRig !== rigIn) {
        rigIn = wantRig;
        if (wantRig) scene.add(indoorRig); else scene.remove(indoorRig);
      }
      if (!rigIn) return;
      oceanFill.intensity = INDOOR.ocean * daylight;
      warmFill.intensity = INDOOR.warm * daylight;
      indoorAmbient.intensity = INDOOR.ambient * daylight;

      // The stair lamps are the inverse: they come UP as the daylight goes, peak in the
      // middle of the descent, and the cool one survives to the bottom because it is the
      // workshop's own light spilling into the shaft.
      const mid = Math.sin(Math.PI * Math.min(1, this.k * 1.15));
      stairWarm.intensity = INDOOR.stairWarm * mid * (1 - this.k * 0.75) * Math.max(this.indoor, 0.6);
      stairCool.intensity = INDOOR.stairCool * Math.min(1, this.k * 1.6);
      // A light with intensity 0 still costs every fragment in the scene a loop
      // iteration, so the stair lamps leave the graph entirely when nobody is on the
      // stairs. This is the whole first minute of the game at Malibu midday.
      const want = stairWarm.intensity > 0.02 || stairCool.intensity > 0.02;
      if (want !== stairsIn) {
        stairsIn = want;
        if (want) indoorRig.add(stairWarm, stairCool);
        else indoorRig.remove(stairWarm, stairCool);
      }
    },

    /* world/ tells us where its stair is; the lamps go there. Called once, from main.js
     * after every module has initialised, because ctx.world does not exist at env time. */
    placeStairLights(top, bottomY) {
      if (!top) return;
      stairWarm.position.set(top.x, top.y + 2.7, top.z);
      stairCool.position.set(top.x, (bottomY != null ? bottomY : top.y - 5) + 2.2, top.z);
      this._stairPlaced = true;
    },

    _apply() {
      const t = ease(this.k);
      // The PMREM cube cannot be blended, so swap it halfway and dip the intensity
      // across the swap. The dip is 40% at the midpoint and zero at both ends, which
      // means the cut lands in the darkest, foggiest part of the descent.
      const wantCube = this.k > 0.5 ? 'workshop' : 'exterior';
      if (wantCube !== this._cube) { this._cube = wantCube; scene.environment = envs[wantCube]; }
      const dip = 1 - 0.4 * Math.sin(Math.PI * this.k);

      /* The workshop bounce pair. Folded on with the mix so it does not exist above
       * ground, and out of the scene graph entirely when it is not needed — the player
       * spends most of this game outdoors at 300 m/s and every light in the scene costs
       * every fragment of every surface a loop iteration. */
      shopCool.intensity = SHOP.cool * t;
      shopWarm.intensity = SHOP.warm * t;
      const wantShop = t > 0.01;
      if (wantShop !== shopIn) {
        shopIn = wantShop;
        if (wantShop) scene.add(shopCool, shopCool.target, shopWarm, shopWarm.target);
        else scene.remove(shopCool, shopCool.target, shopWarm, shopWarm.target);
      }
      // The workshop dressing (engine/dress.js) owns lights of its own and has no update
      // hook of its own — registry.js is frozen. It rides the same `k` as everything
      // else here, which is the only number in the game that tells the truth about
      // whether we are underground.
      if (ctx.dress) ctx.dress.setMix(this.k);

      sun.intensity = lerp(A.sun, B.sun, t);
      sun.castShadow = sun.intensity > 0.05;
      bounce.intensity = lerp(A.bounce, B.bounce, t);
      cSky.setHex(A.bounceSky).lerp(cGnd.setHex(B.bounceSky), t);
      bounce.color.copy(cSky);
      cSky.setHex(A.bounceGround).lerp(cGnd.setHex(B.bounceGround), t);
      bounce.groundColor.copy(cSky);

      scene.environmentIntensity = lerp(A.envInt, B.envInt, t) * dip;
      renderer.toneMappingExposure = lerp(A.exposure, B.exposure, t);

      if (scene.background && scene.background.isColor) {
        scene.background.copy(cBg.setHex(A.bg).lerp(cFog.setHex(B.bg), t));
      }
      if (scene.fog) {
        scene.fog.color.copy(cBg.setHex(A.fog).lerp(cFog.setHex(B.fog), t));
        // Fog distance is the strongest single cue that you are indoors. Lerp it in
        // log space or the walls appear to rush in over the last two steps.
        scene.fog.near = Math.exp(lerp(Math.log(A.fogNear), Math.log(B.fogNear), t));
        scene.fog.far = Math.exp(lerp(Math.log(A.fogFar), Math.log(B.fogFar), t));
      }
      const bloom = scene.userData.bloom;
      // Indoors, pull the bloom back. There is nothing emissive in the living room —
      // no repulsor, no reactor, no strip light — so everything bloom does in there it
      // does to a specular highlight on a stone floor, and it turns one into a white
      // hole. Outdoors and in the workshop, where the glow IS the subject, it is
      // untouched.
      if (bloom) bloom.strength = lerp(A.bloom, B.bloom, t) * (1 - 0.42 * this.indoor * (1 - t));
    },
  };

  ctx.env = env;
  bus.on('env:set', n => env.set(typeof n === 'string' ? n : n && n.name));
  env.set('exterior', 0);
  env._applyIndoor();
}
