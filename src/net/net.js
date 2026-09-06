// Multiplayer. Installed from main.js, NOT a registry module — engine/registry.js is frozen
// and says so at the top, so this follows the same pattern engine/menu.js uses: installed
// beside the modules and ticked from the loop.
//
// THE SHAPE OF IT
//
//   Every client owns itself. There is no server and no host: each client simulates its own
//   suit exactly as it does in single player and publishes where it ended up. Nobody can be
//   pushed around by anybody else's frame rate, and a player with a bad connection ruins
//   only their own experience.
//
//   HITS ARE DECIDED BY THE VICTIM. A shooter publishes "I fired from here, along here, this
//   hard" and nothing else. Every client traces that ray against ITSELF, and if it lands, the
//   victim publishes its own reduced health. This is the one rule that makes a serverless
//   shooter behave: the shooter sees the target where it was 120 ms ago (see net/remote.js
//   on interpolation), so a shooter-authoritative hit is decided against a position that is
//   already wrong, and the victim is the only participant who knows where it actually is.
//   The cost is that a dishonest client could refuse to take damage. Between friends on a
//   room code that is the right trade; a server is the only real answer and this game does
//   not have one.
//
//   Nothing here touches the flight model or the combat system. It publishes what they did
//   and renders what other people's did. If the network is off, absent, or broken, the game
//   is exactly the single-player game — that is the point of keeping it out of the registry.
import * as THREE from 'three';
import { NET } from './config.js';
import { createLocalDriver } from './driver-local.js';
import { RemotePlayers } from './remote.js';

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rel = new THREE.Vector3();      // _testHit only — see the aliasing note there

function randomId(n, alphabet) {
  let s = '';
  const a = alphabet || 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint32Array(n);
  (self.crypto || window.crypto).getRandomValues(buf);
  for (let i = 0; i < n; i++) s += a[buf[i] % a.length];
  return s;
}

function stored(key, make) {
  try {
    let v = localStorage.getItem(key);
    if (!v) { v = make(); localStorage.setItem(key, v); }
    return v;
  } catch (e) { return make(); }          // private window: a fresh identity is fine
}

/** Per-TAB identity. Survives a reload of this tab; never shared with another tab. */
function sessionId(key, make) {
  try {
    let v = sessionStorage.getItem(key);
    if (!v) { v = make(); sessionStorage.setItem(key, v); }
    return v;
  } catch (e) { return make(); }
}

export function installNet(ctx) {
  /* THE IDENTITY MUST BE PER TAB, NOT PER BROWSER.
   *
   * This was localStorage, which is shared by every tab on the origin — so two tabs of this
   * game had the SAME uid. The local driver drops any message whose `from` equals its own
   * uid, because that is how it ignores its own echo, and with identical uids each client
   * threw away everything the other one said. Measured: both sides published twelve times
   * and both received nothing, while a raw BroadcastChannel between the same two frames
   * delivered fine.
   *
   * sessionStorage is per tab and survives a reload of that tab, which is exactly the
   * lifetime a player identity wants. The CALLSIGN stays in localStorage — that is a
   * preference and should follow you into every tab. */
  const uid = sessionId(NET.identityKey, () => randomId(16));
  let name = stored(NET.nameKey, () => 'PILOT-' + randomId(3, NET.codeAlphabet));

  let driver = null;
  let remotes = null;
  let code = null;
  let publishAcc = 0;
  let heartbeatAcc = 0;
  let health = NET.combat.maxHealth;
  let deadUntil = 0;
  const lastPub = { x: 0, y: 0, z: 0 };

  const api = {
    get connected() { return !!driver; },
    // Exposed for tools/mp-debug.html. A network layer you cannot look inside is a network
    // layer you cannot fix, and this one had to be taken apart once already.
    get _driver() { return driver; },
    get _remotes() { return remotes; },
    get code() { return code; },
    get uid() { return uid; },
    get name() { return name; },
    set name(v) { name = String(v || '').slice(0, 12) || name; try { localStorage.setItem(NET.nameKey, name); } catch (e) {} },
    get health() { return health; },
    get players() { return remotes ? remotes.players : new Map(); },
    get count() { return remotes ? remotes.players.size + 1 : 1; },

    /** A fresh room code, for the player who is starting the game. */
    newCode: () => randomId(NET.codeLength, NET.codeAlphabet),

    host(c) { return api.join(c || api.newCode()); },

    join(roomCode) {
      if (driver) api.leave();
      code = String(roomCode || '').toUpperCase().trim();
      if (code.length < 4) { code = null; return null; }
      remotes = new RemotePlayers(ctx);
      driver = createLocalDriver();
      driver.on('players', map => {
        // Whoever is in the map is in the sky; whoever left it is not.
        for (const [id, s] of map) remotes.push(id, s);
        for (const id of [...remotes.players.keys()]) if (!map.has(id)) remotes.remove(id);
      });
      driver.on('event', m => api._event(m));
      driver.join(code, { uid, name });
      health = NET.combat.maxHealth;
      ctx.bus.emit('net:joined', { code, uid });
      return code;
    },

    leave() {
      if (driver) { driver.leave(); driver = null; }
      if (remotes) { remotes.dispose(); remotes = null; }
      code = null;
      ctx.bus.emit('net:left', {});
    },

    /* ── incoming events ──────────────────────────────────────────────────────────────
     * A shot from somebody else. Two jobs: draw it, and work out whether it hit ME. */
    _event(m) {
      if (!remotes) return;
      if (m.kind === 'shot') {
        const o = m.p.o, d = m.p.d;
        _p.set(o[0], o[1], o[2]);
        _d.set(d[0], d[1], d[2]);
        // Draw it with the ordinary projectile system, so a remote shot looks exactly like
        // one of ours and gets the same muzzle flash, travel and impact.
        if (ctx.combat && ctx.combat.bolts) {
          ctx.combat.vfx.muzzle(_p.clone(), _d.clone(), m.p.pw || 1);
          ctx.combat.bolts.fire(_p.clone(), _d.clone(), { power: m.p.pw || 1, hand: 'R' });
        }
        api._testHit(_p, _d, m.p.pw || 1, m.from);
      } else if (m.kind === 'health') {
        const rec = remotes.players.get(m.from);
        if (rec) rec.health = m.p.h;
      }
    },

    /* THE VICTIM DECIDES. Trace the incoming shot against my own suit; if it lands, take the
     * damage and tell everyone. See the note at the top of this file for why it is this way
     * round. Distance from a point to a ray, which for a capsule-shaped target this size is
     * as good as a swept test and a great deal cheaper. */
    _testHit(origin, dir, power, from) {
      const self = api._selfPosition(_to);
      if (!self) return;
      /* ITS OWN SCRATCH VECTOR, and that is not fussiness.
       *
       * The caller hands `origin` in as the module-level `_p`, because that is where _event
       * unpacked the shot. This line then used to write into `_p` as well — so the moment
       * it computed the relative position it DESTROYED the origin it was measuring from,
       * and every subsequent term was nonsense. The symptom was a shot fired deliberately
       * straight up, a hundred metres wide of the target, registering as a clean hit.
       *
       * Reusing scratch vectors is how this file avoids allocating on every shot; the price
       * is that a function may never write to one it did not take. */
      _rel.copy(self).sub(origin);
      const along = _rel.dot(dir);
      if (along < 0 || along > 900) return;              // behind the muzzle, or out of range
      const perp = Math.sqrt(Math.max(0, _rel.lengthSq() - along * along));
      if (perp > NET.combat.hitRadius) return;
      const dmg = power >= 4 ? NET.combat.chargedDamage : NET.combat.boltDamage;
      api._damage(dmg, from);
    },

    _damage(amount, from) {
      if (Date.now() < deadUntil) return;
      health = Math.max(0, health - amount);
      ctx.bus.emit('net:hurt', { amount, from, health });
      if (ctx.ui && ctx.ui.say) ctx.ui.say(health > 0 ? 'HIT — INTEGRITY ' + Math.round(health / 10) + '%' : 'ARMOUR DOWN');
      if (health <= 0) {
        deadUntil = Date.now() + NET.combat.respawnMs;
        ctx.bus.emit('net:down', { from });
        setTimeout(() => { health = NET.combat.maxHealth; ctx.bus.emit('net:respawn', {}); }, NET.combat.respawnMs);
      }
      if (driver) driver.send('health', { h: health });
    },

    /** Where my suit is, whichever mode I am in. Null if I am not anywhere yet. */
    _selfPosition(out) {
      if (ctx.flight && ctx.flight.active && ctx.flight.model) return out.copy(ctx.flight.model.position);
      if (ctx.suit && ctx.suit.root && ctx.state.armor) return out.setFromMatrixPosition(ctx.suit.root.matrixWorld);
      if (ctx.onfoot && ctx.onfoot.position) return out.copy(ctx.onfoot.position);
      return null;
    },

    /** Called by combat/ whenever this client fires, so everybody else sees it. */
    reportShot(origin, direction, power) {
      if (!driver) return;
      driver.send('shot', {
        o: [origin.x, origin.y, origin.z],
        d: [direction.x, direction.y, direction.z],
        pw: power,
      });
    },

    update(dt) {
      if (!driver || !remotes) return;
      const now = Date.now();
      remotes.update(dt, now);

      publishAcc += dt;
      const pos = api._selfPosition(_p);
      if (!pos) return;
      const moving = Math.abs(pos.x - lastPub.x) + Math.abs(pos.y - lastPub.y) + Math.abs(pos.z - lastPub.z) > NET.rates.idleEpsilon;
      const hz = moving ? NET.rates.motionHz : NET.rates.idleMotionHz;
      if (publishAcc < 1 / hz) return;
      publishAcc = 0;
      lastPub.x = pos.x; lastPub.y = pos.y; lastPub.z = pos.z;

      const m = ctx.flight && ctx.flight.model;
      const q = (ctx.suit && ctx.suit.root) ? ctx.suit.root.quaternion : (m ? m.quaternion : null);
      driver.publish({
        t: now,
        n: name,
        a: ctx.state.armor || 'mk3',
        h: health,
        p: [pos.x, pos.y, pos.z],
        q: q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 1],
        v: m ? [m.velocity.x, m.velocity.y, m.velocity.z] : [0, 0, 0],
        th: m ? Math.min(1, m.thrustMag || 0) : 0,
      });
    },
  };

  ctx.net = api;

  /* Publishing a shot is the one place combat/ has to know the network exists, and it is one
   * line there. Doing it from a bus listener instead keeps combat/ completely unaware. */
  ctx.bus.on('repulsor:fire', ({ origin, direction, power }) => {
    if (origin && direction) api.reportShot(origin, direction, power || 1);
  });
  ctx.bus.on('repulsor:charged', ({ origin, direction }) => {
    if (origin && direction) api.reportShot(origin, direction, NET.combat.chargedDamage >= 400 ? 6 : 1);
  });

  return api;
}
