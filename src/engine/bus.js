// Tiny event bus. Modules talk through this instead of importing each other.
// Owned by engine-core.
//
// A listener that throws must not take the emitter down with it: a broken HUD listening
// for 'impact' cannot be allowed to kill the flight model that emitted it. So every
// callback is fenced, and the failure is reported once — on screen — rather than each
// of the sixty times a second the event fires.
export class Bus {
  constructor(onError) {
    this.map = new Map();
    this.onError = onError || null;
    this.broken = new Set();
    this.log = [];          // last events, for MZ.busLog()
  }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.off(name, fn);
  }
  once(name, fn) {
    const off = this.on(name, p => { off(); fn(p); });
    return off;
  }
  off(name, fn) { const s = this.map.get(name); if (s) s.delete(fn); }
  // How many listeners a name has. MZ.selfTest() uses this to prove the debug:* contract
  // is actually wired, instead of emitting into the void and calling it a pass.
  count(name) { const s = this.map.get(name); return s ? s.size : 0; }
  names() { return [...this.map.keys()].sort(); }
  emit(name, payload) {
    if (this.log.length > 200) this.log.shift();
    this.log.push(name);
    const s = this.map.get(name);
    if (!s) return;
    for (const fn of s) {
      try { fn(payload); }
      catch (e) {
        console.error('[bus ' + name + ']', e);
        const key = name + ':' + (fn.name || 'anon');
        if (!this.broken.has(key)) {
          this.broken.add(key);
          if (this.onError) this.onError('bus listener for "' + name + '" threw:\n' + (e && e.stack || e));
        }
      }
    }
  }
}
