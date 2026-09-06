// One-time material deduplication, run after the world has finished building.
//
// WHY THIS IS WORTH A FILE
// ------------------------
// Measured on the live scene: 6668 meshes carrying 1085 DISTINCT material objects — but
// only 185 distinct material *definitions*. Eighty-two separate meshes each held their own
// private copy of the same `MeshStandardMaterial #6b5a3c roughness 0.98`. That happens
// naturally when props are built in loops and each one calls `new THREE.Material(...)`, and
// nothing about it is visible: the scene looks identical either way.
//
// What it costs is not identical. three keys its render state and its program cache off the
// material object, so N copies of one material are N state blocks, N uniform uploads and N
// missed opportunities to batch — on every shadow pass as well as the colour pass. This is
// the single largest piece of avoidable per-frame work in the game.
//
// WHAT IS DELIBERATELY LEFT ALONE
// -------------------------------
// A material that something MUTATES at runtime cannot be shared, or the mutation leaks into
// every mesh that shares it. The exclusions below are not caution, they are correctness:
//
//   * anything transparent or additively blended — the VFX in combat/vfx.js and
//     flight/thrustfx.js animate `opacity` per instance, and 50 flashes sharing one
//     material would fade as one object;
//   * anything with `userData.glowBase` — suit.js drives `emissiveIntensity` per mesh;
//   * anything under the suit root or the nano shader — those are per-armour and rebuilt
//     on every equip anyway;
//   * anything with a non-zero emissive, for the same reason as glowBase;
//   * ShaderMaterial and RawShaderMaterial — uniforms are per-instance by definition.
//
// The remaining set is the static world: walls, slabs, roads, crates, street furniture.
import * as THREE from 'three';

function signature(m) {
  // Everything that changes how the material renders. Anything not in here must be
  // identical between two materials for them to be interchangeable, so when in doubt the
  // property belongs in the key.
  return [
    m.type,
    m.color ? m.color.getHexString() : '-',
    m.roughness, m.metalness, m.opacity, m.side, m.flatShading,
    m.emissive ? m.emissive.getHexString() : '-',
    m.envMapIntensity, m.bumpScale, m.normalScale ? m.normalScale.x : '-',
    m.map ? m.map.uuid : '-',
    m.normalMap ? m.normalMap.uuid : '-',
    m.roughnessMap ? m.roughnessMap.uuid : '-',
    m.bumpMap ? m.bumpMap.uuid : '-',
    m.aoMap ? m.aoMap.uuid : '-',
    m.alphaMap ? m.alphaMap.uuid : '-',
    m.clearcoat, m.clearcoatRoughness, m.transmission, m.ior,
    m.toneMapped, m.fog, m.depthWrite, m.depthTest, m.blending, m.vertexColors,
  ].join('|');
}

function shareable(m, mesh) {
  if (!m || Array.isArray(m)) return false;
  if (m.isShaderMaterial || m.isRawShaderMaterial) return false;
  if (m.transparent || m.blending !== THREE.NormalBlending) return false;
  if (m.userData && (m.userData.glowBase !== undefined || m.userData.noShare)) return false;
  if (m.emissive && m.emissive.getHex() !== 0) return false;
  if (mesh.userData && mesh.userData.noShare) return false;
  return true;
}

/**
 * @param root  the subtree to deduplicate (the world root — NOT the whole scene, so the
 *              suit, the VFX pools and anything else with a live owner stay untouched).
 * @returns {{before:number, after:number, meshes:number, disposed:number}}
 */
export function dedupeMaterials(root) {
  const seen = new Map();          // signature -> the material everyone will share
  const originals = new Set();
  const keep = new Set();
  let meshes = 0;

  root.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m) return;
    originals.add(m);
    if (!shareable(m, o)) { keep.add(m); return; }
    meshes++;
    const key = signature(m);
    const first = seen.get(key);
    if (!first) { seen.set(key, m); keep.add(m); return; }
    if (first !== m) o.material = first;
  });

  // Free the GPU-side state of every copy nothing points at any more. Textures are shared
  // by reference and are NOT disposed here — that would blank the survivors.
  let disposed = 0;
  for (const m of originals) {
    if (keep.has(m)) continue;
    m.dispose();
    disposed++;
  }
  return { before: originals.size, after: keep.size, meshes, disposed };
}

/* ---------------------------------------------------------------------------------------
 * MERGING THE STATIC CLUTTER
 *
 * Measured with the real renderer, in the three places the player spends time:
 *
 *     living room        145 draw calls
 *     air over the town   68 draw calls
 *     workshop          1443 draw calls        <-- ten times everything else
 *
 * The workshop holds 1158 meshes carrying 33 154 triangles between them — an average of
 * TWENTY-NINE triangles each. It is a thousand little boxes: bench legs, brackets, crates,
 * tool handles. None of that is expensive to draw; all of it is expensive to *submit*, and
 * every one of them is submitted a second time into the shadow map. That is the spike on
 * walking down the stairs, and it is a draw-call problem, not a triangle problem.
 *
 * Merging them by material collapses the submission cost without changing a pixel. What
 * makes it safe is that almost none of this clutter is referenced by anything: exactly ONE
 * mesh in the whole workshop has a name.
 *
 * WHAT IS NEVER MERGED, and why each one matters:
 *   * anything with a name — something looked it up once and may again;
 *   * `userData.worldSolid` — props.js's Handoff holds the mesh and builds a collider from
 *     it, so it has to stay an object with its own transform;
 *   * `userData.breakable` — destruction.js owns it and will replace it with debris;
 *   * anything under a group that animates (the gantry, the armour stands, the tablet);
 *   * anything with children, or invisible, or already merged.
 *
 * The merged result keeps its own castShadow/receiveShadow, so the shadow pass sees the
 * same silhouette from far fewer objects.
 */
import { mergeGeometries } from '../../vendor/three-addons/utils/BufferGeometryUtils.js';

const ANIMATED = /gantry|stand|case|tablet|nano|suit|light|glow|screen/i;
const _m = new THREE.Matrix4();

function mergeable(o, allowNamed) {
  if (!o.isMesh || Array.isArray(o.material) || !o.material) return false;
  if (o.name && !allowNamed) return false;
  if (o.children.length) return false;
  if (!o.visible) return false;
  const u = o.userData || {};
  if (u.worldSolid || u.breakable || u.noMerge || u.merged) return false;
  /* NEVER TRANSPARENT. Transparent objects are depth-sorted per OBJECT, back to front; fold
   * a dozen of them into one mesh and they are drawn in whatever order their triangles
   * happen to sit in the buffer. Measured against ?nomerge=1: with transparents in the
   * batch the stairwell view differed on 1.62% of sampled pixels with a peak channel delta
   * of 218 — that is glass drawing in the wrong order, not noise. The workshop, which has
   * almost none, was identical to within a delta of 9. */
  if (o.material.transparent || o.material.blending !== THREE.NormalBlending) return false;
  if (o.material.depthWrite === false) return false;
  const g = o.geometry;
  if (!g || !g.getAttribute('position')) return false;
  if (g.getAttribute('position').count > 6000) return false;   // big meshes cull better alone
  for (let p = o.parent; p; p = p.parent) if (ANIMATED.test(p.name || '')) return false;
  return true;
}

/** position + normal + uv only, so every geometry in a group has the same attribute set.
 *  `toLocal` takes world space back into the frame the merged mesh will live in — do NOT
 *  assume that frame is the identity just because the group looks untransformed. */
function normalise(mesh, toLocal) {
  const src = mesh.geometry;
  const g = (src.index ? src.toNonIndexed() : src.clone());
  const keep = new THREE.BufferGeometry();
  keep.setAttribute('position', g.getAttribute('position').clone());
  const n = g.getAttribute('normal');
  keep.setAttribute('normal', n ? n.clone()
    : new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
  const uv = g.getAttribute('uv');
  keep.setAttribute('uv', uv ? uv.clone()
    : new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (!n) keep.computeVertexNormals();
  mesh.updateWorldMatrix(true, false);
  _m.copy(toLocal).multiply(mesh.matrixWorld);
  keep.applyMatrix4(_m);
  if (src !== g) g.dispose();
  return keep;
}

/**
 * @param root  subtree to bake — pass the smallest thing that helps, not the whole scene.
 * @param opts.allowNamed  merge named meshes too. OFF by default and it should stay off:
 *        a name is the only sign this file has that something looked a mesh up once and
 *        may again. Turn it on only where the caller can say for certain that nothing
 *        walks the subtree by name — the armour display cases are such a place, because
 *        they are clones nobody reads back.
 * @param minGroup  do not bother below this many meshes; a merge of two costs a draw call
 *                  either way and loses their individual frustum culling.
 * @returns {{before:number, merged:number, batches:number, left:number}}
 */
export function mergeStatic(root, minGroup = 6, opts = {}) {
  /* Verified on GEOMETRY, not on pixels.
   *
   * A pixel A/B of this is worthless: the scene animates — glowing screens, the reactor's
   * breath, the practicals, the water — so two separate runs differ on about 1% of pixels
   * with peak channel deltas over 200 whether or not anything was merged. Measured, after
   * an afternoon of reading meaning into that noise.
   *
   * What IS deterministic is the geometry. A correct merge changes neither the number of
   * triangles in the subtree nor the world-space box they occupy, so both are measured
   * before and after and returned. If either moves, the transform baking is wrong. */
  root.updateWorldMatrix(true, true);
  const census = () => {
    let tris = 0;
    const box = new THREE.Box3();
    root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.getAttribute('position');
      if (!pos) return;
      tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      box.expandByObject(o);
    });
    return { tris: Math.round(tris), box };
  };
  const pre = census();
  const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const before = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    before.push(o);
    if (!mergeable(o, opts.allowNamed)) return;
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + '|' + (o.receiveShadow ? 1 : 0);
    let a = groups.get(key);
    if (!a) groups.set(key, a = []);
    a.push(o);
  });

  let merged = 0, batches = 0;
  const orphaned = new Set();
  for (const list of groups.values()) {
    if (list.length < minGroup) continue;
    let geo = null;
    try { geo = mergeGeometries(list.map(m => normalise(m, toLocal)), false); }
    catch (e) { geo = null; }
    if (!geo) continue;
    const first = list[0];
    const out = new THREE.Mesh(geo, first.material);
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    out.userData.merged = true;
    out.name = 'merged_' + (first.material.name || 'batch') + '_' + batches;
    root.add(out);
    // Detach now; decide what may be freed AFTER every batch is done — see below.
    for (const m of list) { m.removeFromParent(); orphaned.add(m.geometry); }
    merged += list.length;
    batches++;
  }
  /* FREE ONLY WHAT NOTHING ELSE IS USING.
   *
   * The first cut of this disposed each merged mesh's geometry on the spot, which is a
   * quiet way to break the game: geometries are routinely SHARED. props.js hands the same
   * box to a hundred crates, combat/vfx.js keeps one sphere and one ring for every effect,
   * and the display rack holds whole armour models whose geometry the wearable rig may
   * also be holding. Dispose one of those and some object elsewhere in the scene — or the
   * suit you put on ten minutes later — renders as nothing.
   *
   * So: collect the candidates while merging, then walk the WHOLE SCENE once and free only
   * the ones no surviving mesh still points at. */
  let scene = root;
  while (scene.parent) scene = scene.parent;
  const candidates = orphaned.size;
  scene.traverse(o => { if (o.isMesh && o.geometry) orphaned.delete(o.geometry); });
  let freed = 0;
  for (const g of orphaned) { g.dispose(); freed++; }

  const post = census();
  const dBox = pre.box.isEmpty() || post.box.isEmpty() ? -1 : Math.max(
    pre.box.min.distanceTo(post.box.min), pre.box.max.distanceTo(post.box.max));
  return {
    before: before.length, merged, batches, left: before.length - merged + batches,
    // Both must hold for the bake to be a no-op on appearance.
    trisBefore: pre.tris, trisAfter: post.tris, trisMatch: pre.tris === post.tris,
    geometriesFreed: freed, geometriesKeptShared: candidates - freed,
    boxShiftM: dBox < 0 ? null : +dBox.toFixed(4),
  };
}
