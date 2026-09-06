// Asset cache. Owned by engine-core. Every module loads through this so a model or
// texture requested twice is fetched once.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export class Assets {
  constructor() {
    this.gltf = new GLTFLoader();
    /* EXT_meshopt_compression. The five armours were 36 MB of raw float32 geometry and the
     * first suit-up waits on one of them: 8 MB for the Mk III alone, which is 117 024
     * triangles across 227 264 vertices (the mesh is indexed, but hard edges split most of
     * them, so welding buys nothing — measured, 8.36 MB in and 8.41 MB out).
     *
     * Meshopt is the compression the loader already understands; it only ever lacked the
     * decoder, which is 25 KB and now vendored alongside three itself. Nothing else in the
     * pipeline changes: the loader decodes on the worker and hands back the same buffers. */
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.tex = new THREE.TextureLoader();
    this.cache = new Map();
  }
  _get(key, make) {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key);
  }
  // Returns the parsed glTF. Resolves to null (and warns) if the file is missing,
  // so a half-built game still boots.
  loadModel(url) {
    return this._get('m:' + url, () => this.gltf.loadAsync(url).catch(e => {
      console.warn('[assets] missing model ' + url, e);
      return null;
    }));
  }
  loadTexture(url, srgb = true) {
    return this._get('t:' + url, () => {
      const t = this.tex.load(url);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }
}
