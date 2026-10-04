import { defineFeature } from '../../shared/feature';
import CommandStrip from './renderer/CommandStrip.vue';

/**
 * Flying in one click: what RigReady shows when it is started to do something at once (a
 * desktop shortcut, a Jump List task, the hotkey, `RigReady.exe --fly "<setup>"`). The shell
 * runs the command; this feature shows it on whatever screen is open.
 */
export default defineFeature({
  id: 'one-click',
  overlays: [CommandStrip],
});
