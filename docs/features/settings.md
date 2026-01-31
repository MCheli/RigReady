# Settings Feature Requirements

## Overview
Settings provides application configuration including simulator path management and application preferences.

## Core Features

### Simulator Paths
- Configure paths for supported simulators:
  - DCS World
  - Microsoft Flight Simulator
  - X-Plane
  - IL-2 Sturmovik
  - iRacing
  - Assetto Corsa Competizione
- Install path (game executable location)
- Config path (saved games/settings location)
- Auto-detection capability
- Path verification

### Path Management Actions
- Auto-detect all simulators
- Auto-detect individual simulator
- Manual path editing
- Path verification
- Remove configuration

### Device Configuration
- Expected device count display
- Clear expected devices

### Application Settings (Planned)
- Start with Windows
- Minimize to system tray
- Check for updates

## UI Components

### Simulator Paths Table
- Simulator name with icon
- Install path column
- Config path column
- Status indicator (Configured/Not Set)
- Action buttons per row

### Simulator Icons
| Simulator | Icon |
|-----------|------|
| DCS | mdi-airplane |
| MSFS | mdi-airplane-takeoff |
| X-Plane | mdi-airport |
| IL-2 | mdi-airplane-marker |
| iRacing | mdi-car-sports |
| ACC | mdi-car-sports |

### Path Edit Dialog
- Install path text field
- Config path text field
- Browse buttons (future)
- Cancel/Save actions

### Device Configuration Card
- Expected device count
- Clear devices button

### Application Card
- Toggle switches for settings
- (Currently disabled with future notice)

## Technical Requirements

### IPC Channels
- `settings:load` - Load all settings
- `settings:save` - Save settings
- `settings:autoScan` - Auto-detect simulator
- `settings:autoScanAll` - Auto-detect all simulators
- `settings:verifyPath` - Verify simulator path

### Auto-Detection Locations
| Simulator | Common Paths |
|-----------|--------------|
| DCS | C:\Program Files\Eagle Dynamics\DCS World |
| MSFS | MS Store, Steam paths |
| X-Plane | C:\X-Plane 12 |
| IL-2 | C:\Program Files\IL-2 Sturmovik |
| iRacing | C:\Program Files (x86)\iRacing |
| ACC | Steam\steamapps\common\Assetto Corsa Competizione |

### Data Persistence
- Settings stored in ~/.rigready/settings.json

## Status
- [x] Simulator paths table UI
- [x] Manual path editing
- [x] Auto-detect functionality
- [x] Path verification
- [x] Path removal
- [x] Expected device display
- [ ] Browse for path dialogs
- [ ] Start with Windows
- [ ] Minimize to tray
- [ ] Update checking
