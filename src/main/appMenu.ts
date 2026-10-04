/**
 * RigReady's application menu. Pure, so it is unit-tested without Electron.
 *
 * RigReady shows no menu bar. A menu is still what gives a window its keys, and a program
 * without one of its own is handed Electron's (File, Edit, View, Window), whose keys are not
 * RigReady's. Measured in the packaged app: Ctrl+R loaded the window again and threw away a
 * setup that was being edited, Ctrl+Shift+I opened the developer tools, and Alt brought up
 * the menu bar.
 *
 * What stays are the keys people expect of any window: zoom and full screen. Zoom in also
 * answers to Ctrl+= (the plus key without Shift), which Electron's menu did not. A run from
 * source keeps Reload and the developer tools.
 */

export type AppMenuRole =
  'zoomIn' | 'zoomOut' | 'resetZoom' | 'togglefullscreen' | 'reload' | 'toggleDevTools';

export interface AppMenuEntry {
  role: AppMenuRole;
  /** Only where the key that comes with the role is not enough. */
  accelerator?: string;
}

export interface AppMenuGroup {
  /** Without an ampersand: a letter marked with one would let Alt and that letter bring up the menu bar. */
  label: string;
  submenu: AppMenuEntry[];
}

export function appMenu(packaged: boolean): AppMenuGroup[] {
  const keys: AppMenuEntry[] = [
    { role: 'zoomIn' },
    { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
    { role: 'zoomOut' },
    { role: 'resetZoom' },
    { role: 'togglefullscreen' },
  ];
  if (!packaged) keys.push({ role: 'reload' }, { role: 'toggleDevTools' });
  return [{ label: 'View', submenu: keys }];
}
