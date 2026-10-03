# Debug Feature Requirements

## Overview
The Debug view provides system information, diagnostic data, and log access for troubleshooting issues.

## Core Features

### System Information
- Platform (Windows)
- Electron version
- Node.js version
- Chrome version

### Device Status
- DirectInput (pygame) availability
- DirectInput device count
- HID device count
- USB device count

### File Paths
- Configuration file location
- Log file location

### Log Viewer
- Recent log entries display
- Color-coded by level:
  - Red for ERROR
  - Yellow for WARN
  - Default for INFO
- Entry count indicator
- Scrollable log container

### Log Export
- Export all logs to file
- User-selected destination
- Success/error feedback via toast

## UI Components

### Layout
- 3-column grid for info cards
- Full-width log viewer

### System Information Card
- Platform display
- Version information list

### Device Status Card
- DirectInput status indicator
- Device counts

### File Paths Card
- Truncated path display
- Monospace font

### Log Viewer Card
- Entry count chip
- Scrollable container
- Colored log entries

## Technical Requirements

### IPC Channels
- `debug:getInfo` - Get system and device info
- `debug:getLogs` - Get recent log entries
- `debug:exportLogs` - Export logs to file

### Data Sources
- process.versions for runtime info
- process.platform for OS
- Device managers for counts
- Log file for entries

### Log Format
```
[TIMESTAMP] [LEVEL] Message
```

## Status
- [x] System information display
- [x] Device status display
- [x] File paths display
- [x] Log viewer
- [x] Log export
- [x] Toast notifications
- [ ] Log level filtering
- [ ] Log search
- [ ] Real-time log streaming
