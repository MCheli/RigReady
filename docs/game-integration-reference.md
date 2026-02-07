# RigReady - Game Integration Reference

## Overview

This document provides detailed technical reference for integrating with each supported game, including configuration file locations, formats, keybinding structures, and known issues.

---

## Table of Contents

1. [DCS World](#dcs-world)
2. [iRacing](#iracing)
3. [MSFS 2024](#msfs-2024)
4. [BeamNG.drive](#beamngdrive)
5. [Le Mans Ultimate](#le-mans-ultimate)
6. [Comparative Summary](#comparative-summary)

---

## DCS World

### Installation Detection

| Variant | Detection Method |
|---------|------------------|
| Standalone Stable | Registry: `HKLM\SOFTWARE\Eagle Dynamics\DCS World` |
| Standalone OpenBeta | Registry: `HKLM\SOFTWARE\Eagle Dynamics\DCS World OpenBeta` |
| Steam | Steam library: `steamapps/common/DCSWorld` |

### Configuration Paths

| Path | Description |
|------|-------------|
| `{DCS_USER}/` | Base user data path |
| `{DCS_USER}/Config/` | Main configuration directory |
| `{DCS_USER}/Config/Input/` | All keybindings |
| `{DCS_USER}/Config/options.lua` | Graphics, audio, gameplay settings |
| `{DCS_USER}/Config/autoexec.cfg` | Override settings (user-created) |
| `{DCS_USER}/Config/MonitorSetup/` | Multi-monitor viewport configurations |
| `{DCS_USER}/Mods/` | User-installed mods |
| `{DCS_USER}/Liveries/` | Custom skins |
| `{DCS_USER}/Scripts/` | Custom Lua scripts |

**Note**: `{DCS_USER}` is typically:
- Stable: `C:\Users\{username}\Saved Games\DCS`
- OpenBeta: `C:\Users\{username}\Saved Games\DCS.openbeta`

### Keybinding Structure

```
{DCS_USER}/Config/Input/
├── {Aircraft1}/
│   ├── joystick/
│   │   ├── {Device Name} {UUID}.diff.lua
│   │   └── {Device Name2} {UUID}.diff.lua
│   ├── keyboard/
│   │   └── Keyboard.diff.lua
│   ├── mouse/
│   ├── trackir/
│   └── headtracker/
├── {Aircraft2}/
│   └── ...
└── modifiers.lua
```

**Key points:**
- Bindings are **per-aircraft AND per-device**
- Files are named: `{Device Name} {UUID}.diff.lua`
- UUID is port-specific (changes when USB port changes)
- `.diff.lua` files contain only changes from defaults

### Keybinding File Format (.diff.lua)

```lua
local diff = {
    ["axisDiffs"] = {
        ["a2001cdnil"] = {
            ["name"] = "Pitch",
            ["added"] = {
                [1] = {
                    ["key"] = "JOY_Y",
                },
            },
        },
    },
    ["keyDiffs"] = {
        ["d3001pnilu3001cd12vd1vpnilvu0"] = {
            ["added"] = {
                [1] = {
                    ["key"] = "JOY_BTN1",
                },
            },
            ["name"] = "Weapon Release",
        },
        ["d3002pnilu3002cd13vd1vpnilvu0"] = {
            ["added"] = {
                [1] = {
                    ["key"] = "JOY_BTN2",
                    ["reformers"] = {
                        [1] = "LCtrl",
                    },
                },
            },
            ["name"] = "Master Arm Toggle",
        },
    },
}
return diff
```

**Field meanings:**
- `keyDiffs` - Button bindings
- `axisDiffs` - Axis bindings
- `reformers` - Modifier keys (LCtrl, RCtrl, LShift, RShift, LAlt, RAlt)
- The encoded key (e.g., `d3001pnilu3001cd12vd1vpnilvu0`) is DCS's internal command ID

### Modifiers File

```
{DCS_USER}/Config/Input/{Aircraft}/modifiers.lua
```

Contains custom modifier configurations with UUID references.

### UUID/GUID Issues

**Problem**: Windows assigns different UUID when device plugged into different USB port.

**Impact**:
- Moving joystick = new UUID = bindings appear "lost"
- Windows updates can regenerate all UUIDs
- Driver updates can change device identification

**RigReady solution**:
1. Detect UUID changes by matching device name
2. Offer to migrate bindings to new UUID
3. Update both filename AND internal references

### MonitorSetup Format

```lua
-- {DCS_USER}/Config/MonitorSetup/my_setup.lua
_ = function(p) return p end

name = _('My Custom Setup')
description = 'Triple monitor with MFCDs'

Viewports = {
    Center = {
        x = 0,
        y = 0,
        width = 3440,
        height = 1440,
        viewDx = 0,
        viewDy = 0,
        aspect = 3440/1440,
    },
}

LEFT_MFCD = {
    x = 3440,
    y = 0,
    width = 800,
    height = 800,
}

RIGHT_MFCD = {
    x = 4240,
    y = 0,
    width = 800,
    height = 800,
}

UIMainView = Viewports.Center
```

### options.lua Format

```lua
options = {
    ["graphics"] = {
        ["visibRange"] = "High",
        ["aspect"] = 1.7777777777778,
        ["resolution"] = "1920x1080",
        ["multiMonitorSetup"] = "my_setup",
    },
    ["sound"] = {
        ["volume"] = 50,
    },
    ["gameplay"] = {
        ["showPilotBody"] = true,
    },
}
```

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| UUID changes | USB port change = lost bindings | RigReady UUID migration |
| Device name spaces | Some devices have leading spaces | Trim when matching |
| Module updates | Can reset specific bindings | Backup before updates |
| Disconnected devices | Opening controls clears bindings | Always connect all devices |

---

## iRacing

### Installation Detection

| Method | Location |
|--------|----------|
| Registry | `HKLM\SOFTWARE\iRacing.com\iRacingSim` |
| Default | `C:\Program Files (x86)\iRacing` |

### Configuration Paths

| Path | Description |
|------|-------------|
| `{DOCUMENTS}/iRacing/` | Base user data path |
| `{DOCUMENTS}/iRacing/app.ini` | Main settings (FFB, audio, etc.) |
| `{DOCUMENTS}/iRacing/controls.cfg` | Button/key mappings (BINARY) |
| `{DOCUMENTS}/iRacing/joyCalib.yaml` | Controller calibration |
| `{DOCUMENTS}/iRacing/setups/` | Car setups and per-car configs |
| `{DOCUMENTS}/iRacing/setups/{car}/controls.cfg` | Per-car controls (optional) |

### Keybinding Structure

iRacing uses a **binary format** for controls.cfg:
- Header: `GFCC`
- Not human-readable
- Requires specialized parsing

### joyCalib.yaml Format

```yaml
---
CalibrationInfo:
  DeviceList:
    - DeviceName: 'Simucube 2 Pro'
      InstanceGUID: '{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'
      AxisList:
        - Axis: 0
          AxisName: 'X Axis'
          CalibMin: 0
          CalibCenter: 32767
          CalibMax: 65535
        - Axis: 1
          AxisName: 'Y Rotation'
          CalibMin: 0
          CalibCenter: 32767
          CalibMax: 65535
    - DeviceName: 'Fanatec ClubSport Pedals V3'
      InstanceGUID: '{YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY}'
      AxisList:
        - Axis: 0
          AxisName: 'Throttle'
          CalibMin: 0
          CalibCenter: 0
          CalibMax: 65535
```

### app.ini Key Sections

```ini
[Force Feedback]
FFBEnabled=1
FFBDamping=0.000000
FFBBumpStopDeg=15.000000
FFBMinForce=0.000000
FFBMaxForce=50.000000
enableFFB360HzInterpolated=1
FanatecForceEnabled=1
SimucubeForceEnabled=1

[Sound]
soundVolume=1.000000
spotter=1

[Graphics]
ScreenWidth=3440
ScreenHeight=1440
WindowedMode=0
```

### Per-Car Controls

To enable per-car controls:
1. Check "Use custom controls for this car" in options
2. Creates `{DOCUMENTS}/iRacing/setups/{carname}/controls.cfg`
3. Creates `{DOCUMENTS}/iRacing/setups/{carname}/joyCalib.yaml`

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| Binary controls.cfg | Not human-editable | Use iRacing Controls Editor |
| USB port sensitivity | Port change = recalibration needed | Always use same ports |
| Edit timing | Don't edit while sim running | Exit completely before editing |

### External Tools

- [iRacing Controls Editor](https://github.com/jackhumbert/iracing-controls-editor-app) - Edit controls.cfg outside sim
- [iRacingConfig](https://bazwise.com/iracingconfig/) - Profile management

---

## MSFS 2024

### Installation Detection

| Install Type | Path |
|--------------|------|
| Microsoft Store | `{LOCALAPPDATA}\Packages\Microsoft.Limitless_8wekyb3d8bbwe\` |
| Steam | `{STEAM}\userdata\{USER_ID}\1250410\remote\` |

**Note**: Path may use "Microsoft.Limitless" or "Microsoft Flight Simulator 2024"

### Configuration Paths

**Microsoft Store:**
| Path | Description |
|------|-------------|
| `...\SystemAppData\wgs\{GUID}\` | Controller bindings (XML) |
| `...\LocalCache\UserCfg.opt` | Graphics settings |
| `...\LocalCache\FlightSimulator.CFG` | Simulator settings |
| `...\LocalCache\Packages\Community\` | Community folder |

**Steam:**
| Path | Description |
|------|-------------|
| `{STEAM}\userdata\{ID}\1250410\remote\` | Controller bindings |
| `{APPDATA}\Microsoft Flight Simulator 2024\` | Settings files |

### Keybinding Structure

MSFS 2024 uses a **three-tier hierarchy**:

| Level | Scope |
|-------|-------|
| General Controls | Universal (menus, cameras, drone) |
| Aircraft Category | Per category (Airplane, Helicopter, Glider) |
| Specific Aircraft | Individual aircraft model |

More specific overrides less specific.

### Binding File Format (XML)

```xml
<DefaulftInput Primary="1" PlatformAvailability="PC">
  <Device DeviceName="Thrustmaster HOTAS Warthog"
          GUID="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
          ProductID="0x0055"
          CompositeID="1">
    <Axis AxisName="X"
          AxisSensitivy="50"
          AxisDeadZone="5"
          AxisNeutral="0" />
    <Context ContextName="AIRPLANE">
      <Action ActionName="KEY_THROTTLE_AXIS" Flag="0">
        <Primary>
          <KEY Information="Joystick Axis Y" />
        </Primary>
      </Action>
    </Context>
  </Device>
</DefaulftInput>
```

### UserCfg.opt Notable Settings

```ini
[Terrain]
LoDFactor = 2.0

[Shadows]
Size = 4096

[PostProcess]
Enabled = 1
EyeAdaptation = 1
Sharpen = 1
Filmgrain = 0
Vignette = 0
```

### Cloud Sync

- Settings sync to Microsoft cloud automatically
- Deleting local files gets overwritten by cloud on next launch
- **Workaround**: Update file timestamps to trigger conflict dialog

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| No migration from 2020 | Bindings must be recreated | Manual reconfiguration |
| Cloud overwrites | Local edits get overwritten | Timestamp manipulation |
| Random-named files | WGS folder has cryptic filenames | Parse XML for device info |
| Identical device names | Can't distinguish duplicate devices | None (MSFS limitation) |

---

## BeamNG.drive

### Installation Detection

| Method | Location |
|--------|----------|
| Steam | `{STEAM}\steamapps\common\BeamNG.drive\` |
| Registry | `HKEY_CURRENT_USER\SOFTWARE\BeamNG\BeamNG.drive\userpath_override` |

### Configuration Paths

**User folder (v0.22+):**
```
{LOCALAPPDATA}\BeamNG.drive\{version}\
├── settings/
│   ├── inputmaps/           # Keybindings
│   │   ├── keyboard.diff
│   │   ├── wheel.diff
│   │   ├── {VID}{PID}.diff  # Device-specific
│   │   └── {vehicle}/       # Per-vehicle bindings
│   ├── cloud/
│   │   └── game-settings-cloud.ini
│   ├── imgui.ini
│   └── imguiSettings.json
├── vehicles/                # Custom vehicle configs
├── mods/                    # Installed mods
└── replays/
```

**Note**: Each major version has its own folder (0.31/, 0.32/, etc.)

### Keybinding Structure

BeamNG uses **JSON diff files**:
- `.json` - Factory defaults (in game folder)
- `.diff` - User customizations (only changes from defaults)

### File Naming Convention

| Identifier | Description | Example |
|------------|-------------|---------|
| `keyboard` | Keyboard bindings | `keyboard.diff` |
| `mouse` | Mouse bindings | `mouse.diff` |
| `wheel` | Generic wheel | `wheel.diff` |
| `gamepad` | Generic gamepad | `gamepad.diff` |
| `{VID}{PID}` | Specific device | `c29b046d.diff` (Logitech G27) |

### Binding File Format

**Factory default (keyboard.json):**
```json
{
  "bindings": [
    {"action": "menu_select", "control": "numpad9"},
    {"action": "menu_back", "control": "numpad7"}
  ]
}
```

**User customization (keyboard.diff):**
```json
{
  "bindings": [
    {"action": "menu_select", "control": "numpad3"},
    {"action": "accelerate", "control": "up", "filterType": "1"}
  ],
  "removed": [
    {"action": "menu_back", "control": "numpad7"}
  ]
}
```

### Per-Vehicle Bindings

```
settings/inputmaps/{vehicle_name}/*.diff
```

Isolated per vehicle - two vehicles with same action name don't interfere.

### Force Feedback

- Stored in wheel binding files
- Response curves: `.csv` or `.lut` files
- Hot-reload: `Ctrl+L` refreshes input system

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| Version folders | Each version has separate settings | Manual migration |
| Settings loss on update | Migration sometimes fails | Backup before updates |
| Only last change saves | Some binding changes don't persist | Use in-game UI |

---

## Le Mans Ultimate

### Installation Detection

| Method | Location |
|--------|----------|
| Steam | `{STEAM}\steamapps\common\Le Mans Ultimate\` |

### Configuration Paths

```
{STEAM}\steamapps\common\Le Mans Ultimate\UserData\
├── player/
│   ├── Settings.JSON           # Player settings
│   ├── direct input.json       # Wheel/controller config (note space!)
│   ├── keyboard.json           # Keyboard bindings
│   ├── gamepad.json            # Gamepad settings
│   ├── current_controls.json   # Active control config
│   └── Settings/               # Per-track car setups
├── Config_DX11.ini             # Graphics settings
├── Config_DX11_VR.ini          # VR graphics
└── Log/                        # Logs and shader cache
```

**Note**: Based on rFactor 2 engine - similar configuration patterns.

### Keybinding Structure

**Global bindings** (not per-car)

**Exception**: "Car specific multiplier" for FFB is saved per-car

### File Formats

**direct input.json:**
```json
{
  "Device Name 1": "Fanatec ClubSport Wheel Base V2.5=#0eb7001b",
  "options": {
    "Brake Sensitivity": 1.0,
    "Clutch Sensitivity": 1.0,
    "Steering Sensitivity": 0.5,
    "Steering Speed Sensitivity": 0.7
  },
  "axes": [...],
  "buttons": [...]
}
```

**Device identification format:**
```
DeviceName=#VIDPID
```
Where VIDPID is 8 hex chars from USB VID+PID.

**Settings.JSON:**
```json
{
  "DRIVER": {
    "Name": "Player",
    "Nickname": "PLY"
  },
  "Game Options": {
    "AI Strength": 100,
    "Fuel Strategy": 1
  }
}
```

### Multiple Wheel Profiles

**LMU does not support multiple profiles natively.**

**Workaround:**
1. Configure wheel
2. Copy `direct input.json` to backup (e.g., `direct_input_G29.json`)
3. To switch: copy backup back to `direct input.json`

RigReady can automate this swap.

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| No multi-profile | Can't switch wheel configs easily | RigReady profile swap |
| Space in filename | `direct input.json` has space | Handle in code |
| Button box issues | May stop after pit stops | Reset configuration |

---

## Comparative Summary

### File Formats

| Game | Binding Format | Config Format | Human Editable |
|------|---------------|---------------|----------------|
| DCS World | Lua (.diff.lua) | Lua | Yes |
| iRacing | Binary (controls.cfg) | YAML, INI | Partial |
| MSFS 2024 | XML | INI, CFG | Yes |
| BeamNG | JSON (.diff) | JSON, INI | Yes |
| Le Mans Ultimate | JSON | JSON, INI | Yes |

### Binding Scope

| Game | Scope | Notes |
|------|-------|-------|
| DCS World | Per-aircraft + per-device | Most complex |
| iRacing | Global + optional per-car | Per-car is opt-in |
| MSFS 2024 | Three-tier hierarchy | General/Category/Specific |
| BeamNG | Global + optional per-vehicle | Per-vehicle folders |
| Le Mans Ultimate | Global | Per-car FFB only |

### Device Identification

| Game | Method | Port-Sensitive |
|------|--------|----------------|
| DCS World | Name + UUID | Yes (UUID changes) |
| iRacing | Name + InstanceGUID | Yes |
| MSFS 2024 | Name + GUID + PID | Yes |
| BeamNG | VID/PID (8 hex chars) | Less sensitive |
| Le Mans Ultimate | Name + VID/PID hash | Less sensitive |

### Path Variables for RigReady

| Variable | Typical Value |
|----------|---------------|
| `{DCS_USER}` | `C:\Users\{user}\Saved Games\DCS` |
| `{IRACING}` | `C:\Users\{user}\Documents\iRacing` |
| `{MSFS_USER}` | `{LOCALAPPDATA}\Packages\Microsoft.Limitless_...\LocalCache` |
| `{BEAMNG_USER}` | `{LOCALAPPDATA}\BeamNG.drive\{version}` |
| `{LMU_USER}` | `{STEAM}\steamapps\common\Le Mans Ultimate\UserData` |

---

*Document Version: 1.0*
