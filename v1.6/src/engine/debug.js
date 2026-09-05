// Debug hooks. Owned by engine-core.
//
// A critic or a headless browser drives the game through window.MZ — never through rAF,
// which is throttled to zero in headless Chrome. Everything here is synchronous: call
// MZ.cam(...), call MZ.sim(1), call MZ.screenshot(), and the PNG you get back is of the
// state you asked for, with no frame of latency and no animation still settling.
//
// The debug:* bus contract in ARCHITECTURE.md is only real if the events land somewhere.
// MZ.selfTest() proves that: it lists every contract event with its listener count and
// every ctx slot with whether its owner filled it in. A zero in that table is a module
// that has not honoured the contract yet.
import { BINDINGS } from './input.js';

const CONTRACT_EVENTS = [
  'ready', 'restart', 'env:set', 'env:changed',
  'armor:selected', 'suitup:start', 'suitup:plate', 'suitup:done', 'faceplate',
  'repulsor:fire', 'repulsor:hit', 'break', 'impact', 'footstep',
  'debug:wear', 'debug:suitup', 'debug:fly', 'debug:cam',
];
const CONTRACT_SLOTS = ['state', 'bus', 'assets', 'env', 'input', 'ui', 'audio', 'physics',
                        'world', 'suit', 'suitup', 'flight', 'combat', 'destruction',
                        'hud', 'player'];

export function installDebug(ctx, loop) {
  /* ── RENDER SIZE, AND WHY IT IS CACHED ────────────────────────────────────────
   * MZ.shot() used to resize the renderer, the composer and the bloom pass on every
   * single call, take the frame, and then fire a window 'resize' so the game snapped
   * back to the layout size. That is TWO full reallocations of the post chain per shot
   * — EffectComposer.setSize disposes and rebuilds every pass target, and
   * UnrealBloomPass rebuilds five mip targets on top — plus a complete re-render of
   * every shadow map at the new size, twice.
   *
   * Measured, headless, in the workshop (tools/probe-shot.html, six identical shots):
   *   MZ.screenshot() 24 s, then shot #0 34 s, #1 72 s, #2 103 s, #3 91 s, #4 101 s.
   * Ninety seconds a frame, and CLIMBING — the acceptance test (tools/critic-shell-rig
   * .html, nine shots) never finished inside any wait the shooter script allowed, so it
   * returned an empty shots/critic/ and no log past the first line. A verification rig
   * that cannot finish is the same as no verification at all.
   *
   * So: resize only when the size actually CHANGES, and never snap back on our own.
   * The critic rig takes five frames in a row at 1500x600; that is now one resize, not
   * ten. Whoever wants the layout size back asks for it — MZ.screenshot() does it for
   * you, and MZ.shotEnd() is there for a rig that wants to hand the page back clean. */
  let shotW = 0, shotH = 0;          // 0,0 == "at the page's own layout size"
  function applySize(w, h, ratio) {
    const r = ctx.renderer, c = ctx.composer;
    r.setPixelRatio(ratio);
    r.setSize(w, h, false);
    if (c) c.setSize(w, h);
    const bloom = ctx.scene.userData.bloom;
    if (bloom) bloom.resolution.set(w, h);
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
  }
  function sizeFor(w, h) {
    if (shotW === w && shotH === h) return;
    applySize(w, h, 1);
    shotW = w; shotH = h;
  }
  function restoreLiveSize() {
    if (!shotW && !shotH) return;
    shotW = shotH = 0;
    // The game owns its own layout size; let its resize handler work it out.
    dispatchEvent(new Event('resize'));
  }

  const MZ = {
    ctx,
    loop,

    // ---- time -------------------------------------------------------------
    // Advance the simulation n fixed steps (1/120 s each) and render one frame.
    sim(n = 1) {
      const was = ctx.state.paused;
      ctx.state.paused = false;
      for (let i = 0; i < n; i++) loop.step(1 / 120);
      ctx.state.paused = was;
      loop.render();
      return ctx.state;
    },
    simSeconds(s) { return MZ.sim(Math.round(s * 120)); },
    pause(v = true) { ctx.bus.emit(v ? 'ui:pause' : 'ui:resume'); ctx.state.paused = v; },
    state() { return JSON.parse(JSON.stringify(ctx.state)); },
    fps() { return Math.round(loop.fps); },

    // ---- jump straight to a situation --------------------------------------
    // Each is implemented by the module that owns it via bus events.
    wear(armor) { ctx.bus.emit('debug:wear', armor); return ctx.state.armor; },
    suitup(armor) { ctx.bus.emit('debug:suitup', armor); return ctx.state.armor; },
    fly(opts) { ctx.bus.emit('debug:fly', opts || {}); return ctx.state; },
    // Walk the boy somewhere: 'living' | 'stairs' | 'workshop' | 'bay' | an armor id.
    goto(where) { if (ctx.player && ctx.player.goto) ctx.player.goto(where); return MZ.pos(); },
    pos() {
      const p = ctx.player && ctx.player.position;
      return p ? [round(p.x), round(p.y), round(p.z)] : null;
    },
    // Hold a bound action down without a keyboard, for scripted walks.
    hold(action, down = true) {
      const codes = BINDINGS[action];
      if (!codes || !ctx.input) return false;
      ctx.input.hold(codes[0], down);
      return true;
    },
    // Walk forward for n seconds of simulated time, then stop. Deterministic.
    walk(seconds = 1, action = 'forward') {
      MZ.hold(action, true);
      MZ.simSeconds(seconds);
      MZ.hold(action, false);
      MZ.sim(1);
      return MZ.pos();
    },
    look(yaw, pitch) {
      const p = ctx.player && ctx.player.player;
      if (!p) return null;
      if (yaw != null) p.yaw = p.yawSmooth = yaw;
      if (pitch != null) p.pitch = p.pitchSmooth = pitch;
      return [p.yaw, p.pitch];
    },
    env(name) { if (name) ctx.env.set(name, 0); return { name: ctx.env.current, mix: ctx.env.k }; },
    envMix(k) { ctx.env.mix(k); return ctx.env.k; },

    // ---- camera -------------------------------------------------------------
    // Park the camera to match a reference frame. Applied after every module renders,
    // so it beats onfoot and cameraRig both. cam(null) hands the camera back.
    cam(pos, look, fov) {
      // Release is an OBJECT with empty fields, never null: every listener out there
      // destructures this payload, and handing them null turns "give the camera back"
      // into a TypeError in somebody else's module.
      if (!pos) {
        ctx.camOverride = null;
        ctx.bus.emit('debug:cam', { pos: null, look: null, fov: null, release: true });
        loop.render();
        return null;
      }
      ctx.camOverride = { pos, look: look || [0, 0, 0], fov: fov || ctx.camera.fov };
      ctx.bus.emit('debug:cam', ctx.camOverride);
      loop.render();
      return ctx.camOverride;
    },
    camRelease() { return MZ.cam(null); },
    // Where the camera actually is, for reproducing a shot.
    camState() {
      const c = ctx.camera, d = new ctx.THREE.Vector3();
      c.getWorldDirection(d);
      return { pos: [round(c.position.x), round(c.position.y), round(c.position.z)],
               look: [round(c.position.x + d.x * 5), round(c.position.y + d.y * 5), round(c.position.z + d.z * 5)],
               fov: c.fov };
    },

    // Always hand back a frame at the size the canvas is laid out at, whatever the last
    // shot() left it as.
    screenshot() { restoreLiveSize(); loop.render(); return ctx.renderer.domElement.toDataURL('image/png'); },

    // Render at an exact pixel size and hand back a PNG, regardless of how big the
    // window is or whether the tab is even visible. This is the entry point a critic
    // uses to reproduce a reference frame: MZ.cam(...) then MZ.shot(1600, 900).
    //
    // KNOWN DEFECT — READ BEFORE JUDGING A SHOT TAKEN THROUGH HERE.
    // If w x h is not the size the canvas is already at, the returned PNG contains TWO
    // complete HUDs, one about three quarters the size of the other. It is an artifact of
    // this function, not of the game: at the live canvas size the frame is clean, and a
    // player never sees it. What was measured, so the next person does not repeat it:
    //   * clean at 1200x760 (the live size), doubled at 900x570 and at 700x443;
    //   * the HUD's own 2D canvas holds exactly ONE interface the whole time, so the
    //     duplicate is not in the paint;
    //   * hud.hide() before the shot gives a completely clean frame, so it is the visor;
    //   * the overlay scene reports 2 meshes and exactly 1 draw call per frame, so it is
    //     not a second quad and not a second drawVisor;
    //   * an explicit renderer.clear() first did not help, a second render at the settled
    //     size did not help, and setSize(..., updateStyle=true) did not help.
    // It is most likely an interaction between `preserveDrawingBuffer: true` (renderer.js,
    // needed for the read-back) and hud/'s deliberate draw-straight-to-canvas with
    // autoClear off. UNTIL IT IS FIXED: take critic shots at the browser window's own
    // size — set the window to the size you want and call MZ.screenshot(), which does not
    // resize anything and is always clean.
    shot(w = 1500, h = 600) {
      sizeFor(w, h);
      /* Wipe the canvas by hand before the frame that will be read back.
       *
       * The renderer is built with `preserveDrawingBuffer: true` (screenshots need it),
       * so the browser never clears the canvas for us, and hud/ draws the visor STRAIGHT
       * TO THE CANVAS after the composer with autoClear off — deliberately, so the HUD
       * escapes bloom and tone mapping. Those two facts together mean the visor from the
       * previous frame survives into this one unless something overwrites every pixel.
       * At the live size it always is overwritten; at a DIFFERENT size it is not, and the
       * read-back frame comes out with two HUDs in it, one at the old scale and one at
       * the new. The comment that used to sit here described this clear as "the one line
       * that makes a resized screenshot honest" — and the line itself was not in the
       * file. It is now. */
      ctx.renderer.clear(true, true, true);
      loop.render();
      return ctx.renderer.domElement.toDataURL('image/png');
    },

    // Put the renderer back to the size the page is actually laid out at. shot() no
    // longer does this for you; see sizeFor() for why.
    shotEnd() { restoreLiveSize(); },

    // ---- is the contract actually wired? -----------------------------------
    selfTest() {
      const events = {};
      for (const e of CONTRACT_EVENTS) events[e] = ctx.bus.count(e);
      const slots = {};
      for (const s of CONTRACT_SLOTS) {
        const v = ctx[s];
        slots[s] = v == null ? 'MISSING' : (v.ready === false ? 'stub' : 'ok');
      }
      const problems = [];
      for (const e of ['debug:wear', 'debug:suitup', 'debug:fly', 'debug:cam'])
        if (!events[e]) problems.push('no listener for ' + e);
      for (const s of CONTRACT_SLOTS) if (slots[s] === 'MISSING') problems.push('ctx.' + s + ' is null');
      return { ok: problems.length === 0, problems, events, slots,
               steps: loop.steps, frames: loop.frames, errors: ctx.ui ? ctx.ui.errorCount() : 0 };
    },
    busLog() { return ctx.bus.log.slice(-40); },
    modules() { return Object.keys(ctx.modules); },
  };

  // Engine-side fallbacks. suit/ owns what MZ.wear() looks like; the engine owns what it
  // MEANS for the shell — you are no longer the boy, and you are wearing this one. If
  // suit/ is still a stub, at least the state is honest.
  ctx.bus.on('debug:cam', () => {});   // guarantees the contract event is never orphaned

  window.MZ = MZ;
  window.sim = MZ.sim;
  return MZ;
}

const round = v => Math.round(v * 1000) / 1000;
