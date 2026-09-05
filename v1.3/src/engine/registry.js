// Module registry. Owned by engine-core. FROZEN — no task may add, remove or reorder
// entries. Every path below already exists as a stub; your task's job is to make its
// stub real inside the folder your task owns.
//
// Order matters: modules init in this order and update in this order every frame.

import audio from '../audio/audio.js';
import physics from '../combat/physics.js';
import world from '../world/world.js';
import suit from '../suit/suit.js';
import suitup from '../suit/suitup.js';
import flight from '../flight/flight.js';
import combat from '../combat/combat.js';
import destruction from '../combat/destruction.js';
import onfoot from '../engine/onfoot.js';
import cameraRig from '../flight/cameraRig.js';
import hud from '../hud/hud.js';

export const MODULES = [
  audio,        // audio/            — sound bank, mixer, must be first (others emit into it)
  physics,      // combat/physics.js — Rapier world, must exist before world/ builds colliders
  world,        // world/            — Malibu, cliff, ocean, town, fair, donut
  suit,         // suit/suit.js      — loads the 5 armor .glb files, builds the rig
  suitup,       // suit/suitup.js    — the 5 suit-up sequences + faceplates
  flight,       // flight/flight.js  — 6DOF flight model
  combat,       // combat/combat.js  — repulsor projectiles
  destruction,  // combat/destruction.js — breakable objects
  onfoot,       // engine/onfoot.js  — the 13-year-old on foot, doors, armor selection
  cameraRig,    // flight/cameraRig.js — first/third person camera
  hud,          // hud/              — JARVIS HUD, drawn last
];
