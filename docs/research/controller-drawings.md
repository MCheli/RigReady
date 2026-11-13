# Research: better controller drawings for the cheat sheets

Design note, written 2026-11-07, after the owner's feedback that the device pictures on the cheat sheets, the trainer and the kneeboard pages are "a little blobby" and that the leader lines and label placement "don't quite make sense". The owner then decided the new drawings ship in 2.0; section 6 says what shipped and what is left. The code is in `src/features/cheat-sheets/core/drawings/` and `core/picture.ts`.

## 1. What exists

A **layout** (`core/layout.ts`, format `rigready-device-layout` v1, documented in `LAYOUT-FORMAT.md`) is a JSON file per device model: a canvas (1000 units wide), a list of **shapes** (rect, ellipse, polyline, text, each with a colour *role*), optional **group frames**, and one **control card** per DirectInput input (`button:20`, `axis:RX`, `hat:1:U`): a box with an optional printed label and an optional **pin** (a point on the picture; a straight line is drawn from the pin to the nearest edge of the card). A hat or four-way is a **cross**: a 3×3 grid of small cards around a hub.

Ten layouts are shipped, drawn with a small builder (`core/builtin/`): the Orion 2 stick with the F-16EX grip, the Orion throttle with the F-15EX handles, the MFD1 frame (one layout for the three product ids), the TPR pedals, the Virpil panel, the UFC1+HUD1, the ICP, the F-18 startup and takeoff panels, and the Fanatec base. Any other device gets a **generated** layout (`core/generate.ts`): axes as bars, hats as crosses, buttons in rows of eight. Controls bound but not on the layout are appended under "More controls".

`core/render.ts` draws a layout as one SVG: the shapes, then the cards (a `foreignObject` with the control number, the printed label, the action text fitted by shrinking from 14px to 10.2px and then shortening with an ellipsis), the pin lines, and a coloured stripe per kind of action. The same SVG is shown in the app (dark theme), printed (light), and rendered by the Render port into **768 × 1024 kneeboard pages** (light and night themes; `core/pages.ts`, `fontScale` 1.12, empty cards hidden). The trainer (`TrainerPicture.vue`) draws the same SVG with the text left off.

The **Edit layout** editor (`LayoutEditor.vue`) lets the user drag cards, pins and group frames, resize cards, rename the printed label, add or remove pins, add a photo or drawing behind everything (`background`, a data URL, with a strength slider), add controls that are not placed, and import a Joystick Diagrams SVG template (placeholders become cards). It cannot change the **shapes**: the drawing of the device itself is whatever the shipped layout contains, or nothing.

## 2. What is wrong (with evidence)

Looked at: `artifacts/screens/cheat-sheets-gallery/01-stick.png`, `02-throttle.png`, `07-centre-mfd.png`, `cheat-sheets-outputs/kneeboard-stick-{day,night}.png`, `kneeboard-throttle-day.png`, `kneeboard-left-mfd-{day,night}.png`, `tour-flying/10-cheat-sheets.png`, `cheat-sheets-editor/02-editor-arranged.png`.

1. **Shape fidelity.** The stick is a sixteen-point polygon with five circles: no head, no neck, no trigger, no paddle; it reads as a bottle. The throttle is two pills and a rectangle with "L" and "R". The shapes carry no information a user could not get from the device name, so they are decoration, and poor decoration.
2. **Label density and waste.** One card per input: the trim hat is nine cards in a 3×3 grid (a hub in the middle), the four-ways the same, so one physical control takes 312 × 196 units. On the stick kneeboard page the picture is 1242 units tall for 30 bound controls, two thirds of it empty cards, dashed outlines and a "More controls" frame with four cards floating in it.
3. **Leader lines that do not make sense.** A pin line goes from a dot on the drawing to the *nearest edge* of the card, so it arrives at an arbitrary point, often the card's top edge, and different cards' lines fan in at different angles (stick: the side button's line crosses the trigger's; the mini-stick's line runs under the weapon-release card). Most cards have no pin at all, so the reader cannot tell where the control is; the ones that have one sit beside controls without one.
4. **Text size at kneeboard scale.** The stick's canvas is 1242 units tall, so the page scales it by 0.73 and its 14px labels (× 1.12 for the kneeboard) come out at 11.4px on a 768-wide page; the night page's dim red on black makes that harder still. The empty cards and the grids are the reason: they force the canvas tall.
5. **What a user cannot fix.** The editor moves cards and pins but cannot draw: the shapes are not editable, there is no silhouette library, and a photo behind the cards is the only way to get a picture of a device that is not shipped. The photo option works but needs the user to take a flat photo and the cards still cover it.

Two things are right and should be kept: the **colour-by-kind** with the night-safe dashed patterns, and the **data model** that makes every card addressable (`data-control`) so the real device lights its label and the trainer can ask about it.

## 3. The proposal

**(a) A drawing per device, hand-tuned.** A *drawing* is a silhouette made of SVG paths with colour roles (so it works dark, on paper and at night), plus a list of **physical controls**: each with a name, a glyph (hat, four-way, button, stick, trigger, rocker, knob, key, axis), an anchor point on the drawing, which side its label goes on, and the DirectInput inputs it reports, each with a word for its direction ("↑", "IDLE", "2nd"). One hat is one control with eight inputs.

**(b) Automatic callouts.** Labels are not placed by hand. One block per physical control, in a column left and right of the drawing (and a row above and below for a bezel), a head line ("TMS · 4-way · 37–40"), one row per bound input with the direction word in bold and a square in the kind's colour. Blocks on a side are ordered as their controls run down the drawing and stacked so each sits as close to its control as its neighbours allow; where two leaders would still cross, the planner trades the blocks until none do. Every leader is anchor → one bend → the block's edge at mid-height. A kneeboard page can ask the drawing to **fill** the page's height, the columns giving way down to a minimum width. Inputs bound but not on the drawing are listed under it; nothing is ever left out.

**(c) A template format anyone can add.** The drawing is data (`rigready-device-drawing` v1, zod-validated, nothing runnable): paths, anchors, inputs. A community drawing is an SVG traced from a photo plus a JSON list of anchors; the editor can import it the way it imports a layout today. For a device nobody has drawn, a photo with anchors dropped on it is a valid drawing too (the photo as a `background`, as now).

**(d) Keep the editor** for what it is good at: checking which input is which by pressing it, dragging an anchor to where the control really is, and renaming. With callouts placed automatically, the editor no longer needs to move label cards at all.

### The prototype

(Since moved to `core/drawings/` and shipped; see section 6.) `src/features/cheat-sheets/core/drawings-v2/`: `silhouette.ts` (the format and its schema), `drawings.ts` (the F-16EX grip from behind, the throttle from above, the MFD1 frame), `callouts.ts` (the planner), `renderV2.ts` (the SVG, in the shipped themes and class names), `index.ts`. `drawingsV2.test.ts` lays the three devices out for the owner's F/A-18C bindings from the recorded rig and asserts: no two leaders cross, every block is on the page and none overlap, the drawing sits between the columns, every bound control appears, every anchor is on a drawn part of the device, text fits its block, `fill` only ever grows the drawing. With `RIGREADY_DRAWINGS_OUT=<folder>` the test also writes before/after HTML pages (the app's sheet in dark, the kneeboard in day and night); an offscreen Electron script (the same approach as the Render port) turns them into PNGs. The renders of 2026-11-07 are in the session's scratchpad, `drawings/before-*.png` and `after-*.png`.

What the renders show: the stick's sheet is 834 units tall instead of 1242 with the same 30 controls; on the kneeboard the drawing fills the page and the type is 13.4px instead of 11.4px (fontScale 1.3, which the blocks have room for); the trim hat is one block of eight rows beside a hat glyph on the head; every label has a leader; the MFD reads as a bezel with keys and corner rockers; the night pages keep the warm palette and dashed marks. The throttle, a wide device, leaves room at the bottom of a portrait page (its base switches could go into a bottom row instead).

## 4. Migration path

1. Ship the three drawings beside the layouts; `sheet.ts` picks a drawing when one matches the device, else the layout as now. Kneeboard, print and the trainer take the new SVG unchanged (same class names, same `data-control`), the live highlight too.
2. Draw the rest of the rig: the UFC, the ICP, the panels (bezels like the MFD: keys as `key` glyphs, switches as `rocker` or `switch`), the pedals, the Virpil panel, the Fanatec rim (a round rim with its buttons). About a day each for a credible silhouette; the panels are quick because they are rectangles with printed text.
3. Editor: "Edit drawing" replaces "Edit layout" for a device with a drawing: press a control to find its row, drag its anchor, rename it, mark it verified (clears the "?" that `assumed` shows). The card-dragging editor stays for layouts.
4. Import/export of drawings (`.rrdrawing.json`); a page on the website for community drawings, CC0 like the shipped ones.
5. Retire the generated card grid last: a device with neither a drawing nor a layout gets a generic silhouette (a box with the device name) and the callout list, which already reads better than rows of cards.

Risks: the hat numbering of the WinWing grips is still assumed (as the shipped layouts say); a drawing does not fix that, only pressing the buttons does. A drawing is per product id, like a layout, so two grips on the same base need two drawings (the F-18 grip is the next one to draw).

## 5. Open questions for the owner

- **The look.** Flat schematic silhouettes (the prototype) or shaded, more realistic ones? Flat prints and night-renders well and takes an afternoon per device; realistic needs an illustrator or a traced photo per device.
- **The view.** The stick is drawn from behind (the pilot's view: hats on the head, the trigger a bump at the edge, the front button dashed). Alternatives: a three-quarter view, or an inset of the front face.
- **The template format.** The prototype's JSON (paths + anchors) is enough for a tool to write; for people, an SVG with `id="button:20"` on an element at each anchor would be easier to draw in Inkscape. Supporting both is cheap (the SVG import becomes a converter, like the Joystick Diagrams one).
- **How much for 2.0.** (i) Nothing: ship as is, note it as known. (ii) The three drawings for the Hornet rig behind the existing data model, the editor untouched (about two days including the e2e evidence and the manual pages). (iii) All ten devices plus the drawing editor and import (a week or more). My recommendation is (ii) for 2.0 and (iii) for 2.1: the three devices are what the owner looks at most, and the risk is contained to the cheat-sheets feature.
- **Numbers on labels.** The prototype keeps the DirectInput numbers in the head line ("Pickle · 20"), not on every row. Keep them, or drop them for a cleaner page and leave them to the tooltip and the bindings page?

## 6. What shipped in 2.0

The owner chose to ship the drawings in 2.0. What changed against the prototype, and why:

- **One place decides the picture.** `core/picture.ts` (`pictureFor`, `renderPictureSvg`) is used by the sheet on screen, the pop-out, the trainer, the PDF and the kneeboard pages. A device with a shipped drawing is drawn from it. A device whose owner saved a layout of cards keeps it exactly (a layout without the new `drawing` field is drawn as cards, so every layout saved in 1.x keeps the places its owner gave the cards). A device with a shipped layout but no drawing yet is drawn as cards. A device with neither (the old generated grid) is now a **list**: one block per group of controls (the axes, each hat, buttons in runs of eight; a run with nothing bound is one line), in two columns, with no picture to point into. It is shorter and reads better than rows of empty cards.
- **Drawings shipped:** the Orion 2 stick with the F-16EX grip, the Orion sticks with the F/A-18 grip (base 1 and base 2; matched by the name the grip reports, "F18 GRIP", since its product id is not in our fixtures), the Orion throttle with the F-15EX handles, the MFD1 frames. The F/A-18 grip is numbered as WinWing's own DCS profile numbers it (the `.diff.lua` templates DCS ships), so its labels carry no "?". The F-16 grip's CMS now carries 31 to 35 (press, forward, right, aft, left), as WinWing's profile puts the Hornet's sensor switch there; the owner's radar elevation (32, 34) is now on it instead of in "More controls". Still drawn as cards: the TPR pedals, the Virpil panel, the UFC1 with HUD1, the ICP, the F-18 startup and takeoff panels and the Fanatec base. They are the next ones to draw; each is data in `core/drawings/builtin.ts`. **This bullet is the state of early November. The owner's sitting of 12 November found the stick and throttle drawings wrong; section 8 says what replaced them and what else is drawn now.**
- **Text as large as the page allows.** A kneeboard page and a printed page try text sizes from large to small (kneeboard 1.12 to 1.55, print 1.0 to 1.3), each with the drawing grown to the page and at its own size, and take the largest whose label columns end about level with the drawing. Columns that run on far below the drawing are what made leaders long and steep; this keeps them short. The stick's kneeboard text is now about 15 px on a 768 px page (it was 11.4 px).
- **Rows above and below** (the MFD's keys, the throttle's base switches) sit as close under their control as their neighbours allow and are never wider than a column, so a lone block sits by its control.
- **No crossings, also in rows.** Columns and rows both trade blocks until no two leaders cross. The unit tests check the owner's Hornet sheet (stick, F/A-18 grip, throttle, MFD) with empty controls shown and hidden, at the app's size and as laid out for a kneeboard page.
- **The editor.** "Edit drawing" opens a device with a drawing on it: click a label or a dot, drag the dot to where the control really is (arrow keys nudge it), choose the side its label goes on, rename it, put it back. "Use a photo of the device" puts a photo in place of the silhouette, with a strength slider. "Arrange cards myself" goes back to the card layout (the 1.x editor, unchanged). All of it is kept in the user's layout file for the device (`drawing`: `anchors`, `sides`, `names`), saved through the same store, so Share as file, Import and Discard work as before.

### User-made drawings (shipped, small)

- **From a photo.** For a device RigReady has no drawing of, the card editor offers "Make a drawing from a photo". It makes a drawing of the user's own (`drawing.custom` in their layout): the photo, with a dot for every axis and hat the device reports and every button that does something, set out in a grid for the user to drag onto the real controls; more controls can be added from "Not on the drawing". The labels then place themselves around the photo like a shipped drawing's.
- **Import a drawing file.** Import accepts a `rigready-device-drawing` JSON file (the format in `LAYOUT-FORMAT.md`: paths and/or a photo as a data URL, plus the controls with their anchors) as well as a layout file. It is checked like any import (the schema, an anchor off the drawing, an input on two controls, the device it is for) and becomes the user's own drawing of the device. Share as file exports the layout with the drawing in it, which Import reads back.
- Everything is stored through the cheat-sheet store in RigReady's data folder; nothing outside it is written except where the user asks to save a shared file (through FileStore, as before).

### Left for later

- An **SVG with ids** (`id="button:20"` on an element at each control, drawn in Inkscape) as an import format: a converter like the Joystick Diagrams one, about half a day.
- **Drawing the remaining shipped devices** (pedals, the Virpil panel, the Fanatec base): about a day each for a credible silhouette. The panels, the UFC and the ICP are drawn since 12 November (section 8).
- A **community page** for drawings on the website.
- What is still assumed on a shipped drawing is listed in section 8; nothing else carries a "?".

## 7. Drawings of the popular Thrustmaster and Saitek controllers (2026-11-11)

**Reviewed on 12 November (section 8): the Warthog stick and the T.16000M keep their drawing; the Warthog throttle's and the X52 Pro's were withdrawn, and those two devices show as their named list again.** The text below is the record of what was drawn on the 11th.

Thrustmaster is the biggest flight brand in the market research, and the HOTAS Warthog, the T.16000M and the Saitek (Logitech) X52 Pro are the most common sticks there. Each already had a named map (`core/known/`, `device-control-names.md`); now each has a drawing in the same flat schematic style as the WinWing ones, in `core/drawings/thrustmaster.ts` and `core/drawings/saitek.ts`, CC0 and drawn from scratch (no vendor artwork, no photos).

**One source of truth for names and numbers.** A drawing's controls are made from the device's named map (`placeKnown` in `core/drawings/shapes.ts`): only the place, the label side, the marker and whether the control is on a face the view does not show are set per drawing. So a drawing cannot name a control differently from the list or put an input somewhere the map does not, and the test fails if a named control has no place.

**Where each control is, and the sources.**

- **Warthog stick**, seen from behind like the WinWing grips. The Warthog copies the A-10C grip, and the DCS A-10C flight manual (shipped with DCS, `Mods/aircraft/A-10C/Doc/DCS A-10C Flight Manual EN.pdf`, figure 69 "Control Stick", p. 87) shows it from behind and from the side: weapon release (S2) at the top left of the head, trim hat (H1, with its NOSE DOWN ring) at the top right, TMS (H2) and DMS (H3) side by side below them, the CMS (H4) standing out of the left side under the head, the master mode button (S1) on the spur at the right of the head, the nosewheel steering button (S3) low on the left of the handle, the trigger (TG1/TG2) at the front. Thrustmaster's manual (support.thrustmaster.com, "HOTAS Warthog") has the same layout as a diagram; community posts put the paddle (S4) at the bottom front with S3 just above and behind it (forum.dcs.world topics 102582 and 56499). Trigger and paddle are on the front, so they are drawn as the bumps they make at the edge, the paddle dashed.
- **Warthog throttle**, from above with the pilot at the bottom. Figure 70 of the same manual ("Throttles", p. 90) places the handle switches: mic switch, speed brake and boat switch down the inboard side of the left handle under the thumb, the china hat at its front, the pinky switch at its back, the left throttle button on it; the slew control and the coolie hat on the right handle. The base panel (fuel flow, engine operate, APU, gear horn silence, flaps, EAC, radar altimeter, autopilot) is on the right of the base in Thrustmaster's product photos; the drawing sets its switches out in two columns, which is approximate, and the sheet says so ("drag a dot in Edit drawing if one is off").
- **T.16000M**, from behind: the hat on top of the head with three buttons round it, the trigger at the front, a bank of six buttons on either side of the base and the throttle slider at its front left (Thrustmaster's T.16000M manual, support.thrustmaster.com/en/product/t16000m-en). Neither the manual nor any public map says which key of a bank, or which of the three head buttons, is which number, so each bank and the head buttons are one control with one anchor, as the named list has them.
- **X52 Pro**, stick and throttle in one drawing, because they are cabled together and report to Windows as one device (06A3:0762): the throttle on the left, the stick on the right, both from behind. FlightGear's X52 Pro map (gitlab.com/flightgear/fgdata, `Input/Joysticks/Saitek/X52-pro.xml`) names the upper hat on the stick (20 to 23), the lower one as the POV, the throttle's front hat (24 to 27), the mode switch, the T1 to T6 toggles on the stick base and the D, E and i buttons on the throttle; the places on the grips are from product photos and are approximate, which the sheet says. The rotary dials, the slider and the mouse nub are not in the named map, so they are not anchored; anything bound to them is listed under the drawing.

**Layout.** A dense panel (the Warthog throttle's) made the right column run on far below the drawing, and the pairwise trading in the column planner could not untangle the steep leaders. `placeColumn` now also tries ordering a column as if the controls slid onto it along a slope (anchor y plus a multiple of the distance to the column) and keeps the first order with no crossing. The WinWing drawings are laid out exactly as before (the first order tried is the old one).

**Evidence.** `drawings.test.ts` ("the drawings of the popular Thrustmaster and Saitek controllers"): every named control is anchored with the map's name and inputs, on a drawn surface; for DCS's Hornet defaults (the scenario `cheat-sheets-known-devices`) and for every input bound, with empty controls shown and hidden, at the app's size and filled for a kneeboard page, no two leaders cross and every block is on the page; the user's changes and a layout of cards still win. The e2e `cheat-sheets-known-devices.e2e.ts` shows each on the sheet and on its kneeboard page by day and by night. Before and after pictures (the named list, the drawing, the kneeboard pages): `rigready-ops/drawings/compare-warthog-stick.png`, `compare-warthog-throttle.png`, `compare-t16000m.png`, `compare-x52-pro.png`, written by the test with `RIGREADY_DRAWINGS_OUT` set.

## 8. Every drawing checked against a real map (2026-11-12)

At the rig on 12 November the owner could not find controls on his own stick and throttle from their drawings: controls were in the wrong places and some were not on the drawing at all. Three rules came out of it.

1. **A device has a drawing only where the drawing is known to match the real device.** Anything else falls back to cards or to a list that claims no places.
2. **The makers' pictures are looked at, never copied.** Every outline is RigReady's own, in RigReady's flat style, CC0. Which number is which control is a fact and may be used; a maker's line art, photo or screen picture is theirs and is not in this repository.
3. **`assumed` (the "?" on a label) is for exactly the controls whose numbers or directions no real source settles.** It is not a general hedge.

### Sources

- **The maker's number map.** WinWing's own configuration program has a test screen for each device: a picture of the device on which the number that the device reports lights at the control that sends it. That gives both the number and the place.
- **The game's default profiles.** DCS ships an input profile per aircraft for each device its maker supports (`Mods/aircraft/<aircraft>/Input/<aircraft>/joystick/<device name>.diff.lua` in the game's folder). A profile says what a number does in the aircraft, which names the control ("TDC forward" is the forward push of the cursor control).
- **The owner's own bindings and presses.** The bindings on the recorded rig, and what the owner pressed and said at the rig on 12 November.
- **The DCS A-10C flight manual** (shipped with the game), whose figures 69 and 70 show the grip and the throttle the Warthog copies.

### What each drawing was checked against

| Device | Checked against | What changed | Still assumed |
|---|---|---|---|
| WinWing Orion 2 stick with the ViperAce (F-16EX) grip, 4098:BEA8 | The maker's test screen for the grip, the game's default profiles for the grip, the owner's bindings and presses | Drawn again from nothing. Every input the stick reports is on it (42 buttons, the hat, six axes), each control in its own place. The old drawing had 12 controls, nearly all marked assumed and named for what they do in one aircraft, with those names on the wrong hats (its "TMS" was the right hat, its "CMS" the centre hat, its "DMS" the left side hat). The top left hat, the right side hat and the buttons of the top front lever were not on it. | Which way is which on the right side hat (14 to 18) |
| WinWing Orion throttle with the F-15EX handles, 4098:BD26 | The maker's test screens for the base and for each handle, the owner's bindings and presses | Drawn again from nothing, in four views (front of the left handle, the base from above, the thumb side of the right handle, the front of the right handle), because no single view shows every control. Every input is on it except buttons 45 to 49. The old drawing was one view from above with 27 of the 62 buttons on it, handle controls drawn on the base ("Base switches", "Base knobs") and names taken from one aircraft. | Left and right on the two front hats (51 to 55, and 28, 29, 32 to 34) |
| WinWing Orion stick (base 1 and base 2) with the F/A-18 grip | The maker's number map for the grip, the game's Hornet profiles for both bases | Drawn again. The old one had button 1 as the trigger's first stage (it is the press of the trim hat; the trigger is 9 and 10), showed the small switch under the trim hat as one button (8 on the first base, 21 on the second) where it has five (8 and 18 to 21), left out button 15, and named controls for what they do in the Hornet. One drawing is now right on both bases. Not on the owner's rig, so nobody has pressed it for RigReady. | Nothing |
| WinWing MFD1 frames, 4098:BEE0, BEE1, BEE2 | The maker's test screen for the frame, the game's Hornet and F-16C profiles for it | The key numbers were right. Two rockers had the wrong name (43 and 44 are DAY / NGT, not GAIN; 10 and 11 are GAIN, not BRT); the knob's press (48) and the switch on the right side edge (45 to 47) were not on it. The 16 numbers between the keys belong to no key. | Nothing |
| WinWing UFC1 with HUD1, 4098:BEDE | The maker's test screens for both parts, the game's Hornet profile | New drawing (was cards). One drawing, as the two report as one device. 60 of its 128 buttons belong to a control; the rest, and one slider axis, to none that any source shows. | Nothing |
| WinWing ICP, 4098:BF06 | The maker's test screen (the game ships no profile for it) | New drawing (was cards). Every input is on it. The cards had the four-way switch and the DRIFT C/O switch numbered one too low (21 is the press of the four-way switch, its ways are 22 to 25; DRIFT C/O is 26 to 28); both are corrected in the cards too. | Nothing |
| WinWing F/A-18 startup panel, 4098:BE03 | The maker's test screen, the game's Hornet profile | New drawing (was cards). Every input is on it. The two ends of the GEN TIE switch are named by place (up, down), because the panel and the game word them differently. | Nothing |
| WinWing F/A-18 take-off panel 2, 4098:BF05 | The maker's test screen (the game's profile is for the first take-off panel, whose numbers differ) | New drawing (was cards). 41 of its 64 buttons belong to a control. The cards showed the PROBE switch as an unnamed three-way switch; it is named in the cards too. | Which move of the brake handle gives which of 38 to 41 |
| Thrustmaster HOTAS Warthog joystick, 044F:0402 | The game's A-10C profile for the stick (every number), figure 69 of the A-10C manual (every place) | Nothing: it matches. | Nothing |
| Thrustmaster T.16000M, 044F:B10A | The game's profile for the stick (16 buttons, one hat, four axes), Thrustmaster's manual | Nothing. The drawing claims only the two banks of the base and the group of head buttons, not which key is which. | Nothing |
| Thrustmaster HOTAS Warthog throttle, 044F:0404 | The game's A-10C profile for the throttle (every number agrees), figure 70 of the A-10C manual | **Drawing withdrawn.** It had the mic switch, speed brake, boat switch and china hat on the left handle; the figure shows that thumb cluster on the right handle. The places of the panel switches were approximate, and which handle carries the slew control and the coolie hat could not be settled here. The device shows as its named list. | Not drawn |
| Saitek / Logitech X52 Pro, 06A3:0762 | The game's A-10C profile for it (every number it binds agrees) | **Drawing withdrawn.** Its places came from product photos and were called approximate on the sheet; no source on this PC confirms them, and the rotaries, the slider, the mouse buttons and the MFD keys were not on it. The device shows as its named list. | Not drawn |

Withdrawing a drawing loses nothing a user can rely on: the named list keeps every name and number, which are confirmed, and drops only the places, which were not. Both drawings are in the history of this repository for whoever redraws them from the makers' manuals.

### A press never lights nothing

A drawing shows the controls its sources place. A device can report more buttons than that (the throttle's 45 to 49; 68 of the UFC's 128). With "Unbound controls" on, every input the device reports that is neither on the drawing nor bound gets a small cell with its number under the drawing ("More controls · not on the drawing"). The cell is a control like any other to the page: it lights when pressed and can be selected. So whatever the owner presses, something on the sheet answers, and a number that turns out to belong to a real control is found by pressing it.

### Names

A drawn device names its controls from the drawing, everywhere: the label blocks, the "by action" index and the selected control's detail. A control is named by where it is and what it is ("Left side hat", "Top front lever"), with the short name the real aircraft's grip gives it in brackets where owners know it by that (TMS, DMS and CMS on the F-16 grip). A name does not say what the control does, because that depends on the aircraft: the grip's red button is "Red button", not "Pickle".

### What is left to settle by pressing

One press each at the rig settles these; none blocks a user, since a "?" label says to press and see which row lights up.

- The directions of 14 to 18 on the ViperAce grip's right side hat.
- Left and right on the F-15EX throttle's two front hats.
- What, if anything, presses the throttle's buttons 45 to 49.
- Which end of the throttle's left handle knob gives 60 and which 62 (the labels say "one end" and "other end").
- That the throttle's wheel gives 25 when rolled up and 27 when rolled down. The maker's screen shows 25 above 27, and the owner has radar elevation up on 25, so the drawing says so without a "?".
- Which move of the take-off panel's brake handle gives which of 38 to 41.

### What a set of common controllers would take

Section 7's estimate holds: about a day for one device, most of it finding a source that settles every place. The honest order is the source first, the drawing second: a maker's manual with a numbered diagram of every face (Thrustmaster publishes one for the Warthog and the T.16000M; Logitech for the X52 and X56; VKB and Virpil for their grips), checked against the game's default profile for the numbers. A device with no such diagram stays a named list. The first two to redraw are the ones withdrawn here.

### What a photo with annotations would take

It exists in a small form (section 6): "Make a drawing from a photo" puts the user's photo in place of the outline with a dot per control to drag into place, and the labels place themselves round it. What it lacks to be the easy road for a device RigReady has not drawn: a way to place a dot by pressing the control (press, then click where it is on the photo) instead of dragging dots from a grid; several photos for one device (a grip has a back, a front and sides); grouping the four ways of a hat into one control while placing; and a way to share the result without sharing the photo's background.
