// Things to shoot at, and things to fly through. Owned by task `world`.
//
// A grey box with nothing in the sky is a flight test, not a game: you take off, you climb,
// and there is nothing up there to aim the suit AT. Jurek asked for targets in the air over
// the map, so this puts two kinds up.
//
//   DRONES  small floating blocks that hold station and glow. They are solid, so a repulsor
//           bolt hits them and the destruction system breaks them like anything else, and
//           they bob so a hit is a moving-target shot rather than a stationary one.
//   GATES   big rings hung at flight altitude. Nothing to hit — they are there so that
//           "fly well" has a shape. Flying one cleanly is the reason to use the brake and
//           the fall-arrest that the flight model now has.
//
// Seeded from the same idea as the blocks in world.js: the same stage every run, so a
// measurement or a screenshot means something twice.
import * as THREE from 'three';

export const TARGETS = { drones: 22, gates: 6 };

export function buildTargets(ctx, handoff, opts = {}) {
  const GROUND = opts.ground ?? 0;
  const SPAN = opts.span ?? 480;
  const root = new THREE.Group();
  root.name = 'air_targets';

  let seed = 0xA17;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  /* Light enough to be a silhouette against sky AND against the dark plate. The first cut
   * was near-black metal, which from any distance was a dot you could only find if you
   * already knew it was there — a target you cannot see is not a target. */
  const shell = new THREE.MeshStandardMaterial({
    color: 0x8d99a5, metalness: 0.55, roughness: 0.4, envMapIntensity: 0.7,
    emissive: new THREE.Color(0x241206), emissiveIntensity: 1,
  });
  // The eye needs to find these from a kilometre out, so the marker is emissive and never
  // tone mapped — the same rule every light source in this game follows (combat/vfx.js).
  const lamp = new THREE.MeshBasicMaterial({ color: 0xff8a24, toneMapped: false, fog: false });
  const gateMat = new THREE.MeshBasicMaterial({
    color: 0x59d8ff, toneMapped: false, fog: false, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide,
  });

  const bodyGeo = new THREE.OctahedronGeometry(2.1, 0);
  // A ring around the waist rather than a ball inside the hull — the first version put
  // the lamp at the centre of the octahedron, where the hull hid it completely.
  const lampGeo = new THREE.TorusGeometry(2.35, 0.22, 6, 20);

  const drones = [];
  for (let i = 0; i < TARGETS.drones; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 70 + rnd() * SPAN * 0.5;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, GROUND + 30 + rnd() * 170, Math.sin(a) * r);
    const body = new THREE.Mesh(bodyGeo, shell);
    body.castShadow = true;
    g.add(body);
    const eye = new THREE.Mesh(lampGeo, lamp);
    eye.rotation.x = Math.PI / 2;
    g.add(eye);
    root.add(g);
    // Solid, so bolts hit it and the fracture system owns what happens next.
    handoff.solid(body, { kind: 'wall' });
    drones.push({ g, body, y0: g.position.y, phase: rnd() * Math.PI * 2, rate: 0.5 + rnd() * 0.7 });
  }

  const gates = [];
  const gateGeo = new THREE.TorusGeometry(11, 0.55, 8, 40);
  for (let i = 0; i < TARGETS.gates; i++) {
    const a = (i / TARGETS.gates) * Math.PI * 2 + 0.3;
    const r = 120 + rnd() * 160;
    const m = new THREE.Mesh(gateGeo, gateMat);
    m.position.set(Math.cos(a) * r, GROUND + 45 + rnd() * 90, Math.sin(a) * r);
    // Faced along the tangent, so the natural way through one is a turn, not a straight line.
    m.lookAt(m.position.clone().add(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))));
    root.add(m);
    gates.push(m);
    // Deliberately NOT solid. A gate you can crash into is a gate nobody flies through.
  }

  /* SHOOTING THEM DOWN.
   *
   * They were solid, so bolts collided with them and the fracture system ran — but a drone
   * is a small floating object, not a wall, and "a crack appeared in it" is not what anyone
   * expects from hitting one. Jurek asked for them to be knock-downable, so a hit kills the
   * drone: it goes dark, drops out of the sky under gravity, and is gone.
   *
   * Driven off `repulsor:hit`, which the projectile system already emits with a world point,
   * rather than off a collider identity — the bolt reports where it landed and this decides
   * whether that was close enough to a drone to count. One distance test per hit against at
   * most a couple of dozen drones costs nothing and needs no new physics. */
  const falling = [];
  ctx.bus.on('repulsor:hit', ({ point, force }) => {
    if (!point) return;
    let best = null, bestD = 4.2;                 // a drone is ~2 m across; be generous
    for (const d of drones) {
      if (d.dead || !d.g.parent) continue;
      const dd = d.g.position.distanceTo(point);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    if (!best) return;
    best.hp = (best.hp === undefined ? 2 : best.hp) - Math.max(1, force || 1);
    if (best.hp > 0) return;
    best.dead = true;
    // Dark, tumbling, and on its way down.
    best.g.traverse(o => { if (o.material === lamp) o.visible = false; });
    best.vel = new THREE.Vector3((Math.random() - 0.5) * 6, 1.5, (Math.random() - 0.5) * 6);
    best.spin = new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    falling.push(best);
    ctx.bus.emit('target:down', { point: best.g.position.clone() });
  });

  return {
    root, drones, gates,
    get alive() { return drones.filter(d => !d.dead).length; },
    /** Bob and spin. Cheap: two trig calls per drone, nothing allocated. */
    update(dt, t) {
      for (const d of drones) {
        if (!d.g.parent || d.dead) continue;
        d.g.position.y = d.y0 + Math.sin(t * d.rate + d.phase) * 3.5;
        d.g.rotation.y += dt * 0.6;
      }
      // The ones that were shot: gravity, tumble, and gone when they reach the plate.
      for (let i = falling.length - 1; i >= 0; i--) {
        const d = falling[i];
        d.vel.y -= 22 * dt;
        d.g.position.addScaledVector(d.vel, dt);
        d.g.rotation.x += d.spin.x * dt;
        d.g.rotation.y += d.spin.y * dt;
        d.g.rotation.z += d.spin.z * dt;
        if (d.g.position.y <= GROUND + 1) {
          if (d.g.parent) d.g.parent.remove(d.g);
          falling.splice(i, 1);
        }
      }
      for (let i = 0; i < gates.length; i++) gates[i].rotation.z += dt * 0.12;
    },
  };
}
