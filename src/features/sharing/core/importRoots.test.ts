import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../../core/result';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { importRoots } from './bundle';

/**
 * GAME-ADD-003: the folders an import may write to. A game's settings folder counts only
 * when it is a folder of its own: sharing applies the same folder test as backup does,
 * whatever a game module names, and does not rely on the games file being checked first.
 */

let app: WiredApp | undefined;
afterEach(async () => {
  for (const f of app?.wiring.features ?? []) await f.dispose?.();
  await app?.cleanup();
  app = undefined;
});

describe('importRoots', () => {
  it('takes a game’s own settings folder, never one a game names that is too broad', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const own = path.join(app.home, 'Games', 'Rogue', 'Settings');
    app.wiring.context.games.register({
      id: 'user-rogue',
      name: 'Rogue',
      detect: async () => ok([]),
      configLocations: async () =>
        ok([
          { id: 'home', label: 'Everything', path: app!.home },
          { id: 'drive', label: 'The drive', path: 'C:\\' },
          { id: 'windows', label: 'Windows', path: 'C:\\Windows' },
          { id: 'own', label: 'Settings', path: own },
        ]),
    });
    const roots = await importRoots(app.wiring.context);
    expect(roots).toContain(own);
    expect(roots).toContain(app.ports.folders.documents());
    expect(roots).toContain(app.ports.folders.savedGames());
    expect(roots).not.toContain(app.home);
    expect(roots).not.toContain('C:\\');
    expect(roots).not.toContain('C:\\Windows');
  });
});
