// Shared mutable game state. Owned by engine-core.
// Modules READ this freely. Only the module noted in each comment WRITES it.
export class GameState {
  constructor() {
    this.mode = 'onfoot';      // onfoot | suitup | flight   (onfoot.js / suitup.js write)
    this.armor = null;         // 'mk1'|'mk2'|'mk3'|'mk42'|'mk50'  (onfoot.js writes)
    this.suitClosed = false;   // suitup.js writes
    this.faceplateOpen = false;// suitup.js writes
    this.view = 'first';       // first | third   (cameraRig.js writes)

    // telemetry — flight.js writes, hud.js and audio.js read
    this.speed = 0;            // m/s
    this.altitude = 0;         // m above ground
    this.throttle = 0;         // 0..1
    this.gForce = 1;
    this.thrust = 0;           // 0..1 actual thruster output, drives thruster sound + VFX
    this.hoverLock = false;
    this.icing = 0;            // 0..1, Mk II only
    this.integrity = 1;        // 0..1
    this.power = 1;            // 0..1 arc reactor charge

    this.paused = false;
    this.ready = false;        // engine sets it when every module has initialised
    this.envMix = 0;           // 0 Malibu midday .. 1 workshop  (env.js writes)
  }
}
