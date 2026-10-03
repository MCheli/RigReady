# Keybinding Manager Feature Requirements

## Overview
The Keybinding Manager provides unified keybinding profile management across simulators and backup/restore functionality for simulator-specific keybinding files.

## Core Features

### Keybinding Profiles
- Create unified keybinding profiles
- Define common actions across simulators
- Map actions to device inputs
- Category-based organization

### Action Categories
- Flight Controls
- Weapons
- Systems
- View
- Communications
- Autopilot

### Input Capture
- Real-time input detection
- Support for:
  - Joystick axes
  - Joystick buttons
  - Keyboard keys
  - Mouse buttons

### Simulator Backups
- Backup keybinding files for:
  - DCS World
  - Microsoft Flight Simulator
  - X-Plane
  - IL-2 Sturmovik
  - iRacing
  - Assetto Corsa Competizione
- Timestamped backups
- Restore from backup
- Delete old backups

## UI Components

### Tab Navigation
- Keybinding Profiles tab
- Sim Backups tab

### Profile Management
- Profile list sidebar
- New profile button
- Profile selection

### Action Table
- Category filter dropdown
- Action list with:
  - Action name
  - Category
  - Current binding
  - Edit/Capture buttons

### Input Capture Dialog
- Device/input display
- Cancel/Confirm actions
- Visual feedback during capture

### Backup Management
- Simulator accordion sections
- Backup list with timestamps
- Create/Restore/Delete actions

## Technical Requirements

### IPC Channels
- `keybindings:getProfiles` - Load all profiles
- `keybindings:saveProfile` - Save a profile
- `keybindings:deleteProfile` - Delete a profile
- `keybindings:getBackups` - Get backup list
- `keybindings:createBackup` - Create new backup
- `keybindings:restoreBackup` - Restore from backup
- `keybindings:deleteBackup` - Delete a backup

### Simulator File Locations
| Simulator | Config Path |
|-----------|-------------|
| DCS | %USERPROFILE%\Saved Games\DCS\Config\Input |
| MSFS | %APPDATA%\Microsoft Flight Simulator |
| X-Plane | X-Plane 12\Output\preferences |
| IL-2 | %USERPROFILE%\Documents\IL-2 Sturmovik |
| iRacing | %USERPROFILE%\Documents\iRacing |
| ACC | %USERPROFILE%\Documents\Assetto Corsa Competizione |

### Data Persistence
- Profiles: ~/.rigready/keybinding-profiles.json
- Backups: ~/.rigready/backups/<simulator>/<timestamp>/

## Status
- [x] Profile CRUD operations
- [x] Action category system
- [x] Input capture UI
- [x] Backup creation
- [x] Backup restoration
- [x] Backup deletion
- [ ] Profile export/import
- [ ] Cross-simulator sync
- [ ] Conflict detection
