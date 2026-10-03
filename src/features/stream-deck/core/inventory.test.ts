import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { detectStreamDeck, isStreamDeck, streamDeckPaths } from './detect';
import {
  actionUuids,
  buildInventory,
  parseDeviceUuid,
  pluginForAction,
  readInventory,
  readPluginManifest,
  readProfiles,
} from './inventory';

let rig: TestRig;
afterEach(() => rig?.cleanup());

describe('Stream Deck detection', () => {
  it('finds the app, its version, the running process and the Stream Deck XL on the recorded rig', async () => {
    rig = await scenarioRig('stream-deck-owner', {
      files: ['AppData/Roaming/Elgato/**', 'Program Files/Elgato/**'],
    });
    const status = await detectStreamDeck(rig.ports);
    expect(status.ok && status.value).toMatchObject({
      installed: true,
      version: '7.4.2.22730',
      running: true,
      devices: [{ name: 'Stream Deck XL', productId: '008F', serial: 'A00NA33331P1UB' }],
      profilesV3: true,
    });
    expect(status.ok && status.value.exePath).toBe(
      path.join(rig.home, 'Program Files', 'Elgato', 'StreamDeck', 'StreamDeck.exe')
    );
  });

  it('reports a PC without the app, the hardware or any profiles', async () => {
    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    const status = await detectStreamDeck(rig.ports);
    expect(status.ok && status.value).toMatchObject({
      installed: false,
      running: false,
      devices: [],
    });
    expect(status.ok && status.value.version).toBeUndefined();
  });

  it('only treats Elgato devices that are Stream Decks as Stream Decks', () => {
    expect(isStreamDeck({ vendorId: '0FD9', productId: '0080', name: '' })).toBe(true);
    expect(isStreamDeck({ vendorId: '0fd9', productId: '1234', name: 'Stream Deck Studio' })).toBe(
      true
    );
    expect(isStreamDeck({ vendorId: '0FD9', productId: '0066', name: 'Cam Link 4K' })).toBe(false);
    expect(isStreamDeck({ vendorId: '046D', productId: '0080', name: 'Stream Deck' })).toBe(false);
  });

  it('uses ProfilesV2 on a PC that still has the Stream Deck 6 folder', async () => {
    rig = await scenarioRig('stream-deck-new-pc', { files: [] });
    await rig.ports.files.mkdir(
      path.join(rig.ports.folders.appData(), 'Elgato', 'StreamDeck', 'ProfilesV2')
    );
    const paths = await streamDeckPaths(rig.ports);
    expect(paths.profilesV3).toBe(false);
    expect(path.basename(paths.profilesDir)).toBe('ProfilesV2');
  });
});

describe('Stream Deck inventory', () => {
  it('counts the actions of each plugin per profile and flags plugins that are not installed', async () => {
    rig = await scenarioRig('stream-deck-owner', { files: ['AppData/Roaming/Elgato/**'] });
    const paths = await streamDeckPaths(rig.ports);
    const status = await detectStreamDeck(rig.ports);
    const inventory = await readInventory(
      rig.ports.files,
      paths,
      status.ok ? status.value.devices : []
    );
    if (!inventory.ok) throw new Error(inventory.error.message);
    const { profiles, plugins, totalActions } = inventory.value;
    expect(profiles.map((p) => p.name)).toEqual([
      'DCS World',
      'F-16 stream deck xl profile',
      'SFX MFS 2024 XL',
    ]);
    const dcsWorld = profiles.find((p) => p.name === 'DCS World')!;
    expect(dcsWorld).toMatchObject({
      deviceName: 'Stream Deck XL',
      deviceConnected: true,
      pages: 3,
    });
    const byId = new Map(plugins.map((p) => [p.id, p]));
    expect(byId.get('avionics.madjack.dcs')).toMatchObject({
      name: 'DCS-BIOS plugin by Mad Jack',
      installed: false,
      actions: 65,
      profiles: [{ name: 'F-16 stream deck xl profile', actions: 65 }],
    });
    expect(byId.get('com.barraider.supermacro')).toMatchObject({ installed: false, actions: 1 });
    expect(byId.get('com.ctytler.dcs')).toMatchObject({
      name: 'DCS Interface',
      version: '1.0.4',
      installed: true,
      actions: 32,
    });
    // Elgato's Discord manifest is encrypted: the plugin is still listed, named from the folder.
    expect(byId.get('com.elgato.discord')).toMatchObject({
      name: 'Discord',
      installed: true,
      actions: 0,
    });
    expect(byId.get('com.elgato.streamdeck')).toMatchObject({ builtIn: true, installed: true });
    // Missing plugins first, then installed ones, built-in last.
    expect(plugins[0]!.installed).toBe(false);
    expect(plugins[plugins.length - 1]!.builtIn).toBe(true);
    expect(totalActions).toBe(profiles.reduce((s, p) => s + p.actions, 0));
  });

  it('reads multi-action steps, old-style profile actions and skips damaged files', () => {
    const page = {
      Controllers: [
        {
          Actions: {
            '0,0': {
              UUID: 'com.elgato.streamdeck.multiactions.routine',
              Actions: [{ Actions: [{ UUID: 'com.ctytler.dcs.lamp' }, { UUID: 'com.x.y.z' }] }],
            },
          },
        },
      ],
    };
    expect(actionUuids(page)).toEqual([
      'com.elgato.streamdeck.multiactions.routine',
      'com.ctytler.dcs.lamp',
      'com.x.y.z',
    ]);
    expect(actionUuids({ Actions: { '0,0': { UUID: 'a.b.c.d' } } })).toEqual(['a.b.c.d']);
    expect(actionUuids('nope')).toEqual([]);

    const parsed = readProfiles([
      {
        path: 'AAA.sdProfile/manifest.json',
        text: '{"Name":"Old","DeviceUUID":"@(1)[4057/96/X1]","Actions":{"0,0":{"UUID":"a.b.c.d"}}}',
      },
      { path: 'BBB.sdProfile/manifest.json', text: '{ not json' },
      { path: 'CCC.sdProfile/Profiles/P1/manifest.json', text: '{}' },
      { path: 'AAA.sdProfile/Profiles/P1/manifest.json', text: 'broken' },
      { path: 'Images/manifest.json', text: '{}' },
    ]);
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0]).toMatchObject({
      name: 'Old',
      pages: 1,
      actions: 1,
      deviceName: 'Stream Deck',
    });
    expect(parsed.problems).toHaveLength(3);
  });

  it('maps actions to plugins by declared action, by prefix, then by reverse-DNS guess', () => {
    const installed = [
      readPluginManifest(
        'com.ctytler.dcs.sdPlugin',
        '{"Name":"DCS Interface","Actions":[{"UUID":"other.action"}]}'
      ),
    ];
    expect(pluginForAction('com.ctytler.dcs.lamp.button', installed)).toBe('com.ctytler.dcs');
    expect(pluginForAction('other.action', installed)).toBe('com.ctytler.dcs');
    expect(pluginForAction('com.elgato.streamdeck.system.hotkey', installed)).toBe(
      'com.elgato.streamdeck'
    );
    expect(pluginForAction('avionics.madjack.dcs.set', [])).toBe('avionics.madjack.dcs');
    expect(pluginForAction('com.vendor.plugin.action', [])).toBe('com.vendor.plugin');
    expect(pluginForAction('com.vendor.thing', [])).toBe('com.vendor.thing');
    expect(readPluginManifest('x.sdPlugin', undefined)).toEqual({
      id: 'x',
      name: 'x',
      actions: [],
    });
    expect(readPluginManifest('com.elgato.tutorial.sdPlugin', '{"Name":" "}').name).toBe(
      'Stream Deck Tutorial'
    );
  });

  it('decodes the device id Stream Deck stores in a profile', () => {
    expect(parseDeviceUuid('@(1)[4057/143/A00NA33331P1UB]')).toEqual({
      vendorId: '0FD9',
      productId: '008F',
      serial: 'A00NA33331P1UB',
    });
    expect(parseDeviceUuid('@(1)[4057/128]')).toEqual({ vendorId: '0FD9', productId: '0080' });
    expect(parseDeviceUuid(undefined)).toBeUndefined();
  });

  it('marks a profile whose Stream Deck is not connected', () => {
    const parsed = readProfiles(
      [
        {
          path: 'A.sdProfile/manifest.json',
          text: '{"Name":"A","Device":{"UUID":"@(1)[4057/143/OTHER]"}}',
        },
      ],
      [{ name: 'Stream Deck XL', vendorId: '0FD9', productId: '008F', serial: 'MINE' }]
    );
    const inventory = buildInventory(parsed, []);
    expect(inventory.profiles[0]).toMatchObject({
      deviceConnected: false,
      deviceName: 'Stream Deck XL',
    });
  });
});
