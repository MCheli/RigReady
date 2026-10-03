# RigReady - Requirements Document

## Overview

**Application**: RigReady
**Platform**: Windows Desktop Application
**License**: Open Source

**Purpose**: Simplify the process of getting ready to launch flight and racing simulators by providing pre-flight checks, configuration management, and backup/restore capabilities.

---

## Table of Contents

1. [Functional Requirements](#functional-requirements)
   - [FR1: Profile Management](#fr1-profile-management)
   - [FR2: Pre-flight Check System](#fr2-pre-flight-check-system)
   - [FR3: Device Management](#fr3-device-management)
   - [FR4: Configuration Backup & Restore](#fr4-configuration-backup--restore)
   - [FR5: Keybinding Management](#fr5-keybinding-management)
   - [FR6: Display Management](#fr6-display-management)
   - [FR7: Game Integration](#fr7-game-integration)
   - [FR8: Script Integration](#fr8-script-integration)
   - [FR9: Sharing & Portability](#fr9-sharing--portability)
2. [Non-Functional Requirements](#non-functional-requirements)
3. [MVP Scope](#mvp-scope)
4. [Future Scope](#future-scope)

---

## Functional Requirements

### FR1: Profile Management

A profile represents a complete "ready state" for a specific simulator configuration.

#### FR1.1: Profile CRUD Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.1.1 | User can create a new profile with a name and description | MVP |
| FR1.1.2 | User can edit an existing profile | MVP |
| FR1.1.3 | User can delete a profile | MVP |
| FR1.1.4 | User can clone an existing profile to create a new one | MVP |
| FR1.1.5 | User can copy specific checklist items from one profile to another | MVP |

#### FR1.2: Profile Selection & Memory

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.2.1 | System remembers the last used profile and selects it on launch | MVP |
| FR1.2.2 | User can quickly switch between profiles from the main UI | MVP |
| FR1.2.3 | System displays last used timestamp for each profile | MVP |

#### FR1.3: Profile Storage

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1.3.1 | Profiles are stored as human-readable YAML or JSON files | MVP |
| FR1.3.2 | Profile files are stored in a user-accessible location | MVP |
| FR1.3.3 | Power users can edit profile files directly in a text editor | MVP |
| FR1.3.4 | System detects and loads changes to profile files on disk | Future |

---

### FR2: Pre-flight Check System

The core feature - verify everything is ready before launching a simulator.

#### FR2.1: Check Execution

| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.1.1 | System runs all checklist items for the selected profile | MVP |
| FR2.1.2 | Each check displays a status: PASSED, FAILED, WARNING, or UNKNOWN | MVP |
| FR2.1.3 | Checks are categorized by type: Hardware, Software, Display, Configuration, Custom | MVP |
| FR2.1.4 | Failed required checks are displayed in red | MVP |
| FR2.1.5 | Failed optional checks are displayed in yellow (warning) | MVP |
| FR2.1.6 | Checks can be run individually or all at once | MVP |
| FR2.1.7 | System displays overall readiness status (Ready / Not Ready) | MVP |

#### FR2.2: Check Types

| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.2.1 | **Process Check**: Verify a Windows process is running by name or path | MVP |
| FR2.2.2 | **Device Check**: Verify a USB device is connected by VID/PID | MVP |
| FR2.2.3 | **Display Check**: Verify monitors match expected layout (position, rotation, resolution) | MVP |
| FR2.2.4 | **Config Check**: Verify a configuration file exists and optionally validate contents | MVP |
| FR2.2.5 | **Script Check**: Run a user script and check exit code for pass/fail | MVP |

#### FR2.3: Remediation Actions

| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.3.1 | Failed checks can have an associated remediation action | MVP |
| FR2.3.2 | **Launch Process**: Start an application when clicked | MVP |
| FR2.3.3 | **Auto-fix Display**: Programmatically fix monitor rotation/position | MVP |
| FR2.3.4 | **Restore Config**: Restore a configuration file from backup | MVP |
| FR2.3.5 | **Notify User**: Display instructions for manual remediation | MVP |
| FR2.3.6 | **Run Script**: Execute a user script as remediation | MVP |
| FR2.3.7 | Remediation buttons are displayed next to failed checks | MVP |
| FR2.3.8 | Some remediations can be marked as requiring user confirmation | MVP |

#### FR2.4: Launch Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR2.4.1 | Profile specifies a launch target (executable path, arguments, working directory) | MVP |
| FR2.4.2 | "Launch" button is prominently displayed | MVP |
| FR2.4.3 | Launch button is enabled regardless of check status (with warning if checks failed) | MVP |
| FR2.4.4 | Pre-launch scripts execute before the game starts | MVP |
| FR2.4.5 | Post-launch scripts execute after the game starts | MVP |
| FR2.4.6 | Pre-launch scripts can be configured to block launch on failure | MVP |

---

### FR3: Device Management

Detect, identify, and test input devices.

#### FR3.1: Device Detection

| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.1.1 | System enumerates all connected USB HID devices | MVP |
| FR3.1.2 | Devices are identified by Vendor ID (VID) and Product ID (PID) | MVP |
| FR3.1.3 | System displays device friendly name (from driver or user-assigned) | MVP |
| FR3.1.4 | User can assign a custom friendly name to a device | MVP |
| FR3.1.5 | System detects when devices are connected or disconnected | Future |

#### FR3.2: Device Specification in Profiles

| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.2.1 | Profiles reference devices by VID/PID (not GUID, which is port-specific) | MVP |
| FR3.2.2 | Device checks match by VID/PID for portability across USB ports | MVP |
| FR3.2.3 | Optional matching by serial number for distinguishing identical devices | Future |

#### FR3.3: Input Testing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.3.1 | User can open an input tester for any connected device | MVP |
| FR3.3.2 | Input tester shows all buttons and axes on the device | MVP |
| FR3.3.3 | Input tester displays real-time feedback when buttons are pressed or axes moved | MVP |
| FR3.3.4 | Input tester shows raw input values | MVP |
| FR3.3.5 | "Press any button" mode to identify an unknown input | MVP |

#### FR3.4: Binding Inspector

| ID | Requirement | Priority |
|----|-------------|----------|
| FR3.4.1 | Given a device and input, show what it's bound to in the current game | Future |
| FR3.4.2 | Works with games that have keybinding integration (DCS, etc.) | Future |

---

### FR4: Configuration Backup & Restore

Backup, restore, and version configuration files.

#### FR4.1: Tracked Configurations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.1.1 | User can define configuration files/folders to track for a profile | MVP |
| FR4.1.2 | Configurations can be associated with a specific game | MVP |
| FR4.1.3 | Path variables (e.g., {DCS_USER}, {APPDATA}) enable portability | MVP |
| FR4.1.4 | Include/exclude patterns (glob) for selective file tracking | MVP |

#### FR4.2: Backup Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.2.1 | User can create a backup of all tracked configurations | MVP |
| FR4.2.2 | User can create a backup of a single profile's configurations | MVP |
| FR4.2.3 | User can create a backup of specific configurations (selective) | MVP |
| FR4.2.4 | Backups include metadata: date, source machine, RigReady version | MVP |
| FR4.2.5 | Backups are stored in a portable format (.rigready bundle) | MVP |
| FR4.2.6 | Backups can be exported to a user-specified location | MVP |

#### FR4.3: Restore Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.3.1 | User can restore from a backup file | MVP |
| FR4.3.2 | System analyzes backup contents before restore | MVP |
| FR4.3.3 | System detects conflicts with existing files | MVP |
| FR4.3.4 | User can choose: restore all, restore selective, overwrite, skip, or rename | MVP |
| FR4.3.5 | System resolves path variables for the target machine | MVP |
| FR4.3.6 | System reports success/warnings after restore | MVP |

#### FR4.4: Configuration Snapshots

| ID | Requirement | Priority |
|----|-------------|----------|
| FR4.4.1 | Quick snapshot of current configuration state | MVP |
| FR4.4.2 | Named snapshots for versioning (e.g., "Before update", "Working config") | MVP |
| FR4.4.3 | Compare two snapshots to see differences | Future |

---

### FR5: Keybinding Management

Manage game keybindings with game-specific integrations.

#### FR5.1: Generic Keybinding Features

| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.1.1 | Backup keybinding files as part of configuration backup | MVP |
| FR5.1.2 | Restore keybinding files from backup | MVP |
| FR5.1.3 | Validate that keybinding files exist for a profile | MVP |

#### FR5.2: Game-Specific Keybinding Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.2.1 | Parse DCS World .diff.lua keybinding files | MVP |
| FR5.2.2 | Display all bindings for a device in DCS | MVP |
| FR5.2.3 | Detect duplicate bindings (same action bound to multiple inputs) | MVP |
| FR5.2.4 | Clear all bindings for a specific device in DCS | MVP |
| FR5.2.5 | Migrate DCS bindings when device UUID changes (USB port change) | MVP |
| FR5.2.6 | Support for iRacing keybinding format | Future |
| FR5.2.7 | Support for MSFS 2024 keybinding format | Future |
| FR5.2.8 | Support for BeamNG keybinding format | Future |
| FR5.2.9 | Support for Le Mans Ultimate keybinding format | Future |

#### FR5.3: Keybinding Snapshots

| ID | Requirement | Priority |
|----|-------------|----------|
| FR5.3.1 | Create a named snapshot of current keybindings | MVP |
| FR5.3.2 | Restore keybindings from a snapshot | MVP |
| FR5.3.3 | Compare two keybinding snapshots | Future |
| FR5.3.4 | View keybinding history/versions | Future |

---

### FR6: Display Management

Manage Windows display configuration.

#### FR6.1: Display Detection

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.1.1 | Enumerate all connected monitors | MVP |
| FR6.1.2 | Read current display layout (position, rotation, resolution) | MVP |
| FR6.1.3 | Identify monitors by name/model | MVP |
| FR6.1.4 | User can assign friendly names to monitors | MVP |

#### FR6.2: Display Layout Profiles

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.2.1 | Save current display layout as a named profile | MVP |
| FR6.2.2 | Define expected display layout in a RigReady profile | MVP |
| FR6.2.3 | Compare current layout to expected layout | MVP |

#### FR6.3: Display Modification

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.3.1 | Programmatically rotate a monitor (0°, 90°, 180°, 270°) | MVP |
| FR6.3.2 | Programmatically reposition a monitor | MVP |
| FR6.3.3 | Programmatically change monitor resolution | Future |
| FR6.3.4 | Programmatically set primary display | Future |
| FR6.3.5 | Apply a saved display layout with one click | MVP |

#### FR6.4: DCS Monitor Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6.4.1 | Read DCS MonitorSetup.lua files | MVP |
| FR6.4.2 | Create/edit MonitorSetup.lua for MFD viewport exports | MVP |
| FR6.4.3 | Preview viewport layout before applying | Future |
| FR6.4.4 | Apply MonitorSetup without overwriting other user customizations | MVP |

---

### FR7: Game Integration

Support for specific games with auto-detection and specialized features.

#### FR7.1: Game Detection

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.1.1 | Auto-detect game installation paths | MVP |
| FR7.1.2 | Support multiple installation types (Steam, Standalone, Store) | MVP |
| FR7.1.3 | Detect game user data paths (Saved Games, AppData, etc.) | MVP |

#### FR7.2: Generic Game Support

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.2.1 | User can define a custom game with manually specified paths | MVP |
| FR7.2.2 | Generic process check works for any game | MVP |
| FR7.2.3 | Generic configuration backup works for any game | MVP |

#### FR7.3: DCS World Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.3.1 | Auto-detect DCS installation (Stable, OpenBeta, Steam) | MVP |
| FR7.3.2 | Know DCS configuration paths (Saved Games/DCS/) | MVP |
| FR7.3.3 | Parse DCS keybinding .diff.lua files | MVP |
| FR7.3.4 | Parse DCS options.lua | MVP |
| FR7.3.5 | Parse/edit DCS MonitorSetup.lua | MVP |
| FR7.3.6 | Understand per-aircraft keybinding structure | MVP |
| FR7.3.7 | Manage DCS export.lua safely (without aggressive overwriting) | Future |

#### FR7.4: iRacing Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.4.1 | Auto-detect iRacing installation | MVP |
| FR7.4.2 | Know iRacing configuration paths (Documents/iRacing/) | MVP |
| FR7.4.3 | Parse joyCalib.yaml for device calibration | MVP |
| FR7.4.4 | Backup/restore app.ini, controls.cfg, joyCalib.yaml | MVP |
| FR7.4.5 | Parse FFB settings from app.ini | Future |

#### FR7.5: MSFS 2024 Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.5.1 | Auto-detect MSFS 2024 installation (Store, Steam) | MVP |
| FR7.5.2 | Know MSFS configuration paths | MVP |
| FR7.5.3 | Backup/restore controller binding XML files | MVP |
| FR7.5.4 | Handle cloud sync considerations | Future |

#### FR7.6: BeamNG Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.6.1 | Auto-detect BeamNG installation | MVP |
| FR7.6.2 | Know BeamNG configuration paths (versioned folders) | MVP |
| FR7.6.3 | Backup/restore input .diff files | MVP |
| FR7.6.4 | Handle version folder migration | Future |

#### FR7.7: Le Mans Ultimate Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR7.7.1 | Auto-detect LMU installation | MVP |
| FR7.7.2 | Know LMU configuration paths | MVP |
| FR7.7.3 | Backup/restore JSON config files | MVP |

---

### FR8: Script Integration

Extensibility through user scripts.

#### FR8.1: Script Execution

| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.1.1 | Execute command-line commands (language-agnostic) | MVP |
| FR8.1.2 | Support scripts anywhere on filesystem (full path required) | MVP |
| FR8.1.3 | Configurable timeout for script execution | MVP |
| FR8.1.4 | Configurable success exit codes (default: 0) | MVP |
| FR8.1.5 | Capture stdout/stderr for display on failure | MVP |
| FR8.1.6 | Inject environment variables with RigReady context | MVP |

#### FR8.2: Script as Checklist Item

| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.2.1 | Script check type runs a command and checks exit code | MVP |
| FR8.2.2 | Script check can have a script-based remediation | MVP |
| FR8.2.3 | Script check displays captured output on failure | MVP |

#### FR8.3: Script as Launch Action

| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.3.1 | Pre-launch scripts execute before game starts | MVP |
| FR8.3.2 | Post-launch scripts execute after game starts | MVP |
| FR8.3.3 | Continue-on-error option for non-critical scripts | MVP |
| FR8.3.4 | Wait-for-completion option for scripts that must finish before continuing | MVP |
| FR8.3.5 | Run-hidden option to suppress console windows | MVP |

#### FR8.4: Script Security

| ID | Requirement | Priority |
|----|-------------|----------|
| FR8.4.1 | Scripts are NOT included when sharing/exporting profiles | MVP |
| FR8.4.2 | Imported profiles show warning about referenced scripts | MVP |
| FR8.4.3 | Script descriptions are preserved for documentation | MVP |

---

### FR9: Sharing & Portability

Share configurations with others and transfer between machines.

#### FR9.1: Export for Sharing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR9.1.1 | Export a profile for sharing with others | MVP |
| FR9.1.2 | Export keybindings only (game-native format) | MVP |
| FR9.1.3 | Path normalization for portability (remove machine-specific paths) | MVP |
| FR9.1.4 | Privacy review before export (flag personal identifiers) | MVP |
| FR9.1.5 | Auto-generate compatibility notes (required hardware, software) | MVP |
| FR9.1.6 | Scripts excluded from export (only references/descriptions) | MVP |

#### FR9.2: Import Shared Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR9.2.1 | Import a .rigready profile file | MVP |
| FR9.2.2 | Analyze compatibility with current system | MVP |
| FR9.2.3 | Display warnings for missing dependencies | MVP |
| FR9.2.4 | Display warnings for referenced scripts that don't exist | MVP |
| FR9.2.5 | Selective import (choose what to import) | MVP |

#### FR9.3: Path Variables

| ID | Requirement | Priority |
|----|-------------|----------|
| FR9.3.1 | Standard path variables for common locations | MVP |
| FR9.3.2 | Game-specific path variables (e.g., {DCS_USER}) | MVP |
| FR9.3.3 | User-defined custom path variables | Future |

**Standard Path Variables:**
| Variable | Example Value |
|----------|---------------|
| `{USER}` | `C:\Users\username` |
| `{APPDATA}` | `C:\Users\username\AppData\Roaming` |
| `{LOCALAPPDATA}` | `C:\Users\username\AppData\Local` |
| `{DOCUMENTS}` | `C:\Users\username\Documents` |
| `{STEAM}` | `C:\Program Files (x86)\Steam` |
| `{DCS_USER}` | `C:\Users\username\Saved Games\DCS` |
| `{IRACING}` | `C:\Users\username\Documents\iRacing` |
| `{RIGREADY_HOME}` | `C:\Users\username\.rigready` |
| `{RIGREADY_SCRIPTS}` | `C:\Users\username\.rigready\scripts` |

---

## Non-Functional Requirements

### NFR1: Usability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR1.1 | Main pre-flight checklist is visible within 2 seconds of launch | MVP |
| NFR1.2 | Check status (pass/fail) is visually clear at a glance (color coding) | MVP |
| NFR1.3 | Power users can edit YAML/JSON config files directly | MVP |
| NFR1.4 | UI is responsive during long-running operations | MVP |

### NFR2: Reliability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR2.1 | RigReady does not modify game files without explicit user action | MVP |
| NFR2.2 | RigReady creates backups before modifying any files | MVP |
| NFR2.3 | RigReady handles missing files gracefully (no crashes) | MVP |
| NFR2.4 | Failed script execution does not crash RigReady | MVP |

### NFR3: Performance

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR3.1 | Pre-flight checks complete within 5 seconds for typical profile | MVP |
| NFR3.2 | Device enumeration completes within 2 seconds | MVP |
| NFR3.3 | Application memory usage under 200MB during normal operation | MVP |

### NFR4: Extensibility

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR4.1 | Game integrations are modular (easy to add new games) | MVP |
| NFR4.2 | Check types are extensible (can add new check types) | MVP |
| NFR4.3 | Script integration allows users to extend functionality | MVP |
| NFR4.4 | Open source allows community contributions | MVP |

### NFR5: Portability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR5.1 | Profiles use path variables for machine-independent configuration | MVP |
| NFR5.2 | Device matching uses VID/PID (not port-specific GUID) | MVP |
| NFR5.3 | Shared configurations work across different machines | MVP |

### NFR6: Security

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR6.1 | No admin privileges required for normal operation | MVP |
| NFR6.2 | Scripts are not included in shared configurations | MVP |
| NFR6.3 | User is warned when importing profiles with script references | MVP |

---

## MVP Scope

### MVP Guiding Principle

**Generic first, specific later.** Prioritize features that work with any game/hardware through user configuration. Add specific integrations only when generic approaches aren't sufficient.

### MVP Feature Summary

**Core Features (Must Have):**
- Profile management (create, edit, delete, clone, copy-from)
- Pre-flight checklist with pass/fail/warning status
- Process checks (is software running?)
- Device checks (is hardware connected?)
- Display checks (is monitor layout correct?)
- Configuration checks (do config files exist?)
- Script checks (custom user scripts)
- Remediation actions (launch app, auto-fix display, restore config, run script)
- Game launch with pre/post launch scripts
- Configuration backup and restore
- Display layout save/apply with programmatic rotation/position
- Input device testing
- DCS World integration (keybindings, MonitorSetup)
- Profile export/import for sharing

**MVP Game Support:**
1. DCS World (full integration)
2. iRacing (config backup/restore)
3. MSFS 2024 (config backup/restore)
4. BeamNG (config backup/restore)
5. Le Mans Ultimate (config backup/restore)
6. Generic game support (user-configured)

**MVP Hardware Support:**
1. Any USB HID device (generic)
2. WinWing (device detection)
3. Fanatec (device detection)
4. StreamDeck (process check)
5. TrackIR (process check)

---

## Future Scope

Features explicitly deferred to post-MVP:

| Feature | Notes |
|---------|-------|
| Live device connect/disconnect events | MVP uses manual refresh |
| Binding inspector (press button → see what it's bound to) | Requires deeper game integration |
| Keybinding comparison/diff | Complex UI |
| MSFS cloud sync handling | Requires more research |
| BeamNG version migration | Requires more research |
| VR headset detection and configuration | Separate hardware domain |
| AI-assisted FFB tuning | Future innovation |
| Active session overlay (button display) | Requires overlay technology |
| Plugin/extension system | Post-MVP architecture |
| Auto-detection of device connect/disconnect | Event-based monitoring |

---

## Appendix: User Flows Summary

| Flow | Description |
|------|-------------|
| Daily Pre-flight | Open RigReady → See checklist → Fix failures → Launch |
| First-time Setup | Wizard guides through creating first profile |
| Clone Profile | Duplicate existing profile as starting point |
| Backup Configuration | Export configs to portable bundle |
| Restore Configuration | Import bundle, resolve conflicts, apply |
| Device Diagnostics | Check device → Test inputs → View bindings |
| Edit Profile | Modify checklist items, add/remove checks |
| Keybinding Management | View bindings, detect duplicates, backup/restore |
| Share Configuration | Export for sharing, exclude scripts, normalize paths |

---

*Document Version: 1.0*
*Generated from brainstorming session*
