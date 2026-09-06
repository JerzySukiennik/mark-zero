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
