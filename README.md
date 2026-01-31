# Sim Manager

A desktop tool for managing simulation rig software, hardware, and configurations. Built with Electron for Windows.

## Features

- **Device Management**: Monitor and test connected input devices (joysticks, throttles, pedals, panels)
- **Input Testing**: Real-time visualization of axes, buttons, and hat switches
- **Display Configuration**: Save and restore multi-monitor setups
- **Keybinding Management**: Backup and restore simulator keybindings
- **Pre-Flight Checklist**: Verify everything is ready before launching your sim

## Supported Hardware

- WinWing HOTAS and panels
- Thrustmaster controllers
- Virpil panels
- VKB controllers
- TrackIR head tracking
- Stream Deck
- Any DirectInput compatible device

## Quick Start

### Prerequisites

- Node.js 18+
- Windows 10/11
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/MCheli/sim-manager.git
cd sim-manager

# Install dependencies
npm install

# Set up Python environment (for DirectInput support)
npm run setup:python

# Start the app in development mode
npm run dev
```

### Development Commands

```bash
# Run in development mode
npm run dev

# Build the application
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## Project Structure

```
sim-manager/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # App entry point
│   │   ├── preload.ts  # Preload script for IPC
│   │   └── devices/    # Device management modules
│   └── renderer/       # Electron renderer (UI)
│       ├── index.html
│       ├── renderer.js
│       └── styles.css
├── __tests__/          # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/               # Documentation
├── scripts/            # Build and utility scripts
└── resources/          # Runtime resources (Python env)
```

## Architecture

The app uses Electron with:
- **Main Process**: Node.js backend handling device communication, file system operations
- **Renderer Process**: Web-based UI with vanilla JavaScript
- **IPC Bridge**: Type-safe communication between processes via preload script

### Key Modules

| Module | Purpose |
|--------|---------|
| `HIDManager` | Raw HID device access via node-hid |
| `PygameManager` | DirectInput access via Python/pygame |
| `DeviceManager` | USB device enumeration |
| `DisplayManager` | Monitor configuration |
| `KeybindingManager` | Sim keybinding backup/restore |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
