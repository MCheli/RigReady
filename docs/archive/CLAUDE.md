# Claude Code Agent Guide

This document provides context for AI agents (Claude, Copilot, etc.) working on this codebase.

## Project Overview

RigReady is an Electron desktop app for managing flight simulation hardware and software. It helps users:
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
| Renderer | Vue 3 + Vuetify 3 with Composition API |
| Build System | Vite via electron-vite |
| Device Access | node-hid (raw HID), pygame (DirectInput) |
| Testing | Jest (unit), Playwright (E2E) |
| Linting | ESLint 9 (flat config), Prettier |

## Key Files

### Entry Points
- `src/main/main.ts` - Main process entry, IPC handlers
- `src/main/preload.ts` - IPC bridge for renderer
- `src/renderer/main.ts` - Vue app initialization
- `src/renderer/App.vue` - Root Vue component with navigation

### Vue Views
- `src/renderer/views/LaunchView.vue` - Game profiles & pre-flight checks
- `src/renderer/views/DevicesView.vue` - Connected device status
- `src/renderer/views/InputTesterView.vue` - Real-time input visualization
- `src/renderer/views/DisplaysView.vue` - Monitor configuration
- `src/renderer/views/KeybindingsView.vue` - Keybinding profiles & backups
- `src/renderer/views/SettingsView.vue` - App settings
- `src/renderer/views/DebugView.vue` - System info & logs

### Composables
- `src/renderer/composables/useRigReady.ts` - All IPC API wrappers as Vue composables

### Device Managers
- `src/main/devices/hidManager.ts` - Raw HID device access
- `src/main/devices/pygameManager.ts` - DirectInput via Python
- `src/main/devices/deviceManager.ts` - USB device enumeration
- `src/main/devices/displayManager.ts` - Monitor configuration
- `src/main/devices/keybindingManager.ts` - Keybinding backup/restore

### Configuration
- `electron.vite.config.ts` - Vite + Electron build config
- `tsconfig.*.json` - TypeScript configs (main, renderer, node)
- `eslint.config.js` - ESLint flat config
- `jest.config.js` - Jest test configuration

## Architecture Patterns

### IPC Communication

Main and renderer communicate via Electron IPC:

```typescript
// Main process (main.ts)
ipcMain.handle('channel:action', async (event, arg) => {
  return result;
});

// Preload (preload.ts)
contextBridge.exposeInMainWorld('rigReady', {
  namespace: {
    action: (arg) => ipcRenderer.invoke('channel:action', arg),
  }
});

// Renderer - Composable (useRigReady.ts)
export function useNamespace() {
  async function action(arg: Type) {
    return await window.rigReady.namespace.action(arg);
  }
  return { action };
}

// Renderer - Component
const { action } = useNamespace();
const result = await action(arg);
```

### Device State Updates

Devices push state updates to renderer via IPC events:

```typescript
// Main sends
mainWindow.webContents.send('device:states', states);

// Composable wraps listener
export function useDevice() {
  function onStates(callback: (states: State[]) => void) {
    window.rigReady.device.onStates(callback);
  }
  return { onStates };
}

// Component uses
const { onStates } = useDevice();
onMounted(() => {
  onStates((states) => { ... });
});
```

### Vue Component Patterns

Components follow Vue 3 Composition API with `<script setup>`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useDevice } from '../composables/useRigReady';

const { loadDevices, devices } = useDevice();
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  await loadDevices();
  loading.value = false;
});
</script>

<template>
  <v-card>
    <v-card-title>Devices</v-card-title>
    <v-card-text>
      <v-list>
        <v-list-item v-for="device in devices" :key="device.id">
          {{ device.name }}
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>
```

## Common Tasks

### Adding a New View

1. Create `src/renderer/views/YourView.vue`
2. Add route in `src/renderer/App.vue` nav items
3. Add router case in template section
4. Create composable functions if needed

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

3. Add composable in `useRigReady.ts`:
   ```typescript
   export function useNamespace() {
     async function action(arg: Type) {
       return await window.rigReady.namespace.action(arg);
     }
     return { action };
   }
   ```

4. Add test in `__tests__/unit/`

### Adding a New Service/Manager

1. Create `src/main/devices/yourService.ts`
2. Export class with clear interface
3. Instantiate in `main.ts`
4. Add IPC handlers
5. Expose via preload
6. Write unit tests with mocked dependencies

## Testing

### Unit Tests (Jest)
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

### E2E Tests (Playwright)
```bash
npm run test:e2e      # Run all E2E tests (captures screenshots)
```

Screenshots are saved to `__tests__/screenshots/`.

### What to Mock
- `node-hid` - Use `__tests__/__mocks__/node-hid.ts`
- `electron` - Use `__tests__/__mocks__/electron.ts`
- File system operations
- Child processes (pygame)

## Code Quality

### Before Committing
- `npm run lint` - Check for issues
- `npm run format` - Format code
- `npm run typecheck` - Verify types
- `npm test` - Run tests

Pre-commit hooks will run lint-staged automatically (Husky).

## Things to Avoid

1. **Don't call `devices()` in hot paths** - HID enumeration is expensive (see performance fix in hidManager.ts)
2. **Don't skip the preload bridge** - All main/renderer communication must go through preload
3. **Don't add sync IPC calls** - Use `invoke/handle` pattern, not `sendSync`
4. **Don't import electron in renderer** - Use the exposed `window.rigReady` API
5. **Don't write to files without user confirmation** - Especially game config files
6. **Don't use Options API** - Use Composition API with `<script setup>`
7. **Don't bypass composables** - Use `useRigReady.ts` for all IPC access

## Current Limitations

- Windows-only (macOS/Linux not tested)
- Python required for DirectInput (optional but recommended)
- Some settings UI is placeholder (coming soon)

## Vuetify Theme

The app uses a custom dark greyscale theme defined in `src/renderer/plugins/vuetify.ts`:
- Background: `#0a0a0a`
- Surface: `#141414`
- Primary: `#ffffff` (white buttons/accents)
- Success: `#4ade80` (green)
- Error: `#f87171` (red)
- Warning: `#fbbf24` (yellow)
