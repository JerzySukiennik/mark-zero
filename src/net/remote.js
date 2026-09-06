// Other players' suits. Owned by net/.
//
// WHY THESE ARE CLONES AND NOT RIGS.
//
// suit/ loads an armour as a full rig: 37 named plates, 20 pivots, a baked rest pose and a
// blend pipeline, out of a file that is several megabytes. That is the right thing for the
// suit you are wearing and completely wrong for the seven other people in the sky — eight
// rigs is eight loads and eight pose pipelines running every frame to animate armour that is
// two hundred metres away and four pixels tall.
//
// So a remote is `rig.root.clone(true)`. Cloning a three object tree copies the transforms
// and SHARES the geometry and materials, so the tenth player costs a few matrices and not a
// tenth model. The clone is frozen in the cruise pose, which is what a flying suit looks
// like, and simply moved.
//
// INTERPOLATION. Remotes are rendered on a delay (NET.rates.interpolationMs) and drawn
// between the two snapshots that straddle that moment. Rendering the newest snapshot the
// instant it lands is what makes other players stutter: packets do not arrive on an even
// cadence, so "newest" jumps forward by varying amounts. A player deliberately shown an
// eighth of a second in the past moves perfectly smoothly.
import * as THREE from 'three';
import { NET } from './config.js';
import { REPULSOR, glowSprite } from '../combat/vfx.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

const BUFFER = 12;                    // snapshots kept per player: ~0.8 s at 15 Hz

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.4, 'rgba(255,220,170,0.5)');
  rg.addColorStop(1, 'rgba(255,138,36,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RemotePlayers {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'REMOTE_PLAYERS';
    ctx.scene.add(this.root);
    this.players = new Map();          // uid -> { group, snaps[], name, armor, health }
    this.templates = new Map();        // armour id -> a posed rig root to clone
    this.tex = softDot();
    this._labelTex = new Map();
  }

  /** A clonable, cruise-posed armour. Loaded once per armour id, then shared. */
  async _template(id) {
    if (this.templates.has(id)) return this.templates.get(id);
    const pending = (async () => {
      const { loadArmor } = await import('../suit/rig.js');
      const rig = await loadArmor(this.ctx, id);
      if (!rig) return null;
      rig.setPose('cruise', true);
      rig.updatePose(1);
      rig.root.updateMatrixWorld(true);
      return rig.root;
    })();
    this.templates.set(id, pending);
    return pending;
  }

  /** A name tag that is readable at distance and costs one sprite. */
  _label(text) {
    if (this._labelTex.has(text)) return this._labelTex.get(text);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 34px ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(text, 128, 32);
    g.fillStyle = '#dff2ff';
    g.fillText(text, 128, 32);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, toneMapped: false, fog: false });
    const s = new THREE.Sprite(m);
    s.scale.set(4.2, 1.05, 1);
    s.renderOrder = 8;
    this._labelTex.set(text, s);
    return s;
  }

  async _spawn(uid, state) {
    // Reserve the slot BEFORE the await, or a burst of snapshots for a player who is still
    // loading spawns them three times over.
    const rec = { group: new THREE.Group(), snaps: [], name: state.n || '???', armor: state.a || 'mk3', health: state.h ?? 1000, loading: true };
    this.players.set(uid, rec);
    this.root.add(rec.group);

    const tpl = await this._template(rec.armor);
    if (!this.players.has(uid)) return;                 // left while loading
    if (tpl) {
      const body = tpl.clone(true);
      body.name = 'remote_' + uid;
      rec.group.add(body);
      rec.body = body;
    }
    // Boots and palms, so a remote reads as under power rather than as a falling statue.
    rec.glows = [];
    for (const p of [[-0.16, -0.95, 0], [0.16, -0.95, 0], [-0.42, -0.1, -0.1], [0.42, -0.1, -0.1]]) {
      const s = glowSprite(this.tex, REPULSOR.bloom, 0.9);
      s.position.set(p[0], p[1], p[2]);
      s.scale.setScalar(0.5);
      rec.group.add(s);
      rec.glows.push(s);
    }
    const label = this._label(rec.name);
    label.position.set(0, 1.6, 0);
    rec.group.add(label);
    rec.label = label;
    rec.loading = false;
  }

  /** One snapshot for one player, straight off the wire. */
  push(uid, state) {
    let rec = this.players.get(uid);
    if (!rec) { this._spawn(uid, state); rec = this.players.get(uid); }
    if (!rec) return;
    rec.name = state.n || rec.name;
    rec.health = state.h ?? rec.health;
    if (state.a && state.a !== rec.armor && !rec.loading) {
      // Changed armour: drop the body and build the new one. Rare, so no cleverness.
      if (rec.body) { rec.group.remove(rec.body); rec.body = null; }
      rec.armor = state.a;
      this._template(state.a).then(tpl => {
        if (!this.players.has(uid) || rec.body) return;
        if (tpl) { rec.body = tpl.clone(true); rec.group.add(rec.body); }
      });
    }
    rec.snaps.push(state);
    if (rec.snaps.length > BUFFER) rec.snaps.shift();
  }

  remove(uid) {
    const rec = this.players.get(uid);
    if (!rec) return;
    this.root.remove(rec.group);
    this.players.delete(uid);
  }

  /** Every uid currently in the sky, with where it is right now — combat reads this. */
  forEach(fn) { for (const [uid, rec] of this.players) if (rec.group.visible) fn(uid, rec); }

  update(dt, now) {
    const target = now - NET.rates.interpolationMs;
    for (const [uid, rec] of this.players) {
      const s = rec.snaps;
      if (!s.length) { rec.group.visible = false; continue; }
      rec.group.visible = true;

      // Find the pair that straddles the render time.
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > target) i--;
      const b = s[i];
      const a = i > 0 ? s[i - 1] : b;

      if (a === b || b.t <= a.t) {
        /* Nothing to interpolate between — the buffer has run dry, which happens when a
         * player's tab is throttled or the connection stalls. Dead-reckon along their last
         * known velocity instead of freezing them mid-air: a suit coasting a little wrong is
         * much less noticeable than a suit that stops dead and then teleports. Capped, so a
         * player who genuinely vanished does not sail off across the map. */
        const ahead = Math.min(0.5, Math.max(0, (target - b.t) / 1000));
        rec.group.position.set(b.p[0] + (b.v ? b.v[0] * ahead : 0),
                               b.p[1] + (b.v ? b.v[1] * ahead : 0),
                               b.p[2] + (b.v ? b.v[2] * ahead : 0));
        rec.group.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      } else {
        const k = Math.min(1, Math.max(0, (target - a.t) / (b.t - a.t)));
        _a.set(a.p[0], a.p[1], a.p[2]); _b.set(b.p[0], b.p[1], b.p[2]);
        rec.group.position.copy(_a).lerp(_b, k);
        _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]); _qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
        rec.group.quaternion.copy(_qa).slerp(_qb, k);
      }

      // Thruster brightness from their published thrust, so you can see who is burning.
      const thr = (b.th ?? 0);
      if (rec.glows) {
        for (let g = 0; g < rec.glows.length; g++) {
          const s2 = rec.glows[g];
          const lvl = g < 2 ? thr : thr * 0.45;
          s2.material.opacity = Math.min(1, 0.1 + lvl * 0.9);
          s2.scale.setScalar(0.28 + lvl * 0.8);
        }
      }
      if (rec.label) rec.label.material.opacity = rec.health > 0 ? 1 : 0.25;
    }
  }

  dispose() {
    for (const uid of [...this.players.keys()]) this.remove(uid);
    this.ctx.scene.remove(this.root);
  }
}
