# Input Tester Feature Requirements

## Overview
The Input Tester provides real-time visualization of controller inputs for testing and calibration purposes.

## Core Features

### Device Selection
- Unified dropdown combining:
  - DirectInput devices (via pygame)
  - HID devices (via node-hid)
- Device type indicators in dropdown
- Automatic device switching

### Input Visualization

#### Joystick Crosshair
- 2D representation of X/Y axes
- Real-time position tracking
- Circular boundary display
- Numeric X/Y values

#### Throttle Display
- Vertical/horizontal progress bar
- Percentage indicator
- Uses third axis (Z) when available

#### Axis Bars
- Individual progress bars for each axis
- Labeled axes (X, Y, Z, Rx, Ry, Rz, Slider 1, Slider 2)
- Numeric value display
- Color change when active

#### Button Grid
- Compact grid layout
- Visual press feedback
- Active button count
- Press animation

#### Hat Switches
- Directional indicator (8-way + center)
- Active direction highlighting

### Activity Log
- Timestamped event log
- Button press/release events
- Significant axis movements
- Color-coded by event type
- Maximum 50 entries
- Clear log functionality

### Device Info Card
- Device name
- Device type indicator
- Axis count
- Button count
- Hat switch count

## UI Components

### Layout
- 3-column layout on large screens
- Left: Device info + Joystick/Throttle visualization
- Center: Detailed input state (axes, buttons, hats)
- Right: Activity log

### Visual Feedback
- Green for pressed buttons
- Smooth transitions
- Glow effects on active inputs

## Technical Requirements

### IPC Channels
- `devices:getUnifiedInputDevices` - Combined device list
- `pygame:start` - Initialize pygame
- `pygame:startMonitoring` - Begin polling
- `pygame:onInputState` - Receive input updates
- `hid:openDevice` - Open HID device
- `hid:startMonitoring` - Begin HID polling
- `hid:onInputState` - Receive HID updates

### Data Flow
1. User selects device from dropdown
2. Appropriate backend (pygame or HID) is activated
3. Input state updates streamed to renderer
4. UI updates in real-time

### Performance
- Smooth animation at 60fps
- Efficient state diffing
- Minimal re-renders

## Status
- [x] Unified device dropdown
- [x] DirectInput device support
- [x] HID device support
- [x] Axis visualization with bars
- [x] Button grid display
- [x] Hat switch display
- [x] Joystick crosshair
- [x] Throttle visualization
- [x] Activity logging
- [x] Device info card
- [ ] Axis calibration
- [ ] Button mapping display
- [ ] Input recording/playback
