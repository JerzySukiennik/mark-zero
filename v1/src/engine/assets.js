// Asset cache. Owned by engine-core. Every module loads through this so a model or
// texture requested twice is fetched once.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Assets {
  constructor() {
    this.gltf = new GLTFLoader();
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
