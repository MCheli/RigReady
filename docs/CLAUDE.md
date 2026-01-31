# Claude Code Agent Guide

This document provides context for AI agents (Claude, Copilot, etc.) working on this codebase.

## Project Overview

Sim Manager is an Electron desktop app for managing flight simulation hardware and software. It helps users:
- Monitor connected input devices (joysticks, throttles, pedals)
- Test device inputs in real-time
- Manage display configurations
- Backup/restore simulator keybindings
- Run pre-flight checklists before launching games

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 40+ |
| Main Process | TypeScript, Node.js |
| Renderer | JavaScript (migrating to TypeScript) |
| Device Access | node-hid (raw HID), pygame (DirectInput) |
| Testing | Jest (unit), Playwright (E2E planned) |
| Linting | ESLint 9 (flat config), Prettier |

## Key Files

### Entry Points
- `src/main/main.ts` - Main process entry, IPC handlers
- `src/main/preload.ts` - IPC bridge for renderer
- `src/renderer/index.html` - UI entry point
- `src/renderer/renderer.js` - UI logic

### Device Managers
- `src/main/devices/hidManager.ts` - Raw HID device access
- `src/main/devices/pygameManager.ts` - DirectInput via Python
- `src/main/devices/deviceManager.ts` - USB device enumeration
- `src/main/devices/displayManager.ts` - Monitor configuration
- `src/main/devices/keybindingManager.ts` - Keybinding backup/restore

### Configuration
- `tsconfig.json` - TypeScript config (main process only currently)
- `eslint.config.js` - ESLint flat config
- `jest.config.js` - Jest test configuration
- `package.json` - Dependencies and scripts

## Architecture Patterns

### IPC Communication

Main and renderer communicate via Electron IPC:

```typescript
// Main process (main.ts)
ipcMain.handle('channel:action', async (event, arg) => {
  return result;
});

// Preload (preload.ts)
contextBridge.exposeInMainWorld('simManager', {
  namespace: {
    action: (arg) => ipcRenderer.invoke('channel:action', arg),
  }
});

// Renderer (renderer.js)
const result = await window.simManager.namespace.action(arg);
```

### Device State Updates

Devices push state updates to renderer via IPC events:

```typescript
// Main sends
mainWindow.webContents.send('device:states', states);

// Renderer listens
window.simManager.device.onStates((states) => { ... });
```

## Common Tasks

### Adding a New IPC Handler

1. Add handler in `main.ts`:
   ```typescript
   ipcMain.handle('namespace:action', async (_, arg) => {
     return service.doSomething(arg);
   });
   ```

2. Expose in `preload.ts`:
   ```typescript
   namespace: {
     action: (arg: Type) => ipcRenderer.invoke('namespace:action', arg),
   }
   ```

3. Add test in `__tests__/unit/`:
   ```typescript
   describe('namespace:action', () => {
     it('should do something', async () => {
       // test
     });
   });
   ```

### Adding a New Service/Manager

1. Create `src/main/devices/yourService.ts`
2. Export class with clear interface
3. Instantiate in `main.ts`
4. Add IPC handlers
5. Expose via preload
6. Write unit tests with mocked dependencies

## Testing Guidelines

### What to Test
- Business logic in service classes
- IPC handler behavior
- State management
- Error handling

### What to Mock
- `node-hid` - Use `__tests__/__mocks__/node-hid.ts`
- `electron` - Use `__tests__/__mocks__/electron.ts`
- File system operations
- Child processes (pygame)

### Running Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Code Quality

### Before Committing
- `npm run lint` - Check for issues
- `npm run format` - Format code
- `npm run typecheck` - Verify types
- `npm test` - Run tests

Pre-commit hooks will run lint-staged automatically.

## Things to Avoid

1. **Don't call `devices()` in hot paths** - HID enumeration is expensive (see performance fix in hidManager.ts)
2. **Don't skip the preload bridge** - All main/renderer communication must go through preload
3. **Don't add sync IPC calls** - Use `invoke/handle` pattern, not `sendSync`
4. **Don't import electron in renderer** - Use the exposed `window.simManager` API
5. **Don't write to files without user confirmation** - Especially game config files

## Current Limitations

- Renderer is still JavaScript (TypeScript migration planned)
- No E2E tests yet (Playwright setup pending)
- Windows-only (macOS/Linux not tested)
- Python required for DirectInput (optional but recommended)

## Pending Improvements

See the task list in the conversation for planned features:
- Pre-flight checklist configuration
- Keybinding management with common actions
- TypeScript renderer
- E2E testing
- CI/CD pipeline
