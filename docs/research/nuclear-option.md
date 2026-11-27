# Nuclear Option: where it is, where it keeps its settings, and how its bindings are stored

Research date: 2026-11-26. Machine: the owner's rig, with Nuclear Option installed through Steam (build 26327221, `build-hash.txt` 3f729f837227) and last played in March 2026 (game version 0.32 by its own first-start flag).

The marks: **[V]** verified on this machine, **[W]** from the web with the URL, **[I]** inferred from verified data, **[?]** unknown.

Everything here was learned read-only: by listing folders and registry value names, from copies of the game's registry values in a scratch folder, and from copies of parts of the game's own data files. Nothing was written to the game's folders or registry key, and the game was not started.

## The short answer

- **Found and launched like any Steam game.** Steam app 2168680, program `NuclearOption.exe` in the game folder. The game module (`src/features/games/nuclear-option/module.ts`) does this today.
- **Its settings and bindings are registry values, not files.** The game is a Unity game and keeps everything in Unity's PlayerPrefs, which on Windows is `HKEY_CURRENT_USER\Software\Shockfront\NuclearOption`. There is no settings file to back up. RigReady's backup works on files, and its registry port is read-only, so the module offers nothing for backup and says so.
- **The bindings can be read.** They are stored by the Rewired input library as one XML document per controller and map category, in a format that is plain to read. The action names are in the game's data files. Reading them (stage 2) needs no change outside a feature folder.
- **One controller button can be bound, moved or cleared (stage 3).** The value is replaced through `FileStore`, which got an address for a registry value for this (`src/core/files/registryValues.ts`): a backup first, the Safety page, Undo. The game showed a binding RigReady wrote, left it alone, and Undo put the saved bindings back byte for byte (section 7).

## 1. The install

- Steam app id **2168680**, name "Nuclear Option", type game, "Developed and published by Shockfront Studios Pty Ltd." **[W]** `https://store.steampowered.com/api/appdetails?appids=2168680&filters=basic`
- Installed at `<Steam library>\steamapps\common\Nuclear Option`, manifest `appmanifest_2168680.acf` with `installdir` "Nuclear Option". **[V]**
- The folder holds `NuclearOption.exe`, `UnityPlayer.dll`, `UnityCrashHandler64.exe`, `NuclearOption_Data`, `MonoBleedingEdge`, `build-hash.txt` and `steam_appid.txt`. **[V]**
- The process that means the game runs: `NuclearOption.exe`. **[V]** Steam's own `gameprocess_log.txt` names it as the tracked process of app 2168680 (with `UnityCrashHandler64.exe` beside it), and the proof below saw it.
- After a game update Steam may show the game's licence agreement before it starts it (its log says "LaunchApp waiting for user response to ShowEula"). **[V]** on 26 Nov 2026. Until the user answers it in Steam nothing runs; RigReady's Play page says "Waiting for Nuclear Option to start" for as long as that takes, and the same launch request goes through once it is answered.
- Whether the game is sold outside Steam is not known. **[?]** PCGamingWiki refused the request (HTTP 403), so nothing here comes from it. A copy from elsewhere is found through **Choose folder…**.

## 2. Files

- `%USERPROFILE%\AppData\LocalLow\Shockfront\NuclearOption` (Unity's persistent data folder) holds `Player.log`, `Player-prev.log`, `com.unity.addressables` (a cache) and `TempMissions\CurrentMission` (the mission being edited). **[V]** None of it is a setting. The module lists the folder as a location and offers no file for backup.
- Where missions the player saves in the mission editor go was not seen on this PC (none were saved). **[?]**
- No Steam Cloud folder (`userdata\<account>\2168680`) and no folder under Documents exist on this PC. **[V]**

## 3. The registry key

`HKEY_CURRENT_USER\Software\Shockfront\NuclearOption` holds 122 values on this PC. **[V]** Unity writes every PlayerPrefs entry as one value named `<key>_h<number>`; integers and floats are `REG_DWORD` (floats as 8 bytes), strings are `REG_BINARY`, UTF-8 with a trailing zero byte. **[V]** Unity's documentation gives the path pattern `HKCU\Software\<company>\<product>` **[W]** `https://docs.unity.com/en-us/engine/current/script-reference/unityengine/playerprefs`; it describes the `_h` suffix only for the editor, but the built game on this PC uses it too. **[V]**

Three kinds of value:

1. **Unity's own** (`Screenmanager Resolution Width`, `UnityGraphicsQuality`, …): window and quality.
2. **The game's options** (`ThrottleUseNegative`, `InvertCollective`, `UseTrackIR`, `VirtualJoystickSensitivity`, `ViewSensitivity`, `UnitSystem`, `DefaultFoV`, …).
3. **Rewired's save data**, 70 values whose key starts `RewiredSaveData`: the bindings, the calibration and the controller assignments. Section 4.

## 4. The bindings (groundwork for stage 2)

The game uses Rewired (`NuclearOption_Data\Managed\Rewired_Core.dll`) with its PlayerPrefs store. **[V]** Rewired's documentation says what is saved (bindings for each controller map of each player, joystick calibration, input behaviours, optionally controller assignments), that it is loaded on start and whenever a controller is attached, and saved when the game calls Save or a controller is disconnected. **[W]** `https://guavaman.com/projects/rewired/docs/UserDataStore.html` It does not document the key names or say what happens to values edited while the game is closed. **[?]**

### The keys

Each key is `RewiredSaveData`, then `|name=value` pairs. **[V]**

| dataType | Other parts of the key | Value |
|---|---|---|
| `ControllerMap` | `playerName=Player0`, `kv=2`, `controllerMapType` (`JoystickMap`, `KeyboardMap`, `MouseMap`), `categoryId`, `layoutId=0`, `hardwareGuid`, and for a joystick `hardwareIdentifier` and `duplicate` | An XML document: the bindings of one controller in one map category |
| `ControllerMap_KnownActionIds` | the same | The action ids the game had when the map was saved, comma separated |
| `CalibrationMap` | `controllerType=Joystick`, `hardwareIdentifier`, `hardwareGuid` | XML: dead zone, zero, minimum, maximum, invert and sensitivity per axis |
| `InputBehavior` | `playerName` (`System`, `Player0`), `id` | XML: sensitivity and digital-axis settings of one behaviour |
| `ControllerAssignments` | none | JSON: which joysticks each player has, each with the controller's instance GUID and its `hardwareIdentifier` |

### How a controller is identified

For every controller on this rig `hardwareGuid` is all zeros (Rewired has no definition of its own for it) and `hardwareIdentifier` is, with no separators: `WindowsRawInput`, the product name with its spaces removed, the USB product id in decimal, and the DirectInput product GUID (`<pid><vid>-0000-0000-0000-504944564944`, hex). **[V]** on eleven controllers. For example a device named "T-Pendular-Rudder" with product id B68F and vendor id 044F is `WindowsRawInputT-Pendular-Rudder46735b68f044f-0000-0000-0000-504944564944`.

**A later build writes the identifier another way.** After the game ran on 26 Nov 2026 (build 26327221; the values above were from March), every controller it saw had a new map saved under a shorter identifier: `WindowsRawInput`, the compact name, then the product id and the vendor id as four upper-case hex digits each (`WindowsRawInputT-Pendular-RudderB68F044F`), with no decimal number and no GUID. **[V]** on eleven controllers. The game's `ControllerAssignments` value names controllers by the shorter form. **[V]** Most of the March values were gone, but not all: one controller kept its March map for the Game category beside the new one, and the pedals kept their empty March maps for the other three categories. **[V]** RigReady reads both forms, and where both are there for one controller and one map category it shows the later one only. **[I]** that the game reads the later one: its assignments name it, and for the ten controllers with one map the controls screen agreed with it.

So a map belongs to a model of controller, not to one unit: nothing in the key is an instance GUID or a serial number. Two units of the same model are told apart by `duplicate=0`, `duplicate=1`. **[I]** from the key; this rig has no two of one model. The XML's root element also carries `hardwareName`, the product name with its spaces.

The keyboard and the mouse each have a fixed `hardwareGuid` and no `hardwareIdentifier`. **[V]** on this PC; that it is the same on every PC is **[I]**.

### The map document

One line, declared `encoding="utf-16"` but stored as UTF-8 (the reader must ignore the declaration). **[V]** Root `JoystickMap`, `KeyboardMap` or `MouseMap` in the namespace `http://guavaman.com/rewired`, with `sourceMapId`, `categoryId`, `layoutId`, `name`, `hardwareGuid`, `enabled`, then `buttonMaps` and, except for the keyboard, `axisMaps`. Each binding is one `ActionElementMap`:

| Element | Meaning | Mark |
|---|---|---|
| `actionCategoryId` | The action's category, or -1 | [V] seen, [?] why some are -1 |
| `actionId` | The action (table below) | [V] |
| `elementType` | 0 an axis, 1 a button | [V] |
| `elementIdentifierId` | Which control. On a joystick Rewired has no definition for: 0 to 31 are the axes in device order, 32 and up the buttons, so 32 is button 1 | [V] against the game's controls screen (below): the screen shows an axis by this id and a button by this id minus 32, counting from 0. That the game's button 0 is the device's first button (RigReady's button 1), and that axes 0 to 5 are X, Y, Z, RX, RY, RZ, is [I] until a press in the trainer proves it |
| `axisRange` | 0 the whole axis, 1 its positive half, 2 its negative half | [I] |
| `invert` | The axis is reversed | [V] the stick's pitch axis is inverted, as expected |
| `axisContribution` | 0 the action's positive side, 1 its negative side (W is "Pitch Down", S "Pitch Up") | [I] from the keyboard map |
| `keyboardKeyCode` | Unity's KeyCode on the keyboard (119 is W); 0 elsewhere | [V] |
| `modifierKey1` to `3` | Modifier keys that must be held | [V] one binding uses one |
| `enabled` | | [V] |

How a hat direction is stored was not seen: no binding on the rig is clearly a hat. **[?]**

### Map categories and actions

These come from the game's own Rewired Input Manager, read from a copy of part of `NuclearOption_Data\resources.assets` (build 26327221). **[V]** They can change with a game update; the saved `ControllerMap_KnownActionIds` on this PC stop at 58 because the game was last run on an older build.

Map categories (`categoryId` in the key): 0 Default ("Game"), 1 Chat, 2 Editor ("Mission Editor"), 3 Debug.

Action categories: 1 Flight Controls, 2 Camera Controls, 3 Gameplay, 4 Debug, 5 Chat, 6 Mission Editor.

| Id | Action (the game's name; for an axis, its two sides) | Category |
|---|---|---|
| 0 | Pitch Axis (Pitch Up / Pitch Down) | Flight |
| 1 | Roll Axis (Roll Right / Roll Left) | Flight |
| 2 | Yaw Axis (Yaw Right / Yaw Left) | Flight |
| 4 | Throttle Axis (Increase Throttle / Decrease Throttle) | Flight |
| 5 | Fire | Flight |
| 6 | Brake Axis (Apply Brakes) | Flight |
| 7 | Target Select | Flight |
| 8 | Target Cancel | Flight |
| 9 | Next Weapon | Flight |
| 10 | Next Countermeasure | Flight |
| 11 | Toggle Gear | Flight |
| 12 | Countermeasures | Flight |
| 13 | Toggle Night Vision | Flight |
| 14 | Toggle Flight Assist | Flight |
| 15 | Toggle Radar | Flight |
| 16 | Eject | Flight |
| 17 | Center View | Camera |
| 18 | Switch View | Camera |
| 19 | Pause | Gameplay |
| 20 | Toggle Slow Motion | Gameplay |
| 21 | Toggle Map | Gameplay |
| 22 | Tilt View (Tilt Up / Tilt Down) | Camera |
| 23 | Pan View (Pan Right / Pan Left) | Camera |
| 25 | Zoom View (Zoom In / Zoom Out) | Camera |
| 26 | Free Look | Camera |
| 27 | Field of View (Increase FoV / Decrease FoV) | Camera |
| 28 | Move Longitudinal (Move Forward / Move Backward) | Camera |
| 29 | Move Lateral (Move Right / Move Left) | Camera |
| 30 | Toggle mission debug menu | Debug |
| 31 | Open Chat | Gameplay |
| 34 | Submit Chat | Chat |
| 35 | Cancel Chat | Chat |
| 36 | Move Map Horizontal (Move Map Right / Move Map Left) | Gameplay |
| 37 | Move Map Vertical (Move Map Up / Move Map Down) | Gameplay |
| 38 | Custom Axis 1 (Custom Axis 1 Up / Custom Axis 1 Down) | Flight |
| 39 | Toggle debug graphs | Debug |
| 40 | Toggle performance numbers | Debug |
| 41 | Focus Unit | Mission Editor |
| 42 | Delete Unit | Mission Editor |
| 43 | Open Radial Menu | Flight |
| 44 | Radial Menu Horizontal (Radial Menu Right / Radial Menu Left) | Gameplay |
| 45 | Radial Menu Vertical (Radial Menu Up / Radial Menu Down) | Gameplay |
| 46 | Axis Modifier | Flight |
| 47 | Camera Jump | Camera |
| 48 | Move Vertical (Move Up / Move Down) | Camera |
| 49 | Toggle Navigation Lights | Flight |
| 50 | Toggle Engine | Flight |
| 51 | Previous Weapon | Flight |
| 52 | Link Guns | Flight |
| 53 | Open Weapon Wheel | Flight |
| 54 | Toggle Turret Control | Flight |
| 55 | Spectate Previous Aircraft | Camera |
| 56 | Look At Enemy Aircraft | Camera |
| 57 | Jump to Enemy Aircraft | Camera |
| 58 | Look At Target | Camera |
| 59 | Vote Kick Yes | Chat |
| 60 | Vote Kick No | Chat |
| 61 | Select Unit Mode | Mission Editor |
| 62 | Translate Unit Mode | Mission Editor |
| 63 | Rotate Unit Mode | Mission Editor |
| 64 | Toggle Left Panel | Mission Editor |

The ids are **[V]** as read from the data file, and agree with the keyboard map saved on this PC wherever the default key is obvious: W and S on action 0, A and D on 1, Q and E on 2, left Shift and left Ctrl on 4, Space on 5, B on 6, G on 11, N on 13, R on 15, Esc on 19, M on 21, T on 31. The names are the ones the game's controls screen shows, and the screen lists the actions under the same headings ("Flight Controls" from Pitch Axis to Axis Modifier, then "Camera Controls"), so the categories seen there are **[V]**; the rest stay **[I]**.

One set of bindings serves every aircraft; the game has no per-aircraft bindings. **[V]** the controls screen has no aircraft to choose, only the map categories Game, Chat, Mission Editor and Debug.

### Checked against the game's controls screen, 26 November 2026

With the game running (build 26327221), its controls screen (Rewired's control mapper: a list of assigned controllers, the four categories, and columns Keyboard, Mouse, Controller) was read beside the saved values. Nothing was changed there. **[V]**

| Controller | Action | The screen shows | Saved as |
|---|---|---|---|
| WINWING Orion Joystick Base 2 + JGRIP-F16 | Pitch Axis | axis 1 | axis id 1, inverted |
| | Roll Axis | axis 0 | axis id 0 |
| | Fire | 4 | button id 36 |
| | Target Select | 31 | button id 63 |
| | Target Cancel | 33 | button id 65 |
| | Open Weapon Wheel | 13 | button id 45 |
| | Next Weapon | 37 | button id 69 |
| | Next Countermeasure | 39 | button id 71 |
| | Open Radial Menu | 5 | button id 37 |
| | Switch View | 14 | button id 46 |
| WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R | Toggle Gear | 17 | button id 49 |
| | Eject | 54 | button id 86 |
| | Custom Axis 1 | axis 5 | axis id 5 |
| Keyboard | Pitch Down / Pitch Up | W / S | key codes 119 (negative side) and 115 |
| | Toggle Gear, Fire, Eject | G, Space, Ctrl+Shift+E | key codes 103, 32, and 101 with modifiers |

Every one agrees: the number on the screen is the saved id for an axis and the saved id minus 32 for a button. The current build reads these registry values and shows them. The screen does not show that an axis is inverted, and no binding on a hat was seen.

### Open questions for stage 2

1. The game's button 0 (id 32) is taken to be the device's first button, and axes 0 to 5 to be X, Y, Z, RX, RY, RZ in DirectInput's order. The controls screen cannot show that; a press of a known button in the trainer does.
2. How is a hat direction stored?
3. Answered: build 26327221 reads these keys (the table above).
4. A controller Rewired does know (a gamepad) has a non-zero `hardwareGuid` and its own element ids; none is on this rig.

## 5. Changing the bindings: what stood in the way before stage 3

- The write is a registry value. `FileStore` backs up, journals and undoes files; the `Registry` port (`src/core/ports/index.ts`) can only read. A backed-up, journaled, undoable registry write is a new piece of shared code.
- Whether the game takes an edited value at its next start is not documented by Rewired. It has to be proven in the game before anything is called supported.
- Unity's `_h<number>` suffix is a hash of the key. Changing an existing value keeps its name; a binding for a controller that has no saved map yet would need a new value name, so the hash would have to be computed. **[?]** which hash.

## 6. The reader (stage 2)

`src/features/nuclear-option-bindings` reads the saved maps and registers a `BindingReader` for the game, so the bindings page, the cheat sheets, the trainer and the overlay show them. It only reads.

- **The parser** (`core/rewired.ts`) takes a map document apart into its bindings and the text around them, and puts it together again. All 22 maps saved on the rig came back character for character **[V]**, as do the made-up maps in `fixtures/nuclear-option`. A document that is not a map, or holds a binding written another way, is refused with the reason, and damaged input never throws (`tests/unit/fuzzParsers.test.ts`).
- **Buttons.** Element id 32 is shown as Button 1, 33 as Button 2, and so on: the game's own number plus one. **[V]** for the stick's Fire button, pressed on the cheat sheet on 26 Nov 2026; **[I]** for the other controllers.
- **Axes.** Element id n is the nth axis the plugged-in controller reports (its `axisNames`, from DirectInput), or the nth of X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2 when the controller is not plugged in. **[V]** for the stick's pitch axis, moved on the cheat sheet on 26 Nov 2026. For other controllers **[I]**: Rewired reads the controller through Raw Input and its axis order is assumed to be the same. Where a controller reports its axes in another order through DirectInput, an axis would be named wrongly; a move of a known axis in the trainer or the input tester shows it.
- **Two forms of the identifier** (section 4) are both read. A map an earlier build left behind is left out when a later one is there for the same controller and category, judged from the value names alone, so it is also left out when the later map cannot be read.
- **An axis the plugged-in controller does not have** (an id past its axes) is shown by the game's number only, not by another axis's name. The game gives every controller the same default bindings, so a panel with four axes can have a binding on a fifth.
- **Which unit.** A map names a model (vendor and product id), and `duplicate` the nth unit of it. RigReady takes the nth plugged-in controller of that model in the order Windows lists them. **[I]** for a second unit; one unit of a model needs no guess.
- **A binding that is switched off** (`enabled` false) is left out. **A hat direction** has not been seen and may show as a button. **An action not in the table** shows as "Action" and its number.

- **In a full backup.** The feature registers a backup source with no files and one record: every value of the game's registry key as read, with a table for reading (each saved map by controller and category with its number of bindings, then the game's own settings). It is the same mechanism as the Fanatec driver settings: shown on the backup's page, never restored.

### Proof on a rig, stage 2

Run the branch as for stage 1, with the game closed or open (reading does not disturb it).

| Step | What to do | What you should see |
|---|---|---|
| 1 | **Configure > Bindings**, Game: Nuclear Option | Each controller the game's controls screen lists under Assigned Controllers, the keyboard and the mouse |
| 2 | Open the stick and compare five rows with the game's controls screen | The same actions on the same inputs; the game's number in the last column, one less than RigReady's button number |
| 3 | **Cheat sheet** at the top of the page | The stick's and the throttle's bindings on their drawings or lists |
| 4 | On the cheat sheet, press the button the game uses for Fire | The label that lights up is the one that says Fire (this is what proves the button order) |
| 5 | Move the stick forward and back | The label that lights up is the one that says Pitch Axis (this is what proves the axis order) |
| 6 | Start the trainer for Nuclear Option and answer one question by pressing the control | The press counts as right |
| 7 | With the overlay on, start the game and press the Fire button | The overlay names Fire |

### Results, 26 November 2026

On the owner's rig, the game running (build 26327221), this branch built and run as for stage 1.

| Step | What was seen | Result |
|---|---|---|
| 1 | Eleven controllers, the keyboard (51 bindings) and the mouse, each controller once and marked plugged in. The first try showed two controllers twice and most as not plugged in: that is how the shorter identifier was found, and the reader was changed | Pass, after the change |
| 2 | The stick: Pitch Axis on axis 1 reversed, Roll Axis on axis 0, Fire 4, Target Select 31, Target Cancel 33, Next Weapon 37, Next Countermeasure 39, Open Radial Menu 5, Switch View 14, Open Weapon Wheel 13 in the game's column, the same as the game's controls screen read earlier that evening | Pass |
| 3 | The cheat sheet for Nuclear Option, opened from the page | Pass, as the owner reported |
| 4 | The owner pressed the Fire button with the cheat sheet open: the label that lit was Fire | Pass, as the owner reported |
| 5 | The owner moved the stick forward and back: the label that lit was Pitch Axis | Pass, as the owner reported |
| 6 | The trainer for Nuclear Option counted a press as the answer | Pass, as the owner reported |
| 7 | With the overlay on and the game running, the overlay named the Fire press | Pass, as the owner reported |

Steps 3 to 7 were done by the owner at the controls, who reported that all of them worked; no screenshot was kept. Steps 4 and 5 are what the numbering rests on: on this stick the game's button 4 is the device's fifth button, and the game's axis 1 is the axis Windows calls Y.

Not tried: a second unit of one model, a controller Rewired has a definition of its own for (a gamepad), a binding on a hat, and a press on any controller other than the stick.

## 7. The writer (stage 3)

### What it writes

`core/edit.ts` changes one thing in a saved joystick map: the binding of a button-type action to a button of that controller. It composes only what the game itself was seen to write.

A binding the player made on the game's controls screen is one `ActionElementMap` with `actionCategoryId` -1, `elementType` 1, `elementIdentifierId` 32 plus the game's button number, `axisRange` 1, `invert` false, `axisContribution` 0, `keyboardKeyCode` 0, the three modifier keys 0, `enabled` true. **[V]** four such bindings on the stick (Target Select, Target Cancel, Next Weapon, Next Countermeasure), which the owner made in the game; the game's own default bindings differ only in `actionCategoryId` 0.

- **Bind** an action that has no binding on the controller: one such element is added at the end of `buttonMaps`. **[I]** that the game adds one at the end; the order has no meaning to Rewired that was seen.
- **Move**: the action's element is replaced in place by one for the new button. A default binding (`actionCategoryId` 0) that is moved becomes one written as the player's (-1). **[I]** that the game does the same.
- **Clear**: the element is taken out. A list that loses its last element is written `<buttonMaps />`, as the game writes an empty one. **[V]** the form. The game, finding a default action with no binding, does not put its default back: **[V]** for a whole controller ("Clearing a whole controller" below).
- Everything else in the document stays character for character, including the zero byte at the end.

Since 27 November 2026 it also writes these, each seen in the owner's saved maps as the game writes one the player made:

- **A button on one side of an axis action** ("Zoom In", "Apply Brakes"): the same element as for a button action, with `axisContribution` 0 for the positive side and 1 for the negative. **[V]** the positive side (Zoom In on the stick, `actionCategoryId` -1); **[V]** a negative side written with `actionCategoryId` 0 and `axisContribution` 1 (Zoom Out). That the game takes a negative side written with -1 was **[I]** until the proof below; now **[V]**. One side is told from the other by `axisContribution`, so each is moved and cleared on its own.
- **A whole axis of the controller on an axis action**: `actionCategoryId` -1, `elementType` 0, `elementIdentifierId` the axis's number (0 the first), `axisRange` 0, `invert` true or false, `axisContribution` 0, in `axisMaps`. **[V]** two such bindings (Yaw Axis on axis 2; Brake Axis on axis 0, inverted). The axis is asked for by the name RigReady shows it under and turned into its number from the plugged-in controller's own list of axes, the same order the reader names them by. For a controller that is not plugged in the number would be a guess from the usual order (a throttle with X, Y, Z, RZ and a slider has the slider as its fifth axis, not the seventh), so a new axis binding is refused until it is plugged in; and what a review showed would be written is part of what Save checks, so a controller unplugged between the two cannot turn "Slider 1" into another number.
- An axis action can have its whole-axis binding and buttons on its sides at once: they are separate elements in separate lists.

Refused, with the reason: half an axis on an action (`axisRange` 1 or 2 in `axisMaps`, never seen written by the player), an axis on a button action, a key, a mouse button, an action not in the table, an action that already has a binding the writer does not understand (a button with a modifier key, an axis), a controller with no saved map, a button outside 1 to 128. The writer parses its own result and checks it is the map it meant before it returns it.

Also refused, each because the result could not be trusted: a saved map whose bytes are not the UTF-8 of the text read from them (writing the text back would lose a byte); a map this code would not write back character for character as it stands (a number written "005"), since a save writes every binding again; and a controller Rewired has a definition of its own for (a `hardwareGuid` that is not all zeros), whose buttons are numbered by that definition. Saves run one at a time, each reading, checking and writing on its own, so two at once cannot both start from the same map.

The game's registry key is listed among the game module's settings locations. That is what tells the Safety page that Nuclear Option holds these values: Undo there is refused while the game runs, as it is for a game's files.

### Is writing safe?

- **The game reads the value at start.** **[V]** in the proof below: a binding written while the game was closed was on the game's controls screen at its next start.
- **The game did not rewrite the bindings on its own.** Started, taken to its controls screen and closed, it changed only Unity's two session counters. **[V]** It does save when the player changes a binding there, which is why Undo checks that the value is still what RigReady wrote, and why a change is refused while the game runs.
- **Only an existing value is replaced.** A controller the game has never saved a map for cannot be bound from RigReady: that would mean a new value, whose name carries a hash only Unity computes (section 5).
- **`ControllerMap_KnownActionIds` is not touched.** It lists the action ids the game knew when it saved; binding an action whose id is already in it needs no change. **[I]** An action added by a game update after the map was saved has not been tried.

### The second look, 26 November 2026

On the owner's rig, the game (0.34.6, build 26327221) from Steam, this branch built and run with a data folder of its own. A copy of the key was exported with `reg export` first (which, it turned out later, leaves out the saved maps: see "Axes and axis sides in the game").

| Step | What was done | What was seen | Result |
|---|---|---|---|
| Before | `RIGREADY_RIG_NUCLEAR_OPTION=before` (read-only) | Every saved map read and put together again character for character; a trial change on a copy differed in one binding | Pass |
| The change | With the game closed: Bindings, the Orion stick, **Bind an action**, Toggle Navigation Lights, button 12, the review, **Save** | "Saved: Toggle Navigation Lights is now on Button 12 …". In the registry one value differed, by one added element (action 49 on element 43, written as above) | Pass |
| In the game | Started the game, Settings, Controls, the control bindings menu, the Orion stick | Toggle Navigation Lights showed controller button 11, the game's number for Button 12 | Pass |
| The game closes | Closed the game without changing anything there | Only `unity.player_session_count` and `unity.player_sessionid` differed from what RigReady left | Pass |
| Undo | Safety page, **Undo** on the entry | Every value equal to the copy from before, except Unity's two counters | Pass |
| After | The change made a second time, then `RIGREADY_RIG_NUCLEAR_OPTION=after:49` (read-only), then Undo again | One controller map differed from the snapshot, only in that action, exactly as the writer composes it; after Undo the bindings were as at the start | Pass |

The steps were driven by Claude Code on the owner's PC overnight, with the owner's permission; nobody was at the controls.

Not tried: pressing the button in a flight to see the lights toggle (the game's controls screen showing the binding is the evidence that the game read it); moving or clearing a binding in the real game (only binding an unbound action); a controller other than the stick; an action added by a game update.

### Axes and axis sides in the game, 27 November 2026

On the owner's rig (0.34.6, build 26327221), driven by Claude Code with the owner's permission, on the WINWING ICP panel:

| Step | What was done | What was seen | Result |
|---|---|---|---|
| Before | Every value of the key read through PowerShell into a file; `RIGREADY_RIG_NUCLEAR_OPTION=before` | The snapshot of 145 values | Pass |
| An axis | Game closed. **Change** on Pitch Axis (X axis), **Reversed** ticked, the review said "X axis" to "X axis, reversed"; **Save** | "Saved: Pitch Axis is now on X axis, reversed of WINWING ICP." | Pass |
| A side | **Bind an action**, Zoom Out, button 20; **Save** | "Saved: Zoom Out is now on Button 20 of WINWING ICP." | Pass |
| In the game | Started the game, its control bindings menu, WINWING ICP | Pitch Axis on axis 0 with its reverse mark lit (Roll Axis beside it not); controller button 19 on the Zoom Out row, nothing on Zoom In | Pass |
| The game closes | Closed it without changing anything there | Of the key's 85 binary values, three differed from the snapshot: Unity's two session counters and the ICP's map, which held exactly the two elements RigReady wrote | Pass |
| Undo | Safety page, **Undo** on both entries, newer first | Only Unity's two counters differed from the snapshot | Pass |

Not tried: an axis bound to an action that had none (only one reversed in place, which writes the same element); an axis moved to another axis; a positive side (seen in the owner's own maps); pressing or moving either in a flight.

**`reg export` does not copy this key whole.** The "copy of the whole key" taken with `reg export` before each proof (26 and 27 November) holds 40 of the key's 145 values: `reg.exe` leaves out values whose names are long, and every saved map has such a name. **[V]** on 27 November, when a comparison made from such an export saw no difference where there was one. The comparisons the rig test makes (through the registry port) were not affected, and RigReady's own backups, which Undo restores from, hold the values' bytes: the MFD1-L map cleared and undone above is byte for byte the backup taken before it was cleared. **[V]** A full copy for safety is made by reading every value (PowerShell's `Get-Item` and `GetValue`), not by `reg export`.

### Keys

**How the game numbers a key.** A keyboard binding carries two numbers: `elementIdentifierId`, Rewired's own number for the key, and `keyboardKeyCode`, Unity's KeyCode. Rewired numbers the keys in the order of Unity's KeyCode list, from A = 1: the letters 1 to 26, the digits 27 to 36, the keypad's digits 37 to 46 and its signs 47 to 52, Space 54, Backspace 55, Tab 56, Enter 58, Pause 59, Esc 60, the punctuation 61 to 87 (without a percent sign: Comma is 71), Delete 88, the arrows and the block above them 89 to 97, F1 to F15 from 98, then Num Lock, Caps Lock, Scroll Lock and the Shift, Ctrl and Alt keys from 113. **[V]** for the 40 keys in the owner's saved keyboard maps, which fit this without exception, among them at least one in every run but the digits and the keypad's signs: letters (14 of them), keypad 2, 4, 5, 6 and 8, Space, Backspace, Tab, Enter, Esc, Comma, Delete, Up, Down, Page Up, Page Down, F2 to F4, F7, F9, F10, left Shift and left Ctrl. **[I]** for the rest, from the runs fitting exactly between keys that were seen (ten digits between Z = 26 and keypad 0 = 37; sixteen punctuation keys between Comma = 71 and Delete = 88). `core/keys.ts` holds the table.

**How the game writes a key the player binds.** On 27 November 2026 Toggle Engine was bound to F7 on the game's own controls screen (driven by Claude Code, with the owner's permission) and the key read: one `ActionElementMap` at the end of the keyboard map's `buttonMaps` with `actionCategoryId` 0, `elementType` 1, `elementIdentifierId` 104, `axisRange` 0, `invert` false, `axisContribution` 0, `keyboardKeyCode` 288, no modifier keys, `enabled` true: the form of the game's own defaults, not the -1 and `axisRange` 1 of a controller button the player binds. **[V]** The game saves it when **Done** is pressed, not before. **[V]** **Remove** on the game's screen then left the map byte for byte as it was before. **[V]**

- Modifier keys held with the key are in `modifierKey1` to `modifierKey3`: 1 Control, 3 Shift. **[V]** on Eject (Ctrl + Shift + E, written 1, 3, 0). 2 for Alt is **[I]** from Rewired's order (Control, Alt, Shift); the writer puts them in ascending order, as Eject has them.
- One side of an axis action has `axisContribution` 0 (the positive side) or 1, as on a controller. **[V]** in the defaults (W and S on Pitch).
- The keyboard has a map for each tab of the controls screen, and an action's key is in its own tab's: the chat actions in category 1, the mission editor's in 2, the debug ones in 3, everything else in 0. **[V]**

**The writer against the game.** With the game closed, RigReady bound Toggle Engine to F7 on the owner's real keyboard map. The value it wrote is byte for byte the value the game had written for the same binding (16,284 bytes), and no other value changed; Undo put the map back. **[V]** 27 November 2026.

An action can hold two keys (the game's screen has two keyboard columns): two elements of the same action in the list. RigReady changes or clears the one a row is on and adds a second beside the first; it does not write a third. **[I]** that a second key the player binds is written like the first: only one was bound in the game.

Not tried: a key with Alt; a key on a side of an axis; a key in the Chat, Mission Editor or Debug tab; a second key for an action; any key but F7 in the game; the game started on a map RigReady wrote (it is the same bytes the game wrote itself).

### Snapshots

A snapshot (`core/snapshots.ts`) is every `ControllerMap` value of the key, name and bytes, in a file under RigReady's data folder. Restoring writes back, through FileStore, the values whose bytes differ and that the key still has. It cannot bring back a value the game has since dropped: its name carries a hash only Unity computes, and RigReady replaces values, it does not make them (section 5); the review and the result name such a device. A value the key has now that the snapshot does not hold is left as it is. Only the maps the game uses are kept and written: a map left behind under the older identifier (section 4) is neither.

The file is read as untrusted. Its bytes are written only when they are a saved map of the same kind, controller and tab as the value they replace; a file with half a byte, bytes that are no map, a value named twice or another device's map is damaged, and nothing is written from it.

On the owner's rig, 27 November 2026 (driven by Claude Code, with the owner's permission, the game closed): a snapshot of the 46 saved maps among the key's 145 values was taken; a panel the game had bound by itself was cleared of its 14 bindings; the review of the restore named that one device, 0 bindings now and 14 in the snapshot; after **Restore** every value of the key was byte for byte as before, except Unity's two session counters. **[V]**

Not tried: a restore after the game ran in between; a snapshot restored on another PC or after the game renamed a controller's value; Undo of a restore on the rig (it is tested on the scenario).

### Several bindings as one change

Another feature (a setup suggested by AI) hands the bindings feature a list of bindings through the reader's `proposals` (`core/proposals.ts`), the interface DCS's reader offers. Each binding is the same edit the page makes (`core/edit.ts`), folded into the controller's saved map in the order given, and every changed map is written through FileStore under one `beginGroup()`, each read back. The scenario test checks that two bindings written this way leave the same bytes as the same two made one at a time on the page.

A proposed binding takes its control over (`alone` in `BindingEdit`): every other binding on that button, or that axis, of the controller's Game map is taken out, a half axis too. Nothing new is composed for that. Removing a binding is what the game does when the player clears one, and what clearing a controller does (above). A single change from the page does not do this; it leaves the other action and says so.

An axis action that is on an axis reversed keeps the reversal when a proposal puts it on an axis. A hat, a key, a mouse button, a clear, and a controller without a saved map are refused with the reason, and one refusal refuses the whole list. An action of the Chat, Mission Editor or Debug tab is refused too: a controller's bindings are changed in its Game map, and such an action belongs in that tab's map. The review is remembered by what it would write; a write of a list that was not reviewed, or after the saved maps changed, is refused.

Not tried on a rig: a proposal written to the real registry and the game started on it. The bytes are the writer's own (section 7), which the game has loaded.

### Axis tuning

The game's controls screen has a **Calibrate** window for each controller: for each axis a dead zone, an upper dead zone, a zero, a sensitivity, an Invert button and a Calibrate button that measures the range. **[V]** It saves them in the controller's `CalibrationMap` value (section 4), one `AxisCalibration` for each of 32 axes:

`<AxisCalibration><enabled>true</enabled><deadZone>0.1</deadZone><upperDeadZone>0</upperDeadZone><calibratedZero>0</calibratedZero><calibratedMin>-1</calibratedMin><calibratedMax>1</calibratedMax><invert>false</invert><sensitivity>1</sensitivity><applyRangeCalibration>true</applyRangeCalibration><sensitivityType>0</sensitivityType><sensitivityCurve /></AxisCalibration>`

That is the default, and on the owner's rig all 22 values held nothing else. As for the saved maps, each of the 11 controllers has two: one under the earlier, longer identifier (`dataVersion="4"`, no `upperDeadZone`) and one under the shorter one the current build uses (`dataVersion="5"`, with it). **[V]**

Seen on the owner's rig, 27 November 2026 (driven by Claude Code, with the owner's permission), on the first axis of a panel, by moving one slider at a time in the game's window, pressing Done twice and reading the key: **[V]**

| In the game's window | In the value | Ends of the slider |
| --- | --- | --- |
| Dead Zone | `deadZone` | 0 to 0.8 |
| Upper Dead Zone | `upperDeadZone` | 0 to 0.8; with the dead zone at most 0.9 together |
| Zero | `calibratedZero` | not tried |
| Sensitivity | `sensitivity` | 0.1 to 2 |
| Invert | `invert` | |

Nothing else in the value changed, and nothing else in the key. A number is written as a 32-bit float in the shortest of seven or nine digits that reads back as itself (`0.1`, `0.8`, `0.498286575`, `1.53551137`, and `0.09999999` where the game held the two dead zones to 0.9). **Default** in the window put the axis back, and the key was then byte for byte as before.

RigReady (`core/calibration.ts`, `core/tuning.ts`) changes `deadZone`, `upperDeadZone` and `sensitivity` of one axis, within the ends of the game's sliders, in the value under the shorter identifier when there are both, through FileStore. It does not write the zero or the range (the game measures them) or the reversal (a binding has its own). An axis that is switched off, has a `sensitivityType` other than 0, a sensitivity curve, or any other shape, is left alone. The value's name says the model, not the unit, so with two controllers of one model nothing is written.

Proof, the same day: with the game closed, a build of this branch with a data folder of its own set the first axis of that panel to a dead zone of 25 % and a sensitivity of 1.4. Only those two numbers of that one value changed. The game was started: its Calibrate window showed that axis with the wider dead zone and the raised sensitivity, and the next axis as before. Done was pressed twice there and the game closed: the value was byte for byte what RigReady had written. Undo on the Safety page put the key back as it was before, but for Unity's two session counters. **[V]**

Not tried: the effect in a flight (it needs a hand on the axis); an upper dead zone written by RigReady and read by the game; a calibration of the earlier form written and read; the game's Zero slider.

### In a flight, 27 November 2026

The owner, at the controls, with the same build: Eject cleared on the R-VPC panel and bound to its Button 16 on the Bindings page (two entries on the Safety page), then the game started and the button pressed in a flight. It worked. **[V]** by the owner. That is a clear and a bind in the real game, on a second controller, and the press that the second look left out.

### Clearing a whole controller

The game binds its defaults to every controller it sees for the first time: on the owner's rig, pitch, roll, yaw, throttle, Fire and eight more on each of the MFD panels, the ICP, the UFC and both switch panels. **[V]** `clearMapText` in `core/edit.ts` takes every `ActionElementMap` out of a saved joystick map and writes both lists as `<buttonMaps /><axisMaps />`. Nothing is composed: the result is the map as the game itself saves one with nothing bound, which it does for a controller's Chat, Mission Editor and Debug maps. **[V]** on the rig: each of the ten controller maps with bindings, cleared on a copy, has no binding left, and the pedals' is the text of the pedals' own empty maps except for the category, the map's number and whether the map is switched on (`enabled` is true on the Game map and false on the others).

A controller has a map for each tab of the game's controls screen. Every one with bindings is cleared, under one entry on the Safety page; when one of them cannot be (the same refusals as for one binding: bytes that are not the text, a form this code would not write back, a controller Rewired has a definition for), none is.

**The game does not put its defaults back.** This was the open question under "Clear" above. **[V]** on 27 November 2026, on the owner's rig (0.34.6, build 26327221), driven by Claude Code with the owner's permission:

| Step | What was done | What was seen | Result |
|---|---|---|---|
| Before | `reg export` of the key; `RIGREADY_RIG_NUCLEAR_OPTION=before` (read-only) | Ten controller maps cleared on a copy as described above | Pass |
| The clear | With the game closed: Bindings, WINWING MFD1-L, **Clear all**; the review said "11 bindings" to "Nothing bound", one value changed; **Clear all** | "Saved: 11 bindings cleared on WINWING MFD1-L." `RIGREADY_RIG_NUCLEAR_OPTION=cleared`: one value differed from the snapshot, and it was that map with nothing bound | Pass |
| In the game | Started the game, Settings, the control bindings menu, WINWING MFD1-L, the whole list scrolled | The controller is still among the assigned controllers and has nothing in the Controller column; WINWING MFD1-R beside it still has its axes | Pass |
| The game closes | Closed the game without changing anything there, then the `cleared` step again | Still only that value differed from the snapshot: the game had not written the controller's defaults again | Pass |
| Undo | Safety page, **Undo** on the entry | Every value equal to the export from before, except Unity's two counters | Pass |

Not tried: a controller with bindings in the Chat, Mission Editor or Debug tab (none on the rig has any); the game started a second time; whether a controller unplugged and plugged in again, or a game update, makes the game bind its defaults again; **Restore Defaults** in the game after a clear.

## Proof on a rig

Stage 1, the game module. Run the branch from source with a data folder of its own:

```
$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-contrib"
npm run build
npx electron-vite preview --skipBuild
```

| Step | What to do | What you should see |
|---|---|---|
| 1 | **Configure > Games** | Nuclear Option is listed as found, with "Build" and a number |
| 2 | Open its page | Found in Steam, in the game's real folder; the location `AppData\LocalLow\Shockfront\NuclearOption`; the note that its settings are in the registry; no file offered for backup |
| 3 | Press **Launch** | Steam starts Nuclear Option |
| 4 | With the game at its menu, look at the Games page again | Nuclear Option is shown as running |
| 5 | Close the game, look again | No longer shown as running |

### Results, 26 November 2026

On the owner's rig: Nuclear Option from Steam, build 26327221, Windows 11, this branch at `077d2307`, built with `npm run build` and run with `npx electron-vite preview --skipBuild` and `RIGREADY_HOME` set to a folder of its own. (`npm run dev` was tried first and showed blank Play and Bindings pages; that is a fault of the development server after the Vite 8 update, not of this change, and is being fixed apart from it.)

| Step | What was done | What was seen | Result |
|---|---|---|---|
| 1 | **Configure > Setups > New setup from this rig** | Nuclear Option offered as a game tile, "Steam"; choosing it filled in "Through Steam" and app id 2168680, and proposed the check "Nuclear Option not updated since verified (now Build 26327221)" | Pass |
| 2 | The game's own page under **Configure > Games** | Not opened on the rig; the scenario screenshot `artifacts/screens/games-nuclear-option/02-nuclear-option.png` is the evidence for its wording | Not tried |
| 3 | **Launch** on Play, with a setup for the game (Ready, 16 of 16) | RigReady started `steam.exe -applaunch 2168680`. The first time Steam waited for the licence agreement and Play said "Waiting for Nuclear Option to start"; once the owner accepted it, the game started. A second launch started the game within two seconds | Pass |
| 4 | With the game running | RigReady began the session one second after `NuclearOption.exe` appeared, both times | Pass |
| 5 | The owner closed the game | RigReady ended the session by itself (2 min 16 s), showed "Welcome back" and the stand-down countdown | Pass |

Not tried: the game's page on the rig (step 2), **Choose folder…** for a copy outside Steam, and a restore being refused while the game runs (the module offers no file to restore).
