// Canvas drawing primitives for the JARVIS HUD. Owned by task `hud`.
//
// WHY CANVAS AND NOT DOM
// ----------------------
// The first version of this HUD was DOM + SVG. It looked right in a browser and was
// invisible in every screenshot the project can take: MZ.shot() reads the WebGL canvas
// back with toDataURL(), and DOM siblings are not in it. A critic rendering our frame
// next to reference/hud/hud_mk3_targeting.jpg saw an empty ocean. Worse, the helmet
// interior — the dark aperture that is half of what makes the reference frames read as
// "inside a helmet" — was a CSS gradient and so equally absent.
//
// So the HUD is painted into a 2D canvas which is uploaded as a texture on two planes
// parented to the camera. It is then part of the rendered image: it screenshots, it
// parallaxes in three dimensions against the world, and it is lit by nothing, which is
// exactly what projected light on the inside of a faceplate is.
//
// THE PEN
// -------
// Every stroke is a hairline: one device pixel, never more. Colour comes from a fixed
// five-tone ink ramp plus four accents used like spice. Every stroke is drawn twice —
// a wide, very low alpha pass underneath and the hairline on top — which is what makes
// a white line survive a noon ocean without being thickened into a smear.

export const INK = {
  ink:   [232, 243, 250],
  dim:   [206, 224, 238],
  faint: [188, 208, 226],
  grn:   [126, 240, 156],
  red:   [255, 84, 64],
  blu:   [140, 208, 255],
  amb:   [255, 188, 88],
};
// Measured against flown screenshots over a noon ocean, not chosen by eye in a dark
// editor: at 0.92 / 0.58 / 0.30 the whole HUD dissolved into bright sky and the faint
// tier was simply not there. These are the values that stay legible over white water AND
// still read as hairline over the near-black workshop.
const ALPHA = { ink: 1.0, dim: 0.80, faint: 0.46, grn: 1.0, red: 1.0, blu: 1.0, amb: 1.0 };

export function rgba(tone, a) {
  const c = INK[tone] || INK.ink;
  const al = a === undefined ? (ALPHA[tone] === undefined ? 0.9 : ALPHA[tone]) : a;
  return `rgba(${c[0]},${c[1]},${c[2]},${al.toFixed(3)})`;
}

// A thin wrapper over CanvasRenderingContext2D that knows about the ink ramp, keeps the
// hairline exactly one device pixel wide whatever the local scale is, and gives every
// stroke the soft glow + dark halo that reads as light projected onto glass.
export class Pen {
  constructor(g) {
    this.g = g;
    this.scale = 1;       // local scale, so 1 device px = 1/scale local units
    this.dim = 1;         // global dimmer, 0..1 (boot wipe, fades)
  }

  hairline() { return 1 / this.scale; }

  // ---- state ---------------------------------------------------------------------
  stroke(tone = 'ink', a) {
    const g = this.g;
    g.strokeStyle = rgba(tone, a === undefined ? undefined : a);
    g.lineWidth = this.hairline();
    g.globalAlpha = this.dim;
    return this;
  }
  fill(tone = 'ink', a) {
    this.g.fillStyle = rgba(tone, a === undefined ? undefined : a);
    this.g.globalAlpha = this.dim;
    return this;
  }
  dash(pattern) {
    this.g.setLineDash(pattern ? pattern.map(v => v / this.scale * this.scale) : []);
    return this;
  }

  // ---- glow: every stroke drawn three times ---------------------------------------
  // `body` receives the raw 2D context and must only issue path + stroke/fill calls.
  //
  //   1. a wide BLACK underlay      — the dark halo. This is what lets a one-pixel white
  //                                   line survive a white sea, and it is the single most
  //                                   important pass in the file.
  //   2. a medium underlay in the   — the light bleeding into the glass around the line.
  //      stroke's own colour
  //   3. the hairline itself.
  //
  // Deliberately NOT ctx.shadowBlur, which is the obvious way to do the halo and is a
  // blur filter per draw call: at ~900 strokes a frame it measured in the tens of
  // milliseconds and ate the frame budget of the thing it decorates. Three flat strokes
  // cost a fraction of one blurred one.
  glow(tone, body, a) {
    const g = this.g;
    const hl = this.hairline();
    const base = a === undefined ? (ALPHA[tone] === undefined ? 0.9 : ALPHA[tone]) : a;
    g.save();
    g.globalAlpha = this.dim;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    g.strokeStyle = 'rgba(0,0,0,0.34)';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = hl * 3.6;
    body(g);

    g.strokeStyle = rgba(tone, base * 0.26);
    g.fillStyle = g.strokeStyle;
    g.lineWidth = hl * 2.1;
    body(g);

    g.strokeStyle = rgba(tone, base);
    g.fillStyle = g.strokeStyle;
    g.lineWidth = hl;
    body(g);
    g.restore();
  }

  line(x1, y1, x2, y2, tone = 'ink', a) {
    this.glow(tone, g => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }, a);
  }
  dashedLine(x1, y1, x2, y2, tone = 'faint', pattern = [4, 5], a) {
    const p = pattern.map(v => v);
    this.glow(tone, g => {
      g.setLineDash(p); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    }, a);
  }
  path(d, tone = 'ink', a) {         // d: function(g) issuing path commands
    this.glow(tone, g => { g.beginPath(); d(g); g.stroke(); }, a);
  }
  poly(pts, tone = 'ink', close = false, a) {
    this.glow(tone, g => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      if (close) g.closePath();
      g.stroke();
    }, a);
  }
  fillPoly(pts, tone = 'ink', a) {
    this.glow(tone, g => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath(); g.fill();
    }, a);
  }
  circle(cx, cy, r, tone = 'ink', a) {
    this.glow(tone, g => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }, a);
  }
  dashedCircle(cx, cy, r, tone = 'faint', pattern = [3, 5], a) {
    this.glow(tone, g => {
      g.setLineDash(pattern); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }, a);
  }
  disc(cx, cy, r, tone = 'ink', a) {
    this.glow(tone, g => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }, a);
  }
  arc(cx, cy, r, a0, a1, tone = 'ink', a) {
    this.glow(tone, g => { g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); }, a);
  }
  dashedArc(cx, cy, r, a0, a1, tone = 'faint', pattern = [4, 6], a) {
    this.glow(tone, g => {
      g.setLineDash(pattern); g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); g.setLineDash([]);
    }, a);
  }
  rect(x, y, w, h, tone = 'dim', a) {
    this.glow(tone, g => { g.beginPath(); g.rect(x, y, w, h); g.stroke(); }, a);
  }

  // ---- type ------------------------------------------------------------------------
  // One condensed monospaced face, three sizes, generous tracking. The film's HUD type
  // is small, wide-tracked and never bold.
  text(x, y, str, opts = {}) {
    const g = this.g;
    const size = opts.size === undefined ? 11 : opts.size;
    const tone = opts.tone || 'ink';
    g.save();
    g.font = `${opts.weight || 400} ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    g.textAlign = opts.align || 'left';
    g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = `${(opts.track === undefined ? 0.14 : opts.track) * size}px`;
    g.globalAlpha = this.dim;
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowBlur = 3.4 * this.hairline();
    g.fillStyle = rgba(tone, opts.alpha);
    g.fillText(String(str), x, y);
    g.restore();
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const pad = (v, n) => String(Math.abs(Math.round(v))).padStart(n, '0');
export function angDiff(a, b) { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
