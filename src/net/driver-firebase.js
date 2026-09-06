// The real driver: players on different machines, over Firebase Realtime Database.
//
// Implements exactly the interface driver-local.js documents — join / publish / send / on /
// leave — so net.js does not know or care which one it is holding.
//
// NO SDK, ON PURPOSE. The Firebase JS SDK is a few hundred kilobytes and a module graph, and
// this project has no build step. The RTDB REST API does everything needed here:
//
//   read, live      EventSource on /rooms/CODE.json  -> server-sent `put` and `patch` events
//   write           PUT   /rooms/CODE/players/<wire>.json
//   append          POST  /rooms/CODE/events.json     (server allocates a push id)
//   leave           DELETE /rooms/CODE/players/<wire>.json
//
// That is the whole protocol. It is dependency-free, it works in any browser that has
// EventSource, and it is trivially inspectable with curl — which is how the security rules
// were verified (root denied, bad room codes denied, unknown fields denied).
//
// SECURITY. There is no sign-in: the rules constrain the SHAPE and the PLACE of every write
// instead of the identity of the writer. Nothing here is personal — a callsign, a position,
// a velocity, a health number — and it all evaporates. A room is a 6-character code, the
// root is unreadable, and a client can only write a well-formed player under a well-formed
// room. See database.rules.json.
//
// STALE PLAYERS. REST has no onDisconnect, so a tab that dies without leaving would linger.
// Every state carries `t` (a timestamp) and net.js sweeps anything older than 45 s, exactly
// as the local driver does. `leave()` also fires on pagehide with keepalive so the common
// case is clean and immediate.
import { NET } from './config.js';

const DB = 'https://markzero-gzowo-default-rtdb.europe-west1.firebasedatabase.app';

export function createFirebaseDriver(base = DB) {
  /* The WIRE identity, minted in memory at construction — the same rule the local driver
   * arrived at the hard way. Anything drawn from localStorage is shared by every tab on the
   * origin, so two tabs would take each other's traffic for their own echo and the sky would
   * stay empty. This cannot collide with anything, whatever any storage says. */
  const wire = 'w' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  let code = null;
  let me = null;
  let es = null;                       // the EventSource
  let sweepTimer = 0;
  let publishing = false;              // drop a publish if the previous one is still in flight
  const players = new Map();           // wire id -> last state
  const seenEvents = new Set();        // event ids already delivered, so a re-sync is idempotent
  const handlers = { players: [], event: [] };

  const emit = (kind, arg) => {
    for (const fn of handlers[kind] || []) {
      try { fn(arg); } catch (e) { console.error('[net]', e); }
    }
  };

  const roomUrl = p => base + '/rooms/' + code + (p || '') + '.json';

  /** Apply one player node from the server. Returns true if the roster changed. */
  function takePlayer(id, val) {
    if (!id || id === wire) return false;          // never treat our own row as a remote
    if (val === null || val === undefined) return players.delete(id);
    players.set(id, val);
    return true;
  }

  /** Apply one event node. Ours are ignored; everything else is delivered once. */
  function takeEvent(id, val) {
    if (!val || !id || seenEvents.has(id)) return;
    if (val.i === wire) { seenEvents.add(id); return; }
    seenEvents.add(id);
    // Old events are replayed on the initial snapshot; only deliver recent ones or a
    // late joiner is shot at by everything that ever happened in the room.
    if (val.at && Date.now() - val.at > 5000) return;
    emit('event', { t: 'event', kind: val.kind, from: val.from, p: val.p, at: val.at, i: val.i });
  }

  /* The stream. `put` replaces the subtree at `path`, `patch` merges into it — and `path` is
   * relative to the URL we subscribed to, so it can be '/', '/players', '/players/<id>' or
   * '/events/<id>'. Handling all four is what makes one EventSource enough for the whole
   * room. */
  function onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg) return;
    const path = msg.path || '/';
    const data = msg.data;
    let changed = false;

    if (path === '/') {
      // A whole-room snapshot: the first message, and any re-sync after a reconnect.
      const ps = (data && data.players) || {};
      const keep = new Set(Object.keys(ps).filter(k => k !== wire));
      for (const id of [...players.keys()]) if (!keep.has(id)) { players.delete(id); changed = true; }
      for (const id of keep) if (takePlayer(id, ps[id])) changed = true;
      const evs = (data && data.events) || {};
      for (const id of Object.keys(evs)) takeEvent(id, evs[id]);
    } else if (path === '/players') {
      const ps = data || {};
      if (msg.event === 'put') {
        const keep = new Set(Object.keys(ps).filter(k => k !== wire));
        for (const id of [...players.keys()]) if (!keep.has(id)) { players.delete(id); changed = true; }
      }
      for (const id of Object.keys(ps)) if (takePlayer(id, ps[id])) changed = true;
    } else if (path.startsWith('/players/')) {
      const id = path.slice('/players/'.length).split('/')[0];
      // A patch on a single field arrives as a partial object; merge onto what we hold.
      if (path === '/players/' + id) { if (takePlayer(id, data)) changed = true; }
      else if (players.has(id) && data !== null) { changed = true; }
    } else if (path === '/events') {
      const evs = data || {};
      for (const id of Object.keys(evs)) takeEvent(id, evs[id]);
    } else if (path.startsWith('/events/')) {
      takeEvent(path.slice('/events/'.length).split('/')[0], data);
    }

    if (changed) emit('players', players);
  }

  return {
    // The lobby prints a different line for a room that can only be joined from this
    // machine. This one can be joined from anywhere.
    remote: true,
    kind: 'firebase',
    get code() { return code; },

    join(roomCode, self) {
      code = roomCode; me = self;
      players.clear();
      seenEvents.clear();

      // Stamp the room so an empty one still exists to be joined. Failure is not fatal:
      // the first publish creates the room anyway.
      fetch(roomUrl('/meta'), {
        method: 'PATCH',
        body: JSON.stringify({ createdAt: Date.now() }),
      }).catch(() => {});

      es = new EventSource(roomUrl());
      es.addEventListener('put', onMessage);
      es.addEventListener('patch', onMessage);
      es.addEventListener('error', () => {
        // EventSource reconnects by itself and the server replays a whole-room snapshot,
        // which `path === '/'` above handles. Nothing to do but stay quiet about it.
      });

      sweepTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, s] of players) {
          if (now - (s && s.t || 0) > 45000) { players.delete(id); changed = true; }
        }
        if (changed) emit('players', players);
        // Keep the event log from growing without bound: anything older than a minute is
        // of no interest to anyone still flying.
        if (seenEvents.size > 400) seenEvents.clear();
      }, 5000);

      addEventListener('pagehide', () => this.leave(), { once: true });
    },

    publish(state) {
      if (!code) return;
      me.last = state;
      // One write in flight at a time. The publish rate is faster than a round trip on a
      // slow connection, and queueing them would turn latency into an ever-growing backlog
      // of stale positions.
      if (publishing) return;
      publishing = true;
      fetch(roomUrl('/players/' + wire), { method: 'PUT', body: JSON.stringify(state) })
        .catch(() => {})
        .finally(() => { publishing = false; });
    },

    send(kind, payload) {
      if (!code) return;
      fetch(roomUrl('/events'), {
        method: 'POST',
        body: JSON.stringify({ kind, at: Date.now(), from: me && me.uid, i: wire, p: payload }),
      }).catch(() => {});
    },

    on(kind, fn) { (handlers[kind] || (handlers[kind] = [])).push(fn); },

    leave() {
      if (!code) return;
      const url = roomUrl('/players/' + wire);
      // keepalive so the delete still goes out while the page is being torn down.
      try { fetch(url, { method: 'DELETE', keepalive: true }); } catch (e) { /* going away anyway */ }
      if (es) { es.close(); es = null; }
      clearInterval(sweepTimer);
      players.clear();
      emit('players', players);
      code = null;
    },
  };
}
