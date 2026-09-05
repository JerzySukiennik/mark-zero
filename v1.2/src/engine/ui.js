// Screen furniture: interaction prompt, JARVIS lines, key legend, pause menu,
// and the on-screen error panel. Owned by engine-core.
//
// This is DOM, not three.js. The flight HUD is a different thing and belongs to hud/ —
// this file is only the shell around the game: the things that must still be readable
// when the renderer itself has fallen over.
//
// Tone comes from reference/hud/: hairline vector weight, wide letter-spacing,
// desaturated white with a sparing cyan accent, everything semi-transparent. Cheap
// versions are too bright, too saturated, too thick and too centred — so nothing here
// is bold, nothing is fully opaque, and the centre of the screen stays clear.

const CSS = `
#ui{position:fixed;inset:0;z-index:30;pointer-events:none;
  font:400 12px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;
  color:#cfe0e8;-webkit-font-smoothing:antialiased}
#ui .hair{stroke:#8fd8f0;fill:none;stroke-width:1;vector-effect:non-scaling-stroke}

/* --- reticle ------------------------------------------------------------- */
#ui-reticle{position:absolute;left:50%;top:50%;width:26px;height:26px;
  transform:translate(-50%,-50%);opacity:.5;transition:opacity .25s}
#ui-reticle.hot{opacity:.95}
#ui-reticle circle{stroke:#bfe8f7;fill:none;stroke-width:1}

/* --- interaction prompt -------------------------------------------------- */
#ui-prompt{position:absolute;left:50%;top:calc(50% + 54px);transform:translateX(-50%);
  display:flex;align-items:center;gap:13px;opacity:0;transition:opacity .22s ease;
  white-space:nowrap}
#ui-prompt.on{opacity:1}
#ui-prompt .ring{width:34px;height:34px;flex:none}
#ui-prompt .ring circle{fill:none;stroke-width:1.4;transform:rotate(-90deg);
  transform-origin:50% 50%}
#ui-prompt .ring .bg{stroke:rgba(160,205,225,.24)}
#ui-prompt .ring .fg{stroke:#9fe6ff;stroke-linecap:butt;transition:stroke-dashoffset .05s linear}
#ui-prompt .txt{display:flex;flex-direction:column;gap:3px}
#ui-prompt .k{font-size:9.5px;letter-spacing:.34em;color:#6e93a5;text-transform:uppercase}
#ui-prompt .n{font-size:14px;letter-spacing:.30em;color:#dff2fb;font-weight:300}
#ui-prompt .s{font-size:9px;letter-spacing:.22em;color:#5f8496}

/* --- JARVIS lines -------------------------------------------------------- */
#ui-lines{position:absolute;left:34px;bottom:30px;display:flex;flex-direction:column;
  gap:6px;max-width:44vw}
#ui-lines div{font-size:10.5px;letter-spacing:.26em;color:#9dc6d8;opacity:0;
  text-transform:uppercase;border-left:1px solid rgba(140,215,240,.45);padding-left:10px;
  animation:jline 6.2s ease forwards}
@keyframes jline{0%{opacity:0;transform:translateX(-6px)}
  9%{opacity:.92;transform:none}78%{opacity:.92}100%{opacity:0}}

/* --- top-left status ----------------------------------------------------- */
#ui-tag{position:absolute;left:34px;top:26px;font-size:9px;letter-spacing:.42em;
  color:#4d7080}
#ui-hint{position:absolute;right:30px;top:26px;font-size:9px;letter-spacing:.30em;
  color:#4d7080;text-align:right}

/* --- key legend ---------------------------------------------------------- */
#ui-legend{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  background:rgba(3,8,11,.82);backdrop-filter:blur(3px);pointer-events:auto}
#ui-legend.on{display:flex}
#ui-legend .panel{width:min(680px,88vw);border:1px solid rgba(120,200,230,.22);
  padding:30px 38px 26px;background:rgba(6,14,19,.72);position:relative}
#ui-legend h2{margin:0 0 22px;font-size:11px;font-weight:400;letter-spacing:.62em;
  color:#8fd8f0}
#ui-legend .cols{display:grid;grid-template-columns:1fr 1fr;gap:4px 40px}
#ui-legend .row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;
  padding:5px 0;border-bottom:1px dotted rgba(120,180,205,.16)}
#ui-legend .row b{font-weight:400;font-size:10px;letter-spacing:.2em;color:#dff2fb;
  border:1px solid rgba(150,215,240,.3);padding:2px 7px;white-space:nowrap}
#ui-legend .row span{font-size:10.5px;letter-spacing:.16em;color:#89aab9;text-align:right}
#ui-legend .foot{margin-top:22px;font-size:9px;letter-spacing:.3em;color:#557888}
#ui-legend .grp{grid-column:1/-1;margin:16px 0 4px;font-size:9px;letter-spacing:.44em;
  color:#5f93a8}
#ui-legend .grp:first-child{margin-top:0}

/* --- pause --------------------------------------------------------------- */
#ui-pause{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  flex-direction:column;gap:4px;background:rgba(2,6,9,.72);backdrop-filter:blur(4px);
  pointer-events:auto}
#ui-pause.on{display:flex}
#ui-pause h1{margin:0 0 26px;font-size:12px;font-weight:400;letter-spacing:.9em;
  color:#8fd8f0;text-indent:.9em}
#ui-pause button{pointer-events:auto;background:none;border:1px solid rgba(140,205,230,.24);
  color:#cfe6f2;font:400 11px/1 inherit;letter-spacing:.34em;padding:13px 46px;width:280px;
  cursor:pointer;transition:.16s;text-transform:uppercase;margin:0 0 8px}
#ui-pause button:hover{border-color:#8fd8f0;background:rgba(120,205,235,.10);color:#fff}
#ui-pause .sub{margin-top:16px;font-size:9px;letter-spacing:.3em;color:#4d7080}

/* --- error panel --------------------------------------------------------- */
#ui-err{position:absolute;left:0;right:0;bottom:0;max-height:46%;overflow:auto;
  display:none;background:rgba(38,9,9,.94);border-top:1px solid #7a2020;
  color:#ffc0c0;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:12px 16px 14px;white-space:pre-wrap;pointer-events:auto}
#ui-err .hd{color:#ff8f8f;letter-spacing:.3em;font-size:9px;margin-bottom:8px;
  text-transform:uppercase}
#ui-err.on{display:block}

/* --- click to play ------------------------------------------------------- */
#ui-click{position:absolute;left:50%;top:calc(50% + 96px);transform:translateX(-50%);
  font-size:9.5px;letter-spacing:.42em;color:#7fb2c8;opacity:0;transition:opacity .3s;
  text-transform:uppercase;animation:pulse 2.6s ease-in-out infinite}
#ui-click.on{opacity:.85}
@keyframes pulse{0%,100%{filter:brightness(.7)}50%{filter:brightness(1.25)}}

/* --- title card, first load ---------------------------------------------- */
/* Not a modal. The Malibu living room is behind it and it is the first thing the
   player should see; the card is a thin overlay on top of it, and it goes the moment
   he clicks. A full-screen control panel over that view would waste the shot. */
#ui-title{position:absolute;inset:0;display:none;flex-direction:column;
  align-items:center;justify-content:center;gap:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(2,6,9,.55) 0%,rgba(2,6,9,.10) 34%,
    rgba(2,6,9,.12) 66%,rgba(2,6,9,.62) 100%)}
#ui-title.on{display:flex;animation:tfade .8s ease both}
#ui-title.out{animation:tout .45s ease forwards}
@keyframes tfade{from{opacity:0}to{opacity:1}}
@keyframes tout{from{opacity:1}to{opacity:0}}
#ui-title .mk{font-size:11px;letter-spacing:1.05em;color:#8fd8f0;text-indent:1.05em;
  opacity:.95}
#ui-title .rule{width:min(430px,62vw);height:1px;margin:15px 0 13px;
  background:linear-gradient(90deg,transparent,rgba(143,216,240,.5),transparent)}
#ui-title .place{font-size:9px;letter-spacing:.5em;color:#7ba7ba;text-indent:.5em}
#ui-title .keys{display:flex;gap:26px;margin-top:40px;flex-wrap:wrap;
  justify-content:center;max-width:80vw}
#ui-title .keys div{font-size:9px;letter-spacing:.28em;color:#5d8698;
  text-transform:uppercase}
#ui-title .keys b{color:#c2dfec;font-weight:400;border:1px solid rgba(150,215,240,.28);
  padding:2px 6px;margin-right:8px}
#ui-title .go{margin-top:52px;font-size:10px;letter-spacing:.5em;color:#9fe0f5;
  text-indent:.5em;animation:pulse 2.4s ease-in-out infinite}

/* --- fade to black for a mode change ------------------------------------- */
#ui-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .5s;
  pointer-events:none}
`;

const LEGEND = [
  ['grp', 'ON FOOT'],
  ['W A S D', 'Walk'],
  ['MOUSE', 'Look'],
  ['SHIFT', 'Run'],
  ['C', 'Crouch'],
  ['SPACE', 'Jump'],
  ['F (hold)', 'Take the armor'],
  ['grp', 'IN THE SUIT'],
  ['W / S', 'Throttle'],
  ['MOUSE', 'Steer'],
  ['Q / E', 'Roll'],
  ['A / D', 'Strafe'],
  ['SPACE / C', 'Climb / descend'],
  ['H', 'Hover lock'],
  ['LEFT MOUSE', 'Repulsors'],
  ['G', 'Faceplate up / down'],
  ['V', 'First / third person'],
  ['grp', 'SHELL'],
  ['ESC', 'Pause'],
  ['?', 'This screen'],
  ['R', 'Restart (while paused)'],
];

export function createUI(ctx) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `
    <div id="ui-tag">MARK ZERO</div>
    <div id="ui-hint">? &nbsp;CONTROLS</div>
    <svg id="ui-reticle" viewBox="0 0 26 26"><circle cx="13" cy="13" r="1.6"/>
      <circle cx="13" cy="13" r="9" opacity=".35"/></svg>
    <div id="ui-prompt">
      <svg class="ring" viewBox="0 0 34 34">
        <circle class="bg" cx="17" cy="17" r="14.5"/>
        <circle class="fg" cx="17" cy="17" r="14.5" stroke-dasharray="91.1" stroke-dashoffset="91.1"/>
      </svg>
      <div class="txt"><div class="k">hold F</div><div class="n">—</div><div class="s"></div></div>
    </div>
    <div id="ui-click">click to look around</div>
    <div id="ui-lines"></div>
    <div id="ui-legend"><div class="panel">
      <h2>CONTROLS</h2><div class="cols"></div>
      <div class="foot">PRESS ? OR ESC TO CLOSE</div>
    </div></div>
    <div id="ui-pause">
      <h1>PAUSED</h1>
      <button data-act="resume">Resume</button>
      <button data-act="legend">Controls</button>
      <button data-act="restart">Restart</button>
      <button data-act="reload">Reload page</button>
      <div class="sub">ESC TO RESUME</div>
    </div>
    <div id="ui-title">
      <div class="mk">MARK ZERO</div>
      <div class="rule"></div>
      <div class="place">MALIBU POINT 10880 &nbsp;·&nbsp; 12:40</div>
      <div class="keys">
        <div><b>W A S D</b>walk</div>
        <div><b>MOUSE</b>look</div>
        <div><b>SHIFT</b>run</div>
        <div><b>C</b>crouch</div>
        <div><b>F</b>take an armor</div>
        <div><b>?</b>all controls</div>
      </div>
      <div class="go">CLICK TO BEGIN</div>
    </div>
    <div id="ui-err"><div class="hd">something broke — the rest of the game keeps running</div><div class="body"></div></div>
    <div id="ui-fade"></div>`;
  document.body.appendChild(root);

  const $ = s => root.querySelector(s);
  const promptEl = $('#ui-prompt');
  const ringFg = promptEl.querySelector('.fg');
  const promptName = promptEl.querySelector('.n');
  const promptSub = promptEl.querySelector('.s');
  const promptKey = promptEl.querySelector('.k');
  const linesEl = $('#ui-lines');
  const legendEl = $('#ui-legend');
  const pauseEl = $('#ui-pause');
  const errEl = $('#ui-err');
  const errBody = errEl.querySelector('.body');
  const reticle = $('#ui-reticle');
  const fadeEl = $('#ui-fade');
  const clickEl = $('#ui-click');
  const titleEl = $('#ui-title');
  const CIRC = 2 * Math.PI * 14.5;

  // legend rows
  const cols = legendEl.querySelector('.cols');
  for (const [a, b] of LEGEND) {
    const d = document.createElement('div');
    if (a === 'grp') { d.className = 'grp'; d.textContent = b; }
    else { d.className = 'row'; d.innerHTML = `<b></b><span></span>`;
           d.querySelector('b').textContent = a; d.querySelector('span').textContent = b; }
    cols.appendChild(d);
  }

  let errCount = 0;
  let lastTick = -1;      // which fifth of the interact ring has already ticked

  /**
   * One interface sound. Read off ctx.bus at CALL time, never captured: createUI() runs
   * before main.js has built the bus (it has to, so that a failure in the bus itself has
   * somewhere to print), so a reference taken here would be permanently null. Silent and
   * harmless if audio/ failed to init.
   */
  function beep(cue, gain, rate) {
    const bus = ctx && ctx.bus;
    if (!bus) return;
    bus.emit('hud', { sound: cue, gain, rate });
  }

  const ui = {
    root,
    // --- interaction prompt ---------------------------------------------------
    // show({name, sub, key, progress 0..1}) or hide()
    prompt(o) {
      if (!o) { promptEl.classList.remove('on'); reticle.classList.remove('hot'); return; }
      promptEl.classList.add('on');
      reticle.classList.add('hot');
      // audio/ has carried a `hud` listener with nine downloaded interface recordings
      // behind it since it was written, and nothing in the game ever emitted the event —
      // so hud_select, hud_tick, hud_notify and hud_alarm shipped in the bank and were
      // unreachable. The screen furniture is what makes these noises, so it emits them.
      // Only on a CHANGE of target: the prompt is refreshed every frame while you look
      // at a case, and a blip per frame is a buzz.
      if (promptName.textContent !== o.name) {
        promptName.textContent = o.name;
        beep('select', 0.4);
        lastTick = -1;
      }
      const sub = o.sub || '';
      if (promptSub.textContent !== sub) promptSub.textContent = sub;
      const k = 'hold ' + (o.key || 'F');
      if (promptKey.textContent !== k) promptKey.textContent = k;
      const p = o.progress || 0;
      // A ladder of ticks as the hold ring fills — five steps, each fired once.
      const step = Math.floor(p * 5);
      if (step > lastTick) { lastTick = step; if (step > 0) beep('tick', 0.3, 0.94 + step * 0.05); }
      if (p <= 0) lastTick = -1;
      ringFg.setAttribute('stroke-dashoffset', String(CIRC * (1 - p)));
    },

    // --- JARVIS lines ---------------------------------------------------------
    say(text) {
      const d = document.createElement('div');
      d.textContent = text;
      linesEl.appendChild(d);
      while (linesEl.children.length > 4) linesEl.removeChild(linesEl.firstChild);
      setTimeout(() => d.remove(), 6400);
      beep('notify', 0.32);
    },

    reticleVisible(v) { reticle.style.display = v ? '' : 'none'; },
    clickHint(v) { clickEl.classList.toggle('on', !!v); },
    setTag(t) { $('#ui-tag').textContent = t; },

    // --- panels ---------------------------------------------------------------
    legendOpen: false,
    showLegend(v) {
      this.legendOpen = v;
      legendEl.classList.toggle('on', v);
      if (v) pauseEl.classList.remove('on');
    },
    toggleLegend() { this.showLegend(!this.legendOpen); },

    titleOpen: false,
    // The first-load card. Fades out rather than vanishing, so the transition into the
    // house is a dissolve and not a cut.
    showTitle(v) {
      const el = titleEl;
      if (v) {
        this.titleOpen = true;
        el.classList.remove('out'); el.classList.add('on');
      } else if (this.titleOpen) {
        this.titleOpen = false;
        el.classList.add('out');
        setTimeout(() => { el.classList.remove('on', 'out'); }, 460);
      }
    },

    pauseOpen: false,
    showPause(v) {
      this.pauseOpen = v;
      pauseEl.classList.toggle('on', v);
      if (v) legendEl.classList.remove('on');
    },

    fade(v, seconds = 0.5) {
      fadeEl.style.transitionDuration = seconds + 's';
      fadeEl.style.opacity = v ? 1 : 0;
    },

    // --- errors ---------------------------------------------------------------
    // A module that throws must leave a visible mark, never a dead black page.
    error(msg) {
      errCount++;
      if (errCount > 24) return;
      errEl.classList.add('on');
      errBody.textContent += msg + '\n';
      errEl.scrollTop = errEl.scrollHeight;
    },
    errorCount() { return errCount; },
  };

  // pause menu buttons
  pauseEl.addEventListener('click', e => {
    const act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act) return;
    if (act === 'reload') { location.reload(); return; }
    ctx.bus.emit('ui:' + act);
  });

  ctx.ui = ui;
  return ui;
}
