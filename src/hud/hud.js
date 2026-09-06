// JARVIS HUD. Owned by task `hud`.
//
// The other half of flight. Every number on the visor is read straight off the flight
// model on the frame it is drawn — nothing here is faked, eased for looks, or animated
// on a timer.
//
// FOUR DECISIONS WORTH DEFENDING
// ------------------------------
//  1. IT IS PART OF THE RENDERED IMAGE, not a DOM overlay. The HUD is painted into a 2D
//     canvas and uploaded as the texture of two planes parented to the camera. The
//     previous version was SVG in the document; it looked correct in a browser and was
//     absent from every screenshot the project can take, because MZ.shot() reads the
//     WebGL canvas back with toDataURL() and DOM siblings are not in it. A critic
//     comparing our frame with reference/hud/hud_mk3_targeting.jpg was handed an empty
//     ocean. Being in the scene also buys the two things the reference frames are made
//     of: a helmet interior that actually darkens the world, and graphics that sit at a
//     real distance in front of the eye.
//  2. TWO PLANES, NOT ONE. The graphics live 1.25 m out; the helmet aperture and its
//     scan structure sit at 0.62 m. They are offset by different amounts against the
//     camera rig's head lag, so when the helmet swings late behind the airframe the
//     furniture slides against the world and against the visor. That disagreement of a
//     few pixels is the whole difference between projected light and a sticker.
//  3. IT DRAWS IN render(), NOT update(). Simulation ticks at 120 Hz; repainting a
//     2048 px canvas that often would burn the frame budget for a display no eye can
//     resolve past 60. MZ.sim() ends with a render, so a screenshot is always current.
//  4. IT IS HELMET-ONLY. Switch to the chase camera and the HUD goes, because you are
//     no longer looking through a faceplate. The helmet interior goes with it.
//
// Reference: reference/hud/hud_mk3_targeting.jpg for the in-flight layout and where the
// furniture sits, hud_mk3_a.jpg for the near-black ambient level and how little colour
// there actually is.

import * as THREE from 'three';
import { Pen } from './paint.js';
import {
  headingTape, speedBlock, altLadder, armorCluster, dataBlock,
  attitudeBall, throttleAndIcons, reticle, warnings, legend,
} from './elements.js';
import { CONTROL_LEGEND } from '../flight/input.js';

const RAD = 180 / Math.PI;
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

const HUD_Z = -1.25;      // metres in front of the eye
const HELMET_Z = -0.62;
const MAX_W = 1920;       // cap the paint cost on a 5K display

// ---------------------------------------------------------------------------------------
// The helmet interior. Painted once per resize into its own small canvas: an aperture
// that falls off to near black at the extreme edge, a harder brow and chin, and the faint
// horizontal scan structure of something projected onto curved glass.
//
// The numbers come from looking at renders, not from taste. 112% x 86% was invisible over
// a bright noon sky; 78% x 64% turned the world into a porthole. This keeps about two
// thirds of the frame perfectly clear and still puts helmet in every corner.
// ---------------------------------------------------------------------------------------
function paintHelmet(cv) {
  const g = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);

  // A flat veil over the WHOLE aperture. This is the piece that was missing, and it is
  // the difference between "graphics on a window" and "graphics inside a helmet". In
  // reference/hud/hud_mk3_targeting.jpg the desert is plainly visible and just as plainly
  // seen through something: the whole image is knocked back and cooled, not just the
  // corners. Ten per cent of a cool near-black over everything does that and costs no
  // legibility — the mountains are still mountains.
  g.fillStyle = 'rgba(6,12,18,0.20)';
  g.fillRect(0, 0, w, h);

  // The aperture itself. Slightly wider than the old one at the centre so the clear area
  // does not shrink, and far harder at the rim: the previous ramp only reached full black
  // outside the frame, so the visible corners topped out grey and the frame read as a
  // window. Full black now lands at 0.94 of the radius, which is inside the corner.
  const rad = g.createRadialGradient(w * 0.5, h * 0.47, 0, w * 0.5, h * 0.47, w * 0.60);
  rad.addColorStop(0.00, 'rgba(0,0,0,0)');
  rad.addColorStop(0.42, 'rgba(0,0,0,0)');
  rad.addColorStop(0.60, 'rgba(2,5,8,0.34)');
  rad.addColorStop(0.76, 'rgba(2,5,8,0.74)');
  rad.addColorStop(0.94, 'rgba(1,3,5,0.99)');
  rad.addColorStop(1.00, 'rgba(1,3,5,1)');
  g.fillStyle = rad; g.fillRect(0, 0, w, h);

  // Brow and chin. A helmet is taller than it is wide inside, so the top and bottom close
  // in further than the sides do.
  const brow = g.createLinearGradient(0, 0, 0, h);
  brow.addColorStop(0.00, 'rgba(3,6,9,0.97)');
  brow.addColorStop(0.10, 'rgba(3,6,9,0.42)');
  brow.addColorStop(0.20, 'rgba(3,6,9,0)');
  brow.addColorStop(0.80, 'rgba(3,6,9,0)');
  brow.addColorStop(0.90, 'rgba(3,6,9,0.38)');
  brow.addColorStop(1.00, 'rgba(3,6,9,0.95)');
  g.fillStyle = brow; g.fillRect(0, 0, w, h);

  // Interior bounce: the graphics are the only light in here, so what they land on is
  // the inside of the faceplate right around them.
  for (const [x, y, r] of [[0.10, 0.20, 0.42], [0.90, 0.18, 0.38], [0.12, 0.86, 0.34], [0.88, 0.88, 0.34]]) {
    const gl = g.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * r);
    gl.addColorStop(0, 'rgba(130,190,230,0.055)');
    gl.addColorStop(1, 'rgba(130,190,230,0)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
  }

  g.fillStyle = 'rgba(210,235,255,0.030)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
}

// ---------------------------------------------------------------------------------------
export default {
  id: 'hud',

  async init(ctx) {
    const parts = {
      heading: headingTape(),
      speed: speedBlock(),
      alt: altLadder(),
      armor: armorCluster(),
      data: dataBlock(),
      att: attitudeBall(),
      thr: throttleAndIcons(),
      warn: warnings(),
      cross: reticle(),
      legend: legend(CONTROL_LEGEND),
    };

    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 720;
    const g2d = cv.getContext('2d');
    const pen = new Pen(g2d);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;

    const helmetCv = document.createElement('canvas');
    helmetCv.width = 512; helmetCv.height = 288;
    paintHelmet(helmetCv);
    const helmetTex = new THREE.CanvasTexture(helmetCv);
    helmetTex.colorSpace = THREE.SRGBColorSpace;
    helmetTex.minFilter = THREE.LinearFilter;
    helmetTex.generateMipmaps = false;

    const quad = (map) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map, transparent: true, depthTest: false, depthWrite: false,
          toneMapped: false, fog: false, side: THREE.FrontSide,
        })
      );
      m.frustumCulled = false;
      m.visible = false;
      return m;
    };
    const helmetMesh = quad(helmetTex);
    helmetMesh.position.z = HELMET_Z;
    helmetMesh.renderOrder = 9000;
    const hudMesh = quad(tex);
    hudMesh.position.z = HUD_Z;
    hudMesh.renderOrder = 9001;

    // ---- WHERE THE VISOR IS DRAWN, AND WHY IT IS NOT IN THE SCENE -------------------------
    // The first version parented these two planes to ctx.camera, inside ctx.scene. That
    // put them INSIDE the post chain, and the post chain is: RenderPass -> UnrealBloom
    // (threshold 1.05) -> OutputPass (ACES + sRGB). Three consequences, all of them
    // visible in shots/flight/hud-cruise.png before this was changed:
    //
    //   * `toneMapped: false` did nothing. It only exempts a material from the RENDERER's
    //     tone mapping; when an OutputPass tone-maps the whole buffer instead, the HUD is
    //     tone-mapped with everything else. Every hairline got ACES-compressed towards the
    //     bright ocean behind it.
    //   * Bloom from the sea and the sun was ADDED on top of the finished visor, so the
    //     graphics washed out worst over exactly the bright water you fly across all game.
    //     In the boost frame the whole control legend disappeared into the sun glare.
    //   * The helmet interior — a black vignette whose entire job is to make the world
    //     darker — was itself tone-mapped and then had bloom added over it, which is a
    //     contradiction in terms. The reference frames are near black at the edges; ours
    //     was pale blue.
    //
    // So the visor is now its own tiny scene, drawn straight to the canvas AFTER the
    // composer has finished, with tone mapping off. It is projected light on the inside
    // of a faceplate: nothing in the world should be able to bloom over it, and nothing
    // about it should be graded. Screenshots still contain it, because MZ.screenshot()
    // reads the same canvas after the same wrapped render.
    const overlay = new THREE.Scene();
    const visor = new THREE.Group();          // stands in for the camera inside `overlay`
    visor.add(helmetMesh, hudMesh);
    overlay.add(visor);

    const drawVisor = () => {
      if (!helmetMesh.visible && !hudMesh.visible) return;
      const cam = ctx.camera;
      cam.updateWorldMatrix(true, false);
      visor.position.setFromMatrixPosition(cam.matrixWorld);
      visor.quaternion.setFromRotationMatrix(cam.matrixWorld);
      const r = ctx.renderer;
      const prevAutoClear = r.autoClear, prevTone = r.toneMapping, prevTarget = r.getRenderTarget();
      r.setRenderTarget(null);
      r.autoClear = false;
      r.toneMapping = THREE.NoToneMapping;
      r.render(overlay, cam);
      r.toneMapping = prevTone;
      r.autoClear = prevAutoClear;
      r.setRenderTarget(prevTarget);
    };
    this._drawVisor = drawVisor;

    // Wrap rather than edit: engine-core owns the composer and the loop, and a module is
    // not allowed to reach into either. Wrapping composes — if something else wraps it
    // too, both wrappers still run.
    if (ctx.composer && !ctx.composer.__hudWrapped) {
      const inner = ctx.composer.render.bind(ctx.composer);
      ctx.composer.render = (deltaTime) => { inner(deltaTime); drawVisor(); };
      ctx.composer.__hudWrapped = true;
    }

    // ---- telemetry struct, reused every frame -------------------------------------------
    const t = {
      speed: 0, mach: 0, topSpeed: 320, altitude: 0, heading: 0, pitch: 0, roll: 0,
      throttle: 0, g: 1, power: 1, integrity: 1, ice: 0, thrust: 0, verticalSpeed: 0,
      mode: 'STANDBY', armorName: 'MARK III', boost: false, hover: false, firing: false,
      aimDist: 0, terrain: false, time: 0, pos: { x: 0, z: 0 },
    };

    const api = {
      visible: false,
      canvas: cv, texture: tex, mesh: hudMesh, helmet: helmetMesh,
      overlay, visor, drawVisor,
      parts, telemetry: t,
      // The boot wipe is released from SIMULATION time, never from requestAnimationFrame:
      // rAF is throttled to nothing in a headless browser, and a screenshot taken during
      // a wipe that never ends is a screenshot of an empty helmet.
      show(booting = true) {
        api.visible = true;
        api.bootAt = booting ? ctx.time : -99;
        api.legendUntil = ctx.time + 16;
      },
      hide() { api.visible = false; },
      legendUntil: 0,
      bootAt: -99,
      firingUntil: 0,
    };
    ctx.hud = api;

    /* THE HUD IS THE INSIDE OF A HELMET. It only exists when there is a helmet.
     * Joining the game put you in first person with the full JARVIS interface over your
     * eyes while you were standing there in a t-shirt — the visor was drawn because
     * nothing ever said "you are not wearing anything". A boy walking to the ring should
     * just see the world. */
    const wantVisor = () => !!(ctx.state.armor && ctx.state.suitClosed);
    api.gate = () => { if (!wantVisor()) api.hide(); };
    ctx.bus.on('suitup:start', () => api.show(true));
    ctx.bus.on('suitup:done', () => api.show(false));
    ctx.bus.on('flight:active', () => api.show(true));
    ctx.bus.on('debug:fly', () => api.show(true));
    // Faceplate up means you are looking out of an open helmet: no projection surface.
    ctx.bus.on('faceplate', ({ open }) => { if (open) api.hide(); else api.show(false); });
    ctx.bus.on('repulsor:fire', () => { api.firingUntil = ctx.time + 0.12; });

    this._aimTick = 0;
  },

  // Once per drawn frame, not once per simulation step.
  render(ctx) {
    const api = ctx.hud;
    if (!api) return;
    // Every frame, not just on the events: the visor belongs to a closed helmet and there
    // are more ways to end up without one than there are events announcing it.
    if (api.gate) api.gate();

    // Degraded path: loop.js drops the composer if a post shader will not compile, and
    // then it calls renderer.render() directly — our wrapper never runs and the visor
    // would silently vanish. Put the planes back on the camera and take the tone mapping
    // hit; a graded HUD beats no HUD.
    if (!ctx.composer && !api._reparented) {
      api._reparented = true;
      ctx.camera.add(api.helmet, api.mesh);
    }

    const inHelmet = api.visible && ctx.state.view !== 'third';
    api.mesh.visible = inHelmet;
    api.helmet.visible = inHelmet;
    if (!inHelmet) return;

    const flight = ctx.flight;
    const model = flight && flight.model;
    const t = api.telemetry;

    if (model) {
      const q = model.quaternion;
      _fwd.set(0, 0, -1).applyQuaternion(q);
      _up.set(0, 1, 0).applyQuaternion(q);
      _right.set(1, 0, 0).applyQuaternion(q);

      t.speed = model.speed;
      t.mach = model.mach;
      t.topSpeed = model.spec.topSpeed;
      t.altitude = model.altitude || 0;
      t.heading = ((Math.atan2(_fwd.x, -_fwd.z) * RAD) % 360 + 360) % 360;
      t.pitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y))) * RAD;
      t.roll = Math.atan2(_right.y, _up.y) * RAD;
      t.throttle = model.throttle;
      t.g = model.gForce;
      t.power = model.power;
      t.integrity = model.integrity;
      t.ice = model.ice;
      t.thrust = Math.min(model.thrustMag, 1);
      t.verticalSpeed = model.velocity.y;
      t.mode = model.mode;
      t.armorName = model.spec.name;
      t.boost = !!model.boostActive;
      t.hover = model.hover;
      t.pos.x = model.position.x; t.pos.z = model.position.z;
      t.terrain = t.altitude < 30 && t.verticalSpeed < -9;
    }
    t.firing = ctx.time < (api.firingUntil || 0) || !!(flight && flight.cmd && flight.cmd.fire);
    t.time = ctx.time;

    // Range under the crosshair. Marched, not raycast, and only a few times a second —
    // it is a readout, not a hit test. Combat does its own trace along flight.aimRay().
    this._aimTick = (this._aimTick || 0) + 1;
    if (ctx.world && (this._aimTick & 3) === 0) {
      ctx.camera.getWorldPosition(_o);
      ctx.camera.getWorldDirection(_d);
      let dist = 0;
      // Only march if we actually start in the air. Outside the terrain grid
      // surfaceHeight can hand back a non-finite value, and an earlier version read that
      // as "ground at 1.6 m" — the reticle then reported a range of 2 M while flying at
      // 400 m over open water.
      const y0 = ctx.world.surfaceHeight(_o.x, _o.z);
      if (Number.isFinite(y0) && _o.y > y0) {
        for (let i = 2; i <= 48; i++) {
          const r = i * i * 1.6;                  // quadratic march: fine near, coarse far
          _p.copy(_o).addScaledVector(_d, r);
          const gy = ctx.world.surfaceHeight(_p.x, _p.z);
          if (Number.isFinite(gy) && _p.y <= gy) { dist = r; break; }
          if (r > 4000) break;
        }
      }
      t.aimDist = dist;
      if (flight) flight.aimDist = dist;
    }

    paint(ctx, api, t);
  },
};

// How far the helmet is currently trailing the airframe, clamped to the same range the
// plane offset below uses. One source of truth, so the reticle's compensation and the
// plane's slide can never drift apart.
function rigLag(ctx) {
  const rig = ctx.cameraRig;
  if (!rig) return { x: 0, y: 0 };
  return {
    x: Math.max(-1, Math.min(1, rig.lag.x)),
    y: Math.max(-1, Math.min(1, rig.lag.y)),
  };
}

// =======================================================================================
// One frame of the visor.
// =======================================================================================
function paint(ctx, api, t) {
  const cv = api.canvas;
  const buf = ctx.renderer.domElement;
  // Match the canvas to the frame being rendered, so a hairline is a hairline and the
  // aspect of the plane below is right. MZ.shot() resizes the renderer mid-frame; this
  // picks that up on the same frame it happens.
  const want = Math.max(320, Math.min(MAX_W, buf.width));
  const wantH = Math.max(200, Math.round(want * buf.height / Math.max(buf.width, 1)));
  if (cv.width !== want || cv.height !== wantH) {
    cv.width = want; cv.height = wantH;
  }
  const W = cv.width, H = cv.height;
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);

  const pen = api.pen || (api.pen = new Pen(g));
  pen.g = g;

  // One scale for the whole interface. 900 px of visor height is the design size.
  const u = Math.max(0.55, Math.min(1.35, H / 790));
  const M = 30 * u;

  // Boot wipe: the furniture arrives in a sweep from the top, over 0.9 s, released from
  // simulation time so it also happens (and finishes) in a headless browser.
  const bootT = ctx.time - api.bootAt;
  const booting = bootT < 0.95;
  const wipe = booting ? Math.max(0, bootT) / 0.95 : 1;

  // A soft dark cloud under a cluster of graphics. Not a panel and not a box — no edge is
  // ever visible — just the glass going a little darker where a lot of light is being
  // projected onto it, which is what the film's visor does under the altitude tape and
  // the armour cluster. It is also the only thing that makes a one-pixel grey line
  // survive noon sun on open water: over the sea the data block was legible in theory and
  // gone in practice (shots/flight/hud-cruise.png, before). Elliptical and feathered from
  // the middle of the element's own box, so it costs nothing to position.
  // Drawn in a unit space scaled to the box, so the falloff is a circle in THAT space and
  // an ellipse on screen. Doing it the other way round — a circular gradient clipped to an
  // ellipse — leaves a hard edge across any element wider than it is tall, which is most
  // of them.
  const scrim = (x, y, w, h, a) => {
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(w / 2, h / 2);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0.00, `rgba(2,6,10,${a})`);
    grad.addColorStop(0.52, `rgba(2,6,10,${(a * 0.74).toFixed(3)})`);
    grad.addColorStop(1.00, 'rgba(2,6,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };

  const place = (el, x, y, alpha = 1, extra) => {
    // Elements above the wipe line are up; the one it is crossing is brighter, as if the
    // scan is drawing it.
    const cy = (y + el.h * u * 0.5) / H;
    if (booting) {
      if (cy > wipe * 1.25) return;
      alpha *= Math.min(1, (wipe * 1.25 - cy) * 6);
    }
    if (alpha <= 0.01) return;
    // The reticle gets no scrim: the centre of the visor stays completely clear, which is
    // the rule the whole layout is built on.
    if (el !== api.parts.cross) {
      scrim(x - 14 * u, y - 14 * u, (el.w + 28) * u, (el.h + 28) * u, 0.34 * alpha);
    }
    g.save();
    g.translate(x, y);
    g.scale(u, u);
    pen.scale = u;
    pen.dim = alpha;
    el.draw(pen, t, extra);
    pen.dim = 1;
    g.restore();
  };

  const P = api.parts;
  place(P.speed, M, M + 6 * u);
  place(P.heading, W / 2 - P.heading.w * u / 2, M * 0.6);
  place(P.alt, M, H / 2 - P.alt.h * u / 2);
  place(P.armor, W - M - P.armor.w * u, M * 0.8);
  place(P.data, W - M - P.data.w * u, H / 2 - P.data.h * u * 0.35);
  place(P.att, M, H - M - P.att.h * u);
  place(P.thr, W - M - P.thr.w * u, H - M - P.thr.h * u);
  place(P.warn, W / 2 - P.warn.w * u / 2, H - M - (P.warn.h + 74) * u);
  // THE CROSSHAIR IS BORESIGHTED, AND THE PARALLAX IS WHAT BREAKS THAT IF YOU LET IT.
  // Every other element rides the HUD plane, and the plane is deliberately slid against
  // the camera by the helmet's lag (see fit() below) so the furniture floats in front of
  // the world instead of being glued to it. The reticle must NOT ride that slide: the
  // repulsors fire down the camera axis, so a reticle carried sideways by the plane is a
  // reticle that no longer marks where the shot lands — up to ~26 design units off, which
  // at 400 m of range is tens of metres of miss during exactly the hard turn you are
  // most likely to be shooting through. So we cancel the plane's offset here, in canvas
  // space, and the crosshair stays nailed to the boresight while everything around it
  // swims. Measured back the other way in tools/flight-rig.html: the reticle centre and
  // the projection of flight.aimRay() agree to under a pixel at full lag.
  const uPerUnit = H / 900;                      // canvas px per HUD design unit
  const lagX = rigLag(ctx).x, lagY = rigLag(ctx).y;
  place(P.cross,
    W / 2 - P.cross.w * u / 2 + lagX * 26 * uPerUnit,
    H / 2 - P.cross.h * u / 2 + lagY * 20 * uPerUnit);

  // The legend fades out once you have been flying for a quarter of a minute.
  const legAlpha = Math.max(0, Math.min(1, (api.legendUntil - ctx.time) / 2));
  if (legAlpha > 0.01) {
    place(P.legend, W / 2 - P.legend.w * u / 2, H - M - P.legend.h * u, legAlpha);
  }

  if (booting) {
    // The scan line itself.
    const y = wipe * 1.25 * H;
    const grad = g.createLinearGradient(0, y - 26 * u, 0, y + 2);
    grad.addColorStop(0, 'rgba(150,215,255,0)');
    grad.addColorStop(1, 'rgba(150,215,255,0.30)');
    g.fillStyle = grad; g.fillRect(0, y - 26 * u, W, 26 * u);
    g.fillStyle = 'rgba(190,232,255,0.55)'; g.fillRect(0, y, W, Math.max(1, u));
  }

  api.texture.needsUpdate = true;

  // ---- fit the planes to the camera, and parallax them off the helmet's lag ------------
  const cam = ctx.camera;
  const rig = ctx.cameraRig;
  const vfov = cam.fov * Math.PI / 180;
  const aspect = cam.aspect || (buf.width / Math.max(buf.height, 1));
  const fit = (mesh, z, lag) => {
    const hh = 2 * Math.abs(z) * Math.tan(vfov / 2);
    mesh.scale.set(hh * aspect, hh, 1);
    mesh.position.set(lag.x, lag.y, z);
  };
  // Small on purpose: at 70 px of slide the furniture looked like it was falling off the
  // edges of the visor in a hard turn. This is about 25 px at full lag.
  const lx = lagX, ly = lagY;   // same clamped lag the reticle compensated for above
  const s = 2 * Math.abs(HUD_Z) * Math.tan(vfov / 2) / 900;   // one design unit in metres
  fit(api.mesh, HUD_Z, { x: -lx * 26 * s, y: ly * 20 * s });
  fit(api.helmet, HELMET_Z, { x: -lx * 6 * s, y: ly * 5 * s });
}
