/**
 * WOW-WIN-003: a desktop shortcut per setup. Through IPC on every feature wired onto the
 * fake machine: the file is a real file in the fake user folder's Desktop, written and
 * removed through FileStore, and read back before anything is called done.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCommandLine } from '../../../core/commandLine';
import type { JournalGroup } from '../../../core/ports';
import type { Profile } from '../../../core/profile/schema';
import type { ChangePreview } from '../../../shared/changePreview';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { sabotage } from '../../../../tests/sabotage';
import type { ShortcutStatus } from '../contract';
import { shortcutFileName } from './shortcut';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const ID = 'dcs-f-a-18c';
const NAME = 'DCS F-A-18C - RigReady.lnk';

async function start(scenario = 'flying-all-good'): Promise<WiredApp> {
  app = await wiredApp(scenario, { files: [] });
  return app;
}
const desktop = (a: WiredApp): string => path.join(a.home, 'Desktop');
const exists = (file: string): Promise<boolean> =>
  fs.access(file).then(
    () => true,
    () => false
  );
const status = (a: WiredApp, id = ID): Promise<ShortcutStatus> =>
  a.invoke<ShortcutStatus>('profiles:shortcut', { id });
async function groups(a: WiredApp): Promise<JournalGroup[]> {
  const listed = await a.ports.files.journalGroups();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value;
}
async function rename(a: WiredApp, name: string): Promise<void> {
  const profile = await a.invoke<Profile>('profiles:get', { id: ID });
  await a.invoke('profiles:save', { ...profile, name });
}

describe('WOW-WIN-003 the name of a setup’s shortcut', () => {
  it('is the setup name with what a file name cannot hold replaced', () => {
    expect(shortcutFileName('DCS F/A-18C')).toBe('DCS F-A-18C - RigReady.lnk');
    expect(shortcutFileName('iRacing GT3')).toBe('iRacing GT3 - RigReady.lnk');
    expect(shortcutFileName('a\\b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i - RigReady.lnk');
    expect(shortcutFileName('  Evening   flight.  ')).toBe('Evening flight - RigReady.lnk');
    expect(shortcutFileName('tab\tand\nnewline')).toBe('tab-and-newline - RigReady.lnk');
    // Names Windows keeps for devices, and a name with nothing usable in it.
    expect(shortcutFileName('CON')).toBe('Setup CON - RigReady.lnk');
    expect(shortcutFileName('...')).toBe('Setup - RigReady.lnk');
    expect(shortcutFileName('x'.repeat(200))).toBe(`${'x'.repeat(80)} - RigReady.lnk`);
  });
});

describe('WOW-WIN-003 a desktop shortcut for a setup', () => {
  it('is shown first, written through FileStore, and read back before it is called made', async () => {
    const a = await start();
    const file = path.join(desktop(a), NAME);
    expect(await status(a)).toEqual({
      file,
      name: NAME,
      state: 'none',
      detail: 'Not on the desktop yet.',
      launches: true,
    });

    // The preview says what will be written, and writes nothing.
    const preview = await a.invoke<ChangePreview>('profiles:shortcutPreview', {
      id: ID,
      action: 'create',
    });
    expect(preview.summary).toBe('1 file created');
    expect(preview.files).toMatchObject([{ path: file, label: NAME, change: 'created' }]);
    expect(await exists(file)).toBe(false);
    expect(await groups(a)).toEqual([]);

    const made = await a.invoke<ShortcutStatus>('profiles:createShortcut', { id: ID });
    expect(made).toEqual({
      file,
      name: NAME,
      state: 'current',
      detail: 'Double-click it to make the rig ready for DCS F/A-18C and launch it.',
      launches: true,
    });
    expect(await exists(file)).toBe(true);

    // It starts RigReady itself and asks it to fly this setup, by id.
    const self = a.ports.shortcuts.self();
    const link = await a.ports.shortcuts.read(file);
    expect(link).toEqual({
      ok: true,
      value: {
        target: self.exe,
        args: ['--fly=dcs-f-a-18c'],
        description: 'Make the rig ready for DCS F/A-18C and launch it',
        icon: self.exe,
        cwd: path.win32.dirname(self.exe),
      },
    });
    expect(parseCommandLine([self.exe, ...(link.ok ? link.value!.args : [])])).toEqual({
      kind: 'command',
      command: { action: 'fly', setup: ID },
    });

    // One action in the journal, in words, exactly the file the preview named.
    const journal = await groups(a);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      reason: 'Create a desktop shortcut for "DCS F/A-18C"',
      undone: false,
    });
    expect(journal[0]!.entries.map((e) => [e.path, e.action, e.backupPath])).toEqual([
      [file, 'write', null],
    ]);

    // Asked again, nothing changes: the preview says so.
    const again = await a.invoke<ChangePreview>('profiles:shortcutPreview', {
      id: ID,
      action: 'create',
    });
    expect(again.files).toMatchObject([{ change: 'unchanged' }]);
  });

  it('is removed through FileStore, shown first, and can be put back from the journal', async () => {
    const a = await start();
    const file = path.join(desktop(a), NAME);
    await a.invoke('profiles:createShortcut', { id: ID });

    const preview = await a.invoke<ChangePreview>('profiles:shortcutPreview', {
      id: ID,
      action: 'remove',
    });
    expect(preview.summary).toBe('1 file deleted');
    expect(preview.files).toMatchObject([{ path: file, change: 'deleted' }]);
    expect(await exists(file)).toBe(true);

    const removed = await a.invoke<ShortcutStatus>('profiles:removeShortcut', { id: ID });
    expect(removed).toMatchObject({ state: 'none' });
    expect(await exists(file)).toBe(false);
    const journal = await groups(a);
    expect(journal[0]).toMatchObject({ reason: 'Remove the desktop shortcut of "DCS F/A-18C"' });
    expect(journal[0]!.entries.map((e) => e.action)).toEqual(['remove']);

    // Undo on the Safety page brings it back as it was.
    const undone = await a.ports.files.undoGroup(journal[0]!.id);
    expect(undone.ok).toBe(true);
    expect(await status(a)).toMatchObject({ state: 'current' });

    // With nothing to remove it says so and writes nothing.
    await a.invoke('profiles:removeShortcut', { id: ID });
    const before = (await groups(a)).length;
    expect(await a.wiring.handlers.get('profiles:removeShortcut')!({ id: ID })).toMatchObject({
      ok: false,
      error: { code: 'shortcut.none' },
    });
    expect((await groups(a)).length).toBe(before);
  });

  it('never says it is made when the file is not there afterwards', async () => {
    const a = await start();
    const file = path.join(desktop(a), NAME);
    // The machine accepts every change and carries out none (tests/sabotage.ts).
    const broken = sabotage(a.ports);
    const made = await a.wiring.handlers.get('profiles:createShortcut')!({ id: ID });
    broken.restore();
    expect(broken.attempts).toEqual([`files.write ${file}`]);
    expect(made).toMatchObject({
      ok: false,
      error: { code: 'shortcut.notWritten', message: 'The shortcut is not on the desktop.' },
    });
    expect(await status(a)).toMatchObject({ state: 'none' });

    // The same for a removal that does not happen.
    await a.invoke('profiles:createShortcut', { id: ID });
    const again = sabotage(a.ports);
    const removed = await a.wiring.handlers.get('profiles:removeShortcut')!({ id: ID });
    again.restore();
    expect(removed).toMatchObject({ ok: false, error: { code: 'shortcut.notRemoved' } });
    expect(await status(a)).toMatchObject({ state: 'current' });
  });

  it('never says it is made when what was written starts something else', async () => {
    const a = await start();
    // Windows hands back a link to another program than the one that was asked for.
    const build = a.ports.shortcuts.build.bind(a.ports.shortcuts);
    a.ports.shortcuts.build = (link) => build({ ...link, target: 'C:\\Windows\\notepad.exe' });
    expect(await a.wiring.handlers.get('profiles:createShortcut')!({ id: ID })).toMatchObject({
      ok: false,
      error: {
        code: 'shortcut.wrong',
        message: 'The shortcut was written, but it does not start this setup.',
      },
    });
    // And a link Windows cannot make is an error before anything is written.
    a.ports.shortcuts.build = async () => ({
      ok: false,
      error: { code: 'shortcut.build', message: 'Windows could not make the shortcut.' },
    });
    for (const channel of ['profiles:createShortcut', 'profiles:shortcutPreview']) {
      expect(await a.wiring.handlers.get(channel)!({ id: ID, action: 'create' })).toMatchObject({
        ok: false,
        error: { code: 'shortcut.build' },
      });
    }
  });

  it('follows a renamed setup: the old shortcut is found, and updating replaces it', async () => {
    const a = await start();
    await a.invoke('profiles:createShortcut', { id: ID });
    const old = path.join(desktop(a), NAME);
    await rename(a, 'Hornet: evening');
    const next = path.join(desktop(a), 'Hornet- evening - RigReady.lnk');
    expect(await status(a)).toEqual({
      file: next,
      name: 'Hornet- evening - RigReady.lnk',
      state: 'outdated',
      detail:
        'Another shortcut for this setup is on the desktop under its earlier name: DCS F-A-18C - RigReady.lnk.',
      launches: true,
    });
    // The old one still works: it names the setup by its id, which a rename keeps.
    const link = await a.ports.shortcuts.read(old);
    expect(link.ok && link.value?.args).toEqual(['--fly=dcs-f-a-18c']);

    const preview = await a.invoke<ChangePreview>('profiles:shortcutPreview', {
      id: ID,
      action: 'create',
    });
    expect(preview.files.map((f) => [f.label, f.change])).toEqual([
      ['Hornet- evening - RigReady.lnk', 'created'],
      [NAME, 'deleted'],
    ]);
    const made = await a.invoke<ShortcutStatus>('profiles:createShortcut', { id: ID });
    expect(made).toMatchObject({ state: 'current', file: next });
    expect(await exists(old)).toBe(false);
    expect(await exists(next)).toBe(true);
    // One action: undoing it puts the old name back and takes the new one away.
    const journal = await groups(a);
    expect(journal[0]!.entries.map((e) => [path.basename(e.path), e.action]).sort()).toEqual([
      [NAME, 'remove'],
      ['Hornet- evening - RigReady.lnk', 'write'],
    ]);
    // Removing takes whatever is there for this setup.
    await fs.copyFile(next, old);
    expect(await status(a)).toMatchObject({ state: 'outdated' });
    expect(await a.invoke('profiles:removeShortcut', { id: ID })).toMatchObject({ state: 'none' });
    expect(await exists(old)).toBe(false);
    expect(await exists(next)).toBe(false);
  });

  it('leaves a file that merely has the name alone until the user replaces it, with a copy kept', async () => {
    const a = await start();
    const file = path.join(desktop(a), NAME);
    await fs.mkdir(desktop(a), { recursive: true });
    await fs.writeFile(file, 'somebody else put this here');
    expect(await status(a)).toMatchObject({
      state: 'taken',
      detail: `${NAME} is on the desktop already, and it is not a shortcut to this setup.`,
    });
    // It is not ours to remove.
    expect(await a.wiring.handlers.get('profiles:removeShortcut')!({ id: ID })).toMatchObject({
      ok: false,
      error: { code: 'shortcut.none' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('somebody else put this here');

    const preview = await a.invoke<ChangePreview>('profiles:shortcutPreview', {
      id: ID,
      action: 'create',
    });
    expect(preview.files).toMatchObject([{ change: 'modified' }]);
    expect(await a.invoke('profiles:createShortcut', { id: ID })).toMatchObject({
      state: 'current',
    });
    // What was there is kept and comes back with Undo.
    const journal = await groups(a);
    const entry = journal[0]!.entries[0]!;
    expect(entry.backupPath).not.toBeNull();
    expect(await fs.readFile(entry.backupPath!, 'utf8')).toBe('somebody else put this here');
  });

  it('says so when the shortcut starts another copy of RigReady or asks for the wrong thing', async () => {
    const a = await start();
    const file = path.join(desktop(a), NAME);
    const write = async (target: string, args: string[]): Promise<void> => {
      const bytes = await a.ports.shortcuts.build({ target, args });
      if (!bytes.ok) throw new Error(bytes.error.message);
      await fs.mkdir(desktop(a), { recursive: true });
      await fs.writeFile(file, bytes.value);
    };
    // RigReady was moved since: the shortcut still starts the old place.
    await write('D:\\Old\\RigReady.exe', ['--fly=dcs-f-a-18c']);
    expect(await status(a)).toMatchObject({
      state: 'outdated',
      detail: 'It starts another copy of RigReady: D:\\Old\\RigReady.exe',
    });
    // Made when the setup launched nothing yet.
    await write(a.ports.shortcuts.self().exe, ['--make-ready=dcs-f-a-18c']);
    expect(await status(a)).toMatchObject({
      state: 'outdated',
      detail: 'It was made before this setup had something to launch.',
    });
    // A shortcut with this name for another setup is not this setup's.
    await write(a.ports.shortcuts.self().exe, ['--fly=another-setup']);
    expect(await status(a)).toMatchObject({ state: 'taken' });
    // Updating puts it right.
    expect(await a.invoke('profiles:createShortcut', { id: ID })).toMatchObject({
      state: 'current',
    });
  });

  it('a setup that launches nothing gets a shortcut that only makes the rig ready', async () => {
    const a = await start();
    const profile = await a.invoke<Profile>('profiles:get', { id: ID });
    const { launch: _launch, ...rest } = profile;
    await a.invoke('profiles:save', rest);
    const made = await a.invoke<ShortcutStatus>('profiles:createShortcut', { id: ID });
    expect(made).toMatchObject({
      state: 'current',
      launches: false,
      detail: 'Double-click it to make the rig ready for DCS F/A-18C.',
    });
    expect(a.ports.shortcuts.built.at(-1)).toMatchObject({
      args: ['--make-ready=dcs-f-a-18c'],
      description: 'Make the rig ready for DCS F/A-18C',
    });
    // Given something to launch again, the shortcut is out of date and says why.
    await a.invoke('profiles:save', profile);
    expect(await status(a)).toMatchObject({
      state: 'outdated',
      detail: 'It was made before this setup had something to launch.',
    });
    // Updated, it launches; and when the setup stops launching, that shortcut is out of date.
    await a.invoke('profiles:createShortcut', { id: ID });
    expect(a.ports.shortcuts.built.at(-1)).toMatchObject({ args: ['--fly=dcs-f-a-18c'] });
    await a.invoke('profiles:save', rest);
    expect(await status(a)).toMatchObject({
      state: 'outdated',
      detail: 'It was made when this setup still launched something.',
    });
  });

  it('refuses a setup that does not exist, and an id that is not one', async () => {
    const a = await start();
    for (const channel of [
      'profiles:shortcut',
      'profiles:createShortcut',
      'profiles:removeShortcut',
    ]) {
      expect(await a.wiring.handlers.get(channel)!({ id: 'no-such-setup' })).toMatchObject({
        ok: false,
        error: { code: 'profile.missing' },
      });
      expect(await a.wiring.handlers.get(channel)!({ id: '..\\..\\x' })).toMatchObject({
        ok: false,
        error: { code: 'profile.id' },
      });
    }
    expect(await exists(desktop(a))).toBe(false);
    expect(await groups(a)).toEqual([]);
  });

  it('other shortcuts and files on the desktop are not touched or mistaken for ours', async () => {
    const a = await start('fly-two-setups');
    await fs.mkdir(desktop(a), { recursive: true });
    await fs.writeFile(path.join(desktop(a), 'Notes - RigReady.lnk'), 'not a shortcut at all');
    await fs.writeFile(
      path.join(desktop(a), 'DCS World.lnk'),
      'a real shortcut of another program'
    );
    // Damaged shortcuts, and a folder with a shortcut's name: read as "not a shortcut".
    const good = await a.ports.shortcuts.build({
      target: 'C:\\x.exe',
      args: ['--fly=dcs-f-a-18c'],
    });
    if (!good.ok) throw new Error(good.error.message);
    const text = new TextDecoder().decode(good.value);
    const cut = path.join(desktop(a), 'Cut - RigReady.lnk');
    await fs.writeFile(cut, text.slice(0, text.length - 12));
    const headless = path.join(desktop(a), 'Headless - RigReady.lnk');
    await fs.writeFile(headless, `${text.split('\n')[0]}\n{"args":7}\n`);
    const folder = path.join(desktop(a), 'Folder - RigReady.lnk');
    await fs.mkdir(folder);
    for (const file of [cut, headless, folder, path.join(desktop(a), 'Notes - RigReady.lnk')]) {
      expect(await a.ports.shortcuts.read(file)).toMatchObject({
        ok: false,
        error: { code: 'shortcut.read' },
      });
    }
    expect(await a.ports.shortcuts.read(path.join(desktop(a), 'gone.lnk'))).toEqual({
      ok: true,
      value: undefined,
    });
    await a.invoke('profiles:createShortcut', { id: 'fly-dcs-uh-1h' });
    expect(await status(a)).toMatchObject({ state: 'none' });
    await a.invoke('profiles:createShortcut', { id: ID });
    expect(await status(a)).toMatchObject({ state: 'current' });
    expect(await status(a, 'fly-dcs-uh-1h')).toMatchObject({
      state: 'current',
      name: 'DCS UH-1H - RigReady.lnk',
    });
    await a.invoke('profiles:removeShortcut', { id: ID });
    expect((await fs.readdir(desktop(a))).sort()).toEqual([
      'Cut - RigReady.lnk',
      'DCS UH-1H - RigReady.lnk',
      'DCS World.lnk',
      'Folder - RigReady.lnk',
      'Headless - RigReady.lnk',
      'Notes - RigReady.lnk',
    ]);
  });
});
