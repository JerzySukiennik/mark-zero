// The suit-up ring. Owned by task `world`, driven by suitup/.
//
// THE BEAT, in Jurek's words: you step onto the circle when YOU want to. The rings lift out
// of the floor and lean inward; the hole they leave opens, and arms come up out of it
// carrying the armour and put it on you.
//
// So the ring is not decoration with a trigger on it — it IS the machine. Everything here
// hangs off one number, `t`, which runs 0 (a flush disc you can walk over) to 1 (fully
// deployed, arms up, hole open). suitup/ drives it; nothing here decides when to open.
//
// Built out of primitives on purpose. This stage is a grey box and the ring is the one
// thing in it that has to READ — so it gets its shape from silhouette and motion, not from
// a model file that would have to be made before any of it could be tried.
import * as THREE from 'three';

export const RING = {
  centre: 1.6,          // the deck you stand on to trigger it = radius * 0.30, the innermost band's hole
  radius: 5.2,          // the outer edge you step over
  bands: 4,             // concentric rings, innermost first
  arms: 4,
  tablet: { x: 7.4, z: 3.6 },
  liftHeight: 2.35,     // how far the outermost band rises
  openTime: 2.6,        // seconds, floor to fully deployed
};

const _v = new THREE.Vector3();

export function buildRing(ctx, M, handoff) {
  const root = new THREE.Group();
  root.name = 'suitup_ring';

  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa3ab, metalness: 0.86, roughness: 0.32, envMapIntensity: 1.0,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1b1f24, metalness: 0.5, roughness: 0.6, envMapIntensity: 0.5,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0x7fd4f5, toneMapped: false, fog: false });

  /* The shaft. Always there, always dark, and only ever seen once the bands have lifted
   * off it — which is what makes the opening read as something underneath rather than
   * something appearing. */
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(RING.radius * 0.82, RING.radius * 0.82, 7, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.95, side: THREE.BackSide })
  );
  shaft.position.y = -3.5;
  root.add(shaft);
  const shaftFloor = new THREE.Mesh(new THREE.CircleGeometry(RING.radius * 0.82, 40), dark);
  shaftFloor.rotation.x = -Math.PI / 2;
  shaftFloor.position.y = -7;
  root.add(shaftFloor);

  /* The bands. Flush with the plate at rest — you can walk across and feel nothing —
   * and each one rises further and leans further in than the one inside it, so opening
   * reads as a single flower rather than four separate lids. */
  const bands = [];
  for (let i = 0; i < RING.bands; i++) {
    const f = i / (RING.bands - 1);                 // 0 innermost, 1 outermost
    const inner = RING.radius * (0.30 + f * 0.52);
    const outer = inner + RING.radius * 0.17;
    const g = new THREE.Group();
    /* A real annulus with thickness, not an open-ended cylinder.
     * The first cut used CylinderGeometry(..., openEnded) for each band, which is a wall
     * 16 cm tall and nothing else — from above there is no surface at all, so the rings
     * rendered as four glowing hoops floating on the floor and the lift was invisible. An
     * extruded ring is a plate: it catches the light, it casts a shadow, and you can see
     * it tilt. */
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 48 });
    bg.rotateX(-Math.PI / 2);
    const band = new THREE.Mesh(bg, steel);
    band.castShadow = true; band.receiveShadow = true;
    g.add(band);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(outer, 0.05, 6, 48), glow);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.20;
    g.add(lip);
    g.position.y = 0.02 + i * 0.001;                // flush, stacked by a hair
    root.add(g);
    bands.push({ g, band, lip, f, inner, outer });
  }

  /* A flat deck across the middle at rest, so the circle is a floor and not a pit with a
   * grille over it. It drops away as the bands rise — the hole the arms come out of. */
  const deck = new THREE.Mesh(new THREE.CircleGeometry(RING.radius * 0.34, 32), steel);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  root.add(deck);

  /* The arms. Two segments and a claw, folded flat inside the shaft at rest. They rise
   * with `t`, straighten, and reach toward the middle where the player is standing. */
  const arms = [];
  for (let i = 0; i < RING.arms; i++) {
    const a = (i / RING.arms) * Math.PI * 2 + 0.4;
    const base = new THREE.Group();
    base.position.set(Math.cos(a) * RING.radius * 0.62, -3.0, Math.sin(a) * RING.radius * 0.62);
    base.rotation.y = -a + Math.PI / 2;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 12), dark);
    post.position.y = 0.55; base.add(post);

    const upper = new THREE.Group();
    upper.position.y = 1.05;
    const upperM = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.3), steel);
    upperM.position.y = 0.85; upperM.castShadow = true; upper.add(upperM);
    base.add(upper);

    const fore = new THREE.Group();
    fore.position.y = 1.7;
    const foreM = new THREE.Mesh(new THREE.BoxGeometry(0.17, 1.35, 0.24), steel);
    foreM.position.y = 0.67; foreM.castShadow = true; fore.add(foreM);
    upper.add(fore);

    const claw = new THREE.Group();
    claw.position.y = 1.35;
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.1), steel);
      f.position.set(s * 0.11, 0.18, 0); f.rotation.z = -s * 0.25; claw.add(f);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), glow);
    tip.position.y = 0.30; claw.add(tip);
    fore.add(claw);

    root.add(base);
    arms.push({ base, upper, fore, claw, phase: i / RING.arms });
  }

  const state = { t: 0, target: 0, occupied: false };

  const api = {
    root, bands, arms, state,
    /** 0 = flush floor, 1 = fully deployed. suitup/ owns this. */
    set(v) { state.target = Math.max(0, Math.min(1, v)); },
    get open() { return state.t; },
    /** Is the player standing on the disc? world/ answers, onfoot/ asks. */
    /* THE CENTRE, not the whole disc.
     *
     * This used to be the full 5.2 m radius, so brushing the outer band anywhere on the way
     * past fired the ritual — Jurek's report was that it suits him up "wherever I stand on
     * the ring". The platform you are meant to stand on is the deck in the middle; the bands
     * around it are the machine. So the trigger is the deck, and the outer ring is scenery
     * you can walk over. */
    contains(x, z) {
      return Math.hypot(x - root.position.x, z - root.position.z) < RING.centre;
    },
    // A wider skirt, for "someone is approaching" — the machine waking up, not firing.
    near(x, z) {
      return Math.hypot(x - root.position.x, z - root.position.z) < RING.radius * 1.6;
    },

    update(dt) {
      // Asymmetric, and deliberately: opening is machinery doing a job and takes its time;
      // closing is the same machinery getting out of the way and does not need to be
      // watched. Same reasoning as the Mk L's wings in flight/thrustfx.js.
      const rate = state.target > state.t ? RING.openTime : RING.openTime * 0.55;
      const k = 1 - Math.exp(-dt / (rate * 0.32));
      state.t += (state.target - state.t) * k;
      const t = state.t;

      // Bands: the outermost goes highest and leans furthest, on a slight stagger so the
      // four of them read as one opening movement rather than four simultaneous lids.
      for (const b of bands) {
        const lag = Math.max(0, Math.min(1, (t - b.f * 0.18) / (1 - b.f * 0.18)));
        const e = lag * lag * (3 - 2 * lag);                   // smoothstep
        b.g.position.y = 0.02 + e * RING.liftHeight * (0.35 + b.f * 0.65);
        b.g.rotation.x = e * 0.30 * (0.4 + b.f);               // lean inward
        b.g.rotation.z = e * 0.10 * (b.f - 0.5);
        b.lip.material = glow;
      }
      // The deck drops out from under the middle to become the hole.
      deck.position.y = 0.03 - t * 3.2;
      deck.visible = t < 0.98;

      // Arms: rise out of the shaft, straighten, and reach in toward the middle.
      for (let i = 0; i < arms.length; i++) {
        const a = arms[i];
        const lag = Math.max(0, Math.min(1, (t - 0.28 - a.phase * 0.10) / 0.62));
        const e = lag * lag * (3 - 2 * lag);
        a.base.position.y = -3.0 + e * 3.05;
        a.upper.rotation.x = -0.15 - e * 0.85;
        a.fore.rotation.x = 0.25 + e * 1.15;
        a.claw.rotation.x = -e * 0.55;
        a.base.visible = e > 0.001;
      }
    },
  };

  // The disc is walkable at rest. One collider for the deck; the bands are thin and the
  // player is never on them while they move.
  handoff.solid(deck, { kind: 'ground' });
  return api;
}
