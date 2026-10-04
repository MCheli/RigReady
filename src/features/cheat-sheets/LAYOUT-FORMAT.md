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

Controls that do something in the chosen aircraft but are not in the layout are added below it under "More controls", so a sheet never leaves a binding out.

## Joystick Diagrams templates

RigReady ships none of the Joystick Diagrams templates (that project is GPL-2.0 and the licences of its templates are not stated). If you have one of its SVG templates, "Import" converts it: the drawing becomes the background, and every placeholder text (`BUTTON_12`, `AXIS_X`, `AXIS_SLIDER_1`, `POV_1_U`) becomes a control at the same place. Modifier placeholders are skipped and reported. Check the result in the editor and save it.
