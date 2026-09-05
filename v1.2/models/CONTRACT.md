# Model contract — MARK ZERO

Every armor and the pilot is authored in Blender **headless** and exported as one `.glb`.
The game animates it, so the model ships geometry, materials and a precise pivot
hierarchy — **no armature, no baked animation**.

This contract is what lets four modelling agents work in parallel and have their models
drop into the game with zero code changes. It is not a suggestion. Read all of it.

## How to build

```
/Applications/Blender.app/Contents/MacOS/Blender --background --python models/<id>-build.py
```

Never the Blender MCP tools — they drive a single shared GUI instance and parallel agents
corrupt each other's scenes. The `.py` is a deliverable: it must regenerate the `.glb`
from an empty scene, every time, with no manual step.

## Files per model

- `models/<id>-build.py` — the generator
- `models/<id>.glb` — the model
- `models/<id>-front.png`, `<id>-side.png`, `<id>-hero.png` — 1200×1200 previews
- `models/<id>-notes.md` — triangle count, material choices, and the suit-up parameters
  at the bottom of this file

`id` is one of: `mk1` `mk2` `mk3` `mk42` `mk50` `pilot`.

## Orientation and scale — non-negotiable

- Up axis **+Y**. The figure **faces −Z** (glTF convention: export Y-up, −Z forward).
- Standing, feet flat on **y = 0**.
- Armor total height **1.95 m**. `pilot` (13-year-old boy) total height **1.58 m**.
- Centred on x = 0, arms relaxed at the sides.
- Real-world metres. A gauntlet is ~0.12 m across, not 12.
- **+X is the character's LEFT.** Get this backwards and the game fires from the wrong
  hand. Verify it in your own render before exporting.

## Pivot hierarchy

One Empty per joint, named exactly as below, each **at the joint's true centre of
rotation**. This is the most important part of the contract: the game rotates these
Empties to pose the suit. A shoulder Empty parked in the middle of the torso makes the
arm swing through the chest.

```
piv_root                  (world origin, y = 0)
  piv_hips                (pelvis centre, ~y 0.98)
    piv_chest             (base of the ribcage)
      piv_neck            (base of the skull)
        piv_head
      piv_shoulderL       (LEFT shoulder joint centre, +X side)
        piv_elbowL
          piv_palmL
      piv_shoulderR       (RIGHT shoulder, −X side)
        piv_elbowR
          piv_palmR
    piv_hipL
      piv_kneeL
        piv_ankleL
          piv_thrusterL
    piv_hipR
      piv_kneeR
        piv_ankleR
          piv_thrusterR
  piv_reactor             (centre of the chest arc reactor, on the outer surface)
```

**Emitter axes.** `piv_palmL/R` sit at the palm centre, rotated so their local **−Y points
exactly where the repulsor beam leaves the hand** (straight out of the palm, away from the
back of the hand). `piv_thrusterL/R` sit at the boot jets, local **−Y pointing where the
exhaust goes**. `piv_reactor` local **−Z points out of the chest**. The game reads these
axes directly; it does not guess.

**Verify the export, not the scene.** Blender's `matrix_parent_inverse` does **not**
survive glTF export. After exporting, re-open the `.glb` in a fresh headless Blender (or
parse the node tree) and confirm every pivot's world position and axis. A model that looks
right in Blender and wrong in-game has almost always failed exactly here.

## Plates

Every mesh is a **separate object**, child of the Empty that carries it, named exactly
from this list. Ship all 37. The game hides, reveals, flies in and sheds them individually.

```
bootL bootR thrusterL thrusterR shinL shinR kneeL kneeR
thighL thighR pelvis beltL beltR abdomen
chest ribL ribR back reactor collarL collarR
pauldronL pauldronR bicepL bicepR elbowL elbowR
forearmL forearmR gauntletL gauntletR palmL palmR
earL earR helmet faceplate
```

Each plate's **origin is at its own centre of mass**, so the game can fly it in from a
distance and spin it about itself. Do not join plates. Do not leave an object at the world
origin.

`faceplate` is always a distinct piece. Its **pivot placement encodes its mechanism** —
see the per-armor table below.

## Materials

Principled BSDF only, named exactly `mat_primary` `mat_secondary` `mat_trim` `mat_dark`
`mat_glow`. Set Metallic and Roughness honestly; the game lights these with an environment
map, and metallic ≈ 0.9 with roughness 0.15–0.35 is what reads as metal rather than
plastic. `mat_glow` carries Emission (arc reactor, palm and boot discs, eye slots) with
strength ≥ 3 — the renderer tone-maps, so an emissive must overdrive to clip white.

Baked textures are welcome; embed them in the `.glb`. Roughness variation matters more
than colour variation: broad soft specular sweeps with micro-scratching is the Mk III
look, and a uniform roughness value is the cheap tell.

**Per-armor surface, from the reference library — these must be visibly different:**

| id | surface | palette |
|---|---|---|
| `mk1` | pitted rusted sheet steel, weld beads, rivets, exposed hydraulics and loose wiring | unpainted steel: cool grey + warm rust bloom + soot + green-grey oxidation, never uniform |
| `mk2` | soft brushed/polished aluminium, anisotropic sheen, not chrome, not a mirror | mid-grey, darker recesses, dark concertina joints |
| `mk3` | deep automotive clear-coat lacquer, broad soft sweeps, micro-scratching and dust | candy hot-rod red (maroon in shadow) + **soft brushed gold**, gunmetal only at joints |
| `mk42` | machined layered shells over a visible endoskeleton, each plate a discrete floating shell with a dark gap beneath | **gold-champagne dominant**, red as accents, bright silver-white outline strips |
| `mk50` | satin soft-touch, **no panel lines at all**, form reads by shading | darker desaturated burgundy, gold at faceplate/neck/hips, **cyan** glow slots |

## Proportions, from the reference — also non-negotiable

- `mk1` — asymmetric and top-heavy. Slab shoulders, forearms thicker than upper arms,
  scrap bolted over cloth. Helmet is a plain box: two rectangular eye slots, a horizontal
  mouth grille, zero facial modelling. **A symmetric, clean, evenly grey Mk I is wrong.**
- `mk2` — the reference proportion for the lineup. Broad flat pectoral plates, tapered
  waist, oversized boots and gauntlets, faceplate one continuous curved mask, slot mouth.
- `mk3` — Mk II with paint. Gold covers faceplate centre, chest disc surround, upper arms,
  shin fronts. Faceplate has a brow ridge, cheek planes, an angular jaw, glowing slit eyes.
- `mk42` — many more panels than Mk III: hexagonal and chevron plates tiled over torso and
  thighs, each separable. Large flat bright reactor disc.
- `mk50` — the most human of the lineup. Near-athletic mass, no shoulder bulk, one
  continuous skin with raised sculpted ridges. Triangular chest reactor.

## Faceplate mechanism

Place `faceplate`'s pivot so the game's single rotation/translation matches the armor:

| id | mechanism | pivot |
|---|---|---|
| `mk1` | heavy visor hinges **upward** | horizontal hinge across the **top edge** of the visor |
| `mk2` | lifts and **retracts into the helmet** | at the brow; ship a hollow helmet cavity it can slide into |
| `mk3` | same as mk2 | same |
| `mk42` | face plates **slide apart sideways** — ship `faceplate` split as two halves `faceplateL` / `faceplateR` (38 objects for this armor) | one per half, on the centre seam |
| `mk50` | nanotech **recedes off the face and sinks into the collar** — no hinge; the game dissolves it along a shader | pivot at the collar centre |

## Budget

40,000–120,000 triangles per armor. Five armors and a world run together at 60 fps in a
browser. Do not ship a 400k sculpt.

## Look at your own work

Render the previews and **open them** before calling a model done. Measurements prove a
model is valid, never that it is right — a previous session shipped the wrong head for a
whole session because every measurement matched. Iterate: model → render → look → fix. The
front render must be unmistakably the armor you were asked for, side by side with its
reference file.

## Suit-up parameters (`<id>-notes.md`)

Give the game, per armor:

- `order` — the 37 plate names in the order they land on the body
- `origin` — `gantry` (robotic arms bolt them on), `distant` (they fly in from across the
  room), or `reactor` (they pour out of the chest)
- `duration` — seconds for the full sequence
- one paragraph on how this armor should *feel* while it closes
