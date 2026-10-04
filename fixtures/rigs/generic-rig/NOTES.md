# generic-rig: notes

**Synthetic.** This rig was written by hand; it was not recorded from a PC and `npm run rig:record` must not be pointed at it. Every id, serial and GUID in it is made up. It has the same files and schemas as `mark-full` and loads through the same loader (`loadRig`, `seedScenario`).

## What it is for

Proving that nothing in RigReady is hardcoded to the owner's rig: the app wires up, captures a setup, checks it, launches and backs up on a PC that has none of the owner's hardware, no sim and none of the helper programs. It shares no device, monitor, audio endpoint, controller GUID or registry key with `mark-full` (`tests/unit/genericRig.test.ts` asserts that).

## What is in it

| File | Content |
|---|---|
| `devices.json`, `usb-tree.json` | 4 USB devices on one root hub: a Logitech Extreme 3D joystick (`046D:C215`, a game controller) directly on the root hub; a generic 4-port hub (`05E3:0608`) with a keyboard (`046D:C31C`) and a mouse (`046D:C077`) |
| `input.json` | 1 DirectInput controller: the joystick, 4 axes (X, Y, RZ, SLIDER1), 12 buttons, 1 hat, instance GUID `5C3A9E40-6D21-11EF-8001-444553540000` |
| `displays.json` | 1 monitor: BenQ GW2480, 1920x1080 at 60 Hz, HDMI, main display, three modes |
| `audio.json` | 2 endpoints, both Realtek onboard: Speakers (default and communications playback), Microphone (default and communications recording) |
| `processes.json` | 14 processes: Windows' own, `explorer.exe`, `chrome.exe`, `Discord.exe`, `notepad.exe`, `LCore.exe` (Logitech Gaming Software) |
| `services.json` | 6 ordinary Windows services (4 running, 2 stopped). No HidHide, ViGEm, Fanatec or iRacing service |
| `registry.json` | 6 keys: the joystick's DirectInput calibration slot and OEM name, and uninstall entries for Chrome, Logitech Gaming Software and Discord. No Steam, Eagle Dynamics, Fanatec, iRacing, NaturalPoint or Elgato key |
| `hidhide.json` | HidHide not installed |
| `files/` | 4 files: empty placeholders for `chrome.exe`, `LCore.exe` and `Discord.exe` (so detection by `exists()` works, as in `mark-full`) and `Documents/Notes/todo.txt`. No Steam library, no `Saved Games`, no game file |
| `rehome.json` | empty: no file holds a path |
| `meta.json` | counts, and `"synthetic": true` |

As in `mark-full`, process paths are left as they would be on the PC (`C:\Users\User\...`, `C:\Program Files\...`), and registry values are re-pointed at the fake home when a scenario starts.

## Scenarios on it

| Scenario | What it adds |
|---|---|
| `generic-fresh` | Nothing: the rig as written, no setups |
| `generic-custom-game` | A game RigReady has no module for ("Star Hauler"): `Games/Star Hauler/StarHauler.exe` and its settings, controls and a save under `Documents/Star Hauler` |
| `generic-dcs` | The standalone (not Steam) edition of DCS World: the Eagle Dynamics registry key, `Program Files/Eagle Dynamics/DCS World/bin/DCS.exe`, and `Saved Games/DCS/Config/options.lua`. Still no flight gear |

To change the rig, edit the JSON by hand and keep `meta.json`'s counts and `usb-tree.json` in step (the tree is what `buildUsbTree(devices)` in `src/core/usb.ts` returns).
