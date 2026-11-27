import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ChangeResult, ChangeReview, Overview } from '../contract';
import { REGISTRY_KEY } from './view';

/**
 * One binding changed in what Nuclear Option saved, on
 * fixtures/scenarios/nuclear-option-bindings.yaml: shown first, written through FileStore
 * (a backup, the Safety page, Undo), refused while the game runs.
 */
const fixtures = path.join(__dirname, '..', '..', '..', '..', 'fixtures', 'nuclear-option');
const STICK = 'controller:044F:0402:0';

describe('changing a Nuclear Option binding', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const start = async (): Promise<WiredApp> => (app = await wiredApp('nuclear-option-bindings'));
  const review = (a: WiredApp, request: object): Promise<ChangeReview> =>
    a.invoke<ChangeReview>('nuclear-option-bindings:changePreview', request);
  const change = (a: WiredApp, request: object): Promise<ChangeResult> =>
    a.invoke<ChangeResult>('nuclear-option-bindings:change', request);
  /** The stick's stored map: its value name, and its text as the registry has it now. */
  async function stickValue(a: WiredApp): Promise<{ name: string; text: string }> {
    const values = JSON.parse(await fs.readFile(path.join(fixtures, 'values.json'), 'utf8')) as {
      name: string;
      file: string;
    }[];
    const name = values.find((v) => v.file === 'stick.xml')!.name;
    const value = await a.ports.registry.getValue('HKCU', REGISTRY_KEY, name);
    if (!value.ok || value.value?.type !== 'binary') throw new Error('no stick value');
    return { name, text: Buffer.from(value.value.value, 'hex').toString('utf8') };
  }
  const stickRows = async (a: WiredApp): Promise<string[]> => {
    const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
    return view.devices
      .find((d) => d.id === STICK)!
      .bindings.map((b) => `${b.action} = ${b.inputLabel}`);
  };

  it('the stick has the id the page changes it by', async () => {
    const a = await start();
    const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
    expect(view.devices.find((d) => d.name === 'Joystick - HOTAS Warthog')?.id).toBe(STICK);
  });

  it('shows the change first and writes nothing: what the action is on now and would be on, and what else is on that button', async () => {
    const a = await start();
    const before = await stickValue(a);
    const shown = await review(a, { device: STICK, actionId: 49, button: 1 });
    expect(shown).toMatchObject({
      device: 'Joystick - HOTAS Warthog',
      action: 'Toggle Navigation Lights',
      before: 'Not bound',
      after: 'Button 1',
      same: false,
      alsoOnButton: ['Fire'],
    });
    expect(shown.blocked).toBeUndefined();
    expect(shown.seen).toMatch(/^[0-9a-f]{64}$/);
    expect(shown.preview.files).toHaveLength(1);
    expect(shown.preview.files[0]).toMatchObject({
      label: 'Nuclear Option’s saved bindings for Joystick - HOTAS Warthog (registry)',
      change: 'modified',
    });
    expect((await stickValue(a)).text).toBe(before.text);
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('saves the change after a backup, the page and the readers show it, and Undo on the Safety page puts it back', async () => {
    const a = await start();
    const before = await stickValue(a);
    let notified = 0;
    a.wiring.context.bindings.onChanged((c) => {
      if (c.game === 'nuclear-option') notified++;
    });
    const shown = await review(a, { device: STICK, actionId: 49, button: 12 });
    const saved = await change(a, { device: STICK, actionId: 49, button: 12, seen: shown.seen });
    expect(saved).toEqual({
      changed: true,
      message:
        'Saved: Toggle Navigation Lights is now on Button 12 of Joystick - HOTAS Warthog. Undo is on the Safety page.',
    });
    expect(notified).toBe(1);
    // Only that binding was added, written as the game writes one the player made.
    const after = await stickValue(a);
    expect(after.text.length).toBeGreaterThan(before.text.length);
    expect(
      after.text.replace(
        /<ActionElementMap><actionCategoryId>-1<\/actionCategoryId><actionId>49<.*?<\/ActionElementMap>/,
        ''
      )
    ).toBe(before.text);
    expect(after.text.endsWith('\0')).toBe(true);
    expect(await stickRows(a)).toContain('Toggle Navigation Lights = Button 12');
    const bound = await a.wiring.context.bindings.get('nuclear-option')!.bindings('all');
    expect(
      bound.ok &&
        bound.value.devices
          .find((d) => d.name === 'Joystick - HOTAS Warthog')!
          .bindings.some(
            (b) => b.action === 'Toggle Navigation Lights' && b.inputLabel === 'Button 12'
          )
    ).toBe(true);

    // One entry on the Safety page, with a reason a person can read and a backup of the value.
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value).toHaveLength(1);
    expect(journal.value[0]!.reason).toBe(
      'Nuclear Option bindings: Toggle Navigation Lights bound to Button 12 on Joystick - HOTAS Warthog'
    );
    const entry = journal.value[0]!.entries[0]!;
    expect(await fs.readFile(entry.backupPath!, 'utf8')).toBe(before.text);

    const undone = await a.ports.files.undoGroup(journal.value[0]!.id);
    expect(undone.ok).toBe(true);
    expect((await stickValue(a)).text).toBe(before.text);
    expect(await stickRows(a)).not.toContain('Toggle Navigation Lights = Button 12');
  });

  it('moves and clears a binding, and says so when nothing had to change', async () => {
    const a = await start();
    expect(await stickRows(a)).toContain('Next Weapon = Button 3');
    expect((await review(a, { device: STICK, actionId: 9, button: 9 })).before).toBe('Button 3');
    expect((await change(a, { device: STICK, actionId: 9, button: 9 })).changed).toBe(true);
    expect(await stickRows(a)).toContain('Next Weapon = Button 9');
    expect(await stickRows(a)).not.toContain('Next Weapon = Button 3');

    expect(await change(a, { device: STICK, actionId: 9, button: 9 })).toEqual({
      changed: false,
      message:
        'Nothing was changed: Next Weapon is already on Button 9 of Joystick - HOTAS Warthog.',
    });
    expect(await change(a, { device: STICK, actionId: 9, button: null })).toEqual({
      changed: true,
      message:
        'Saved: Next Weapon is no longer bound on Joystick - HOTAS Warthog. Undo is on the Safety page.',
    });
    expect((await stickRows(a)).some((row) => row.startsWith('Next Weapon'))).toBe(false);
    expect(await change(a, { device: STICK, actionId: 9, button: null })).toMatchObject({
      changed: false,
    });
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toHaveLength(2);
  });

  it('is refused while the game runs, and when the programs cannot be listed, and writes nothing', async () => {
    const a = await start();
    const before = await stickValue(a);
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    const shown = await review(a, { device: STICK, actionId: 49, button: 12 });
    expect(shown.blocked).toContain('Close Nuclear Option first');
    await expect(change(a, { device: STICK, actionId: 49, button: 12 })).rejects.toThrow(
      'Close Nuclear Option first'
    );
    expect((await stickValue(a)).text).toBe(before.text);
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('writes nothing when the saved bindings changed after the change was shown', async () => {
    const a = await start();
    const shown = await review(a, { device: STICK, actionId: 49, button: 12 });
    // Meanwhile the game was run and saved its own change (here: another binding).
    expect((await change(a, { device: STICK, actionId: 52, button: 13 })).changed).toBe(true);
    const between = await stickValue(a);
    await expect(
      change(a, { device: STICK, actionId: 49, button: 12, seen: shown.seen })
    ).rejects.toThrow('changed after the change was shown');
    expect((await stickValue(a)).text).toBe(between.text);
  });

  it('refuses an axis, an action it does not know, a controller without saved bindings, and the keyboard', async () => {
    const a = await start();
    const before = await stickValue(a);
    await expect(review(a, { device: STICK, actionId: 0, button: 3 })).rejects.toThrow(
      'Pitch Axis is an axis'
    );
    await expect(review(a, { device: STICK, actionId: 99, button: 3 })).rejects.toThrow(
      'does not know this action'
    );
    await expect(
      review(a, { device: 'controller:1234:5678:0', actionId: 49, button: 3 })
    ).rejects.toThrow('has saved no bindings for this controller');
    await expect(review(a, { device: 'keyboard', actionId: 49, button: 3 })).rejects.toThrow(
      'has saved no bindings for this controller'
    );
    // The schema refuses a button out of range before anything is looked at.
    await expect(change(a, { device: STICK, actionId: 49, button: 129 })).rejects.toThrow();
    expect((await stickValue(a)).text).toBe(before.text);
  });
});
