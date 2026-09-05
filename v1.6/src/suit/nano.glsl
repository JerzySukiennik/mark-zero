// MARK ZERO — nanotech deploy shader (Mark L). Owned by task `suitup`.
//
// Injected into a MeshStandardMaterial by src/suit/nano.js, so the armour keeps its
// PBR shading, its environment map and its clear coat, and only gains a moving
// boundary. Reference: reference/suitup/mk50_nano_flowing_face.jpg and
// mk50_nano_deploy.jpg — ahead of the boundary there is SKIN, behind it there is
// finished satin surface, and the boundary itself is a ragged fringe of tiny dark
// shapes with cyan light leaking out of the seams that have not closed yet.
//
// The coordinate the wave travels along is aFlow: geodesic distance from the chest
// reactor measured ALONG THE BODY (rig.js computes it through the joint chain, so the
// wave goes over the shoulder and down the arm instead of jumping through the air).
//
// Sections are delimited by "---8<--- name" and pulled apart by nano.js.

// ---8<--- common
// Cheap hash-based cell noise. The nano fringe must be made of small discrete shapes,
// not a smooth alpha ramp: a smooth ramp reads as a dissolve, and the whole point of
// this material is that it reads as matter arriving.
float mzHash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
// Cell id and distance to the cell border, on a jittered cubic grid.
//
// This was a 3x3x3 Voronoi. It looked marginally better and it cost the game half a
// minute: the 27-cell neighbour search unrolls into thousands of instructions and the
// SHADER COMPILE alone blocked the main thread for ~30 s in a headless browser and for
// seconds on a real one — measured, and it was the reason a Mk L suit-up appeared not to
// start at all. At the size these shards are drawn (a couple of millimetres on screen) a
// jittered cubic cell is indistinguishable, and it is ten instructions.
vec2 mzCells(vec3 p) {
  vec3 i = floor(p);
  float id = mzHash13(i);
  p += (id - 0.5) * 0.35;                 // break the grid so it never reads as a grid
  i = floor(p);
  id = mzHash13(i);
  vec3 d = 0.5 - abs(fract(p) - 0.5);
  float border = min(min(d.x, d.y), d.z) * 2.0;
  return vec2(id, border);                // x: per-cell random, y: 0 at the border, 1 mid-cell
}

// ---8<--- vertex_pars
attribute float aFlow;
varying float vFlow;
varying vec3 vNanoLocal;

// ---8<--- vertex_main
vFlow = aFlow;
vNanoLocal = position;

// ---8<--- fragment_pars
uniform float uEdge;      // where the leading edge currently is, in flow units
uniform float uBand;      // how deep the granular fringe reaches ahead of the edge
uniform float uSeamW;     // how far behind the edge the seams are still glowing
uniform vec3  uSeam;      // seam colour (cyan; always cooler than the gold)
uniform float uGrain;     // cells per metre
uniform float uOn;        // 0 = shader inert (fully formed suit), 1 = deploying
varying float vFlow;
varying vec3 vNanoLocal;

// ---8<--- fragment_body
// Everything here runs before lighting, so the fringe is really unlit dark matter and
// the finished surface behind it is really the shipped material.
float nanoFringe = 0.0;
float nanoSeam = 0.0;
if (uOn > 0.5) {
  float d = vFlow - uEdge;                 // >0: ahead of the wave, not formed yet
  // Shards STRETCHED along the direction the wave travels. An isotropic cubic cell
  // gives confetti, and confetti reads as a dissolve; the reference boundary
  // (reference/suitup/mk50_nano_flowing_face.jpg) is a filigree of slivers all leaning
  // the same way, which is what says the material is FLOWING rather than fading in.
  vec2 cell = mzCells(vNanoLocal * uGrain * vec3(1.0, 0.42, 1.0));
  if (d > 0.0) {
    // Ahead of the edge: keep only whole cells, and fewer of them the further ahead
    // they are. This is the ragged crawling fringe, not a soft fade.
    float keep = 1.0 - clamp(d / uBand, 0.0, 1.0);
    keep = keep * keep;
    if (cell.x > keep) discard;
    // cell borders read as gaps between the tiny shapes
    if (cell.y < 0.075) discard;
    nanoFringe = clamp(d / uBand, 0.0, 1.0);
  }
  // Just behind the edge the plate exists but its seams have not closed: cyan light
  // leaks out of them along the flow direction.
  //
  // It is LINES, not a wash. The wash term used to be 0.35 of a full-strength cyan over
  // the whole 8 cm behind the boundary, which through the bloom pass is a cyan lamp the
  // size of a torso: shots/suitup/N_mk50_22.png was a white-cyan fog with no armour
  // visible in it at all. The reference has the finished surface reading as ordinary
  // burgundy within a couple of centimetres of the edge, with the glow only in the
  // hairline gaps between shards.
  float behind = clamp((uEdge - vFlow) / uSeamW, 0.0, 1.0);
  float seamLines = pow(abs(sin(vFlow * 190.0 + cell.x * 3.0)), 26.0);
  float gaps = 1.0 - smoothstep(0.075, 0.34, cell.y);     // the joins between shards
  nanoSeam = (1.0 - behind) * (1.0 - behind) * (0.10 + 0.55 * seamLines + 0.35 * gaps)
             * step(vFlow, uEdge);
  nanoSeam += nanoFringe * 0.55;           // the fringe itself is lit from inside

  // The fringe is raw nano dust: near black, rough, no paint yet.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.013, 0.017), nanoFringe);
}

// ---8<--- fragment_emissive
totalEmissiveRadiance += uSeam * nanoSeam * 1.05;

// ---8<--- body_fragment
// The BOY under the armour, same coordinate, opposite test. Where the wave has already
// passed, his sleeve is under a plate and must not z-fight through it — it is gone. Right
// at the boundary the nano is crawling over the cloth, so the last two centimetres go
// dark and pick up the seam colour before they vanish. Ahead of the wave he is simply
// himself, lit like anything else in the room.
float nanoCrawl = 0.0;
if (uOn > 0.5) {
  float d = vFlow - uEdge;                 // <0: already armoured
  if (d < 0.0) discard;
  float crawl = 1.0 - clamp(d / max(uBand, 1e-4), 0.0, 1.0);
  vec2 cellB = mzCells(vNanoLocal * uGrain * 1.4);
  // dark grains climbing onto him at the edge
  float grains = step(cellB.x, crawl * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.021, 0.026), crawl * (0.45 + 0.55 * grains));
  nanoCrawl = crawl;
}

// ---8<--- body_emissive
totalEmissiveRadiance += uSeam * nanoCrawl * nanoCrawl * 0.45;
