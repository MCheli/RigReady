import { defineCommands } from '../../shared/feature';

/**
 * Words the Settings page is found by in the command palette. A command that opens a page
 * of the navigation adds no second entry: its title and keywords become words of that entry.
 * These are the ones people look for after the window was closed and RigReady did not do
 * what they expected: "tray" finds Settings.
 */
export default defineCommands({
  feature: 'settings',
  commands: [
    {
      id: 'settings.closing',
      title: 'Choose what closing the window does',
      hint: 'Keep RigReady in the tray, or quit',
      keywords: ['tray', 'close', 'quit', 'exit', 'icon', 'keep running', 'minimize'],
      to: '/configure/settings',
    },
  ],
});
