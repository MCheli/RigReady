# Launch Center Feature Requirements

## Overview
The Launch Center provides a unified interface for managing and launching flight/racing simulators with pre-flight checks and process management.

## Core Features

### Game Profiles
- Create, edit, and delete game profiles
- Each profile contains:
  - Name (user-defined)
  - Executable path
  - Launch arguments (optional)
  - Working directory (optional)
  - Pre-launch process requirements

### Pre-Launch Requirements
- Define processes that must be running before launch
- Known processes include:
  - TrackIR 5
  - WinWing SimAppPro
  - Virpil Software
  - vJoy
  - Joystick Gremlin
  - VoiceAttack
  - DCS-SRS
- Visual status indicators (green/red chips) showing which processes are running

### Launch Functionality
- Pre-flight check validates all required processes
- Clear error messaging if checks fail
- Launch game with configured arguments
- Report started processes and launch status

### Running Processes Status
- Display currently running sim-related software
- Active process count indicator
- Refresh capability

## UI Components

### Profile Cards
- Icon based on game type (airplane, car)
- Profile name and executable path
- Pre-launch requirements with status
- Launch arguments display
- Edit/Delete/Launch actions

### Status Card
- Running support software list
- Active process count

### Profile Dialog
- Form fields for all profile properties
- Multi-select for required processes
- Cancel/Save actions

## Technical Requirements

### IPC Channels
- `process:check` - Check if a process is running
- `process:getRunningKnown` - Get list of known running processes
- `games:getProfiles` - Load saved profiles
- `games:saveProfile` - Save a profile
- `games:deleteProfile` - Delete a profile
- `games:launch` - Launch a game

### Data Persistence
- Profiles stored in user config directory
- JSON format for portability

## Status
- [x] Profile CRUD operations
- [x] Pre-launch process checking
- [x] Game launching
- [x] Running process display
- [ ] Auto-start processes option
- [ ] Profile import/export
