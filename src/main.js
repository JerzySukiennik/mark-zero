// MARK ZERO — boot. Owned by engine-core. No other task may edit this file.
//
// main.js does five things and nothing else:
//   1. build the renderer / scene / camera             (engine/renderer.js)
//   2. build the screen shell and the input layer      (engine/ui.js, engine/input.js)
//   3. build the environment lighting                  (engine/env.js)
//   4. init every registered module in order           (engine/registry.js)
//   5. run the loop and expose the debug stepper       (engine/loop.js, engine/debug.js)
//
// Gameplay lives in the modules. See ARCHITECTURE.md.
//
// Two rules this file enforces for everyone:
//   * THE SCREEN IS NEVER BLACK. The boot panel is on screen before a single byte of
//     three.js is parsed, the sky is rendered behind it the moment the environment
//     exists, and a watchdog fades the panel whether or not the modules finished.
//   * A MODULE THAT THROWS DEGRADES, IT DOES NOT KILL THE PAGE. Every init is fenced
//     and time-limited; a failure writes a visible on-screen error and the game boots
//     without that module.

import { dedupeMaterials } from './engine/dedupe.js';
import * as THREE from 'three';
import { createRenderer } from './engine/renderer.js';
import { buildEnvironment } from './engine/env.js';
import { MODULES } from './engine/registry.js';
import { GameState } from './engine/state.js';
import { Bus } from './engine/bus.js';
import { Assets } from './engine/assets.js';
import { Loop } from './engine/loop.js';
import { installDebug } from './engine/debug.js';
import { createUI } from './engine/ui.js';
import { Input } from './engine/input.js';
import { dressWorkshop, dressLiving } from './engine/dress.js';

// Proof of life for the fallback in index.html: if this module never parsed or an
// import 404'd, this line never runs and the "did not start" screen appears instead.
window.__mzBooting = true;

const INIT_TIMEOUT = 25;   // seconds a single module may take before we move on without it
const BOOT_WATCHDOG = 12;  // seconds before the boot panel goes away regardless

const bootEl = document.getElementById('boot');
const bootBar = document.querySelector('#bootbar i');
const bootText = document.getElementById('boottext');
function progress(f, label) {
  if (bootBar) bootBar.style.right = (100 - Math.round(f * 100)) + '%';
  if (label && bootText) bootText.textContent = label;
}
function bootDone() {
  if (bootEl && !bootEl.classList.contains('gone')) bootEl.classList.add('gone');
  setTimeout(() => bootEl && bootEl.remove(), 900);
}


// Hand the browser one chance to paint between modules. Three ways of doing this and
// only one of them is safe:
//   * requestAnimationFrame alone never fires in a hidden tab or headless browser, and
//     boot hangs until the watchdog;
//   * setTimeout is CLAMPED TO ONE SECOND in a background tab, which turned an 11-module
//     boot into an 11-second stare at the loading panel — measured, not guessed;
//   * a MessageChannel message is a macrotask that neither throttles nor requires a
//     frame. Race it against rAF and whichever the browser can actually deliver wins.
function yieldToBrowser() {
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    const ch = new MessageChannel();
    ch.port1.onmessage = go;
    ch.port2.postMessage(0);
  });
}

function withTimeout(promise, seconds, what) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' timed out after ' + seconds + 's')), seconds * 1000); }),
  ]);
}

async function main() {
  const { renderer, scene, camera, composer, resize } = createRenderer(
    document.getElementById('app')
  );

  const ctx = {
    THREE, renderer, scene, camera, composer,
    state: new GameState(),
    bus: null,
    assets: new Assets(),
    modules: Object.create(null),
    camOverride: null,   // set by MZ.cam(); applied in Loop.render() after every module
    // Filled in by the modules that own them. Read them defensively:
    // another module may not have initialised yet at your init() time.
    physics: null,   // combat/physics.js
    world: null,     // world/world.js
    suit: null,      // suit/suit.js
    flight: null,    // flight/flight.js
    hud: null,       // hud/hud.js
    audio: null,     // audio/audio.js
    ui: null,        // engine/ui.js
    input: null,     // engine/input.js
    dt: 0,
    time: 0,
  };

  // The shell first, so there is somewhere to print an error from here on.
  const ui = createUI(ctx);
  window.__mzUI = ui;   // the bootstrap error handler in index.html hands over to it
  ctx.bus = new Bus(msg => ui.error(msg));
  ctx.input = new Input(renderer.domElement);

  addEventListener('resize', resize);
  resize();

  progress(0.08, 'environment');
  try {
    await withTimeout(buildEnvironment(ctx), 10, 'environment');
  } catch (e) {
    ui.error('environment failed to build — metals will render black:\n' + (e && e.stack || e));
    // A null env would make every later module explode on ctx.env.set(); give them a
    // no-op that keeps the same shape.
    ctx.env = ctx.env || { k: 0, target: 0, rate: 1, current: 'exterior',
                           mix() {}, set() {}, update() {}, sun: null, bounce: null, envs: {} };
  }

  // First real frame: the sky. From here the screen has content behind the boot panel,
  // so the panel can go translucent and the player is never looking at black.
  try { composer.render(); } catch (e) { renderer.render(scene, camera); }
  if (bootEl) bootEl.classList.add('sky');

  // The panel is not allowed to outstay its welcome. On a slow machine the modules keep
  // loading behind the Malibu sky, which is a far better thing to look at than a bar.
  // This is deliberately NOT an error: nothing is broken, it is just taking its time.
  const watchdog = setTimeout(() => {
    progress(0.9, 'still loading');
    bootDone();
  }, BOOT_WATCHDOG * 1000);

  const n = MODULES.length;
  for (let i = 0; i < n; i++) {
    const mod = MODULES[i];
    progress(0.12 + 0.84 * (i / n), mod.id);
    await yieldToBrowser();
    try {
      if (mod.init) await withTimeout(mod.init(ctx), INIT_TIMEOUT, 'module "' + mod.id + '"');
      ctx.modules[mod.id] = mod;
    } catch (e) {
      console.error('[module ' + mod.id + ']', e);
      ui.error('module "' + mod.id + '" failed to init — the game runs without it:\n' + (e && e.stack || e));
      mod.update = null; mod.render = null;
    }
  }

  clearTimeout(watchdog);

  // Cross-module wiring that could not happen at init time, because it needs two modules
  // that do not know about each other. env/ owns the lights; world/ owns where the stair
  // is; neither may import the other, so the shell introduces them.
  try {
    const st = ctx.world && ctx.world.malibu && ctx.world.malibu.stairTop;
    const bottom = ctx.world && ctx.world.spawns && ctx.world.spawns.workshop
      ? ctx.world.spawns.workshop.y : null;
    if (st && ctx.env && ctx.env.placeStairLights) ctx.env.placeStairLights(st, bottom);
  } catch (e) { /* the stairwell is simply unlit; not worth killing a boot over */ }

  /* Workshop dressing. Same category of wiring as the stair lights above and for the
   * same reason: it needs ctx.world (what was actually built) and ctx.physics (to hang
   * colliders on it), and neither exists when the modules init. registry.js is frozen so
   * this cannot be a module. Fenced: a shop with no crates in it is a worse-looking
   * game, not a broken one. */
  try {
    const d = dressWorkshop(ctx);
    if (d) console.log('[MARK ZERO] workshop dressed:', d.counts);
  } catch (e) {
    console.error('[dress]', e);
    ui.error('workshop dressing failed — the basement will be sparse:\n' + (e && e.stack || e));
  }

  /* Living-room surfaces. Same wiring, same fence: this one repairs the materials of
   * meshes world/ built (stone floor, walnut soffit) and flags the curtain-wall mullions
   * as shadow casters so the sun can rake across the opening shot. Cosmetic by
   * definition — if it throws, the room is the flat plane it was before. */
  try {
    const dl = dressLiving(ctx);
    if (dl) console.log('[MARK ZERO] living dressed:', dl);
  } catch (e) {
    console.error('[dressLiving]', e);
    ui.error('living-room surfacing failed — floor and ceiling stay untextured:\n' + (e && e.stack || e));
  }

  /* Fold the world's duplicate materials together before anything is drawn. Run on the
   * WORLD root only: the suit, the VFX pools and the dressing all have live owners that
   * mutate their materials per instance. See engine/dedupe.js for what is excluded and
   * why. */
  try {
    if (new URLSearchParams(location.search).has('nodedupe')) throw new Error('disabled by ?nodedupe');
    const d = dedupeMaterials(ctx.world && ctx.world.root ? ctx.world.root : ctx.scene);
    console.log('[MARK ZERO] materials ' + d.before + ' -> ' + d.after +
                ' (' + d.disposed + ' copies freed across ' + d.meshes + ' meshes)');
  } catch (e) { console.warn('[dedupe] skipped', e); }

  progress(1, 'ready');
  ctx.state.ready = true;
  ctx.bus.emit('ready', ctx);

  /* ── two warm-ups, both aimed at the stalls Jurek can feel ──────────────────────────
   *
   * SHADERS. three compiles a material's program the first time it is actually drawn, and
   * that compile happens inside the frame. Every "lag spike" that lands the first time you
   * open a faceplate, walk into the workshop or step out of a suit is a batch of programs
   * being built mid-frame. Measured: the first frame back in the living room after a trip
   * to the workshop cost 95 ms against a 7-9 ms steady state. compileAsync builds them off
   * the critical path instead.
   *
   * MODELS. The five armours are 5.7-8.4 MB of .glb each and were fetched only when one
   * was chosen — which is why the suit-up "takes ages to start and you see the player
   * standing there with the suit". This does NOT parse them or put them on the GPU (that
   * would be 36 MB of geometry for four suits you are not wearing); it only pulls the
   * bytes into the browser's HTTP cache, so the real load later is a parse and not a
   * download. Deliberately serial and after a delay, so it never competes with the first
   * frames.
   */
  // Not awaited anywhere, so a tab that never advances its WebGL fence just never warms.
  if (ctx.renderer.compileAsync) {
    ctx.renderer.compileAsync(ctx.scene, ctx.camera)
      .then(() => console.log('[MARK ZERO] shaders warmed'))
      .catch(() => {});
  }
  setTimeout(async () => {
    for (const id of ['mk3', 'mk1', 'mk2', 'mk42', 'mk50', 'pilot']) {
      try { await fetch('models/' + id + '.glb', { cache: 'force-cache' }); } catch (e) { /* offline is fine */ }
    }
  }, 2500);

  const loop = new Loop(ctx, MODULES);
  const MZ = installDebug(ctx, loop);

  installShell(ctx, loop, ui);

  loop.render();
  setTimeout(bootDone, 260);
  loop.start();

  // One honest line in the console for whoever is driving this from a script.
  const t = MZ.selfTest();
  if (!t.ok) console.warn('[MARK ZERO] contract gaps:', t.problems);
  console.log('[MARK ZERO] ready. MZ.selfTest(), MZ.sim(600), MZ.goto("workshop"), MZ.cam([x,y,z],[x,y,z],fov)');
}

// ------------------------------------------------------------------------------------
// pause, restart, legend, pointer lock. Owned by engine-core.
// These are handled off DOM events rather than polled, because they must work while the
// simulation is stopped — a pause key that only works when the game is running is not a
// pause key.
// ------------------------------------------------------------------------------------
function installShell(ctx, loop, ui) {
  const input = ctx.input;
  let firstLock = true;

  function setPaused(v) {
    ctx.state.paused = v;
    ui.showPause(v);
    if (v) { input.releaseLock(); ui.prompt(null); }
    else { ui.showLegend(false); grabPointer(); }
    ui.clickHint(!v && !input.locked && !ui.titleOpen);
    ctx.bus.emit(v ? 'pause' : 'resume');
  }

  /* TAKING THE MOUSE BACK AFTER A PAUSE — and why it is not one line.
   *
   * Escape does two things at once, and only one of them is ours: the browser exits
   * pointer lock, and this shell toggles the pause. Both sides then refuse to hand the
   * pointer straight back. releaseLock() sets its own 700 ms block, and Chrome refuses
   * any re-lock for about 1.25 s after an ESCAPE-initiated exit, silently — the promise
   * rejects and requestPointerLock returns having done nothing.
   *
   * So the request fired on the resuming keystroke was always dropped, and the game came
   * back unpaused with no mouse: the world still rendering, the suit no longer turning,
   * nothing on screen saying why. That is what "pressing Esc freezes the game" was. It
   * was never frozen; it had just lost its controls and said nothing about it.
   *
   * Retry past both cooldowns, then fall back to the thing that always works — a click,
   * with the hint left up so he knows to make one. */
  let grabTimer = 0;
  function grabPointer(tries = 5) {
    clearTimeout(grabTimer);
    input.blockedUntil = 0;                 // our own cooldown has served its purpose
    if (ctx.state.paused || ui.legendOpen) return;
    if (input.locked) { ui.clickHint(false); return; }
    input.requestLock();
    if (tries > 0) {
      grabTimer = setTimeout(() => grabPointer(tries - 1), 420);
    } else {
      ui.clickHint(true);
      ui.say('CLICK TO TAKE THE CONTROLS.');
    }
  }

  function restart() {
    const s = ctx.state;
    s.mode = 'onfoot'; s.armor = null; s.suitClosed = false; s.faceplateOpen = false;
    s.speed = 0; s.altitude = 0; s.throttle = 0; s.thrust = 0; s.gForce = 1;
    s.hoverLock = false; s.icing = 0; s.integrity = 1; s.power = 1;
    ctx.camOverride = null;
    ui.fade(true, 0.18);
    setTimeout(() => {
      ctx.bus.emit('restart');
      ui.fade(false, 0.55);
      ui.say('SYSTEMS RESET.');
    }, 200);
    setPaused(false);
  }

  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (ui.legendOpen) { ui.showLegend(false); if (!ctx.state.paused) input.requestLock(); return; }
      setPaused(!ctx.state.paused);
    } else if (e.code === 'Slash' || e.code === 'F1') {
      if (ctx.state.paused) { ui.showLegend(!ui.legendOpen); return; }
      ui.toggleLegend();
      if (ui.legendOpen) input.releaseLock(0); else input.requestLock();
    } else if (e.code === 'KeyR') {
      if (ctx.state.paused) restart();
    } else if (e.code === 'KeyG') {
      // Cross-module wiring, exactly like the stair lights below: suitup/ owns the
      // mechanism and hud/ and audio/ own the reactions, but no module owns the KEYBOARD,
      // so the shell introduces them. Only meaningful once there is a helmet to open.
      if (ctx.state.paused || !ctx.state.armor || !ctx.state.suitClosed) return;
      ctx.bus.emit('faceplate:toggle');
    } else if (e.code === 'KeyX') {
      // Take the armour off. Same shape as the faceplate wiring above: suit/ owns the
      // mechanism, the shell owns the keyboard. Refused in the air, because stepping out
      // of a suit at 200 m/s is a death, not a feature.
      if (ctx.state.paused || !ctx.state.armor) return;
      const f = ctx.flight;
      const airborne = f && f.model && !f.model.grounded;
      if (airborne) { if (ctx.ui) ctx.ui.say('Not in the air.'); return; }
      ctx.bus.emit('suit:doff');
    }
  });

  ctx.bus.on('ui:resume', () => setPaused(false));
  ctx.bus.on('ui:restart', () => restart());
  ctx.bus.on('ui:legend', () => ui.showLegend(true));
  ctx.bus.on('ui:pause', () => setPaused(true));

  // Clicking the canvas takes the mouse. Losing the mouse mid-game pauses, because the
  // alternative is a player whose look controls silently stopped working.
  ctx.renderer.domElement.addEventListener('mousedown', () => {
    if (ctx.state.paused || ui.legendOpen) return;
    if (!input.locked) input.requestLock();
  });
  input.onLockChange(locked => {
    ui.clickHint(!locked && !ctx.state.paused && !ui.legendOpen && !ui.titleOpen);
    if (locked && firstLock) {
      firstLock = false;
      ui.showTitle(false);
      ui.showLegend(false);
    }
    if (!locked && !ctx.state.paused && !ui.legendOpen && !ui.titleOpen && ctx.state.ready) setPaused(true);
  });

  // The first load gets a title card over the real living room, not a control panel
  // over a black screen. It leaves the moment he clicks into the game.
  ui.showTitle(true);
  ui.clickHint(false);
}

main().catch(e => {
  const box = document.getElementById('err');
  if (box) {
    box.style.display = 'block';
    box.textContent += 'MARK ZERO failed to start:\n' + (e && e.stack || e) + '\n';
  }
  const b = document.getElementById('boot');
  if (b) { const t = document.getElementById('boottext'); if (t) t.textContent = 'FAILED TO START'; }
});
