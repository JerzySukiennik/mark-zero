// The front screen. Owned by engine-core.
//
// LAYOUT taken from Jurek's Hollowtree — his instruction was the arrangement, not the look:
// a left column carrying the title and a vertical list of destinations, the live 3D scene
// filling the rest, and a veil that is opaque behind the text and clear on the right so the
// scene reads as the picture rather than as wallpaper. The look is Mark Zero's own — the
// cold cyan and the thin letter-spaced caps the HUD already uses.
//
// The right-hand "film" is not a video. It is the game: an armour is worn, flight is
// activated, and an autopilot flies it in a long banking circle while a camera tracks it.
// A rendered clip would have to be re-rendered every time the suit changed; this cannot go
// out of date, and it doubles as a permanent smoke test — if the menu looks wrong, flight
// is wrong.
import * as THREE from 'three';

const CSS = `
#mz-menu{position:absolute;inset:0;display:none;z-index:8;font:400 13px/1.5 ui-monospace,Menlo,monospace;
  color:#dff2fb;-webkit-font-smoothing:antialiased}
#mz-menu.on{display:block}
#mz-menu .veil{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(100deg,rgba(4,9,13,.95) 0%,rgba(4,9,13,.88) 26%,
    rgba(4,9,13,.30) 56%,rgba(4,9,13,.55) 100%)}
#mz-menu .col{position:absolute;left:clamp(34px,7vw,120px);top:50%;transform:translateY(-50%);
  width:min(460px,46vw);display:flex;flex-direction:column;gap:38px;pointer-events:auto}
#mz-menu .brand{display:flex;flex-direction:column;gap:14px}
#mz-menu .mk{font-size:clamp(32px,4.2vw,58px);font-weight:200;letter-spacing:.30em;
  text-transform:uppercase;line-height:1;color:#eaf6fb;white-space:nowrap}
#mz-menu .rule{height:1px;width:100%;
  background:linear-gradient(90deg,#7fd4f5,rgba(127,212,245,0))}
#mz-menu .sub{font-size:9px;letter-spacing:.42em;color:rgba(190,225,240,.5);text-transform:uppercase}
#mz-menu .nav{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-left:-14px}
#mz-menu .item{position:relative;padding:11px 14px;background:none;border:0;cursor:pointer;
  text-align:left;font:inherit;font-size:15px;letter-spacing:.30em;text-transform:uppercase;
  color:rgba(223,242,251,.55);transition:color .18s,opacity .18s}
#mz-menu .item::before{content:"";position:absolute;left:0;top:50%;width:2px;height:0;
  background:#7fd4f5;transform:translateY(-50%);transition:height .18s}
#mz-menu .item:hover,#mz-menu .item:focus-visible,#mz-menu .item.sel{color:#eaf6fb;outline:none}
#mz-menu .item:hover::before,#mz-menu .item:focus-visible::before,#mz-menu .item.sel::before{height:60%}
#mz-menu .item[disabled]{opacity:.32;cursor:default}
#mz-menu .item[disabled]:hover{color:rgba(223,242,251,.55)}
#mz-menu .item[disabled]:hover::before{height:0}
#mz-menu .foot{position:absolute;left:clamp(34px,7vw,120px);bottom:30px;
  font-size:9px;letter-spacing:.3em;color:rgba(190,225,240,.35)}
#mz-menu .pane{position:absolute;left:clamp(34px,7vw,120px);top:50%;transform:translateY(-50%);
  width:min(460px,46vw);padding:22px 24px;background:rgba(6,14,19,.82);
  border:1px solid rgba(120,200,230,.22);display:none;pointer-events:auto}
#mz-menu .pane.on{display:block}
#mz-menu .pane h3{margin:0 0 14px;font-size:11px;font-weight:400;letter-spacing:.5em;color:#8fd8f0}
#mz-menu .pane p{margin:0 0 9px;font-size:11px;color:rgba(223,242,251,.72)}
#mz-menu .pane .back{margin-top:16px}
#mz-menu .row{display:flex;justify-content:space-between;gap:16px;padding:6px 0;
  border-bottom:1px dotted rgba(120,180,205,.16);font-size:11px}
#mz-menu .row b{font-weight:400;color:rgba(190,225,240,.6)}

/* ── the multiplayer lobby ──────────────────────────────────────────────────────────
 * The panel is a decision, not a form: one row for who you are, then create-or-join, then
 * who is actually in the room. Everything below exists to make the CODE the loudest thing
 * on the panel — it is the one piece of information that has to travel across a room by
 * being read out loud. */
#mz-menu .mzin{flex:1;min-width:0;background:rgba(0,0,0,.34);color:#eaf6fb;
  border:1px solid rgba(120,200,230,.28);padding:7px 9px;font:inherit;font-size:12px;
  letter-spacing:.12em;text-transform:uppercase;outline:none;transition:border-color .15s}
#mz-menu .mzin:focus{border-color:#7fd4f5}
#mz-menu .mzin::placeholder{color:rgba(190,225,240,.28);letter-spacing:.12em}
#mz-menu .mzsplit{display:flex;align-items:center;gap:12px;margin:16px 0 4px;flex-wrap:wrap}
#mz-menu .mzor{font-size:9px;letter-spacing:.3em;color:rgba(190,225,240,.35);text-transform:uppercase}
#mz-menu .mzjoin{display:flex;align-items:center;gap:8px;flex:1;min-width:190px}
/* The code itself: big, spaced, centred, monospaced. A code you can read out. */
#mz-menu .mzcode{text-align:center;font-size:20px;letter-spacing:.42em;padding:8px 4px 8px 12px;
  font-variant-numeric:tabular-nums}
#mz-menu .mzcode.bad{border-color:#ff6b5a}
#mz-menu .item.primary{border:1px solid rgba(120,200,230,.34);padding:10px 16px;
  color:#eaf6fb;white-space:nowrap}
#mz-menu .item.primary:hover{background:rgba(127,212,245,.10)}
#mz-menu .mzmsg{min-height:1.5em;font-size:11px;color:#8fd8f0}
#mz-menu .mzmsg.err{color:#ff8f80}
#mz-menu .mzroster{display:flex;flex-direction:column;gap:3px;margin:6px 0 2px;min-height:1px}
#mz-menu .mzwho{display:flex;align-items:center;gap:8px;font-size:11px;
  color:rgba(223,242,251,.78)}
#mz-menu .mzdot{width:6px;height:6px;border-radius:50%;background:#6ee7a8;flex:none}
#mz-menu .mzwho.me .mzdot{background:#7fd4f5}
#mz-menu .mzwho em{font-style:normal;color:rgba(190,225,240,.45);font-size:9px;
  letter-spacing:.22em;text-transform:uppercase}
#mz-menu .hint{font-size:10px;color:rgba(190,225,240,.42);line-height:1.55}

/* THE LOBBY IS A DIALOG, NOT A SIDE PANEL.
 *
 * Every other pane hangs off the left column because it is a list you read. The lobby is
 * something you DO, with a code someone else has to read off your screen, so it belongs in
 * the middle where both of you are already looking. Jurek: "powinno sie pojawiac posrodku
 * ekranu". Wider than the panes, centred, and it dims the whole frame behind it. */
#mz-menu .pane[data-pane="multi"]{left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(560px,88vw);padding:30px 34px 26px;background:rgba(5,12,17,.94);
  border:1px solid rgba(120,200,230,.30);
  box-shadow:0 30px 90px rgba(0,0,0,.6),0 0 0 100vmax rgba(3,7,10,.55)}
#mz-menu .pane[data-pane="multi"] h3{margin-bottom:4px}

/* The avatar strip: six suits, pick one, it is who the others see you as. */
#mz-menu .mzavatars{display:flex;gap:8px;margin:10px 0 4px;flex-wrap:wrap}
#mz-menu .mzav{width:52px;height:52px;border:1px solid rgba(120,200,230,.22);
  background:rgba(0,0,0,.3);cursor:pointer;padding:0;position:relative;
  transition:border-color .15s,transform .12s}
#mz-menu .mzav:hover{transform:translateY(-2px)}
#mz-menu .mzav.sel{border-color:#7fd4f5;box-shadow:0 0 0 1px #7fd4f5 inset}
#mz-menu .mzav i{position:absolute;inset:7px;border-radius:2px;display:block}
#mz-menu .mzav span{position:absolute;left:0;right:0;bottom:3px;font-size:7px;
  letter-spacing:.16em;text-align:center;color:rgba(200,230,245,.6)}
#mz-menu .mzlabel{font-size:9px;letter-spacing:.34em;text-transform:uppercase;
  color:rgba(190,225,240,.45);margin:14px 0 2px}
`;

const ITEMS = [
  { id: 'single', label: 'Single player' },
  { id: 'multi', label: 'Multiplayer' },
  { id: 'settings', label: 'Settings' },
  { id: 'credits', label: 'Credits' },
];

export function installMenu(ctx, { onStart }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'mz-menu';
  el.innerHTML =
    '<div class="veil"></div>' +
    '<div class="col">' +
      '<div class="brand"><div class="mk">MARK ZERO</div><div class="rule"></div>' +
      '<div class="sub">SUIT UP &nbsp;·&nbsp; FLY</div></div>' +
      '<div class="nav"></div>' +
    '</div>' +
    '<div class="pane" data-pane="settings"><h3>SETTINGS</h3>' +
      '<div class="row"><b>Mouse sensitivity</b><span data-v="sens">—</span></div>' +
      '<div class="row"><b>Master volume</b><span data-v="vol">—</span></div>' +
      '<div class="row"><b>Shadows</b><span data-v="sh">—</span></div>' +
      '<p style="margin-top:12px">Adjust with the keys shown in CONTROLS (?).</p>' +
      '<button class="item back">Back</button></div>' +
    /* THE LOBBY.
     *
     * Rebuilt after Jurek's verdict — "caly ten UX, UI tego panelu lobby jest bardzo slaby".
     * What was wrong: the code box did not force upper case while the join path upper-cased
     * behind your back, so what you typed and what the game used were different strings; the
     * two buttons looked identical although one creates and one joins; there was no way to
     * see who is in the room; and Enter did nothing.
     *
     * The shape now: your callsign, then ONE decision (create or join), then a live roster.
     * The code field is `mzcode` — upper case, letter-spaced, centred, so a code reads like
     * a code and can be copied off a screen by someone across the room. */
    '<div class="pane" data-pane="multi"><h3>MULTIPLAYER</h3>' +
      '<p class="sub">Everyone in the same sky. Fly together, shoot each other.</p>' +
      '<p class="mzlabel">Your callsign</p>' +
      '<input class="mzin" data-v="name" maxlength="12" placeholder="JUREK" ' +
             'autocomplete="off" spellcheck="false" style="width:100%">' +
      '<p class="mzlabel">Your armour</p>' +
      '<div class="mzavatars" data-v="avatars"></div>' +
      '<div class="mzsplit">' +
        '<button class="item primary" data-act="host">Create a room</button>' +
        '<span class="mzor">or</span>' +
        '<div class="mzjoin">' +
          '<input class="mzin mzcode" data-v="code" maxlength="6" placeholder="CODE" ' +
                 'autocomplete="off" spellcheck="false" inputmode="latin" ' +
                 'aria-label="Room code">' +
          '<button class="item" data-act="join">Join</button>' +
        '</div>' +
      '</div>' +
      '<p data-v="netmsg" class="mzmsg"></p>' +
      '<div data-v="roster" class="mzroster"></div>' +
      '<p data-v="nethint" class="hint"></p>' +
      '<button class="item back">Back</button></div>' +
    '<div class="pane" data-pane="credits"><h3>CREDITS</h3>' +
      '<p>Built by Jurek with Claude.</p>' +
      '<p>Music: Ramin Djawadi, “First Flight”.</p>' +
      '<p>Sound: recordings supplied by Jurek, plus CC0 / CC BY field recordings — ' +
        'full provenance in audio/CREDITS.md.</p>' +
      '<p>Prototype textures: Kenney (CC0).</p>' +
      '<p>three.js · Rapier3D</p>' +
      '<button class="item back">Back</button></div>' +
    '<div class="foot">ESC RETURNS HERE</div>';
  document.body.appendChild(el);

  const nav = el.querySelector('.nav');
  for (const it of ITEMS) {
    const b = document.createElement('button');
    b.className = 'item';
    b.textContent = it.label + (it.note ? '  (' + it.note + ')' : '');
    if (it.disabled) b.disabled = true;
    b.addEventListener('click', () => pick(it.id));
    nav.appendChild(b);
  }
  let rosterTimer = null;
  const panes = {};
  for (const p of el.querySelectorAll('.pane')) panes[p.dataset.pane] = p;
  for (const b of el.querySelectorAll('.back')) b.addEventListener('click', () => showPane(null));

  function showPane(id) {
    for (const k of Object.keys(panes)) panes[k].classList.toggle('on', k === id);
    el.querySelector('.col').style.display = id ? 'none' : '';
  }
  function pick(id) {
    if (id === 'single') { api.hide(); onStart(); return; }
    if (id === 'multi') {
      const q = sel => el.querySelector('[data-v="' + sel + '"]');
      if (ctx.net) q('name').value = ctx.net.name;
      q('code').value = (ctx.net && ctx.net.code) || '';
      const cur = (ctx.net && ctx.net.avatar) || 'mk3';
      for (const o of q('avatars').children) o.classList.toggle('sel', o.dataset.av === cur);
      if (ctx.net) ctx.net.avatar = cur;
      const m = q('netmsg');
      m.classList.remove('err');
      m.textContent = ctx.net && ctx.net.connected
        ? ('In room ' + ctx.net.code + '.') : '';
      q('nethint').textContent = (ctx.net && ctx.net.remote)
        ? 'Anyone with this code can join, from anywhere.'
        : 'Right now a room is shared between tabs on this machine. Open a second tab, ' +
          'enter the same code, and there are two of you.';
      drawRoster();
      if (rosterTimer) clearInterval(rosterTimer);
      rosterTimer = setInterval(drawRoster, 700);
    } else if (rosterTimer) { clearInterval(rosterTimer); rosterTimer = null; }
    if (panes[id]) {
      if (id === 'settings') {
        const q = s => el.querySelector('[data-v="' + s + '"]');
        q('sens').textContent = ctx.input ? (ctx.input.sensitivity || 0).toFixed(4) : '—';
        q('vol').textContent = ctx.audio ? Math.round((ctx.audio.volume() ?? 1) * 100) + '%' : '—';
        q('sh').textContent = ctx.renderer.shadowMap.enabled ? 'on' : 'off';
      }
      showPane(id);
    }
  }

  /* ── the lobby's own behaviour ──────────────────────────────────────────────────
   * Three things the old panel did not do and Jurek asked for: the code field forces upper
   * case AS YOU TYPE (it used to upper-case silently on submit, so what you saw and what
   * the game used were different strings), Enter submits, and you can choose which armour
   * the other players see you in. */
  const AVATARS = [
    { id: 'mk1', name: 'MK I', tint: '#7a6a52' },
    { id: 'mk2', name: 'MK II', tint: '#9fb0bd' },
    { id: 'mk3', name: 'MK III', tint: '#a8352c' },
    { id: 'mk42', name: 'MK 42', tint: '#c8973f' },
    { id: 'mk50', name: 'MK L', tint: '#b23a48' },
  ];
  {
    const strip = el.querySelector('[data-v="avatars"]');
    for (const a of AVATARS) {
      const b = document.createElement('button');
      b.className = 'mzav';
      b.dataset.av = a.id;
      b.innerHTML = '<i style="background:linear-gradient(150deg,' + a.tint + ',#2a2f36)"></i>' +
                    '<span>' + a.name + '</span>';
      b.addEventListener('click', () => {
        if (ctx.net) ctx.net.avatar = a.id;
        for (const o of strip.children) o.classList.toggle('sel', o.dataset.av === a.id);
      });
      strip.appendChild(b);
    }
  }
  {
    const code = el.querySelector('[data-v="code"]');
    // Upper case while typing, and keep the caret where it was.
    code.addEventListener('input', () => {
      const at = code.selectionStart;
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      code.setSelectionRange(at, at);
      code.classList.remove('bad');
    });
    const nameEl = el.querySelector('[data-v="name"]');
    for (const f of [code, nameEl]) {
      f.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        el.querySelector('[data-act="' + (f === code ? 'join' : 'host') + '"]').click();
      });
    }
  }

  /** Who is in the room, refreshed while the panel is open. */
  function drawRoster() {
    const box = el.querySelector('[data-v="roster"]');
    if (!box) return;
    const net = ctx.net;
    if (!net || !net.connected) { box.innerHTML = ''; return; }
    // net.players is a Map keyed by peer id, not an array.
    const others = [];
    if (net.players && net.players.forEach) {
      net.players.forEach(p => others.push({ name: (p && p.name) || 'PILOT', me: false }));
    }
    const rows = [{ name: net.name || 'YOU', me: true }].concat(others);
    box.innerHTML = rows.map(r =>
      '<div class="mzwho' + (r.me ? ' me' : '') + '"><span class="mzdot"></span>' +
      r.name + (r.me ? ' <em>you</em>' : '') + '</div>').join('');
  }

  /* Multiplayer buttons. Joining does NOT start the game by itself — you pick a room and
   * then Single player as usual, so a room can be set up before anyone takes off. */
  for (const b of el.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      const q = sel => el.querySelector('[data-v="' + sel + '"]');
      const msg = q('netmsg');
      if (!ctx.net) { msg.textContent = 'Networking failed to start.'; return; }
      ctx.net.name = q('name').value;
      const act = b.dataset.act;
      const code = act === 'host' ? ctx.net.newCode() : q('code').value.trim();
      msg.classList.remove('err');
      if (act === 'join' && code.length < 4) {
        q('code').classList.add('bad');
        msg.classList.add('err');
        msg.textContent = 'A room code is four characters or more.';
        q('code').focus();
        return;
      }
      const got = ctx.net.join(code);
      if (!got) {
        msg.classList.add('err');
        msg.textContent = 'Could not join that room.';
        return;
      }
      q('code').value = got;
      msg.textContent = act === 'host'
        ? 'Room ' + got + ' is open. Read that code out, then press Single player.'
        : 'Joined ' + got + '. Press Single player when you are ready.';
      drawRoster();
    });
  }

  /* ── the attract flight ──────────────────────────────────────────────────────────
   * A real suit on a real autopilot, filmed by a camera that leads it. Kept slow: this
   * is a poster, not gameplay, and a poster that whips past is unreadable. */
  const attract = { on: false, t: 0, cam: new THREE.Vector3(), look: new THREE.Vector3() };
  const R = 190, H = 128;
  const _q = new THREE.Quaternion();
  const _x = new THREE.Vector3(1, 0, 0);
  const _o = new THREE.Vector3();

  /* THE LATE ACTIVATE, and why this counter exists.
   *
   * Loading an armour takes a second or two, so this function is async and everything
   * after the `await` runs whenever that finishes — which may be long after the player has
   * already clicked Single player and the game has reset itself. When that happened, the
   * tail of this function then called flight.activate() on the freshly reset game and
   * dropped it back into flight mode with the poster's dummy parked 130 m over the stage.
   * The screen stopped changing, and the only way out was Esc and a restart — exactly the
   * freeze Jurek reported.
   *
   * So every begin takes a ticket. hide() burns the ticket, and any await that resolves
   * after that walks away instead of touching a game it no longer owns. This is the rule
   * for every await in this file: re-check the ticket on the far side of it. */
  let attractGen = 0;

  async function beginAttract() {
    const gen = ++attractGen;
    attract.on = true; attract.t = 0;
    try {
      if (ctx.suit && ctx.suit.wear) await ctx.suit.wear('mk3');
      if (gen !== attractGen) {
        /* The player started the game while this armour was still downloading, so hide()
         * has already run and already cleaned up — but it cleaned up BEFORE this load
         * finished, and the armour we were waiting for has just installed itself onto a
         * game that is no longer the menu. Undo it here, at the only point that knows the
         * load landed late.
         *
         * Symptom when this was missing: a full Mark III standing on the player on the
         * proto stage, with ctx.state.armor rewritten to 'mk3' by suit/'s per-frame
         * follower a frame later. In third person that armour is what you see instead of
         * the avatar, which is why "nie widać avatara" survived three separate fixes. */
        /* Only clean up if this armour is still OURS. The load can land arbitrarily late —
         * long enough for the player to have reached the ring and put on a Mark of his own
         * choosing — and tearing that one off because the poster finally finished loading is
         * a worse bug than the one this branch exists to fix. Ours means: still the attract's
         * mk3, nobody has a suit on, and no ritual is running. */
        const mine = ctx.suit && ctx.suit.id === 'mk3' && !ctx.state.armor &&
                     ctx.state.mode !== 'suitup' &&
                     !(ctx.suitup && (ctx.suitup.playing || ctx.suitup.doffing));
        if (mine && ctx.suit.unequip) { ctx.suit.unequip(); ctx.state.armor = null; }
        return;
      }
      if (ctx.flight) {
        ctx.flight.activate({ position: new THREE.Vector3(R, H, 0), yaw: 0 });
        ctx.state.view = 'third';
      }
    } catch (e) { /* the menu still works over an empty sky */ }
  }

  function update(dt) {
    if (!attract.on || !ctx.flight || !ctx.flight.model) return;
    attract.t += dt;
    const m = ctx.flight.model;
    // Fly a wide banking circle by hand: a scripted path reads better than an autopilot
    // fighting its own aim, and it can never wander out of frame.
    const w = 0.085;
    const a = attract.t * w;
    m.position.set(Math.cos(a) * R, H + Math.sin(attract.t * 0.31) * 9, Math.sin(a) * R);
    const tang = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    m.velocity.copy(tang).multiplyScalar(R * w);
    m.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), tang.clone().negate(), new THREE.Vector3(0, 1, 0)));
    m.thrustMag = 1;
    m.speed_ = R * w;

    /* Place the ARMOUR by hand. The loop does not step the simulation while this screen is
     * up, so flight/ never runs and never puts the suit where the model is — the first
     * render of this screen had the camera correctly framed on a suit that was still
     * sitting at the origin. Position, the same one-metre drop from point mass to soles
     * that flight/ uses (models/CONTRACT.md), and the cruise lean so it reads as flying
     * rather than standing in the sky. */
    const root = ctx.suit && ctx.suit.root;
    if (root && ctx.suit.rig) {
      root.visible = true;
      _q.setFromAxisAngle(_x, -1.28);
      root.quaternion.copy(m.quaternion).multiply(_q);
      _o.set(0, -1, 0).applyQuaternion(root.quaternion);
      root.position.copy(m.position).add(_o);
      if (ctx.suit.setPose) ctx.suit.setPose('cruise');
      if (ctx.suit.rig.updatePose) ctx.suit.rig.updatePose(dt);
    }
    // ...and its exhaust, for the same reason: nothing else is running to draw it.
    if (ctx.flight && ctx.flight.thrustFX) {
      try { ctx.flight.thrustFX.update(dt, m, { forward: 1, fire: 0, lateral: 0 }, ctx); }
      catch (e) { /* a poster without flame is still a poster */ }
    }
    // The camera sits off the suit's right shoulder and slightly behind, so the armour
    // lands in the RIGHT half of the frame with the veil and the text on the left.
    /* Close, and looking slightly DOWN at a suit held high in the frame, so what is behind
     * it is sky rather than a grey box of blocks. At seventeen metres the armour was
     * fifty pixels of a 720-pixel frame and the poster was a picture of the stage. */
    const off = new THREE.Vector3(0.62, 0.30, 1).normalize()
      .applyQuaternion(m.quaternion).multiplyScalar(8.5);
    attract.cam.copy(m.position).add(off);
    attract.cam.y += 1.4;
    attract.look.copy(m.position).addScaledVector(tang, 3.2);
    attract.look.y += 1.9;
    /* Drive the camera DIRECTLY, and keep camOverride set as well.
     * camOverride is only a flag — flight/cameraRig reads it to know it should keep its
     * hands off. Nothing in the game applies it; MZ.cam() moves the camera itself and then
     * raises the flag. Setting the flag alone left the camera wherever the last frame put
     * it, which is why the first render of this screen was a shot of the empty stage with
     * the suit somewhere off-frame. */
    ctx.camOverride = { pos: [attract.cam.x, attract.cam.y, attract.cam.z],
                        look: [attract.look.x, attract.look.y, attract.look.z], fov: 46 };
    ctx.camera.position.copy(attract.cam);
    ctx.camera.lookAt(attract.look);
    if (ctx.camera.fov !== 46) { ctx.camera.fov = 46; ctx.camera.updateProjectionMatrix(); }
  }

  const api = {
    el,
    get open() { return el.classList.contains('on'); },
    show() { el.classList.add('on'); showPane(null); beginAttract(); },
    hide() {
      el.classList.remove('on');
      attract.on = false;
      attractGen++;                                   // burn the ticket: see beginAttract
      ctx.camOverride = null;
      /* Put the poster's dummy away HERE, not in whatever runs next. The attract flies a
       * real armour on the real flight model, so leaving the screen without standing that
       * down leaves the game in flight mode wearing a suit the player never chose. */
      if (ctx.flight && ctx.flight.deactivate) ctx.flight.deactivate();
      /* TAKE THE POSTER'S ARMOUR APART, do not merely hide it.
       *
       * Hiding left the Mk III from the attract screen fully LOADED, with ctx.suit.id still
       * 'mk3'. Anything that later turned the suit group back on — and several things do,
       * because normally an armour being loaded means an armour being worn — stood that
       * armour on the player. Rendered on a fresh game in third person, what you got was a
       * full Mk III standing where the boy should be: the reason the avatar "could not be
       * seen" was that a suit nobody had put on was standing in front of it.
       *
       * Unequipping means there is no rig to resurrect. The armour the player actually
       * chooses is loaded from the asset cache, so this costs nothing at the ring. */
      if (ctx.suit && ctx.suit.unequip) ctx.suit.unequip();
      else if (ctx.suit && ctx.suit.root) ctx.suit.root.visible = false;
      ctx.state.mode = 'onfoot';
      ctx.state.armor = null;
    },
    update,
  };
  ctx.menu = api;
  return api;
}
