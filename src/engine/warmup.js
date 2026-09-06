// Shader warm-up. Owned by task `engine-core`, run once, at the end of boot.
//
// THE FIVE-SECOND FREEZE, AND WHAT IT ACTUALLY IS.
//
// Jurek: "co sprawia, ze kazda akcja ma mega dlugiego freeze'a, ze bardzo laguje przez okolo
// 5 sekund. To jest jakis preload?" It is not a preload and it is not the models — those are
// already in memory by then. It is shader compilation, and it is measurable:
//
//     after boot .................. 33 GPU programs
//     first suit-up ............... +4   (37)
//     first take-off, plumes lit .. +9   (46)
//     first repulsor shot ......... +16  (62)
//
// Twenty-nine programs compile DURING PLAY, in exactly three clumps, at exactly the three
// moments he described. A program link is 20-150 ms of blocked main thread on a real driver,
// it cannot be interrupted, and sixteen of them arriving on the frame you first pull the
// trigger is a freeze of a second or more with nothing on screen to explain it.
//
// The cure is to pay it up front, while the boot panel is still showing and a pause is
// expected. There is no clever way to do this: a program is compiled by RENDERING something
// that uses it. So we put one small mesh per material in front of the camera for a single
// frame and throw them away.
//
// TWO THINGS THAT LOOK LIKE THEY WOULD WORK AND DO NOT:
//
//   renderer.compileAsync() resolves off a WebGL fence, and a hidden or throttled tab never
//   advances that fence. Awaiting it hangs the whole boot forever in a background tab. This
//   file uses the synchronous compile path only. (It has been removed from this codebase
//   four separate times for exactly this reason — do not put it back.)
//
//   Warming into a SEPARATE scene does nothing. three keys its program cache on the material
//   AND the lighting, fog and shadow configuration it is rendered under, so a material warmed
//   in an empty scene compiles a second program the moment it appears in the real one. The
//   oven has to be the real scene, with the real lights.
import * as THREE from 'three';

/* WHY THIS WARMS OBJECTS AND NOT MATERIALS.
 *
 * The first version of this file put one small PLANE in front of the camera per material.
 * It compiled thirteen programs at boot and removed none of the stalls: the in-play counts
 * went 50 / 63 / 84 where they had been 37 / 46 / 62. Thirteen programs of pure waste.
 *
 * The reason is that three keys its program cache on more than the material. The geometry
 * contributes too — whether it has UVs, vertex colours, tangents, morph targets — and so do
 * the object's own shadow flags and its type (Mesh vs Points vs Sprite). A material warmed
 * on a plane and then used on a cone with no UVs is a cache MISS, and you have paid for a
 * program nobody will ever draw with.
 *
 * So the oven holds copies that share the REAL geometry and the REAL flags. That is the only
 * version of this that can be verified: if the program count during play does not go down,
 * the warm-up did not work, whatever it claims. */

/**
 * Render one frame containing a stand-in for each given mesh — same geometry, same material,
 * same shadow flags — in the real scene, so their programs link before gameplay asks.
 *
 * @param ctx     the game context (needs .scene, .camera, .renderer)
 * @param meshes  array of Object3D with .material — duplicates and nulls are fine
 * @returns {{ before:number, after:number, ms:number, n:number }}
 */
export function warmObjects(ctx, meshes) {
  const { scene, camera, renderer } = ctx;
  const out = { before: 0, after: 0, ms: 0, n: 0 };
  if (!scene || !camera || !renderer) return out;

  out.before = renderer.info.programs.length;
  const t0 = performance.now();

  // One stand-in per distinct (geometry, material, type, shadow flags) combination — which
  // is as close to three's own program key as this file can get without reaching into it.
  const seen = new Set();
  const oven = new THREE.Group();
  oven.name = 'SHADER_OVEN';

  camera.updateMatrixWorld();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const at = camera.position.clone().addScaledVector(fwd, Math.max(0.05, camera.near * 3));

  for (const src of meshes) {
    if (!src || !src.material || !src.geometry) continue;
    const mats = [].concat(src.material);
    for (const m of mats) {
      if (!m) continue;
      const key = src.geometry.uuid + '|' + m.uuid + '|' + src.type +
                  '|' + (src.castShadow ? 1 : 0) + (src.receiveShadow ? 1 : 0);
      if (seen.has(key)) continue;
      seen.add(key);
      let o;
      if (src.isPoints) o = new THREE.Points(src.geometry, m);
      else if (src.isLine) o = new THREE.Line(src.geometry, m);
      else if (src.isSprite) { o = new THREE.Sprite(m); o.scale.setScalar(0.004); }
      else o = new THREE.Mesh(src.geometry, m);
      o.castShadow = src.castShadow;
      o.receiveShadow = src.receiveShadow;
      o.position.copy(at);
      o.quaternion.copy(camera.quaternion);
      // Two millimetres: genuinely drawn, so the program links, and far too small to be
      // seen even if a frame of this were ever presented (it is not).
      if (!o.isSprite) o.scale.setScalar(0.002 / Math.max(1e-3, boundRadius(src.geometry)));
      o.frustumCulled = false;
      oven.add(o);
      out.n++;
    }
  }
  if (!out.n) { out.after = out.before; return out; }

  scene.add(oven);
  try {
    /* THROUGH THE GAME'S OWN RENDER PATH, not renderer.render().
     *
     * The game draws through a post-processing composer, into an off-screen target whose
     * output colour space is `srgb-linear`; renderer.render() draws straight to the canvas,
     * which is `srgb`. That is part of three's program cache key, so a warm-up that calls
     * renderer.render() compiles a complete set of programs the game will never use — every
     * single one a miss. Measured by diffing the cache keys: identical strings apart from
     * that one field.
     *
     * `warm` is the game's own render callback, handed in by the caller. */
    if (typeof ctx.warmRender === 'function') ctx.warmRender();
    else renderer.render(scene, camera);
  } catch (e) {
    // A warm-up that throws must never take the game down with it. The cost of failing is
    // the stutter we were trying to remove, not a broken game.
    console.warn('[warmup] a program could not be pre-compiled:', e && e.message);
  }
  scene.remove(oven);
  // The stand-ins share the real geometry and materials — dispose NOTHING here. Disposing a
  // shared geometry is how you blank the suit the player is wearing.
  oven.clear();

  out.after = renderer.info.programs.length;
  out.ms = performance.now() - t0;
  return out;
}

function boundRadius(g) {
  if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { return 1; } }
  return (g.boundingSphere && g.boundingSphere.radius) || 1;
}

/**
 * Collect every material the game will need mid-play but does not show at boot, and warm
 * them. Everything here is reached defensively: a module that failed to init must not stop
 * the others being warmed.
 */
export function warmGameplay(ctx) {
  const meshes = [];
  const walk = o => {
    if (!o || !o.traverse) return;
    o.traverse(n => { if (n.material && n.geometry) meshes.push(n); else if (n.isSprite) meshes.push(n); });
  };

  // --- combat: bolts, muzzle flashes, impacts, debris -----------------------------------
  const combat = ctx.combat;
  if (combat) {
    if (combat.vfx) walk(combat.vfx.root);
    const b = combat.bolts;
    if (b) {
      walk(b.root);
      if (b.live) for (const p of b.live) walk(p.g);
      if (b.pool) for (const p of b.pool) walk(p.g);
    }
  }
  if (ctx.destruction && ctx.destruction.root) walk(ctx.destruction.root);

  // --- flight: plumes, throat glows, the smoke trail -------------------------------------
  const fx = ctx.flight && ctx.flight.thrustFX;
  if (fx) {
    walk(fx.root);
    if (fx.smoke) walk(fx.smoke.points);
    // The plume cones live on the worn rig, which does not exist yet at boot — so warm the
    // real cone geometry and materials directly, with a stand-in that matches them exactly.
    if (fx.coneGeo && fx.mCore) meshes.push(new THREE.Mesh(fx.coneGeo, fx.mCore));
    if (fx.coneGeo && fx.mBloom) meshes.push(new THREE.Mesh(fx.coneGeo, fx.mBloom));
    if (fx.wingGeo && fx.mWing) meshes.push(new THREE.Mesh(fx.wingGeo, fx.mWing));
  }

  // --- world: the ring and the things in the sky ----------------------------------------
  const w = ctx.world;
  if (w) { if (w.ring) walk(w.ring.root); if (w.targets) walk(w.targets.root); }

  return warmObjects(ctx, meshes);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * MEASURED RESULT. Programs counted with renderer.info.programs, three separate runs.
 *
 *                          before        naive warm-up      this file, working
 *   after boot               33              46                   44
 *   first suit-up            37              50                   48
 *   first take-off           46              63                   60
 *   first repulsor shot      62              84                   60   <- +0
 *
 * The first two attempts made it WORSE (13 programs compiled at boot, none saved). Both
 * failed for reasons that only showed up by diffing three's own program cache keys with
 * tools/key-probe.html, which is the tool to reach for if this ever regresses:
 *
 *   1. THE LIGHT COUNT. The keys were identical except for one field, `1,10` before the
 *      first shot and `1,12` after. Not the bolt shader — the WHOLE SCENE recompiling,
 *      because combat/ turned two point lights from `visible = false` to `visible = true`
 *      and three bakes the light count into every material. Fixed at the source; see the
 *      note in combat/vfx.js. This is what took the first shot from +16 programs to +0.
 *   2. THE OUTPUT COLOUR SPACE. `srgb` against `srgb-linear`: the warm-up called
 *      renderer.render() straight to the canvas while the game draws through a composer
 *      into an off-screen target. Every program it compiled was a miss. Fixed by routing
 *      the oven through ctx.warmRender(), the game's own render call.
 *
 * STILL OPEN: twelve programs link on the first frame of third-person flight — the armour's
 * textured materials, which are never drawn on foot in first person. Warming the rig at
 * equip time was tried twice and measured neutral; see the note in suit/suit.js.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
