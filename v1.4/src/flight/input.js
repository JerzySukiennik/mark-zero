// Keyboard, mouse and pointer lock for flight. Owned by task `flight`.
//
// THE TEN SECOND RULE
// -------------------
// A thirteen-year-old must be flying before he has finished reading the legend. So there
// is no throttle lever, no trim, no separate pitch axis, no flight-assist submodes:
//
//   MOUSE            aim. The suit turns to face where you look.
//   W                thrust. This is "go".
//   S                retro — palm repulsors. Deliberately feeble (28%). It is a nudge,
//                    not a brake. To actually stop you turn around and hold W.
//   A / D            slide left / right
//   SPACE / CTRL     climb / drop
//   SHIFT            boost
//   Q / E            roll
//   H                hover hold — parks you dead still in the air
//   V                helmet view / chase view
//   LMB              repulsors
//   RMB (hold)       free look — turns your head, not the suit
//
// Six of those eleven are WASD and the mouse, which every player already knows. The other
// five are each a single key with a single meaning.
//
// The command object is a plain struct on purpose: the measurement harness in flight.js
// drives the model with hand-built commands and never touches the DOM.

const PREVENT = new Set([
  'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyH', 'KeyV', 'KeyC',
]);

// Shown by the HUD on the first few seconds of flight.
export const CONTROL_LEGEND = [
  ['MOUSE', 'AIM'],
  ['W', 'THRUST'],
  ['S', 'RETRO'],
  ['A D', 'SLIDE'],
  ['SPACE CTRL', 'CLIMB DROP'],
  ['SHIFT', 'BOOST'],
  ['Q E', 'ROLL'],
  ['H', 'HOVER'],
  ['V', 'VIEW'],
  ['LMB', 'REPULSOR'],
  ['RMB', 'LOOK'],
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.buttons = [false, false, false];
    this.blockedUntil = 0;
    this.enabled = true;
    // Radians of aim debt per pixel of mouse travel.
    this.sensitivity = 0.0024;

    const kd = (e) => {
      if (!this.enabled) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    const ku = (e) => this.keys.delete(e.code);

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.clear();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (e.button < 3) this.buttons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button < 3) this.buttons[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      // Clamp per-event movement: a pointer-lock hiccup can deliver a 3000 px jump and
      // that must not become a 40 radian aim debt.
      this.mouseDX += Math.max(-240, Math.min(240, e.movementX));
      this.mouseDY += Math.max(-240, Math.min(240, e.movementY));
    });

    window.addEventListener('wheel', (e) => {
      if (this.locked) { e.preventDefault(); this.wheel += Math.sign(e.deltaY); }
    }, { passive: false });
  }

  clear() { this.keys.clear(); this.buttons = [false, false, false]; this.mouseDX = 0; this.mouseDY = 0; }

  requestLock() {
    if (performance.now() < this.blockedUntil) return;
    const p = this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  releaseLock(cooldown = 800) {
    this.blockedUntil = performance.now() + cooldown;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  tapped(code) { return this.pressed.has(code); }
  axis(pos, neg) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }

  // Consumed once per simulation step. Returns accumulated mouse movement in pixels.
  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  endStep() { this.pressed.clear(); }
}

// The command vector the flight model consumes.
export function emptyCommand() {
  return {
    lookX: 0, lookY: 0,   // radians of aim debt added this step (yaw, pitch)
    roll: 0,              // -1..1
    forward: 0,           // -1 retro .. 1 thrust
    lateral: 0,           // -1 left .. 1 right
    vertical: 0,          // -1 down .. 1 up
    boost: 0,             // 0..1
    hoverToggle: false,
    fire: false,
    freeLook: false,
    freeLookX: 0, freeLookY: 0,
  };
}

export function readCommand(input, out) {
  const c = out || emptyCommand();
  const m = input.consumeMouse();
  c.freeLook = input.buttons[2] === true;
  if (c.freeLook) {
    c.lookX = 0; c.lookY = 0;
    c.freeLookX = -m.x * input.sensitivity;
    c.freeLookY = -m.y * input.sensitivity;
  } else {
    c.lookX = -m.x * input.sensitivity;
    c.lookY = -m.y * input.sensitivity;
    c.freeLookX = 0; c.freeLookY = 0;
  }
  c.forward = input.axis('KeyW', 'KeyS');
  c.lateral = input.axis('KeyD', 'KeyA');
  const climb = (input.down('Space') ? 1 : 0);
  const drop = (input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC')) ? 1 : 0;
  c.vertical = climb - drop;
  c.roll = input.axis('KeyE', 'KeyQ');
  c.boost = (input.down('ShiftLeft') || input.down('ShiftRight')) ? 1 : 0;
  c.hoverToggle = input.tapped('KeyH');
  c.fire = input.buttons[0] === true;
  return c;
}
