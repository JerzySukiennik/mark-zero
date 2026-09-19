// Playing with a controller. Owned by engine/input.js, which polls it once per step.
//
// WHAT THIS DOES AND DOES NOT DO.
//
// It does NOT add a second control scheme. Mark Zero's controls are one decision, recorded
// in the project note: the look direction turns the whole body, and the movement keys are
// thrust in the body's OWN axes, so spinning round and opening the throttle is a violent
// stop because of physics rather than because of a brake button. A pad that flew the suit
// some other way would be a different game on the same map.
//
// So the pad is wired to the controls that already exist, in two layers:
//
//   BUTTONS become key codes. `padKeys` is read by Input.down() alongside the real keyboard,
//           so every binding in BINDINGS works from the pad for free — interact, doff,
//           faceplate, hover lock, view, pause — and anything bound later works with no
//           change here.
//   STICKS  are analog and cannot be a key. The left stick overrides axis() when it is
//           deflected, so walking and thrust are proportional; the right stick is added to
//           the mouse delta, so it steers through exactly the same path the mouse does,
//           including the sensitivity setting and free-look.
//
// THE TRIGGERS ARE THE POINT. R2 is the main thrust and L2 is the retro burn, both analog:
// on a keyboard W is either 0 or 1, and half throttle simply does not exist. This is the one
// thing a pad does that the keyboard cannot, and it is why threading the blocks is easier
// with one.
//
// MAPPING is against the W3C "standard" layout, which Chrome, Safari and Firefox all report
// for a DualShock 4 over USB and over Bluetooth. Reading `gp.mapping === 'standard'` and
// refusing anything else is deliberate: an unknown pad reporting a random index order would
// otherwise fire the repulsors when you pressed a shoulder button.

/* Standard layout, for reference while reading the table below:
 *   0 cross   1 circle  2 square  3 triangle
 *   4 L1      5 R1      6 L2      7 R2
 *   8 share   9 options 10 L3     11 R3
 *   12/13/14/15 d-pad up/down/left/right      16 PS
 * Axes: 0/1 left stick X/Y, 2/3 right stick X/Y. */
export const PAD_BUTTONS = {
  0:  'Space',        // cross     — up / jump
  1:  'KeyC',         // circle    — down
  2:  'KeyF',         // square    — interact (tablet, step into a shell)
  3:  'KeyX',         // triangle  — take the armour off / call it back
  4:  'ShiftLeft',    // L1        — boost
  5:  null,           // R1        — fire; handled as a mouse button, see below
  6:  null,           // L2        — analog retro, see AXES
  7:  null,           // R2        — analog thrust, see AXES
  8:  'KeyV',         // share     — view
  9:  'Escape',       // options   — pause
  10: 'KeyH',         // L3        — hover lock
  11: 'KeyG',         // R3        — faceplate
  12: 'Space',        // d-pad up  — up, for players who want it on the pad
  13: 'KeyC',         // d-pad down
  14: 'KeyQ',         // d-pad left  — roll
  15: 'KeyE',         // d-pad right — roll
  16: null,           // PS        — never bound: it is the system button
};

/** Which pad button counts as the left mouse button (the repulsor trigger). */
const FIRE_BUTTON = 5;      // R1

export const PAD = {
  /* A DualShock 4 rests at a few percent off centre and never returns exactly to zero. Below
   * this the stick is treated as centred, or the suit drifts on its own for the whole
   * flight and it reads as the physics being wrong. */
  deadzone: 0.18,
  /* The right stick steers. This is in the same units as a mouse delta BEFORE sensitivity,
   * measured so that a full deflection turns about as fast as a brisk mouse sweep. */
  lookSpeed: 3.2,
  /* Sticks are linear and hands are not. Squaring the deflection (keeping the sign) gives
   * fine control near the centre and full authority at the edge — the standard cure for a
   * pad feeling twitchy. */
  lookCurve: 2.0,
  triggerFloor: 0.06,       // below this a trigger is off; L2/R2 also rest slightly high
};

function curve(v, k) { return Math.sign(v) * Math.pow(Math.abs(v), k); }

function deadzone(v) {
  const a = Math.abs(v);
  if (a < PAD.deadzone) return 0;
  // Rescale so the first live value is 0 rather than the deadzone edge — otherwise the
  // stick jumps to 18% the instant it crosses the threshold.
  return Math.sign(v) * ((a - PAD.deadzone) / (1 - PAD.deadzone));
}

export class PadInput {
  constructor() {
    this.connected = false;
    this.id = '';
    this.keys = new Set();        // key codes the pad is currently "holding"
    this.pressed = new Set();     // key codes that went down since the last poll
    this.fire = false;
    this.firePressed = false;
    this.lx = 0; this.ly = 0;     // left stick, deadzoned and rescaled
    this.rx = 0; this.ry = 0;     // right stick
    this.thrust = 0;              // R2
    this.retro = 0;               // L2
    this._was = [];               // previous button states, for edge detection
  }

  /* Read the pad. Called once per simulation step from Input.beginStep().
   *
   * Polled every step, not throttled. There WAS a four-millisecond guard here, on the
   * theory that getGamepads() returns a fresh array on each call and 120 Hz of that is
   * needless garbage. It was written on a hunch with no measurement behind it, and it
   * immediately broke four things: any two steps inside the same frame read identical stale
   * state, so a trigger pressed and read in the same frame reported the PREVIOUS frame's
   * value. Half throttle came back as full, the retro burn came back as thrust, and the
   * sticks read zero.
   *
   * This codebase has already paid for one optimisation that was never shown to help (see
   * engine/warmup.js). If the allocation ever turns up in a heap probe, fix it then, with
   * the number in hand. */
  poll() {
    const list = (typeof navigator !== 'undefined' && navigator.getGamepads)
      ? navigator.getGamepads() : null;
    let gp = null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        // `mapping === 'standard'` is the browser saying it recognised the layout. Without
        // it the indices are the driver's own and mean nothing to the table above.
        if (g && g.connected && g.mapping === 'standard') { gp = g; break; }
      }
    }
    if (!gp) {
      if (this.connected) this.reset();
      this.connected = false;
      return;
    }
    this.connected = true;
    this.id = gp.id;

    this.pressed.clear();
    this.keys.clear();
    const b = gp.buttons;
    for (let i = 0; i < b.length; i++) {
      const on = !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      const code = PAD_BUTTONS[i];
      if (code && on) this.keys.add(code);
      if (code && on && !this._was[i]) this.pressed.add(code);
      this._was[i] = on;
    }
    const fireNow = !!(b[FIRE_BUTTON] && (b[FIRE_BUTTON].pressed || b[FIRE_BUTTON].value > 0.5));
    this.firePressed = fireNow && !this.fire;
    this.fire = fireNow;

    const ax = gp.axes;
    this.lx = deadzone(ax[0] || 0);
    this.ly = deadzone(ax[1] || 0);
    this.rx = deadzone(ax[2] || 0);
    this.ry = deadzone(ax[3] || 0);

    /* The triggers. Chrome exposes L2/R2 BOTH as buttons 6/7 with an analog `value` and, on
     * some builds, as axes 4/5 running -1..1. Taking the larger of the two readings means
     * this works whichever the browser decided to do today, instead of being silently dead
     * on one of them. */
    const tv = i => (b[i] && typeof b[i].value === 'number') ? b[i].value : 0;
    const axTrig = i => (ax.length > i ? (ax[i] + 1) / 2 : 0);
    const l2 = Math.max(tv(6), axTrig(4));
    const r2 = Math.max(tv(7), axTrig(5));
    this.retro = l2 > PAD.triggerFloor ? l2 : 0;
    this.thrust = r2 > PAD.triggerFloor ? r2 : 0;
  }

  /** Everything off. Used when the pad goes away, so nothing is left stuck on. */
  reset() {
    this.keys.clear(); this.pressed.clear();
    this.fire = false; this.firePressed = false;
    this.lx = this.ly = this.rx = this.ry = 0;
    this.thrust = this.retro = 0;
    this._was.length = 0;
  }

  /** Look delta for this step, in the same units consumeMouse() returns before sensitivity. */
  look(dt) {
    if (!this.connected) return null;
    const x = curve(this.rx, PAD.lookCurve);
    const y = curve(this.ry, PAD.lookCurve);
    if (x === 0 && y === 0) return null;
    const k = PAD.lookSpeed * (dt || 1 / 60) * 60;
    return { x: x * k, y: y * k };
  }

  /** True when the left stick is doing something, so it should win over the movement keys. */
  get moving() { return this.lx !== 0 || this.ly !== 0; }
}
