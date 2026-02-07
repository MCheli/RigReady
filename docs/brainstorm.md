# RigReady - Brainstorming Document

## Overview

**Application Name**: RigReady
**Platform**: Windows Desktop Application
**Project Type**: Open Source

---

## Problem Statement

For people with complex simulator setups (flight sims, racing sims) who also use their computer for other purposes, the process of getting ready to sim is a chore:

- Plugging in the right equipment
- Ensuring the correct software/services are running
- Troubleshooting input device issues
- Managing different hardware configurations (VR vs monitors, different peripherals)

Additionally, configuration management is painful:
- A new computer can mean 10+ hours of setting up keybindings and configurations
- No easy way to backup, restore, or share configurations
- Settings are scattered across dozens of applications and config files

**RigReady simplifies "getting ready" to launch the simulator and provides tools for backing up, restoring, and sharing configurations.**

---

## Primary Usage Modes

### Mode 1: Pre-flight Check

**Context**: User knows what they want to fly/drive. They want confidence that everything is in place before launching the sim.

**Core Value**: Avoid the scenario where you launch a sim (which may take several minutes to load), only to realize something wasn't initialized or connected, forcing a restart.

**Example Scenario**:
> "I swap from my racing sim to my flight sim, launch DCS (which takes a while), and then realize I didn't initialize my MFD displays in SimAppPro. Now I need to close DCS and start over."

**Flow**:
1. Open RigReady (remembers last profile, easy to switch)
2. See a checklist of requirements for the selected profile
3. Green/red status for each item (hardware connected, software running, configs valid)
4. Fix any issues or get guidance on how to fix them
5. Launch the sim with confidence

---

### Mode 2: Configuration & Setup

**Context**: User is setting up their simulator configuration—either from scratch, restoring from backup, or making modifications.

**Core Value**: Make configuration management faster and more reliable than doing it manually. Provide backup/restore capabilities that work across machines.

**Use Cases**:
- New computer setup: Restore all configurations from backup
- Sharing configs: Export a configuration to share with others
- Making changes: Modify keybindings, hardware settings, software configs in a unified interface
- Version control: Track changes to configurations over time

---

### Mode 3: Active Session Tools (Future)

**Context**: User is actively in a sim session and needs assistance.

**Potential Features**:
- On-screen overlay showing button presses and what they're bound to
- Real-time hardware diagnostics
- Quick-switch between configurations without leaving the sim

*Note: This is a future expansion area, not initial scope.*

---

## Core Concepts

### Profiles

A **Profile** represents a complete "ready state" for a specific use case.

**Examples**:
- "DCS - Huey"
- "DCS - F/A-18"
- "iRacing - GT3"
- "MSFS - General Aviation"

**Profile Model**: Flat and independent (no inheritance)

Each profile is a self-contained list of:
- **Checklist items** to verify before launch
- **Configurations** to backup/restore
- **Launch target** (the game/sim to run)

**Profile Management Features**:
- **Clone profile**: Duplicate an entire profile as starting point for a new one
- **Copy from existing**: Cherry-pick specific checks/configs from other profiles
- **Remember last used**: Default to most recently used profile on launch

**Rationale**: Avoids complexity of inheritance/composition. Overlap between profiles (e.g., "TrackIR running") is handled through copy/clone tooling rather than formal relationships. If templates/inheritance prove necessary later, they can be added.

**Reality of profile overlap** (from real-world examples):

| Setup | Unique Hardware | Shared |
|-------|-----------------|--------|
| DCS F/A-18 | HOTAS, MFD panels, 3 MFD displays | TrackIR |
| DCS Huey | Joystick, Collective (no MFDs) | TrackIR |
| iRacing | Wheel, Pedals, Handbrake, Fanatec | TrackIR |

Even within the same sim, hardware requirements vary significantly. Profiles are more different than alike.

---

### Checklist Items

Each profile has a set of **checklist items** that must be satisfied for the rig to be "ready."

**Categories of checklist items**:

1. **Hardware Detection**
   - Is device X connected?
   - Is it recognized by Windows?
   - Is it on the correct USB port / has correct device ID?

2. **Software/Process Checks**
   - Is application X running?
   - Is service Y started?
   - Is process Z responding?

3. **Configuration Validation**
   - Does config file X exist and have expected values?
   - Are keybindings in place?
   - Are hardware calibration settings correct?

4. **Display/Monitor Setup**
   - Correct monitors connected?
   - Correct resolution/arrangement?

---

### Hardware Context

User's hardware doesn't necessarily change between sessions, but it's not always plugged in:

- Computer is used for other purposes (work, non-sim gaming)
- Different monitor setups for different use cases (ultrawide for sim cockpit vs 1440p for regular use)
- Peripherals get unplugged/replugged

RigReady should understand what hardware *should* be present for a given profile and detect what *is* present.

---

## Feature Brainstorm

### Pre-flight Check Features

- [ ] Profile selection (with memory of last used)
- [ ] Hardware detection and validation
- [ ] Process/service monitoring
- [ ] Configuration file validation
- [ ] Clear pass/fail status for each checklist item
- [ ] Guidance on how to fix failed items
- [ ] One-click launch of the sim (after checks pass)
- [ ] Auto-start required software before sim launch

### Configuration Management Features

- [ ] Backup configurations (full or selective)
- [ ] Restore configurations from backup
- [ ] Export configurations for sharing
- [ ] Import configurations from others
- [ ] Configuration file discovery (find where settings live)
- [ ] Unified view of keybindings across applications
- [ ] Version history / diff between configurations

### Hardware Management Features

- [ ] USB device identification and tracking
- [ ] Handle USB device ID swapping issues
- [ ] Hardware-specific integrations (e.g., Fanatec wheel settings)
- [ ] Device calibration status

### Power User Features

- [ ] User-defined scripts (pre-launch, post-launch, on-condition)
- [ ] Custom checklist items
- [ ] Configuration file editing
- [ ] Plugin/extension architecture for community contributions

### Active Session Features (Future)

- [ ] Button press overlay with binding display
- [ ] Real-time hardware monitoring
- [ ] Quick profile switching

### AI-Assisted Configuration (Future)

- [ ] Natural language prompts for FFB tuning (e.g., "make the wheel feel heavier in corners")
- [ ] AI interprets intent and adjusts configuration values
- [ ] Could extend to other complex configurations beyond FFB

---

## Technical Approach Notes

- **Extensible framework**: Generic capabilities + specific integrations
- **Plugin architecture**: Community can contribute integrations for specific hardware/software
- **Dual audience**: Accessible to non-technical users, but exposes advanced functionality for power users

**Generic vs Specific**:
- Generic: "Check if process X is running" - works for any software
- Specific: "Read Fanatec wheel settings from their config format" - hardware-specific integration

---

## User Persona

**Primary User**: Sim enthusiast with complex setup

- Multiple input devices (HOTAS, pedals, button boxes, MFDs, etc.)
- Multiple supporting applications (SimAppPro, VoiceAttack, SimHub, etc.)
- Uses computer for other things (work, other games)
- Likely technically capable, possibly IT/software background
- Values efficiency and reliability
- Frustrated by the "tax" of getting ready to sim

---

## Real-World Example: DCS F/A-18C Setup

This concrete example informs the checklist item model and reveals pain points.

### Hardware Requirements (~16 USB Devices)

| Category | Devices |
|----------|---------|
| Input | Keyboard, Mouse, Bluetooth headset |
| Flight Controls | Joystick, Throttle |
| Cockpit Panels | MFDs (physical button panels) |
| Displays | Ultrawide monitor, 3 MFD displays |

### Software Requirements

| Software | Requirement |
|----------|-------------|
| TrackIR | Must be running |
| SimAppPro | Must be running (manages MFD display positions) |
| StreamDeck | Software must be running |
| Windows Display Settings | Monitors in correct layout (position + rotation) |

### Configuration Requirements

| Configuration | Details |
|---------------|---------|
| DCS Keybindings | Correct bindings for F/A-18C (massive setup effort) |
| StreamDeck | Correct add-ons and modules installed/configured |
| DCS Monitor Config | MFD exports configured to display on MFD monitors |
| TrackIR Profile | Correct tracking profile loaded |

### Pain Points Discovered

1. **Monitor Rotation Hell**
   - MFD monitors are almost always rotated 90° wrong
   - Must manually fix in Windows Display Settings
   - Then must reconfigure SimAppPro with new positions
   - SimAppPro is complex and painful

2. **DCS Keybinding Chaos**
   - DCS auto-assigns default controls to EVERY connected device
   - Results in 10+ devices all bound to pitch/yaw/roll
   - Constant manual work to unbind unwanted defaults (e.g., MFD brightness knob from elevation)
   - Duplicate bindings cause conflicts

3. **TrackIR Not Running**
   - Launching DCS or iRacing without TrackIR running
   - Requires full restart of the sim
   - "Literally hours of my life"

4. **Configuration Restoration**
   - Setting up keybindings from scratch is a massive multi-hour task
   - No good way to backup/restore/verify bindings are correct

### Derived Checklist Item Types

From this example, we can identify distinct types of checks:

| Type | Example | Detection | Remediation |
|------|---------|-----------|-------------|
| **USB Device Present** | "Joystick connected" | Windows device enumeration | Alert user to plug in |
| **Process Running** | "TrackIR.exe running" | Process list check | Offer to launch it |
| **Display Layout** | "MFD monitors rotated correctly" | Windows display API | Auto-fix rotation/position |
| **Config File Valid** | "DCS keybindings present" | File exists + content check | Restore from backup |
| **Application State** | "TrackIR profile loaded" | App-specific integration | Load correct profile |

### Keybinding Management (Emerged as Major Feature)

The DCS keybinding problem deserves dedicated attention:

- **Problem**: DCS assigns defaults to every device, causing conflicts
- **Desired Solution**:
  - Detect duplicate bindings across devices
  - Clear bindings from devices that shouldn't have them
  - Restore known-good binding configuration
  - Understand DCS binding file format natively
  - Possibly: visual binding editor that's better than DCS's built-in

This could be a major differentiator for RigReady—keybinding management is universally painful.

**Scope**: Keybinding pain exists in other sims too (iRacing, MSFS, etc.). DCS is the priority for initial support, but the architecture should be extensible to support other games.

### Device Diagnostic Chain (Emerged as Key Flow)

Users need to move fluidly through this diagnostic progression:

```
1. Is it connected?     → Device detection
2. Is it recognized?    → Correct device ID, not swapped with another device
3. Is it responding?    → Input tester (press button, see response)
4. What's it bound to?  → Show bindings for this input across configurations
```

This connects **hardware detection**, **input testing**, and **keybinding management** into a unified experience.

**Requirements derived:**
- Device identity matters (specific device, not just device type)
- Input tester: visual feedback when buttons/axes are activated
- Binding inspector: given a button press, show what it's bound to in the target sim

### Pre-flight Check Remediation Model

When a check fails, the UI should offer contextual actions:

| Check Failed | Action Offered |
|--------------|----------------|
| TrackIR not running | "Launch TrackIR" button |
| Monitor rotated wrong | "Fix Display Settings" button (auto-fix) |
| Device not connected | "Show which device" (help user identify) |
| Keybindings missing | "Restore from backup" button |

The main "Launch Game" button launches the sim, but individual checks can have their own quick-fix actions.

### Research Complete: SimAppPro Analysis

#### What SimAppPro Does

**Core Features:**
- Hardware testing and calibration for WinWing devices
- Firmware updates from WinWing servers
- Device mode configuration (button/axis modes)
- vJoy macro programming
- Cloud profile management for keybindings
- DCS cockpit synchronization (backlights, vibration)
- MFD display configuration
- UFC/ICP dot-matrix display rendering

#### Monitor Configuration - How It Works

SimAppPro modifies DCS Lua files to configure MFD exports:

**Files Modified:**
| File | Location | Purpose |
|------|----------|---------|
| `MonitorSetup/*.lua` | `Saved Games/DCS/Config/` | Viewport definitions |
| `options.lua` | `Saved Games/DCS/Config/` | Monitor selection |
| `Export.lua` | `Saved Games/DCS/Scripts/` | WinWing export entry point |
| `wwtExport.lua` | `Saved Games/DCS/Scripts/wwt/` | Export logic |

**MonitorSetup.lua Format:**
```lua
Viewports = {
  Center = {
    x = 0, y = 0,
    width = screen.width,
    height = screen.height,
    viewDx = 0, viewDy = 0,
    aspect = screen.aspect,
  }
}
UIMainView = Viewports.Center
```

**Key Pain Point:** SimAppPro aggressively overwrites these files, even with "Close modification" checked. Users report losing custom configurations.

#### Keybinding Management

SimAppPro provides:
- Cloud backup/sharing of DCS keybindings
- "Create from game" to backup current bindings
- Download popularity indicators
- Profile serial numbers for tracking

Bindings are stored in standard DCS `.diff.lua` format - SimAppPro doesn't use a proprietary format.

#### What RigReady CAN Replace

| Feature | Replaceability | Notes |
|---------|---------------|-------|
| **Monitor/Viewport Configuration** | ✅ HIGH | Standard Lua format, well-documented |
| **Keybinding Management** | ✅ HIGH | Standard DCS Lua files |
| **Profile Backup/Sync** | ✅ HIGH | Could do better than SimAppPro's buggy cloud |
| **Export.lua Management** | ✅ HIGH | Could manage cleanly without overwriting |
| **Axis Curves/Response** | ✅ MEDIUM | DCS handles natively, limited in SimAppPro anyway |

#### What RigReady CANNOT Replace

| Feature | Why Tightly Coupled |
|---------|---------------------|
| **Firmware Updates** | Proprietary WinWing protocol |
| **Device Calibration** | Hardware-level, stored on device |
| **ICP/UFC Dot-Matrix Displays** | Requires SimAppPro's rendering engine |
| **Backlight/LED Sync** | Proprietary control protocol |
| **Vibration Motor Control** | Proprietary game sync |
| **Device Mode Configuration** | Button/axis mode switching |

#### Common User Complaints About SimAppPro

1. **Performance Impact**: FPS drops from 42 to 6 when running
2. **File Overwriting**: Overwrites user configs without warning
3. **Ignores Settings**: "Close modification" checkbox doesn't work
4. **Update Breakage**: Updates frequently break existing setups
5. **Cloud Sync Issues**: Upload failures, profile sync problems
6. **Perpetual Beta**: Still "beta" after years of development

#### RigReady Opportunity

**High-value replacement targets:**
1. **MonitorSetup management** - Create/edit/apply viewport configurations without SimAppPro's aggressive overwriting
2. **Better keybinding backup** - More reliable than SimAppPro's cloud
3. **Export.lua management** - Clean management of the export script chain
4. **Pre-flight validation** - Check that SimAppPro has correctly configured everything before launch

#### SimAppPro Runtime Requirements

**SimAppPro must be RUNNING during gameplay for:**
| Feature | Why |
|---------|-----|
| LED/Backlight Sync | Receives UDP telemetry, sends commands to hardware |
| UFC/ICP Dot-Matrix Displays | Renders text data to hardware displays |
| Vibration/Haptics | Processes flight data for motor control |

**SimAppPro NOT needed at runtime for:**
| Feature | Why |
|---------|-----|
| MFD LCD Screens | Standard Windows monitors once configured |
| Buttons/Switches/Axes | Standard HID devices |
| Static Backlighting | Preset brightness persists |

**Architecture:** Export scripts send UDP to `localhost:16536` where SimAppPro listens. Without SimAppPro running, the data "goes into the void."

**Implication for RigReady:**
- SimAppPro is a **runtime dependency** for advanced features, not just a configuration tool
- RigReady's pre-flight check should verify SimAppPro is running if the profile uses LED sync, UFC displays, or vibration
- MFD configuration can be fully handled by RigReady (just Windows monitors + DCS MonitorSetup.lua)

#### Coexistence Strategy

**Users need SimAppPro running for:**
- LED/backlight synchronization with cockpit state
- UFC/ICP dot-matrix display data
- Vibration feedback

**Users need SimAppPro occasionally for:**
- Initial hardware calibration
- Firmware updates
- Device mode configuration

**RigReady can fully replace:**
- MonitorSetup.lua management (MFD viewport configuration)
- Keybinding backup/restore
- Profile management
- Pre-flight validation

RigReady should focus on the "software configuration layer" and be a better citizen about not overwriting user files. For users with LED sync or UFC displays, RigReady should include "SimAppPro running" as a pre-flight check item.

### Pain Point: Swappable Hardware Variants

**Example**: Fanatec Podium with multiple wheel rims (Formula-style vs NASCAR circle)

**The Problem**:
- Wheel base is constant, but rims have different button layouts
- Game keybindings are tied to button numbers
- Swapping rims = all bindings are now wrong/mismatched
- User is forced to pick one rim per game to avoid rebinding hell

**Desired Solution**:
- Keybinding profiles that are hardware-variant-aware
- Swap rim → keybindings automatically adjust
- Could work for other swappable hardware (interchangeable button boxes, different grip modules, etc.)

**Open Question**: Can the system detect which rim is attached?
- If yes: Auto-detect and switch bindings
- If no: User manually indicates which variant is attached, RigReady swaps bindings

**Implication for Profiles**:
This suggests bindings might need a sub-layer:
```
Profile: "iRacing - GT3"
├── Hardware: Fanatec Podium
│   ├── Variant: Formula Rim → keybinding set A
│   └── Variant: NASCAR Rim → keybinding set B
```

Or the profile itself could be rim-specific ("iRacing GT3 - Formula Rim") with easy switching.

**Research Needed**: How does Fanatec driver report different rims to Windows?

**Decision**: Handle via separate profiles per rim (e.g., "iRacing GT3 - Formula Rim", "iRacing GT3 - NASCAR Rim"). This fits the flat profile model and avoids added complexity. Clone/copy tooling makes creating rim variants easy. May revisit variant selector in future if this proves cumbersome.

**Notes on Detection**:
- Windows may see different rims as different devices (needs confirmation)
- Fanatec software definitely knows which rim is attached
- Games can also identify the specific rim
- RigReady could potentially query Fanatec software/driver for rim detection

---

## Open Questions

### Resolved

1. ~~**Profile structure**~~: Flat, independent profiles. Clone + copy-from-existing for reusability.

2. ~~**Failure remediation**~~: Contextual quick-fix buttons per failed check (e.g., "Launch TrackIR"). Mix of auto-fix and guided remediation.

3. ~~**Launch integration**~~: Yes, RigReady has a "Launch" button for the sim. Pre-flight checks offer individual fix actions.

### Still Open

1. **Profile contents**: What exactly is stored in a profile vs. discovered dynamically? How is a checklist item defined?

2. **Checklist item definition**: How does a user define what needs to be checked? GUI? Config file? Both?

3. **Configuration scope**: Which applications' configs are in scope for backup/restore? User-defined? Pre-built integrations? Both?

4. **Sharing format**: What format for exported configurations? How to handle machine-specific paths?

5. **Device identity**: How does RigReady identify a specific device (not just device type)? USB VID/PID? Device instance path? User-assigned name?

6. **Extension model**: How do community contributors add support for new hardware/software? Plugin system? Config files? Code contributions?

7. **SimAppPro replacement**: Can RigReady handle DCS monitor/MFD configuration directly? (Research needed)

---

## MVP Scope

### Guiding Principle

**Generic first, specific later.** Prioritize features that work with any game/hardware through user configuration. Add specific integrations only when generic approaches aren't sufficient.

### Generic vs Specific Examples

| Generic (Higher Priority) | Specific (When Needed) |
|---------------------------|------------------------|
| Launch any EXE | Parse DCS keybinding format |
| Check if any process is running | Read Fanatec FFB settings |
| Detect any USB device by ID | Query TrackIR for active profile |
| Validate any config file exists | Understand WinWing configuration |
| Monitor any Windows service | StreamDeck profile management |

### Priority Integrations (When Specific Support Needed)

**Games:**
1. DCS World
2. MSFS 2024
3. iRacing
4. Le Mans Ultimate
5. BeamNG

**Hardware:**
1. WinWing (flight controls)
2. Fanatec (racing wheels/pedals)
3. StreamDeck (button box/macros)
4. TrackIR (head tracking)

---

## User Flows

### Flow 1: Daily Pre-flight Check

**Context**: User wants to sim. This is the most common use case.

```
1. User launches RigReady
   └── App opens, shows last-used profile (e.g., "DCS F/A-18")
   └── Profile switcher visible if user wants a different one

2. Pre-flight checklist displayed
   ├── ✅ TrackIR running
   ├── ✅ StreamDeck connected
   ├── ❌ SimAppPro not running
   ├── ✅ MFD monitors detected
   ├── ⚠️ MFD-2 rotated incorrectly
   └── ✅ DCS keybindings present

3. User addresses failures
   ├── Clicks "Launch" next to SimAppPro → app starts → check goes green
   └── Clicks "Fix" next to MFD rotation → RigReady auto-fixes → check goes green

4. All checks green
   └── "Launch Game" button enabled (or always enabled with warning?)

5. User clicks Launch
   └── DCS starts, user is simming
```

**UI Notes**:
- Checklist should be scannable at a glance (green/red/yellow icons)
- Failed checks show contextual action buttons
- Profile switching should be quick (dropdown or sidebar)
- Launch button prominent

---

### Flow 2: First-time Setup / Create Profile

**Context**: User just installed RigReady, or is creating a new profile.

```
1. User launches RigReady for the first time
   └── Welcome screen / empty state
   └── "Create your first profile" prompt

2. User starts profile creation
   ├── Names the profile (e.g., "DCS F/A-18")
   └── Selects the game/sim (browse for EXE or pick from known games)

3. Hardware detection (optional/assisted)
   ├── RigReady scans connected USB devices
   ├── Shows list: "We found these devices"
   ├── User selects which ones are required for this profile
   └── (Or user skips and adds manually later)

4. Software requirements
   ├── User adds required software (TrackIR, SimAppPro, etc.)
   ├── Browse for EXE, pick from known apps, or type process name
   └── For known apps, RigReady may auto-detect install location

5. Configuration files (optional)
   ├── User identifies config files to track/backup
   ├── For known games (DCS), RigReady suggests common config paths
   └── User can skip and add later

6. Profile saved
   └── User sees their first pre-flight checklist
   └── Can run checks immediately or refine profile
```

**Approach**: Hybrid (wizard + direct edit)

- **Wizard for onboarding**: Step-by-step guidance through concepts (devices, software, configs)
- **Direct editor after**: No wizard required for subsequent changes
- **JSON/YAML config file**: Human-readable format underlying everything

**Config File as Source of Truth**:

The profile's underlying format (JSON or YAML) is central to the architecture:
- What you backup/restore
- What you share with others
- What power users can edit directly (in text editor or IDE)
- What the wizard/UI generates and modifies
- Version-controllable (git-friendly)

This means technically-inclined users can bypass the UI entirely and edit configs directly.

---

### Flow 3: Clone/Copy Profile

**Context**: User wants to create a variant of an existing profile.

```
1. User views existing profile (e.g., "iRacing GT3 - Formula Rim")
   └── Clicks "Clone" or "Duplicate"

2. RigReady creates copy
   ├── Prompts for new name (e.g., "iRacing GT3 - NASCAR Rim")
   └── Opens new profile in editor

3. User modifies the clone
   ├── Changes hardware requirements (different wheel rim)
   ├── Adjusts keybinding references
   └── Saves

4. New profile available in profile list
```

**Alternative: Copy from existing**

```
1. User is creating/editing a profile
   └── Clicks "Copy from existing profile"

2. Profile picker appears
   └── User selects source profile

3. Item picker appears
   ├── Shows all checklist items from source
   └── User checkboxes which items to copy

4. Selected items added to current profile
```

---

### Flow 4: Backup Configuration

**Context**: User wants to save their setup for safety or portability.

```
1. User wants to backup their setup
   └── Navigates to backup/export function

2. Backup scope selection
   ├── "Backup everything" (all profiles + all tracked configs)
   ├── "Backup this profile" (single profile + its configs)
   └── "Custom selection" (pick specific items)

3. RigReady gathers configuration files
   ├── Collects all tracked config files (DCS bindings, TrackIR profiles, etc.)
   ├── Bundles with RigReady profile definitions
   └── Handles path normalization for portability

4. Export
   ├── Save as .rigready bundle (zip with JSON manifest?)
   └── Or: Save to cloud/sync location (future)

5. User has portable backup
   └── Can restore on same machine, new machine, or share with others
```

**Notes**:
- Bundle format should be portable across machines
- Path handling is critical (C:\Users\Mike\... won't work on another machine)
- Manifest describes what's in the bundle and where it goes

---

### Flow 5: Restore Configuration

**Context**: User has a backup and wants to restore (new machine, recovery, or importing shared config).

```
1. User has a .rigready backup file
   └── New machine, or recovering from issue

2. Opens RigReady, chooses "Restore from backup"
   └── Selects backup file

3. RigReady analyzes the backup
   ├── Shows what's included (profiles, config files)
   ├── Detects conflicts with existing configs
   └── Identifies missing dependencies (games not installed, etc.)

4. User confirms restore scope
   ├── Restore all vs. selective
   └── Overwrite existing vs. merge

5. RigReady restores
   ├── Copies config files to correct locations
   ├── Imports profile definitions
   └── Reports success/warnings

6. User runs pre-flight to verify
```

**Conflict handling options**:
- Overwrite: Replace existing with backup version
- Skip: Keep existing, don't restore this item
- Rename: Keep both (backup version gets suffix)
- Merge: Attempt to combine (complex, maybe future)

---

### Flow 6: Device Diagnostics

**Context**: User suspects a device issue or wants to verify hardware is working correctly.

```
1. User suspects a device issue
   └── Pre-flight shows device problem, OR
   └── User navigates to "Devices" section directly

2. Device list view
   ├── Shows all known devices (from profiles)
   ├── Shows currently connected devices
   └── Status indicator: connected/disconnected/unknown

3. User selects a device to inspect
   └── Opens device detail view

4. Device detail view shows:
   ├── Connection status (connected? recognized by Windows?)
   ├── Device identity (VID/PID, name, instance path)
   ├── "Is this the right device?" confirmation
   └── Input tester button

5. Input tester (live view)
   ├── Shows all buttons/axes on the device
   ├── Real-time feedback as user presses buttons/moves axes
   ├── "Press the button you want to identify" mode
   └── Shows raw input values

6. Binding inspector (optional deeper dive)
   ├── User presses a button
   ├── RigReady shows what that button is bound to in:
   │   ├── DCS (if applicable)
   │   ├── iRacing (if applicable)
   │   └── etc.
   └── Helps answer "what does this button do?"
```

**Notes**:
- Input tester is generic (works with any HID device)
- Binding inspector requires game-specific integration
- This flow unifies hardware detection → input testing → keybinding inspection

---

### Flow 7: Edit Profile

**Context**: User wants to modify an existing profile's checklist items or settings.

```
1. User wants to modify an existing profile
   └── Selects profile, clicks "Edit" (or right-click → Edit)

2. Profile editor opens
   ├── Shows all current checklist items grouped by type:
   │   ├── Hardware (devices required)
   │   ├── Software (processes that must be running)
   │   ├── Displays (monitor configuration)
   │   └── Configurations (files to validate/backup)
   └── Shows launch target (game EXE)

3. User makes changes
   ├── Add item: "Add check" → picks type → configures
   ├── Remove item: Select → Delete
   ├── Edit item: Click to expand → modify settings
   ├── Reorder: Drag to change order (affects checklist display)
   └── Copy from another profile: Import specific items

4. For each checklist item, user can configure:
   ├── What to check (device ID, process name, file path, etc.)
   ├── Display name (friendly name shown in checklist)
   ├── Remediation action (what happens when "Fix" is clicked)
   └── Required vs. optional (red failure vs. yellow warning)

5. User saves
   └── Changes written to profile JSON/YAML
   └── Returns to pre-flight view with updated checklist
```

**Alternative: Direct file edit**
```
1. Power user opens profile file in text editor
   └── ~/.rigready/profiles/dcs-fa18.yaml (or similar)

2. Edits YAML/JSON directly

3. Saves file
   └── RigReady picks up changes on next load (or live reload?)
```

---

### Flow 8: Keybinding Management

**Context**: User wants to manage, clean up, or backup keybindings for a game.

```
1. User navigates to "Keybindings" section
   └── Or: Pre-flight shows binding issue → "Manage Bindings" link

2. Game selector
   └── User picks which game's bindings to manage (DCS, iRacing, etc.)

3. Binding overview
   ├── Shows all devices with bindings in this game
   ├── Summary: "247 bindings across 8 devices"
   └── Warnings: "12 duplicate bindings detected"

4. Duplicate detection view
   ├── Lists all inputs bound to same action
   ├── Example: "Pitch Up" bound to:
   │   ├── Joystick Axis Y ✓ (intended)
   │   ├── MFD Panel Button 3 ✗ (accidental)
   │   └── Throttle Axis 2 ✗ (accidental)
   └── User can bulk-clear unwanted duplicates

5. Device binding view
   ├── Select a device
   ├── See all bindings on that device
   ├── "Clear all bindings on this device" (nuclear option for cleanup)
   └── Edit individual bindings

6. Binding backup/restore
   ├── "Save current bindings" → snapshot
   ├── "Restore bindings" → pick from saved snapshots
   └── Snapshots stored in RigReady, not just game's folder

7. Binding comparison (advanced)
   ├── Compare two snapshots
   ├── See what changed
   └── Useful for "what did I break?"
```

**Game-specific features** (example: DCS):
- Parse .lua binding files
- Understand per-aircraft vs. global bindings
- "Apply this binding set to another aircraft"

---

### Flow 9: Share Configuration

**Context**: User wants to share their setup with others (different from personal backup).

```
1. User wants to share their setup
   └── Navigates to "Share" or "Export for sharing"

2. Share scope selection
   ├── "Share this profile" (single profile)
   ├── "Share keybindings only" (just bindings, no hardware checks)
   └── "Share everything" (full export)

3. Privacy/portability review
   ├── RigReady flags machine-specific content:
   │   ├── Absolute paths (C:\Users\Mike\...)
   │   ├── Device instance IDs (may differ on other machines)
   │   └── Personal identifiers
   ├── User can review/redact
   └── RigReady normalizes paths where possible

4. Compatibility notes
   ├── "This config requires: DCS World, TrackIR, WinWing Orion"
   ├── Auto-generated based on profile contents
   └── Included in export as README/metadata

5. Export format selection
   ├── .rigready file (native, full fidelity)
   ├── Keybindings only (game-native format, e.g., DCS .lua)
   └── Human-readable summary (markdown/text)

6. User shares the file
   └── Discord, forums, GitHub, etc.
```

**Receiving a shared config**:
```
1. User downloads .rigready file from community

2. Opens in RigReady → "Import shared configuration"

3. RigReady analyzes compatibility
   ├── "This was made for WinWing Orion throttle"
   ├── "You have Virpil throttle - some bindings may not apply"
   └── Shows mapping suggestions or warnings

4. User imports selectively
   └── Takes what applies, skips what doesn't
```

---

## Data Model

### Core Entities

**Profile**
- The top-level container representing a "ready state"
- Has a name, description, last used timestamp
- References a LaunchTarget
- Contains checklist items
- References tracked configurations

**Game** (abstract base)
- Represents a game or simulator application
- Has name, executable path, install location detection
- Knows its configuration file locations
- Knows its keybinding format (if applicable)
- Concrete implementations for known games (DCS, iRacing, etc.)
- Generic implementation for unknown games (user specifies paths)

**ChecklistItem** (abstract base)
- Something to verify before launch
- Has name, description, required flag (true = red failure, false = yellow warning)
- Has optional remediation action
- Subtypes: ProcessCheck, DeviceCheck, DisplayCheck, ConfigCheck

**Device**
- A physical hardware device
- Identified by: vendor ID, product ID, serial number, instance path
- Has friendly name (user-assigned or auto-detected)
- Contains collection of Inputs

**Input**
- A single control on a device (button, axis, hat, etc.)
- Has type: button, axis, hat, rotary, slider
- Has index/identifier (button 1, axis X, etc.)
- Has optional friendly name ("Trigger", "Throttle Axis")
- Can report current value (for input tester)

**Configuration**
- A file or folder containing settings
- Has path (with variable tokens for portability)
- References the Game it belongs to
- Has validation rules (exists, contains value, etc.)
- Can be snapshotted for backup

**LaunchTarget**
- The executable to launch for a profile
- Has executable path, arguments, working directory
- May reference a Game entity (for known games)
- Or be a generic executable (for unknown games)

**Remediation**
- An action to fix a failed check
- Types:
  - `launch`: Start a process
  - `autofix`: RigReady fixes automatically (e.g., display rotation)
  - `restore`: Restore from backup
  - `notify`: Alert user with instructions

**Backup**
- A snapshot of configurations and/or profiles
- Contains metadata: date, source machine, RigReady version
- Contains profile definitions (YAML/JSON)
- Contains configuration file snapshots
- Portable format (.rigready bundle)

**Keybinding**
- A mapping from Input to game Action
- References: Device, Input, Game, Action
- May belong to a BindingSet (game-specific grouping)

**BindingSet** (game-specific, needs research)
- A grouping of keybindings
- In DCS: per-aircraft binding profiles
- In other games: may be global or per-vehicle
- Structure TBD based on research

---

### Entity Relationships

```
Profile
├── 1:1 LaunchTarget
├── 1:N ChecklistItem
│   └── 0:1 Remediation
├── M:N Configuration (tracked for backup)
└── 0:1 Game (if known game)

Game (abstract)
├── GenericGame (user-configured)
├── DCSWorld (specific implementation)
├── iRacing (specific implementation)
├── MSFS2024 (specific implementation)
├── LeMansUltimate (specific implementation)
└── BeamNG (specific implementation)

Game
├── knows config paths
├── knows keybinding format
└── has specialized workflows

ChecklistItem (abstract)
├── ProcessCheck
│   └── references process name/path
├── DeviceCheck
│   └── references Device
├── DisplayCheck
│   └── references display configuration
└── ConfigCheck
    └── references Configuration

Device
├── 1:N Input
└── M:N Profile (used by multiple profiles)

Input
├── belongs to Device
└── referenced by Keybinding

Configuration
├── belongs to Game
├── M:N Profile
└── can be snapshotted → Backup

Backup
├── contains N Profile definitions
├── contains N Configuration snapshots
└── has metadata

Keybinding
├── references Device + Input
├── references Game + Action
└── belongs to BindingSet (TBD)
```

---

### Abstract vs Concrete: Game Entity

```
Game (abstract)
├── name: string
├── executablePath: path
├── detectInstallation(): path | null
├── getConfigPaths(): path[]
├── getKeybindingFormat(): KeybindingFormat | null
└── getSpecializedChecks(): ChecklistItem[]

GenericGame extends Game
├── User provides all paths manually
└── No keybinding integration

DCSWorld extends Game
├── Auto-detects install from registry/common paths
├── Knows Saved Games/DCS/Config structure
├── Parses .lua keybinding files
├── Understands per-aircraft bindings
└── Offers DCS-specific checks (e.g., monitor export config)

iRacing extends Game
├── Auto-detects install
├── Knows config locations
├── Parses iRacing input config format
└── Offers iRacing-specific checks

(similar for MSFS2024, BeamNG, LeMansUltimate)
```

---

### Research Completed: Keybinding Formats

See "Game Configuration Research" section below for detailed findings on all five priority games.

**Key Insights for BindingSet Model**:

1. **Binding scope varies by game**:
   - DCS: Most complex - per-aircraft AND per-device
   - MSFS: Three-tier hierarchy
   - Others: Global with optional per-vehicle overrides

2. **File formats**:
   - JSON: LMU, BeamNG (easiest to parse)
   - Lua: DCS (well-documented, parseable)
   - XML: MSFS (standard parsing)
   - Binary: iRacing controls.cfg (requires special handling)

3. **Device identification is universally problematic**:
   - All games use some form of GUID/UUID/VID+PID
   - USB port changes break bindings in all games
   - RigReady can provide significant value by solving this

4. **BindingSet implementation should be game-specific**:
   - Abstract interface for common operations
   - Concrete implementations per game
   - iRacing may need to integrate existing community tools

---

## Object-Oriented Design

### Design Principles

1. **Separation of Concerns**: Each class has a single responsibility
2. **Open/Closed**: Open for extension (new games, new hardware), closed for modification
3. **Dependency Inversion**: Depend on abstractions (interfaces), not concrete implementations
4. **Composition over Inheritance**: Prefer composing behaviors rather than deep hierarchies

---

### Domain Area 1: Profile Management

```
┌─────────────────────────────────────────────────────────────┐
│ ProfileManager                                               │
├─────────────────────────────────────────────────────────────┤
│ - profiles: List<Profile>                                   │
│ - activeProfile: Profile                                    │
│ - lastUsedProfileId: string                                 │
├─────────────────────────────────────────────────────────────┤
│ + loadProfiles(): void                                      │
│ + saveProfile(profile: Profile): void                       │
│ + deleteProfile(profileId: string): void                    │
│ + cloneProfile(source: Profile, newName: string): Profile   │
│ + setActiveProfile(profileId: string): void                 │
│ + getActiveProfile(): Profile                               │
│ + importProfile(path: string): Profile                      │
│ + exportProfile(profile: Profile, path: string): void       │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ manages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Profile                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string (UUID)                                         │
│ - name: string                                              │
│ - description: string                                       │
│ - createdAt: DateTime                                       │
│ - lastUsed: DateTime                                        │
│ - game: Game                                                │
│ - launchTarget: LaunchTarget                                │
│ - checklistItems: List<ChecklistItem>                       │
│ - trackedConfigurations: List<TrackedConfiguration>         │
├─────────────────────────────────────────────────────────────┤
│ + runAllChecks(): ChecklistResult                           │
│ + getFailedChecks(): List<ChecklistItem>                    │
│ + addChecklistItem(item: ChecklistItem): void               │
│ + removeChecklistItem(itemId: string): void                 │
│ + copyItemsFrom(source: Profile, itemIds: List<string>): void│
│ + launch(): LaunchResult                                    │
│ + toYaml(): string                                          │
│ + fromYaml(yaml: string): Profile                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ references
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ LaunchTarget                                                 │
├─────────────────────────────────────────────────────────────┤
│ - executablePath: string                                    │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - runAsAdmin: boolean                                       │
│ - preLaunchActions: List<Action>                            │
│ - postLaunchActions: List<Action>                           │
├─────────────────────────────────────────────────────────────┤
│ + launch(): Process                                         │
│ + validatePath(): boolean                                   │
│ + executePreLaunchActions(): ActionResult                   │
└─────────────────────────────────────────────────────────────┘
```

---

### Domain Area 2: Checklist System

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> ChecklistItem                                  │
├─────────────────────────────────────────────────────────────┤
│ + id: string                                                │
│ + name: string                                              │
│ + description: string                                       │
│ + isRequired: boolean  (true=red failure, false=yellow warn)│
│ + category: CheckCategory                                   │
├─────────────────────────────────────────────────────────────┤
│ + check(): CheckResult                                      │
│ + getRemediation(): Remediation | null                      │
│ + getDisplayStatus(): DisplayStatus                         │
└─────────────────────────────────────────────────────────────┘
                              △
                              │ implements
        ┌─────────────────────┼─────────────────────┬────────────────────┐
        │                     │                     │                    │
        ▼                     ▼                     ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ ProcessCheck  │    │ DeviceCheck   │    │ DisplayCheck  │    │ ConfigCheck   │
├───────────────┤    ├───────────────┤    ├───────────────┤    ├───────────────┤
│ - processName │    │ - device:     │    │ - monitors:   │    │ - configPath  │
│ - windowTitle │    │   DeviceSpec  │    │   List<Mon>   │    │ - validation  │
│ - exePath     │    │ - inputTest   │    │ - layout      │    │ - backupRef   │
├───────────────┤    ├───────────────┤    ├───────────────┤    ├───────────────┤
│ + isRunning() │    │ + isConnected │    │ + checkLayout │    │ + validate()  │
│ + getPID()    │    │ + isCorrectID │    │ + checkRotate │    │ + fileExists()│
└───────────────┘    └───────────────┘    └───────────────┘    └───────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CheckResult                                                  │
├─────────────────────────────────────────────────────────────┤
│ - status: CheckStatus (PASSED | FAILED | WARNING | UNKNOWN) │
│ - message: string                                           │
│ - details: Map<string, any>                                 │
│ - timestamp: DateTime                                       │
│ - remediation: Remediation | null                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CheckCategory (enum)                                         │
├─────────────────────────────────────────────────────────────┤
│ HARDWARE                                                    │
│ SOFTWARE                                                    │
│ DISPLAY                                                     │
│ CONFIGURATION                                               │
│ CUSTOM                                                      │
└─────────────────────────────────────────────────────────────┘
```

**Remediation System:**

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> Remediation                                    │
├─────────────────────────────────────────────────────────────┤
│ + label: string  (button text, e.g., "Launch TrackIR")      │
│ + description: string                                       │
│ + canAutoFix: boolean                                       │
├─────────────────────────────────────────────────────────────┤
│ + execute(): RemediationResult                              │
│ + preview(): string  (describe what will happen)            │
└─────────────────────────────────────────────────────────────┘
                              △
                              │ implements
        ┌─────────────────────┼─────────────────────┬────────────────────┐
        │                     │                     │                    │
        ▼                     ▼                     ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ LaunchProcess │    │ AutoFixDisplay│    │ RestoreConfig │    │ NotifyUser    │
│ Remediation   │    │ Remediation   │    │ Remediation   │    │ Remediation   │
├───────────────┤    ├───────────────┤    ├───────────────┤    ├───────────────┤
│ - exePath     │    │ - targetLayout│    │ - backupRef   │    │ - message     │
│ - arguments   │    │ - rotations   │    │ - targetPath  │    │ - instructions│
├───────────────┤    ├───────────────┤    ├───────────────┤    ├───────────────┤
│ canAutoFix:   │    │ canAutoFix:   │    │ canAutoFix:   │    │ canAutoFix:   │
│ true          │    │ true          │    │ true          │    │ false         │
└───────────────┘    └───────────────┘    └───────────────┘    └───────────────┘
```

---

### Domain Area 3: Device Management

```
┌─────────────────────────────────────────────────────────────┐
│ DeviceManager                                                │
├─────────────────────────────────────────────────────────────┤
│ - connectedDevices: List<Device>                            │
│ - knownDevices: List<DeviceSpec>                            │
│ - deviceListeners: List<DeviceEventListener>                │
├─────────────────────────────────────────────────────────────┤
│ + scanDevices(): List<Device>                               │
│ + getConnectedDevices(): List<Device>                       │
│ + findDevice(spec: DeviceSpec): Device | null               │
│ + matchDevice(device: Device, spec: DeviceSpec): boolean    │
│ + onDeviceConnected(listener: DeviceEventListener): void    │
│ + onDeviceDisconnected(listener: DeviceEventListener): void │
│ + startInputCapture(device: Device): InputCaptureSession    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ manages
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Device                                                       │
├─────────────────────────────────────────────────────────────┤
│ - vendorId: string (VID)                                    │
│ - productId: string (PID)                                   │
│ - instancePath: string (Windows device instance)            │
│ - guid: string (DirectInput GUID - port specific)           │
│ - name: string (from driver)                                │
│ - friendlyName: string (user-assigned)                      │
│ - type: DeviceType                                          │
│ - inputs: List<Input>                                       │
│ - isConnected: boolean                                      │
├─────────────────────────────────────────────────────────────┤
│ + getIdentifier(): DeviceIdentifier                         │
│ + matchesSpec(spec: DeviceSpec): boolean                    │
│ + getInput(index: number, type: InputType): Input           │
│ + captureInput(timeout: ms): CapturedInput                  │
│ + toSpec(): DeviceSpec                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DeviceSpec (what a profile stores - portable)                │
├─────────────────────────────────────────────────────────────┤
│ - vendorId: string                                          │
│ - productId: string                                         │
│ - name: string (for display/matching fallback)              │
│ - friendlyName: string                                      │
│ - serialNumber: string | null (if available)                │
├─────────────────────────────────────────────────────────────┤
│ + matches(device: Device): MatchResult                      │
│ + getMatchScore(device: Device): number                     │
└─────────────────────────────────────────────────────────────┘

Note: DeviceSpec is what gets saved in profiles. It uses VID/PID
which are stable across USB ports, unlike GUID which changes.

┌─────────────────────────────────────────────────────────────┐
│ DeviceType (enum)                                            │
├─────────────────────────────────────────────────────────────┤
│ JOYSTICK                                                    │
│ THROTTLE                                                    │
│ PEDALS                                                      │
│ WHEEL                                                       │
│ BUTTON_BOX                                                  │
│ MFD_PANEL                                                   │
│ KEYBOARD                                                    │
│ MOUSE                                                       │
│ HEADTRACKER                                                 │
│ OTHER                                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Input                                                        │
├─────────────────────────────────────────────────────────────┤
│ - index: number                                             │
│ - type: InputType (BUTTON | AXIS | HAT | ROTARY | SLIDER)   │
│ - name: string (e.g., "Button 3", "X Axis")                 │
│ - friendlyName: string | null (user-assigned)               │
│ - currentValue: number                                      │
│ - minValue: number                                          │
│ - maxValue: number                                          │
├─────────────────────────────────────────────────────────────┤
│ + getValue(): number                                        │
│ + isPressed(): boolean  (for buttons)                       │
│ + getNormalizedValue(): number  (0.0 to 1.0)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ InputCaptureSession                                          │
├─────────────────────────────────────────────────────────────┤
│ - device: Device                                            │
│ - isActive: boolean                                         │
│ - capturedInputs: List<CapturedInput>                       │
│ - listeners: List<InputEventListener>                       │
├─────────────────────────────────────────────────────────────┤
│ + start(): void                                             │
│ + stop(): void                                              │
│ + onInput(listener: InputEventListener): void               │
│ + waitForInput(timeout: ms): CapturedInput                  │
│ + getLastInput(): CapturedInput                             │
└─────────────────────────────────────────────────────────────┘
```

---

### Domain Area 4: Game Integration

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> Game                                           │
├─────────────────────────────────────────────────────────────┤
│ + id: string                                                │
│ + name: string                                              │
│ + icon: Image                                               │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): InstallationInfo | null             │
│ + getConfigPaths(): List<ConfigPath>                        │
│ + getDefaultLaunchTarget(): LaunchTarget                    │
│ + getBindingManager(): BindingManager | null                │
│ + getSpecializedChecks(): List<ChecklistItem>               │
│ + supportsFeature(feature: GameFeature): boolean            │
└─────────────────────────────────────────────────────────────┘
                              △
                              │ implements
        ┌─────────────────────┼────────────────────┬───────────────────┐
        │                     │                    │                   │
        ▼                     ▼                    ▼                   ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ GenericGame   │    │ DCSWorld      │    │ IRacing       │    │ BeamNG        │
├───────────────┤    ├───────────────┤    ├───────────────┤    ├───────────────┤
│ User provides │    │ Auto-detects  │    │ Parses YAML   │    │ Handles       │
│ all paths     │    │ Saved Games   │    │ joyCalib      │    │ versioned     │
│ manually      │    │ Parses Lua    │    │ Binary ctrl   │    │ folders       │
│               │    │ Per-aircraft  │    │ Per-car opt   │    │ JSON .diff    │
└───────────────┘    └───────────────┘    └───────────────┘    └───────────────┘
        │                     │                    │                   │
        └─────────────────────┴────────────────────┴───────────────────┘
                                        │
                              also: MSFS2024, LeMansUltimate

┌─────────────────────────────────────────────────────────────┐
│ GameFeature (enum)                                           │
├─────────────────────────────────────────────────────────────┤
│ KEYBINDING_MANAGEMENT     (can read/write bindings)         │
│ PER_VEHICLE_BINDINGS      (supports per-aircraft/car)       │
│ MONITOR_CONFIGURATION     (has monitor setup files)         │
│ FFB_CONFIGURATION         (has force feedback settings)     │
│ CLOUD_SYNC                (syncs settings to cloud)         │
│ PROFILE_DETECTION         (can detect active profile)       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ InstallationInfo                                             │
├─────────────────────────────────────────────────────────────┤
│ - installPath: string                                       │
│ - version: string                                           │
│ - variant: string (e.g., "Steam", "Standalone", "OpenBeta") │
│ - userDataPath: string                                      │
│ - isValid: boolean                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ConfigPath                                                   │
├─────────────────────────────────────────────────────────────┤
│ - path: string (with variable tokens)                       │
│ - description: string                                       │
│ - category: ConfigCategory                                  │
│ - isRequired: boolean                                       │
│ - supportsBackup: boolean                                   │
├─────────────────────────────────────────────────────────────┤
│ + resolve(variables: Map<string, string>): string           │
│ + exists(): boolean                                         │
└─────────────────────────────────────────────────────────────┘
```

---

### Domain Area 5: Keybinding Management

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> BindingManager                                 │
├─────────────────────────────────────────────────────────────┤
│ + game: Game                                                │
├─────────────────────────────────────────────────────────────┤
│ + loadBindings(): BindingSet                                │
│ + saveBindings(bindings: BindingSet): void                  │
│ + getDevicesWithBindings(): List<DeviceSpec>                │
│ + getBindingsForDevice(device: DeviceSpec): List<Binding>   │
│ + findDuplicateBindings(): List<DuplicateBinding>           │
│ + clearBindingsForDevice(device: DeviceSpec): void          │
│ + migrateDeviceId(oldId: string, newId: string): void       │
│ + createSnapshot(name: string): BindingSnapshot             │
│ + restoreSnapshot(snapshot: BindingSnapshot): void          │
│ + compareSnapshots(a: BindingSnapshot, b: BindingSnapshot): BindingDiff│
└─────────────────────────────────────────────────────────────┘
                              △
                              │ implements
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ DCSBinding    │    │ IRacingBinding│    │ BeamNGBinding │
│ Manager       │    │ Manager       │    │ Manager       │
├───────────────┤    ├───────────────┤    ├───────────────┤
│ Parses Lua    │    │ Parses binary │    │ Parses JSON   │
│ .diff.lua     │    │ controls.cfg  │    │ .diff files   │
│ Per-aircraft  │    │ + YAML calib  │    │ Per-vehicle   │
│ UUID handling │    │               │    │ VID/PID names │
└───────────────┘    └───────────────┘    └───────────────┘

┌─────────────────────────────────────────────────────────────┐
│ BindingSet                                                   │
├─────────────────────────────────────────────────────────────┤
│ - game: Game                                                │
│ - scope: BindingScope (e.g., aircraft, car, global)         │
│ - scopeId: string | null (e.g., "FA-18C_hornet")            │
│ - bindings: List<Binding>                                   │
│ - devices: List<DeviceSpec>                                 │
├─────────────────────────────────────────────────────────────┤
│ + getBindingsForAction(action: string): List<Binding>       │
│ + getBindingsForInput(device: DeviceSpec, input: Input): List<Binding>│
│ + addBinding(binding: Binding): void                        │
│ + removeBinding(bindingId: string): void                    │
│ + findDuplicates(): List<DuplicateBinding>                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Binding                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - action: Action                                            │
│ - device: DeviceSpec                                        │
│ - input: InputSpec                                          │
│ - modifiers: List<Modifier> (Ctrl, Shift, Alt, etc.)        │
├─────────────────────────────────────────────────────────────┤
│ + matches(device: Device, input: Input): boolean            │
│ + getDisplayString(): string (e.g., "Ctrl+Button 3")        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Action                                                       │
├─────────────────────────────────────────────────────────────┤
│ - id: string (game-specific action ID)                      │
│ - name: string (display name)                               │
│ - category: string (e.g., "Flight Controls", "Weapons")     │
│ - description: string                                       │
│ - inputType: InputType (BUTTON | AXIS)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DuplicateBinding                                             │
├─────────────────────────────────────────────────────────────┤
│ - action: Action                                            │
│ - bindings: List<Binding>                                   │
│ - conflictType: ConflictType (SAME_ACTION | SAME_INPUT)     │
├─────────────────────────────────────────────────────────────┤
│ + getRecommendedResolution(): Binding (which to keep)       │
│ + getDevicesInvolved(): List<DeviceSpec>                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ BindingSnapshot                                              │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - createdAt: DateTime                                       │
│ - game: Game                                                │
│ - scope: BindingScope                                       │
│ - scopeId: string | null                                    │
│ - bindingSets: List<BindingSet>                             │
│ - rawFiles: Map<string, bytes> (original files)             │
├─────────────────────────────────────────────────────────────┤
│ + restore(): void                                           │
│ + compareTo(other: BindingSnapshot): BindingDiff            │
└─────────────────────────────────────────────────────────────┘
```

---

### Domain Area 6: Configuration Backup System

```
┌─────────────────────────────────────────────────────────────┐
│ BackupManager                                                │
├─────────────────────────────────────────────────────────────┤
│ - backupLocation: string                                    │
│ - backups: List<Backup>                                     │
├─────────────────────────────────────────────────────────────┤
│ + createBackup(options: BackupOptions): Backup              │
│ + restoreBackup(backup: Backup, options: RestoreOptions): RestoreResult│
│ + listBackups(): List<Backup>                               │
│ + deleteBackup(backupId: string): void                      │
│ + exportBackup(backup: Backup, path: string): void          │
│ + importBackup(path: string): Backup                        │
│ + validateBackup(backup: Backup): ValidationResult          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Backup                                                       │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - description: string                                       │
│ - createdAt: DateTime                                       │
│ - sourceMachine: MachineInfo                                │
│ - rigReadyVersion: string                                   │
│ - profiles: List<ProfileSnapshot>                           │
│ - configurations: List<ConfigurationSnapshot>               │
│ - bindingSnapshots: List<BindingSnapshot>                   │
│ - metadata: Map<string, any>                                │
├─────────────────────────────────────────────────────────────┤
│ + getContents(): BackupContents                             │
│ + getSize(): number                                         │
│ + isCompatibleWith(machine: MachineInfo): CompatibilityResult│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TrackedConfiguration                                         │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - description: string                                       │
│ - game: Game | null                                         │
│ - paths: List<ConfigPath>                                   │
│ - includePatterns: List<string> (glob patterns)             │
│ - excludePatterns: List<string>                             │
├─────────────────────────────────────────────────────────────┤
│ + snapshot(): ConfigurationSnapshot                         │
│ + validate(): ValidationResult                              │
│ + getFiles(): List<TrackedFile>                             │
│ + hasChangedSince(snapshot: ConfigurationSnapshot): boolean │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ConfigurationSnapshot                                        │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - configuration: TrackedConfiguration                       │
│ - createdAt: DateTime                                       │
│ - files: List<FileSnapshot>                                 │
│ - checksum: string                                          │
├─────────────────────────────────────────────────────────────┤
│ + restore(targetPath: string): RestoreResult                │
│ + compareTo(other: ConfigurationSnapshot): Diff             │
│ + getFile(relativePath: string): FileSnapshot               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PathVariableResolver                                         │
├─────────────────────────────────────────────────────────────┤
│ - variables: Map<string, string>                            │
├─────────────────────────────────────────────────────────────┤
│ + resolve(path: string): string                             │
│ + addVariable(name: string, value: string): void            │
│ + getStandardVariables(): Map<string, string>               │
└─────────────────────────────────────────────────────────────┘

Standard Variables:
  {USER}         → C:\Users\<username>
  {APPDATA}      → C:\Users\<username>\AppData\Roaming
  {LOCALAPPDATA} → C:\Users\<username>\AppData\Local
  {DOCUMENTS}    → C:\Users\<username>\Documents
  {DCS_USER}     → C:\Users\<username>\Saved Games\DCS
  {STEAM}        → C:\Program Files (x86)\Steam
  {IRACING}      → C:\Users\<username>\Documents\iRacing
  ... (game-specific variables)
```

---

### Research: Windows Display Configuration APIs

**Can RigReady programmatically modify Windows display settings?**

**Answer: Yes, fully supported without admin privileges.**

#### Capabilities Confirmed

| Setting | Programmable? | API |
|---------|--------------|-----|
| **Rotation** (0°, 90°, 180°, 270°) | ✅ Yes | `ChangeDisplaySettingsEx` with `dmDisplayOrientation` |
| **Position** (virtual desktop coordinates) | ✅ Yes | `ChangeDisplaySettingsEx` with `dmPosition` |
| **Resolution** | ✅ Yes | `ChangeDisplaySettingsEx` with `dmPelsWidth/Height` |
| **Primary Display** | ✅ Yes | Set position to (0,0) with `CDS_SET_PRIMARY` flag |
| **Refresh Rate** | ✅ Yes | `ChangeDisplaySettingsEx` with `dmDisplayFrequency` |

#### Key APIs

**Win32 (Primary):**
- `EnumDisplayDevices()` - List all monitors
- `EnumDisplaySettings()` - Get available modes
- `ChangeDisplaySettingsEx()` - Apply changes
- `QueryDisplayConfig()` / `SetDisplayConfig()` - Newer API (Windows 7+)

**No admin required** for standard display changes. The `CDS_UPDATEREGISTRY` flag persists changes across reboots.

#### Atomic Multi-Monitor Updates

For changing multiple monitors at once:
```c
// Stage changes (don't apply yet)
for each monitor:
    ChangeDisplaySettingsEx(deviceName, &devMode, NULL,
        CDS_UPDATEREGISTRY | CDS_NORESET, NULL);

// Apply all changes atomically
ChangeDisplaySettingsEx(NULL, NULL, NULL, 0, NULL);
```

#### Existing Tools/Libraries

| Tool | Notes |
|------|-------|
| **MultiMonitorTool** (NirSoft) | CLI for export/import of display configs |
| **WindowsDisplayAPI** (.NET) | NuGet package wrapping Win32 APIs |
| **display-changer (dc2)** | Powerful CLI tool |

#### Implications for RigReady

1. **"Auto-fix display rotation" is fully implementable** - can rotate MFD monitors programmatically
2. **Can save/restore entire display layouts** - position, rotation, resolution for all monitors
3. **No admin elevation needed** - runs as normal user
4. **Can verify before launch** - check current layout matches expected, fix if not

This validates the `AutoFixDisplayRemediation` class in our OO design.

---

### Domain Area 7: Display Management

```
┌─────────────────────────────────────────────────────────────┐
│ DisplayManager                                               │
├─────────────────────────────────────────────────────────────┤
│ - monitors: List<Monitor>                                   │
├─────────────────────────────────────────────────────────────┤
│ + getConnectedMonitors(): List<Monitor>                     │
│ + getDisplayLayout(): DisplayLayout                         │
│ + setDisplayLayout(layout: DisplayLayout): void             │
│ + matchesLayout(expected: DisplayLayout): LayoutMatchResult │
│ + fixRotation(monitor: Monitor, rotation: Rotation): void   │
│ + fixPosition(monitor: Monitor, x: int, y: int): void       │
│ + saveCurrentLayout(name: string): DisplayLayout            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Monitor                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - friendlyName: string                                      │
│ - resolution: Resolution                                    │
│ - position: Point                                           │
│ - rotation: Rotation (0 | 90 | 180 | 270)                   │
│ - isPrimary: boolean                                        │
│ - isConnected: boolean                                      │
├─────────────────────────────────────────────────────────────┤
│ + setRotation(rotation: Rotation): void                     │
│ + setPosition(x: int, y: int): void                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DisplayLayout                                                │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - monitors: List<MonitorSpec>                               │
├─────────────────────────────────────────────────────────────┤
│ + matches(current: List<Monitor>): LayoutMatchResult        │
│ + apply(): void                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ MonitorSpec (what gets saved - portable)                     │
├─────────────────────────────────────────────────────────────┤
│ - name: string (for matching)                               │
│ - friendlyName: string                                      │
│ - expectedResolution: Resolution                            │
│ - expectedPosition: Point                                   │
│ - expectedRotation: Rotation                                │
│ - isRequired: boolean                                       │
└─────────────────────────────────────────────────────────────┘
```

---

### Domain Area 8: Script Integration

Scripts provide extensibility for power users to create custom checks and actions.

#### Script Execution Model

RigReady executes scripts via **command line**, making it language-agnostic:
- `python script.py` - Python
- `lua script.lua` - Lua
- `powershell -File script.ps1` - PowerShell
- `node script.js` - Node.js
- `my_tool.exe --check` - Any executable
- `cmd /c script.bat` - Batch files

RigReady simply executes the command and interprets the exit code.

```
┌─────────────────────────────────────────────────────────────┐
│ ScriptCheck extends ChecklistItem                            │
├─────────────────────────────────────────────────────────────┤
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - successExitCodes: List<number> (default: [0])             │
│ - captureOutput: boolean                                    │
│ - environmentVariables: Map<string, string>                 │
├─────────────────────────────────────────────────────────────┤
│ + check(): CheckResult                                      │
│   - Executes command                                        │
│   - Returns PASSED if exit code in successExitCodes         │
│   - Returns FAILED otherwise                                │
│   - Captures stdout/stderr if captureOutput=true            │
│ + getRemediation(): ScriptRemediation | null                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ScriptRemediation extends Remediation                        │
├─────────────────────────────────────────────────────────────┤
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - requiresConfirmation: boolean                             │
├─────────────────────────────────────────────────────────────┤
│ + execute(): RemediationResult                              │
│ + preview(): string                                         │
│   - Returns description of what the script will do          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ScriptAction (for pre/post launch)                           │
├─────────────────────────────────────────────────────────────┤
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - continueOnError: boolean                                  │
│ - waitForCompletion: boolean                                │
│ - runHidden: boolean (no console window)                    │
├─────────────────────────────────────────────────────────────┤
│ + execute(): ActionResult                                   │
└─────────────────────────────────────────────────────────────┘
```

#### Environment Variables Injected by RigReady

Scripts receive context via environment variables:

| Variable | Example | Description |
|----------|---------|-------------|
| `RIGREADY_PROFILE_NAME` | "DCS F/A-18C" | Current profile name |
| `RIGREADY_PROFILE_ID` | "abc-123" | Profile unique ID |
| `RIGREADY_GAME_NAME` | "DCS World" | Game name |
| `RIGREADY_GAME_PATH` | "C:\DCS World" | Game install path |
| `RIGREADY_USER_DATA` | "C:\Users\...\Saved Games\DCS" | Game user data path |
| `RIGREADY_SCRIPTS_DIR` | "C:\Users\...\.rigready\scripts" | Default scripts folder |

#### Script Location

- Scripts can be located **anywhere** - full path required in configuration
- Default scripts directory: `{RIGREADY_HOME}/scripts/`
- Path variables supported: `{RIGREADY_SCRIPTS}/my_check.py`

#### Security Model

**Scripts are NOT included in shared configurations.**

When sharing a profile:
- Script references (path, description) are included
- Actual script files are excluded
- Recipient sees: "This profile references scripts that you'll need to create"
- Warning displayed when importing config with script references

```yaml
# What gets shared:
- type: script
  name: "Custom Hardware Check"
  description: "Verifies USB hub is powered on by checking device count"
  command: "python {RIGREADY_SCRIPTS}/check_usb_hub.py"
  # Note: Actual script file is NOT included in export

# Recipient sees:
# ⚠️ This profile references 1 script that is not included:
#    - check_usb_hub.py: "Verifies USB hub is powered on..."
```

**User responsibility:**
- Users are responsible for understanding what their scripts do
- No sandboxing - scripts run with user's full permissions
- RigReady does not validate or inspect script contents

#### Use Cases

**As Checklist Item (pre-flight check):**
```yaml
checks:
  - type: script
    name: "VPN Connected"
    description: "Verify connected to squadron VPN"
    command: "ping -n 1 192.168.50.1"
    timeout: 5000
    successExitCodes: [0]
    required: false  # Warning, not failure

  - type: script
    name: "USB Hub Powered"
    command: "python scripts/check_usb_devices.py"
    timeout: 3000
    successExitCodes: [0]
    required: true
    remediation:
      type: script
      label: "Power Cycle Hub"
      command: "python scripts/reset_usb_hub.py"
      requiresConfirmation: true
```

**As Launch Action:**
```yaml
launch:
  executable: "C:/DCS World/bin/DCS.exe"
  preLaunchScripts:
    - name: "Kill Conflicting Apps"
      command: "taskkill /IM discord.exe /F"
      continueOnError: true  # Don't fail if Discord isn't running

    - name: "Start Voice Attack"
      command: "C:/Program Files/VoiceAttack/VoiceAttack.exe"
      waitForCompletion: false  # Start and continue

  postLaunchScripts:
    - name: "Notify Discord"
      command: "python scripts/discord_webhook.py --status=flying"
      runHidden: true
```

---

### Cross-Cutting: Event System

```
┌─────────────────────────────────────────────────────────────┐
│ EventBus                                                     │
├─────────────────────────────────────────────────────────────┤
│ + subscribe<T>(eventType: Class<T>, handler: EventHandler<T>): Subscription│
│ + publish<T>(event: T): void                                │
│ + unsubscribe(subscription: Subscription): void             │
└─────────────────────────────────────────────────────────────┘

Events:
  - DeviceConnectedEvent
  - DeviceDisconnectedEvent
  - CheckCompletedEvent
  - ProfileChangedEvent
  - BackupCreatedEvent
  - ConfigurationChangedEvent
  - InputCapturedEvent
```

---

## Game Configuration Research

### Comparative Summary

| Game | Binding Format | Binding Scope | Device ID Method | Config Location |
|------|---------------|---------------|------------------|-----------------|
| DCS World | Lua (.diff.lua) | Per-aircraft + per-device | Name + UUID (port-specific) | Saved Games/DCS/ |
| MSFS 2024 | XML | Three-tier (General/Category/Aircraft) | Name + GUID + PID | AppData or Steam userdata |
| iRacing | Binary + YAML | Global + optional per-car | Name + InstanceGUID | Documents/iRacing/ |
| Le Mans Ultimate | JSON | Global (per-car FFB only) | Name + VID/PID hash | Steam/Le Mans Ultimate/UserData/ |
| BeamNG.drive | JSON (.diff) | Global + optional per-vehicle | VID/PID hex (8 chars) | AppData/Local/BeamNG.drive/ |

### Common Patterns Discovered

**Device Identification Issues (Universal Pain Point)**:
- All games struggle with USB port changes invalidating device IDs
- GUIDs/UUIDs are typically port-specific, not device-specific
- Changing USB ports = "lost" bindings in most games
- RigReady opportunity: Track devices by VID/PID and help migrate bindings when IDs change

**Binding Hierarchy Patterns**:
- Most games support some form of global + specific override
- DCS is most complex: per-aircraft + per-device
- MSFS has unique three-tier system (General → Category → Specific)
- Simpler games (LMU, BeamNG) are mostly global with vehicle-specific options

**File Format Landscape**:
- JSON is most common (LMU, BeamNG)
- Lua is DCS-specific but well-documented
- XML for MSFS
- iRacing's binary format is problematic (requires special tools)

---

### DCS World - Detailed Findings

**Keybinding Storage**:
```
C:\Users\<Username>\Saved Games\DCS\Config\Input\
├── <Aircraft>/
│   ├── joystick/
│   │   └── <Device Name> {UUID}.diff.lua
│   ├── keyboard/
│   └── mouse/
└── modifiers.lua
```

**Key Characteristics**:
- Bindings stored as Lua "diff" files (only changes from defaults)
- Organized by: Aircraft → Device Type → Specific Device
- Device identified by name + UUID in filename AND file content
- Modifiers (Ctrl, Shift, Alt) specified in `reformers` array

**UUID/GUID Problem (Major Pain Point)**:
- Windows assigns different UUID when device plugged into different USB port
- Moving joystick = new UUID = bindings appear "lost"
- Windows updates can regenerate all UUIDs
- Old .diff.lua files remain but don't match

**Other Config Files**:
| Path | Purpose |
|------|---------|
| `Config/options.lua` | Graphics, audio, gameplay settings |
| `Config/MonitorSetup/` | Multi-monitor viewport configurations |
| `Config/autoexec.cfg` | Override settings (user-created) |
| `Mods/` | User-installed mods |
| `Liveries/` | Custom skins |

**RigReady Opportunities**:
- Parse Lua diff files to understand bindings
- Detect UUID changes and offer to migrate bindings
- Backup/restore entire Input folder
- Detect duplicate bindings across devices
- MonitorSetup management (potential SimAppPro replacement)

---

### MSFS 2024 - Detailed Findings

**Keybinding Storage**:
```
# Microsoft Store
C:\Users\<Username>\AppData\Local\Packages\Microsoft.Limitless_8wekyb3d8bbwe\SystemAppData\wgs\

# Steam
C:\Program Files (x86)\Steam\userdata\<USER_ID>\1250410\remote\
```

**Key Characteristics**:
- XML format with random-looking filenames in WGS folder
- Three-tier hierarchy: General → Aircraft Category → Specific Aircraft
- More specific settings override less specific
- Cloud-synced (can cause conflicts)

**Device Identification**:
```xml
<Device DeviceName="[Name]"
        GUID="{...}"
        ProductID="[Hex PID]"
        CompositeID="[Integer]">
```

**Cloud Sync Issues**:
- Settings sync to Microsoft cloud
- Deleting local files gets overwritten by cloud version
- Can cause unexpected resets

**Other Config Files**:
| File | Purpose |
|------|---------|
| `UserCfg.opt` | Graphics, display, performance |
| `FlightSimulator.CFG` | Various simulator settings |
| `cameras.CFG` | Per-aircraft camera positions |

**RigReady Opportunities**:
- Detect installation type (Store vs Steam)
- Parse XML binding files
- Handle cloud sync issues (timestamp manipulation)
- Validate XML before restore

---

### iRacing - Detailed Findings

**Keybinding Storage**:
```
Documents\iRacing\
├── controls.cfg        # Binary - all button/key mappings
├── joyCalib.yaml       # YAML - calibration data
└── app.ini             # INI - FFB and other settings
```

**Key Characteristics**:
- controls.cfg is BINARY format (not human-editable)
- joyCalib.yaml is YAML (readable, contains calibration)
- Supports global + per-car controls
- Per-car files in: `Documents\iRacing\setups\<carname>\`

**Device Identification**:
```yaml
DeviceName: 'Simucube 2 Pro'
InstanceGUID: '{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}'
```

**Force Feedback** (in app.ini):
```ini
[Force Feedback]
FFBEnabled=1
FFBMaxForce=50.000000
FanatecForceEnabled=1
SimucubeForceEnabled=1
```

**Binary Format Challenge**:
- controls.cfg requires special tools to edit
- Community tool: [iRacing Controls Editor](https://github.com/jackhumbert/iracing-controls-editor-app)
- Can replace device GUIDs when hardware changes

**RigReady Opportunities**:
- Parse joyCalib.yaml for device info
- Integrate with or replicate iRacing Controls Editor functionality
- Backup/restore including binary controls.cfg
- Parse app.ini for FFB settings

---

### Le Mans Ultimate - Detailed Findings

**Keybinding Storage**:
```
<Steam>\steamapps\common\Le Mans Ultimate\UserData\player\
├── keyboard.json
├── direct input.json    # Note: space in filename
├── gamepad.json
└── current_controls.json
```

**Key Characteristics**:
- JSON format (human-readable)
- Based on rFactor 2 engine
- Mostly global bindings
- Per-car FFB multiplier saved separately

**Device Identification**:
```json
"Device Name 1": "Fanatec ClubSport Wheel Base V2.5=#0eb7001b"
```
Format: `DeviceName=#VIDPID` (8 hex chars from USB VID+PID)

**Other Config Files**:
| File | Purpose |
|------|---------|
| `Settings.JSON` | Player settings, game options |
| `Config_DX11.ini` | Graphics configuration |
| `Config_DX11_VR.ini` | VR graphics |
| `CustomPluginVariables.json` | Plugin settings |

**Known Issues**:
- No built-in multiple wheel profile support
- Workaround: manually swap direct input.json files
- Button boxes can stop working after pit stops

**RigReady Opportunities**:
- Parse JSON directly
- Implement wheel profile switching (swap JSON files)
- Track device VID/PID for hardware matching

---

### BeamNG.drive - Detailed Findings

**Keybinding Storage**:
```
C:\Users\<Username>\AppData\Local\BeamNG.drive\<version>\settings\inputmaps\
├── keyboard.diff       # Keyboard changes from defaults
├── wheel.diff          # Generic wheel bindings
├── c29b046d.diff       # Device-specific (VID/PID)
└── <vehicle>/          # Vehicle-specific bindings
    └── *.diff
```

**Key Characteristics**:
- JSON format with .diff extension for user changes
- Factory defaults: .json (in game folder)
- User customizations: .diff (only changes from defaults)
- Supports per-vehicle bindings in subfolders
- Versioned user folders (0.31/, 0.32/, etc.)

**Device Identification**:
- Generic types: `keyboard`, `mouse`, `wheel`, `gamepad`, `xidevice`
- Specific devices: VID/PID as 8 hex chars (e.g., `c29b046d` = Logitech G27)

**Force Feedback**:
- Stored in wheel binding files
- Response curves: `.csv` or `.lut` files
- Hot-reload with Ctrl+L

**Version Migration Challenge**:
- Each game version has separate settings folder
- Migration sometimes fails on updates
- Users lose settings quarterly

**RigReady Opportunities**:
- Parse JSON/diff files
- Handle version folder detection
- Migrate settings between versions
- Track VID/PID for device matching

---

## Next Steps

- [x] Define MVP scope and priorities
- [x] Map out detailed user flows for primary scenarios
- [x] Establish profile/checklist data model
- [x] Research keybinding formats for priority games
- [ ] Define configuration file format (YAML/JSON schema)
- [ ] Compare against existing repo implementation
- [ ] Create requirements list

---

*Document Status: Brainstorm Complete - Ready for Requirements Definition*
