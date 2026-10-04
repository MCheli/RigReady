import { defineFeature } from '../../shared/feature';
import CommandStrip from './renderer/CommandStrip.vue';

/**
 * Flying in one click: what RigReady shows when it is started to do something at once (a
 * desktop shortcut, a Jump List task, the hotkey, `RigReady.exe --launch "<setup>"`), and the
 * hotkey itself. The shell runs the command; this feature shows it on whatever screen is
 * open, and keeps the hotkey that asks for one.
 */
export default defineFeature({
  id: 'one-click',
  overlays: [CommandStrip],
  settings: [
    {
      title: 'Hotkey',
      component: () => import('./renderer/HotkeySettings.vue'),
      order: 200,
    },
  ],
});
