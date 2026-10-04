import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_KEY_SECRET, SettingsStore } from '../../src/core/settings';
import { wiredApp, type WiredApp } from '../helpers';

/**
 * PLAT-011: every setting the product names exists, has a default when nothing was
 * saved, is validated, and is stored as JSON under the data root.
 *
 *   start with Windows, close to tray, desk layout, retention, AI key, log level  settings.json
 *   minimise on launch                                                             fly/preferences.json
 *   notifications                                                                  devices.json
 *
 * (The update channel is the updater's own block in settings.json and is tested with it.)
 */

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(): Promise<WiredApp> {
  const app = await wiredApp('flying-all-good', { files: [] });
  apps.push(app);
  return app;
}

const json = async (app: WiredApp, ...parts: string[]): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path.join(app.ports.folders.dataRoot(), ...parts), 'utf8'));

describe('PLAT-011: the settings', () => {
  it('each has a default before anything is saved', async () => {
    const app = await start();
    const view = await app.invoke<{ settings: Record<string, unknown> }>('settings:get');
    expect(view.settings).toMatchObject({
      startWithWindows: false,
      minimizeToTray: true,
      aiKeyPresent: false,
      retention: { autoBackupDays: 30, autoBackupGroups: 50 },
      logLevel: 'info',
    });
    expect(view.settings['deskLayoutId']).toBeUndefined();
    expect(await app.invoke('fly:preferences')).toEqual({ minimizeOnLaunch: true });
    const devices = await app.invoke<{ notifications: string }>('devices:overview');
    expect(devices.notifications).toBe('controllers');
    // Reading defaults writes nothing.
    await expect(json(app, 'settings.json')).rejects.toThrow(/ENOENT/);
  });

  it('each is stored as JSON under the data root and read back after a restart', async () => {
    const app = await start();
    await app.invoke('settings:update', { startWithWindows: true });
    await app.invoke('settings:update', { minimizeToTray: false });
    await app.invoke('settings:saveCurrentLayout', { name: 'Desk' });
    await app.invoke('settings:update', { deskLayoutId: 'desk' });
    await app.invoke('settings:update', { retention: { autoBackupDays: 7, autoBackupGroups: 10 } });
    await app.invoke('settings:setAiKey', { key: 'sk-ant-api03-test-key-000000' });
    await app.invoke('diagnostics:setLogLevel', { level: 'debug' });
    await app.invoke('fly:setPreferences', { minimizeOnLaunch: false });
    await app.invoke('devices:setNotifications', { mode: 'all' });

    expect(await json(app, 'settings.json')).toMatchObject({
      schemaVersion: 1,
      startWithWindows: true,
      minimizeToTray: false,
      deskLayoutId: 'desk',
      retention: { autoBackupDays: 7, autoBackupGroups: 10 },
      aiKeyPresent: true,
      logLevel: 'debug',
    });
    expect(await json(app, 'fly', 'preferences.json')).toEqual({ minimizeOnLaunch: false });
    expect(await json(app, 'devices.json')).toMatchObject({ notifications: 'all' });
    // The key itself is in the secret store, never in a settings file.
    expect(JSON.stringify(await json(app, 'settings.json'))).not.toContain('sk-ant');
    expect((await app.ports.secrets.get(AI_KEY_SECRET)).ok).toBe(true);
    // Start with Windows is the real login item, not only a flag.
    expect(app.ports.loginItem.enabled).toBe(true);

    // A second wiring on the same data root (a restart) reads the same values.
    const { discoverFeatures, wireFeatures } = await import('../../src/main/bootstrap');
    const { nullLogger } = await import('../../src/core/logger');
    const again = wireFeatures({
      features: discoverFeatures(),
      ports: app.ports,
      log: nullLogger,
      send: () => {},
    });
    const ask = async (channel: string): Promise<Record<string, unknown>> => {
      const answer = await again.handlers.get(channel)!(undefined);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.value as Record<string, unknown>;
    };
    expect((await ask('settings:get'))['settings']).toMatchObject({
      startWithWindows: true,
      minimizeToTray: false,
      deskLayoutId: 'desk',
      retention: { autoBackupDays: 7, autoBackupGroups: 10 },
      aiKeyPresent: true,
      logLevel: 'debug',
    });
    expect(await ask('fly:preferences')).toEqual({ minimizeOnLaunch: false });
    expect((await ask('devices:overview'))['notifications']).toBe('all');
  });

  it('each is validated: a value that is not allowed is refused and nothing changes', async () => {
    const app = await start();
    const refused = async (channel: string, input: unknown): Promise<string> => {
      const answer = await app.wiring.handlers.get(channel)!(input);
      if (answer.ok) throw new Error(`${channel} accepted ${JSON.stringify(input)}`);
      return answer.error.code;
    };
    expect(await refused('settings:update', { startWithWindows: 'yes' })).toBe('ipc.input');
    expect(await refused('settings:update', { minimizeToTray: 1 })).toBe('ipc.input');
    expect(await refused('settings:update', { deskLayoutId: 'no-such-layout' })).toBe(
      'layouts.missing'
    );
    expect(await refused('settings:update', { retention: { autoBackupDays: 0 } })).toBe(
      'settings.invalid'
    );
    expect(await refused('settings:update', { retention: { autoBackupGroups: 1_000_000 } })).toBe(
      'settings.invalid'
    );
    expect(await refused('settings:update', { logLevel: 'verbose' })).toBe('ipc.input');
    expect(await refused('settings:update', { aiKeyPresent: true })).toBe('settings.invalid');
    expect(await refused('settings:setAiKey', { key: 'short' })).toBe('ipc.input');
    expect(await refused('fly:setPreferences', { minimizeOnLaunch: 'no' })).toBe('ipc.input');
    expect(await refused('devices:setNotifications', { mode: 'loud' })).toBe('ipc.input');
    const view = await app.invoke<{ settings: Record<string, unknown> }>('settings:get');
    expect(view.settings).toMatchObject({
      startWithWindows: false,
      minimizeToTray: true,
      retention: { autoBackupDays: 30, autoBackupGroups: 50 },
      aiKeyPresent: false,
    });
  });

  it('a settings file from an older version gets defaults for what it lacks, and unknown fields do no harm', async () => {
    const app = await start();
    await fs.writeFile(
      path.join(app.ports.folders.dataRoot(), 'settings.json'),
      JSON.stringify({ minimizeToTray: false, somethingFromTheFuture: { a: 1 } })
    );
    // A store as a fresh start has it (the running app has read its settings already).
    const store = new SettingsStore(app.ports.files, app.ports.folders.dataRoot(), app.clock);
    const loaded = await store.get();
    expect(store.takeNotice()).toBeUndefined();
    expect(loaded.ok && loaded.value).toMatchObject({
      schemaVersion: 1,
      minimizeToTray: false,
      startWithWindows: false,
      retention: { autoBackupDays: 30, autoBackupGroups: 50 },
      displayRevertSeconds: 15,
      logLevel: 'info',
    });
  });
});
