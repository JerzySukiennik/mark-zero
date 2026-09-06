# MARK ZERO — architecture

An Iron Man flight simulator in the browser. Walk out of Tony Stark's Malibu house as a
13-year-old, take an armor, fly over the cliff, blow things apart.

## Run it

Double-click `play.command`, or `python3 serve.py`. Opens `http://localhost:8770/`.
ES modules and `.glb` need `http://`; `file://` will not work.

## Stack, and why

- **three.js r169, vendored** in `vendor/`. No build step, no npm, no CDN at runtime — the
  game opens from a folder and works on a plane. WebGL2 + PBR + PMREM is what gets us
  automotive lacquer and brushed aluminium in a browser; a hand-rolled renderer would not.
- **Rapier3D 0.14 (WASM), vendored** in `vendor/rapier/`. Real rigid-body physics for the
  destruction. Rust-compiled, deterministic, and an order of magnitude faster than
  cannon-es for the few hundred debris bodies a shattered glass wall produces. The compat
  build inlines its own WASM, so there is no second file to serve.
- **Blender 4.5 headless** for every model:
  `/Applications/Blender.app/Contents/MacOS/Blender --background --python build.py`
  Never the Blender MCP tools — they all drive one shared GUI instance and parallel agents
  fight over it. The generating `.py` ships next to the `.glb` so a model can be tweaked
  and regenerated without re-sculpting.
- **Plain ES modules, no framework.** The bottleneck here is art and feel, not application
  state. A framework would buy nothing and cost a build step.

## Shape of the code

`src/main.js` boots and does nothing else. Gameplay lives in **modules**, each a default
export with a fixed shape, listed once in `src/engine/registry.js`:

```js
export default {
  id: 'world',
  async init(ctx) { … },      // build things, hang your API on ctx
  update(dt, ctx) { … },      // fixed 1/120 s simulation tick
  render(ctx) { … },          // optional, once per drawn frame, before composer.render()
};
```

**No module imports another module.** They meet in two places only:

1. **`ctx`** — the shared context. Each module hangs its public API on its own slot
   (`ctx.world`, `ctx.flight`, `ctx.audio`, …). Read other slots defensively; a module
   later in the registry has not initialised yet at your `init()` time.
2. **`ctx.bus`** — `bus.on(name, fn)` / `bus.emit(name, payload)` for events.

This is what lets eight agents build in parallel without touching each other's files.
`registry.js` is frozen: every module path in it already exists as a stub, so the game
boots at every moment of the build.

### The context

| slot | owner | what it is |
|---|---|---|
| `ctx.state` | engine-core | shared mutable game state (mode, armor, telemetry) |
| `ctx.bus` | engine-core | event bus |
| `ctx.assets` | engine-core | cached model/texture loader |
| `ctx.env` | engine-core | `env.set('exterior'\|'workshop')`, sun, bounce light |
| `ctx.audio` | audio | `play/loop/setThrust/setSpeed/impact/music` |
| `ctx.physics` | destruction | Rapier world, `addStatic/addDynamic/raycast` |
| `ctx.world` | world | `surfaceHeight(x,z)`, `airDensity(alt)`, spawn points |
| `ctx.suit` | suitup | `equip(id)`, `setPose(name)`, `pivots`, `plates` |
| `ctx.suitup` | suitup | `play(id)` — the suit-up sequences |
| `ctx.flight` | flight | flight model, position, velocity |
| `ctx.combat` | combat | `fire()` — repulsor projectiles |
| `ctx.destruction` | destruction | `register(mesh, spec)`, `breakAt(point, force)` |
| `ctx.hud` | hud | JARVIS HUD |
| `ctx.player` | engine-core | the boy on foot |

### Events on the bus

Emitted by whoever causes them, listened to by whoever cares. Never call another module.

```
'ready'                      engine    everything is initialised
'env:set'    'exterior'|'workshop'      switch environment lighting
'armor:selected'   id                   onfoot -> suitup
'suitup:start'     id                   suitup -> audio, hud, cameraRig
'suitup:plate'     {name, impact}       suitup -> audio  (one servo/clank per plate)
'suitup:done'      id                   suitup -> flight, hud
'faceplate'        {open:bool}          suitup -> audio, hud
'repulsor:fire'    {hand, power}        combat -> audio
'repulsor:hit'     {point, normal, force, material}   combat -> destruction, audio
'break'            {point, force, material}           destruction -> audio
'impact'           {force}              flight -> audio
'debug:*'          see below
```

## The simulation loop

Rendering follows `requestAnimationFrame`, but **simulation is a fixed 1/120 s step**.
Same behaviour at 144 fps, at 30 fps, and in a headless browser where rAF is throttled to
nothing. Never scale a physics constant by a variable frame time.

## Debug hooks (a critic's entry point)

`window.MZ` and `window.sim`:

```js
sim(600)                      // 5 s of simulation, deterministically, then one render
MZ.simSeconds(5)              // same
MZ.state()                    // JSON snapshot of telemetry
MZ.wear('mk50')               // instantly wear an armor, no sequence
MZ.suitup('mk50')             // play the suit-up sequence
MZ.fly({alt: 400, speed: 200})// put the player in the air
MZ.cam([x,y,z],[lx,ly,lz],fov)// park the camera to match a reference frame
MZ.screenshot()               // PNG data URL
```

Every module that can be posed **must** honour the `debug:*` bus events for it. That is
how a critic renders our output from the same angle as a reference image.

## Rules that came from a previous attempt failing

- A metallic material with **no environment map renders black**. `engine/env.js` builds
  one before any module initialises. Do not remove it, do not set `metalness: 1` with
  `roughness: 0` and expect anything but a mirror of nothing.
- **Additive effects vanish against bright ground.** Any glow material gets
  `toneMapped: false` and blending set explicitly, or the repulsor disappears over the
  ocean at noon.
- **`matrix_parent_inverse` does not survive glTF export.** Verify an exported model by
  walking the node tree of the `.glb`, never by trusting what Blender's viewport showed.
- **Never assume a limb lies along a pivot's -Y axis.** Derive the limb direction from the
  model (joint → child in rest pose).
- **Look at your own output.** A measurement proves a model is valid, never that it is
  right. Render it and open the image before calling it done.
- **Audio must be real recorded files.** Synthesising in WebAudio is a rejected approach.

## Layout

```
index.html  play.command  serve.py  ARCHITECTURE.md
vendor/            three.js, three addons, rapier   (frozen)
reference/         the bar — 87 film stills and photos  (read-only)
models/            CONTRACT.md, <id>-build.py, <id>.glb, <id>-*.png, <id>-notes.md
audio/             CREDITS.md, manifest.json, sfx/, music/
src/main.js        boot
src/engine/        renderer, env, loop, state, bus, assets, debug, registry, onfoot
src/world/         Malibu, cliff, ocean, town, fair, donut
src/suit/          armor rig, the five suit-up sequences, faceplates
src/flight/        flight model, camera rig
src/combat/        physics, repulsors, destruction
src/hud/           JARVIS HUD
src/audio/         sound bank and mixer
```

## Audio supplied by Jurek — use these, do not replace them

Two sounds were provided by the user directly and are NOT negotiable. They live in
`audio/user-provided/`, normalised and ready, with the untouched originals kept beside them
as `*.original.mp3`. The audio task must wire these in and must not swap them for something
downloaded.

| file | what it is | measured |
|---|---|---|
| `audio/user-provided/suit-up-sequence.mp3` | the suit-up sequence — a continuous run of mechanical servo and latch sounds | 33.3 s, mono, normalised to -15.3 dB mean. Sourced at 64 kbps so the top end is limited (energy above 8 kHz sits 19 dB below full band); it is mechanical clatter, so that is acceptable — do not try to "fix" it with an EQ shelf that just raises hiss. |
| `audio/user-provided/faceplate-close.mp3` | the faceplate closing — one tight metallic snap | 0.66 s, stereo, leading silence trimmed, normalised to -20.9 dB mean. The original was extremely quiet (-34.5 dB); the normalised file is the one to use. |

How they are meant to be used:

- **`faceplate-close.mp3`** plays whenever a faceplate shuts, on every armor. It is a single
  short snap, so it can also be pitched and reused for the Mk I visor dropping, the Mk XLII
  plates locking, and similar hard metal contacts.
- **`suit-up-sequence.mp3`** is 33 seconds of continuous mechanical sound, far longer than any
  one suit-up animation (Mk I runs 3.2 s, Mk L 1.5 s). Do not simply play it and cut it off.
  Either cut it into labelled slices (servo whine, plate latch, hydraulic hiss, bolt drive)
  and trigger them per plate as the armor closes, or time-stretch a chosen region to the
  length of the sequence. Cutting it up is the better answer: it turns one clip into a
  library that stays in sync with whatever the animation does.

Both are credited in `audio/CREDITS.md` as user-supplied.
### More user audio: footsteps and repulsor

Two more recordings came from Jurek and were cut into usable samples. Same rule: use them,
do not swap them out. Originals kept as `walking-fast.original.mp3` and
`walking-repulsor.original.mp3`.

**`audio/user-provided/steps/step-01.mp3` … `step-16.mp3`** — 16 individual footsteps cut from
one continuous fast-walk recording. Each is a single heel-strike plus roll, ~0.44 s, leading
silence removed so the transient fires on frame zero, normalised to -18 LUFS. Sixteen distinct
takes exist specifically so you can pick one at random per step and never hear an obvious loop.

**These are the footsteps of the player WEARING AN ARMOR — a walking Iron Man, not the boy in
trainers.** Jurek said so explicitly. Use them whenever the player walks while suited, on every
armor, and do not "fix" them by making them lighter. If a heavier suit (Mk I is the heaviest)
wants more weight, pitch DOWN and add low end — never substitute a different recording.

For the boy walking un-suited through the house, use a light, soft footstep from the downloaded
`sfx/` library instead. Do not use these for that.

**`audio/user-provided/repulsor/repulsor-01.mp3` … `repulsor-06.mp3`** — six repulsor shots,
~0.95 s each, normalised to -15 LUFS. Sharp attack on the first sample, long decaying tail.
Rotate through them so repeated fire does not machine-gun the same waveform.

**`audio/user-provided/repulsor/repulsor-charged.mp3`** — 1.7 s, a longer charge-then-discharge.
Use for the unibeam or a held/charged shot, not for the light repulsor tap.

Both sets were cut by onset detection rather than by ear-guessing timestamps, and the cuts were
verified by rendering waveforms — every sample starts on its transient and ends after the tail
has decayed, with short fades so nothing clicks.


## Hard requirements: no z-fighting, and everything collides

Two things Jurek asked for explicitly. They are not polish items — a critic should mark a
piece DOWN for failing either, and the integrator must check both every round.

### 1. Nothing may z-fight

Z-fighting is two surfaces flickering against each other as the camera moves, because the
depth buffer cannot separate them. It looks broken and cheap, and it is always fixable.

Causes, in the order they actually bite in a project like this:

- **A huge `far` with a tiny `near`.** Depth precision is spent almost entirely near the
  camera. Flying to the stratosphere wants a large far plane, and that is exactly what
  destroys precision for the house you are standing in. Fix with
  `logarithmicDepthBuffer: true` on the renderer AND a `near` no smaller than ~0.2 m. In the
  previous build this single change is what stopped the ground grid from disappearing.
- **Coplanar geometry.** Decals, floor markings, glass panes flush with a frame, a road
  surface sitting exactly on terrain. Never model two surfaces at the same height. Offset by
  a real millimetre or two, or use `polygonOffset: true` with a negative factor and units.
- **Double-sided walls with zero thickness.** Give walls, glass and panels actual thickness.
- **Scaled-up shared geometry**, where two instances land on the same plane.

How to verify — do this, do not assume: fly the camera slowly toward and past every large
flat surface (floors, glass walls, the terrace, the road, the ocean edge, the donut, every
armor's flush plates) and watch for flicker. Then do it again from far away, because
z-fighting is a distance-dependent bug and usually shows up first at range. Screenshot from
two nearly identical camera positions and diff them — flicker shows as pixels that change
when nothing moved.

### 2. Everything solid must have collision

If it looks solid, the player must not walk or fly through it. This includes: every wall,
floor, ceiling, stair and railing in the Malibu house; the glass (until it is broken); the
cliff face and the terrain; the gantry rig; the town buildings, the big wheel, the gas
station and its donut; lamp posts and street furniture; and the ocean surface, which should
stop you (with a splash) rather than let you fall through the world.

Also required:
- The player must never fall out of the level, and must never get stuck inside geometry.
- Destructible objects keep collision while whole, and their pieces collide after breaking.
- Collision must match what is drawn. A collider that is a rough box around a detailed
  railing is worse than no railing — the player bumps into nothing.

How to verify — again, actually do it: walk the whole house pressing into every wall; fly
into the cliff, each building, the wheel and the donut at speed; land on the donut and on
the terrace; try to leave the map in all four directions and upward; and after breaking
something, walk into the debris. Anything you pass through is a bug, and so is anything that
stops you where nothing is drawn.

### Depth precision — do not revert `logarithmicDepthBuffer`

`src/engine/renderer.js` sets `logarithmicDepthBuffer: true`. It is load-bearing, not a
preference. The faceplate must sit almost on the lens (`near = 0.05`) while the sky reaches
60 km, giving a far/near ratio of 1.2 million — far beyond what a standard depth buffer can
resolve at distance.

Measured, by rendering each viewpoint twice with `near = 0.05` and `near = 1.0` and counting
pixels whose colour changed (if precision alone changes what is visible, that surface is one
camera nudge away from flickering):

| viewpoint | before | after |
|---|---|---|
| townAir | 1.02 % | 0.00 % |
| highAltitude | 0.44 % | 0.00 % |
| cliffWide | 0.31 % | 0.00 % |
| donutLow | 0.17 % | 0.00 % |
| fairAir | 0.04 % | 0.00 % |

If a future change needs the flag off, it must first raise `near` and prove these numbers
stay at zero. Turning it off on its own brings the flicker back over the town and at altitude.

## Flight VFX, poses and the environment map (2026-09-05)

**`src/flight/thrustfx.js` is new.** The rig has always had four correctly-oriented emitter
pivots (`piv_thrusterL/R`, `piv_palmL/R`) and nothing ever drew into them, so the armour
flew with no repulsors and no flight line at all. The module hangs a cone plus a glow
sprite off each pivot, gives the boots one point light each, and streams two vertex-alpha
ribbons behind them above 40 m/s. It is driven from `flight.js`'s update, at the very end,
after the rig has been posed and placed — it reads emitter WORLD positions, so anything
earlier is a frame behind. It is not a registry module; `registry.js` stays frozen.

Additive white over a lit ocean cannot be subtle. The first pass ran the sprites at 5–10
radii and full opacity and the four of them merged into one blown-out streak that hid the
whole armour (`shots/fix/6_cruise_env.png` against `8_nofx.png`, the identical frame with
the plumes off). Halved on both size and opacity. The cones carry the shape; the sprite is
only there so the source is a point rather than a line seen edge-on.

**The environment map was never applied.** `env.js` swapped the PMREM cube under
`if (wantCube !== this._cube)` and seeded `_cube` with `'exterior'` — the state the game
boots in — so the guard was false on the first `_apply()` and every one after it.
`scene.environment` stayed null unless you walked down to the workshop and back up. Every
metal outdoors, all five armours at metalness 1 with nothing to reflect, rendered as a
black silhouette with a specular highlight. Seeded `null` instead.

**Poses.** `POSES` had no `brake` key at all; `POSES[name] || POSES.stand` handed back the
standing pose, so holding S changed the physics a little and the silhouette not at all.
`brake` and `land` are authored now, and `cruise`'s arms are swept down the flanks rather
than held straight out to the sides — the latter is a hero-shot hold, and at 300 m/s it
reads as a crucifix sliding through the sky.

**S is a real stop.** It opposes the body-frame VELOCITY on all three axes at 0.85 of the
mains, capped at the impulse that would zero the velocity this tick, so it kills sideways
drift too. Measured: 376 m/s to rest in 5.25 s over 819 m. The old forward-axis-only
`spec.retro` took about nineteen seconds.

**First person at speed.** The eye was pushed out of the helmet along the AIRFRAME's
forward axis. In cruise the body is leaned 1.32 rad inside the airframe, so that push ran
sideways through the skull and 0.17 m never left the shell: 23 of 25 rays across the
frustum hit `helmet_1 / mat_primary` from the inside — the red metal filling the screen.
The push comes off the helmet's own quaternion now, at 0.30 m. Measured after: 0 of 25.

**Doffing leaves the armour standing.** It used to unequip and hide the rig, and flight/'s
stand-in for "no rig loaded yet" is a dark red capsule — so stepping out of a Mk III turned
the player into a red pill. The shell now stays where you left it with every plate back and
the visor up; walking to it and holding F emits `suit:reenter`, which closes the faceplate
and re-emits `suitup:done`. Refused in mid-air: doffing over the Pacific left a Mk III
hanging at y = 10.2 with the boy falling away underneath it.

## Flight feel: the body-orientation law and the continuous pose system (2026-09-05)

**One line of quaternion composition owned three separate bug reports.** `flight.js` built
the suit's visible orientation as `q_air · Rx(leanPitch) · Rz(leanRoll)`. The roll was about
the body's own Z *after* a −1.32 rad pitch, and `Rx(−1.32)` maps that Z onto
`(0, 0.969, 0.248)` in airframe space — within 14° of the airframe's vertical. So `leanRoll`
was never a bank; it was a yaw of a body lying on its face:

- holding D slid the airframe toward +X (physics correct) while the body visibly turned the
  other way — "the A and D controls are inverted", when only the visual cue was;
- sliding changed nothing else at all — "it just rotates the body 45 degrees";
- the `cruise` pose aims the palms at suit-space +Z, meaning *trailing behind*. Through the
  same pitch that becomes airframe `(0, 0.969, 0.248)`: **straight up**. "The repulsors fire
  upward while flying" was never a bug in the plumes. They pointed exactly where the pose
  table told them to, and the pose table did not know about the lean.

The body is now described as what it physically is: **the spine lines up with the thrust**.
`poses.js` computes a spine axis and a bank; `flight.js` composes
`q_air · swing(+Y → spine) · R_spine(bank)`. Cruise lies down head-first because the mains
push from the boots; braking stands up feet-first; a slide leans and banks into itself. No
pose table authors any of it. The airframe still goes where the mouse points — aiming with
the mouse and pressing W is the ten-second rule in `input.js`, and a suit whose thrust axis
is separate from its aim is a two-stick spaceship.

**Poses are continuous now, not five static tables.** `rig.js` gained `bakePoses` /
`setPoseWeights` (blend several authored tables at once), `setJointOffset` (a per-frame
rotation per joint), `aimEmitterNow` (point a palm or boot along a direction in suit space,
resolved against the blended chain) and `setRootOffset` (the landing crouch). `poses.js`
drives them from acceleration, command, speed and g-force.

Two traps, both measured:

- **Offsets must accumulate, never replace.** `setJointOffset` copies, so the last writer
  won: the arm-reach IK overwrote the shoulder every frame and silently deleted the sweep,
  the ski lean and the idle wobble written a few lines above it. The shoulder offset sat at
  exactly −0.1317 for as long as you cared to watch.
- **`aimEmitterNow` must walk the offsets too.** `updatePose` renders `target · offset`, so
  resolving an emitter aim against the targets alone solves it in a frame the armour is not
  in. The braking palm sat 60° off the direction of travel and got *worse* as the IK gain
  went up. With the offsets in the chain and two IK passes: cruise palm exhaust · velocity
  = −1.00, braking palm · velocity = +1.00.

**Flight numbers that changed, with the reason:**

| what | was | now | why |
|---|---|---|---|
| hover engage | auto after 0.3 s idle below 45 m/s | `hoverHold` only | it made H a no-op, stopped the suit ever falling, and a servo-held suit can never satisfy the grounded test |
| `grounded` | `thrustMag < 0.08` | `manualCmd < 0.05` | the servo adds 0.34 to `thrustMag`, so a parked suit on the floor was never grounded |
| H at speed | armed, no force | omnidirectional burn at 0.85 mains | 302 m/s to rest in 13 s, then parks |
| keys while parked | dropped the servo | walk the anchor at 12 m/s | measured 22.3 m per 2 s nudge (was 160 m — the mains were firing alongside the servo) |
| lateral / vertical | 2800 / 6600 N | 0.45 / 0.75 of mains | a fifth of forward authority is why braking sideways and landing were hopeless |
| lateral drag | quadratic only | flight assist to zero in 0.6 s | 0.95 m/s² at a 20 m/s slide is nothing; the slide never bled off |
| tail-first drag | same as nose-first | `dragRatio.back = 8` | nothing ever bled a reversed flight off |
| S | pure velocity-opposing brake | blend of stop and reverse | the impulse cap made backward flight impossible *by construction* |
| boost | flat ×1.45 on the mains | punch decaying over 0.35 s + 25% forward-drag cut | every feedback channel was already saturated by W alone; `state.thrust` now clamps at 1.4, not 1 |
| turn authority | fixed | ×(1 + 0.6·(1 − throttle)) | cut the engine, spin, burn the other way |

## Performance: where the frame actually goes (2026-09-06)

Measured on the live scene rather than guessed. The numbers that mattered:

| | before | after | how |
|---|---|---|---|
| distinct material objects | 1085 | 428 | `engine/dedupe.js`, run once on the world root at boot |
| lights in the scene graph | 19 (8 at intensity 0) | 14 | `world.js` `_reapDarkLights` |
| first frame back in the living room after a workshop trip | 95 ms | 10.3 ms | `renderer.compileAsync` at boot |
| simulation, per tick | 0.25 ms | 0.24 ms | unchanged; the sim was never the problem |

**Duplicate materials were the single biggest piece of avoidable work.** 6668 meshes carried
1085 material objects but only **185 distinct material definitions** — eighty-two separate
meshes each holding a private copy of the same `MeshStandardMaterial #6b5a3c roughness
0.98`. It happens naturally when props are built in loops, it is invisible on screen, and
it costs a state block, a uniform upload and a lost batch per copy on both the colour pass
and every shadow pass. `dedupeMaterials` folds them together, deliberately skipping
anything a module mutates per instance (transparent/additive VFX whose opacity is animated,
anything with `userData.glowBase`, non-zero emissives, ShaderMaterials) — see the header of
that file for the full list and the reasoning.

Proven safe by A/B, not by eye: the same headless rig (`tools/opt-check.html`, run with and
without `?nodedupe=1`) rendering the living room, the workshop and the town, compared pixel
by pixel — **0.00% of sampled pixels differ by more than 6 in the living room and the town**
(max channel delta 4 and 7), 0.44% in the workshop from animated practicals landing on a
different frame. Keep that flag: it is how the next person checks this again.

**A light at zero intensity is not a free light.** three's forward renderer compiles the
light COUNT into every material and evaluates all of them per fragment, so the three
suit-up spots and five indoor-daylight sources — switched off for most of the game — were
charging full price across 400-odd materials for a contribution of exactly zero. They are
now removed from the graph and put back the moment their owner turns them up; their owners
keep their references and go on setting `intensity` on the detached object, so nothing else
had to change.

**Shader compilation is what a "lag spike" usually is.** three builds a material's program
the first time it is actually drawn, inside that frame. `compileAsync` at boot removed the
95 ms hitch on returning to the living room. The armour gets the same treatment in
`suit.js` equip(), and there it is the SYNCHRONOUS `compile()` on the rig alone — the async
form resolves off a WebGL fence that a hidden or throttled tab never advances, and awaiting
it hung equip() outright with no suit and no error. Compiling `ctx.scene` synchronously is
also out: it walks every mesh in the world and locked the page hard.

Caveat recorded honestly: GPU stall timings could not be verified in the browser pane used
for this session (hidden, not compositing — the same suit-up measured 204 ms and 1190 ms on
consecutive runs). The material, light and program COUNTS above are graph facts and are
reliable; the millisecond figures for compile warm-ups are not, beyond the living-room one
which reproduced twice.

### The muzzle is the real palm, except when that is behind your eye

`combat.js` spawns a bolt at the armour's actual `piv_palm` pivot, which is correct and is
what makes the shot leave the hand you can see in third person. But at cruise the arms are
swept back down the flanks and the first-person camera sits 0.30 m out through the
faceplate, so the hands are genuinely *behind* the view — the bolt was born off-screen and
flew away from the player. That is "the repulsor shots come from behind the suit", and it is
worst on the first shot of a burst, before the fire pose has swung the arm forward.

The muzzle now keeps its real position unless it is behind the camera plane, in which case
it slides forward along the shot line just far enough to clear it. Measured after: the bolt
is born 0.74 m in front of the eye. Third person is untouched.

### The ocean was nailed to the world origin

`ocean.update` carried the comment "Snap the disc under the camera in XZ" directly above
`mesh.position.set(0, 0, 0)`. The disc is radial — ring radius grows as `t^3.1` out to
20 km, so vertex spacing runs from about a metre in the middle to hundreds of metres at
the rim — and pinned to the origin that dense middle sits under the HOUSE.

Fly to the town 3.6 km away and the water under you is sampled every ~148 m (from the
geometry: `d(rad)/dr` at that radius), which is coarser than the waves are long. Every
frame lands on a different set of crests, and the sea crawls and sparkles: correct at the
spawn, falling apart exactly as you fly, which is what was reported.

The disc follows the camera now, snapped to a 2 m grid rather than followed continuously —
the wave field is evaluated in WORLD space in the vertex shader, so a disc sliding a
fraction of a metre per frame moves every vertex to a new place on the wave and swims. On a
grid the sample points are stable. Measured after: nearest vertex 0.1 m at home, 0.0 m at
3.6 km out.


### Two optimisations that were removed again, and why

Both were added in the same pass as the material dedup and both were taken back out. They
are written down because they look obviously correct and are not.

**A model prefetch.** The five armour `.glb` files are 5.7-8.4 MB each and are fetched only
when one is chosen, so a serial background fetch 2.5 s after boot looked like free money:
turn the suit-up from a download into a parse. What it actually did was compete with the
one download the player is waiting on. In `tools/opt-check.html` a `wear('mk3')` issued
shortly after boot produced **no rig at all inside a twenty-second wait**, while an
identical `wear('mk3')` later in the same run worked — and the prefetch starts with the
same file that first wear is asking for. Removing it restored the boot-time wear
immediately (`rig=true, plates=37`). Thirty-six megabytes on every page load for an
unproven gain, in front of the thing the player is actually waiting for, is a bad trade.

**A synchronous shader compile in `equip()`.** `renderer.compile(rig.root, ...)` blocks, and
under a software rasteriser the rig never appeared inside a twenty-second wait — a far
worse stall than the hitch it was meant to remove, and exactly what a weak GPU would do to
a player. Its async sibling is worse still: `await compileAsync(...)` hung `equip()` outright,
because it resolves off a WebGL fence that a hidden or throttled tab never advances, and the
game was left with no suit and no error. What survives is fire-and-forget: the warm-up is
started and never waited on, so it can only help.

The general lesson, and the reason the numbers in the table above are worth more than the
ideas that produced them: **an optimisation that cannot be measured cannot be shipped.**
GPU stall timings were not measurable in this session's browser pane at all — the same
suit-up measured 204 ms and 1190 ms on consecutive runs — so every change that rested only
on those numbers was reverted, and only the graph facts (material counts, light counts,
vertex spacing) and the reproducible living-room figure were kept.

### `node --check` is not a syntax check for this project

It parses a `.js` file as CommonJS and can pass a file that is not a valid ES module at
all. It cheerfully accepted a `const` declaration sitting **inside a class body**, which
the browser then refused to load. Use `tools/syntax-check.sh`, which imports each file:
every module here imports `three`, which node cannot resolve, so a "Cannot find package"
result means the syntax parsed and only resolution failed, while a `SyntaxError` is real.

### Breaking a textured object destroyed its texture

Two separate holes, both in how fracture geometry is built.

`splitByPlane` emitted positions and **nothing else**. A piece cut off a textured object
therefore had no `uv` attribute, and three feeds a missing attribute as `(0,0)` — every
fragment of the piece samples one single texel and the chunk comes out as a flat smear of
whatever colour lives at the corner of the map. It carries UVs through now: the cut point
is already a lerp along an edge, so the same `t` that places the vertex places its UV, and
the freshly cut faces (the inside of the material, never mapped) take the centroid of the
ring they close so they match the tone of the break.

Voronoi fracture cannot do that — a cell hull is brand-new geometry and there is no
meaningful mapping for the inside of a solid that was only mapped on its skin. So
`debris.js` gives any piece with no UVs a **map-less clone** of its material, one per
source material and cached, darkened slightly because a diffuse map is usually darker than
the white it multiplies. Pieces that did keep their UVs keep the real texture.

### Ground mode was throwing on every walking tick

`stepWalk` ended with `this.speed = sp`, and `speed` is a **getter** on `FlightModel`
(`get speed() { return this.velocity.length(); }`). Assigning to it throws, and
`engine/loop.js` wraps every module update in a try/catch — so the exception was swallowed
120 times a second and the entire flight module update stopped running for as long as the
player was walking. Everything downstream of it (poses, the plumes, the camera rig's flight
branch) silently stopped with it, and ground mode still *looked* like it worked.

It surfaced only because `tools/opt-check.html` started forwarding `console.error` out of
the iframe while chasing an unrelated feature. That forwarding is now part of the rig and
should stay: a game that catches its own module errors needs something that shouts about
them, or a broken subsystem reads as a subtle gameplay complaint instead of a stack trace.

### The Mark L's wing array

The nano suit grows two angled thruster blades off the chest while the trigger is held —
Jurek's reference frame for that armour, and the one thing only the nano suit can plausibly
do. Two blades and two plumes, built once when a Mk L is worn, parented to `piv_chest` so
they follow the pose for free, scaled from zero so they cost one matrix each when stowed.
Deploy is slower than retract (0.18 s against 0.09 s): growing reads as something being
built, snapping back as something being dismissed. Verified: built 2 on the Mk L and 0 on
the Mk III, out to 1.0 while held, back to 0.0 on release.

### The launch tunnel

There was no way in or out of the workshop except the stairs, which is why "you can't fly
into the house at all, to take the suit off and put a new one on" had no answer.

The bay is a basement at y = 91 under a plateau at 96, and the cliff falls away to the
SOUTH — measured on the live terrain, the ground is still 96 m at z = −27 and already 29 m
at z = −47, a 67 m face over twenty metres of run. That face is where the door belongs.

The bore is a `CatmullRomCurve3` through six points: out of the bay heading south, swinging
west as it descends, breaking out of the cliff pointing at open sea so you leave already
banked and pull up over the water. Curved because a straight one reads as a drainpipe.
3.2 m of bore, because the flight model now sweeps a 0.9 m ball against real colliders and
anything under ~2.5 m is a tunnel you scrape down rather than fly through.

**No hole had to be cut in the terrain.** `resolveGround` ignores the heightfield once you
are more than 2.2 m below the reported surface — the "under a floor" rule that lets the
workshop exist at all — so the run under the plateau is already flyable, and only the mouth
has to clear the rock.

Verified in `tools/tunnel-probe.html`:

    bore clear?      0 of 40 segments blocked to a 0.9 m sweep along the centre-line
    bore vs terrain  32 points under the surface, 9 in open air, breaks out at t = 0.80
    mouth            (-42, 86, -44), terrain there 45 m -> OPEN AIR

### The levitating head, and stepping out of the armour

Taking a suit off opens the faceplate first, and `suit.js` reads an open faceplate as "show
the face" — **head only**, because the rest of the boy is inside finished armour and would
z-fight through it. Then the doff peels the plates away and what is left is a head hanging
in mid-air. That is "when I take the suit off there's my head levitating for a moment", and
it was one line: the face logic guarded against a suit-up sequence running but not against a
doff. `suitup` publishes `doffing` now and the guard covers both; the doff shows the whole
boy from its first frame, so the plates come off around a person.

He also used to be planted at exactly the armour's position, which puts the boy and the
empty suit in the same cubic metre — the first thing you saw after taking it off was the
inside of its own chest. He steps out 1.25 m along the armour's facing and turns round to
look at it, which reads as climbing out and keeps the suit in frame, and the suit is now a
thing you walk back into.

Verified end to end in `tools/doff-probe.html`:

    grounded=true after 0.7 s, locomotion=walk
    doff: floating-head frames 0/40, parked=true, armour still visible=true
    boy stepped out 1.25 m from the armour, mode=onfoot
    re-entry: armor=mk3, closed=true, parked=false, mode=flight

### The armour tablet

Walking to each glass case in turn and holding F on it is fine once you know which suit you
want. A workshop with five of them would have a slate on a stand, and that is what was
asked for, so there is one by the rack at (-14.6, 91, 17.4).

It is deliberately not a second selection system. Holding F on it opens `ui.picker`, which
takes the pointer the way the pause screen does, answers 1-5 and clicks, and hands back an
armour id — and from there it runs the ordinary flow: walk to the pad, gantry, suit-up. One
code path decides "which armour" however you asked for it, so the cases and the tablet can
never drift apart.

Verified in `tools/tablet-probe.html`: mesh built, `world.tabletAt` exposed, holding F opens
the picker with 5 rows, and picking #5 sets `state.armor = mk50` and closes it.

### The workshop was a draw-call problem, not a triangle problem

Measured with the real renderer in headless Chrome (`tools/shadow-probe.html`,
`tools/merge-ab.html`), because `renderer.info` in the session's browser pane reported
`calls=1`:

| where | before | after |
|---|---|---|
| living room | 145 | 128 |
| **workshop** | **1373** | **822** |
| **stairwell** | **1795** | **878** |
| air over the town | 68 | 68 |

The workshop held **1158 meshes carrying 33 154 triangles** — an average of twenty-nine
triangles each. Bench legs, brackets, crates, tool handles: none of it expensive to draw,
all of it expensive to *submit*, and every one submitted a second time into the shadow map.
That is the spike on walking down the stairs, and no amount of polygon reduction touches it.

`mergeStatic` in `engine/dedupe.js` bakes them into one mesh per material. 1000 of the
workshop's meshes became 40 batches and 320 of the interior's became 14. What makes it safe
is that almost nothing down there is referenced: exactly one mesh in the workshop had a
name. Excluded, each for its own reason: named meshes, `userData.worldSolid` (Handoff holds
them and builds colliders from them), `userData.breakable`, anything under an animated group,
and **anything transparent** — transparent objects are sorted per object, and a dozen of them
in one buffer draw in whatever order their triangles happen to sit.

**Verified on geometry, not on pixels.** A pixel A/B of this is worthless: the scene animates
— glowing screens, the reactor's breath, the practicals, the water — so two separate runs
differ on about 1% of pixels with peak channel deltas over 200 whether or not anything was
merged. An afternoon went into reading meaning into that noise. What is deterministic is the
geometry, so `mergeStatic` now measures the subtree before and after and returns both:

    shop      1158 -> 198 meshes, 1000 baked into 40 batches, tris 33094 -> 33094, box shift 0.0000 m
    interior   360 ->  54 meshes,  320 baked into 14 batches, tris  5481 ->  5481, box shift 0.0000 m

Identical triangle counts and an unmoved world bounding box are what prove the transform
baking is right. `?nomerge=1` turns the whole pass off, the way `?nodedupe=1` does.

### The whole world was being drawn from inside a windowless basement

Measured by hiding one subtree at a time while standing in the workshop, which cost 739
draw calls and **1 901 063 triangles**:

    without the terrain      1 083 763    -817 300 triangles
    without the vegetation   1 283 247    -617 816 triangles
    without the ocean        1 833 479     -67 584 triangles

A million and a half triangles — **seventy-six per cent of the frame** — on a hillside, a
sea and half a million shrubs sitting on the far side of five metres of rock. The workshop
has no windows.

`world.js` `_cullUnderground` hides the outdoor list when the camera is inside the basement
footprint (inset 2 m, so it never fires while you stand in a doorway) and below the slab.

Two things it is deliberately **not**:

* **not keyed on `env.k`.** The lighting mix also reaches 1 inside the launch tunnel, and
  the tunnel is the one place underground where you are *supposed* to see the sky. A
  geometric test leaves that box long before the mouth comes into view.
* **not applied under the stairwell.** The shaft is a 4.6 m hole straight up into a living
  room that is glass on three sides: stand at the foot of the stairs, look up, and you are
  looking at the Pacific through two openings. Ten metres of radius around the shaft keeps
  the world, and the measurement confirms it — the stairs still draw the full 1.9 M.

| where | triangles before | after |
|---|---|---|
| workshop | 1 901 063 | **545 551** |
| armour bay | — | 377 390 |
| stairwell | 1 901 013 | 1 901 013 (deliberately unchanged) |
| living room | 1 524 419 | 1 524 419 |
| in flight | 1 508 518 | 1 508 518 |

### The town was the same problem as the workshop

The worst viewpoint in the game is from the air looking back at the headland: **2570 draw
calls** a frame with only twelve instanced meshes in the scene, which means about two and a
half thousand individual objects were in view. The same bake fixes it.

    shop      1158 ->  198 meshes   1000 baked into 40 batches   tris 33054 -> 33054   box 0.0000
    interior   360 ->   54 meshes    320 baked into 14 batches   tris  5481 ->  5481   box 0.0000
    town      2878 ->  521 meshes   2366 baked into  9 batches   tris 54575 -> 54575   box 0.0000
    fair       792 ->  259 meshes    554 baked into 21 batches   tris 30774 -> 30774   box 0.0000
    donut      120 ->   59 meshes     70 baked into  9 batches   tris 42196 -> 42196   box 0.0000

4310 meshes into 93 batches, and the geometry invariant holds everywhere: identical triangle
counts, world bounding box unmoved.

Looking at the land from the air: **2570 -> 1800 draw calls**. Triangles went *up* slightly
(2 161 544 -> 2 214 993) because a batch is culled as one object, so geometry that used to
be frustum-culled individually now draws. That is the trade this makes on purpose — 770
fewer submissions for 53 000 more triangles is a good deal on a scene that is CPU-bound,
and a bad one on a scene that is not. It was measured before it was believed.

### One that was reverted: tiling the near vegetation

`vegNear` is a single InstancedMesh over 6100 x 2720 m, and an InstancedMesh is culled as
one object against the whole cluster — so 617 816 triangles of shrubs are drawn no matter
which way you face. Cutting it into a 4 x 2 grid of tiles is free of visual change (the
placement is `valueNoise(gx, gz)`, a function of world position, so lattice-aligned tiles
reproduce it exactly) and it did help where expected: the living room dropped 21% of its
triangles and the sea view 194 000.

It also made the **workshop worse** — 545 551 to 768 703 triangles — which is precisely the
place that was reported as lagging, and the cause was not established. Reverted. The rule
from earlier in this file applies to my own good ideas too: an optimisation that cannot be
shown to help does not ship, and one that can be shown to hurt where it matters ships even
less.

### Where the workshop's remaining draw calls actually live

After the bake, the workshop still cost 723 calls against only 545 671 triangles — so the
cost is submissions, not geometry, and the bake had not found them. Counting visible meshes
by owner rather than guessing:

    visible meshes in the whole scene: 1108
        737  world
        371  ONFOOT          <-- the armour display rack
    meshes passing the frustum: 679
        371  ONFOOT          <-- every single one
        308  world

**More than half the room's submissions are the five display cases.** Each silhouette is
about seventy-five little boxes. They are now baked inside their own group — `mergeStatic(g)`
at the end of `buildSilhouette`, and the scoping is the safety argument: onfoot holds each
figure as `c.figure` and hides it with `c.figure.visible = false` when a real armour model
arrives to take its place, so collapsing the parts into the *same* group keeps that
reference meaning what it meant. Collapsing them into the rack above would silently stop
hiding anything.

Honest result: **371 -> 347 meshes, 723 -> 699 calls.** Most of the rack did not qualify for
the merge and it is not yet established why — the filter rejects it for one of its own
reasons and that has not been chased down. Recorded as an open lead rather than dressed up:
the next pass should instrument `mergeable()` to report *which* test rejected each mesh.

### Why the display rack would not bake, and the bug that answered

The open lead from the last pass, instrumented rather than guessed. Of 359 meshes in the
armour rack:

    named 339   transparent 10   mergeable 10  (and all ten are singletons)

They are **named because they are real armour models**. The cases hold loaded `.glb` suits,
about 120 named plates each, not the placeholder silhouettes — so the filter was right to
refuse them, and for exactly the reason it was written.

Chasing that turned up something worse in code already shipped. `mergeStatic` disposed each
merged mesh's geometry on the spot, and **geometries are routinely shared**: props.js hands
the same box to a hundred crates, `combat/vfx.js` keeps one sphere and one ring for every
effect, and the rack holds whole armour models whose geometry the wearable rig may also
hold. Disposing one of those blanks some object elsewhere in the scene — or the suit you put
on ten minutes later.

Candidates are collected during the merge now and freed only after a full scene walk proves
nothing surviving still points at them. The report says it was not hypothetical:

    shop      freed 1000   still shared 0
    interior  freed  319   still shared 1     <-- would have been disposed while in use
    town      freed 1132   still shared 0     (2366 merged; the rest shared geometry with each other)
    fair      freed  554   still shared 0
    donut     freed   55   still shared 0

Verified after the fix: 2224 meshes in the scene, **0 with no position attribute**, and a
worn Mk III has all 37 plates with drawable geometry.
