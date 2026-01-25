# Sim Manager - Requirements Document

## Overview
A desktop tool for managing simulation rig software, hardware, and configurations. Initially focused on flight simulators (DCS), with racing simulator support planned for later.

## Target Environment
- **Primary Game**: DCS World
- **Head Tracking**: TrackIR
- **Flight Hardware**: WinWing (HOTAS/throttle/panels)
- **Macro Device**: Stream Deck
- **Displays**: Multi-monitor setup (configuration TBD)

---

## Core Features

### 1. Pre-Launch Checklist
Verify everything is ready before launching the game.

- [ ] Required software is running (TrackIR, WinWing software, Stream Deck, etc.)
- [ ] All expected USB devices are connected
- [ ] Displays are in correct configuration (resolution, arrangement, refresh rate)
- [ ] Network connectivity (for multiplayer/updates)
- [ ] Disk space check (DCS is large)

### 2. Device Management
Monitor and troubleshoot connected controllers.

- [ ] List all connected input devices (joysticks, throttles, pedals, etc.)
- [ ] Show device connection status (connected/disconnected)
- [ ] Real-time input testing (axes, buttons, hats)
- [ ] Device identification (which physical device is which)
- [ ] Alert when expected device is missing

### 3. Display Configuration
Manage multi-monitor setups.

- [ ] Save/restore display profiles (resolution, position, refresh rate)
- [ ] Quick switch between profiles (e.g., "Flight Sim" vs "Racing" vs "Desktop")
- [ ] Detect current configuration
- [ ] Validate against expected configuration

### 4. Keybinding Management
Backup, restore, and manage game keybindings.

- [ ] Backup DCS keybindings (per aircraft)
- [ ] Restore keybindings from backup
- [ ] Detect keybinding conflicts
- [ ] Export/import binding profiles
- [ ] Track which bindings are set for which devices

### 5. Software Launcher
Start required software in the right order.

- [ ] Define software dependencies and launch order
- [ ] One-click "prepare for flight" button
- [ ] Monitor running processes
- [ ] Graceful shutdown sequence

### 6. Troubleshooting Tools
Diagnose common issues.

- [ ] Device not responding diagnostics
- [ ] Input lag testing
- [ ] USB hub/port diagnostics
- [ ] Log viewer for related software
- [ ] Common issue knowledge base

### 7. Configuration Backup
Protect settings and configurations.

- [ ] Scheduled backups of game configs
- [ ] Backup before updates
- [ ] Version history
- [ ] Easy restore points

---

## Hardware Inventory

### Flight Sim Hardware
| Device | Type | VID:PID | Status |
|--------|------|---------|--------|
| WinWing Orion Joystick Base 2 + F-16 Grip | Joystick | 4098:BEA8 | Connected |
| WinWing Throttle Base1 + F-15EX Handles | Throttle | 4098:BD26 | Connected |
| WinWing Device | TBD | 4098:BE03 | Connected |
| WinWing Device | TBD | 4098:BEE0 | Connected |
| WinWing Device | TBD | 4098:BEDE | Connected |
| WinWing Device | TBD | 4098:BEE1 | Connected |
| WinWing Device | TBD | 4098:BEE2 | Connected |
| WinWing Device | TBD | 4098:BF05 | Connected |
| WinWing Device | TBD | 4098:BF06 | Connected |
| Virpil VPC Panel #1 | Control Panel | 3344:C259 | Connected |
| Thrustmaster T-Pendular-Rudder | Pedals | 044F:B68F | Connected |
| TrackIR 5 | Head Tracking | 1189:8890 | Connected |
| Elgato Stream Deck | Macro Pad | 0FD9:008F | Connected |
| SteelSeries Apex Pro | Keyboard | 1038:1610 | Connected |

*Note: 7 additional WinWing devices need identification (panels, MFDs, etc.)*

### Displays
| Display | Resolution | Refresh | Size (cm) | Notes |
|---------|------------|---------|-----------|-------|
| Dell (DELD139) | 2560x1440 | 59Hz | 70x40 | Primary? |
| Samsung (SAM7053) | 5120x1440 | 119Hz | 119x34 | Ultrawide |
| DisplayLink x3 (REG0319) | 1024x768 | 60Hz | 28x16 | USB displays (MFDs?) |

### GPU
- NVIDIA GeForce RTX 5080
- DisplayLink USB adapters (for additional displays)

---

## Software Inventory

| Software | Purpose | Install Path | Status |
|----------|---------|--------------|--------|
| DCS World (Steam) | Game | C:\Program Files (x86)\Steam\steamapps\common\DCSWorld | Installing... |
| TrackIR 5 | Head Tracking | C:\Program Files (x86)\NaturalPoint | Installed |
| WinWing SimAppPro | Controller Config | TBD | Not installed |
| Stream Deck | Macros | TBD | Device detected, software TBD |
| Steam | Game Platform | C:\Program Files (x86)\Steam | Running |

### Required Software Launch Order
1. Steam (if not running)
2. WinWing SimAppPro
3. TrackIR 5
4. Stream Deck software
5. DCS World

---

## Technical Decisions (TBD)

- **UI Framework**: Electron? Tauri? Native Windows (WPF/WinUI)?
- **Language**: TypeScript? C#? Rust?
- **Device Detection**: Windows API? DirectInput? HID?
- **Configuration Storage**: JSON files? SQLite?

---

## Phase 1 Scope (Flight Sim / DCS)
1. Device detection and monitoring
2. Pre-launch checklist
3. DCS keybinding backup/restore
4. Basic software launcher

## Phase 2 Scope (Racing Sim)
- To be defined after Phase 1

---

## Discovery Session Notes

### Session 1: Initial Setup (2026-01-25)
**Goal:** Document current hardware/software setup, identify pain points

**Findings:**
- 9 WinWing devices connected (need to map to physical hardware names)
- 1 Thrustmaster device (TWCS throttle - B68F)
- TrackIR 5 installed and hardware detected
- Stream Deck hardware detected (PID 008F = likely Stream Deck MK.2 or XL)
- RTX 5080 GPU with DisplayLink USB displays (possibly for MFDs)
- Samsung ultrawide (5120x1440 @ 119Hz) - main gaming display
- Dell monitor (2560x1440) - secondary
- 3x small DisplayLink displays (1024x768) - likely Cougar MFDs or similar

**Action Items:**
1. [ ] Wait for DCS Steam installation to complete
2. [ ] Download and install WinWing SimAppPro from winwingsim.com
3. [ ] Identify which WinWing devices correspond to which hardware
4. [ ] Verify Stream Deck software is installed
5. [ ] First launch of DCS to create Saved Games folder structure
6. [ ] Configure initial keybindings
