import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Overview } from '../contract';
import { expectedPlugins, setupSteps } from './setup';

let app: WiredApp;
afterEach(() => app?.cleanup());

const OLD_BACKUP = 'Documents/DCS Backup/Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup';
const overview = (): Promise<Overview> => app.invoke<Overview>('stream-deck:overview');
const byId = (o: Overview) => new Map(setupSteps(o).map((s) => [s.id, s]));

describe('Stream Deck new-PC setup steps', () => {
  it('starts with nothing done on a new PC, and knows the plugins an imported backup needs', async () => {
    app = await wiredApp('stream-deck-new-pc', { files: [] });
    let steps = byId(await overview());
    expect([...steps.keys()]).toEqual([
      'install',
      'connect',
      'profiles',
      'plugins',
      'start',
      'backup',
    ]);
    expect([...steps.values()].every((s) => !s.done)).toBe(true);
    expect(steps.get('install')?.state).toBe('Not installed');
    expect(steps.get('plugins')?.state).toBe('Known once your profiles are back');

    app.ports.dialogs.script.open.push([OLD_BACKUP]);
    await app.invoke('stream-deck:importFile');
    const after = await overview();
    expect(expectedPlugins(after)).toEqual([
      { pluginId: 'com.ctytler.dcs', name: 'DCS Interface', actions: 32 },
    ]);
    steps = byId(after);
    expect(steps.get('plugins')?.state).toBe('Your backup needs 1 plugin');
    // An imported backup is not a backup of this PC.
    expect(steps.get('backup')?.done).toBe(false);
  });

  it("on the owner's rig: installed, connected, running, profiles back, but plugins and DCS still to do", async () => {
    app = await wiredApp('stream-deck-owner', {
      files: ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**', 'Saved Games/DCS/**'],
    });
    let steps = byId(await overview());
    expect(steps.get('install')).toMatchObject({ done: true, state: 'Installed, version 7.4.2' });
    expect(steps.get('connect')).toMatchObject({ done: true, state: 'Stream Deck XL connected' });
    expect(steps.get('profiles')).toMatchObject({ done: true, state: '3 profiles on this PC' });
    expect(steps.get('plugins')).toMatchObject({ done: false, state: '2 plugins missing' });
    expect(steps.get('dcs')).toMatchObject({
      done: false,
      state: 'DCS is not set up for your DCS keys',
    });
    expect(steps.get('start')).toMatchObject({ done: true, state: 'Running' });
    expect(steps.get('backup')?.done).toBe(false);
    expect(expectedPlugins(await overview())).toEqual([]);

    await app.invoke('stream-deck:createBackup', {});
    steps = byId(await overview());
    expect(steps.get('backup')).toMatchObject({ done: true, state: 'Backed up' });
  });
});
