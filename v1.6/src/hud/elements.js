// JARVIS HUD elements. Owned by task `hud`.
//
// Each element is a plain object { w, h, draw(pen, t) } that paints itself into a local
// coordinate box of w x h units. hud.js places the boxes around the edges of the visor
// and scales them; nothing here knows where it is on screen.
//
// Everything is a HAIRLINE. There is not one filled shape wider than three units in this
// file, because in reference/hud/hud_mk3_targeting.jpg there is not one in the film
// either. Open that image beside this code: the vertical dashed altitude ladder down the
// left, the dashed heading rule across the top with its tick scale, the concentric ring
// cluster with the little wireframe man in it, the block of grey data rows, the five
// circular icons bottom right. Those are the parts. This is the same parts list.
//
// The palette is deliberately starved: white and grey do the work, and green / red /
// blue / amber appear only where a state changes. A frame of this HUD with nothing wrong
// and nothing firing should be almost entirely monochrome.

import { clamp, pad, angDiff } from './paint.js';

const D = Math.PI / 180;

// =======================================================================================
// TOP CENTRE — heading tape. A dashed rule with a 5 degree tick scale sliding under a
// fixed caret. Straight off the top edge of hud_mk3_targeting.jpg.
// =======================================================================================
export function headingTape() {
  const W = 660, H = 44, CX = W / 2, PXDEG = 8.4;
  return {
    w: W, h: H,
    draw(pen, t) {
      const g = pen.g;
      pen.dashedLine(0, 26, W, 26, 'faint', [5, 6]);
      const h = t.heading;
      const base = Math.round(h / 5) * 5;
      for (let i = 0; i < 25; i++) {
        const deg = base + (i - 12) * 5;
        const x = CX + angDiff(deg, h) * PXDEG;
        if (x < 4 || x > W - 4) continue;
        // Fade the ends so the tape does not stop with a hard edge.
        const edge = clamp(Math.min(x, W - x) / (W * 0.16), 0, 1);
        const major = ((deg % 15) + 360) % 15 === 0;
        pen.line(x, major ? 16 : 21, x, 26, major ? 'dim' : 'faint', (major ? 0.58 : 0.30) * edge);
        if (major) {
          const d = ((deg % 360) + 360) % 360;
          const lab = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : pad(d, 3);
          pen.text(x, 12, lab, { size: 9, align: 'center', tone: 'dim', alpha: 0.62 * edge });
        }
      }
      pen.path(p => { p.moveTo(CX - 6, 34); p.lineTo(CX, 26); p.lineTo(CX + 6, 34); }, 'blu');
      pen.text(CX, 43, pad(((h % 360) + 360) % 360, 3), { size: 10, align: 'center', tone: 'blu' });
    },
  };
}

// =======================================================================================
// TOP LEFT — mach box and airspeed. The boxed MACH label is lifted straight out of the
// reference frame; the rest is what a pilot actually needs.
// =======================================================================================
export function speedBlock() {
  const W = 212, H = 100;
  return {
    w: W, h: H,
    draw(pen, t) {
      pen.rect(0.5, 0.5, 62, 14, 'dim');
      pen.text(6, 11.5, 'MACH', { size: 8, tone: 'dim' });
      pen.text(70, 11.5, t.mach.toFixed(2), { size: 10 });

      pen.text(0, 46, String(Math.round(t.speed)), { size: 30, track: 0.04 });
      pen.text(0, 60, 'M/S  AIRSPEED', { size: 8, tone: 'dim' });
      pen.text(0, 76, Math.round(t.speed * 3.6) + ' KM/H', { size: 8, tone: 'dim' });

      // The only thing in the HUD that reads as a gauge, and it is 26 dashes long.
      const f = clamp(t.speed / t.topSpeed, 0, 1.25) * 26;
      for (let i = 0; i < 26; i++) {
        const on = i < f;
        const x = i * 5.6;
        pen.line(x, on ? 82 : 86, x, 92, on ? (i > 21 ? 'red' : i > 17 ? 'amb' : 'ink') : 'faint');
      }
      const tone = t.mode === 'RETRO' ? 'amb' : t.mode.startsWith('HOVER') ? 'blu' : 'grn';
      pen.text(110, 11.5, t.mode, { size: 9, tone });
    },
  };
}

// =======================================================================================
// LEFT EDGE — the altitude ladder. Vertical dashed rule, ticks sliding past a fixed
// index, boxed readout. The single most recognisable piece of the film HUD.
// =======================================================================================
export function altLadder() {
  const W = 108, H = 440, X = 76, CY = H / 2;
  return {
    w: W, h: H,
    draw(pen, t) {
      pen.dashedLine(X, 0, X, H, 'faint', [4, 7]);
      const a = t.altitude;
      // Adaptive step so the ladder stays readable from 3 m to 20 km.
      const step = a < 300 ? 20 : a < 2000 ? 100 : a < 8000 ? 500 : 1000;
      const pxPerMetre = 190 / (step * 6);
      const base = Math.round(a / step) * step;
      for (let i = 0; i < 26; i++) {
        const v = base + (i - 13) * step;
        const y = CY - (v - a) * pxPerMetre;
        if (v < 0 || y < 6 || y > H - 6) continue;
        const edge = clamp(Math.min(y, H - y) / (H * 0.18), 0, 1);
        const major = (v / step) % 5 === 0;
        pen.line(major ? X - 11 : X - 6, y, X, y, major ? 'dim' : 'faint', (major ? 0.58 : 0.3) * edge);
        if (major) {
          pen.text(X - 15, y + 3, v >= 1000 ? (v / 1000) + 'K' : String(v),
            { size: 8, align: 'right', tone: 'dim', alpha: 0.6 * edge });
        }
      }
      pen.text(X - 15, 14, 'ALT M', { size: 8, align: 'right', tone: 'dim' });

      // Fixed index: caret plus a boxed number.
      pen.path(p => { p.moveTo(X + 9, CY - 5); p.lineTo(X + 2, CY); p.lineTo(X + 9, CY + 5); }, 'blu');
      const s = Math.round(a);
      pen.rect(X + 11, CY - 9, 16 + String(s).length * 9, 18, 'dim');
      pen.text(X + 15, CY + 5, String(s), { size: 15, track: 0.06 });

      // Climb-rate bug: the little slider that says whether you are going up or down.
      const vs = t.verticalSpeed;
      const y = clamp(CY - vs * 1.4, 30, H - 40);
      pen.fillPoly([[X + 4, y], [X + 10, y - 3], [X + 10, y + 3]], vs > 1 ? 'grn' : vs < -1 ? 'amb' : 'dim');
      pen.text(X - 15, H - 8, (vs >= 0 ? '+' : '-') + Math.abs(vs).toFixed(0) + ' M/S',
        { size: 8, align: 'right', tone: vs < -25 ? 'amb' : 'dim' });
    },
  };
}

// =======================================================================================
// TOP RIGHT — the armour cluster. Concentric arcs, a tick ring and the little wireframe
// figure. This is the signature object of the whole interface.
// =======================================================================================
export function armorCluster() {
  const S = 252, C = S / 2;
  return {
    w: S, h: S,
    draw(pen, t) {
      pen.arc(C, C, 118, -120 * D, 110 * D, 'faint');
      pen.dashedArc(C, C, 108, -100 * D, 60 * D, 'dim', [5, 7]);
      pen.arc(C, C, 98, 140 * D, 250 * D, 'faint');
      pen.arc(C, C, 89, -75 * D, 15 * D, 'faint');
      pen.dashedCircle(C, C, 76, 'faint', [3, 6]);

      // Tick ring — 72 marks, every sixth longer. Pure texture, and it is what makes the
      // cluster read as an instrument rather than a logo.
      for (let i = 0; i < 72; i++) {
        const a = i * 5 * D, maj = i % 6 === 0;
        const r0 = 82, r1 = maj ? 90 : 86;
        pen.line(C + r0 * Math.cos(a), C + r0 * Math.sin(a),
          C + r1 * Math.cos(a), C + r1 * Math.sin(a), maj ? 'dim' : 'faint');
      }

      // Integrity sweeps clockwise from lower left; power runs the inner radius.
      const sweep = (r, frac, from, tone) => {
        const f = clamp(frac, 0.004, 1);
        pen.arc(C, C, r, from, from + f * Math.PI * 1.6, tone);
      };
      sweep(94, t.integrity, -160 * D,
        t.integrity > 0.6 ? 'grn' : t.integrity > 0.3 ? 'amb' : 'red');
      sweep(70, t.power, 20 * D, t.power > 0.25 ? 'blu' : 'red');

      // ---- the wireframe figure --------------------------------------------------------
      const g = pen.g;
      g.save();
      g.translate(C - 25, C - 54);
      const tone = t.integrity > 0.75 ? 'dim' : t.integrity > 0.4 ? 'amb' : 'red';
      pen.circle(26, 9, 6.4, tone);
      pen.line(26, 15, 26, 20, tone);
      pen.poly([[13, 20], [39, 20], [41, 47], [36, 68], [16, 68], [11, 47]], tone, true);
      pen.poly([[13, 22], [2, 42], [0, 66]], tone);
      pen.poly([[39, 22], [50, 42], [52, 66]], tone);
      pen.poly([[19, 68], [16, 94], [15, 114]], tone);
      pen.poly([[33, 68], [36, 94], [37, 114]], tone);
      // Chest reactor, and the ice glaze creeping over the figure on the Mk II.
      pen.disc(26, 31, 3.2, t.power > 0.25 ? 'blu' : 'red');
      if (t.ice > 0.02) {
        for (let i = 0; i < 9; i++) {
          const y = 6 + i * 12;
          if (i / 9 > t.ice) break;
          pen.line(6, y, 46, y, 'blu', 0.30 + 0.4 * t.ice);
        }
      }
      g.restore();

      // Status dots: the tiny red/green/blue hits that keep the cluster from going grey.
      const on = [t.throttle > 0.05, t.boost, t.hover, t.ice > 0.02, t.firing];
      const col = ['grn', 'amb', 'blu', 'blu', 'red'];
      for (let i = 0; i < 5; i++) {
        const a = (-64 + i * 15) * D;
        pen.disc(C + 100 * Math.cos(a), C + 100 * Math.sin(a), 2, on[i] ? col[i] : 'faint');
      }

      pen.text(C, 20, t.armorName, { size: 11, align: 'center', track: 0.22 });
      pen.text(C - 94, S - 20, 'INTEG ' + Math.round(t.integrity * 100),
        { size: 8, tone: t.integrity < 0.45 ? 'red' : 'dim' });
      pen.text(C + 94, S - 20, 'PWR ' + Math.round(t.power * 100),
        { size: 8, align: 'right', tone: t.power < 0.2 ? 'amb' : 'dim' });
    },
  };
}

// =======================================================================================
// RIGHT EDGE — the data block. In the film this is a wall of small grey rows you cannot
// quite read; here every row is real, which is better and costs nothing.
// =======================================================================================
export function dataBlock() {
  const W = 208, H = 250;
  const ROWS = [
    ['THRUST', 'thrust'], ['POWER', 'power'], ['INTEG', 'integrity'],
    ['ICE', 'ice'], ['G LOAD', 'gnorm'], ['ALT', 'altnorm'], ['MACH', 'machnorm'],
  ];
  // The comb has to STOP short of the value column. At (W - X0 - 34) / N the last ticks
  // ran under the right-aligned number and "76%" sat on top of its own bar — visible in
  // the icing screenshot before it was fixed.
  const N = 20, X0 = 60, PITCH = (W - X0 - 62) / N;
  return {
    w: W, h: H,
    draw(pen, t) {
      const vals = {
        thrust: t.thrust, power: t.power, integrity: t.integrity, ice: t.ice,
        gnorm: clamp(t.g / 9, 0, 1), altnorm: clamp(t.altitude / 12000, 0, 1),
        machnorm: clamp(t.mach / 1.2, 0, 1),
      };
      const shown = {
        thrust: Math.round(t.thrust * 100) + '%', power: Math.round(t.power * 100) + '%',
        integrity: Math.round(t.integrity * 100) + '%', ice: Math.round(t.ice * 100) + '%',
        gnorm: t.g.toFixed(1) + 'G', altnorm: Math.round(t.altitude) + 'M',
        machnorm: t.mach.toFixed(2),
      };
      ROWS.forEach(([label, key], i) => {
        const y = 16 + i * 26;
        pen.text(0, y, label, { size: 8, tone: 'dim' });
        pen.dashedLine(X0 - 4, y - 3, W - 58, y - 3, 'faint', [3, 5]);
        const warn = (key === 'ice' && t.ice > 0.3) || (key === 'integrity' && t.integrity < 0.4) ||
          (key === 'gnorm' && t.g > 6);
        const f = vals[key] * N;
        // Tick strokes, never bars. A row that is empty is a faint comb; a row that is
        // full is a bright one; the block stays hairline either way.
        for (let c = 0; c < N; c++) {
          const on = c < f;
          const x = X0 + c * PITCH;
          pen.line(x, y - (on ? 11 : 8), x, y - 3,
            on ? (warn ? 'red' : c > 16 ? 'amb' : 'ink') : 'faint');
        }
        pen.text(W, y, shown[key], { size: 8, align: 'right', tone: warn ? 'red' : 'dim' });
      });
      pen.dashedLine(0, 200, W, 200, 'faint', [6, 6]);
      pen.text(0, 214, 'POS ' + Math.round(t.pos.x) + ' ' + Math.round(t.pos.z), { size: 8, tone: 'dim' });
      pen.text(0, 228, 'V/S ' + (t.verticalSpeed >= 0 ? '+' : '') + t.verticalSpeed.toFixed(1) + ' M/S',
        { size: 8, tone: 'dim' });
      pen.text(0, 242, 'T+ ' + Math.floor(t.time / 60) + ':' + pad(t.time % 60, 2), { size: 8, tone: 'dim' });
    },
  };
}

// =======================================================================================
// BOTTOM LEFT — attitude. A hairline artificial horizon in a ring: roll off the ring
// ticks, pitch off the sliding ladder. Small, dim, and only glanced at.
// =======================================================================================
export function attitudeBall() {
  const S = 196, C = S / 2, R = 70;
  return {
    w: S, h: S,
    draw(pen, t) {
      pen.circle(C, C, R, 'faint');
      for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const a = (-90 + d) * D;
        const r1 = d === 0 ? R + 9 : R + 5;
        pen.line(C + R * Math.cos(a), C + R * Math.sin(a),
          C + r1 * Math.cos(a), C + r1 * Math.sin(a), d === 0 ? 'dim' : 'faint');
      }
      const g = pen.g;
      g.save();
      g.beginPath(); g.arc(C, C, R - 2, 0, Math.PI * 2); g.clip();
      g.translate(C, C); g.rotate(-t.roll * D); g.translate(0, clamp(t.pitch, -80, 80) * 2.0);
      g.translate(-C, -C);
      pen.line(C - 90, C, C + 90, C, 'dim');
      for (const p of [-30, -20, -10, 10, 20, 30]) {
        const y = C - p * 2.0, w = (p % 20 === 0) ? 26 : 14;
        pen.line(C - w, y, C + w, y, 'faint');
      }
      // Sky and ground hints as dotted rules. A filled blue/brown ball would be an
      // airliner PFD, not a helmet.
      pen.dashedLine(C - 60, C - 46, C + 60, C - 46, 'faint', [3, 5]);
      pen.dashedLine(C - 60, C + 46, C + 60, C + 46, 'faint', [3, 5]);
      g.restore();

      // Fixed reference: the suit itself.
      pen.poly([[C - 20, C], [C - 7, C], [C, C + 5], [C + 7, C], [C + 20, C]], 'blu');
      pen.fillPoly([[C - 4, C - R - 4], [C, C - R + 3], [C + 4, C - R - 4]], 'blu');
      pen.text(C, S - 6, (t.pitch >= 0 ? '+' : '-') + Math.abs(t.pitch).toFixed(0) + '°',
        { size: 8, align: 'center', tone: 'dim' });
      pen.text(2, S - 6, 'ROLL ' + (t.roll >= 0 ? '+' : '-') + Math.abs(t.roll).toFixed(0),
        { size: 8, tone: 'dim' });
    },
  };
}

// =======================================================================================
// BOTTOM RIGHT — throttle scale and the row of circular mode icons.
// =======================================================================================
export function throttleAndIcons() {
  const W = 244, H = 168;
  const X = 210, TOP = 6, BOT = 112;
  const ICONS = ['FLT', 'HVR', 'BST', 'WPN', 'SYS'];
  return {
    w: W, h: H,
    draw(pen, t) {
      pen.dashedLine(X, TOP, X, BOT, 'faint', [4, 6]);
      const f = clamp(t.throttle, 0, 1) * 21;
      for (let i = 0; i < 22; i++) {
        const y = BOT - i * ((BOT - TOP) / 21);
        pen.line(X + 3, y, X + (i % 5 === 0 ? 13 : 8), y,
          i <= f ? (t.boost && i > 17 ? 'amb' : 'ink') : 'faint');
      }
      const y = BOT - clamp(t.throttle, 0, 1) * (BOT - TOP);
      pen.fillPoly([[X - 3, y], [X - 11, y - 4], [X - 11, y + 4]], 'blu');
      pen.text(X + 16, BOT + 12, 'THR', { size: 8, align: 'right', tone: 'dim' });
      pen.text(X + 16, TOP, Math.round(t.throttle * 100) + '%', { size: 8, align: 'right', tone: 'dim' });

      // Five mode lamps, as in the bottom right of hud_mk3_targeting.jpg.
      const on = [!t.hover && t.speed > 8, t.hover, t.boost, t.firing, t.integrity > 0.4 && t.power > 0.2];
      const col = ['grn', 'blu', 'amb', 'red', 'grn'];
      ICONS.forEach((label, i) => {
        const cx = 22 + i * 40, cy = 138, lit = on[i], tone = lit ? col[i] : 'faint';
        for (let k = 0; k < 4; k++) {
          const a = (k * 90 + 45) * D;
          pen.line(cx + 8 * Math.cos(a), cy + 8 * Math.sin(a),
            cx + 12 * Math.cos(a), cy + 12 * Math.sin(a), 'faint');
        }
        pen.circle(cx, cy, 12, tone);
        pen.circle(cx, cy, 5.5, lit ? col[i] : 'dim');
        pen.disc(cx, cy, 2, lit ? col[i] : 'faint');
        pen.text(cx, cy + 26, label, { size: 8, align: 'center', tone: lit ? col[i] : 'dim' });
      });
    },
  };
}

// =======================================================================================
// CENTRE — the crosshair. Boresighted to the camera, which is exactly the ray the
// repulsors fire along, so what it covers is what gets hit.
// =======================================================================================
export function reticle() {
  const S = 190, C = S / 2;
  return {
    w: S, h: S,
    draw(pen, t) {
      // A slow rotation on the outer dashed ring: the only animation in the whole HUD,
      // and it is what makes the thing read as running software rather than a decal.
      const g = pen.g;
      g.save();
      g.translate(C, C); g.rotate(t.time * 0.22); g.translate(-C, -C);
      pen.dashedCircle(C, C, 18, 'dim', [4, 6]);
      g.restore();

      pen.circle(C, C, 8.5, 'faint');
      pen.disc(C, C, 1.6, 'blu');
      // Four gapped ticks. The gap is the point: nothing crosses the middle.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        pen.line(C + dx * 23, C + dy * 23, C + dx * 34, C + dy * 34, 'ink');
      }
      // Corner brackets, wide apart, so the centre stays empty.
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        pen.poly([[C + sx * 52, C + sy * 38], [C + sx * 52, C + sy * 52], [C + sx * 38, C + sy * 52]], 'faint');
      }
      if (t.firing) {
        pen.circle(C, C, 26, 'red');
        for (let i = 0; i < 8; i++) {
          const a = i * 45 * D;
          pen.line(C + 26 * Math.cos(a), C + 26 * Math.sin(a),
            C + 33 * Math.cos(a), C + 33 * Math.sin(a), 'red');
        }
      }
      if (t.aimDist > 0 && t.aimDist < 9000) {
        pen.text(C, C + 68, Math.round(t.aimDist) + ' M', { size: 9, align: 'center', tone: 'dim' });
      }
    },
  };
}

// =======================================================================================
// BOTTOM CENTRE — warnings, and the control legend that shows itself when you first fly.
// =======================================================================================
// Warnings are the one place the HUD is allowed to raise its voice. A previous version
// drew them at 7.5 px with a pulse that dipped to 0.35 opacity, and "ICING 72% — POWER
// TO 43% DESCEND" was a smudge over bright haze — the single most important thing on the
// visor at the moment it appears. Bigger type, brackets either side, and a message that
// never blinks; only the brackets do.
export function warnings() {
  const W = 560, H = 58;
  return {
    w: W, h: H,
    draw(pen, t) {
      const msgs = [];
      if (t.ice > 0.25) msgs.push(['ICING  ' + Math.round(t.ice * 100) + '%   POWER ' +
        Math.round((1 - t.ice * 0.8) * 100) + '%   DESCEND', 'red']);
      if (t.integrity < 0.45) msgs.push(['ARMOUR INTEGRITY ' + Math.round(t.integrity * 100) + '%', 'red']);
      if (t.power < 0.2) msgs.push(['REACTOR CHARGE LOW', 'amb']);
      if (t.g > 7) msgs.push(['G LOAD ' + t.g.toFixed(1), 'amb']);
      if (t.terrain) msgs.push(['TERRAIN', 'red']);
      const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t.time * 7));
      for (let i = 0; i < Math.min(msgs.length, 3); i++) {
        const y = 15 + i * 17;
        pen.text(W / 2, y, msgs[i][0], { size: 11, align: 'center', tone: msgs[i][1], track: 0.16 });
        pen.line(0, y - 4, 26, y - 4, msgs[i][1], blink);
        pen.line(W - 26, y - 4, W, y - 4, msgs[i][1], blink);
      }
    },
  };
}

// Eleven entries strung across one strip gave each 63 units, and "CLIMB DROP" at 9 px
// with wide tracking needs about 78 — every third label ran into its neighbour. Two rows
// of six is the fix, and it is closer to the film, where the furniture at the bottom of
// the visor is stacked rather than strung out in a line.
export function legend(entries) {
  const PER = Math.ceil(entries.length / 2);
  const COLW = 132, W = COLW * PER, ROWH = 28, H = ROWH * 2 + 4;
  return {
    w: W, h: H,
    draw(pen, t, alpha = 1) {
      const was = pen.dim;
      pen.dim = was * alpha;
      entries.forEach(([k, v], i) => {
        const row = Math.floor(i / PER), col = i % PER;
        const x = COLW * (col + 0.5), y = 14 + row * ROWH;
        pen.text(x, y, k, { size: 8, align: 'center', tone: 'blu' });
        pen.text(x, y + 11, v, { size: 8, align: 'center', tone: 'dim' });
        if (col) pen.line(COLW * col, y - 10, COLW * col, y + 14, 'faint');
      });
      pen.dim = was;
    },
  };
}
