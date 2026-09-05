// world/cliff.js — the land. Owned by task `world`.
//
// One analytic height field is the single source of truth: the CPU function
// surfaceHeight(x,z) that flight.js and onfoot.js call every step, and the mesh, are
// generated from the same code. If they ever disagree the player walks through rock.
//
// Reference: malibu_cliff_hero.jpg — a raw brown-ochre eroded headland, strata banding in
// the vertical faces, dry sage scrub on the flat top, hazy blue-grey mountains behind.
// The house is the only bright object; the land must stay dusty and warm.

import * as THREE from 'three';
import { fbm, ridged, smoothstep, clamp, lerp, valueNoise } from './props.js';

export const SEA_LEVEL = 0;

/* Where things are. Everything else in src/world/ imports these. */
export const SITES = {
  // r was 560: a flat disc 1.1 km across with the house in the middle of it, which is
  // why every aerial render showed the building sitting on a green billiard table. 240
  // covers the house, its court and its driveway and lets the land start moving again
  // immediately outside them.
  house:  { x: 0,     z: 20,   h: 96, r: 240 },   // cliff-top pad, centred on the house
  town:   { x: 1850,  z: 1250, h: 46, r: 700 },
  fair:   { x: 2950,  z: 560,  h: 40, r: 620 },
  donut:  { x: -1380, z: 980,  h: 54, r: 300 },
};

/* ── the coastline ──
 * The cliff edge is not a straight line: it wanders, and the plateau behind it rises.
 * edgeZ(x) is the z of the cliff toe; the wall climbs over CLIFF_RUN metres behind it. */
function edgeZ(x) {
  // The base used to be -110, which put the top of the cliff 24 m seaward of the house's
  // own edge: the house stood on a flat green table with the drop somewhere out in
  // front, and the whole point of this location — a building hanging in the air over the
  // Pacific — was gone. At -78 the lip lands directly under the seaward lobe, so the
  // column row stands on falling rock and the cantilever reads.
  // NOTE: ocean.js duplicates this function as coastZ() in GLSL for the surf line. Both
  // must change together or the foam detaches from the rock.
  return -88 + 46 * Math.sin(x * 0.00062) + 22 * Math.sin(x * 0.0019 + 1.7)
         + 9 * Math.sin(x * 0.0064 + 0.4);
}
// How much horizontal run the wall takes to climb from the toe to the plateau. Kept
// short on purpose: in malibu_cliff_hero the face under the house is a broken near-
// vertical wall, not a dune. 60 m of run for a 96 m climb reads as the reference.
function cliffRun(x) {
  return 46 + 18 * Math.sin(x * 0.0013 + 2.2) + 7 * Math.sin(x * 0.0047 + 0.9);
}

/** Height of the inland plateau before pads are stamped into it. */
function plateauH(x, z) {
  let h = 92;
  h += (fbm(x * 0.00042 + 11, z * 0.00042 + 5, 4) - 0.5) * 74;       // rolling hills
  h += (fbm(x * 0.0021 + 3, z * 0.0021 + 9, 3) - 0.5) * 11;          // ground undulation
  // Erosion. Two octaves of ridged noise SUBTRACTED, which cuts arroyos and canyon
  // fingers instead of adding lumps. Without this the headland was three frequencies of
  // fbm, and three frequencies of fbm is a sand dune every time: smooth, round, and
  // completely unlike a coastal range that water has been running off for ten millennia.
  h -= ridged(x * 0.0030 + 5, z * 0.0030 + 2, 2) * 13 * (0.4 + 0.6 * fbm(x * 0.0006, z * 0.0006, 2));
  h -= ridged(x * 0.0115 + 21, z * 0.0115 + 7, 2) * 3.2;
  // ridge line rising to the north-east — reads as the foot of the mountains
  h += smoothstep(900, 5200, z + x * 0.25) * 340 * (0.4 + 0.6 * ridged(x * 0.0004, z * 0.0004, 3));
  return h;
}

/* How strongly the last stampPads() call was inside a pad, 0..1. terrainHeight reads it
 * immediately afterwards to suppress the ground-noise term. Module-scoped rather than
 * returned so the hot path allocates nothing: this function runs ~500 000 times when the
 * terrain mesh is built and once per physics step per query after that. */
let _padT = 0;

/** Flattened building pads, blended in so the terrain does not step. */
function stampPads(x, z, h) {
  _padT = 0;
  for (const k in SITES) {
    const s = SITES[k];
    // The radius is warped by noise before the falloff is taken. A clean circular blend
    // stamps a visible crop circle into the hillside — from 200 m up the house sat in
    // the middle of three concentric terraces, which is the tell of a generated world.
    // …but the wobble is faded IN with distance, so the inner 35 % of every pad is
    // still exactly, provably flat. Buildings and forecourts are flat meshes laid 2 cm
    // above s.h; a pad that wanders inside their footprint puts terrain through them
    // and the ground breaks into z-fighting stripes (the fairground did exactly that).
    const d0 = Math.hypot(x - s.x, z - s.z);
    const wob = 1 + (fbm(x * 0.0055 + 3, z * 0.0055 + 8, 3) - 0.5) * 0.55
                    * smoothstep(s.r * 0.35, s.r * 0.8, d0);
    const d = d0 * wob;
    const t = 1 - smoothstep(s.r * 0.55, s.r * 1.05, d);
    if (t > _padT) _padT = t;
    if (t > 0) h = lerp(h, s.h, t);
  }
  return h;
}

/** THE height field. Metres. Used by the mesh builder and by ctx.world.surfaceHeight. */
export function terrainHeight(x, z) {
  const e = edgeZ(x);
  const run = cliffRun(x);

  // seabed: shelves away from the cliff toe
  const depth = -8 - smoothstep(e, e - 900, z) * 46
                - (fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 14;

  if (z <= e - 6) return depth;

  // the wall itself. A single smoothstep would give a soft dune; the reference is a
  // near-vertical face, so the profile is biased hard and broken up by strata.
  const t = clamp((z - (e - 6)) / (run + 6), 0, 1);
  // Three bands, because a single smoothstep gives a dune: a short talus at the foot,
  // a near-vertical middle that eats 84 % of the climb in half the run, and a rounded
  // lip at the top. That profile is what makes the silhouette read as a sea cliff.
  const profile = smoothstep(0.10, 0.66, t) * 0.84 + smoothstep(0, 1, t) * 0.16;
  const top = stampPads(x, z, plateauH(x, z));
  let h = lerp(depth, top, profile);

  if (t < 1.0) {
    // Horizontal strata + vertical erosion gullies, only on the face. Both noise fields
    // are sampled on (x, h) rather than (x, z): on a wall that is 96 m tall and 40 m
    // deep, sampling in z gives a field that barely changes over the whole face, which
    // is exactly how the first pass ended up a smooth ochre dune. Sampling on height
    // makes the gullies run DOWN the face, which is what erosion does.
    //
    // Frequencies matter as much as amplitude: the old gully term was at 1/0.012 = 83 m,
    // longer than the face is tall, so it moved the whole wall instead of carving it.
    // 18 m ledges and 6 m fluting are what read as rock from 200 m out.
    /* Anisotropy is the whole trick here. The previous pass sampled the erosion noise at
     * nearly the same frequency in x and in h (0.055/0.045, then 0.17/0.13), and noise
     * that is isotropic on a wall does not read as rock — it reads as BRICKWORK. Every
     * render of the cliff came back as a wall of tan rectangles.
     *
     * Water does not erode a cliff isotropically. It runs DOWN, so the features are long
     * in h and short in x: gullies and flutes, tens of metres tall and a few metres wide,
     * cut across by thin horizontal bedding planes. Sampling x eight times faster than h
     * is what turns the same noise into that. */
    const face = Math.sin(Math.PI * clamp(t, 0, 1));
    h += Math.sin(h * 0.5 + valueNoise(x * 0.004, 0) * 6) * 1.15 * face;    // bedding planes
    h += (ridged(x * 0.085, h * 0.011, 3) - 0.5) * 7.0 * face;              // major gullies
    h += (ridged(x * 0.28, h * 0.035, 2) - 0.5) * 2.4 * face;               // fluting
    h += (fbm(x * 0.42, z * 0.42, 2) - 0.5) * 0.7 * face;                   // grain
  } else {
    // Ground grain — but NOT inside a building pad. This was unconditional, so every
    // "flat" pad still had +/-45 cm of noise in it while the forecourts, plazas and
    // terraces laid on top of them sit 2 cm proud: the fairground, the town and the
    // house terrace all broke into z-fighting stripes where the ground came through.
    // A pad is a promise that the ground is exactly s.h, and this is what keeps it.
    h += (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 0.9 * (1 - _padT);
  }
  return h;
}

/** Slope 0..1 (0 = flat). Used for colouring and for "can I stand here". */
export function terrainSlope(x, z) {
  const d = 2.0;
  const hx = terrainHeight(x + d, z) - terrainHeight(x - d, z);
  const hz = terrainHeight(x, z + d) - terrainHeight(x, z - d);
  return Math.min(1, Math.hypot(hx, hz) / (2 * d) / 2.2);
}

/* ── colour ──
 * Vertex colours only. A tiled albedo map smears badly on a near-vertical cliff, and
 * the reference cliff is a colour gradient with rock showing through scrub, not a
 * repeating pattern.
 */

/* Sampled off reference/world/malibu_cliff_hero.jpg and malibu_aerial_colour.jpg rather
 * than invented. The tell of the first pass was SATURATION: the rock was 0x9c7752, a
 * saturated orange-brown, and a saturated cliff under a hazy Californian sun reads as a
 * sand dune from every altitude. Real Malibu bluff is a pale, nearly desaturated
 * cream-tan (its green channel sits only ~8 % under its red, not 25 %), with the colour
 * information carried by three narrow courses — a cool grey-brown seam, the body rock,
 * and a bleached sandstone band — not by one hot hue. */
const COL_ROCK_DARK = new THREE.Color(0x42362a);   // damp seam: deep, and cool, not chocolate
const COL_ROCK = new THREE.Color(0xa08a72);        // body rock
const COL_ROCK_LIGHT = new THREE.Color(0xe0d2b8);  // bleached sandstone course
const COL_SCRUB = new THREE.Color(0x5b6742);
const COL_SCRUB_DARK = new THREE.Color(0x3c4a30);  // the shaded coastal sage in the gullies
const COL_DRYGRASS = new THREE.Color(0x9f9668);
const COL_SAND = new THREE.Color(0xc7b596);
const COL_DEEPSAND = new THREE.Color(0x7d7259);
const _veg = new THREE.Color();

function terrainColor(x, z, h, slope, out) {
  const n = fbm(x * 0.008, z * 0.008, 3);
  const n2 = fbm(x * 0.0013 + 40, z * 0.0013 + 12, 3);

  // Strata. On a near-vertical face the x/z noise above barely changes over the 30 m of
  // run the wall occupies, so the rock came out one flat mud colour. Banding on HEIGHT
  // is what the reference plate actually shows — pale sandstone courses separated by
  // darker seams.
  //
  // But ONLY on rock. Applied everywhere, a height band paints contour lines across the
  // flat plateau: every render of the headland came back looking like a topographic map,
  // because a 3 m rise over 400 m of gently sloping ground crosses two whole bands. The
  // strata amplitude is now tied to how steep the ground is, which is the same thing as
  // asking whether there is any rock exposed to have strata in.
  const exposure = smoothstep(0.16, 0.5, slope);
  /* Two band frequencies, not one. A single 11 m sine gives eight identical stripes down
   * the face and the eye reads it as corduroy; real bedding is a THICK course of pale
   * rock every ten metres or so with two or three thin dark seams inside it. The fast
   * term is what supplies those seams, and it is deliberately narrow — raised to the
   * fourth power so it is dark only in a thin line and not for half its period. */
  const wob = valueNoise(x * 0.004, 0) * 9;
  const coarse = 0.5 + 0.5 * Math.sin(h * 0.19 + wob);
  /* The seam frequency is the difference between bedding and BRICKWORK. At h*2.1 the
   * dark line repeats every 3 m, and 3 m horizontal lines crossed with the 3.6 m vertical
   * flutes of the erosion field produce a grid — the render came back as a cobbled wall.
   * Real bedding planes are metres apart and the vertical features are much finer than
   * the horizontal ones, so the two never form a lattice. */
  const seam = Math.pow(0.5 + 0.5 * Math.sin(h * 0.62 + wob * 1.7 + fbm(x * 0.03, h * 0.05, 2) * 4), 4);
  const band = clamp(coarse * (0.55 + 0.45 * fbm(x * 0.02, h * 0.06, 2)) - seam * 0.55, 0, 1);
  const bt = clamp(lerp(n, band * 0.86 + n * 0.14, exposure), 0, 1);
  // three courses, not two: a dark seam, the body rock, and a pale sandstone band.
  out.copy(COL_ROCK_DARK)
     .lerp(COL_ROCK, smoothstep(0.0, 0.38, bt))
     .lerp(COL_ROCK_LIGHT, smoothstep(0.46, 0.95, bt) * 0.92);

  /* ── cavity darkening ──
   * This is the single term that turns the face from a corrugated dune into rock. The
   * height field carves gullies with ridged(x*0.085, h*0.011, 3); geometry alone cannot
   * show them, because the sun in this world comes from over the water and hits the
   * whole west-facing wall at almost the same angle, so every flute gets the same
   * lambert term and the wall renders as one flat sheet of tan.
   *
   * Real rock is dark in its grooves whether or not the sun reaches them — wet, mossy,
   * shadowed, and simply further from the sky dome. Sampling the SAME noise field the
   * geometry used and multiplying the albedo down where it is low is a hand-painted
   * ambient occlusion, and it costs one noise lookup on a mesh that is built once. */
  const carve = ridged(x * 0.085, h * 0.011, 3);
  const flute = ridged(x * 0.28, h * 0.035, 2);
  /* 0.34, not 0.55. Cavity occlusion is the difference between a dune and rock, but it
   * only subtracts — push it far enough and the wall stops being a pale ochre bluff with
   * dark cracks in it and becomes a dark brown bluff with pale streaks, which is the
   * opposite of the plate. The bump map now carries the fine relief, so this term only
   * has to seat the metre-scale gullies. */
  out.multiplyScalar(1 - (0.34 * (1 - carve) + 0.10 * (1 - flute)) * exposure);

  /* flat ground grows scrub; steep faces stay bare rock. The instanced chaparral in
   * props.js sits on top of this — the ground colour under it has to already be the
   * right family, or the bushes read as green confetti scattered on a desert.
   *
   * Two greens, not one. In the plate the cliff top is a grey-green mat that gets
   * markedly DARKER as it spills into the gullies and over the lip, and that tonal
   * split is most of what stops the headland reading as a painted billiard table. The
   * carve field decides which green, so the streaks land in the same grooves the
   * geometry cut. */
  const veg = (1 - smoothstep(0.34, 0.72, slope)) * smoothstep(0.06, 0.40, n2);
  /* Weighted towards DRY, not towards green. At n*0.85 the plateau came back as an
   * English lawn with a hard tan boundary where the scrub mask ended — but Malibu in the
   * dry season is straw with sage IN it, and the sage is grey-green rather than grass
   * green. Biasing the mix to the straw end and holding the final blend at 0.82 lets the
   * rock colour underneath keep showing through, which is what removes the boundary. */
  _veg.copy(COL_SCRUB).lerp(COL_DRYGRASS, clamp(0.30 + n * 0.85, 0, 1));
  _veg.lerp(COL_SCRUB_DARK, smoothstep(0.62, 0.16, carve) * 0.7);
  out.lerp(_veg, veg * 0.82);
  // …and scrub that has taken hold in the gullies of the face itself, where the runoff
  // is. Only in the deep grooves, only on the upper two thirds — the toe stays bare.
  const gullyVeg = smoothstep(0.42, 0.10, carve) * smoothstep(0.18, 0.55, slope)
                 * smoothstep(20, 55, h) * smoothstep(0.35, 0.62, n2);
  out.lerp(COL_SCRUB_DARK, gullyVeg * 0.55);

  // beach and the wet band at the waterline
  const beach = 1 - smoothstep(1.5, 9.0, h);
  out.lerp(COL_SAND, beach * (1 - smoothstep(0.35, 0.6, slope)));
  const sub = 1 - smoothstep(-14, 0.5, h);
  out.lerp(COL_DEEPSAND, sub * 0.8);
  /* Dust and shading variation so large flats do not read as flat colour.
   *
   * Sampled on (x, z) it does nothing whatever on the cliff: the face is 96 m tall but
   * only ~40 m deep, so z barely moves across it and the whole wall got ONE value of
   * this term. Blending the second axis to height as the ground steepens — the same
   * trick the UVs use, and for the same reason — is what lets it break the face up. */
  const vAxis = lerp(z, h * 2.2, exposure);
  /* Two frequencies. One term at a 25 m period gives the broad drifts, and on the flat
   * plateau — where the term is the ONLY variation, because slope, strata and cavity are
   * all switched off there — it painted the headland in wide soft stripes that read as a
   * mown golf course from the air. The second term at 4 m breaks the stripe up into
   * patchy dry ground without touching the large-scale colour. */
  out.multiplyScalar(0.84 + 0.32 * fbm(x * 0.04, vAxis * 0.04, 2));
  out.multiplyScalar(0.90 + 0.20 * fbm(x * 0.26 + 17, vAxis * 0.26 + 5, 2));
  return out;
}

/**
 * Build the terrain mesh.
 *
 * The grid is non-uniform: parameter u in [-1,1] maps to x = sign(u)*|u|^POW*EXTENT, so
 * vertex density concentrates around the house and the cliff (where the camera lives on
 * foot and where the silhouette matters) and thins out towards the 6 km horizon. One
 * mesh, one draw call, roughly 0.4 m spacing at the cliff and 90 m at the far edge.
 */
export function buildTerrain(opts = {}) {
  const N = opts.segments || 400;
  const EXTENT = opts.extent || 6400;
  const POW = 3.0;
  // NEAR is the half-width of the roughly-uniform middle of the grid. A pure power map
  // (which is what this was) put 25 m between vertices at the cliff and rendered a 96 m
  // near-vertical wall as four rows of quads — a smooth dune. Blending a linear term in
  // costs nothing and pins the spacing at the cliff to 2*NEAR/N.
  const NEAR = opts.near != null ? opts.near : 900;
  // …and the dense band has to be centred on the CLIFF, not on the middle of the map.
  const ZC = opts.zCenter != null ? opts.zCenter : -40;

  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const tmp = new THREE.Color();

  const mapAxis = (i) => {
    const u = (i / N) * 2 - 1;
    const a = Math.abs(u);
    return Math.sign(u) * (NEAR * a + (EXTENT - NEAR) * Math.pow(a, POW));
  };

  // Pass 1: positions only. terrainHeight is the expensive call, so it happens once per
  // vertex and the slope in pass 2 is read off the grid instead of re-sampling.
  const xs = new Float64Array(N + 1), zs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { xs[i] = mapAxis(i); zs[i] = mapAxis(i) + ZC; }
  for (let j = 0, k = 0; j <= N; j++) {
    const z = zs[j];
    for (let i = 0; i <= N; i++, k++) {
      const x = xs[i];
      const h = terrainHeight(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
  }

  // Pass 2: colour, using a grid-derived slope.
  for (let j = 0, k = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++, k++) {
      const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const iL = Math.max(0, i - 1), iR = Math.min(N, i + 1);
      const jD = Math.max(0, j - 1), jU = Math.min(N, j + 1);
      const dh = pos[(j * (N + 1) + iR) * 3 + 1] - pos[(j * (N + 1) + iL) * 3 + 1];
      const dv = pos[(jU * (N + 1) + i) * 3 + 1] - pos[(jD * (N + 1) + i) * 3 + 1];
      const dx = Math.max(0.5, xs[iR] - xs[iL]), dz = Math.max(0.5, zs[jU] - zs[jD]);
      const slope = Math.min(1, Math.hypot(dh / dx, dv / dz) / 1.4);
      terrainColor(x, z, h, slope, tmp);
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      // UVs are written here, not in pass 1, because they depend on the slope. A plan
      // projection (x/40, z/40) is right for the flat top and catastrophic on the cliff:
      // the face is 96 m tall but only 40 m deep, so the whole wall got a third of one
      // texture tile stretched down it and the grain smeared into vertical streaks.
      // Blending the second axis from z to HEIGHT as the ground steepens keeps the
      // texel size roughly constant everywhere, which is the whole job of a UV.
      const vAxis = z + (h - z) * Math.min(1, slope * 1.6);
      uvs[k * 2] = x / 14; uvs[k * 2 + 1] = vAxis / 14;
    }
  }

  const idx = new Uint32Array(N * N * 6);
  for (let j = 0, t = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Distant mountains. Reference: hazy blue-grey ridges stacked behind the house, heavily
 * atmospheric. Built as three low-poly ridge bands far outside the terrain so they cost
 * nothing and never move.
 */
export function buildMountains() {
  const g = new THREE.Group();
  g.name = 'mountains';
  const _mtnFoot = new THREE.Color();
  /* Four bands, and the nearest is much darker and much less blue than it was.
   *
   * The first pass used three bands within 0.1 of each other in value, all of them
   * already washed to the sky's own blue-grey — so they rendered as flat paper cut-outs
   * with no reading of which was in front. In malibu_cliff_hero the near range still
   * has real local contrast (you can see individual canyons and their shadow sides) and
   * only the FAR ridges go to flat haze. Aerial perspective is a gradient, not a
   * constant, so the bands now step: dark and warm-ish at 6.5 km, pale and blue at
   * 18 km, and each ridge gets a lateral sun term so its west faces are lit and its
   * east faces are not. That is what makes a silhouette read as a mountain. */
  const bands = [
    /* Nearer and taller than they were. Malibu sits at the foot of the Santa Monicas and
     * in the plate they fill the top third of the frame — 500 m of ridge 5 km away
     * subtends 6 degrees and reads as a low bump on the horizon, which is what every
     * render came back with. 900 m at 4.2 km subtends 12 and reads as mountains. */
    { r: 4200,  h: 900,  seed: 3,  color: 0x6d7a68, rough: 5, shade: 0.62 },
    { r: 6600,  h: 1250, seed: 17, color: 0x74827a, rough: 5, shade: 0.46 },
    { r: 9600,  h: 1750, seed: 41, color: 0x7d8a8e, rough: 4, shade: 0.30 },
    { r: 13000, h: 2400, seed: 63, color: 0x86929c, rough: 4, shade: 0.16 },
  ];
  /* Aerial perspective, baked in.
   *
   * These meshes carry fog:false — they have to, or a 13 km ridge would be 100 % fog
   * colour and simply vanish. But "no fog" also meant they rendered at FULL saturation
   * behind a landscape that was being hazed, which is exactly why every render came back
   * with the mountains reading as flat paper cut-outs pasted on the sky. So the haze the
   * fog would have applied is mixed into the vertex colours here instead: same result,
   * under our control, and a ridge can still be visible at 13 km without being opaque.
   * The numbers are scene.fog's own ramp (near 900, far 14000) evaluated at each radius,
   * pulled back a little so the far ridge does not disappear entirely. */
  const HAZE = new THREE.Color(0xb8cbdd);
  for (const b of bands) {
    const fogT = clamp((b.r - 900) / (14000 - 900), 0, 1) * 0.88;
    const SEG = 320;
    const pos = [], col = [], idx = [];
    const base = new THREE.Color(b.color);
    const top = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * b.r, z = Math.sin(a) * b.r;
      // no mountains out to sea: fade the ridge to nothing on the ocean side (-z)
      const seaward = smoothstep(-0.15, 0.7, Math.sin(a));
      const rid = ridged(i * 0.09 + b.seed, b.seed, b.rough);
      const h = b.h * (0.25 + 0.95 * rid) * seaward;
      // Lateral shading: the derivative of the ridge line along the band tells us which
      // way this piece of mountain faces. The sun is over the water (west, -x), so a
      // face whose height is FALLING to the west is turned towards it and lights up.
      const rid2 = ridged((i + 1) * 0.09 + b.seed, b.seed, b.rough);
      const facing = clamp((rid - rid2) * 6 * Math.sign(Math.cos(a)), -1, 1);
      const lit = 1 + facing * b.shade * 0.55;
      top.copy(base).multiplyScalar(lit * (0.96 + 0.16 * rid)).lerp(HAZE, fogT);
      _mtnFoot.setRGB(base.r * (1 - b.shade * 0.5), base.g * (1 - b.shade * 0.45),
                      base.b * (1 - b.shade * 0.35)).lerp(HAZE, Math.min(1, fogT + 0.10));
      pos.push(x, -60, z, x, h, z);
      col.push(_mtnFoot.r, _mtnFoot.g, _mtnFoot.b, top.r, top.g, top.b);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2, bb = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, bb, bb, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: false,
    }));
    mesh.renderOrder = -5;
    g.add(mesh);
  }
  return g;
}
