# RigReady Implementation Handoff

## Overview

This document provides context for implementing RigReady based on comprehensive requirements and design work completed in a brainstorming session.

## Documentation Summary

The following documents have been added to `/docs/`:

| Document | Description |
|----------|-------------|
| `brainstorm.md` | Original brainstorming session with problem statement, usage modes, real-world examples, and feature exploration |
| `requirements-v2.md` | Formal requirements document with 131 requirements (FR1-FR9 functional, NFR1-NFR6 non-functional) |
| `design-oo.md` | Object-oriented design with 9 domain areas and 40+ classes |
| `user-flows.md` | 9 detailed user flows with step-by-step diagrams |
| `game-integration-reference.md` | Technical reference for each supported game (config paths, file formats, keybinding structures) |
| `technical-research.md` | Research on Windows Display APIs, SimAppPro runtime requirements, USB device detection |
| `gap-analysis.md` | Comparison of existing RigReady codebase vs new requirements, with migration strategy |

## Key Concepts

### Two Primary Usage Modes
1. **Pre-flight Check**: Validate rig is ready, launch sim
2. **Configuration/Setup**: Backup, restore, modify configs

### Profile Model
- **Flat profiles** (no inheritance) - profiles are independent
- Use clone/copy-from for reusability
- Each profile targets a specific game + mode combination

### Device Identification
- Use **VID/PID** (stable across ports) not GUID (port-specific)
- Diagnostic chain: Connected → Recognized → Responding → Bound

### Checklist Item Types
- `ProcessCheck`, `DeviceCheck`, `DisplayCheck`, `ConfigCheck`, `ScriptCheck`

### Remediation Types
- `LaunchProcess`, `AutoFixDisplay`, `RestoreConfig`, `NotifyUser`, `ScriptRemediation`

### Path Variables
- `{DCS_USER}`, `{APPDATA}`, `{STEAM}`, etc. for portable configs

## MVP Scope

### Priority Games
1. DCS World
2. iRacing
3. Microsoft Flight Simulator 2024
4. Le Mans Ultimate
5. BeamNG.drive

### Priority Hardware
1. WinWing (HOTAS, throttles, panels)
2. Fanatec (wheel bases, pedals, button boxes)
3. Elgato Stream Deck
4. TrackIR

## Architecture Recommendations (from gap-analysis.md)

### Key Changes from Existing Code
1. **Unified Profile Concept**: Current implementation has separate `GameProfile` and display configs - unify into `Profile` class
2. **Script Integration**: Add `ScriptCheck` and `ScriptAction` for custom automation
3. **Display Write Capability**: Use `ChangeDisplaySettingsEx` API to actually modify display settings
4. **Abstract Game Interface**: Create `Game` interface with concrete implementations per game
5. **VID/PID Device Identification**: Switch from GUID to VID/PID for stable device identification

### Recommended Implementation Order
1. Core domain model (`Profile`, `ChecklistItem`, `Device`)
2. Device detection service (refactor existing)
3. Game abstraction layer
4. Checklist execution engine
5. Backup/restore system
6. Display configuration (read + write)
7. Keybinding management
8. Import/export functionality
9. Script integration

## SimAppPro Coexistence

RigReady **replaces**:
- Display/monitor configuration
- Keybinding management
- Pre-flight checklist automation

RigReady **does NOT replace** (still need SimAppPro at runtime):
- LED synchronization
- UFC displays
- SimShaker vibration integration

## Important Technical Notes

### Windows Display APIs
- `ChangeDisplaySettingsEx` can modify displays without admin privileges
- Can rotate, reposition, change resolution/refresh programmatically
- See `technical-research.md` for implementation details

### Keybinding Formats
| Game | Format | Location |
|------|--------|----------|
| DCS | Lua tables | `Saved Games/DCS/Config/Input/{aircraft}/` |
| iRacing | Binary + YAML | `Documents/iRacing/` |
| MSFS | XML | `%APPDATA%/Microsoft Flight Simulator/` |
| BeamNG | JSON | `%LOCALAPPDATA%/BeamNG.drive/` |
| LMU | JSON | `Documents/Le Mans Ultimate/` |

### Script Integration
- Language-agnostic (Python, Lua, PowerShell, batch)
- Exit code 0 = success, non-zero = failure
- Scripts NOT included in shared configs (security)
- Path variables expanded before execution

## Getting Started

1. Read `gap-analysis.md` for understanding current vs target state
2. Review `design-oo.md` for the target class structure
3. Follow `user-flows.md` for expected user experience
4. Reference `requirements-v2.md` for specific acceptance criteria
5. Use `game-integration-reference.md` when implementing game-specific features

## Questions?

The brainstorming session covered extensive ground. If anything is unclear, the `brainstorm.md` file contains the full exploration including rejected alternatives and reasoning behind decisions.
