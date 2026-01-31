# Device Management Feature Requirements

## Overview
Device Management provides detection, identification, and monitoring of USB HID devices used in flight/racing simulation setups.

## Core Features

### Device Detection
- Enumerate all connected USB HID devices
- Filter to sim-related hardware vendors
- Real-time connection status

### Vendor Identification
Recognized vendors:
- WinWing (VID: 4098)
- Thrustmaster (VID: 044F)
- Virpil (VID: 3344)
- VKB (VID: 231D, 03EB)
- Logitech (VID: 046D)
- Elgato (VID: 0FD9)
- NaturalPoint (VID: 1189)
- SteelSeries (VID: 1038)
- MadCatz/Saitek (VID: 0738, 06A3)

### Device Type Classification
Automatic classification based on vendor and device name:
- Joystick
- Throttle
- Pedals
- Panel
- Head Tracker
- Stream Deck
- Other

### Expected Devices
- Save current device set as "expected"
- Compare against expected on startup
- Identify missing devices
- Alert on unexpected devices

## UI Components

### Status Summary
- Connected device count
- Missing device count
- Total expected count

### Device Cards
- Vendor-colored avatar icon
- Device type icon
- Product name
- Vendor name
- VID:PID display
- Connection status chip

### Device Icons by Type
| Type | Icon |
|------|------|
| Joystick | mdi-gamepad-variant |
| Throttle | mdi-speedometer |
| Pedals | mdi-foot-print |
| Panel | mdi-view-dashboard-variant |
| Head Tracker | mdi-head |
| Stream Deck | mdi-grid |
| Other | mdi-usb |

### Vendor Colors
| Vendor | Color |
|--------|-------|
| WinWing | Blue |
| Thrustmaster | Orange |
| Virpil | Purple |
| VKB | Green |
| Logitech | Cyan |
| Elgato | Pink |
| NaturalPoint | Amber |
| SteelSeries | Red |

## Technical Requirements

### IPC Channels
- `devices:getAll` - Get all connected devices
- `devices:getExpected` - Get expected device list
- `devices:saveExpected` - Save current as expected
- `devices:checkStatus` - Compare current vs expected

### Data Sources
- PowerShell Get-PnpDevice for USB enumeration
- node-hid for HID device details
- pygame (via Python) for DirectInput devices

### Data Persistence
- Expected devices stored in ~/.rigready/devices.json

## Status
- [x] USB device enumeration
- [x] Vendor/product identification
- [x] Device type inference
- [x] Visual device cards with icons
- [x] Vendor-based color coding
- [ ] Device renaming/aliasing
- [ ] Device grouping
- [ ] Connection change notifications
