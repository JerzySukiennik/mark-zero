// Keyboard, mouse and pointer lock. Owned by engine-core.
//
// One rule: this file records raw intent and nothing else. It never decides what a key
// MEANS — onfoot.js, flight.js and ui.js read the bindings below and interpret them.
// That is what lets the same physical key mean "crouch" on foot and "descend" in flight.
//
// Everything is polled from the fixed 1/120 s simulation step, not from the DOM event,
// so a machine that fires 500 mousemove events a second and one that fires 60 produce
// the same motion: the deltas accumulate and are consumed once per step.

export const BINDINGS = {
  // on foot
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  jump: ['Space'],
  interact: ['KeyF'],
  // The faceplate. suit/, suitup/, hud/ and audio/ each built their half of this
  // mechanism — the hinge, the toggle, the visor hiding, the servo and latch samples —
  // and every one of them waits on a `faceplate:toggle` that nobody was emitting, so the
  // whole thing was unreachable from a keyboard. main.js emits it from this binding.
  // KeyG because every other letter near the movement keys is already taken: WASD move,
  // Q/E roll, C crouch/descend, F interact, H hover lock, V view, R restart.
  faceplate: ['KeyG'],
  // shell
  pause: ['Escape'],
  // NOT KeyH: flight/input.js reads KeyH as the hover lock, and a key that opens a
  // control panel in mid-air while also parking the suit is one key doing two jobs.
  legend: ['Slash', 'F1'],
  restart: ['KeyR'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    // Keys held by a script rather than by a hand — MZ.hold(). Kept apart from `keys`
    // because `keys` is wiped whenever the window loses focus or the tab is hidden, and
    // a headless browser taking a screenshot counts as both. A scripted walk that was
    // silently cancelled by a screenshot is a test that lies to you.
    this.virtual = new Set();
    this.pressedRaw = new Set();   // filled by the DOM, drained into `pressed` each step
    this.pressed = new Set();      // edge-triggered, valid for exactly one sim step
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.buttons = [false, false, false];
    this.buttonsPressedRaw = new Set();
    this.buttonsPressed = new Set();
    this.blockedUntil = 0;
    this.sensitivity = 1;
    this.enabled = true;
    this._onLock = null;

    const PREVENT = new Set([
      'Space', 'ControlLeft', 'AltLeft', 'Tab',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);

    addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey && e.code === 'KeyR') return;  // let cmd-R reload
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressedRaw.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));

    // Losing focus with W held would otherwise walk the player into the sea forever.
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.clear();
      if (this._onLock) this._onLock(this.locked);
    });
    // Chrome throws this when the browser refuses a lock request (too soon after exit).
    document.addEventListener('pointerlockerror', () => { this.locked = false; });

    canvas.addEventListener('mousedown', e => {
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.buttonsPressedRaw.add(e.button);
      }
    });
    addEventListener('mouseup', e => { if (e.button < 3) this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('mousemove', e => {
      if (!this.locked || !this.enabled) return;
      // movementX can spike to hundreds on a pointer-lock re-acquire in Chrome. Clamping
      // it stops the view from snapping 180 degrees the instant you click back in.
      this.mouseDX += Math.max(-180, Math.min(180, e.movementX || 0));
      this.mouseDY += Math.max(-180, Math.min(180, e.movementY || 0));
    });

    addEventListener('wheel', e => {
      if (this.locked) { e.preventDefault(); this.wheel += Math.sign(e.deltaY); }
    }, { passive: false });
  }

  onLockChange(fn) { this._onLock = fn; }

  // Drop everything a human is holding. Virtual (scripted) keys deliberately survive.
  clear() {
    this.keys.clear();
    this.pressedRaw.clear();
    this.buttons = [false, false, false];
    this.mouseDX = this.mouseDY = 0;
  }

  requestLock() {
    if (performance.now() < this.blockedUntil) return;
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  releaseLock(cooldown = 700) {
    this.blockedUntil = performance.now() + cooldown;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // --- polled by the simulation ------------------------------------------------
  down(code) { return this.enabled && (this.keys.has(code) || this.virtual.has(code)); }
  // Hold or release a key from a script. Survives focus loss; release it yourself.
  hold(code, on = true) {
    if (on) { this.virtual.add(code); this.pressedRaw.add(code); }
    else this.virtual.delete(code);
    return on;
  }
  releaseAll() { this.virtual.clear(); this.clear(); }
  tapped(code) { return this.pressed.has(code); }
  action(name) { const b = BINDINGS[name]; return !!b && b.some(c => this.down(c)); }
  actionTapped(name) { const b = BINDINGS[name]; return !!b && b.some(c => this.pressed.has(c)); }
  button(i) { return this.enabled && !!this.buttons[i]; }
  buttonTapped(i) { return this.buttonsPressed.has(i); }

  axis(pos, neg) { return (this.action(pos) ? 1 : 0) - (this.action(neg) ? 1 : 0); }

  consumeMouse() {
    const d = { x: this.mouseDX * this.sensitivity, y: this.mouseDY * this.sensitivity };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  // Called once at the TOP of each simulation step: the edge set collected by the DOM
  // since the last step becomes this step's `pressed`. Guarantees a key tapped between
  // two steps is never lost and never seen twice.
  beginStep() {
    this.pressed = this.pressedRaw;
    this.pressedRaw = new Set();
    this.buttonsPressed = this.buttonsPressedRaw;
    this.buttonsPressedRaw = new Set();
  }
}
