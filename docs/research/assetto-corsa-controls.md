# Assetto Corsa: how controls.ini names controllers

Research for the Assetto Corsa controller repair (RACE-AC-001). Written 2026-11-11. Sources: the Content Manager source code (gro-ove/actools on GitHub, which reads and writes this file), this PC's own `Documents\Assetto Corsa\cfg\controls.ini` (read only; the recorded copy is `fixtures/rigs/mark-full/files/Documents/Assetto Corsa/cfg/controls.ini`), and community reports. Kunos publishes no documentation of the file.

## 1. The format

`controls.ini` is a plain INI file in `Documents\Assetto Corsa\cfg`. Every action is a section; a controller binding names the controller by number:

```ini
[CONTROLLERS]
CON0=FANATEC Podium Wheel Base DD2
__IGUID0=45D4BEA1-60A1-17D8-8001-444553540000
PGUID0=00070EB7-0000-0000-0000-504944564944

[STEER]
JOY=0          ; controller number
AXLE=0         ; axis 0..7: X, Y, Z, RX, RY, RZ, slider 0, slider 1

[GEARUP]
JOY=0
BUTTON=4       ; button, from 0
KEY=0x20 ; Space
__CM_ALT_JOY=-1      ; Content Manager: a second button for the same action
__CM_ALT_BUTTON=-1

[SHIFTER]
ACTIVE=1
JOY=0          ; one controller for the whole H-shifter
GEAR_1=13
GEAR_R=12
```

What each key is, from Content Manager's reader and writer:

| Key | Meaning | Source |
|---|---|---|
| `CONn` | The controller's DirectInput product name when the file was saved; `n` is its number | `ControlsSettings.cs` `SetToIni`: `s.Set("CON" + d.Index, d.DisplayName)` |
| `PGUIDn` | Its DirectInput product GUID (`PPPPVVVV-0000-0000-0000-504944564944` for HID devices) | same: `s.Set("PGUID" + d.Index, d.ProductId ...)` |
| `__IGUIDn` | Its DirectInput **instance** GUID. Written by Content Manager only: the double underscore is CM's prefix for keys the game ignores (`__CM_POV`, `__CM_ALT_JOY`, `__EXTRA_CM`). A file saved by the game's own controls screen has `CONn` and `PGUIDn` only | same: `s.SetOrRemove("__IGUID" + d.Index, d.InstanceId)` |
| `JOY` | The controller number of a binding (`-1`: none) | `WheelAxleEntry.cs`, `WheelButtonEntry.cs`: `section.Set("JOY", Input?.Device.Index)` |
| `JOY_MODIFICATOR` | The controller of a modifier button (`BUTTON_MODIFICATOR`) | `WheelButtonEntry.cs` (`_modifier`) |
| `__CM_ALT_JOY` | The controller of Content Manager's second button (`__CM_ALT_BUTTON`, `__CM_ALT_POV`) | `WheelButtonAltEntry.cs` |
| `__CM_POV`, `__CM_POV_DIR` | A hat direction instead of a button | `WheelButtonEntry.cs` |
| `[X360] JOYPAD_INDEX` | The XInput gamepad slot. Another numbering; not a DirectInput controller | this PC's file |

Custom Shaders Patch sections (`__EXT_*`) use the same `JOY`/`BUTTON`/`KEY` keys.

## 2. What the number means

The number is the controller's position in the list DirectInput returns for attached game controllers, in the order it returns them. Content Manager builds its list with `DirectInput.GetDevices(DeviceClass.GameController, DeviceEnumerationFlags.AttachedOnly)` (`DirectInputScanner.cs`) and gives each device `Index = i`, its position in that list (`ControlsSettings.RescanDevices`). It saves `JOY` as that index.

When Content Manager loads the file, it finds each listed controller again by `__IGUIDn` (or, without one, by name and then product GUID) and compares: `if (device.Index != x.IniId) orderChanged = true` (`ControlsSettings.LoadFromIni`). When a controller's index differs from the saved one it logs "index changed: saved as ..., actual: ..." and, with its option *Check and fix controls order* (`SettingsHolder.Drive.CheckAndFixControlsOrder`, **off by default**), saves the file again with the new numbers and says "Controllers have changed in order, so Content Manager re-saved your configuration correctly" (`FixMessedOrderAsync`; `GameWrapper.cs` runs `FixControllersOrder()` before a race when the option is on). A tool would not need this if the game itself looked controllers up by GUID: **the game takes `JOY=n` as the n-th attached controller.** That is inferred from Content Manager's code, not from Kunos; it matches the community reports below.

So the file breaks whenever the order changes: a controller moved to another USB port, a controller added or removed (a button box plugged in before the wheel), a hub reset, or Windows reinstalled. The listed GUIDs stay right; the numbers point at another device. Content Manager's own reader keeps a controller that is not connected as a placeholder with a number past the connected ones (`UpdatePlaceholders`), so its bindings do not land on another device.

Community reports of the symptom: moving a wheel or pedals to another USB port loses the assignments, and the usual advice is to plug everything into the ports it was set up with, or to delete `controls.ini` and bind again with every device connected ([Steam: Assetto Corsa discussions](https://steamcommunity.com/app/244210/discussions/0/523897277919045091), [Steam: controls reset](https://steamcommunity.com/app/244210/discussions/0/135507403158641092), [Overtake: Controls stopped working](https://overtake.gg/threads/controls-stopped-working.254910/page-2), [Overtake: Assetto won't save my T300 wheel settings](https://www.overtake.gg/threads/assetto-wont-save-my-t300-wheel-settings-have-to-rebind-everytime.163600/)). The Overtake pages refuse automated fetches; the Steam threads and search summaries were read.

A second, rarer failure: Windows gives a controller a new **instance** GUID (reinstall, a different port on some hubs). `PGUIDn` still matches; `__IGUIDn` no longer does. Content Manager then treats it as another device, by its `Same()` test on the instance GUID (`DirectInputDevice.cs`, `IDirectInputDevice.IsSameAs`).

## 3. What the repair does

`src/features/racing/core/acRepair.ts`:

1. Reads `[CONTROLLERS]` and matches each listed controller to a connected one: the same instance GUID first; then, for an entry without one, a controller of the same product GUID still at its number; then a model that only one unclaimed connected controller has, or only one with the same DirectInput collection number (the fourth group of the instance GUID, kept by a wheel base that Windows lists twice). Anything else (two identical button boxes whose ids both changed) is left for the user to choose; RigReady never guesses.
2. States: **Connected** (at its number), **New number** (attached at another position), **New Windows id** (same model under a new instance GUID), **Not connected**, **Cannot tell**.
3. Rewrites, in one change: every `JOY`, `JOY_MODIFICATOR` and `__CM_ALT_JOY` value that names a listed controller gets that controller's position now; `[CONTROLLERS]` is rebuilt at the new numbers with the new instance GUID; a listed controller that is not connected is given a number past the connected ones, as Content Manager's placeholders are, so its bindings stop acting on another controller. Every other line, the line endings and the `PGUIDn` text stay as they were. Saved presets (`cfg\controllers\savedsetups`) are not touched.
4. Shown first (`racing:acRepairPreview`), refused while `AssettoCorsa.exe`, `acs.exe` or `Content Manager.exe` runs, written through FileStore with a backup, read back, undoable on the Safety page.

**The order RigReady sees.** RigReady's DirectInput reader (`python/input_server.py`) sorts controllers by name for display, so it now also reports each controller's position in the order `EnumDevices(DI8DEVCLASS_GAMECTRL, DIEDFL_ATTACHEDONLY)` returned it (`InputDevice.enumerationIndex`), the same call and flags Content Manager uses. When that position is not available the page says it cannot tell and offers no repair.

**Not yet verified on real hardware.** Whether the game takes a rewritten file as expected has not been tried with a moved controller. The owner's check is in the ledger under RACE-AC-001.

## 4. Assetto Corsa Competizione: no repair needed

ACC keeps its bindings in `Documents\Assetto Corsa Competizione\Config\controls.json`. A device there is named by `productName` and a `productId` such as `"3261203565-0-0-00807368867368"` ([Steam: ACC discussions](https://steamcommunity.com/app/805550/discussions/0/2646360117223783712/), read 2026-11-11). Decoded: `3261203565` is `0xC262046D` (product C262, vendor 046D: a Logitech G920), and `0-0-00807368867368` are the remaining fields and bytes of the GUID in decimal, `0, 0, 0x50 0x49 0x44 0x56 0x49 0x44` = "PIDVID". That is the DirectInput **product** GUID `C262046D-0000-0000-0000-504944564944`, not an instance GUID, and there is no position number. A port change or a new enumeration order does not change it, so the failure this repair fixes does not occur in ACC. The one case where ACC loses a device is the device reporting another product id (for example a Fanatec base switched between PC and compatibility mode), which the Wheel page already checks. ACC is not installed on this PC, so no real file was read; the verdict rests on the published sample and the format of the product GUID.
