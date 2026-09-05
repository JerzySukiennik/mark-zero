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
