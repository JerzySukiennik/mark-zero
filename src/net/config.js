// Networking constants for MarkZero. One place, so a rate or a key is never guessed twice.
//
// TWO DRIVERS BEHIND ONE INTERFACE, exactly as Hollowtree does it:
//
//   'local'     BroadcastChannel between tabs on this machine. No credentials, no rules,
//               no deploy. This is what makes multiplayer TESTABLE — open two tabs and two
//               suits are in the same sky. Every feature is built and verified here first.
//   'firebase'  the shared gzowos-games Realtime Database, for playing with someone else.
//
// The interface is identical, so nothing above the driver knows or cares which is running.
export const NET = {
  driver: 'local',

  // Everything for this game lives under one top-level key. On the shared database that
  // key is the game's whole territory and must never be written outside — the instance is
  // shared with every other Gzowo game and has ONE ruleset for all of them.
  root: 'markZero',

  // A room code is the only access control. No Firebase Auth on this project, so the code
  // IS the door: short enough to read out loud, long enough not to be walked into.
  codeLength: 6,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',   // no look-alike glyphs

  identityKey: 'mz.uid',
  nameKey: 'mz.name',
  maxPlayers: 8,

  rates: {
    /* 15 Hz for a suit doing 300 m/s. That is 20 m between updates, which sounds hopeless
     * and is fine: remotes are rendered on an interpolation delay and carry velocity, so
     * the gap is filled by dead reckoning rather than by teleporting. Publishing at 60 Hz
     * instead would quadruple the traffic to hide an error the interpolator already hides. */
    motionHz: 15,
    idleMotionHz: 3,        // standing in the ring: nothing is moving, say so cheaply
    idleEpsilon: 0.08,      // metres below which a frame counts as "not moving"

    /* Render remotes this far in the past. It has to exceed the publish interval (67 ms) or
     * the interpolator runs out of future and has to extrapolate, which is what makes other
     * players jitter. 120 ms costs an eighth of a second of lag on someone else's position
     * and buys a completely smooth line. */
    interpolationMs: 120,

    /* A backstop only — a player who closes the tab is removed instantly by onDisconnect,
     * so this catches crashes and dead sockets. Generous on purpose: a BACKGROUNDED TAB HAS
     * ITS TIMERS THROTTLED to as little as once a minute, and a tight window makes a player
     * who alt-tabbed vanish from everyone else's sky. Hollowtree learned this at 12 s. */
    staleMs: 45000,
    heartbeatMs: 5000,
  },

  // Combat. Hits are decided by the VICTIM, never by the shooter — see net.js.
  combat: {
    hitRadius: 1.9,         // metres; the suit is about 1.95 m tall
    boltDamage: 60,
    chargedDamage: 420,
    maxHealth: 1000,
    respawnMs: 4000,
    eventTtlMs: 4000,       // how long a shot event stays in the room before it is swept
  },
};
