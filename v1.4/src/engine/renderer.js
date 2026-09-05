// Renderer, scene, camera and post chain. Owned by engine-core.
//
// Two rules the reference library forces on us and that everything else depends on:
//   - ACES tone mapping + sRGB output, so an emissive that overdrives clips to a WHITE
//     core instead of a saturated blob. Reference: every repulsor shot in flight/.
//   - Bloom, because "blows out to a white core and blooms onto adjacent panels" is in
//     the bar. Bloom threshold sits above the brightest lit metal so only emissives bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createRenderer(host) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true, powerPreference: 'high-performance', stencil: false,
    preserveDrawingBuffer: true, // MZ.screenshot() needs this
    // The faceplate has to sit almost on the lens (near 0.05) while the sky reaches 60 km,
    // which is a far/near ratio of 1.2 million — far past what a normal depth buffer can
    // resolve. Measured before this line existed: changing near from 0.05 to 1.0 altered
    // 1.0% of pixels over the town and 0.44% at altitude, meaning visibility out there was
    // being decided by the last bits of depth precision. That is z-fighting waiting to
    // flicker as soon as the camera moves. A logarithmic depth buffer spends precision
    // evenly across the range and costs a few percent of fill rate.
    logarithmicDepthBuffer: true,
  });
  // 1.5, not 2. At devicePixelRatio 2 a 1600x900 window renders 5.8 million pixels, and
  // this scene is fill-bound: on a laptop RTX 3050 that alone is the difference between a
  // playable frame and a slideshow. 1.5 keeps text and HUD hairlines crisp while cutting
  // pixel work by 44%.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // 60 deg vertical is the helmet-cam feel; near 0.05 so the faceplate can sit on the lens.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60000);
  camera.position.set(0, 2, 8);
  scene.add(camera);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  scene.userData.bloom = bloom;

  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
  }
  return { renderer, scene, camera, composer, resize };
}
