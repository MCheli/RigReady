# Display Configuration Feature Requirements

## Overview
Display Configuration manages monitor arrangements for multi-monitor simulation setups, allowing users to save and restore display configurations.

## Core Features

### Display Detection
- Enumerate all connected monitors
- Capture display properties:
  - Name/model
  - Resolution (width x height)
  - Position (x, y coordinates)
  - Primary display flag

### Visual Arrangement Diagram
- Scaled visual representation of monitor layout
- Relative positioning based on coordinates
- Monitor numbering
- Resolution labels
- Primary display highlighting
- Hover effects

### Configuration Management
- Save current display arrangement
- Named configurations
- List saved configurations
- Delete configurations
- (Future) Restore configurations

## UI Components

### Status Summary
- Monitor count
- Saved configuration count

### Arrangement Diagram
- Container sized to fit all displays
- Proportional scaling
- Monitor boxes with:
  - Index number
  - Resolution text
  - Green border for primary

### Current Displays List
- Card per display
- Name and resolution
- Position coordinates
- Primary indicator chip

### Saved Configurations
- Card per configuration
- Configuration name
- Display count
- Delete action

## Technical Requirements

### IPC Channels
- `displays:getAll` - Get current display arrangement
- `displays:getSaved` - Get saved configurations
- `displays:save` - Save current configuration
- `displays:delete` - Delete a configuration
- `displays:restore` - Apply a saved configuration

### Data Sources
- PowerShell for display enumeration
- Windows Display Settings API

### Data Persistence
- Configurations stored in ~/.rigready/displays.json

### Scaling Algorithm
```
1. Find bounding box of all displays (minX, minY, maxX, maxY)
2. Calculate total dimensions
3. Scale to fit max container width (600px)
4. Apply scale to each display position and size
```

## Status
- [x] Display detection
- [x] Display property capture
- [x] Visual arrangement diagram
- [x] Save configurations
- [x] Delete configurations
- [ ] Restore configurations
- [ ] Configuration comparison
- [ ] Display profile auto-switching
