// world/ocean.js — the Pacific. Owned by task `world`.
//
// Requirements this had to survive: being flown over at 290 m/s and being looked down on
// from 400 m. A flat blue plane fails both — at speed it gives no motion cue, and from
// altitude it has no specular band, which is the single thing that makes film ocean read
// as water. So:
//
//   * geometry is a camera-locked radial disc, 20 km across, with exponentially growing
//     ring spacing. Detail sits under the player at all times and never tessellates the
//     horizon. That IS the level-of-detail scheme; there is nothing to swap.
//   * four Gerstner waves displace it in world space with analytic normals, so the
//     surface animates and the normal is exact rather than finite-differenced.
//   * shading is sky-fresnel + a Blinn specular lobe with a deliberately wide exponent,
//     which is what produces the broad glitter band under the sun instead of one dot.
//   * a shore term whitens the water where the seabed comes up, so the cliff toe has surf.

import * as THREE from 'three';

const vert = /* glsl */`
uniform float uTime;
uniform vec3  uCam;
varying vec3  vWorld;
varying vec3  vNormal2;
varying float vDist;
// <common> before <logdepthbuf_pars_vertex>, and it is not optional: the log-depth
// vertex chunk calls isPerspectiveMatrix(), which is declared in <common> and nowhere
// else. Without it the shader fails to compile, three.js drops the mesh, and the ocean
// silently disappears — leaving the sky dome's own ground colour showing under the
// cliff, which looks exactly like a beach and took two renders to identify.
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

// Gerstner: dir.xy, AMPLITUDE in metres, wavelength in metres.
//
// The wave used to be parameterised by steepness, which is a trap: a = steepness / k,
// so the same steepness on a 62 m swell gives a 5.4 m amplitude and an 11 m wave. Four
// of those made the Pacific look like pack ice. Amplitude is the number a human can
// reason about, so that is what goes in and steepness is derived.
vec3 gerstner(vec2 p, vec4 w, inout vec3 tang, inout vec3 bitan, float t) {
  float k = 6.28318 / w.w;
  float c = sqrt(9.81 / k);
  vec2  d = normalize(w.xy);
  float f = k * (dot(d, p) - c * t);
  float a = w.z;
  float q = a * k;                       // steepness
  tang  += vec3(-d.x * d.x * (q * sin(f)), d.x * (q * cos(f)), -d.x * d.y * (q * sin(f)));
  bitan += vec3(-d.x * d.y * (q * sin(f)), d.y * (q * cos(f)), -d.y * d.y * (q * sin(f)));
  return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
}

void main() {
  // position.xz is a static disc; recentre it on the camera so detail follows the player.
  vec3 p = position;
  p.x += uCam.x; p.z += uCam.z;

  float far = smoothstep(600.0, 3000.0, length(position.xz));
  float amp = 1.0 - far * 0.55;          // calm the far field so the horizon stays clean

  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bitan = vec3(0.0, 0.0, 1.0);
  vec3 disp = vec3(0.0);
  disp += gerstner(p.xz, vec4( 1.0,  0.35, 0.85, 62.0), tang, bitan, uTime);
  disp += gerstner(p.xz, vec4( 0.72,-0.9,  0.40, 31.0), tang, bitan, uTime);
  disp += gerstner(p.xz, vec4(-0.4,  1.0,  0.20, 17.0), tang, bitan, uTime);
  disp += gerstner(p.xz, vec4( 1.0,  0.15, 0.09,  7.3), tang, bitan, uTime);
  p += disp * amp;

  vWorld = p;
  vNormal2 = normalize(cross(bitan, tang));
  vDist = length(p - uCam);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  /* ── the ocean MUST write logarithmic depth ──
   * renderer.js turns on logarithmicDepthBuffer (it has to: a 0.2 m near plane and a
   * stratosphere far plane have no usable precision otherwise). three.js injects the
   * log-depth code into its own materials automatically, but a ShaderMaterial only gets
   * it if the shader asks — and a shader that does not ask writes ordinary NDC depth
   * into a buffer where every other object has written log depth. The two are not
   * comparable, so the comparison is nonsense.
   *
   * What that looked like: from the cliff-top hero angle the Pacific simply vanished and
   * the SEABED was drawn over the top of it — a sheet of wet sand where the water should
   * be — even though a raycast put the ocean surface 10 m in front of the terrain it was
   * losing to. Ten metres of separation at 430 m is enormous; it was never a precision
   * problem, it was two different encodings. Four include lines fix it. */
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const frag = /* glsl */`
uniform vec3  uSun;
uniform vec3  uSunColor;
uniform vec3  uSkyColor;
uniform vec3  uHorizon;
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform float uTime;
uniform vec3  uCam;
varying vec3  vWorld;
varying vec3  vNormal2;
varying float vDist;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

// cheap hash noise for the sparkle breakup — without it the specular band is a smooth
// airbrushed streak, which is the tell of fake water
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y);
}

// The coastline, duplicated from cliff.js edgeZ(). Three sines is cheaper than a texture
// fetch and lets the surf line follow the real cliff toe instead of a straight strip.
float coastZ(float x) {
  return -88.0 + 46.0 * sin(x * 0.00062) + 22.0 * sin(x * 0.0019 + 1.7)
         + 9.0 * sin(x * 0.0064 + 0.4);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormal2);
  // Ripple detail: keeps the surface alive close up without more geometry. Kept small —
  // at 0.30 it swamped the wave normal and every pixel caught a whitecap.
  float rip = n2(vWorld.xz * 0.9 + uTime * 0.6) + n2(vWorld.xz * 2.7 - uTime * 0.9) * 0.5;
  float fade = 1.0 - smoothstep(60.0, 900.0, vDist);
  // Whitecaps and sparkle need their OWN, much shorter fade. Both are sub-pixel features
  // past a few hundred metres, and a sub-pixel feature that survives into the render does
  // not read as foam — it reads as aliasing. From the cliff-top hero angle the Pacific
  // came back covered in 20-pixel white blobs, which is exactly a whitecap test being
  // evaluated at one sample per 30 m of water. Kill them off by 420 m and the same shader
  // gives deep slate water with a glitter path, which is the reference plate.
  float fadeHi = 1.0 - smoothstep(80.0, 420.0, vDist);
  // The ripple normal is what the whitecap test reads, so its amplitude sets how much
  // of the sea foams. At 0.10 every third pixel tipped past the whitecap threshold and
  // the Pacific came back looking like pack ice from 400 m — measured against
  // reference/flight/mk3_flight_low_water.jpg, which is deep blue with a glitter path
  // and foam only on the crests. Half the perturbation, and a whitecap test that reads
  // the SWELL normal instead of the rippled one, is what fixed it.
  vec3 Nswell = N;
  N = normalize(N + vec3((rip - 0.75) * 0.05, 0.0, (n2(vWorld.zx * 1.3 - uTime * 0.5) - 0.5) * 0.05) * fade);

  vec3 V = normalize(uCam - vWorld);
  vec3 L = normalize(uSun);

  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  fres = mix(0.02, 0.70, fres);   // never a perfect mirror: water keeps its own colour

  // body colour: deep offshore, greener close in
  vec3 body = mix(uDeep, uShallow, smoothstep(300.0, 20.0, vDist) * 0.22);

  // sky reflection, tinted toward the horizon at grazing angles
  // Sky reflection. The horizon tint has to be held back: at an exponent of 1.5 every
  // grazing pixel went full pale grey, and the ocean seen from the terrace — which is
  // ALL grazing — turned into a sheet of concrete.
  vec3 sky = mix(uSkyColor, uHorizon, pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.72);

  // the specular band. Wide lobe = a long glitter path, not a point.
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 90.0) * 2.6
             + pow(max(dot(N, H), 0.0), 12.0) * 0.16;
  float sparkle = smoothstep(0.55, 1.0, n2(vWorld.xz * 3.4 + uTime * 1.1)) * fadeHi;
  spec *= 0.40 + 1.0 * sparkle;

  vec3 col = mix(body, sky, fres) + uSunColor * spec;

  // Whitecaps, only on the genuinely steep faces of the SWELL — the big waves, not the
  // surface ripple. Kept scarce on purpose: film ocean is mostly dark water with a few
  // breaking crests, and foam is the cheapest possible way to lose that.
  float steep = smoothstep(0.9962, 0.9880, Nswell.y);
  col = mix(col, vec3(0.84, 0.89, 0.93), steep * 0.30 * fadeHi);

  // Surf. The seabed rises to the cliff toe, so the last ~90 m of water breaks: a band
  // of foam that follows the coastline and pulses with the swell. Without it the ocean
  // meets the rock with a hard clean line and the whole shore reads as a cut-out.
  float dShore = vWorld.z - coastZ(vWorld.x);
  // 38 m, not 80. From the cliff-top hero angle a 160 m wide band of foam read as a
  // white beach running the whole length of the coast; the reference plate has a thin
  // bright line at the rock and deep water immediately outside it.
  float surf = smoothstep(22.0, 3.0, abs(dShore)) * step(dShore, 12.0);
  float pulse = 0.55 + 0.45 * sin(vWorld.x * 0.06 + uTime * 1.3)
                            * sin(vWorld.x * 0.017 - uTime * 0.7);
  float foam = surf * (0.35 + 0.65 * pulse);
  col = mix(col, vec3(0.90, 0.94, 0.96), clamp(foam, 0.0, 1.0) * 0.7);
  // and a green shallow band just outside the foam
  col = mix(col, uShallow, smoothstep(120.0, 35.0, abs(dShore)) * 0.30 * (1.0 - surf));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function buildOcean(ctx, sun) {
  // Radial disc: 128 rings x 256 spokes, ring radius growing as a power so the near
  // field is ~1 m and the rim is 20 km away.
  const RINGS = 132, SPOKES = 256, R = 20000;
  const count = (RINGS + 1) * SPOKES;
  const pos = new Float32Array(count * 3);
  for (let r = 0, k = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    const rad = Math.pow(t, 3.1) * R;
    for (let s = 0; s < SPOKES; s++, k++) {
      const a = (s / SPOKES) * Math.PI * 2;
      pos[k * 3] = Math.cos(a) * rad;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = Math.sin(a) * rad;
    }
  }
  const idx = [];
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SPOKES; s++) {
      const s2 = (s + 1) % SPOKES;
      const a = r * SPOKES + s, b = r * SPOKES + s2;
      const c = (r + 1) * SPOKES + s, d = (r + 1) * SPOKES + s2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);  // never frustum-cull

  const sunDir = sun ? sun.position.clone().normalize() : new THREE.Vector3(-0.5, 0.7, 0.4);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime:      { value: 0 },
      uCam:       { value: new THREE.Vector3() },
      uSun:       { value: sunDir },
      uSunColor:  { value: new THREE.Color(0xfff0d6) },
      uSkyColor:  { value: new THREE.Color(0x7fa8d8) },
      uHorizon:   { value: new THREE.Color(0xc2d2e0) },
      // Darker and less saturated than the first pass (0x0a2c47 / 0x1a7086). Film
      // Pacific from 400 m is a slate that sits BELOW the sky in value; a cyan ocean
      // brighter than its own sky is the single loudest tell of a game render.
      uDeep:      { value: new THREE.Color(0x06202f) },
      uShallow:   { value: new THREE.Color(0x1a5468) },
    },
  ]);
  uniforms.uSun.value = sunDir;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    fog: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ocean';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;

  return {
    mesh,
    /** Analytic wave height, so a landed/floating object can sit on the surface. */
    heightAt(x, z, t) {
      // Must stay in step with the four gerstner() calls in the vertex shader above:
      // [dir.x, dir.z, amplitude m, wavelength m].
      const waves = [
        [1.0, 0.35, 0.85, 62.0], [0.72, -0.9, 0.40, 31.0],
        [-0.4, 1.0, 0.20, 17.0], [1.0, 0.15, 0.09, 7.3],
      ];
      let y = 0;
      for (const w of waves) {
        const k = 6.28318 / w[3];
        const c = Math.sqrt(9.81 / k);
        const L = Math.hypot(w[0], w[1]);
        const dx = w[0] / L, dz = w[1] / L;
        const f = k * (dx * x + dz * z - c * t);
        y += w[2] * Math.sin(f);
      }
      return y;
    },
    update(dt, camera, time) {
      uniforms.uTime.value = time;
      uniforms.uCam.value.copy(camera.position);
      // Snap the disc under the camera in XZ. y stays at sea level.
      mesh.position.set(0, 0, 0);
    },
  };
}
