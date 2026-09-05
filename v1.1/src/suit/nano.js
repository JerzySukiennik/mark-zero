// Nanotech deploy for the Mark L. Owned by task `suitup`.
//
// The Mk L does NOT snap on as plates. It pours out of the chest reactor as a
// directional wave: tiny dark shapes at the leading edge that resolve into finished
// smooth surface behind it, cyan light leaking from the seams that have not closed,
// and skin and clothing still visible ahead of the wave. That is one shader sweep over
// the whole armour along the flow coordinate the rig ships, plus a particle band
// riding the leading edge — not 37 plates with a fade.
//
// src/suit/nano.glsl holds the shader; this file wires it into every plate's
// MeshStandardMaterial so the armour keeps its PBR shading and environment map and
// only gains a moving boundary.

import * as THREE from 'three';
import { meshesByPivot } from './rig.js';

let CHUNKS = null;

export async function loadNanoShader() {
  if (CHUNKS) return CHUNKS;
  const url = new URL('./nano.glsl', import.meta.url);
  try {
    const src = await fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    const parts = {};
    let name = null, buf = [];
    for (const line of src.split('\n')) {
      const m = line.match(/^\s*\/\/\s*---8<---\s*(\w+)/);
      if (m) {
        if (name) parts[name] = buf.join('\n');
        name = m[1]; buf = [];
      } else if (name) buf.push(line);
    }
    if (name) parts[name] = buf.join('\n');
    CHUNKS = parts;
  } catch (e) {
    console.warn('[nano] could not load nano.glsl, falling back to plate reveal', e);
    CHUNKS = null;
  }
  return CHUNKS;
}

const _v = new THREE.Vector3();

export class Nano {
  constructor(rig, chunks) {
    this.rig = rig;
    this.chunks = chunks;
    this.available = !!chunks;
    this.body = [];       // { mesh, uniforms }
    this.face = [];
    this.edge = 0;        // 0..1 normalised flow
    this.faceEdge = 1;
    this.time = 0;
    this.points = null;
    this._attached = false;
  }

  static async attach(rig) {
    const chunks = await loadNanoShader();
    const n = new Nano(rig, chunks);
    n.attach();
    return n;
  }

  // ---------------------------------------------------------------- attach
  attach() {
    if (this._attached) return;
    this._attached = true;
    const rig = this.rig;
    rig.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();

    // Per-vertex flow: the same formula rig.js uses per plate, so the coordinate is
    // continuous across the whole body and the wave does not stair-step at a seam.
    const samples = [];
    for (const [name, plate] of Object.entries(rig.plates)) {
      const info = rig.plateInfo[name];
      if (!info) continue;
      const pivotName = rig._pivotNameOf(plate.parent) || 'piv_chest';
      const pivot = rig.pivots[pivotName] || plate.parent;
      const pivotLocal = pivot.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
      const base = info.flow - pivotLocal.distanceTo(info.local) * 0.9;

      plate.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const geo = o.geometry.index || o.geometry.attributes.aFlow
          ? o.geometry.clone() : o.geometry.clone();
        o.geometry = geo;
        const pos = geo.attributes.position;
        const flow = new Float32Array(pos.count);
        const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
          const f = (base + pivotLocal.distanceTo(_v) * 0.9) / rig.flowMax;
          flow[i] = f;
          if ((i & 3) === 0 && samples.length < 26000) {
            samples.push(_v.x, _v.y, _v.z, f);
          }
        }
        geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));

        const isFace = name.startsWith('faceplate');
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const patched = mats.map(m => this._patch(m, isFace));
        o.material = Array.isArray(o.material) ? patched : patched[0];
      });
    }
    this._buildBand(samples);
    this.setEdge(1);
    this.setFaceEdge(1);
    this.setActive(false);
  }

  // ------------------------------------------------------- the boy under the armour
  //
  // Same flow coordinate, opposite test: his clothing exists only AHEAD of the wave. The
  // two boundaries are computed from one set of numbers (rig.pivotFlow / rig.flowMax), so
  // the sleeve disappears exactly where the plate appears instead of one lagging the
  // other by a few centimetres and showing a gap of nothing.
  attachBody(bodyRig) {
    if (!bodyRig) return;
    if (this.bodyParts && this.bodyRig === bodyRig) return;   // this Nano already owns him
    this.bodyRig = bodyRig;
    this.bodyParts = [];
    const rig = this.rig;
    const armorRootInv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
    bodyRig.root.updateMatrixWorld(true);

    for (const { mesh, pivot } of meshesByPivot(bodyRig)) {
      if (!mesh.geometry) continue;
      // The body is loaded once and re-patched by every Mk L equip; compute aFlow once.
      if (mesh.geometry.attributes.aFlow) {
        const mats0 = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const base = mats0.map(m => (m && m.userData.nanoSource) || m);
        const patched0 = base.map(m => this._patchBody(m));
        mesh.material = Array.isArray(mesh.material) ? patched0 : patched0[0];
        continue;
      }
      const geo = mesh.geometry.clone();
      mesh.geometry = geo;
      const pos = geo.attributes.position;
      const flow = new Float32Array(pos.count);
      // vertex -> armor-root space, so the boy is measured on the armour's ruler
      const toArmor = new THREE.Matrix4().multiplyMatrices(armorRootInv, mesh.matrixWorld);
      const sample = rig.flowSampler(pivot);
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(toArmor);
        flow[i] = sample(_v);
      }
      geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const patched = mats.map(m => this._patchBody(m));
      mesh.material = Array.isArray(mesh.material) ? patched : patched[0];
    }
    this.setEdge(this.edge);
    for (const b of this.bodyParts) b.uniforms.uOn.value = this.active ? 1 : 0;
  }

  _patchBody(mat) {
    if (!this.available || !mat || !mat.isMaterial) return mat;
    if (!this._bodyCache) this._bodyCache = new Map();
    const src = mat.userData.nanoSource || mat;
    if (this._bodyCache.has(src.uuid)) return this._bodyCache.get(src.uuid);
    const m = mat.clone();
    m.userData.nanoSource = src;
    this._bodyCache.set(src.uuid, m);
    const u = {
      uEdge: { value: this.edge },
      uBand: { value: 0.055 },
      uSeamW: { value: 0.085 },
      uSeam: { value: new THREE.Color(0x49e8ff) },
      uGrain: { value: 205.0 },
      uOn: { value: 0.0 },
    };
    const C = this.chunks;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + (C.common || '') + '\n' + (C.vertex_pars || ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (C.vertex_main || ''));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + (C.common || '') + '\n' + (C.fragment_pars || ''))
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + (C.body_fragment || ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (C.body_emissive || ''));
    };
    m.customProgramCacheKey = () => 'nanobody';
    m.needsUpdate = true;
    this.bodyParts.push({ uniforms: u });
    return m;
  }

  _patch(mat, isFace) {
    if (!this.available || !mat || !mat.isMaterial) return mat;
    // One patched material per SOURCE material, not per mesh. The Mk L has 64 meshes over
    // 5 materials; cloning per mesh gave the driver dozens of programs to compile on the
    // frame the wave starts — 34 s of compile, measured. Every clone was being driven with
    // identical uniform values anyway, so they can be the same material.
    if (!this._patchCache) this._patchCache = new Map();
    const key = mat.uuid + (isFace ? ':face' : '');
    if (this._patchCache.has(key)) return this._patchCache.get(key);
    const m = mat.clone();
    this._patchCache.set(key, m);
    m.userData.nano = true;
    const u = {
      uEdge: { value: 1.5 },
      uBand: { value: 0.055 },
      uSeamW: { value: 0.085 },
      uSeam: { value: new THREE.Color(0x49e8ff) },
      uGrain: { value: 205.0 },
      uOn: { value: 0.0 },
    };
    const C = this.chunks;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + (C.common || '') + '\n' + (C.vertex_pars || ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (C.vertex_main || ''));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + (C.common || '') + '\n' + (C.fragment_pars || ''))
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + (C.fragment_body || ''))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (C.fragment_emissive || ''));
    };
    m.customProgramCacheKey = () => 'nano';
    m.needsUpdate = true;
    (isFace ? this.face : this.body).push({ uniforms: u });
    return m;
  }

  // A band of tiny shapes riding the leading edge: the material that has left the
  // reactor but not yet landed. Dark grains with a cyan core, so they read against
  // both the skin ahead and the finished armour behind.
  _buildBand(samples) {
    const n = Math.min(9000, Math.floor(samples.length / 4));
    if (!n) return;
    const stride = Math.max(1, Math.floor(samples.length / 4 / n));
    const pos = new Float32Array(n * 3);
    const flow = new Float32Array(n);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * stride * 4;
      pos[i * 3] = samples[s]; pos[i * 3 + 1] = samples[s + 1]; pos[i * 3 + 2] = samples[s + 2];
      flow[i] = samples[s + 3];
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uEdge: { value: 1.5 },
        uBand: { value: 0.075 },
        uTime: { value: 0 },
        uSize: { value: 10.5 },
        uSeam: { value: new THREE.Color(0x63f0ff) },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,     // additive-ish effects vanish against bright ground otherwise
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aFlow;
        attribute float aSeed;
        uniform float uEdge, uBand, uTime, uSize;
        varying float vAmt;
        varying float vSeed;
        void main() {
          float d = abs(aFlow - uEdge);
          vAmt = 1.0 - clamp(d / uBand, 0.0, 1.0);
          vSeed = aSeed;
          vec3 p = position;
          // grains still in flight drift slightly outward and jitter
          float fly = clamp((aFlow - uEdge) / uBand, 0.0, 1.0);
          p += normalize(p - vec3(0.0, 1.30, 0.0) + 0.001) * fly * 0.055;
          p.x += sin(uTime * 12.0 + aSeed * 40.0) * 0.012 * fly;
          p.y += cos(uTime * 14.0 + aSeed * 31.0) * 0.012 * fly;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * vAmt * (1.0 + aSeed) / max(0.3, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSeam;
        varying float vAmt;
        varying float vSeed;
        void main() {
          if (vAmt <= 0.001) discard;
          vec2 c = gl_PointCoord - 0.5;
          float r = max(abs(c.x), abs(c.y)) * (1.4 + vSeed * 0.5);   // little square shards
          if (r > 0.5) discard;
          float core = smoothstep(0.5, 0.12, r);
          // Tiny DARK shapes with cyan light in them — matter, not sparks. A bright
          // white grain reads as a particle effect; the reference is nearly black dust
          // with the glow leaking between the pieces.
          vec3 col = mix(vec3(0.012, 0.013, 0.017), uSeam, pow(core, 3.0) * (0.20 + vSeed * 0.45));
          gl_FragColor = vec4(col, vAmt * (0.34 + 0.30 * core));
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'nano_band';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.rig.root.add(this.points);
  }

  // ---------------------------------------------------------------- driving
  setActive(on) {
    this.active = on;
    for (const b of this.body) b.uniforms.uOn.value = on ? 1 : 0;
    for (const b of (this.bodyParts || [])) b.uniforms.uOn.value = on ? 1 : 0;
    for (const f of this.face) f.uniforms.uOn.value = on ? 1 : 0;
    if (this.points) this.points.visible = on;
    if (!this.available) {
      // No shader: fall back to revealing plates by flow order, so the sequence still
      // reads as a wave from the chest outwards rather than as nothing happening.
      this._fallbackReveal();
    }
  }

  setEdge(e) {
    this.edge = e;
    for (const b of this.body) b.uniforms.uEdge.value = e;
    for (const b of (this.bodyParts || [])) b.uniforms.uEdge.value = e;
    if (this.points) this.points.material.uniforms.uEdge.value = e;
    if (!this.available) this._fallbackReveal();
  }

  setFaceEdge(e) {
    this.faceEdge = e;
    for (const f of this.face) f.uniforms.uEdge.value = e;
  }

  setBand(w) {
    for (const b of (this.bodyParts || [])) b.uniforms.uBand.value = w;
    for (const b of this.body) b.uniforms.uBand.value = w;
    for (const f of this.face) f.uniforms.uBand.value = w * 0.7;
    if (this.points) this.points.material.uniforms.uBand.value = w * 1.35;
  }

  _fallbackReveal() {
    for (const [name, plate] of Object.entries(this.rig.plates)) {
      const info = this.rig.plateInfo[name];
      if (!info) continue;
      const on = !this.active || info.flowN <= this.edge;
      plate.visible = on;
    }
  }

  update(dt) {
    this.time += dt;
    if (this.points) this.points.material.uniforms.uTime.value = this.time;
  }

  detach() {
    if (this.points) {
      this.points.parent && this.points.parent.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    this._attached = false;
  }
}
