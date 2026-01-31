# RigReady

A desktop tool for managing simulation rig software, hardware, and configurations. Built with Electron for Windows.

**Website**: [rigready.io](https://rigready.io)

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
git clone https://github.com/MCheli/rigready.git
cd rigready

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

# Run unit tests
npm test

# Run unit tests with coverage
npm run test:coverage

# Run E2E tests (includes screenshot capture)
npm run test:e2e

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## Project Structure

```
rigready/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.ts              # App entry point & IPC handlers
│   │   ├── preload.ts           # Preload script for IPC bridge
│   │   └── devices/             # Device management modules
│   ├── renderer/                # Vue 3 + Vuetify UI
│   │   ├── App.vue              # Root Vue component
│   │   ├── main.ts              # Vue app entry point
│   │   ├── views/               # Page components
│   │   │   ├── LaunchView.vue   # Game launcher & pre-flight checks
│   │   │   ├── DevicesView.vue  # Connected device status
│   │   │   ├── InputTesterView.vue  # Real-time input visualization
│   │   │   ├── DisplaysView.vue # Monitor configuration
│   │   │   ├── KeybindingsView.vue  # Keybinding profiles & backups
│   │   │   ├── SettingsView.vue # App settings
│   │   │   └── DebugView.vue    # System info & logs
│   │   ├── composables/         # Vue composables for state/API
│   │   └── plugins/             # Vuetify theme configuration
│   └── shared/                  # Shared types between main/renderer
├── __tests__/                   # Test files
│   ├── unit/                    # Jest unit tests
│   └── e2e/                     # Playwright E2E tests
├── docs/                        # Documentation
├── scripts/                     # Build and utility scripts
└── resources/                   # Runtime resources (Python env)
```

## Architecture

The app uses Electron with:
- **Main Process**: Node.js backend handling device communication, file system operations
- **Renderer Process**: Vue 3 + Vuetify 3 with Composition API and TypeScript
- **IPC Bridge**: Type-safe communication between processes via preload script
- **Build System**: Vite via electron-vite for fast development and optimized builds

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
