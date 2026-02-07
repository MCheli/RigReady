# DCS Setup Requirements

## Overview
This document captures requirements for integrating DCS World setup and configuration into RigReady.

## Current DCS Installation
- **Config Location**: `C:\Users\Owner\Saved Games\DCS\Config\Input\`
- **Primary Module**: F/A-18C Hornet

## Detected Hardware

### WinWing F/A-18C Pit
| Device | Device ID | Status |
|--------|-----------|--------|
| UFC1 + HUD1 | 806E0610-B756-11f0-8026 | Configured |
| F18 Startup Panel | 806D90E0-B756-11f0-801E | Configured |
| Throttle Base1 + F15EX Handles | 806DDF00-B756-11f0-8022 | Partially Configured |
| MFD1-C (Right) | 806DDF00-B756-11f0-8021 | Configured |
| ICP | 806DB7F0-B756-11f0-8020 | Minimal Config |

### Other Controllers
| Device | Device ID | Status |
|--------|-----------|--------|
| T-Pendular-Rudder (Thrustmaster TPR) | 7F3956A0-B756-11f0-801B | Minimal Config |

## Current Keybinding Summary

### UFC1 + HUD1 (Most Complete)
- **Axes (7 configured)**:
  - HUD Symbology Brightness, Black Level, Balance, AOA Indexer knobs
  - UFC COMM 1/2 Volume, UFC Brightness knobs

- **Buttons (50+ configured)**:
  - UFC Function Selectors (A/P, IFF, TCN, ILS, D/L, BCN, ON/OFF)
  - UFC Keypad (0-9, CLR, ENT)
  - UFC Option Select 1-5
  - HUD switches (Reject, Video Control, Altitude, Attitude)
  - Heading/Course Set switches

### F18 Startup Panel
- **Axes (2 configured)**:
  - Position Lights Dimmer
  - Formation Lights Dimmer

- **Buttons (45+ configured)**:
  - Electrical: Battery, Generators, External Power, Ground Power 1-4
  - Fuel: Internal/External Tank controls, Fuel Dump, Probe
  - Engine: Crank, Anti-Ice, APU, Bleed Air
  - Lights: Strobe

### MFD1-C (Right)
- All 20 MFD pushbuttons mapped
- Brightness selector knob
- Brightness/Contrast controls

### Throttle, ICP, Rudder Pedals
- Only default axis removals (Pitch/Roll) to prevent conflicts
- No custom bindings yet

---

## Requirements for RigReady Integration

### Phase 1: Keybinding Detection & Display (Read-Only)
- [ ] Parse DCS Lua keybinding files (.diff.lua format)
- [ ] Display current bindings in a user-friendly UI
- [ ] Group bindings by:
  - Device (UFC, MFD, Throttle, etc.)
  - Category (Flight Controls, Weapons, Systems, etc.)
  - Type (Axis vs Button)
- [ ] Show binding conflicts (same button mapped to multiple actions)
- [ ] Show unmapped important actions

### Phase 2: Keybinding Editor
- [ ] Allow modifying existing bindings
- [ ] Add new bindings with device selection
- [ ] Remove bindings
- [ ] Configure axis properties:
  - Curvature
  - Deadzone
  - Invert
  - Saturation
- [ ] Write changes back to .diff.lua files
- [ ] Backup before modifying

### Phase 3: Stream Deck Integration
- [ ] Detect connected Stream Deck devices
- [ ] Map Stream Deck buttons to DCS commands
- [ ] Support for:
  - Button presses (keyboard simulation)
  - Button icons/images
  - Multi-action sequences
- [ ] Profile switching per aircraft module

### Phase 4: Profile Management
- [ ] Export complete aircraft profiles
- [ ] Import profiles from other users
- [ ] Profile templates for common hardware setups
- [ ] Sync bindings across multiple aircraft

---

## DCS Keybinding File Format Reference

### File Location Pattern
```
{DCS_SAVED_GAMES}\Config\Input\{MODULE}\{INPUT_TYPE}\{DEVICE_NAME} {DEVICE_GUID}.diff.lua
```

### Lua Structure
```lua
local diff = {
    ["axisDiffs"] = {
        ["a{id}cd{cockpit_device}"] = {
            ["name"] = "Human-readable name",
            ["added"] = {
                [1] = {
                    ["key"] = "JOY_X|JOY_Y|JOY_Z|JOY_RX|JOY_RY|JOY_RZ|JOY_SLIDER1|JOY_SLIDER2",
                    ["filter"] = {
                        ["curvature"] = { [1] = 0 },
                        ["deadzone"] = 0,
                        ["invert"] = false,
                        ["saturationX"] = 1,
                        ["saturationY"] = 1,
                        ["slider"] = false,
                    },
                },
            },
            ["removed"] = { ... },
        },
    },
    ["keyDiffs"] = {
        ["d{down}p{pressed}u{up}cd{cockpit_device}vd{value_down}vp{value_pressed}vu{value_up}"] = {
            ["name"] = "Human-readable name",
            ["added"] = {
                [1] = {
                    ["key"] = "JOY_BTN{N}|JOY_BTN_POV1_{U|D|L|R|UL|UR|DL|DR}",
                    ["reformers"] = { "LAlt", "LCtrl", ... },  -- modifiers
                },
            },
            ["removed"] = { ... },
        },
    },
}
return diff
```

### Key ID Decoding
- `d` = command ID for button down
- `p` = command ID for button pressed (held)
- `u` = command ID for button up
- `cd` = cockpit device ID
- `vd/vp/vu` = values sent for down/pressed/up

---

## Pending Setup Tasks

### Throttle Configuration
- [ ] Map throttle axes (left/right throttle, friction)
- [ ] Map throttle buttons (speed brake, TDC, etc.)
- [ ] Configure radar elevation axis

### HOTAS (If present)
- [ ] Stick axes (pitch, roll)
- [ ] Stick buttons (trigger, weapon release, etc.)

### Stream Deck
- [ ] Initial Stream Deck detection
- [ ] Map frequently used actions
- [ ] Create F/A-18C profile

---

## Notes
- DCS uses "diff" files that only contain changes from defaults
- Empty diff files only remove default bindings to prevent conflicts
- Device GUIDs are persistent but contain session-specific components

---

## Backup Analysis (C:\Users\Owner\Documents\DCS Backup)

### Backup Contents Summary

| Item | Path | Size/Count | Notes |
|------|------|------------|-------|
| Stream Deck Profiles | `Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup` | 59 MB | Elgato backup from Feb 2024 |
| Input Keybindings | `Input\` | 16 aircraft | Standalone keybinding copy |
| Full DCS Config | `DCS\` | Complete | Full Saved Games backup |
| Options | `DCS\Config\options.lua` | - | Graphics, sound, plugins |

### Aircraft with Backed Up Keybindings
- A-10C, A-10C II
- F-14B
- F-15C, F-15E, F-15E_WSO
- F-16C_50
- F-86F
- **FA-18C_hornet** (primary)
- J-11A
- Ka-50 III
- P-51D
- Su-27, Su-33
- UH-1H

### Backed Up Hardware Devices

| Device | Backup GUID | Current GUID | Match |
|--------|-------------|--------------|-------|
| WINWING Orion Joystick + JGRIP-F16 | D3437B70-A035-11EE-8001 | *Not detected* | N/A |
| WINWING THROTTLE BASE1 + F15EX | 4F6FD890-9AA7-11ee-8026 | 806DDF00-B756-11f0-8022 | NO |
| WINWING UFC1 + HUD1 | 4F2206B0-9AA7-11ee-8023 | 806E0610-B756-11f0-8026 | NO |
| WINWING F18 STARTUP PANEL | 4B36E9D0-9AA7-11ee-801D | 806D90E0-B756-11f0-801E | NO |
| WINWING F18 TAKEOFF PANEL 2 | 4F222DC0-9AA7-11ee-8024 | *Not detected* | N/A |
| WINWING MFD1-C | 4F916A50-9AA7-11ee-8027 | 806DDF00-B756-11f0-8021 | NO |
| WINWING MFD1-L | 4B3710E0-9AA7-11EE-801E | *Not detected* | N/A |
| WINWING MFD1-R | 5206D720-9AA7-11EE-8028 | *Not detected* | N/A |
| WINWING ICP | E4951350-A69F-11ee-8007 | 806DB7F0-B756-11f0-8020 | NO |
| T-Pendular-Rudder | 4770BA10-9AA7-11ee-801C | 7F3956A0-B756-11f0-801B | NO |
| R-VPC Panel #1 | 4BB05F90-9AA7-11ee-8021 | *Not detected* | N/A |

**ISSUE**: Device GUIDs have changed between backup and current install. Files cannot be copied directly - bindings must be migrated.

### Backup Keybinding Quality (FA-18C_hornet)

#### Joystick (Orion + JGRIP-F16)
- **Axes**: Pitch (0.15 curvature), Wheel Brake (slider, inverted), TDC H/V
- **Buttons**: Trigger, Weapon Release, Sensor Control (4-way), Weapon Select (Sparrow/Gun/AMRAAM/Sidewinder), Undesignate/NWS, Paddle, TDC Depress, Radar Elevation Up/Down
- **Trim**: POV hat mapped to trimmer (view removed)
- **View**: Center view on BTN19 + BTN36

#### Throttle (F15EX Handles)
- **Axes**: Thrust L/R (split), TDC H/V (on throttle)
- **Buttons**: Throttle Idle/Off L/R, TDC Depress, Radar Elevation, COMM 1/2, Cage/Uncage, Chaff/Flare Dispense, RAID/FLIR FOV, Speed Brake (3-pos), ATC, Exterior Lights, Pilot Salute, Zoom In/Out

### Backed Up Graphics Settings
- Resolution: 7424x1440 (triple monitor)
- Multi-monitor: "wwtMonitor" profile
- Max FPS: 180
- FOV: 78
- Terrain: Minimum textures
- Clouds: Level 1

### Restoration Strategy

#### Option A: GUID Translation (Recommended)
1. Parse backup files and extract bindings
2. Create new files with current GUIDs
3. Preserve all binding configurations

#### Option B: Manual Copy + Rename
1. Copy backup files to current Input folder
2. Rename files to match current GUIDs
3. Risk: May miss some mappings if devices changed

#### Option C: In-Game Import
1. Use DCS in-game profile import
2. Limited - doesn't support cross-device migration

### Immediate Action Items

- [x] Document backup contents
- [x] Create GUID mapping table
- [x] Restore F/A-18C joystick bindings
- [x] Restore F/A-18C throttle bindings
- [x] Restore F/A-18C UFC + HUD bindings
- [x] Restore F/A-18C Startup Panel bindings
- [x] Restore F/A-18C Takeoff Panel bindings
- [x] Restore F/A-18C MFD L/C/R bindings
- [x] Restore F/A-18C Rudder Pedals bindings
- [x] Restore F/A-18C VPC Panel bindings
- [x] Restore Stream Deck profile (Completed 2026-02-01: DCS-BIOS + Plugin + 9 profiles restored)
- [x] Test restored bindings in DCS (CONFIRMED WORKING 2026-02-01)

---

## Restoration Log (2026-02-01)

### Files Restored

| Device | Backup GUID | Current GUID | Status |
|--------|-------------|--------------|--------|
| WINWING Orion Joystick + JGRIP-F16 | D3437B70-A035-11EE-8001 | 806DDF00-B756-11f0-8023 | RESTORED |
| WINWING THROTTLE BASE1 + F15EX | 4F6FD890-9AA7-11ee-8026 | 806DDF00-B756-11f0-8022 | RESTORED |
| WINWING UFC1 + HUD1 | 4F2206B0-9AA7-11ee-8023 | 806E0610-B756-11f0-8026 | RESTORED |
| WINWING F18 STARTUP PANEL | 4B36E9D0-9AA7-11ee-801D | 806D90E0-B756-11f0-801E | RESTORED |
| WINWING F18 TAKEOFF PANEL 2 | 4F222DC0-9AA7-11ee-8024 | 806E0610-B756-11f0-8025 | RESTORED |
| WINWING MFD1-C | 4F916A50-9AA7-11ee-8027 | 806DDF00-B756-11f0-8021 | RESTORED |
| WINWING MFD1-L | 4B3710E0-9AA7-11EE-801E | 7F3956A0-B756-11f0-801A | RESTORED |
| WINWING MFD1-R | 5206D720-9AA7-11EE-8028 | 806E0610-B756-11f0-8024 | RESTORED |
| T-Pendular-Rudder | 4770BA10-9AA7-11ee-801C | 7F3956A0-B756-11f0-801B | RESTORED |
| R-VPC Panel #1 | 4BB05F90-9AA7-11ee-8021 | DF6F4BD0-FA0C-11f0-8002 | RESTORED |
| WINWING ICP | N/A (no backup) | 806DB7F0-B756-11f0-8020 | UNCHANGED |

### Backup Location
Original config backed up to: `C:\Users\Owner\Saved Games\DCS\Config\Input\FA-18C_hornet.backup\`

### Key Bindings Restored

**Joystick (Orion + JGRIP-F16)**
- Pitch axis with 0.15 curvature
- Wheel brake on slider (inverted)
- TDC on RX/RY axes
- Trigger (2nd detent), Weapon Release
- Sensor Control (4-way hat)
- Weapon Select: Sparrow, Gun, AMRAAM, Sidewinder
- Undesignate/NWS, Paddle (A/P disengage)
- Trim on POV hat (view commands removed)
- View Center on BTN19 + BTN36
- Radar Elevation Up/Down

**Throttle (F15EX Handles)**
- Split throttle L/R axes
- TDC on X/Y axes (50% saturation)
- TDC Depress, Radar Elevation
- COMM 1/2 switches
- Cage/Uncage, Chaff/Flare Dispense
- Speed Brake (3-position)
- ATC, Exterior Lights
- Throttle Idle/Off detents
- Zoom In/Out

**Rudder Pedals (TPR)**
- Rudder axis on JOY_Z
- Wheel Brake Left/Right on Y/X axes

**UFC + HUD**
- Full UFC keypad (0-9, CLR, ENT)
- UFC Option Select 1-5
- Function selectors (A/P, IFF, TCN, ILS, D/L, BCN, ON/OFF)
- ADF switch, EMCON button
- HUD brightness/black level/balance/AOA knobs
- COMM 1/2 volume and channel selectors

**MFDs (L/C/R)**
- All 20 pushbuttons per MFD
- Brightness/Contrast controls
- AMPCD controls on center MFD

**Startup/Takeoff Panels**
- Battery, generators, ground power
- Engine crank, APU, bleed air
- Fuel controls, probe extend
- Lights (strobe, position, formation)
- Flaps, gear, launch bar, hook
- Emergency jettison, selective jettison
