import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import aceCombat8 from './module';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

describe('Ace Combat 8 game module', () => {
  it('is named the way people write it, and says what it is played with', () => {
    // Steam writes the name in capitals; a list of games in RigReady does not shout.
    expect(aceCombat8.name).toBe('Ace Combat 8: Wings of Theve');
    // CFG-PROFILE-017: flown on a gamepad, so a new setup offers a virtual controller and
    // keeps the stick, throttle and pedals. No head tracker, no helper apps, no radio.
    expect(aceCombat8.playedWith).toEqual({
      gear: ['stick', 'yoke', 'throttle', 'pedals'],
      helpers: false,
      microphone: false,
      gamepad: true,
    });
  });

  it('finds the Steam install, its settings, its build and its path variables', async () => {
    rig = await scenarioRig('virtual-controller-ready', {
      files: ['Program Files (x86)/Steam/**'],
    });
    const installs = await aceCombat8.detect(rig.ctx);
    expect(installs.ok && installs.value).toEqual([
      expect.objectContaining({
        source: 'steam',
        installDir: expect.stringMatching(/steamapps[\\/]common[\\/]ACE COMBAT 8$/),
      }),
    ]);
    const saved = path.join(
      rig.ports.folders.localAppData(),
      'BANDAI NAMCO Entertainment',
      'ACE COMBAT 8',
      'Saved'
    );
    expect(await aceCombat8.configLocations(rig.ctx)).toEqual({
      ok: true,
      value: [{ id: 'config', label: 'Settings', path: path.join(saved, 'Config', 'Windows') }],
    });
    const tracked = await aceCombat8.trackedFiles!(rig.ctx);
    expect(tracked.ok && tracked.value.map((t) => t.label)).toEqual([
      'Ace Combat 8 settings and saves',
      'Graphics and display (GameUserSettings.ini)',
    ]);
    const install = installs.ok ? installs.value[0]! : undefined;
    expect(await aceCombat8.installedVersion!(rig.ctx, install!)).toMatchObject({
      ok: true,
      value: { version: 'Build 20412345' },
    });
    const vars = await aceCombat8.pathVariables!(rig.ctx);
    expect(vars.ok && Object.keys(vars.value).sort()).toEqual(['AC8_INSTALL', 'AC8_USER']);
  });

  it('a PC without the game finds nothing and suggests nothing', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    expect(await aceCombat8.detect(rig.ctx)).toEqual({ ok: true, value: [] });
    expect(await aceCombat8.configLocations(rig.ctx)).toEqual({ ok: true, value: [] });
    expect(await aceCombat8.trackedFiles!(rig.ctx)).toEqual({ ok: true, value: [] });
  });
});
