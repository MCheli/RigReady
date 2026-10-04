import { describe, expect, it } from 'vitest';
import { appMenu } from '../../src/main/appMenu';

const roles = (packaged: boolean): string[] =>
  appMenu(packaged).flatMap((group) => group.submenu.map((entry) => entry.role));

describe('the application menu', () => {
  it('in the packaged app holds zoom and full screen, and nothing that reloads the window or opens the developer tools', () => {
    expect(appMenu(true)).toEqual([
      {
        label: 'View',
        submenu: [
          { role: 'zoomIn' },
          { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          { role: 'togglefullscreen' },
        ],
      },
    ]);
    expect(roles(true)).not.toContain('reload');
    expect(roles(true)).not.toContain('toggleDevTools');
  });

  it('in a run from source keeps Reload and the developer tools', () => {
    expect(roles(false)).toEqual([...roles(true), 'reload', 'toggleDevTools']);
  });

  it('has no label with a marked letter, so Alt and a letter cannot bring up the menu bar', () => {
    for (const packaged of [true, false])
      for (const group of appMenu(packaged)) expect(group.label).not.toContain('&');
  });

  it('gives a key of its own only to zoom in, and that key takes Ctrl', () => {
    const own = appMenu(true).flatMap((group) =>
      group.submenu.filter((entry) => entry.accelerator !== undefined)
    );
    expect(own).toEqual([{ role: 'zoomIn', accelerator: 'CommandOrControl+=' }]);
  });
});
