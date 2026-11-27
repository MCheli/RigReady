# Nuclear Option: where it is, where it keeps its settings, and how its bindings are stored

Research date: 2026-11-26. Machine: the owner's rig, with Nuclear Option installed through Steam (build 26327221, `build-hash.txt` 3f729f837227) and last played in March 2026 (game version 0.32 by its own first-start flag).

The marks: **[V]** verified on this machine, **[W]** from the web with the URL, **[I]** inferred from verified data, **[?]** unknown.

Everything here was learned read-only: by listing folders and registry value names, from copies of the game's registry values in a scratch folder, and from copies of parts of the game's own data files. Nothing was written to the game's folders or registry key, and the game was not started.

## The short answer

- **Found and launched like any Steam game.** Steam app 2168680, program `NuclearOption.exe` in the game folder. The game module (`src/features/games/nuclear-option/module.ts`) does this today.
- **Its settings and bindings are registry values, not files.** The game is a Unity game and keeps everything in Unity's PlayerPrefs, which on Windows is `HKEY_CURRENT_USER\Software\Shockfront\NuclearOption`. There is no settings file to back up. RigReady's backup works on files, and its registry port is read-only, so the module offers nothing for backup and says so.
- **The bindings can be read.** They are stored by the Rewired input library as one XML document per controller and map category, in a format that is plain to read. The action names are in the game's data files. Reading them (stage 2) needs no change outside a feature folder.
- **Changing them (stage 3) is a different kind of write.** It is a registry value, not a file, so it cannot go through `FileStore`, and RigReady has no journaled, undoable registry write. That is a deliberate change to `src/core` and `src/platform`, to be decided before stage 3 starts.

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

## 5. Changing the bindings (stage 3): what stands in the way

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
