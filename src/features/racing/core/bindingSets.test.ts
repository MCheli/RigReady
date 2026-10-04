import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { BindingBackup, WheelView } from '../contract';
import { isBindingFile, setLabel } from './bindingSets';

/** RACE-FANATEC-005: a copy of a racing setup per steering wheel, each with its own bindings. */

interface Report {
  ready: boolean;
  results: { title: string; status: string; summary: string; details?: string[] }[];
}
interface Setup {
  id: string;
  name: string;
  backupId?: string;
}

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const BASE = 'racing-iracing';
const GT3 = 'iRacing bindings: GT3 rim';
const FORMULA = 'iRacing bindings: Formula rim';

async function start(): Promise<{ dir: string; controls: string; gt3: string }> {
  app = await wiredApp('mark-racing', { files: ['Documents/iRacing/**'] });
  const dir = path.join(app.ports.folders.documents(), 'iRacing');
  const controls = path.join(dir, 'controls.cfg');
  // The setup the owner races with, as the racing scenarios have it.
  const text = await fs.readFile(
    path.join(process.cwd(), 'fixtures', 'scenarios', 'profiles', 'racing-iracing.yaml'),
    'utf8'
  );
  await fs.mkdir(path.join(app.ports.folders.dataRoot(), 'profiles'), { recursive: true });
  await fs.writeFile(
    path.join(app.ports.folders.dataRoot(), 'profiles', `${BASE}.yaml`),
    text.replace('name: iRacing', 'name: iRacing GT3')
  );
  return { dir, controls, gt3: await fs.readFile(controls, 'latin1') };
}

const item = (report: Report, title: string) => report.results.find((r) => r.title === title)!;
const check = (profileId: string) => app!.invoke<Report>('fly:check', { profileId });

/** Clone the setup into a rim variant and give each its own named binding backup. */
async function makeVariant(controls: string): Promise<{
  variant: Profile;
  gt3: BindingBackup;
  formula: BindingBackup;
}> {
  const gt3 = await app!.invoke<BindingBackup>('racing:backup', {
    game: 'iracing',
    name: 'GT3 rim',
  });
  await app!.invoke('racing:useBackupInSetup', { game: 'iracing', id: gt3.id, profileId: BASE });
  // The copy, as the Setups page makes it, renamed.
  const copy = await app!.invoke<Profile>('profiles:clone', { id: BASE });
  const variant = await app!.invoke<Profile>('profiles:save', {
    ...copy,
    name: 'iRacing GT3 - Formula rim',
  });
  // Other rim on the base, its bindings set up in iRacing.
  await fs.writeFile(controls, 'bindings for the formula rim', 'latin1');
  app!.clock.advance(60_000);
  const formula = await app!.invoke<BindingBackup>('racing:backup', {
    game: 'iracing',
    name: 'Formula rim',
  });
  await app!.invoke('racing:useBackupInSetup', {
    game: 'iracing',
    id: formula.id,
    profileId: variant.id,
  });
  return { variant, gt3, formula };
}

describe('rim variants: a setup expects one set of bindings', () => {
  it('a cloned setup gets its own binding backup; each setup is met only with its own bindings, and its fix restores them', async () => {
    const { dir, controls, gt3: gt3Text } = await start();
    const appIni = path.join(dir, 'app.ini');
    const { variant, gt3, formula } = await makeVariant(controls);

    // The clone carried the original item over; "use in a setup" replaced it, not added to it.
    const saved = (await app!.wiring.context.profiles.get(variant.id)) as {
      ok: true;
      value: Profile;
    };
    const sets = saved.value.checks.filter((c) => c.type === 'racing.bindingSet');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      title: FORMULA,
      required: true,
      params: { game: 'iracing', backupId: formula.id, name: 'Formula rim' },
      remediation: { type: 'racing.restoreBindingSet', params: { backupId: formula.id } },
    });
    expect(await app!.invoke<Setup[]>('racing:backupSetups', { game: 'iracing' })).toEqual([
      { id: BASE, name: 'iRacing GT3', backupId: gt3.id },
      { id: variant.id, name: 'iRacing GT3 - Formula rim', backupId: formula.id },
    ]);

    // The formula bindings are in the game: the variant is met, the GT3 setup is not.
    expect(item(await check(variant.id), FORMULA)).toMatchObject({
      status: 'pass',
      summary: 'iRacing has the bindings saved as "Formula rim"',
    });
    const base = item(await check(BASE), GT3);
    expect(base).toMatchObject({
      status: 'fail',
      summary: 'iRacing has other bindings than "GT3 rim": 1 of 2 files differ',
    });
    expect(base.details).toEqual(['controls.cfg is not the one saved in "GT3 rim".']);

    // Back on the GT3 rim: the fix of that setup puts its bindings back. iRacing's options
    // (app.ini), changed by playing since, are not rolled back.
    await fs.writeFile(appIni, 'options changed while racing');
    const fixed = await app!.invoke<{
      step: { ok: boolean; message: string };
      result: { status: string };
    }>('fly:fix', {
      profileId: BASE,
      itemId: saved.value.checks.find((c) => c.type === 'racing.bindingSet')!.id,
    });
    expect(fixed.step).toMatchObject({
      ok: true,
      message:
        'Restored the iRacing bindings saved as "GT3 rim" (2 files); the ones that were there are backed up',
    });
    expect(fixed.result.status).toBe('pass');
    expect(await fs.readFile(controls, 'latin1')).toBe(gt3Text);
    expect(await fs.readFile(appIni, 'utf8')).toBe('options changed while racing');
    expect(item(await check(variant.id), FORMULA).status).toBe('fail');

    // And the other way with Make ready, as on the Play screen.
    await app!.invoke('fly:makeReady', { profileId: variant.id });
    expect(item(await check(variant.id), FORMULA).status).toBe('pass');
    expect(await fs.readFile(controls, 'latin1')).toBe('bindings for the formula rim');

    // Every restore is an action on the Safety page that can be undone.
    const groups = await app!.ports.files.journalGroups();
    const reasons = (groups.ok ? groups.value : []).map((g) => g.reason);
    expect(reasons).toContain('Restore iRacing bindings "GT3 rim"');
    expect(reasons).toContain('Restore iRacing bindings "Formula rim"');
  });

  it('does not restore while the simulator runs, and says why', async () => {
    const { controls } = await start();
    const { variant } = await makeVariant(controls);
    await mutate(app!, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    const saved = await app!.wiring.context.profiles.get(BASE);
    if (!saved.ok) throw new Error('profile');
    const itemId = saved.value.checks.find((c) => c.type === 'racing.bindingSet')!.id;
    const fixed = await app!.invoke<{ step: { ok: boolean; message: string } }>('fly:fix', {
      profileId: BASE,
      itemId,
    });
    expect(fixed.step.ok).toBe(false);
    expect(fixed.step.message).toContain('Close iRacing first');
    expect(await fs.readFile(controls, 'latin1')).toBe('bindings for the formula rim');
    expect(variant.id).not.toBe(BASE);
  });

  it('a deleted backup is said plainly; a setup of another game is refused; a setup can stop expecting bindings', async () => {
    const { controls } = await start();
    const { variant, formula, gt3 } = await makeVariant(controls);
    await app!.invoke('racing:deleteBackup', { game: 'iracing', id: formula.id });
    const gone = item(await check(variant.id), FORMULA);
    expect(gone).toMatchObject({
      status: 'fail',
      summary: 'The saved bindings "Formula rim" no longer exist',
    });

    // Naming: a name can be changed or taken away; the setup keeps pointing at the backup.
    const renamed = await app!.invoke<BindingBackup>('racing:nameBackup', {
      game: 'iracing',
      id: gt3.id,
      name: ' GT3 wheel ',
    });
    expect(renamed.name).toBe('GT3 wheel');
    expect(item(await check(BASE), GT3).summary).toContain('"GT3 wheel"');
    const unnamed = await app!.invoke<BindingBackup>('racing:nameBackup', {
      game: 'iracing',
      id: gt3.id,
      name: '',
    });
    expect(unnamed.name).toBeUndefined();
    expect(setLabel(unnamed)).toMatch(/^backup of \d+ \w+ \d{4}/);

    const lmu = await app!.wiring.context.profiles.save({
      ...variant,
      id: 'lmu-setup',
      name: 'Le Mans',
      game: 'lmu',
    });
    if (!lmu.ok) throw new Error(lmu.error.message);
    await expect(
      app!.invoke('racing:useBackupInSetup', {
        game: 'iracing',
        id: gt3.id,
        profileId: 'lmu-setup',
      })
    ).rejects.toThrow(
      '"Le Mans" is a setup for another game, so these iRacing bindings do not belong to it.'
    );
    await expect(
      app!.invoke('racing:useBackupInSetup', { game: 'iracing', id: 'nope', profileId: BASE })
    ).rejects.toThrow('That backup no longer exists.');

    const stopped = await app!.invoke<{ message: string }>('racing:stopUsingBackup', {
      game: 'iracing',
      profileId: BASE,
    });
    expect(stopped.message).toBe('"iRacing GT3" no longer expects particular bindings.');
    expect((await check(BASE)).results.some((r) => r.title === GT3)).toBe(false);
    const again = await app!.invoke<{ message: string }>('racing:stopUsingBackup', {
      game: 'iracing',
      profileId: BASE,
    });
    expect(again.message).toBe('"iRacing GT3" did not expect particular bindings.');
    expect(await app!.invoke<Setup[]>('racing:backupSetups', { game: 'fanatec' })).toEqual([]);
  });

  it('compares and restores binding files only, per game', () => {
    const file = (p: string, restorable = true) => ({ path: p, restorable });
    expect(isBindingFile('iracing', file('C:\\Docs\\iRacing\\controls.cfg'))).toBe(true);
    expect(isBindingFile('iracing', file('C:\\Docs\\iRacing\\setups\\gt3\\joyCalib.yaml'))).toBe(
      true
    );
    expect(isBindingFile('iracing', file('C:\\Docs\\iRacing\\app.ini'))).toBe(false);
    expect(isBindingFile('lmu', file('C:\\LMU\\UserData\\player\\direct input.json'))).toBe(true);
    expect(isBindingFile('lmu', file('C:\\LMU\\UserData\\player\\Settings.JSON'))).toBe(false);
    expect(isBindingFile('beamng', file('C:\\x\\inputmaps\\wheel.diff'))).toBe(true);
    expect(isBindingFile('assetto-corsa', file('C:\\x\\cfg\\controls.ini'))).toBe(true);
    expect(isBindingFile('fanatec', file('C:\\x\\shared_preferences.json'))).toBe(false);
    expect(isBindingFile('iracing', file('C:\\Docs\\iRacing\\controls.cfg', false))).toBe(false);
  });

  it('the rim itself is not a device a check can see: the driver only records the rims it has seen, so no rim check is offered', async () => {
    app = await wiredApp('mark-racing');
    // What Windows has: one USB device for the base, whatever rim is on it...
    const wheel = await app.invoke<WheelView>('racing:wheel');
    expect(wheel.status).toMatchObject({ vendorId: '0EB7', productId: '0007' });
    // ...and the Fanatec driver's record of rims it has seen, two on this rig, without
    // saying which one is on now. It is shown as "last seen", never as the rim attached.
    expect(wheel.status.lastSeen).toContainEqual({
      label: 'Steering wheel (rim) codes',
      value: '13, 17',
    });
    // So capture proposes the wheel base, and nothing that claims to check the rim.
    const captured = await app.invoke<{ candidates: { title: string; check: { type: string } }[] }>(
      'profiles:capture'
    );
    const racing = captured.candidates.filter((c) => c.check.type.startsWith('racing.'));
    expect(racing.map((c) => c.check.type)).toContain('racing.wheelBase');
    expect(captured.candidates.some((c) => /rim/i.test(c.title))).toBe(false);
  });
});
