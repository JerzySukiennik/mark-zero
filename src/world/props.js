// world/props.js — shared toolbox for everything in src/world/.
// Owned by task `world`. Nothing here touches the scene graph on its own; it is noise,
// canvas textures, material caches, small geometry builders, the LOD manager and the
// bookkeeping that hands solids to ctx.physics and breakables to ctx.destruction.
//
// Why procedural rather than .glb: the world is a 12 km terrain plus a town, and the
// pieces that matter (cliff strata, ocean waves, stucco pitting) are fields, not
// sculpts. Parameters here regenerate instantly; a .glb would have to be re-baked.

import * as THREE from 'three';

/* ────────────────────────────── noise ────────────────────────────── */

function hash2(x, y) {
  // Deterministic. The terrain must produce the same height on the CPU (surfaceHeight)
  // and in every mesh built from it, or props float and the player falls through.
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal brownian motion, returns 0..1. */
export function fbm(x, y, octaves = 4, lac = 2.03, gain = 0.5) {
  let f = 1, a = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * valueNoise(x * f, y * f);
    norm += a; f *= lac; a *= gain;
  }
  return sum / norm;
}

/** Ridged noise — the sharp-crested variant that makes rock read as rock. */
export function ridged(x, y, octaves = 4) {
  let f = 1, a = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * f, y * f) * 2 - 1);
    sum += a * n * n; norm += a; f *= 2.07; a *= 0.5;
  }
  return sum / norm;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* ──────────────────────────── canvas textures ─────────────────────────── */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Grainy monochrome noise, used as roughness / bump on stucco and concrete. */
export function grainTexture(size = 256, contrast = 0.5, scale = 24) {
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * scale, (y / size) * scale, 4);
      const v = clamp(128 + (n - 0.5) * 255 * contrast, 0, 255) | 0;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, 1, false);
}

/**
 * Rock bump for the terrain — specifically for the cliff face.
 *
 * The land was bump-mapped with the same isotropic `grain` used on concrete, and
 * isotropic noise on a 96 m sea cliff renders as a soft dune no matter how much
 * amplitude you give it. Sandstone that the Pacific has been undercutting for ten
 * thousand years has a direction: long vertical flutes cut by runoff, crossed by
 * horizontal bedding planes an order of magnitude further apart, plus a fine grit on
 * top. The terrain UVs already swing their second axis from z to HEIGHT as the ground
 * steepens, so "vertical" in this texture lands vertical on the wall and reads as
 * plain erosion patterning on the flat ground where the same texture is also used.
 */
export function rockTexture(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size), v = (y / size);
      // flutes: eight times finer across than along, which is the whole point
      const flute = ridged(u * 26, v * 3.2, 3);
      // bedding: thin dark seams, sparse
      const bed = Math.pow(0.5 + 0.5 * Math.sin(v * 34 + fbm(u * 5, v * 5, 2) * 6), 5);
      const grit = fbm(u * 60, v * 60, 3) - 0.5;
      const n = 0.55 + 0.45 * flute - bed * 0.42 + grit * 0.28;
      const val = clamp(n * 255, 0, 255) | 0;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, 1, false);
}

/**
 * Stucco: beige, pitted, gritty. The reference donut is not a smooth torus — it is a
 * hand-troweled plaster shell full of thumb-sized craters. This paints the craters as
 * colour AND returns a matching bump so the light catches them.
 */
export function stuccoTextures(size = 1024) {
  const col = canvas(size, size), cg = col.getContext('2d');
  const bmp = canvas(size, size), bg = bmp.getContext('2d');
  const ci = cg.createImageData(size, size);
  const bi = bg.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 40, v = (y / size) * 40;
      const grit = fbm(u * 4, v * 4, 3);
      const pit = ridged(u * 1.6, v * 1.6, 3);          // crater field
      const blotch = fbm(u * 0.5, v * 0.5, 3);
      // beige base 208,178,128 -> darker in pits, lighter on the ridges
      // The reference donut is BEIGE in hard sun — roughly 205,175,120 on the lit face.
      // The first cut of this averaged 0.72 of a 214,181,132 base, i.e. a mud brown, and
      // under a backlit sun it read as chocolate. Pits still darken it; they just no
      // longer take a third of the value with them.
      const shade = 0.92 + 0.14 * blotch - 0.22 * pit + 0.10 * (grit - 0.5);
      const i = (y * size + x) * 4;
      ci.data[i] = clamp(224 * shade, 0, 255);
      ci.data[i + 1] = clamp(193 * shade, 0, 255);
      ci.data[i + 2] = clamp(146 * shade, 0, 255);
      ci.data[i + 3] = 255;
      const b = clamp(255 * (0.62 + 0.34 * (1 - pit) + 0.16 * (grit - 0.5)), 0, 255);
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = b;
      bi.data[i + 3] = 255;
    }
  }
  cg.putImageData(ci, 0, 0);
  bg.putImageData(bi, 0, 0);
  return { map: finish(col, 1, true), bump: finish(bmp, 1, false) };
}

/**
 * A workshop monitor: dark panel with pale-cyan UI furniture drawn on it — nested
 * rectangles, a wireframe blob, scan rows of "text". Drawn rather than lit, because in
 * malibu_workshop_a the screens ARE the light source and a flat emissive rectangle is
 * the difference between a bank of monitors and six glowing postage stamps. Every screen
 * gets a different seed so the wall does not repeat.
 */
export function screenTexture(seed = 0, w = 256, h = 160) {
  const c = canvas(w, h), g = c.getContext('2d');
  let st = seed * 9781 + 17;
  const rnd = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  /* The panel ground is not black. env.js fogs the workshop from 8 m to 85 m into
   * 0x04080b, so a screen drawn on a near-black ground is fogged into the wall behind it
   * and the room loses its only light source. 0x14283a still reads as an unlit monitor
   * beside a bright readout, and it survives the fog. */
  g.fillStyle = '#14283a'; g.fillRect(0, 0, w, h);
  const ink = (a) => `rgba(186,232,255,${a})`;
  // a couple of framed panels
  for (let i = 0; i < 3; i++) {
    const x = 6 + rnd() * (w * 0.55), y = 6 + rnd() * (h * 0.5);
    const pw = 40 + rnd() * (w * 0.35), ph = 26 + rnd() * (h * 0.35);
    g.fillStyle = `rgba(38,96,132,${0.3 + rnd() * 0.35})`;
    g.fillRect(x, y, pw, ph);
    g.strokeStyle = ink(0.55); g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, pw, ph);
    // scan rows standing in for text
    g.fillStyle = ink(0.5);
    for (let r = 0; r < ph / 6 - 1; r++) g.fillRect(x + 4, y + 5 + r * 6, 6 + rnd() * (pw - 14), 1.6);
  }
  // a wireframe object: concentric ellipses, the schematic every one of these screens has
  const cx = w * (0.55 + rnd() * 0.3), cy = h * (0.4 + rnd() * 0.3);
  g.strokeStyle = ink(0.8);
  for (let i = 1; i <= 4; i++) {
    g.beginPath();
    g.ellipse(cx, cy, i * 7, i * 4.4, rnd() * 0.6, 0, Math.PI * 2);
    g.stroke();
  }
  // tick scale down one edge
  g.fillStyle = ink(0.7);
  for (let i = 0; i < h / 8; i++) g.fillRect(w - 9, 4 + i * 8, (i % 4 === 0) ? 6 : 3, 1.4);
  // a bright readout block — the hot spot that makes the screen a light source
  g.fillStyle = 'rgba(220,246,255,0.95)';
  g.fillRect(6, h - 16, 30 + rnd() * 50, 9);
  g.fillRect(6, 6, 14, 4);
  return finish(c, 1, true);
}

/** Cracked grey asphalt with a faint oil sheen variation. */
export function asphaltTexture(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * 60, (y / size) * 60, 4);
      const crack = ridged((x / size) * 7, (y / size) * 7, 2);
      let v = 58 + n * 34 - Math.pow(crack, 6) * 40;
      const i = (y * size + x) * 4;
      img.data[i] = v; img.data[i + 1] = v * 1.01; img.data[i + 2] = v * 1.05;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, 1, true);
}

/**
 * A building facade strip: lit / unlit window grid on a wall colour. One texture drives
 * a whole town block, which is what keeps 40 buildings inside one draw call budget.
 */
export function facadeTexture(opts = {}) {
  const {
    wall = '#b8ada0', cols = 6, rows = 4, size = 512,
    litChance = 0.32, night = false,
  } = opts;
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, size, size);
  // subtle grime
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(x, y, 3, 3);
  }
  const cw = size / cols, ch = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = cI * cw + cw * 0.22, y = r * ch + ch * 0.2;
      const w = cw * 0.56, h = ch * 0.5;
      const lit = Math.random() < litChance;
      g.fillStyle = night
        ? (lit ? '#ffd9a0' : '#141a20')
        : (lit ? '#5d6c78' : '#2b333c');
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, y, w, 2);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
      g.strokeRect(x, y, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.stroke();
    }
  }
  return finish(c, 1, true);
}

/** Vertical board-formed concrete — the interior feature wall in malibu_living_colour. */
export function boardConcreteTexture(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#cdc6ba'; g.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) {
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
    g.fillRect(x, 0, 1.5, size);
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`;
    g.fillRect(x + 2, 0, 6, size);
  }
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(120,110,95,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 6);
  }
  return finish(c, 1, true);
}

/** Warm wood, for the ceiling soffits and interior accents. */
export function woodTexture(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#8a6135'; g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    const n = fbm(y * 0.05, 0.5, 3);
    g.fillStyle = `rgba(${132 + n * 62},${94 + n * 44},${56 + n * 28},0.5)`;
    g.fillRect(0, y, size, 2);
  }
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = 'rgba(30,16,8,0.35)'; g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * size;
    g.moveTo(0, y);
    g.bezierCurveTo(size * 0.3, y + 20, size * 0.6, y - 24, size, y + 6);
    g.stroke();
  }
  return finish(c, 1, true);
}

/* ─────────────────────────── material library ─────────────────────────── */

export function buildMaterials() {
  const grain = grainTexture(256, 0.6, 30);
  const rock = rockTexture(512);
  const stucco = stuccoTextures(1024);
  const board = boardConcreteTexture();
  const wood = woodTexture();
  const asphalt = asphaltTexture();

  const M = {
    // The house. Reference: bright white man-made object against a dusty warm cliff.
    /* Whiter and shinier than a real wall, deliberately. The whole composition is one
     * bright man-made object on a dusty warm cliff, and the sun in this world comes from
     * over the water — so the inland faces the player walks up to are in shadow all day.
     * At 0.72 roughness and no environment contribution they rendered mid-grey, and a
     * grey Malibu house is just a bunker. envMapIntensity is what lets the sky dome do
     * the work the bounce card does on a film set. */
    slab: new THREE.MeshStandardMaterial({
      color: 0xf6f4ee, roughness: 0.62, metalness: 0.0, envMapIntensity: 1.45,
      roughnessMap: grain, bumpMap: grain, bumpScale: 0.012,
    }),
    slabEdge: new THREE.MeshStandardMaterial({ color: 0xefece5, roughness: 0.7, envMapIntensity: 1.3 }),
    column: new THREE.MeshStandardMaterial({
      color: 0xe8e4da, roughness: 0.74, envMapIntensity: 1.25, bumpMap: grain, bumpScale: 0.02,
    }),
    // Dark tinted glazing: from outside the interior must read as ONE DARK BAND.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0a151c, roughness: 0.045, metalness: 0.0,
      transparent: true, opacity: 0.46, envMapIntensity: 2.0,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    glassClear: new THREE.MeshPhysicalMaterial({
      color: 0xbfe3ee, roughness: 0.03, metalness: 0.0,
      transparent: true, opacity: 0.17, envMapIntensity: 2.6,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    mullion: new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.45, metalness: 0.7 }),
    /* Carbon fibre, for the stair down into the workshop. It used to be built out of
     * `slab` — the same near-white plaster as the house — so sixteen bright treads floated
     * in a dark shaft and read as polystyrene. Woven carbon is nearly black, low-ish
     * roughness with a clear-coat sheen, and just metallic enough to catch the workshop's
     * practicals along an edge. */
    carbon: new THREE.MeshPhysicalMaterial({
      color: 0x14171a, roughness: 0.34, metalness: 0.42, envMapIntensity: 1.0,
      clearcoat: 0.7, clearcoatRoughness: 0.22,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8e969c, roughness: 0.36, metalness: 0.9 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.42, metalness: 0.85 }),
    /* ── the same two metals, for the BASEMENT ──
     * A metal with metalness 0.85 has essentially no diffuse term: its whole appearance
     * is a reflection of the environment. Outdoors that is correct and beautiful — the
     * sky does the work. In the workshop there is no sky, env.js dims the environment
     * contribution to nearly nothing, and every steel object in the room therefore
     * rendered PURE BLACK no matter how many point lights were aimed at it. The console
     * run, the benches, the cabinets and the machines were all invisible; the room read
     * as four glowing screens floating in a void, and turning the lights up did nothing
     * at all because there was no diffuse surface for them to land on.
     *
     * Painted and powder-coated shop furniture is not bare metal anyway. Low metalness,
     * mid roughness, a real albedo: now a lamp actually lights it. This is the concrete
     * form of the rule in ARCHITECTURE.md — a metallic material with no environment map
     * renders black — and the fix is to stop claiming these things are mirrors. */
    shopSteel: new THREE.MeshStandardMaterial({
      color: 0x9aa2a8, roughness: 0.55, metalness: 0.22, envMapIntensity: 0.6,
    }),
    shopDark: new THREE.MeshStandardMaterial({
      color: 0x4e555c, roughness: 0.68, metalness: 0.12, envMapIntensity: 0.5,
    }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x3f5a52, roughness: 0.55, metalness: 0.75 }),
    interiorFloor: new THREE.MeshStandardMaterial({ color: 0xb9b1a6, roughness: 0.55 }),
    interiorWall: new THREE.MeshStandardMaterial({ color: 0xece9e3, roughness: 0.9 }),
    boardWall: new THREE.MeshStandardMaterial({ color: 0xffffff, map: board, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: wood, roughness: 0.55, envMapIntensity: 1.2 }),
    // Workshop
    /* Lifted from 0x2a2d31 / 0x1b1f24. Those are the albedos of charcoal: a surface that
     * dark returns so little of what lands on it that no practical light in the room can
     * make it legible, and the workshop kept rendering as a black frame with a few
     * emissive rectangles in it however much the lamps were turned up. The DARKNESS of
     * the reference basement comes from having very little light in most of the room,
     * not from painting the room black — the concrete floor in malibu_workshop_a is a
     * mid grey wherever a lamp reaches it. Sealed concrete and dark-painted block. */
    shopFloor: new THREE.MeshStandardMaterial({ color: 0x484d54, roughness: 0.45, metalness: 0.08 }),
    shopWall: new THREE.MeshStandardMaterial({ color: 0x2e343b, roughness: 0.9 }),
    // Ground / town
    asphalt: new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphalt, roughness: 0.94 }),
    concrete: new THREE.MeshStandardMaterial({
      color: 0xa9a49b, roughness: 0.92, bumpMap: grain, bumpScale: 0.03,
    }),
    stucco: new THREE.MeshStandardMaterial({
      color: 0xffffff, map: stucco.map, bumpMap: stucco.bump, bumpScale: 0.34,
      roughness: 0.97, metalness: 0.0,
    }),
    paintWhite: new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.6, envMapIntensity: 1.3 }),
    paintCream: new THREE.MeshStandardMaterial({ color: 0xf3e6cc, roughness: 0.7 }),
    paintBrown: new THREE.MeshStandardMaterial({ color: 0x9a5f2c, roughness: 0.7 }),
    paintRed: new THREE.MeshStandardMaterial({ color: 0xa32b23, roughness: 0.55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7 }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0x7d6a4f, roughness: 0.95 }),
    palmFrond: new THREE.MeshStandardMaterial({
      color: 0x4e6b31, roughness: 0.85, side: THREE.DoubleSide,
    }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x4a5c33, roughness: 0.95 }),
    poolWater: new THREE.MeshStandardMaterial({
      color: 0x2fa5b8, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.85,
    }),
    // Emissives always get toneMapped:false — additive glow otherwise dies over bright
    // ground, which is exactly what happened in the previous attempt.
    lampGlow: new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
    holo: new THREE.MeshBasicMaterial({
      color: 0x5fd8ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide,
    }),
    screen: new THREE.MeshBasicMaterial({ color: 0x6fb6dc, toneMapped: false }),
    stripLight: new THREE.MeshBasicMaterial({ color: 0x7fe4ff, toneMapped: false }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffe6b8, toneMapped: false }),
  };
  M._textures = { grain, rock, stucco, board, wood, asphalt };
  return M;
}

/* ───────────────────────────── geometry helpers ───────────────────────── */

/**
 * A closed organic outline through control points, as a THREE.Shape.
 * The Malibu slabs are not rectangles — every floor plate is a soft blob with a
 * continuously curving edge. Catmull-rom through 8-14 points gives exactly that.
 */
export function blobShape(points, closed = true) {
  const v = points.map(p => new THREE.Vector2(p[0], p[1]));
  const curve = new THREE.SplineCurve(v);
  curve.closed = closed;
  const pts = curve.getPoints(Math.max(64, v.length * 12));
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
  s.closePath();
  return { shape: s, outline: pts };
}

/** A thin horizontal floor plate with a soft bevelled edge, lying in the XZ plane. */
export function slabMesh(points, thickness, material, bevel = 0.06, holes = null) {
  const { shape, outline } = blobShape(points);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12,
  });
  geo.rotateX(-Math.PI / 2);          // extrude runs along +Z; stand it up as +Y
  if (holes && holes.length) punchHoles(geo, holes);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.outline = outline;
  return m;
}

/**
 * Removes every triangle whose centre falls inside one of the given circles, in XZ.
 *
 * The obvious way to open a stairwell is a hole in the THREE.Shape, but ExtrudeGeometry
 * with bevelEnabled degenerates around hole contours: the slab came back with a hole in
 * the picture and NO collider at all, so the whole floor stopped being solid. Deleting
 * triangles from the finished buffer touches nothing else, and because the collider is
 * built from this same geometry, the opening is physical as well as visual. The cut edge
 * is ragged at triangle scale; the drum wall around the stairwell covers it.
 */
/**
 * Cuts a doorway out of a cylinder wall, in the cylinder's own local space.
 *
 * `a0`/`a1` are angles about +Y measured as atan2(x, z), `y0`/`y1` the opening's height.
 * Used for the stair drum: it is a solid architectural cylinder with a collider, and
 * without an opening the stair inside it is unreachable and invisible — you walk around
 * a white wall and conclude the game has no way down.
 */
export function punchDoor(geo, { a0, a1, y0, y1 }) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const src = idx ? idx.array : null;
  const triCount = src ? src.length / 3 : pos.count / 3;
  const norm = a => { let v = a; while (v < -Math.PI) v += Math.PI * 2; while (v > Math.PI) v -= Math.PI * 2; return v; };
  const within = (a) => {
    const d = norm(a - (a0 + a1) / 2);
    return Math.abs(d) <= Math.abs(norm(a1 - a0)) / 2;
  };
  const kept = [];
  for (let t = 0; t < triCount; t++) {
    const a = src ? src[t * 3] : t * 3;
    const b = src ? src[t * 3 + 1] : t * 3 + 1;
    const c = src ? src[t * 3 + 2] : t * 3 + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (cy > y0 && cy < y1 && within(Math.atan2(cx, cz))) continue;
    kept.push(a, b, c);
  }
  geo.setIndex(kept);
  return geo;
}

export function punchRect(geo, r) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const src = idx ? idx.array : null;
  const triCount = src ? src.length / 3 : pos.count / 3;
  const kept = [];
  for (let t = 0; t < triCount; t++) {
    const a = src ? src[t * 3] : t * 3;
    const b = src ? src[t * 3 + 1] : t * 3 + 1;
    const c = src ? src[t * 3 + 2] : t * 3 + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1) continue;
    kept.push(a, b, c);
  }
  geo.setIndex(kept);
  return geo;
}

function punchHoles(geo, holes) {
  // Two passes, and both are needed.
  //
  // Extrude triangulation emits long thin triangles that span the whole plate. Filtering
  // by triangle CENTRE leaves the ones that cross the opening (their centres are outside
  // it) and the stairwell stays visually blocked. Filtering by "touches the circle at all"
  // deletes those same long triangles entirely, which took out half the floor.
  //
  // So: first subdivide anything near the opening until the pieces are small, then delete
  // by centre. Small triangles make the centre test honest, and nothing far from the hole
  // is touched.
  const near = (xs, zs) => holes.some(h => {
    const pad = h.r + 2;
    return Math.min(...xs) < h.x + pad && Math.max(...xs) > h.x - pad
        && Math.min(...zs) < h.z + pad && Math.max(...zs) > h.z - pad;
  });
  const inHole = (x, z) => holes.some(h => (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r);

  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const idx = geo.index;
  const src = idx ? Array.from(idx.array) : Array.from({ length: pos.count }, (_, i) => i);

  const px = [], py = [], pz = [], nx = [], ny = [], nz = [], us = [], vs = [];
  for (let i = 0; i < pos.count; i++) {
    px.push(pos.getX(i)); py.push(pos.getY(i)); pz.push(pos.getZ(i));
    nx.push(nor ? nor.getX(i) : 0); ny.push(nor ? nor.getY(i) : 1); nz.push(nor ? nor.getZ(i) : 0);
    us.push(uv ? uv.getX(i) : 0); vs.push(uv ? uv.getY(i) : 0);
  }
  const mid = (a, b) => {
    px.push((px[a] + px[b]) / 2); py.push((py[a] + py[b]) / 2); pz.push((pz[a] + pz[b]) / 2);
    nx.push((nx[a] + nx[b]) / 2); ny.push((ny[a] + ny[b]) / 2); nz.push((nz[a] + nz[b]) / 2);
    us.push((us[a] + us[b]) / 2); vs.push((vs[a] + vs[b]) / 2);
    return px.length - 1;
  };

  let tris = [];
  for (let t = 0; t < src.length; t += 3) tris.push([src[t], src[t + 1], src[t + 2]]);

  /* 0.45 m, and eight passes to reach it.
   *
   * At 1.2 m over six passes the edge of a 4.6 m stairwell is a ring of 1.2 m steps: the
   * opening came out as a jagged polygon with long triangles spiking into it — the "teeth"
   * Jurek reported around the stair. The centre test is only ever as round as the pieces
   * it is deleting. Subdivision is confined to a box r + 2 m around each hole, so the cost
   * is local: roughly 1.7 k extra triangles for this stairwell, not a re-tessellation of
   * the whole 50 m plate. A collar ring in malibu.js covers whatever is left over. */
  const LIMIT = 0.45;              // metres; below this the centre test is reliable
  for (let pass = 0; pass < 8; pass++) {
    let split = false;
    const out = [];
    for (const [a, b, c] of tris) {
      const xs = [px[a], px[b], px[c]], zs = [pz[a], pz[b], pz[c]];
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      if (size > LIMIT && near(xs, zs)) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
        split = true;
      } else out.push([a, b, c]);
    }
    tris = out;
    if (!split) break;
  }

  const kept = [];
  for (const [a, b, c] of tris) {
    const cx = (px[a] + px[b] + px[c]) / 3;
    const cz = (pz[a] + pz[b] + pz[c]) / 3;
    if (inHole(cx, cz)) continue;
    kept.push(a, b, c);
  }

  const P = new Float32Array(px.length * 3), N = new Float32Array(px.length * 3), U = new Float32Array(px.length * 2);
  for (let i = 0; i < px.length; i++) {
    P[i * 3] = px[i]; P[i * 3 + 1] = py[i]; P[i * 3 + 2] = pz[i];
    N[i * 3] = nx[i]; N[i * 3 + 1] = ny[i]; N[i * 3 + 2] = nz[i];
    U[i * 2] = us[i]; U[i * 2 + 1] = vs[i];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geo.setIndex(kept);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

export function insetOutline(pts, d) {
  const n = pts.length;
  if (n < 3) return pts.map(p => p.clone());
  // signed area tells us the winding, so "inward" is unambiguous either way round
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], p = pts[i], next = pts[(i + 1) % n];
    // normals of the two edges meeting at p
    let e1x = p.x - prev.x, e1y = p.y - prev.y;
    let e2x = next.x - p.x, e2y = next.y - p.y;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // inward normal of an edge (dx,dy) for CCW winding is (dy,-dx) * sign
    let nx = (e1y + e2y) * sign, ny = (-e1x - e2x) * sign;
    const ln = Math.hypot(nx, ny);
    if (ln < 1e-4) {
      // a 180-degree spike: fall back to radial so the point still moves inward
      nx = cx - p.x; ny = cy - p.y;
      const lr = Math.hypot(nx, ny) || 1;
      nx /= lr; ny /= lr;
    } else { nx /= ln; ny /= ln; }
    // miter length, clamped so a tight corner does not shoot the point across the shape
    const cosHalf = Math.max(0.35, Math.hypot(e1x + e2x, e1y + e2y) / 2);
    const step = Math.min(d / cosHalf, d * 2.2);
    out.push(new THREE.Vector2(p.x + nx * step, p.y + ny * step));
  }
  return out;
}

/**
 * A vertical ribbon (curtain wall) following a closed polyline. Used for the glass
 * between the slabs and for the terrace rails.
 */
export function ribbonMesh(outline, y0, y1, material, uRepeat = 1) {
  const n = outline.length;
  const pos = [], uv = [], idx = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    pos.push(p.x, y0, p.y, p.x, y1, p.y);
    uv.push(run, 0, run, 1);
    const q = outline[(i + 1) % n];
    run += Math.hypot(q.x - p.x, q.y - p.y) * uRepeat;
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

/** A tapered concrete column — wide at the slab, narrow at the rock. */
export function taperedColumn(topR, botR, height, material) {
  const g = new THREE.CylinderGeometry(topR, botR, height, 14, 4);
  // Flare the very top so it meets the slab like a mushroom capital (reference: the row
  // of columns under the cantilever in malibu_cliff_hero).
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = (y + height / 2) / height;
    if (t > 0.86) {
      const f = 1 + smoothstep(0.86, 1.0, t) * 0.55;
      p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/**
 * A palm. Cheap, but it has to read as a palm and not as a asterisk on a stick — the
 * first version gave nine flat straight blades radiating from one point, which from any
 * angle looked like a TV aerial. Real Washingtonias have a dense crown of long fronds
 * that arch OVER and hang below the horizontal, a slight lean, and a ringed trunk that
 * tapers. All three are cheap; the arch is the one that matters.
 */
export function palmTree(M, height = 9, seed = 0) {
  const g = new THREE.Group();
  const trunkPts = [];
  const bend = (hash2(seed, 7) - 0.5) * 0.30;
  const lean = (hash2(seed, 13) - 0.5) * 0.8;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    trunkPts.push(new THREE.Vector3(
      Math.sin(t * 1.7) * bend * height + lean * t * t,
      t * height,
      Math.sin(t * 1.2) * bend * height * 0.6
    ));
  }
  const curve = new THREE.CatmullRomCurve3(trunkPts);
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.3, 7, false), M.palmTrunk);
  // taper: thick at the base, thin under the crown
  {
    const p = trunk.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = clamp(v.y / height, 0, 1);
      const c = curve.getPoint(t);
      const k = 1 - t * 0.42;
      p.setXYZ(i, c.x + (v.x - c.x) * k, v.y, c.z + (v.z - c.z) * k);
    }
    trunk.geometry.computeVertexNormals();
  }
  trunk.castShadow = true;
  g.add(trunk);

  const top = trunkPts[8];

  // One frond: a long tapered blade bent into an arch, with a V section so it catches
  // light on one half and shades on the other.
  const SEG = 7;
  const frondGeo = new THREE.PlaneGeometry(5.2, 1.05, SEG, 1);
  {
    const p = frondGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const t = clamp((x + 2.6) / 5.2, 0, 1);
      p.setY(i, y * (1.05 - t * 0.95));                  // taper to a point
      // arch: up out of the crown, over the top, then down past the horizontal
      p.setZ(i, -(0.9 * t - 2.6 * t * t * t) * 1.5 + Math.abs(y) * 0.55 * (1 - t));
    }
    frondGeo.computeVertexNormals();
  }
  const nF = 15;
  for (let i = 0; i < nF; i++) {
    const f = new THREE.Mesh(frondGeo, M.palmFrond);
    f.position.copy(top);
    const a = (i / nF) * Math.PI * 2 + hash2(seed, i) * 0.4;
    f.rotation.y = a;
    // half the crown rides high, half droops — that spread is what gives it volume
    f.rotation.z = -0.55 + (hash2(seed, i + 30) - 0.35) * 1.25;
    f.scale.setScalar(0.72 + hash2(seed, i + 60) * 0.5);
    f.translateX(2.3);
    f.castShadow = true;
    g.add(f);
  }
  // the dead skirt of old fronds just under the crown
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.5, 9, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.98, side: THREE.DoubleSide }));
  skirt.position.copy(top); skirt.position.y -= 0.5;
  g.add(skirt);
  return g;
}

/* ───────────────────────────── LOD manager ───────────────────────────── */

/**
 * Distance culling for prop clusters. The flight task moves at 290 m/s, so this cannot
 * be per-object per-frame work; groups are checked in rotation, a slice per frame.
 */
export class LODManager {
  constructor() { this.entries = []; this.cursor = 0; }
  /** add(object3D, showWithin, opts) — opts.lowDetail is an alternate object. */
  add(obj, dist, opts = {}) {
    this.entries.push({
      obj, d2: dist * dist,
      low: opts.low || null,
      lowD2: (opts.lowDist || dist * 6) ** 2,
      center: opts.center || obj.position.clone(),
    });
    return obj;
  }
  update(camPos) {
    const n = this.entries.length;
    if (!n) return;
    const slice = Math.max(8, Math.ceil(n / 6));
    for (let k = 0; k < slice; k++) {
      const e = this.entries[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      const dx = camPos.x - e.center.x, dy = camPos.y - e.center.y, dz = camPos.z - e.center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const near = d2 < e.d2;
      if (e.obj.visible !== near) e.obj.visible = near;
      if (e.low) {
        const far = !near && d2 < e.lowD2;
        if (e.low.visible !== far) e.low.visible = far;
      }
    }
  }
}

/* ─────────────────────── physics / destruction handoff ────────────────── */

/**
 * The world never builds its own collision. Solids are queued and handed to
 * ctx.physics; breakables are queued and handed to ctx.destruction. Both of those
 * modules initialise AFTER world in the registry, so everything is replayed on 'ready'.
 */
/* Rapier builds a collider per shape, and the cost is not uniform: a trimesh of a
 * 300 000-triangle terrain will lock the tab for a minute, while a cuboid is free. So
 * the world declares WHAT a thing is and this table decides the collider. Never let a
 * big mesh fall through to the default. */
const SHAPE_BY_KIND = {
  terrain: 'trimesh',   // only ever handed the coarse collision mesh, never the visual one
  slab: 'trimesh', deck: 'trimesh', wall: 'trimesh', drum: 'trimesh',
  floor: 'trimesh', ground: 'trimesh', donut: 'trimesh',
  roof: 'box', building: 'box', column: 'box', structure: 'box',
  car: 'box', prop: 'box', stair: 'box',
};

/* destruction/ classifies breakables by `type`; world/ describes them by the material a
 * player would name. This is the translation. */
function breakType(spec) {
  if (spec.type) return spec.type;
  switch (spec.material) {
    case 'glass': return 'glass';
    case 'stucco': return spec.chunky ? 'donut' : 'wall';
    case 'metal': return spec.topples ? 'post' : 'prop';
    case 'concrete': return 'wall';
    default: return 'prop';
  }
}

export class Handoff {
  constructor(ctx) {
    this.ctx = ctx;
    this.solids = [];       // {mesh, opts}
    this.breakables = [];   // {mesh, spec}
    this.flushed = false;
    ctx.bus.on('ready', () => this.flush());
    ctx.bus.on('physics:ready', () => this.flush());
  }
  /** Every solid surface the player or a projectile can hit. */
  solid(mesh, opts = {}) {
    if (!opts.shape) opts.shape = SHAPE_BY_KIND[opts.kind] || 'box';
    this.solids.push({ mesh, opts });
    mesh.userData.worldSolid = true;
    if (this.flushed) this._pushSolid(this.solids[this.solids.length - 1]);
    return mesh;
  }
  /**
   * A breakable prop. spec.material is one of
   * 'glass' | 'stucco' | 'concrete' | 'metal' | 'wood' — audio and debris colour key
   * off it. spec.pieces is the requested shard count, spec.mass in kg.
   */
  breakable(mesh, spec) {
    const s = Object.assign({ material: 'concrete', pieces: 12, mass: 80, threshold: 1 }, spec);
    s.type = breakType(s);
    s.chunks = s.chunks || s.pieces;
    mesh.userData.breakable = s;
    this.breakables.push({ mesh, spec: s });
    if (this.flushed) this._pushBreakable(this.breakables[this.breakables.length - 1]);
    return mesh;
  }
  _pushSolid(e) {
    const p = this.ctx.physics;
    if (!p || typeof p.addStatic !== 'function') return;
    try {
      const rec = p.addStatic(e.mesh, e.opts);
      // destruction/ looks for this key to avoid building a second collider.
      if (rec) e.mesh.userData.physicsRec = rec;
    } catch (err) { /* physics not ready */ }
  }
  _pushBreakable(e) {
    const d = this.ctx.destruction;
    if (!d || typeof d.register !== 'function') return;
    try { d.register(e.mesh, e.spec); } catch (err) { /* destruction not ready */ }
  }
  flush() {
    for (const e of this.solids) this._pushSolid(e);
    for (const e of this.breakables) this._pushBreakable(e);
    this.flushed = true;
  }
}

/* ───────────────────────────── vegetation ─────────────────────────────
 * The hero plate (reference/world/malibu_cliff_hero.jpg) is not a bare ochre headland:
 * the flat top and every shallow slope are covered in dark grey-green chaparral, with
 * bare rock showing only on the steep faces. Our first pass had none of it, and an
 * empty dune is the single loudest "this is a generated world" tell in the whole game.
 *
 * It is instanced: one draw call per species per ring, no per-object frame cost, and
 * the flight task crosses this at 290 m/s. Nothing here casts a shadow — a 1.5 m bush
 * at 400 m is far below one shadow-map texel, so its "shadow" is aliasing, which is
 * exactly what banded the fairground plaza.
 */

/** A squashed, dented ball — reads as a sage/buckwheat shrub at any distance. */
function bushGeometry(detail = 0) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.72 + 0.55 * valueNoise(v.x * 2.4 + 11, v.z * 2.4 + 7);
    v.multiplyScalar(n);
    v.y = v.y * 0.62 + 0.34;          // sit on the ground, wider than tall
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** An angular boulder. */
function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.7 + 0.6 * valueNoise(v.x * 3 + 3, v.z * 3 + 9));
    v.y = v.y * 0.7 + 0.2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Scatter a field of instanced props over the terrain.
 *
 * opts.heightAt / opts.slopeAt  — the terrain functions (world/cliff.js)
 * opts.area                     — {x0,x1,z0,z1}
 * opts.step                     — grid spacing in metres; one candidate per cell
 * opts.keepOut                  — [{x,z,r}] pads to leave clear (buildings sit there)
 */
export function buildVegetation(M, opts) {
  const {
    heightAt, slopeAt, area, step = 26, keepOut = [], detail = 0,
    scale = 1, seed = 0, maxSlope = 0.62, treeChance = 0.06,
  } = opts;

  const bushGeo = bushGeometry(detail);
  const rockGeo = rockGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 5, 1);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = bushGeometry(detail);

  const cols = Math.ceil((area.x1 - area.x0) / step);
  const rows = Math.ceil((area.z1 - area.z0) / step);
  const cap = cols * rows;

  const bushMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.96, metalness: 0, flatShading: true,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true,
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4a37, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, flatShading: true,
  });

  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, cap);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.ceil(cap * 0.3));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.ceil(cap * 0.12));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.ceil(cap * 0.12));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  let nb = 0, nr = 0, nt = 0;

  // The palette: grey-green sage through olive to dry straw. Never one flat green.
  const SAGE = new THREE.Color(0x5c6b46);
  const OLIVE = new THREE.Color(0x76794a);
  const STRAW = new THREE.Color(0x9d9560);
  const DARK = new THREE.Color(0x3f5232);
  const ROCK1 = new THREE.Color(0x8b7357);
  const ROCK2 = new THREE.Color(0x63513c);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const gx = area.x0 + (i + 0.5) * step;
      const gz = area.z0 + (j + 0.5) * step;
      const r1 = valueNoise(gx * 0.37 + seed, gz * 0.37 + seed * 2);
      const r2 = valueNoise(gx * 0.71 + 31 + seed, gz * 0.71 + 17);
      const r3 = valueNoise(gx * 1.13 + 5, gz * 1.13 + 23 + seed);
      const x = gx + (r1 - 0.5) * step * 1.5;
      const z = gz + (r2 - 0.5) * step * 1.5;

      const h = heightAt(x, z);
      if (h < 3.5) continue;                                  // beach and sea
      const slope = slopeAt(x, z);

      let clear = true;
      for (const k of keepOut) {
        if ((x - k.x) * (x - k.x) + (z - k.z) * (z - k.z) < k.r * k.r) { clear = false; break; }
      }
      if (!clear) continue;

      // macro patches: chaparral grows in drifts, never at an even density
      const patch = fbm(x * 0.0011 + 40, z * 0.0011 + 12, 3);
      let density = smoothstep(0.34, 0.62, patch);
      density *= 1 - smoothstep(maxSlope, maxSlope + 0.25, slope);
      // a fringe of scrub clings to the cliff lip, which is what breaks the hard
      // silhouette line between rock and sky in the reference plate
      density = Math.max(density, (1 - smoothstep(0.72, 0.95, slope)) * 0.35);
      if (r3 > density) continue;

      const dry = clamp(fbm(x * 0.004 + 3, z * 0.004 + 8, 2) * 1.4 - 0.2, 0, 1);
      const rocky = slope > maxSlope * 0.8 || r1 > 0.93;

      if (rocky && nr < rocks.count) {
        const s = (0.7 + r2 * 2.4) * scale;
        pos.set(x, h - s * 0.18, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r1 * 6.28);
        scl.set(s, s * (0.6 + r3 * 0.6), s * (0.8 + r1 * 0.5));
        m.compose(pos, q, scl);
        rocks.setMatrixAt(nr, m);
        col.copy(ROCK1).lerp(ROCK2, r3).multiplyScalar(0.88 + 0.24 * r2);
        rocks.setColorAt(nr, col);
        nr++;
        continue;
      }

      // a tree, occasionally, and only on the gentler inland ground
      if (r2 < treeChance && slope < 0.3 && nt < trunks.count) {
        const th = (3.4 + r3 * 4.5) * scale;
        pos.set(x, h, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r1 * 6.28);
        scl.set(1, th, 1);
        m.compose(pos, q, scl);
        trunks.setMatrixAt(nt, m);
        const cs = th * (0.42 + r1 * 0.16);
        pos.set(x, h + th * 0.82, z);
        scl.set(cs, cs * 0.8, cs);
        m.compose(pos, q, scl);
        crowns.setMatrixAt(nt, m);
        col.copy(DARK).lerp(OLIVE, r3 * 0.7).multiplyScalar(0.85 + 0.25 * r1);
        crowns.setColorAt(nt, col);
        nt++;
        continue;
      }

      if (nb >= bushes.count) continue;
      const s = (0.55 + r3 * r3 * 2.1) * scale;
      pos.set(x, h - 0.12 * s, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r1 * 6.28);
      scl.set(s * (0.85 + r2 * 0.5), s * (0.5 + r1 * 0.55), s * (0.85 + r3 * 0.5));
      m.compose(pos, q, scl);
      bushes.setMatrixAt(nb, m);
      col.copy(SAGE).lerp(OLIVE, r1);
      col.lerp(STRAW, dry * 0.75);
      col.lerp(DARK, (1 - dry) * 0.35 * r2);
      col.multiplyScalar(0.84 + 0.3 * r3);
      bushes.setColorAt(nb, col);
      nb++;
    }
  }

  const g = new THREE.Group();
  g.name = 'vegetation';
  for (const [mesh, n] of [[bushes, nb], [rocks, nr], [trunks, nt], [crowns, nt]]) {
    mesh.count = n;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (n > 0) g.add(mesh);
  }
  g.userData.counts = { bushes: nb, rocks: nr, trees: nt };
  return g;
}
