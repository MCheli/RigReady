import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChecklistReport } from '../../../core/checks/engine';
import { ProfileSchema, type Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { EarlierPlan, ProfileOverview } from '../contract';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const f of app?.wiring.features ?? []) await f.dispose?.();
  await app?.cleanup();
  app = undefined;
});

/** The file RigReady 1 left on the owner's PC, as the scenario seeds it (fixtures/scenarios/data/version-one). */
const OLD = 'mld4nbutw9iuzu9';
const WHEEL = { vendorId: '0EB7', productId: '0007' };

const oldFile = (a: WiredApp, id = OLD): string =>
  path.join(a.ports.folders.dataRoot(), 'profiles', `${id}.yaml`);
const call = (a: WiredApp, channel: string, input: unknown) =>
  a.wiring.handlers.get(channel)!(input);

describe('a setup RigReady 1 left behind', () => {
  it('is brought over: the wheel by the one connected device of its name, the app as it was, the monitor layout named and left out, and the old file untouched', async () => {
    app = await wiredApp('first-run-after-version-one', {
      files: ['Program Files (x86)/Steam/**'],
    });
    const before = await fs.readFile(oldFile(app));

    const plan = await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: OLD });
    expect(plan).toMatchObject({
      id: OLD,
      name: 'LMU',
      setupName: 'LMU',
      gameName: 'Le Mans Ultimate',
      launch: 'Le Mans Ultimate, through Steam',
      canBringOver: true,
      blocked: [],
      checks: [
        {
          title: 'FANATEC Podium Wheel Base DD2',
          what: 'connected: the FANATEC Podium Wheel Base DD2 plugged in now (0EB7:0007)',
          required: true,
        },
        { title: 'TrackIR 5', what: 'TrackIR5.exe is running', required: false },
      ],
    });
    expect(plan.left).toEqual([
      {
        title: 'Display: Single Ultrawide',
        why: expect.stringContaining(
          'RigReady 1 kept its monitor layouts in a form this version cannot match'
        ),
      },
    ]);
    // Working it out wrote nothing.
    expect(await fs.readdir(path.dirname(oldFile(app)))).toEqual([`${OLD}.yaml`]);

    const made = await app.invoke<Profile>('profiles:bringOver', { id: OLD });
    expect(ProfileSchema.parse(made)).toMatchObject({
      id: 'lmu',
      name: 'LMU',
      game: 'lmu',
      launch: {
        exe: expect.stringMatching(/steam\.exe$/i),
        args: ['-applaunch', expect.any(String)],
      },
      extensions: { profiles: { broughtFrom: `${OLD}.yaml` } },
    });
    expect(
      made.checks.map(({ id, type, title, required, params }) => ({
        id,
        type,
        title,
        required,
        params,
      }))
    ).toEqual([
      {
        id: 'c1',
        type: 'device.connected',
        title: 'FANATEC Podium Wheel Base DD2',
        required: true,
        params: WHEEL,
      },
      {
        id: 'c2',
        type: 'process.running',
        title: 'TrackIR 5',
        required: false,
        params: { name: 'TrackIR5.exe' },
      },
    ]);
    // The old file is as RigReady 1 left it; the new setup is a file of its own.
    expect(await fs.readFile(oldFile(app))).toEqual(before);
    expect(yaml.load(await fs.readFile(oldFile(app, 'lmu'), 'utf8'))).toMatchObject({
      name: 'LMU',
    });

    // The checks are real ones: on this rig the wheel is there and TrackIR runs.
    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: 'lmu' });
    expect(report.results.map((r) => [r.title, r.status])).toEqual([
      ['FANATEC Podium Wheel Base DD2', 'pass'],
      ['TrackIR 5', 'pass'],
    ]);

    // The Setups page says it was brought over, and it is not brought over twice.
    const overview = await app.invoke<ProfileOverview>('profiles:overview');
    expect(overview.earlier).toEqual([
      expect.objectContaining({ id: OLD, name: 'LMU', broughtOver: { id: 'lmu', name: 'LMU' } }),
    ]);
    expect(overview.profiles.map((p) => p.profile.id)).toEqual(['lmu']);
    expect(await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: OLD })).toMatchObject({
      canBringOver: false,
      broughtOver: { id: 'lmu', name: 'LMU' },
    });
    expect(await call(app, 'profiles:bringOver', { id: OLD })).toMatchObject({
      ok: false,
      error: { code: 'profile.earlierDone', message: '"LMU" was brought over already, as "LMU".' },
    });
  });

  it('guesses nothing: with the wheel unplugged it says to connect it and look again, and writes nothing', async () => {
    app = await wiredApp('first-run-after-version-one', { files: [] });
    await mutate(app, [{ op: 'unplugDevice', match: WHEEL }]);
    const plan = await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: OLD });
    expect(plan.canBringOver).toBe(false);
    expect(plan.blocked).toEqual([
      {
        title: 'FANATEC Podium Wheel Base DD2',
        why: 'RigReady 1 knew it only by its name, "FANATEC Podium Wheel Base DD2", and no device of that name is connected now. Connect it, then look again.',
      },
    ]);
    expect(await call(app, 'profiles:bringOver', { id: OLD })).toMatchObject({
      ok: false,
      error: { code: 'profile.earlierBlocked', message: 'RigReady cannot bring "LMU" over.' },
    });
    expect(await fs.readdir(path.dirname(oldFile(app)))).toEqual([`${OLD}.yaml`]);
    // Plugged back in, it can.
    await mutate(app, [{ op: 'plugDevice', match: WHEEL }]);
    expect((await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: OLD })).canBringOver).toBe(
      true
    );
  });

  it('every kind of RigReady 1 check: what has an exact match comes over, the rest is named with why', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const dir = path.join(app.ports.folders.dataRoot(), 'profiles');
    await fs.mkdir(dir, { recursive: true });
    const home = app.ports.folders.home();
    const exe = path.join(home, 'Tools', 'Helper', 'Helper.exe');
    const options = path.join(home, 'Saved Games', 'Sim', 'options.ini');
    // As RigReady 1.1.0 wrote it (src/shared/profileTypes.ts at the v1.1.0 tag).
    await fs.writeFile(
      path.join(dir, 'k2v9x1abcde.yaml'),
      yaml.dump({
        id: 'k2v9x1abcde',
        name: 'Every kind',
        game: 'xplane',
        createdAt: 1770517906373,
        lastUsed: 1770517906373,
        launchTarget: {
          executablePath: path.join(home, 'Sims', 'Sim.exe'),
          arguments: ['--vr'],
          preScripts: [
            {
              id: 's1',
              name: 'Warm up',
              scriptPath: 'C:\\warm.cmd',
              arguments: [],
              timeout: 10,
              runHidden: true,
              successExitCodes: [0],
            },
          ],
          postScripts: [],
        },
        checklistItems: [
          {
            id: 'a',
            type: 'process',
            name: 'Helper',
            isRequired: true,
            category: 'software',
            config: { processName: 'Helper.exe' },
            remediation: {
              type: 'launchProcess',
              config: { executablePath: exe, arguments: ['-tray'] },
            },
          },
          {
            id: 'b',
            type: 'device',
            name: 'Rudder pedals',
            isRequired: true,
            category: 'hardware',
            config: { vendorId: 0x044f, productId: 0xb68f },
          },
          {
            id: 'c',
            type: 'device',
            name: 'Any Thrustmaster',
            isRequired: false,
            category: 'hardware',
            config: { vendorId: 0x044f },
          },
          {
            id: 'd',
            type: 'config',
            name: 'Options',
            isRequired: true,
            category: 'configuration',
            config: { filePath: options, contentRegex: 'vr=1' },
            remediation: {
              type: 'notifyUser',
              config: { message: 'Turn VR on', instructions: 'Options > VR' },
            },
          },
          {
            id: 'e',
            type: 'config',
            name: 'Options there',
            isRequired: true,
            category: 'configuration',
            config: { filePath: options },
          },
          {
            id: 'f',
            type: 'config',
            name: 'Restored',
            isRequired: true,
            category: 'configuration',
            config: { filePath: options },
            remediation: {
              type: 'restoreConfig',
              config: { sourcePath: 'C:\\a', targetPath: 'C:\\b' },
            },
          },
          {
            id: 'g',
            type: 'script',
            name: 'Script',
            isRequired: true,
            category: 'custom',
            config: { scriptPath: 'C:\\x.cmd', arguments: [], successExitCodes: [0], timeout: 5 },
          },
          {
            id: 'h',
            type: 'display',
            name: 'Display: Desk',
            isRequired: false,
            category: 'display',
            config: { configurationName: 'Desk' },
          },
          {
            id: 'i',
            type: 'telepathy',
            name: 'Odd one',
            isRequired: true,
            category: 'custom',
            config: {},
          },
          {
            id: 'j',
            type: 'process',
            name: 'Not a program',
            isRequired: true,
            category: 'software',
            config: { processName: 'helper' },
          },
        ],
        trackedConfigurations: [{ name: 'Options', path: options }],
      })
    );
    const plan = await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: 'k2v9x1abcde' });
    expect(plan.canBringOver).toBe(true);
    expect(plan.launch).toBe('Sim.exe');
    expect(plan.checks.map((c) => c.title)).toEqual([
      'Helper',
      'Rudder pedals',
      'Options',
      'Options there',
    ]);
    expect(plan.left.map((p) => p.title)).toEqual([
      'Any Thrustmaster',
      'Restored',
      'Script',
      'Display: Desk',
      'Odd one',
      'Not a program',
    ]);
    expect(plan.left.find((p) => p.title === 'Script')!.why).toContain('never ran it');
    expect(plan.notes).toEqual([
      expect.stringContaining(
        'RigReady 1 called the game "xplane", which can be X-Plane 12 or X-Plane 11.'
      ),
      expect.stringContaining('RigReady 1 ran a script around the launch.'),
      expect.stringContaining('RigReady 1 kept one file for backup with it.'),
    ]);

    const made = await app.invoke<Profile>('profiles:bringOver', { id: 'k2v9x1abcde' });
    expect(made.game).toBeUndefined();
    expect(made.launch).toEqual({ exe: '{USER}/Sims/Sim.exe', args: ['--vr'] });
    expect(made.actions).toBeUndefined();
    expect(
      made.checks.map(({ type, params, remediation }) => ({ type, params, remediation }))
    ).toEqual([
      {
        type: 'process.running',
        params: { name: 'Helper.exe' },
        remediation: {
          type: 'process.launch',
          params: { exe: '{USER}/Tools/Helper/Helper.exe', args: ['-tray'] },
        },
      },
      {
        type: 'device.connected',
        params: { vendorId: '044F', productId: 'B68F' },
        remediation: undefined,
      },
      {
        type: 'file.content',
        params: { path: '{SAVED_GAMES}/Sim/options.ini', rule: 'regex', value: 'vr=1' },
        remediation: { type: 'instructions.show', params: { text: 'Turn VR on\n\nOptions > VR' } },
      },
      {
        type: 'file.exists',
        params: { path: '{SAVED_GAMES}/Sim/options.ini', kind: 'file' },
        remediation: undefined,
      },
    ]);
  });

  it('says plainly when nothing in it has a match, and makes nothing', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const dir = path.join(app.ports.folders.dataRoot(), 'profiles');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'z7k1q2w3e4r.yaml'),
      yaml.dump({
        id: 'z7k1q2w3e4r',
        name: 'Screens only',
        game: 'other',
        checklistItems: [
          {
            id: 'a',
            type: 'display',
            name: 'Display: Cockpit',
            isRequired: true,
            category: 'display',
            config: { configurationName: 'Cockpit' },
          },
          {
            id: 'b',
            type: 'script',
            name: 'Warm up',
            isRequired: true,
            category: 'custom',
            config: { scriptPath: 'C:\\w.cmd', arguments: [], successExitCodes: [0], timeout: 5 },
          },
        ],
        trackedConfigurations: [],
      })
    );
    const plan = await app.invoke<EarlierPlan>('profiles:earlierPlan', { id: 'z7k1q2w3e4r' });
    expect(plan).toMatchObject({ canBringOver: false, checks: [], blocked: [], notes: [] });
    expect(plan.left.map((p) => p.title)).toEqual(['Display: Cockpit', 'Warm up']);
    const refused = await call(app, 'profiles:bringOver', { id: 'z7k1q2w3e4r' });
    expect(refused).toMatchObject({
      ok: false,
      error: {
        code: 'profile.earlierBlocked',
        message: 'RigReady cannot bring "Screens only" over.',
      },
    });
    expect(!refused.ok && refused.error.detail).toContain(
      'Display: Cockpit: RigReady 1 kept its monitor layouts'
    );
    expect(await fs.readdir(dir)).toEqual(['z7k1q2w3e4r.yaml']);
  });

  it('only a file RigReady 1 made, by a setup id, is ever looked at', async () => {
    app = await wiredApp('first-run-after-version-one', { files: [] });
    expect(await call(app, 'profiles:earlierPlan', { id: 'nothing-here' })).toMatchObject({
      ok: false,
    });
    expect(await call(app, 'profiles:earlierPlan', { id: '../settings' })).toMatchObject({
      ok: false,
      error: { code: 'profile.id' },
    });
    // A setup of this version is not one to bring over.
    await app.invoke('profiles:create', { name: 'Mine', checks: [] });
    expect(await call(app, 'profiles:earlierPlan', { id: 'mine' })).toMatchObject({
      ok: false,
      error: { code: 'profile.notEarlier' },
    });
    expect(await call(app, 'profiles:bringOver', { id: 'mine' })).toMatchObject({ ok: false });
    expect(await app.invoke<Profile[]>('profiles:list')).toHaveLength(1);
  });
});
