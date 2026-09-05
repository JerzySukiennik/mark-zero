// world/sky.js — the dome and the haze. Owned by task `world`.
//
// The reference frames are all hazy: in malibu_cliff_hero the mountains 3 km back are
// nearly the colour of the sky, and in mk3_dive_clouds the sky washes the armour chalky.
// So the sky here is not a backdrop, it is the source of the aerial perspective that
// makes the world read as large — a gradient dome, a real sun disc with a glow, a warm
// horizon band, and a distance fog whose colour is the horizon colour.

import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  // Sit the dome on the far plane: w = z so depth is always 1 and it never clips.
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */`
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGround;
uniform vec3  uSun;
uniform vec3  uSunColor;
uniform float uDim;      // 1 outside, 0 in the workshop
varying vec3  vDir;


float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.07; a*=0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;

  // vertical gradient, with a thick warm haze band pinned to the horizon
  /* pow(t, 0.42) reaches nine tenths of the zenith colour by 20 degrees of elevation,
   * which sounds like it would give a deep blue sky and does the opposite: it spends the
   * whole gradient in the first sliver above the horizon and then everything overhead is
   * one flat mid-blue. Real sky — and randys_donuts_a, which is a low wide lens pointing
   * up into it — keeps getting deeper all the way to the top. 0.62 puts the transition
   * where the eye expects it and leaves the upper half of the frame with somewhere to
   * go, without touching the horizon haze that the distant terrain is graded against. */
  float t = clamp(up, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.62));
  col = mix(col, uGround, smoothstep(0.0, -0.09, up));

  // the sun: a hard disc inside a wide glow. Overdriven so bloom picks it up.
  float cosA = dot(d, normalize(uSun));
  float disc = smoothstep(0.99965, 0.99985, cosA);
  float glow = pow(max(cosA, 0.0), 620.0) * 0.9 + pow(max(cosA, 0.0), 16.0) * 0.22;
  col += uSunColor * (glow + disc * 22.0);

  // high thin cloud, only above the haze band. Directional stretch reads as cirrus.
  if (up > 0.02) {
    vec2 uv = d.xz / max(up + 0.16, 0.02);
    float c = fbm(uv * 0.55 + vec2(9.0, 2.0));
    float c2 = fbm(uv * vec2(0.22, 1.5) + vec2(0.0, 5.0));
    float cloud = smoothstep(0.52, 0.86, c * 0.65 + c2 * 0.45);
    cloud *= smoothstep(0.02, 0.28, up) * (1.0 - smoothstep(0.75, 1.0, up) * 0.4);
    vec3 cc = mix(vec3(0.92,0.93,0.95), uSunColor * 1.05, pow(max(cosA,0.0), 4.0) * 0.6);
    col = mix(col, cc, cloud * 0.55);
  }

  gl_FragColor = vec4(col * uDim, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildSky(scene, sun) {
  const sunDir = sun ? sun.position.clone().normalize() : new THREE.Vector3(-0.6, 0.75, 0.4);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith:   { value: new THREE.Color(0x2f65b4) },
      uHorizon:  { value: new THREE.Color(0xd8dfe0) },
      uGround:   { value: new THREE.Color(0xa89880) },
      uSun:      { value: sunDir },
      uSunColor: { value: new THREE.Color(0xfff1d8) },
      uDim:      { value: 1 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  scene.add(mesh);

  // Aerial perspective. The far value is tuned so the 9 km mountain band sits at ~80 %
  // haze — the same read as the reference plate — while the town at 2 km stays legible.
  const fogColor = new THREE.Color(0xc3d0d8);
  scene.fog = new THREE.Fog(fogColor, 700, 16000);
  scene.background = null;   // the dome is the background

  return {
    mesh,
    uniforms: mat.uniforms,
    /** Keep the dome centred on the camera so it never gets left behind at 290 m/s. */
    update(camera) { mesh.position.copy(camera.position); },
    /**
     * Dim the dome as the player descends into the workshop. env.js blends its lighting
     * continuously (k = 0 outside … 1 in the basement) rather than cutting, so a boolean
     * visible flag would pop halfway down the stairs. The dome is drawn with
     * depthWrite:false behind everything, so anywhere the basement shell covers it this
     * costs nothing — but the stair well does not cover it, and a bright sky glowing
     * through a hole in a concrete ceiling is the tell that killed the first pass.
     */
    setMix(k) {
      const d = Math.max(0, 1 - k * 1.35);
      mesh.material.uniforms.uDim.value = d;
      mesh.visible = d > 0.004;
    },
    setMood(name) { this.setMix(name === 'workshop' ? 1 : 0); },
  };
}
