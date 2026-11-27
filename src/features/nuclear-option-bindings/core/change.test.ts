import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ChangeResult, ChangeReview, ClearDeviceReview, Overview } from '../contract';
import { err, ok } from '../../../core/result';
import { whyBlocked } from './change';
import { REGISTRY_KEY, type BindingsContext } from './view';

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

  it('the one list of programs that was read decides whether the game is open', async () => {
    const game = { processes: ['NuclearOption.exe'] };
    const context = (lists: unknown[]): BindingsContext => {
      let call = 0;
      return {
        ports: { processes: { list: async () => lists[Math.min(call++, lists.length - 1)] } },
        games: { get: () => game },
      } as unknown as BindingsContext;
    };
    const running = ok([{ name: 'nuclearoption.exe', pid: 1 }]);
    const failed = err('processes.list', 'no list');
    // Open in the list that was read: refused, whatever a second read would say.
    expect(await whyBlocked(context([running, failed]))).toContain('Close Nuclear Option first');
    expect(await whyBlocked(context([running, ok([])]))).toContain('Close Nuclear Option first');
    // Closed in the list that was read: a second read that fails is never asked for.
    expect(await whyBlocked(context([ok([]), failed]))).toBeUndefined();
    expect(await whyBlocked(context([failed]))).toContain('could not see which programs');
  });

  it('two saves at once do not lose one: the second is refused, because the map it was shown is gone', async () => {
    const a = await start();
    const first = await review(a, { device: STICK, actionId: 49, button: 12 });
    const second = await review(a, { device: STICK, actionId: 52, button: 13 });
    expect(second.seen).toBe(first.seen);
    const results = await Promise.allSettled([
      change(a, { device: STICK, actionId: 49, button: 12, seen: first.seen }),
      change(a, { device: STICK, actionId: 52, button: 13, seen: second.seen }),
    ]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { changed: true } });
    expect(results[1].status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain(
      'changed after the change was shown'
    );
    // The first save's binding is there, and only that one entry is on the Safety page.
    const rows = await stickRows(a);
    expect(rows).toContain('Toggle Navigation Lights = Button 12');
    expect(rows.some((row) => row.startsWith('Link Guns'))).toBe(false);
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toHaveLength(1);
  });

  it('Undo on the Safety page is refused while the game runs, and works once it is closed', async () => {
    const a = await start();
    const before = await stickValue(a);
    expect((await change(a, { device: STICK, actionId: 49, button: 12 })).changed).toBe(true);
    const after = await stickValue(a);
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    const groupId = journal.value[0]!.id;
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    await expect(a.invoke('safety:undo', { groupId, force: false })).rejects.toThrow(
      /Nuclear Option is running.*Nothing was undone/
    );
    // "Undo anyway" is for a file changed since, not a way past a running game.
    await expect(a.invoke('safety:undo', { groupId, force: true })).rejects.toThrow(
      /Nuclear Option is running/
    );
    expect((await stickValue(a)).text).toBe(after.text);
    await mutate(a, [{ op: 'stopProcess', name: 'NuclearOption.exe' }]);
    await a.invoke('safety:undo', { groupId, force: false });
    expect((await stickValue(a)).text).toBe(before.text);
  });

  it('saved bindings with a byte that is not UTF-8 are not changed: the text made from them would lose it', async () => {
    const a = await start();
    const stick = await stickValue(a);
    const bytes = Buffer.from(stick.text, 'utf8');
    // One byte of the controller's name replaced by one that is not valid UTF-8.
    const at = bytes.indexOf(Buffer.from('HOTAS', 'utf8'));
    bytes[at] = 0xff;
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name: stick.name,
        value: { type: 'binary', value: bytes.toString('hex') },
      },
    ]);
    await expect(review(a, { device: STICK, actionId: 49, button: 12 })).rejects.toThrow(
      'cannot write back exactly'
    );
    await expect(change(a, { device: STICK, actionId: 49, button: 12 })).rejects.toThrow(
      'cannot write back exactly'
    );
    const now = await a.ports.registry.getValue('HKCU', REGISTRY_KEY, stick.name);
    expect(now.ok && now.value).toEqual({ type: 'binary', value: bytes.toString('hex') });
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  describe('an axis, and a button on one side of an axis', () => {
    const stickAxes = async (a: WiredApp): Promise<string[]> => {
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      return view.devices.find((d) => d.id === STICK)!.controls!.axes;
    };

    it('offers each axis action as a whole and by its two sides, and each button action once', async () => {
      const a = await start();
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      const zoom = view.actions.filter((x) => x.id === 25);
      expect(zoom).toEqual([
        {
          id: 25,
          key: '25',
          name: 'Zoom View',
          category: 'Camera Controls',
          mapCategory: 'Game',
          takes: 'axis',
        },
        {
          id: 25,
          side: '+',
          key: '25:+',
          name: 'Zoom In',
          category: 'Camera Controls',
          mapCategory: 'Game',
          takes: 'button',
        },
        {
          id: 25,
          side: '-',
          key: '25:-',
          name: 'Zoom Out',
          category: 'Camera Controls',
          mapCategory: 'Game',
          takes: 'button',
        },
      ]);
      expect(view.actions.filter((x) => x.id === 49)).toEqual([
        {
          id: 49,
          key: '49',
          name: 'Toggle Navigation Lights',
          category: 'Flight Controls',
          mapCategory: 'Game',
          takes: 'button',
        },
      ]);
      expect(new Set(view.actions.map((x) => x.key)).size).toBe(view.actions.length);
    });

    it('binds an axis by the name RigReady shows it under, reversed or not, and clears it; Undo puts it back', async () => {
      const a = await start();
      const before = await stickValue(a);
      const axes = await stickAxes(a);
      expect(axes.length).toBeGreaterThan(0);
      // The first axis, where Roll Axis already is.
      const first = axes[0]!;
      // Yaw Axis (2) has nothing on the stick.
      const shown = await review(a, {
        device: STICK,
        actionId: 2,
        axis: { name: first, invert: true },
      });
      expect(shown).toMatchObject({
        action: 'Yaw Axis',
        before: 'Not bound',
        same: false,
        alsoOnButton: ['Roll Axis'],
      });
      expect(shown.after).toMatch(/, reversed$/);
      expect((await stickValue(a)).text).toBe(before.text);

      const saved = await change(a, {
        device: STICK,
        actionId: 2,
        axis: { name: first, invert: true },
        seen: shown.seen,
      });
      expect(saved).toEqual({
        changed: true,
        message: `Saved: Yaw Axis is now on ${shown.after} of Joystick - HOTAS Warthog. Undo is on the Safety page.`,
      });
      // The value holds the axis by its number, as the game writes one the player made.
      expect((await stickValue(a)).text).toContain(
        '<actionCategoryId>-1</actionCategoryId><actionId>2</actionId><elementType>0</elementType><elementIdentifierId>0</elementIdentifierId><axisRange>0</axisRange><invert>true</invert>'
      );
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      const yaw = view.devices
        .find((d) => d.id === STICK)!
        .bindings.find((b) => b.action === 'Yaw Axis')!;
      expect(yaw).toMatchObject({ kind: 'axis', inverted: true });
      expect(yaw.control).toEqual({ kind: 'axis', axis: first });

      // Pitch Axis is on the second axis: putting it on the first says what is there already.
      const also = await review(a, {
        device: STICK,
        actionId: 0,
        axis: { name: first, invert: false },
      });
      expect(also.alsoOnButton).toEqual(['Roll Axis', 'Yaw Axis']);

      const cleared = await change(a, { device: STICK, actionId: 2, axis: null });
      expect(cleared.message).toBe(
        'Saved: Yaw Axis is no longer bound on Joystick - HOTAS Warthog. Undo is on the Safety page.'
      );
      expect((await stickValue(a)).text).toBe(before.text);
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value.map((g) => g.reason).sort()).toEqual([
        `Nuclear Option bindings: Yaw Axis bound to ${shown.after} on Joystick - HOTAS Warthog`,
        'Nuclear Option bindings: Yaw Axis cleared on Joystick - HOTAS Warthog',
      ]);
    });

    it('binds a button to one side of an axis action under the side’s own name', async () => {
      const a = await start();
      const shown = await review(a, { device: STICK, actionId: 25, side: '+', button: 20 });
      expect(shown).toMatchObject({ action: 'Zoom In', before: 'Not bound', after: 'Button 20' });
      const saved = await change(a, {
        device: STICK,
        actionId: 25,
        side: '+',
        button: 20,
        seen: shown.seen,
      });
      expect(saved.message).toBe(
        'Saved: Zoom In is now on Button 20 of Joystick - HOTAS Warthog. Undo is on the Safety page.'
      );
      await change(a, { device: STICK, actionId: 25, side: '-', button: 21 });
      const rows = await stickRows(a);
      expect(rows).toContain('Zoom In = Button 20');
      expect(rows).toContain('Zoom Out = Button 21');
      expect(
        (await change(a, { device: STICK, actionId: 25, side: '-', button: null })).message
      ).toBe(
        'Saved: Zoom Out is no longer bound on Joystick - HOTAS Warthog. Undo is on the Safety page.'
      );
      expect(await stickRows(a)).toContain('Zoom In = Button 20');
    });

    it('refuses an axis the controller does not have, a request with neither or both, and an axis on a button action', async () => {
      const a = await start();
      const before = await stickValue(a);
      await expect(
        review(a, { device: STICK, actionId: 2, axis: { name: 'NOPE', invert: false } })
      ).rejects.toThrow('This controller has no axis called NOPE');
      await expect(review(a, { device: STICK, actionId: 2 })).rejects.toThrow();
      await expect(
        review(a, { device: STICK, actionId: 2, button: 3, axis: { name: 'X', invert: false } })
      ).rejects.toThrow();
      await expect(
        review(a, { device: STICK, actionId: 49, axis: { name: 'X', invert: false } })
      ).rejects.toThrow('Toggle Navigation Lights is a button');
      await expect(review(a, { device: STICK, actionId: 0, button: 3 })).rejects.toThrow(
        'Pitch Axis is an axis'
      );
      expect((await stickValue(a)).text).toBe(before.text);
    });
  });

  describe('a key of the keyboard', () => {
    const KEYBOARD = 'keyboard';
    const keyRows = async (a: WiredApp): Promise<string[]> => {
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      return view.devices
        .find((d) => d.kind === 'keyboard')!
        .bindings.map((b) => `${b.action} = ${[...b.modifiers, b.inputLabel].join(' + ')}`);
    };
    const values = async (a: WiredApp): Promise<Record<string, unknown>> => {
      const all = await a.ports.registry.listValues('HKCU', REGISTRY_KEY);
      if (!all.ok) throw new Error(all.error.message);
      return all.value;
    };
    const differing = (before: Record<string, unknown>, after: Record<string, unknown>): string[] =>
      Object.keys(before).filter(
        (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])
      );

    it('the keyboard has the id the page changes it by', async () => {
      const a = await start();
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      expect(view.devices.find((d) => d.kind === 'keyboard')?.id).toBe(KEYBOARD);
    });

    it('binds a key, with modifier keys, shows it first, and Undo puts the keyboard’s map back', async () => {
      const a = await start();
      const before = await values(a);
      // Toggle Engine (50) has no key.
      const shown = await review(a, { device: KEYBOARD, actionId: 50, key: { code: 'F7' } });
      expect(shown).toMatchObject({
        device: 'the keyboard',
        action: 'Toggle Engine',
        before: 'Not bound',
        after: 'F7',
        same: false,
        alsoOnButton: [],
      });
      expect(await values(a)).toEqual(before);
      const saved = await change(a, {
        device: KEYBOARD,
        actionId: 50,
        key: { code: 'F7' },
        seen: shown.seen,
      });
      expect(saved).toEqual({
        changed: true,
        message: 'Saved: Toggle Engine is now on F7 of the keyboard. Undo is on the Safety page.',
      });
      const after = await values(a);
      // One value changed, the keyboard's map for the Game tab, by the binding the game writes.
      const changed = differing(before, after);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('controllerMapType=KeyboardMap|categoryId=0');
      const text = Buffer.from((after[changed[0]!] as { value: string }).value, 'hex').toString(
        'utf8'
      );
      expect(text).toContain(
        '<actionCategoryId>0</actionCategoryId><actionId>50</actionId><elementType>1</elementType><elementIdentifierId>104</elementIdentifierId><axisRange>0</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>288</keyboardKeyCode>'
      );
      expect(await keyRows(a)).toContain('Toggle Engine = F7');

      // With modifier keys, and what else has that key with those modifiers.
      const withMods = await review(a, {
        device: KEYBOARD,
        actionId: 50,
        key: { code: 'KeyE', ctrl: true, shift: true },
      });
      expect(withMods).toMatchObject({
        before: 'F7',
        after: 'Ctrl + Shift + E',
        alsoOnButton: ['Eject'],
      });
      await change(a, { device: KEYBOARD, actionId: 50, key: { code: 'KeyE', alt: true } });
      expect(await keyRows(a)).toContain('Toggle Engine = Alt + E');

      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value.map((g) => g.reason).sort()).toEqual([
        'Nuclear Option bindings: Toggle Engine bound to Alt + E on the keyboard',
        'Nuclear Option bindings: Toggle Engine bound to F7 on the keyboard',
      ]);
      const cleared = await change(a, { device: KEYBOARD, actionId: 50, key: null });
      expect(cleared.message).toBe(
        'Saved: Toggle Engine is no longer bound on the keyboard. Undo is on the Safety page.'
      );
      expect(await values(a)).toEqual(before);
    });

    it('binds one side of an axis action, and an action of another tab in that tab’s own map', async () => {
      const a = await start();
      const before = await values(a);
      const side = await change(a, {
        device: KEYBOARD,
        actionId: 25,
        side: '+',
        key: { code: 'NumpadAdd' },
      });
      expect(side.message).toBe(
        'Saved: Zoom In is now on Num + of the keyboard. Undo is on the Safety page.'
      );
      const afterSide = await values(a);
      expect(differing(before, afterSide)[0]).toContain('KeyboardMap|categoryId=0');
      // Submit Chat is on the Chat tab: its key goes into the keyboard's Chat map.
      const chat = await change(a, { device: KEYBOARD, actionId: 34, key: { code: 'F9' } });
      expect(chat.changed).toBe(true);
      const afterChat = await values(a);
      const changed = differing(afterSide, afterChat);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain('KeyboardMap|categoryId=1');
    });

    it('refuses a whole axis on a key, a key RigReady cannot number, and everything while the game runs', async () => {
      const a = await start();
      const before = await values(a);
      await expect(
        review(a, { device: KEYBOARD, actionId: 25, key: { code: 'F7' } })
      ).rejects.toThrow(
        'Zoom View is an axis: bind a key to one of its sides (Zoom In or Zoom Out)'
      );
      await expect(
        review(a, { device: KEYBOARD, actionId: 50, key: { code: 'IntlBackslash' } })
      ).rejects.toThrow('RigReady does not know how the game numbers that key');
      await mutate(a, [
        { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
      ]);
      expect(
        (await review(a, { device: KEYBOARD, actionId: 50, key: { code: 'F7' } })).blocked
      ).toContain('Close Nuclear Option first');
      await expect(
        change(a, { device: KEYBOARD, actionId: 50, key: { code: 'F7' } })
      ).rejects.toThrow('Close Nuclear Option first');
      expect(await values(a)).toEqual(before);
    });
  });

  describe('every binding of one controller', () => {
    const THROTTLE = 'controller:044F:0404:0';
    const clearReview = (a: WiredApp, request: object): Promise<ClearDeviceReview> =>
      a.invoke<ClearDeviceReview>('nuclear-option-bindings:clearDevicePreview', request);
    const clear = (a: WiredApp, request: object): Promise<ChangeResult> =>
      a.invoke<ChangeResult>('nuclear-option-bindings:clearDevice', request);
    const bound = async (a: WiredApp, id: string): Promise<number> => {
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      return view.devices.find((d) => d.id === id)!.bindings.length;
    };
    const allValues = async (a: WiredApp): Promise<Record<string, unknown>> => {
      const values = await a.ports.registry.listValues('HKCU', REGISTRY_KEY);
      if (!values.ok) throw new Error(values.error.message);
      return values.value;
    };

    it('is shown first, then cleared in one entry on the Safety page, and Undo puts every binding back', async () => {
      const a = await start();
      const before = await allValues(a);
      expect(await bound(a, THROTTLE)).toBe(8);
      const stickBound = await bound(a, STICK);

      const shown = await clearReview(a, { device: THROTTLE });
      expect(shown).toMatchObject({
        device: 'Throttle - HOTAS Warthog',
        bindings: 8,
        same: false,
      });
      expect(shown.blocked).toBeUndefined();
      // The throttle's Chat map has nothing bound, so only its Game map is written.
      expect(shown.preview.files).toHaveLength(1);
      expect(await allValues(a)).toEqual(before);

      const result = await clear(a, { device: THROTTLE, seen: shown.seen });
      expect(result).toEqual({
        changed: true,
        message:
          'Saved: 8 bindings cleared on Throttle - HOTAS Warthog. Undo is on the Safety page.',
      });
      expect(await bound(a, THROTTLE)).toBe(0);
      expect(await bound(a, STICK)).toBe(stickBound);
      // Exactly one value differs, and it has no binding left in it.
      const after = await allValues(a);
      const differing = Object.keys(before).filter(
        (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])
      );
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(differing).toHaveLength(1);
      const value = after[differing[0]!] as { type: string; value: string };
      const text = Buffer.from(value.value, 'hex').toString('utf8');
      expect(text).toContain('<buttonMaps /><axisMaps />');
      expect(text.endsWith('\0')).toBe(true);

      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value).toHaveLength(1);
      expect(journal.value[0]!.reason).toBe(
        'Nuclear Option bindings: all 8 bindings cleared on Throttle - HOTAS Warthog'
      );
      await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      expect(await allValues(a)).toEqual(before);
      expect(await bound(a, THROTTLE)).toBe(8);
    });

    /** The throttle's Chat map (categoryId=1) with one binding put into it, or with other bytes. */
    const CHAT = /JoystickMap\|categoryId=1\|.*Throttle/;
    const chatName = async (a: WiredApp): Promise<string> =>
      Object.keys(await allValues(a)).find((name) => CHAT.test(name))!;
    const setChat = async (a: WiredApp, text: string): Promise<void> => {
      await mutate(a, [
        {
          op: 'setRegistryValue',
          hive: 'HKCU',
          key: REGISTRY_KEY,
          name: await chatName(a),
          value: { type: 'binary', value: Buffer.from(text, 'utf8').toString('hex') },
        },
      ]);
    };
    const chatWithBinding = async (a: WiredApp): Promise<void> => {
      const value = (await allValues(a))[await chatName(a)] as { value: string };
      const text = Buffer.from(value.value, 'hex').toString('utf8');
      expect(text).toContain('<buttonMaps />');
      // Submit Chat (34) on button 5, written as the game writes a binding the player made.
      await setChat(
        a,
        text.replace(
          '<buttonMaps />',
          '<buttonMaps><ActionElementMap><actionCategoryId>-1</actionCategoryId><actionId>34</actionId><elementType>1</elementType><elementIdentifierId>36</elementIdentifierId><axisRange>1</axisRange><invert>false</invert><axisContribution>0</axisContribution><keyboardKeyCode>0</keyboardKeyCode><modifierKey1>0</modifierKey1><modifierKey2>0</modifierKey2><modifierKey3>0</modifierKey3><enabled>true</enabled></ActionElementMap></buttonMaps>'
        )
      );
    };

    it('a controller bound in two tabs of the game’s screen: both maps are shown, cleared in one entry, and Undo puts both back', async () => {
      const a = await start();
      await chatWithBinding(a);
      const before = await allValues(a);
      expect(await bound(a, THROTTLE)).toBe(9);

      const shown = await clearReview(a, { device: THROTTLE });
      expect(shown).toMatchObject({ bindings: 9, same: false });
      expect(shown.preview.files).toHaveLength(2);
      expect(shown.preview.files.every((f) => f.change === 'modified')).toBe(true);

      expect((await clear(a, { device: THROTTLE, seen: shown.seen })).message).toBe(
        'Saved: 9 bindings cleared on Throttle - HOTAS Warthog. Undo is on the Safety page.'
      );
      const after = await allValues(a);
      const differing = Object.keys(before).filter(
        (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name])
      );
      expect(differing).toHaveLength(2);
      for (const name of differing) {
        const text = Buffer.from((after[name] as { value: string }).value, 'hex').toString('utf8');
        expect(text, name).toContain('<buttonMaps /><axisMaps />');
        expect(name).toContain('Throttle');
      }
      // One entry on the Safety page holds both values; Undo puts both back byte for byte.
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value).toHaveLength(1);
      expect(journal.value[0]!.entries).toHaveLength(2);
      await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      expect(await allValues(a)).toEqual(before);
    });

    it('a failure after the first map was cleared says that part is cleared, and Undo puts it back', async () => {
      const a = await start();
      await chatWithBinding(a);
      const before = await allValues(a);
      // The second write to the registry fails.
      const files = a.ports.files;
      const write = files.write.bind(files);
      let writes = 0;
      files.write = (async (...args: Parameters<typeof write>) =>
        ++writes === 2
          ? err('file.write', 'The value could not be written.')
          : write(...args)) as typeof write;
      await expect(clear(a, { device: THROTTLE })).rejects.toThrow(
        /The value could not be written\. Part of Throttle - HOTAS Warthog’s bindings was already cleared; Undo on the Safety page puts them back\./
      );
      files.write = write;
      // The Game map is cleared, the Chat map is as it was.
      expect(await bound(a, THROTTLE)).toBe(1);
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value).toHaveLength(1);
      await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      expect(await allValues(a)).toEqual(before);
    });

    it('a controller with a saved map that cannot be read is not cleared at all; another controller still is', async () => {
      const a = await start();
      await setChat(a, 'not a map');
      const before = await allValues(a);
      await expect(clearReview(a, { device: THROTTLE })).rejects.toThrow(
        'One of the game’s saved maps for this controller could not be read'
      );
      await expect(clear(a, { device: THROTTLE })).rejects.toThrow(
        'One of the game’s saved maps for this controller could not be read'
      );
      expect(await allValues(a)).toEqual(before);
      const journal = await a.ports.files.journalGroups();
      expect(journal.ok && journal.value).toEqual([]);
      // The stick has nothing to do with it.
      expect((await clear(a, { device: STICK })).changed).toBe(true);
      expect(await bound(a, STICK)).toBe(0);
    });

    it('a controller with nothing bound is left alone, and says so', async () => {
      const a = await start();
      await clear(a, { device: THROTTLE });
      const again = await clearReview(a, { device: THROTTLE });
      expect(again).toMatchObject({ bindings: 0, same: true });
      expect(again.preview.files).toEqual([]);
      expect(await clear(a, { device: THROTTLE })).toEqual({
        changed: false,
        message: 'Nothing was changed: nothing is bound on Throttle - HOTAS Warthog.',
      });
      const journal = await a.ports.files.journalGroups();
      expect(journal.ok && journal.value).toHaveLength(1);
    });

    it('is refused while the game runs, when the bindings changed since it was shown, and for the keyboard', async () => {
      const a = await start();
      const before = await allValues(a);
      const shown = await clearReview(a, { device: THROTTLE });
      await mutate(a, [
        { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
      ]);
      expect((await clearReview(a, { device: THROTTLE })).blocked).toContain(
        'Close Nuclear Option first'
      );
      await expect(clear(a, { device: THROTTLE, seen: shown.seen })).rejects.toThrow(
        'Close Nuclear Option first'
      );
      await mutate(a, [{ op: 'stopProcess', name: 'NuclearOption.exe' }]);
      // A binding saved on the throttle meanwhile: what was shown no longer holds.
      await change(a, { device: THROTTLE, actionId: 49, button: 30 });
      const changed = await allValues(a);
      await expect(clear(a, { device: THROTTLE, seen: shown.seen })).rejects.toThrow(
        'changed after the change was shown'
      );
      expect(await allValues(a)).toEqual(changed);
      expect(changed).not.toEqual(before);
      const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
      const keyboard = view.devices.find((d) => d.kind === 'keyboard')!;
      await expect(clear(a, { device: keyboard.id })).rejects.toThrow('nothing to clear');
    });
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
      'On the keyboard an action is bound to a key.'
    );
    await expect(review(a, { device: STICK, actionId: 49, key: { code: 'F7' } })).rejects.toThrow(
      'A key is bound on the keyboard, not on a controller.'
    );
    // The schema refuses a button out of range before anything is looked at.
    await expect(change(a, { device: STICK, actionId: 49, button: 129 })).rejects.toThrow();
    expect((await stickValue(a)).text).toBe(before.text);
  });
});
