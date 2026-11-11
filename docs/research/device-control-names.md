# Control names for popular controllers

Date: 2026-11-11. Where the button numbers of the "known devices" in `src/features/cheat-sheets/core/known/` come from. A known device without a drawing gets the controls list with a block per physical control, named the way the maker names it. The four devices below also have a drawing since 2026-11-11 (`controller-drawings.md`, section 7), whose controls take their names and numbers from these maps.

## Method

DCS World ships, per aircraft, default bindings for popular controllers: `Mods/aircraft/<module>/Input/<aircraft>/joystick/<device name>.lua` (a full binding file) or `<device name>.diff.lua` (changes to `default.lua`). The file name is the name the device reports to DirectInput. The action each default puts on an input says which physical control it is, most plainly in the A-10C, whose stick and throttle the Warthog copies ("HOTAS TMS Forward" on `JOY_BTN7`, "HOTAS Boat Switch Forward" on `JOY_BTN9`). This is the same method used for the WinWing F/A-18 grip (`controller-drawings.md`).

The DCS install on the owner's PC was read only (`C:\Program Files (x86)\Steam\steamapps\common\DCSWorld`). A small script listed, for each device file name, which actions every input gets across all modules, with the number of modules that agree. A map is shipped only where a second, public source agrees with the DCS reading.

## Device files in the DCS install (number of aircraft folders)

Joystick - HOTAS Warthog (28 incl. the full `.lua` in A-10C, A-10C II, F-86, F-14, UH-1H), Throttle - HOTAS Warthog (28), T.16000M (20), TWCS Throttle (20), T.Flight Hotas X (20), VPC WarBRD + MT50 (17), VPC-Throttle (17), VPC Throttle MT-50CM3 (13), RIGHT VPC Stick WarBRD (13), VKB-Sim Gunfighter Modern Combat PRO (6, plus F14 and Space Gunfighter variants), Saitek X52 Pro Flight Control System / Controller (A-10C, A-10C II: full `.lua`), Saitek X52 Flight Control System (3), Saitek Pro Flight X-56 Rhino Stick and Throttle (F-16C only), MOZA AB9 FFB Base, MOZA MTP, MOZA MTLP, Thrustmaster HOTAS Cougar, Logitech G940, CH Pro Pedals, Saitek/MFG/TPR pedals, plus the WinWing devices already covered.

## Shipped maps

| Device | USB id | DCS evidence | Public cross-check |
|---|---|---|---|
| Thrustmaster HOTAS Warthog joystick | 044F:0402, name "Joystick - HOTAS Warthog" | A-10C/A-10C II: 1 trigger first stage, 6 second stage, 2 weapon release, 3 nosewheel steering, 4 paddle, 5 master mode, 7-10 TMS fwd/right/aft/left, 11-14 DMS, 15-18 CMS, 19 CMS press, POV1 trim hat; axes X roll, Y pitch | Thrustmaster's TARGET names and DX order (TG1=DX1, S2=DX2, S3=DX3, S4=DX4, S1=DX5, TG2=DX6, H2U..H2L=DX7-10, H3=DX11-14, H4U..H4P=DX15-19); manual, "Configuration of buttons and axes": https://support.thrustmaster.com/en/product/hotaswarthog-en/ and mirror https://manualslib.mx/manual/559214/Thrustmaster-Hotas-Warthog.html (H4 push = 19) |
| Thrustmaster HOTAS Warthog throttle | 044F:0404, name "Throttle - HOTAS Warthog" | A-10C: 1 slew press, 3-6 mic switch up/fwd/down/aft, 7-8 speed brake, 9-10 boat switch, 11-12 china hat, 13-14 pinky switch, 15 left throttle button, 16-17 fuel flow, 18-19 engine operate motor, 20 APU, 21 gear horn silence, 22-23 flaps, 24 EAC, 25 radar altimeter, 26-28 autopilot engage/path/alt, 29-30 right/left idle, 31-32 engine operate ignition; POV1 coolie; X/Y slew, Z right and RZ left throttle, SLIDER1 friction | TARGET identifiers (SC, MSP, MSU, MSR, MSD, MSL, SPDF, SPDB, BSF, BSB, CHF, CHB, PSF, PSB, LTB, EFLNORM, EFRNORM, EOLMOTOR, EORMOTOR, APUON, LDGH, FLAPU, FLAPD, EACON, RDRNRM, APENG, APPAT, APALT, IDLERON, IDLELON, EOLIGN, EORIGN = DX1-32); IDLERON/IDLELON/EOLIGN/EORIGN = DX29-32 in community TARGET scripts (https://forums.frontier.co.uk/archive/index.php/t-22379.html); same manual as above |
| Thrustmaster T.16000M stick | 044F:B10A, name "T.16000M" | 20 modules: 1 trigger, 2-4 grip buttons, 5-10 and 11-16 the two base banks (the right bank used as a TMS/CMS cluster); POV1 trim; SLIDER1 throttle wheel | https://support.thrustmaster.com/en/product/t16000m-en (manual); community map https://flyawaysimulation.com/ask/answers/thrustmaster-t16000m-button-layout-mapping/ (1 trigger, 2-4 grip, 5-10 left base, 11-16 right base). Neither gives the place of each button inside a bank, so the map names the bank only. |
| Saitek / Logitech X52 Pro | 06A3:0762, name "X52 Pro" | A-10C full `.lua`: 1 trigger first stage, 15 second stage, 2 weapon release (Fire), 3, 4, 5, 6 (pinkie: nosewheel steering), 9-10 (T1/T2: china hat), 20-23 stick hat (TMS), 24-27 throttle hat (coolie), POV1 views; X roll, Y pitch, RZ twist, Z throttle | FlightGear's X52 Pro map (0-based there): https://gitlab.com/flightgear/fgdata/-/raw/next/Input/Joysticks/Saitek/X52-pro.xml : 1 trigger, 2 Fire, 3 A, 4 B, 5 C, 6 pinkie, 7 D, 8 E, 9-14 T1-T6, 15 trigger second stage, 20-23 stick top hat, 24-27 throttle hat, 28-30 mode 1-3, 31 i. Buttons 16-19 and 32-39 (wheel and clutch buttons) are left to the generic list. |

The USB ids are the ones in the Linux `usb.ids` list; the name in each map is the DirectInput name DCS files its defaults under, so a device is also found by name.

## Not shipped yet, and why

- **TWCS throttle, T.Flight HOTAS X / 4 / One**: DCS has defaults in 20 modules, but no numbered public map could be read (the manuals print the button figure as an image). The DCS reading alone (TWCS: 1 communication menu, 2-3 countermeasures, 7-10 a 4-way switch, 11-14 rocker; HOTAS X: 1-4 stick, 5-12 throttle) does not name the physical buttons.
- **X-56 Rhino stick and throttle**: DCS defaults in the F-16C only; no public numbered map found.
- **VKB Gunfighter MCG Pro, Virpil WarBRD / Constellation Alpha / MT-50CM3**: the numbering is set by the device's firmware profile (and the CM3's mode dial changes it); DCS's defaults fit the stock profile but no maker's default map was reachable. A stock map would also need to be matched by name, since the product id changes with the profile.
- **Honeycomb Alpha and Bravo, TCA Sidestick and Quadrant, T-Rudder**: no DCS files; no maker's numbered map found (the Bravo's autopilot buttons 1-7 are documented by the community, the rest is not). TPR pedals already have a shipped layout.
- **MOZA AB9 / MTP / MTLP, Cougar, G940, CH pedals**: DCS files exist; left for a later pass.

Every map can be checked on the device: pressing a control lights its row on the sheet.
