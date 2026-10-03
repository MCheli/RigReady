import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { expandPath, allPathVariables } from '../../../core/pathVariables';
import { migrateProfile, ProfileSchema, type Profile } from '../../../core/profile/schema';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { CheckTypeInfo, ProfileOverview, RemediationTypeInfo } from '../contract';
import { fieldsOf } from '../renderer/schemaForm';
import { isDuplicate, nextId, targetOf } from './duplicates';
import { waitForPress } from './identify';

let app: WiredApp;
afterEach(() => app?.cleanup());

const P = 'dcs-f-a-18c';
const sha = async (file: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');

describe('profile files', () => {
  it('lists a valid profile normally and broken ones as invalid, with file, line and message', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const profiles = app.wiring.context.profiles;
    await fs.writeFile(profiles.fileFor('syntax'), 'name: DCS\nchecks: [\n  - oops: : :\n');
    await fs.writeFile(
      profiles.fileFor('schema'),
      'id: schema\nname: ""\ncreatedAt: x\nupdatedAt: x\n'
    );
    await fs.writeFile(
      profiles.fileFor('renamed'),
      yaml.dump({ id: 'other', name: 'X', createdAt: 'x', updatedAt: 'x' })
    );
    await fs.writeFile(path.join(profiles.dir, 'notes.txt'), 'not a profile');
    const overview = await app.invoke<ProfileOverview>('profiles:overview');
    expect(overview.profiles.map((p) => p.profile.id)).toEqual([P]);
    expect(overview.invalid.map((i) => [i.id, i.message, i.line])).toEqual([
      ['renamed', 'The profile file renamed.yaml is not valid.', undefined],
      ['schema', 'The profile file schema.yaml is not valid.', undefined],
      ['syntax', 'The profile file syntax.yaml is not valid YAML.', 3],
    ]);
    expect(overview.invalid[1]!.detail).toContain('name');
    expect(overview.invalid[2]!.detail).toMatch(/^Line 3: /);
    expect(overview.invalid[0]!.detail).toContain('does not match the file name');
    // The Fly screen lists them too, but cannot open them.
    const state = await app.invoke<{ invalid: { id: string }[] }>('fly:state');
    expect(state.invalid.map((i) => i.id)).toEqual(['renamed', 'schema', 'syntax']);
  });

  it('a version 1 file loads through the migration, and a newer one is reported instead of guessed', async () => {
    const v1 = yaml.load(
      await fs.readFile(
        path.join(__dirname, '../../../../fixtures/scenarios/profiles/dcs-f-a-18c.yaml'),
        'utf8'
      )
    ) as Record<string, unknown>;
    const { schemaVersion: _v, ...unversioned } = v1;
    expect(ProfileSchema.parse(migrateProfile(unversioned)).schemaVersion).toBe(1);
    expect(ProfileSchema.safeParse(migrateProfile({ ...v1, schemaVersion: 2 })).success).toBe(
      false
    );
    expect(migrateProfile('text')).toBe('text');
  });

  it('never writes a profile that fails its schema or its check types', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const profile = await app.invoke<Profile>('profiles:get', { id: P });
    const file = app.wiring.context.profiles.fileFor(P);
    const before = await sha(file);
    await expect(app.invoke('profiles:save', { ...profile, name: '' })).rejects.toThrow(
      /ipc.input/
    );
    const badParams = {
      ...profile,
      checks: [{ ...profile.checks[12]!, params: { stopOnStandDown: 'yes' } }],
    };
    await expect(app.invoke('profiles:save', badParams)).rejects.toThrow(
      /profile.params .*c13 "TrackIR5": name: .*\n?.*c13 "TrackIR5": stopOnStandDown/s
    );
    const badFix = {
      ...profile,
      checks: [{ ...profile.checks[12]!, remediation: { type: 'process.launch', params: {} } }],
    };
    await expect(app.invoke('profiles:save', badFix)).rejects.toThrow(/c13 "TrackIR5" fix: exe/);
    const badAction = {
      ...profile,
      actions: {
        preLaunch: [{ id: 'a1', title: 'Go', type: 'script.run', params: {} }],
        postLaunch: [],
        standDown: [],
      },
    };
    await expect(app.invoke('profiles:save', badAction)).rejects.toThrow(/a1 "Go": exe/);
    expect(await sha(file)).toBe(before);
  });

  it('refuses unknown path variables by name, and keeps game variables of games not installed', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const profile = await app.invoke<Profile>('profiles:get', { id: P });
    await expect(
      app.invoke('profiles:save', {
        ...profile,
        launch: { exe: '{DCS_HOME}/bin/DCS.exe', args: [] },
      })
    ).rejects.toThrow(/Unknown path variable \{DCS_HOME\}/);
    const saved = await app.invoke<Profile>('profiles:save', {
      ...profile,
      launch: { exe: '{IRACING_USER}/x.exe', args: [] },
    });
    expect(saved.launch?.exe).toBe('{IRACING_USER}/x.exe');
  });

  it('path variables resolve under the user folder of this run, never the real one', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const variables = await allPathVariables(app.ctx, app.wiring.context.games);
    expect(variables['USER']).toBe(app.home);
    expect(expandPath('{USER}/Saved Games/DCS', variables)).toEqual({
      ok: true,
      value: path.join(app.home, 'Saved Games', 'DCS'),
    });
    // Browsing stores the path with its variable.
    app.ports.dialogs.script.open.push([
      path.join(app.home, 'Saved Games', 'DCS', 'Config', 'options.lua'),
    ]);
    expect(await app.invoke('profiles:browse', { kind: 'file' })).toEqual({
      path: '{DCS_USER}/Config/options.lua',
    });
    expect(await app.invoke('profiles:browse', { kind: 'folder', title: 'Pick' })).toEqual({});
    expect(app.ports.dialogs.calls.at(-1)?.options).toMatchObject({
      directory: true,
      title: 'Pick',
    });
  });
});

describe('editing', () => {
  it('renaming keeps the id; reading for the editor changes nothing on disk', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const file = app.wiring.context.profiles.fileFor(P);
    const before = await sha(file);
    const edit = await app.invoke<{ profile: Profile; hasComments: boolean }>('profiles:edit', {
      id: P,
    });
    await app.invoke('profiles:types');
    await app.invoke('profiles:pickers');
    await app.invoke('profiles:games');
    // Cancel: nothing was saved, the file is byte for byte the same.
    expect(await sha(file)).toBe(before);
    const saved = await app.invoke<Profile>('profiles:save', { ...edit.profile, name: 'Hornet' });
    expect(saved.id).toBe(P);
    expect(await fs.readFile(file, 'utf8')).toContain('name: Hornet');
    expect(await app.wiring.context.profiles.lastProfileId()).toBeUndefined();
    await app.invoke('profiles:use', { id: P });
    expect(await app.wiring.context.profiles.lastProfileId()).toBe(P);
  });

  it('says when a hand-edited file has comments a save would drop', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const file = app.wiring.context.profiles.fileFor(P);
    expect(
      (await app.invoke<{ hasComments: boolean }>('profiles:edit', { id: P })).hasComments
    ).toBe(false);
    await fs.writeFile(file, `# My Hornet\n${await fs.readFile(file, 'utf8')}`);
    expect(
      (await app.invoke<{ hasComments: boolean }>('profiles:edit', { id: P })).hasComments
    ).toBe(true);
  });

  it('clones deeply under a new id and opens nothing shared with the original', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const originalFile = app.wiring.context.profiles.fileFor(P);
    const before = await sha(originalFile);
    const clone = await app.invoke<Profile>('profiles:clone', { id: P });
    expect(clone).toMatchObject({ id: 'dcs-f-a-18c-copy', name: 'DCS F/A-18C (copy)' });
    clone.checks[12]!.params['name'] = 'Changed.exe';
    await app.invoke('profiles:save', clone);
    expect(await sha(originalFile)).toBe(before);
    const again = await app.invoke<Profile>('profiles:clone', { id: P });
    expect(again.id).toBe('dcs-f-a-18c-copy-2');
  });

  it('deletes into an undoable backup, and the Fly screen falls back', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await app.invoke('profiles:clone', { id: P });
    await app.invoke('profiles:use', { id: P });
    const file = app.wiring.context.profiles.fileFor(P);
    const content = await fs.readFile(file, 'utf8');
    expect(await app.invoke('profiles:remove', { id: P })).toEqual({ removed: true });
    await expect(fs.access(file)).rejects.toThrow();
    const journal = await app.ports.files.journal();
    if (!journal.ok) throw new Error('no journal');
    const entry = journal.value[0]!;
    expect(entry).toMatchObject({
      path: file,
      action: 'remove',
      reason: 'Delete setup "DCS F/A-18C"',
    });
    expect(entry.backupPath).toContain(path.join(app.ports.folders.dataRoot(), 'backups', 'auto'));
    expect(await fs.readFile(entry.backupPath!, 'utf8')).toBe(content);
    // Fly opens on what is left.
    const state = await app.invoke<{ activeProfileId: string }>('fly:state');
    expect(state.activeProfileId).toBe('dcs-f-a-18c-copy');
    // And Safety's Undo brings it back.
    await app.ports.files.undo(entry.id);
    expect(await fs.readFile(file, 'utf8')).toBe(content);
  });

  it('opens the YAML file with Windows and shows it in Explorer, through an argument array', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const file = app.wiring.context.profiles.fileFor(P);
    expect(await app.invoke('profiles:openFile', { id: P })).toEqual({ opened: true });
    expect(await app.invoke('profiles:showFile', { id: P })).toEqual({ opened: true });
    expect(app.ports.shell.calls.map((c) => [path.win32.basename(c.exe), c.args])).toEqual([
      ['explorer.exe', [file]],
      ['explorer.exe', [`/select,${file}`]],
    ]);
    await expect(app.invoke('profiles:openFile', { id: 'nope' })).rejects.toThrow(
      /profile.missing/
    );
    await expect(app.invoke('profiles:openFile', { id: '../x' })).rejects.toThrow(/profile.id/);
  });

  it('creating from the capture opens the Fly screen on the new setup; every part can be skipped', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const created = await app.invoke<Profile>('profiles:create', {
      name: 'Just a name',
      checks: [],
    });
    expect(created).toMatchObject({ id: 'just-a-name', checks: [] });
    expect(await app.wiring.context.profiles.lastProfileId()).toBe('just-a-name');
    const other = await app.invoke<Profile>('profiles:create', {
      name: 'My rally game',
      game: 'other',
      gameName: 'Richard Burns Rally',
      launch: { exe: 'C:\\Games\\RBR\\RichardBurnsRally.exe', args: [] },
      checks: [],
    });
    expect(other).toMatchObject({ game: 'other', gameName: 'Richard Burns Rally' });
    const state = await app.invoke<{
      profiles: { id: string; gameName?: string; canLaunch: boolean }[];
    }>('fly:state');
    expect(state.profiles.find((p) => p.id === 'my-rally-game')).toMatchObject({
      gameName: 'Richard Burns Rally',
      canLaunch: true,
    });
  });
});

describe('the generic editor form', () => {
  it('every field of every registered check and fix type has a control', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const types = await app.invoke<{
      checks: CheckTypeInfo[];
      remediations: RemediationTypeInfo[];
    }>('profiles:types');
    expect(types.checks.map((t) => t.type)).toEqual(app.wiring.context.checks.checkTypes());
    for (const type of [...types.checks, ...types.remediations]) {
      const properties = Object.keys((type.schema['properties'] ?? {}) as object);
      const fields = fieldsOf(type.schema);
      expect(
        fields.map((f) => f.key),
        type.type
      ).toEqual(properties);
      expect(fields.every((f) => f.kind !== undefined)).toBe(true);
    }
    expect(types.checks.find((t) => t.type === 'game.updated')).toMatchObject({
      advisory: true,
      acknowledge: 'Mark verified',
    });
    expect(types.remediations.find((t) => t.type === 'file.restore')).toMatchObject({
      prepare: 'Keep a copy of the file as it is now',
    });
    expect(types.remediations.find((t) => t.type === 'script.run')).toMatchObject({
      confirms: true,
    });
    const kinds = Object.fromEntries(
      fieldsOf(types.remediations.find((t) => t.type === 'script.run')!.schema).map((f) => [
        f.key,
        f.kind,
      ])
    );
    expect(kinds).toMatchObject({
      exe: 'text',
      args: 'list',
      successExitCodes: 'numberList',
      timeoutSeconds: 'number',
      waitForCompletion: 'boolean',
    });
    const layout = fieldsOf(types.checks.find((t) => t.type === 'display.layout')!.schema);
    expect(layout.some((f) => f.kind === 'json')).toBe(true);
  });

  it('every field a profile has is edited somewhere in the setup editor', async () => {
    // The leaves of the profile schema, walked from zod itself.
    const leaves: string[] = [];
    const walk = (schema: z.ZodType, at: string): void => {
      const def = (
        schema as unknown as {
          _zod: {
            def: {
              type: string;
              innerType?: z.ZodType;
              shape?: Record<string, z.ZodType>;
              element?: z.ZodType;
            };
          };
        }
      )._zod.def;
      if (def.innerType) return walk(def.innerType, at);
      if (def.type === 'object' && def.shape) {
        for (const [key, value] of Object.entries(def.shape))
          walk(value, at ? `${at}.${key}` : key);
        return;
      }
      if (def.type === 'array' && def.element) return walk(def.element, `${at}[]`);
      leaves.push(at);
    };
    walk(ProfileSchema, '');
    const editor = await fs.readFile(
      path.join(__dirname, '../renderer/ProfileEditPage.vue'),
      'utf8'
    );
    const item = await fs.readFile(path.join(__dirname, '../renderer/ItemEditor.vue'), 'utf8');
    const action = await fs.readFile(path.join(__dirname, '../renderer/ActionEditor.vue'), 'utf8');
    const sources = editor + item + action;
    // Each leaf, and the control that edits it.
    const CONTROLS: Record<string, string> = {
      schemaVersion: 'kept as it is (file format)',
      id: 'kept as it is (renaming keeps the id)',
      createdAt: 'kept as it is',
      updatedAt: 'set on save',
      extensions: 'kept as it is (owned by other features)',
      name: 'edit-name',
      description: 'edit-description',
      game: 'edit-game',
      gameName: 'edit-game-name',
      'checks[].id': 'kept as it is',
      'checks[].type': 'edit-add-check',
      'checks[].title': 'edit-check-title',
      'checks[].required': 'edit-required',
      'checks[].params': 'edit-params',
      'checks[].remediation.type': 'edit-fix-type',
      'checks[].remediation.params': 'edit-fix-params',
      'checks[].timeoutSeconds': 'edit-check-timeout',
      'launch.exe': 'edit-launch',
      'launch.args[]': 'edit-launch',
      'launch.cwd': 'edit-launch',
      steamAppId: 'edit-steam-app',
      'actions.preLaunch[].id': 'kept as it is',
      'actions.preLaunch[].title': 'edit-action-title',
      'actions.preLaunch[].type': 'edit-action-type',
      'actions.preLaunch[].params': 'edit-action-params',
      'actions.preLaunch[].continueOnError': 'edit-action-continue',
      'actions.preLaunch[].delaySeconds': 'edit-action-delay',
      'actions.preLaunch[].waitForCompletion': 'edit-action-wait',
      'actions.preLaunch[].hidden': 'edit-action-hidden',
      'actions.preLaunch[].timeoutSeconds': 'edit-action-timeout',
      'actions.preLaunch[].closeOnStandDown': 'edit-action-close',
    };
    const normalized = [
      ...new Set(
        leaves.map((l) => l.replace(/^actions\.(postLaunch|standDown)/, 'actions.preLaunch'))
      ),
    ];
    expect(normalized.sort()).toEqual(Object.keys(CONTROLS).sort());
    for (const control of Object.values(CONTROLS)) {
      if (control.startsWith('edit-')) expect(sources, control).toContain(`"${control}`);
    }
  });
});

describe('press a button on it', () => {
  const state = (index: number, buttons: boolean[]) => ({
    index,
    name: 'x',
    axes: [],
    buttons,
    hats: [],
    timestamp: 1,
  });

  it('names the device a button was pressed on; buttons already held do not count', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    // The startup panel has a switch that stays on.
    app.ports.input.emit([state(3, [false, true])]);
    const pending = app.invoke('profiles:waitForPress', { timeoutSeconds: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.ports.input.emit([state(3, [false, true])]);
    app.ports.input.emit([state(1, [false, false, true])]);
    expect(await pending).toEqual({
      device: { name: 'R-VPC Panel #1', vendorId: '3344', productId: 'C259' },
    });
  });

  it('says nothing was pressed when time runs out, and passes a reader failure on', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    expect(await waitForPress(app.ports, 20)).toEqual({ ok: true, value: {} });
    app.ports.input.start = async () => ({
      ok: false,
      error: { code: 'input.start', message: 'No reader.' },
    });
    expect(await waitForPress(app.ports, 20)).toMatchObject({ ok: false });
  });
});

describe('duplicates', () => {
  it('compares type and target, ignoring case', () => {
    const trackir = { type: 'process.running', params: { name: 'TrackIR5.exe' } };
    expect(
      isDuplicate(
        { type: 'process.running', params: { name: 'trackir5.EXE', stopOnStandDown: true } },
        [trackir]
      )
    ).toBe(true);
    expect(
      isDuplicate({ type: 'service.running', params: { name: 'TrackIR5.exe' } }, [trackir])
    ).toBe(false);
    expect(targetOf({ type: 'display.layout', params: { displays: [] } })).toBe(
      'display.layout|{"displays":[]}'
    );
    expect(nextId('c', ['c1', 'c2', 'c4'])).toBe('c3');
  });
});
