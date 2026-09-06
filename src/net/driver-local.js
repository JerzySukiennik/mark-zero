// The local driver: multiplayer between tabs on this machine, over BroadcastChannel.
//
// This is not a toy stand-in for the real thing — it is how every networked feature gets
// built and verified. Open two tabs and there are two suits in the same sky, with no
// Firebase project, no credentials, no security rules and no deploy that could break
// somebody else's game. Anything that misbehaves here would misbehave over the network too,
// and here it can be reproduced in two seconds.
//
// It implements exactly the interface driver-firebase.js implements:
//
//   join(code, self)          announce yourself and start listening
//   publish(state)            your own state, called at the publish rate
//   send(kind, payload)       a one-off event everybody should see (a shot, a hit)
//   on(kind, fn)              subscribe: 'players', 'event'
//   leave()                   tidy up
//
// BroadcastChannel does NOT loop messages back to the sender, which is exactly what we
// want: a client never hears its own publish and so can never treat itself as a remote.
const CH = 'markzero-room-';

export function createLocalDriver() {
  /* THE ECHO TEST USES THIS, NOT THE PLAYER'S uid.
   *
   * BroadcastChannel does not loop a message back to the object that sent it, but it DOES
   * deliver to every other channel on the origin — including another channel in the same
   * page. So the driver still has to recognise its own traffic, and it used to do that by
   * comparing the player's uid.
   *
   * That uid came from localStorage, which is shared by every tab on the origin, so two
   * tabs of this game had the SAME uid and each one silently discarded everything the other
   * said as its own echo. Measured: twelve publishes each way, zero received, while a raw
   * BroadcastChannel between the same two frames delivered fine. Moving the uid to
   * sessionStorage was not enough either — an iframe inherits its parent's sessionStorage,
   * so the test harness still saw one identity.
   *
   * A token minted here, in memory, at driver construction cannot collide with anything: it
   * is unique per driver instance, whatever any storage says. Identity for the PLAYER stays
   * the uid; identity for the WIRE is this. */
  const instance = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let ch = null;
  let code = null;
  let me = null;
  const players = new Map();          // uid -> last state
  const handlers = { players: [], event: [] };
  let sweepTimer = 0;

  const emit = (kind, arg) => { for (const fn of handlers[kind] || []) { try { fn(arg); } catch (e) { console.error('[net]', e); } } };

  function announce() {
    // Everyone answers a hello, so a tab that joins late learns about tabs already flying
    // instead of waiting for their next publish. Without this, joining an established room
    // shows an empty sky until someone happens to move.
    ch.postMessage({ t: 'hello', from: me.uid, i: instance });
  }

  return {
    kind: 'local',
    get code() { return code; },

    join(roomCode, self) {
      code = roomCode; me = self;
      ch = new BroadcastChannel(CH + code);
      ch.onmessage = ev => {
        const m = ev.data;
        if (!m || m.i === instance) return;      // our own traffic, not someone else's
        if (m.t === 'state') {
          // Keyed by the WIRE identity: two tabs that share a stored uid are still two
          // different people in the sky, and must not overwrite each other's entry.
          players.set(m.i || m.from, m.s);
          emit('players', players);
        } else if (m.t === 'bye') {
          players.delete(m.i || m.from);
          emit('players', players);
        } else if (m.t === 'hello') {
          // Someone just arrived: tell them where we are right now.
          if (me.last) ch.postMessage({ t: 'state', from: me.uid, s: me.last, i: instance });
        } else if (m.t === 'event') {
          emit('event', m);
        }
      };
      announce();
      // Sweep players whose tab died without a 'bye' (a crash, a killed process).
      sweepTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [uid, s] of players) {
          if (now - (s.t || 0) > 45000) { players.delete(uid); changed = true; }
        }
        if (changed) emit('players', players);
      }, 5000);
      addEventListener('pagehide', () => this.leave(), { once: true });
    },

    publish(state) {
      if (!ch) return;
      me.last = state;
      ch.postMessage({ t: 'state', from: me.uid, s: state, i: instance });
    },

    send(kind, payload) {
      if (!ch) return;
      ch.postMessage({ t: 'event', kind, from: me.uid, p: payload, at: Date.now(), i: instance });
    },

    on(kind, fn) { (handlers[kind] || (handlers[kind] = [])).push(fn); },

    leave() {
      if (!ch) return;
      try { ch.postMessage({ t: 'bye', from: me.uid, i: instance }); ch.close(); } catch (e) { /* already gone */ }
      ch = null;
      clearInterval(sweepTimer);
      players.clear();
      emit('players', players);
    },
  };
}
