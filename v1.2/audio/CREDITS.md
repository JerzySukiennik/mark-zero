# Audio credits — MARK ZERO

Every sound in this game is a **real recorded file** downloaded from a free, permissively
licensed source. Nothing is synthesised in WebAudio.

The bank is baked from these originals by `tools/fetch-audio.sh`, which downloads each
one, cuts the exact window that was auditioned, normalises it and encodes it. Run that
script to rebuild `audio/sfx/`, `audio/music/` and `audio/manifest.json` from scratch.

Every clip below was auditioned before it shipped — waveform and log-frequency
spectrogram inspected against what the file claims to be. Several plausible-looking
candidates were rejected that way (a "crash hit" that turned out to be flat noise, a
"jet engine" that was a chugging piston engine, a "thruster" that was a tonal synth pad).

The thruster was rebuilt for exactly this reason. It was first cut from an airliner
flyby recorded from the ground: a real jet, correctly named, and completely wrong, because
half a kilometre of air had already removed everything above 3 kHz. Measured on the game's
master bus it put 0.000 of its energy above 6 kHz at full throttle. It now comes from a
Saab J35D Draken recorded on the apron and from a sandblasting nozzle recorded next to the
work — near-field sources with the top half of the spectrum still in them.

## Licences in use

* **CC0 1.0** — public domain dedication, no attribution required (credited anyway).
* **CC BY 4.0** — free to use commercially, attribution required, given below.

No CC-BY-NC, no CC-BY-SA, no "free for personal use", no rips from films or games.
`Jet airliner overhead.wav` was auditioned and rejected purely because it is CC BY-SA.

## Sources

| shipped as | what it is | source | author | licence |
|---|---|---|---|---|
| `hud_confirm` | interface confirm blip | [Accept 6 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Accept_6_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `reactor` | air-conditioning unit running | [Air conditioner hum (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Air_conditioner_hum_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `room_workshop` | building air vent, low steady flow | [Air vent (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Air_vent_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_alarm` | warning alarm | [Alarm 2 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Alarm_2_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `repulsor_fire_a` | a heavy percussive hit | [Attack (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Attack_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `concrete_a`, `concrete_b`, `concrete_c`, `glass_debris`, `glass_large_a`, `glass_large_b`, `metal_d`, `metal_debris`, `repulsor_hit`, `rubble_a`, `wood_break` | 75 recorded breaking / falling / hit sounds | [75-cc0-breaking-falling-hit-sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) | rubberduck | CC0 1.0 |
| `suitup` | music — big and sustained | [Boss Mode (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Boss_Mode_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `repulsor_charge` | a machine charging up | [Charging 1 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Charging_1_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `repulsor_charge_big` | a machine charging up, deeper | [Charging 2 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Charging_2_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `flight` | music — driving pulse | [Chase (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Chase_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_click` | a switch clicking | [Clicking (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Clicking_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `suit_ready` | task-complete chime | [Complete (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Complete_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `hud_scan` | computer console tone | [Computer Sound (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Computer_Sound_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_blip`, `hud_tick` | computer console blips | [Computer sounds 1 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Computer_sounds_1_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `house` | music — slow, deep, brooding | [Dark (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Dark_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `thruster_idle`, `thruster_mid`, `thruster_whine` | Saab J35D Draken turbojet, started and taxied, recorded on the apron | [WWS SaabJ35DDrakenstartengineandtaxiing.ogg](https://commons.wikimedia.org/wiki/File:WWS_SaabJ35DDrakenstartengineandtaxiing.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `rubble_b` | dropping rocks onto the ground | [Dropping rocks on ground (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Dropping_rocks_on_ground_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_warn` | interface error tone | [Error 3 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Error_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `wind_high` | electric fan running | [Fan (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Fan_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `glass_tiny` | flicking a drinking glass | [Flick a glass (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Flick_a_glass_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `glass_med_a` | a pane of glass breaking | [Glass breaking (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Glass_breaking_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `glass_med_b` | a pane of glass breaking | [Glass breaking 2 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Glass_breaking_2_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `glass_med_c` | a pane of glass breaking | [Glass breaking 3 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Glass_breaking_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `gravel_land` | landing footfall in gravel | [Land in Gravel (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Land_in_Gravel_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `repulsor_fire_b` | a low electric discharge | [Laser 3 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Laser_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `latch` | a lock closing | [Lock (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Lock_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `servo_grind` | small mechanism running | [Mechanical sound (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Mechanical_sound_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `clank_light`, `metal_light` | bright metal strike | [Metal Hit (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Metal_Hit_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `clank_plate`, `metal_a` | striking a metal pole | [Metal pole hit (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `metal_b` | striking a metal pole | [Metal pole hit 3 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `clank_scrap`, `metal_c` | striking a metal pole | [Metal pole hit 7 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_7_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_notify` | interface notification | [Notification (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Notification_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `glass_small` | setting a glass object down on tile | [Placing glass object on tile (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Placing_glass_object_on_tile_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `nano_seal`, `repulsor_tail` | a short descending electronic sweep | [Portal 1 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Portal_1_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `servo_fast` | rubbing a metal door | [Rubbing metal door (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Rubbing_metal_door_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `thruster_sub` | deep sustained engine rumble | [underwater-or-space-engine-rumble](https://opengameart.org/content/underwater-or-space-engine-rumble) | qubodup | CC0 1.0 |
| `servo_fine` | sanding a metal slide | [Sand down metal slide (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Sand_down_metal_slide_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `thruster_hot` | high-pressure abrasive blasting of a ship hull, close to the nozzle | [WWS Sandblastingashiphull.ogg](https://commons.wikimedia.org/wiki/File:WWS_Sandblastingashiphull.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `servo_heavy` | scratching a metal door | [Scratching metal door (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Scratching_metal_door_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `hud_select` | interface selection blip | [Selection 3 (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Selection_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `metal_heavy` | slamming a closet door | [Slam closet door (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Slam_closet_door_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `plates_swarm` | sorting metal cutlery in a drawer | [Sorting cutlery (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Sorting_cutlery_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `repulsor_fire_c` | a broadband impact burst | [Spell Attack 2 (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Spell_Attack_2_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `nano_flow` | water running from a tap | [Water tap (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Water_tap_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `wind_gust` | wind gusting outdoors, wide open | [Wind outside atmosphere (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Wind_outside_atmosphere_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `wind_low` | wind blowing outdoors | [Windy day (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Windy_day_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |

## Full attribution text

* **accept_6** — "interface confirm blip" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Accept_6_%28Gravity_Sound%29.wav>
* **air_conditioner_hum** — "air-conditioning unit running" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Air_conditioner_hum_%28Gravity_Sound%29.wav>
* **air_vent** — "building air vent, low steady flow" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Air_vent_%28Gravity_Sound%29.wav>
* **alarm_2** — "warning alarm" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Alarm_2_%28Gravity_Sound%29.wav>
* **attack** — "a heavy percussive hit" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Attack_%28Gravity_Sound%29.mp3>
* **bfh** — "75 recorded breaking / falling / hit sounds" by rubberduck, CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>), via <https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx>
* **boss_mode** — "music — big and sustained" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Boss_Mode_%28Gravity_Sound%29.wav>
* **charging_1** — "a machine charging up" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Charging_1_%28Gravity_Sound%29.wav>
* **charging_2** — "a machine charging up, deeper" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Charging_2_%28Gravity_Sound%29.wav>
* **chase** — "music — driving pulse" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Chase_%28Gravity_Sound%29.wav>
* **clicking** — "a switch clicking" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Clicking_%28Gravity_Sound%29.wav>
* **complete** — "task-complete chime" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Complete_%28Gravity_Sound%29.mp3>
* **computer_sound** — "computer console tone" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Computer_Sound_%28Gravity_Sound%29.wav>
* **computer_sounds_1** — "computer console blips" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Computer_sounds_1_%28Gravity_Sound%29.wav>
* **dark** — "music — slow, deep, brooding" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Dark_%28Gravity_Sound%29.wav>
* **draken** — "Saab J35D Draken turbojet, started and taxied, recorded on the apron" by Work With Sounds / Torsten Nilsson, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:WWS_SaabJ35DDrakenstartengineandtaxiing.ogg>
* **dropping_rocks_on_ground** — "dropping rocks onto the ground" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Dropping_rocks_on_ground_%28Gravity_Sound%29.wav>
* **error_3** — "interface error tone" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Error_3_%28Gravity_Sound%29.wav>
* **fan** — "electric fan running" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Fan_%28Gravity_Sound%29.wav>
* **flick_a_glass** — "flicking a drinking glass" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Flick_a_glass_%28Gravity_Sound%29.wav>
* **glass_breaking** — "a pane of glass breaking" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Glass_breaking_%28Gravity_Sound%29.wav>
* **glass_breaking_2** — "a pane of glass breaking" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Glass_breaking_2_%28Gravity_Sound%29.wav>
* **glass_breaking_3** — "a pane of glass breaking" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Glass_breaking_3_%28Gravity_Sound%29.wav>
* **land_in_gravel** — "landing footfall in gravel" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Land_in_Gravel_%28Gravity_Sound%29.mp3>
* **laser_3** — "a low electric discharge" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Laser_3_%28Gravity_Sound%29.wav>
* **lock** — "a lock closing" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Lock_%28Gravity_Sound%29.wav>
* **mechanical_sound** — "small mechanism running" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Mechanical_sound_%28Gravity_Sound%29.wav>
* **metal_hit** — "bright metal strike" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Metal_Hit_%28Gravity_Sound%29.mp3>
* **metal_pole_hit** — "striking a metal pole" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Metal_pole_hit_%28Gravity_Sound%29.wav>
* **metal_pole_hit_3** — "striking a metal pole" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Metal_pole_hit_3_%28Gravity_Sound%29.wav>
* **metal_pole_hit_7** — "striking a metal pole" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Metal_pole_hit_7_%28Gravity_Sound%29.wav>
* **notification** — "interface notification" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Notification_%28Gravity_Sound%29.wav>
* **placing_glass_object_on_tile** — "setting a glass object down on tile" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Placing_glass_object_on_tile_%28Gravity_Sound%29.wav>
* **portal_1** — "a short descending electronic sweep" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Portal_1_%28Gravity_Sound%29.wav>
* **rubbing_metal_door** — "rubbing a metal door" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Rubbing_metal_door_%28Gravity_Sound%29.wav>
* **rumble** — "deep sustained engine rumble" by qubodup, CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>), via <https://opengameart.org/content/underwater-or-space-engine-rumble>
* **sand_down_metal_slide** — "sanding a metal slide" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Sand_down_metal_slide_%28Gravity_Sound%29.wav>
* **sandblast** — "high-pressure abrasive blasting of a ship hull, close to the nozzle" by Work With Sounds / Torsten Nilsson, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:WWS_Sandblastingashiphull.ogg>
* **scratching_metal_door** — "scratching a metal door" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Scratching_metal_door_%28Gravity_Sound%29.wav>
* **selection_3** — "interface selection blip" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Selection_3_%28Gravity_Sound%29.wav>
* **slam_closet_door** — "slamming a closet door" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Slam_closet_door_%28Gravity_Sound%29.wav>
* **sorting_cutlery** — "sorting metal cutlery in a drawer" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Sorting_cutlery_%28Gravity_Sound%29.wav>
* **spell_attack_2** — "a broadband impact burst" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Spell_Attack_2_%28Gravity_Sound%29.mp3>
* **water_tap** — "water running from a tap" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Water_tap_%28Gravity_Sound%29.wav>
* **wind_outside_atmosphere** — "wind gusting outdoors, wide open" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Wind_outside_atmosphere_%28Gravity_Sound%29.wav>
* **windy_day** — "wind blowing outdoors" by Gravity Sound, CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), via <https://commons.wikimedia.org/wiki/File:Windy_day_%28Gravity_Sound%29.wav>

Gravity Sound publish their library at <https://www.gravitysound.studio/>; the copies
used here are the ones mirrored on Wikimedia Commons, linked per file above.
