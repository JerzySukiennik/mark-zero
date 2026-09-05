// Fixed-step game loop with a deterministic manual stepper. Owned by engine-core.
//
// Rendering is driven by requestAnimationFrame, but SIMULATION is a fixed 1/120 s step,
// so behaviour is identical whether the browser runs at 144 fps, 30 fps, or is a headless
// browser with rAF throttled to nothing. window.sim(n) advances exactly n steps.
//
// Two other jobs live here because they must happen in a guaranteed place in the frame:
//   * input.beginStep() at the top of every step, so a key tapped between two steps is
//     seen exactly once by every module that polls it;
//   * ctx.camOverride applied AFTER every module has rendered. MZ.cam() has to win over
//     onfoot and over cameraRig, and the only spot that is true is right here, one line
//     before the composer draws.
const STEP = 1 / 120;
const MAX_CATCHUP = 0.25;
const MAX_STEPS_PER_FRAME = 40;   // a tab that was backgrounded must not spiral

export class Loop {
  constructor(ctx, modules) {
    this.ctx = ctx;
    this.modules = modules;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.steps = 0;
    this.frames = 0;
    this.fps = 0;
    this._fpsT = 0;
    this._fpsN = 0;
  }
  start() {
    this.running = true;
    this.last = performance.now() / 1000;
    const frame = () => {
      if (!this.running) return;
      requestAnimationFrame(frame);
      const now = performance.now() / 1000;
      const delta = Math.min(now - this.last, MAX_CATCHUP);
      this.last = now;

      this._fpsN++; this._fpsT += delta;
      if (this._fpsT > 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0; }

      if (this.ctx.state.paused) {
        // Paused still consumes input edges, or the Esc that unpauses would be eaten.
        if (this.ctx.input) this.ctx.input.beginStep();
        this.render();
        return;
      }
      this.acc += delta;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS_PER_FRAME) { this.step(STEP); this.acc -= STEP; n++; }
      if (n >= MAX_STEPS_PER_FRAME) this.acc = 0;
      this.render();
    };
    requestAnimationFrame(frame);
  }
  stop() { this.running = false; }

  // One deterministic simulation tick. Called by the loop and by window.sim().
  step(dt) {
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.time += dt;
    this.steps++;
    if (ctx.input) ctx.input.beginStep();
    if (ctx.env && ctx.env.update) {
      // Lighting is not worth crashing the game for — but a throw that happens 120
      // times a second and is swallowed 120 times a second is how a room silently
      // stops being lit and nobody ever finds out. Report it once, then stop trying.
      try { ctx.env.update(dt); ctx.state.envMix = ctx.env.k; }
      catch (e) {
        console.error('[env.update]', e);
        if (ctx.ui) ctx.ui.error('environment update threw and was stopped — lighting is frozen:\n' + (e && e.stack || e));
        ctx.env.update = null;
      }
    }
    const prof = this.profile;
    for (const m of this.modules) {
      if (!m.update) continue;
      const _t0 = prof ? performance.now() : 0;
      try { m.update(dt, ctx); }
      catch (e) {
        console.error('[update ' + m.id + ']', e);
        m.update = null;   // one throw and it is out; the rest of the game keeps running
        if (ctx.ui) ctx.ui.error('module "' + m.id + '" threw during update and was stopped:\n' + (e && e.stack || e));
      }
      if (prof) {
        const ms = performance.now() - _t0;
        const r = prof[m.id] || (prof[m.id] = { total: 0, n: 0, max: 0 });
        r.total += ms; r.n++; if (ms > r.max) r.max = ms;
      }
    }
  }

  render() {

    // Shadow maps refresh on a beat rather than every frame — see renderer.js. Four is

    // the largest divisor where a walking player cannot see the shadows lag the world.

    this._shadowTick = (this._shadowTick || 0) + 1;

    if (this._shadowTick % 4 === 0) this.ctx.renderer.shadowMap.needsUpdate = true;

    const ctx = this.ctx;
    for (const m of this.modules) {
      if (!m.render) continue;
      try { m.render(ctx); }
      catch (e) {
        console.error('[render ' + m.id + ']', e);
        m.render = null;
        if (ctx.ui) ctx.ui.error('module "' + m.id + '" threw while rendering and was stopped:\n' + (e && e.stack || e));
      }
    }
    // MZ.cam() overrides everything, and it must be applied after the modules that
    // would otherwise fight it for the camera.
    const o = ctx.camOverride;
    if (o) {
      ctx.camera.position.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.camera.up.set(0, 1, 0);
      ctx.camera.lookAt(o.look[0], o.look[1], o.look[2]);
      if (o.fov && ctx.camera.fov !== o.fov) { ctx.camera.fov = o.fov; ctx.camera.updateProjectionMatrix(); }
    }
    this.frames++;
    try {
      if (ctx.composer) ctx.composer.render();
      else ctx.renderer.render(ctx.scene, ctx.camera);
    } catch (e) {
      // A shader that will not compile must not become a black page with no explanation.
      console.error('[render]', e);
      if (ctx.composer) { ctx.composer = null; ctx.renderer.render(ctx.scene, ctx.camera); }
      if (ctx.ui) ctx.ui.error('post-processing failed, falling back to a plain render:\n' + (e && e.message || e));
    }
  }
}
