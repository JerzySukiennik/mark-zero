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
    '<div class="pane" data-pane="multi"><h3>MULTIPLAYER</h3>' +
      '<p>Everyone in the same sky. Fly together, shoot each other.</p>' +
      '<div class="row"><b>Callsign</b><input class="mzin" data-v="name" maxlength="12"></div>' +
      '<div class="row"><b>Room code</b><input class="mzin" data-v="code" maxlength="8" placeholder="ABC123"></div>' +
      '<button class="item" data-act="host">Start a new room</button>' +
      '<button class="item" data-act="join">Join that room</button>' +
      '<p data-v="netmsg" style="min-height:1.4em"></p>' +
      '<p style="opacity:.7">Right now a room is shared between TABS ON THIS MACHINE — open a ' +
        'second tab, enter the same code, and there are two of you. Playing with someone ' +
        'elsewhere needs the database rules deployed; that touches every other Gzowo game, ' +
        'so it waits for Jurek to say go.</p>' +
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
      q('netmsg').textContent = ctx.net && ctx.net.connected
        ? ('In room ' + ctx.net.code + ' — ' + ctx.net.count + ' in the sky.') : '';
    }
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

  /* Multiplayer buttons. Joining does NOT start the game by itself — you pick a room and
   * then Single player as usual, so a room can be set up before anyone takes off. */
  for (const b of el.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      const q = sel => el.querySelector('[data-v="' + sel + '"]');
      const msg = q('netmsg');
      if (!ctx.net) { msg.textContent = 'Networking failed to start.'; return; }
      ctx.net.name = q('name').value;
      const act = b.dataset.act;
      const code = act === 'host' ? ctx.net.newCode() : q('code').value.toUpperCase().trim();
      if (act === 'join' && code.length < 4) { msg.textContent = 'That code is too short.'; return; }
      const got = ctx.net.join(code);
      if (!got) { msg.textContent = 'Could not join that room.'; return; }
      q('code').value = got;
      msg.textContent = 'Room ' + got + ' — give that code to whoever is joining, then press Single player.';
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
      if (gen !== attractGen) return;                 // the player already started the game
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
      if (ctx.suit && ctx.suit.root) ctx.suit.root.visible = false;
      ctx.state.mode = 'onfoot';
      ctx.state.armor = null;
    },
    update,
  };
  ctx.menu = api;
  return api;
}
