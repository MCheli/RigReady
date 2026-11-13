# RigReady device layout format (version 1)

A device layout says where the controls of one controller model sit on a picture of it. RigReady uses it to draw cheat sheets. One layout is one JSON file, usually named `<VID>-<PID>.rrlayout.json`. The layout editor writes these files, "Share as file" exports one, and "Import" reads one. The schema is `DeviceLayoutSchema` in `core/layout.ts`; a file that does not fit it is refused with the reason.

A layout contains only rectangles, shapes, text and an optional picture. Nothing in it can run. Layouts you share should say how they may be used (`license`); the ones RigReady ships are `CC0-1.0`.

## Example

```json
{
  "format": "rigready-device-layout",
  "version": 1,
  "name": "Thrustmaster TPR pedals",
  "match": { "vendorId": "044F", "productIds": ["B68F"] },
  "author": "RigReady",
  "license": "CC0-1.0",
  "notes": "Two toe brakes and the rudder axis.",
  "canvas": { "width": 1000, "height": 560 },
  "shapes": [{ "type": "rect", "x": 150, "y": 40, "w": 260, "h": 330, "r": 28, "role": "body" }],
  "groups": [{ "label": "Brakes", "x": 140, "y": 30, "w": 720, "h": 350 }],
  "controls": [
    { "kind": "axis", "input": "axis:Y", "x": 165, "y": 160, "w": 230, "h": 78, "label": "Left toe brake" },
    { "kind": "axis", "input": "axis:Z", "x": 350, "y": 452, "w": 300, "h": 78, "label": "Rudder" },
    { "kind": "button", "input": "button:1", "x": 20, "y": 20, "w": 120, "h": 54, "pin": { "x": 300, "y": 200 } },
    {
      "kind": "cross",
      "label": "Trim hat",
      "inputs": { "U": "hat:1:U", "R": "hat:1:R", "D": "hat:1:D", "L": "hat:1:L" },
      "x": 600, "y": 380, "w": 312, "h": 170
    }
  ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `format`, `version` | Always `"rigready-device-layout"` and `1`. |
| `name` | What the layout is of. |
| `match` | The devices it is for: USB vendor id and one or more product ids, four hex digits each. |
| `author`, `license`, `notes` | Optional. `notes` is shown above the sheet (for example "button order on the grip is assumed"). |
| `canvas` | Size of the drawing in its own units. Coordinates of everything else are in these units. Shipped layouts are 1000 wide, which makes label text the same size on every sheet. |
| `background` | Optional photo or drawing behind everything: `image` (a `data:image/png`, `jpeg`, `webp` or `svg+xml` base64 data URL, about 6 MB at most), `x`, `y`, `w`, `h`, `opacity` (0.05 to 1). Links are not allowed. |
| `shapes` | The drawing of the device. Each has a `role` (`body`, `panel`, `screen`, `line`, `accent`) that picks its colour from the theme, so one layout works on a dark screen, on white paper and on a night kneeboard page. Types: `rect` (`x y w h r`), `ellipse` (`cx cy rx ry`), `line` (`points`: x1 y1 x2 y2 ..., `closed`), `text` (`x y text size`, centred on x). |
| `groups` | Labelled frames around controls that belong together: `label`, `x`, `y`, `w`, `h`. A control inside a frame carries the frame's name ("FLAP AUTO"). |
| `controls` | The label cards. See below. A control may appear only once in a layout. |
| `drawing` | Optional. The device is drawn from a drawing rather than from the cards, with the changes the user made in the editor. See "Drawings" below. A layout without it is drawn as cards. |

## Controls

A control is named the way DirectInput numbers it, whatever a game calls it:

- `button:12` is Button 12 (the first button is 1; DCS calls it `JOY_BTN12`).
- `axis:X`, `axis:Y`, `axis:Z`, `axis:RX`, `axis:RY`, `axis:RZ`, `axis:SLIDER1`, `axis:SLIDER2`.
- `hat:1:U` is hat 1 pushed up; directions are `U`, `UR`, `R`, `DR`, `D`, `DL`, `L`, `UL`.

| `kind` | Fields | Drawn as |
|---|---|---|
| `button` | `input`, `x`, `y`, `w`, `h`, optional `label`, optional `pin` | A card with the control's number, the label and what it does. |
| `axis` | the same | A card with a travel bar; the bar follows the real axis in the app. |
| `cross` | `inputs` (any of `U UR R DR D DL L UL C`, each a control id), `x`, `y`, `w`, `h`, optional `label`, optional `pin` | A hat or multi-way switch: one small card per direction around a hub (`C` is the press in the middle). The inputs may be hat directions or plain buttons, since many grips report their switches as buttons. Diagonals are drawn only when something is bound to them. |

`label` is what is printed on the device next to the control ("OSB 6", "BATT"). `pin` is the spot on the drawing where the control is; a line is drawn from there to the card.

Controls that do something in the chosen aircraft but are not in the layout are added below it under "More controls", so a sheet never leaves a binding out. On a drawing, with "Unbound controls" on, every input the device reports that is neither on the drawing nor bound is there too, one small cell each with its number, so a press always lights something.

## Joystick Diagrams templates

RigReady ships none of the Joystick Diagrams templates (that project is GPL-2.0 and the licences of its templates are not stated). If you have one of its SVG templates, "Import" converts it: the drawing becomes the background, and every placeholder text (`BUTTON_12`, `AXIS_X`, `AXIS_SLIDER_1`, `POV_1_U`) becomes a control at the same place. Modifier placeholders are skipped and reported. Check the result in the editor and save it.

## Drawings (format `rigready-device-drawing`, version 1)

A drawing is a silhouette of one controller model with its physical controls marked on it. The labels are not part of it: RigReady places one label block per physical control in a column left or right of the drawing (or a row above or below), with a leader line from the control to the block, and makes the text as large as the page allows. The schema is `DeviceDrawingSchema` in `core/drawings/silhouette.ts`. RigReady ships drawings for the WinWing Orion 2 stick with the F-16EX (ViperAce) grip, the Orion sticks with the F/A-18 grip, the Orion throttle with the F-15EX handles, the MFD1 frames, the UFC1 with its HUD1, the ICP, the startup panel and take-off panel 2, and for the Thrustmaster HOTAS Warthog stick and throttle, the T.16000M and the TWCS throttle (`core/drawings/builtin.ts`, CC0). A device is drawn only where the picture is known to match the real thing: what each one was checked against is in `docs/research/controller-drawings.md`. Other devices with a shipped layout are drawn as cards; a device with neither is shown as a list of its controls, named as the maker names them where RigReady knows the device.

```json
{
  "format": "rigready-device-drawing",
  "version": 1,
  "name": "My button box",
  "match": { "vendorId": "1234", "productIds": ["ABCD"], "names": [] },
  "size": { "width": 500, "height": 380 },
  "image": "data:image/jpeg;base64,...",
  "paths": [],
  "controls": [
    { "id": "red", "name": "Red button", "glyph": "button", "at": { "x": 120, "y": 90 }, "side": "left",
      "inputs": [{ "id": "button:1" }] },
    { "id": "hat", "name": "Hat", "glyph": "hat", "at": { "x": 380, "y": 200 },
      "inputs": [{ "id": "hat:1:U", "tag": "↑" }, { "id": "hat:1:D", "tag": "↓" }] }
  ]
}
```

| Field | Meaning |
|---|---|
| `match` | `vendorId`, and `productIds` and/or `names` (parts of the name the hardware reports, any case, for a grip whose product id is shared or not known). |
| `size` | The drawing's own units; `at` and `paths` are in them. |
| `paths` | SVG path data (absolute `M L H V C Q A Z`) with a colour `role`: `body`, `panel`, `screen`, `line`, `accent`, `shade`, `key`; `dashed` for a face the view does not show. |
| `image` | Optional photo or traced picture (`data:image/png`, `jpeg`, `webp` or `svg+xml`, about 6 MB at most), stretched over `size`. With one, `paths` may be empty. |
| `views` | Optional, up to 6. Several photos of the device, each a named view: `name` ("Top", "Back", up to 40 characters), `image` (as above), and its box on the drawing `x`, `y`, `w`, `h`. A control is on the view its `at` lies in. With more than one view the names are printed over the photos. With `views`, `image` is left out and `paths` may be empty. |
| `texts` | Text printed on the device: `x`, `y`, `text`, `size`. |
| `controls` | The physical controls: `id`, `name`, `glyph` (`hat`, `switch`, `button`, `stick`, `lever`, `rocker`, `knob`, `key`, `axis`, `slide`, `axes`, `none`), `at`, optional `side`, `inputs` (control ids as above, each with an optional `tag`, the word its row starts with: "↑", "IDLE", "2nd"), `hidden` (drawn dashed), `assumed` (which number or direction is which is not confirmed from a real source; the label shows "?". Keep it for exactly those controls). An input may be on one control only. |
| `columnWidth` | Room for the label columns, 120 to 400 canvas units (default 300). |

In a layout, `drawing` holds the user's changes to a drawing: `anchors` (where a control really is, by control `id`), `sides`, `names`, and `custom`, a whole drawing of their own. The editor writes it, and "Import" accepts a drawing file as well as a layout file.

### A drawing made from the user's photos

"Use my photo" makes a `custom` drawing whose picture is one or more `views`. The user presses a control on the device and clicks its place on the photo; that adds one entry to `controls`:

- A button or an axis is one control with one input, called "Button 5" or "Slider 1" until it is given a name.
- A hat Windows reports is one control with its four ways (`hat:1:U`, `R`, `D`, `L`).
- A hat that reports buttons is one control too: "Place a hat" asks for each way and for its press in turn, and they become the `inputs` of one control (tags "↑", "→", "↓", "←", "press").
- On a model RigReady knows the controls of by name, a press gives the whole control with its maker's name and all its ways.

Every photo is 500 units wide, the photos are one under the other, and `size` follows them. A photo is redrawn as a JPEG no larger than it needs to be before it is stored, so the file a phone made is not kept. The layout file with the photos in it is in RigReady's data folder; nothing is sent anywhere. "Share as file" writes the same drawing, photos included, to a file the user chooses.

A photo drawing is useful half-done. What the device reports, or what is bound on it, and has no place on a photo yet is listed under the photos ("More controls · not placed on a photo yet"), so nothing is left off the sheet and a press always lights something. A drawing must have at least one control, so photos with nothing placed yet cannot be saved.
