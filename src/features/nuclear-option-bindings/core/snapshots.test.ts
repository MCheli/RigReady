import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ChangeResult, Overview, Snapshot, SnapshotRestoreReview } from '../contract';
import { REGISTRY_KEY } from './view';

/**
 * Snapshots of Nuclear Option's bindings on fixtures/scenarios/nuclear-option-bindings.yaml:
 * taken from what the game saved, kept in RigReady's own folder, and put back through
 * FileStore after a review (a backup, one entry on the Safety page, Undo).
 */
const STICK = 'controller:044F:0402:0';
const THROTTLE = 'controller:044F:0404:0';

describe('snapshots of Nuclear Option’s bindings', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });
  const start = async (): Promise<WiredApp> => (app = await wiredApp('nuclear-option-bindings'));
  const list = (a: WiredApp): Promise<Snapshot[]> =>
    a.invoke<Snapshot[]>('nuclear-option-bindings:snapshots');
  const take = (a: WiredApp, name: string): Promise<Snapshot> =>
    a.invoke<Snapshot>('nuclear-option-bindings:snapshotCreate', { name });
  const review = (a: WiredApp, id: string): Promise<SnapshotRestoreReview> =>
    a.invoke<SnapshotRestoreReview>('nuclear-option-bindings:snapshotRestorePreview', { id });
  const restore = (a: WiredApp, id: string, seen?: string): Promise<ChangeResult> =>
    a.invoke<ChangeResult>('nuclear-option-bindings:snapshotRestore', {
      id,
      ...(seen ? { seen } : {}),
    });
  const values = async (a: WiredApp): Promise<Record<string, unknown>> => {
    const all = await a.ports.registry.listValues('HKCU', REGISTRY_KEY);
    if (!all.ok) throw new Error(all.error.message);
    return all.value;
  };
  const bound = async (a: WiredApp, id: string): Promise<number> => {
    const view = await a.invoke<Overview>('nuclear-option-bindings:overview');
    return view.devices.find((d) => d.id === id)!.bindings.length;
  };

  it('takes a snapshot of every saved map without changing the game’s values, and lists it', async () => {
    const a = await start();
    const before = await values(a);
    expect(await list(a)).toEqual([]);
    const taken = await take(a, '  Before the patch  ');
    expect(taken).toMatchObject({ name: 'Before the patch' });
    expect(taken.id).toMatch(/^\d{14}-before-the-patch$/);
    // The scenario's values the game uses: the stick (not the map an earlier build left
    // behind beside it), the throttle (two tabs), the pedals, the keyboard (two tabs), the mouse.
    expect(taken.maps).toBe(7);
    expect(taken.bindings).toBeGreaterThan(20);
    expect(taken.devices).toEqual([
      'Joystick - HOTAS Warthog',
      'T-Rudder',
      'the keyboard',
      'the mouse',
      'Throttle - HOTAS Warthog',
    ]);
    expect(await values(a)).toEqual(before);
    expect(await list(a)).toEqual([taken]);
    // Nothing outside RigReady's folder was written: the journal has no entry for the game.
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
    // A second one under the same name in the same second is kept beside it.
    const again = await take(a, 'Before the patch');
    expect(again.id).not.toBe(taken.id);
    expect(await list(a)).toHaveLength(2);
    await expect(take(a, '   ')).rejects.toThrow();
  });

  it('restores after a review: only what differs is written, in one entry on the Safety page, and Undo takes it out again', async () => {
    const a = await start();
    const taken = await take(a, 'Clean');
    const before = await values(a);
    // Nothing differs yet.
    const same = await review(a, taken.id);
    expect(same).toMatchObject({ name: 'Clean', same: true, devices: [], gone: [], newer: [] });
    expect(await restore(a, taken.id)).toEqual({
      changed: false,
      message: 'Nothing was changed: the bindings are as they were in “Clean”.',
    });

    // The throttle is cleared and the stick gets a binding: two values differ.
    await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
    await a.invoke('nuclear-option-bindings:change', { device: STICK, actionId: 49, button: 12 });
    const changed = await values(a);
    expect(changed).not.toEqual(before);
    const shown = await review(a, taken.id);
    expect(shown.same).toBe(false);
    expect(shown.devices).toEqual([
      // Counted as the saved maps hold them: every element, also one the page folds into another.
      // Binding by binding: what a restore takes away again, and what it brings back, with
      // the axes named as the plugged-in controller names them.
      {
        name: 'Joystick - HOTAS Warthog',
        now: 9,
        then: 8,
        back: [],
        goes: ['Toggle Navigation Lights = Button 12'],
      },
      {
        name: 'Throttle - HOTAS Warthog',
        now: 0,
        then: 8,
        back: [
          'Throttle Axis = Z axis, reversed',
          'Custom Axis 1 = Slider 1',
          'Apply Brakes = Z rotation (positive half)',
          'Toggle Gear = Button 18',
          'Eject = Button 32',
          'Zoom In = Button 7',
          'Zoom Out = Button 8',
          'Action 99 = Button 9',
        ],
        goes: [],
      },
    ]);
    expect(shown.preview.files).toHaveLength(2);
    expect(await values(a)).toEqual(changed);

    const result = await restore(a, taken.id, shown.seen);
    expect(result).toEqual({
      changed: true,
      message: 'Restored: “Clean” is back on 2 devices. Undo is on the Safety page.',
    });
    expect(await values(a)).toEqual(before);
    expect(await bound(a, THROTTLE)).toBe(8);
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    const group = journal.value.find(
      (g) => g.reason === 'Nuclear Option bindings: snapshot “Clean” restored'
    )!;
    expect(group.entries).toHaveLength(2);
    await a.invoke('safety:undo', { groupId: group.id, force: false });
    expect(await values(a)).toEqual(changed);
  });

  it('is refused while the game runs and when the bindings changed after the review; nothing is written', async () => {
    const a = await start();
    const taken = await take(a, 'Clean');
    await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
    const shown = await review(a, taken.id);
    await a.invoke('nuclear-option-bindings:change', { device: STICK, actionId: 49, button: 12 });
    const changed = await values(a);
    await expect(restore(a, taken.id, shown.seen)).rejects.toThrow(
      'changed after the change was shown'
    );
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    expect((await review(a, taken.id)).blocked).toContain('Close Nuclear Option first');
    await expect(restore(a, taken.id)).rejects.toThrow('Close Nuclear Option first');
    expect(await values(a)).toEqual(changed);
  });

  it('does not make a value the game no longer has, and leaves alone one it has only now; it says both', async () => {
    const a = await start();
    const taken = await take(a, 'With the pedals');
    const all = await values(a);
    const pedals = Object.keys(all).find((name) => name.includes('T-Rudder'))!;
    expect(pedals).toBeDefined();
    // As if the game had dropped the pedals' value since: the snapshot holds it under a name
    // the registry does not have. And the game saved a map for a controller it met since.
    const file = path.join(
      a.ports.folders.dataRoot(),
      'snapshots',
      'nuclear-option',
      `${taken.id}.json`
    );
    const kept = await a.ports.files.readText(file);
    if (!kept.ok) throw new Error(kept.error.message);
    const edited = await a.ports.files.write(
      file,
      kept.value
        .split(JSON.stringify(pedals).slice(1, -1))
        .join(JSON.stringify(pedals.replace('duplicate=0', 'duplicate=7')).slice(1, -1)),
      { reason: 'test' }
    );
    if (!edited.ok) throw new Error(edited.error.message);
    const stick = Object.keys(all).find(
      (name) => name.includes('JoystickMap|categoryId=0') && name.includes('Joystick-HOTASWarthog')
    )!;
    const newName = stick.replace('Joystick-HOTASWarthog', 'NewPanel').replace(/0402/g, '0999');
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: REGISTRY_KEY,
        name: newName,
        value: {
          type: 'binary',
          value: Buffer.from(
            Buffer.from((all[stick] as { value: string }).value, 'hex')
              .toString('utf8')
              .replace('Joystick - HOTAS Warthog', 'New Panel'),
            'utf8'
          ).toString('hex'),
        },
      },
    ]);
    const before = await values(a);
    const shown = await review(a, taken.id);
    expect(shown).toMatchObject({
      same: true,
      gone: ['T-Rudder'],
      newer: ['New Panel', 'T-Rudder'],
    });
    // It does not say the snapshot is back when part of it was not put back.
    expect(await restore(a, taken.id)).toEqual({
      changed: false,
      message:
        'Nothing was changed: what the game still has is as it was in “With the pedals”. Not put back: T-Rudder, which the game no longer has saved bindings for.',
    });
    expect(await values(a)).toEqual(before);
  });

  describe('a snapshot file that was changed or cut short', () => {
    /** The snapshot's file, read, changed and written back as someone or something might. */
    const tamper = async (
      a: WiredApp,
      id: string,
      change: (file: { name: string; maps: { valueName: string; hex: string }[] }) => unknown
    ): Promise<void> => {
      const file = path.join(
        a.ports.folders.dataRoot(),
        'snapshots',
        'nuclear-option',
        `${id}.json`
      );
      const text = await a.ports.files.readText(file);
      if (!text.ok) throw new Error(text.error.message);
      const changed = change(JSON.parse(text.value));
      const written = await a.ports.files.write(
        file,
        typeof changed === 'string' ? changed : JSON.stringify(changed),
        { reason: 'test' }
      );
      if (!written.ok) throw new Error(written.error.message);
    };
    const mapOf = (file: { maps: { valueName: string; hex: string }[] }, part: string) =>
      file.maps.find((m) => m.valueName.includes(part))!;

    it('is never written from: half a byte, bytes that are no map, another device’s map, a value named twice, or no snapshot at all', async () => {
      const a = await start();
      const cases: [string, (file: Parameters<Parameters<typeof tamper>[2]>[0]) => unknown][] = [
        ['half a byte', (f) => ((mapOf(f, 'Throttle').hex += 'a'), f)],
        ['an empty value', (f) => ((mapOf(f, 'Throttle').hex = ''), f)],
        ['bytes that are no map', (f) => ((mapOf(f, 'Throttle').hex = '6e6f'), f)],
        // The keyboard's bytes under a controller's value: the kinds do not agree.
        [
          'the keyboard’s map in a controller’s value',
          (f) => ((mapOf(f, 'JoystickMap|categoryId=0').hex = mapOf(f, 'KeyboardMap').hex), f),
        ],
        ['a value named twice', (f) => (f.maps.push({ ...f.maps[0]! }), f)],
        [
          'a value that is not a saved map',
          (f) => ((f.maps[0]!.valueName = 'UnitySelectMonitor_h1'), f),
        ],
        ['not JSON', () => '{ "format": 1,'],
        ['another kind of file', () => ({ hello: 'world' })],
      ];
      for (const [what, change] of cases) {
        const taken = await take(a, `Case ${what}`);
        await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
        const before = await values(a);
        await tamper(a, taken.id, change);
        await expect(review(a, taken.id), what).rejects.toThrow('That snapshot’s file is damaged');
        await expect(restore(a, taken.id), what).rejects.toThrow('That snapshot’s file is damaged');
        expect(await values(a), what).toEqual(before);
        // It is listed as damaged, cannot be renamed, and can be deleted.
        const listedNow = (await list(a)).find((s) => s.id === taken.id)!;
        expect(listedNow, what).toMatchObject({ damaged: true, bindings: 0 });
        await expect(
          a.invoke('nuclear-option-bindings:snapshotRename', { id: taken.id, name: 'x' }),
          what
        ).rejects.toThrow('damaged');
        expect(
          await a.invoke('nuclear-option-bindings:snapshotDelete', { id: taken.id }),
          what
        ).toEqual({ deleted: true });
        // Back to the scenario's bindings for the next case.
        const journal = await a.ports.files.journalGroups();
        if (!journal.ok) throw new Error(journal.error.message);
        await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      }
    });

    it('one controller’s map is not written into another controller’s value', async () => {
      const a = await start();
      const taken = await take(a, 'Swapped');
      await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
      const before = await values(a);
      // The stick's bytes under the throttle's value: both are controller maps.
      await tamper(a, taken.id, (f) => {
        const throttle = f.maps.find((m) =>
          /JoystickMap\|categoryId=0\|.*Throttle/.test(m.valueName)
        )!;
        const stick = f.maps.find((m) =>
          /JoystickMap\|categoryId=0\|.*Joystick/.test(m.valueName)
        )!;
        throttle.hex = stick.hex;
        return f;
      });
      await expect(review(a, taken.id)).rejects.toThrow('That snapshot’s file is damaged');
      await expect(restore(a, taken.id)).rejects.toThrow('That snapshot’s file is damaged');
      expect(await values(a)).toEqual(before);
    });

    it('a review is of the file as it was: one changed since is refused at Restore', async () => {
      const a = await start();
      const taken = await take(a, 'Reviewed');
      await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
      const shown = await review(a, taken.id);
      const before = await values(a);
      // Still a good snapshot, but not the one that was shown: the stick's map taken out.
      await tamper(a, taken.id, (f) => {
        f.maps = f.maps.filter((m) => !/JoystickMap\|categoryId=0\|.*Joystick/.test(m.valueName));
        return f;
      });
      await expect(restore(a, taken.id, shown.seen)).rejects.toThrow(
        'changed after the change was shown'
      );
      expect(await values(a)).toEqual(before);
    });
  });

  it('a failure after the first value was put back says that part is back, and Undo takes it out', async () => {
    const a = await start();
    const taken = await take(a, 'Two devices');
    const original = await values(a);
    await a.invoke('nuclear-option-bindings:clearDevice', { device: THROTTLE });
    await a.invoke('nuclear-option-bindings:clearDevice', { device: STICK });
    const cleared = await values(a);
    const files = a.ports.files;
    const write = files.write.bind(files);
    let writes = 0;
    files.write = (async (...args: Parameters<typeof write>) =>
      ++writes === 2
        ? { ok: false, error: { code: 'file.write', message: 'The value could not be written.' } }
        : write(...args)) as typeof write;
    await expect(restore(a, taken.id)).rejects.toThrow(
      /The value could not be written\. Part of the snapshot was already put back; Undo on the Safety page takes it out again\./
    );
    files.write = write;
    // One of the two is back, the other is still cleared.
    const after = await values(a);
    expect(after).not.toEqual(cleared);
    expect(after).not.toEqual(original);
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    const group = journal.value.find((g) => g.reason.includes('snapshot “Two devices” restored'))!;
    expect(group.entries).toHaveLength(1);
    await a.invoke('safety:undo', { groupId: group.id, force: false });
    expect(await values(a)).toEqual(cleared);
  });

  it('keeps only the maps the game uses, and leaves a map an earlier build left behind out of a restore', async () => {
    const a = await start();
    const all = await values(a);
    // The scenario's stick has two saved maps: the one the game uses, and an older one beside it.
    const sticks = Object.keys(all).filter((name) =>
      /JoystickMap\|categoryId=0\|.*Joystick-HOTASWarthog/.test(name)
    );
    expect(sticks).toHaveLength(2);
    const taken = await take(a, 'In use');
    const file = path.join(
      a.ports.folders.dataRoot(),
      'snapshots',
      'nuclear-option',
      `${taken.id}.json`
    );
    const text = await a.ports.files.readText(file);
    if (!text.ok) throw new Error(text.error.message);
    const kept = (JSON.parse(text.value) as { maps: { valueName: string }[] }).maps.map(
      (m) => m.valueName
    );
    expect(kept.filter((name) => sticks.includes(name))).toHaveLength(1);
    // Clearing the stick changes the map in use; the restore writes that one value only.
    await a.invoke('nuclear-option-bindings:clearDevice', { device: STICK });
    const shown = await review(a, taken.id);
    expect(shown.preview.files).toHaveLength(1);
    expect(shown.gone).toEqual([]);
    await restore(a, taken.id, shown.seen);
    expect(await values(a)).toEqual(all);
  });

  it('renames and deletes a snapshot, and refuses an id that is not one of its own', async () => {
    const a = await start();
    const taken = await take(a, 'First');
    const renamed = await a.invoke<Snapshot>('nuclear-option-bindings:snapshotRename', {
      id: taken.id,
      name: 'Second',
    });
    expect(renamed).toEqual({ ...taken, name: 'Second' });
    expect((await list(a)).map((s) => s.name)).toEqual(['Second']);
    for (const id of ['../settings', 'nope', 'C:/Windows/win']) {
      await expect(review(a, id)).rejects.toThrow('There is no such snapshot.');
      await expect(a.invoke('nuclear-option-bindings:snapshotDelete', { id })).rejects.toThrow(
        'There is no such snapshot.'
      );
    }
    expect(await a.invoke('nuclear-option-bindings:snapshotDelete', { id: taken.id })).toEqual({
      deleted: true,
    });
    expect(await list(a)).toEqual([]);
  });
});
