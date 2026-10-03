import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeReady, runChecks } from '../../../core/checks/engine';
import type { CheckContext } from '../../../core/checks/registry';
import type { Profile } from '../../../core/profile/schema';
import { err, ok } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { lastLines, shortDate, variableLabel } from './paths';

/**
 * The generic check and fix types, run through the registry exactly as Fly does: every
 * feature wired on the recorded rig, real files in the fake user folder.
 */

let app: WiredApp;
afterEach(() => app?.cleanup());

const DCS_FILES = {
  files: ['Saved Games/DCS/**', 'Program Files (x86)/Steam/**', 'Documents/iRacing/**'],
};

function profileOf(checks: Profile['checks']): Profile {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    createdAt: '',
    updatedAt: '',
    checks,
    extensions: {},
  };
}

async function run(item: Omit<Profile['checks'][number], 'id'>) {
  const ctx: CheckContext = app.ctx;
  const report = await runChecks(profileOf([{ id: 'x', ...item }]), app.wiring.context.checks, ctx);
  return report.results[0]!;
}

describe('service.running', () => {
  it('reports running, stopped, start pending and not installed', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const check = {
      type: 'service.running',
      title: 'HidHide',
      required: true,
      params: { name: 'hidhide' },
    };
    expect(await run(check)).toMatchObject({ status: 'pass', summary: 'Running' });
    await mutate(app, [{ op: 'setService', name: 'HidHide', state: 'stopped' }]);
    expect(await run(check)).toMatchObject({ status: 'fail', summary: 'Stopped' });
    await mutate(app, [{ op: 'setService', name: 'HidHide', state: 'starting' }]);
    expect(await run(check)).toMatchObject({ status: 'fail', summary: 'Start pending' });
    await mutate(app, [{ op: 'setService', name: 'HidHide', state: 'absent' }]);
    expect(await run(check)).toMatchObject({ status: 'fail', summary: 'Not installed' });
    app.ports.services.get = async () => err('service.list', 'Could not read the services.');
    expect(await run(check)).toMatchObject({
      status: 'error',
      summary: 'Could not read the services.',
    });
  });

  it('is offered in the capture for the sim services that are running', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const capture = await app.invoke<{ candidates: { key: string; title: string }[] }>(
      'profiles:capture'
    );
    expect(
      capture.candidates.filter((c) => c.key.startsWith('service:')).map((c) => c.title)
    ).toEqual(['HidHide', 'ViGEm Bus']);
  });
});

describe('file.exists', () => {
  it('passes when the file is there, says Missing when not, and resolves path variables', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const check = {
      type: 'file.exists',
      title: 'options.lua',
      required: true,
      params: { path: '{DCS_USER}/Config/options.lua' },
    };
    expect(await run(check)).toMatchObject({ status: 'pass', summary: 'Present' });
    await mutate(app, [{ op: 'removeFile', path: 'Saved Games/DCS/Config/options.lua' }]);
    expect(await run(check)).toMatchObject({ status: 'fail', summary: 'Missing' });
    expect(await run({ ...check, params: { path: '{DCS_USER}/Config' } })).toMatchObject({
      status: 'fail',
      summary: 'This is a folder, a file was expected',
    });
  });

  it('checks a folder for files matching a pattern', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const folder = (pattern?: string) => ({
      type: 'file.exists',
      title: 'Hornet bindings',
      required: true,
      params: {
        path: '{DCS_USER}/Config/Input/FA-18C_hornet/joystick',
        kind: 'folder',
        ...(pattern ? { pattern } : {}),
      },
    });
    const found = await run(folder('*.diff.lua'));
    expect(found.status).toBe('pass');
    expect(found.summary).toMatch(/^\d+ matching files$/);
    expect(await run(folder('*.nothing'))).toMatchObject({
      status: 'fail',
      summary: 'No file matches *.nothing',
    });
    expect(await run(folder())).toMatchObject({ status: 'pass', summary: 'Present' });
    expect(
      await run({ ...folder(), params: { path: '{DCS_USER}/Config/options.lua', kind: 'folder' } })
    ).toMatchObject({ status: 'fail', summary: 'This is a file, a folder was expected' });
    // A pattern on a file is a set-up mistake.
    expect(
      await run({ ...folder(), params: { path: '{DCS_USER}/x.lua', pattern: '*.lua' } })
    ).toMatchObject({ status: 'error', summary: 'This check is not set up correctly.' });
  });

  it('is an error, not "Missing", when the game behind the variable is not on this PC', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    // DCS has never been run under this account: no Saved Games\DCS.
    await fs.rm(path.join(app.ports.folders.savedGames(), 'DCS'), { recursive: true, force: true });
    const result = await run({
      type: 'file.exists',
      title: 'options.lua',
      required: true,
      params: { path: '{DCS_USER}/Config/options.lua' },
    });
    expect(result).toMatchObject({ status: 'error', summary: 'DCS user folder not found' });
    expect(variableLabel('SOMETHING')).toBe('{SOMETHING}');
  });
});

describe('file.content', () => {
  const content = (params: Record<string, unknown>) => ({
    type: 'file.content',
    title: 'Content',
    required: true,
    params,
  });

  it('compares a Lua key and says what it is and what was expected', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const params = {
      path: '{DCS_USER}/Config/options.lua',
      rule: 'equals',
      keyPath: 'options.graphics.multiMonitorSetup',
      value: 'RigReady MFDs',
    };
    expect(await run(content(params))).toMatchObject({
      status: 'fail',
      summary: 'multiMonitorSetup is wwtMonitor, expected RigReady MFDs',
    });
    expect(await run(content({ ...params, value: 'wwtMonitor' }))).toMatchObject({
      status: 'pass',
      summary: 'multiMonitorSetup is wwtMonitor',
    });
    expect(await run(content({ ...params, keyPath: 'options.graphics.noSuchKey' }))).toMatchObject({
      status: 'fail',
      summary: 'noSuchKey is not set, expected RigReady MFDs',
    });
    expect(await run(content({ ...params, keyPath: 'options.graphics' }))).toMatchObject({
      status: 'fail',
    });
    expect(await run(content({ ...params, keyPath: undefined }))).toMatchObject({
      status: 'error',
    });
  });

  it('reads INI sections (with trailing comments) and JSON paths', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    expect(
      await run(
        content({
          path: '{DOCUMENTS}/iRacing/app.ini',
          rule: 'equals',
          keyPath: 'Audio.allowHardwareStreams',
          value: '1',
        })
      )
    ).toMatchObject({ status: 'pass', summary: 'allowHardwareStreams is 1' });
    const json = path.join(app.ports.folders.documents(), 'settings.json');
    await fs.writeFile(json, JSON.stringify({ wheel: { range: 900, presets: ['a'] } }));
    const jsonCheck = (keyPath: string, value: string) =>
      content({ path: '{DOCUMENTS}/settings.json', rule: 'equals', keyPath, value });
    expect(await run(jsonCheck('wheel.range', '900'))).toMatchObject({ status: 'pass' });
    expect(await run(jsonCheck('wheel.range', '1080'))).toMatchObject({
      summary: 'range is 900, expected 1080',
    });
    expect(await run(jsonCheck('wheel.presets.0', 'a'))).toMatchObject({ status: 'pass' });
    expect(await run(jsonCheck('wheel.nope.deeper', 'a'))).toMatchObject({ status: 'fail' });
    await fs.writeFile(json, '{ not json');
    expect(await run(jsonCheck('wheel.range', '900'))).toMatchObject({ status: 'error' });
    const txt = path.join(app.ports.folders.documents(), 'notes.txt');
    await fs.writeFile(txt, 'hello');
    expect(
      await run(
        content({ path: '{DOCUMENTS}/notes.txt', rule: 'equals', keyPath: 'a', value: 'b' })
      )
    ).toMatchObject({
      status: 'error',
      summary: expect.stringContaining('choose Lua, INI or JSON'),
    });
    expect(
      await run(
        content({
          path: '{DOCUMENTS}/notes.txt',
          rule: 'equals',
          keyPath: 'a',
          value: 'b',
          format: 'json',
        })
      )
    ).toMatchObject({ status: 'error' });
  });

  it('checks for text or a pattern, and reports a missing file or variable', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const file = '{DCS_USER}/Config/options.lua';
    expect(await run(content({ path: file, rule: 'contains', value: 'wwtMonitor' }))).toMatchObject(
      {
        status: 'pass',
      }
    );
    expect(
      await run(content({ path: file, rule: 'contains', value: 'nothing like this' }))
    ).toMatchObject({
      status: 'fail',
      summary: 'Does not contain "nothing like this"',
    });
    expect(
      await run(content({ path: file, rule: 'regex', value: 'multiMonitorSetup"\\]\\s*=' }))
    ).toMatchObject({
      status: 'pass',
    });
    expect(await run(content({ path: file, rule: 'regex', value: '^nope$' }))).toMatchObject({
      status: 'fail',
    });
    expect(await run(content({ path: file, rule: 'regex', value: '(' }))).toMatchObject({
      status: 'error',
    });
    expect(
      await run(content({ path: '{DCS_USER}/missing.lua', rule: 'contains', value: 'x' }))
    ).toMatchObject({
      status: 'fail',
      summary: 'Missing',
    });
    expect(
      await run(content({ path: '{NOPE}/x.lua', rule: 'contains', value: 'x' }))
    ).toMatchObject({
      status: 'error',
    });
  });
});

describe('script.check and script.run', () => {
  async function scriptRig(): Promise<string> {
    app = await wiredApp('flying-all-good', { files: [] });
    const script = path.join(app.home, 'Scripts', 'check.cmd');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '@echo off');
    return script;
  }

  it('passes on a success exit code and shows the output of a failure', async () => {
    const script = await scriptRig();
    app.ports.shell.scripts.push({
      match: { exe: 'check.cmd', args: ['--fail'] },
      result: {
        code: 3,
        stdout: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n'),
        stderr: 'bad',
      },
    });
    const check = (args: string[], codes?: number[]) => ({
      type: 'script.check',
      title: 'Script',
      required: true,
      params: {
        exe: '{USER}/Scripts/check.cmd',
        args,
        ...(codes ? { successExitCodes: codes } : {}),
      },
    });
    expect(await run(check(['--ok']))).toMatchObject({ status: 'pass', summary: 'Succeeded' });
    expect(app.ports.shell.calls.at(-1)).toEqual({ exe: script, args: ['--ok'] });
    const failed = await run(check(['--fail']));
    expect(failed).toMatchObject({ status: 'fail', summary: 'Exit code 3' });
    // The last 50 lines, so the panel stays readable.
    expect(failed.output!.split('\n')).toHaveLength(50);
    expect(failed.output).toContain('bad');
    expect(await run(check(['--fail'], [0, 3]))).toMatchObject({ status: 'pass' });
  });

  it('says a missing script is missing (error), and times out a hung one', async () => {
    await scriptRig();
    expect(
      await run({
        type: 'script.check',
        title: 'S',
        required: true,
        params: { exe: '{USER}/nope.cmd' },
      })
    ).toMatchObject({
      status: 'error',
      summary: expect.stringMatching(/^Script not found: .*nope\.cmd$/),
    });
    // The real Shell kills a program at its timeout; it comes back without an exit code.
    app.ports.shell.run = async () => ok({ code: null, stdout: '', stderr: '' });
    expect(
      await run({
        type: 'script.check',
        title: 'S',
        required: true,
        params: { exe: '{USER}/Scripts/check.cmd', timeoutSeconds: 10 },
      })
    ).toMatchObject({ status: 'error', summary: 'Timed out after 10 s' });
    app.ports.shell.run = async () => err('shell.spawn', 'Could not start it.', 'EPERM');
    expect(
      await run({
        type: 'script.check',
        title: 'S',
        required: true,
        params: { exe: '{USER}/Scripts/check.cmd' },
      })
    ).toMatchObject({ status: 'error', summary: 'Could not start it.', details: ['EPERM'] });
  });

  it('the fix shows the exact command to confirm, runs it, and reports exit codes and output', async () => {
    const script = await scriptRig();
    const fix = app.wiring.context.checks.remediation('script.run')!;
    const params = fix.params.parse({
      exe: '{USER}/Scripts/check.cmd',
      args: ['a b', '&& del *'],
    }) as Record<string, unknown>;
    expect(fix.confirm!(params)).toEqual({
      exe: '{USER}/Scripts/check.cmd',
      args: ['a b', '&& del *'],
    });
    expect(fix.confirm!({ ...params, requiresConfirmation: false })).toBeUndefined();
    expect(fix.describe(params)).toBe('Run check.cmd');
    expect(await fix.run(params, app.ctx)).toEqual(ok('Ran check.cmd'));
    // Every argument reaches the program as one literal element.
    expect(app.ports.shell.calls.at(-1)).toEqual({ exe: script, args: ['a b', '&& del *'] });
    app.ports.shell.scripts.push({
      match: { exe: 'check.cmd', args: ['boom'] },
      result: { code: 2, stdout: 'it broke', stderr: '' },
    });
    expect(await fix.run({ ...params, args: ['boom'] }, app.ctx)).toMatchObject({
      ok: false,
      error: { message: 'check.cmd exited with code 2', detail: 'it broke' },
    });
    // Without waiting it is started and left running.
    expect(await fix.run({ ...params, waitForCompletion: false }, app.ctx)).toEqual(
      ok('Started check.cmd')
    );
    expect(await fix.run({ ...params, exe: '{USER}/gone.cmd' }, app.ctx)).toMatchObject({
      ok: false,
      error: { code: 'script.missing' },
    });
    expect(
      await fix.run({ ...params, exe: '{USER}/gone.cmd', waitForCompletion: false }, app.ctx)
    ).toMatchObject({ ok: false, error: { code: 'script.missing' } });
    app.ports.shell.run = async () => ok({ code: null, stdout: '', stderr: '' });
    expect(await fix.run({ ...params, timeoutSeconds: 30 }, app.ctx)).toMatchObject({
      ok: false,
      error: { message: 'check.cmd timed out after 30 s' },
    });
  });

  it('a script that never answers is reported after its timeout, without waiting for it', async () => {
    await scriptRig();
    const { createScriptCheck } = await import('./script');
    const { GameRegistry } = await import('../../../core/games');
    let wake: (() => void) | undefined;
    const check = createScriptCheck(
      new GameRegistry(),
      () => new Promise((resolve) => (wake = resolve))
    );
    app.ports.shell.run = () => new Promise(() => {});
    const pending = check.run(check.params.parse({ exe: '{USER}/Scripts/check.cmd' }), app.ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
    wake?.();
    expect(await pending).toMatchObject({ error: true, summary: 'Timed out after 10 s' });
    expect(check.timeoutSeconds!(check.params.parse({ exe: 'x', timeoutSeconds: 20 }))).toBe(22);
  });

  it('helpers keep the last lines and format dates', () => {
    expect(lastLines('a\nb\nc\n', 2)).toBe('b\nc');
    expect(shortDate('2026-10-03T12:05:00.000Z')).toMatch(/^2026-10-0[34] \d\d:\d5$/);
  });
});

describe('instructions.show', () => {
  it('is never run by Make ready: the item is listed under Needs you with its text', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const profile = profileOf([
      {
        id: 'h',
        type: 'service.running',
        title: 'HidHide service',
        required: true,
        params: { name: 'NoSuchService' },
        remediation: {
          type: 'instructions.show',
          params: { text: 'Install **HidHide** from [GitHub](https://github.com).' },
        },
      },
    ]);
    const report = await runChecks(profile, app.wiring.context.checks, app.ctx);
    expect(report.results[0]).toMatchObject({
      status: 'fail',
      fix: 'Show instructions',
      fixKind: 'instructions',
      instructions: 'Install **HidHide** from [GitHub](https://github.com).',
    });
    // Nothing for Make ready to run.
    expect(report.fixable).toBe(0);
    const made = await makeReady(profile, app.wiring.context.checks, app.ctx);
    expect(made.steps).toEqual([]);
    expect(made.needsYou).toEqual([
      {
        itemId: 'h',
        title: 'HidHide service',
        summary: 'Not installed',
        instructions: 'Install **HidHide** from [GitHub](https://github.com).',
      },
    ]);
    const fix = app.wiring.context.checks.remediation('instructions.show')!;
    expect(await fix.run({ text: 'x' }, app.ctx)).toMatchObject({ ok: false });
  });
});

describe('file.restore', () => {
  const OPTIONS = '{DCS_USER}/Config/options.lua';
  const item = {
    id: 'o',
    type: 'file.exists',
    title: 'options.lua',
    required: true,
    params: { path: OPTIONS },
    remediation: { type: 'file.restore', params: { path: OPTIONS } },
  };

  it('offers no fix until there is a copy, then restores the newest copy and the check passes', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const checks = app.wiring.context.checks;
    const profile = profileOf([item]);
    const file = path.join(app.ports.folders.savedGames(), 'DCS', 'Config', 'options.lua');
    const original = await fs.readFile(file);

    await mutate(app, [{ op: 'removeFile', path: 'Saved Games/DCS/Config/options.lua' }]);
    const none = (await runChecks(profile, checks, app.ctx)).results[0]!;
    expect(none).toMatchObject({ status: 'fail', summary: 'Missing' });
    expect(none.fix).toBeUndefined();
    expect(none.details).toContain('No backup of this file yet');

    // Put it back by hand and keep a known-good copy from the setup editor.
    await fs.writeFile(file, original);
    expect(await app.invoke('profiles:prepareFix', item.remediation)).toEqual({
      message: expect.stringMatching(/^Kept a copy of options.lua \(\d{4}-\d\d-\d\d \d\d:\d\d\)$/),
    });
    await mutate(app, [{ op: 'removeFile', path: 'Saved Games/DCS/Config/options.lua' }]);
    const missing = (await runChecks(profile, checks, app.ctx)).results[0]!;
    expect(missing.fix).toMatch(
      /^Restore options.lua from the copy you saved of \d{4}-\d\d-\d\d \d\d:\d\d$/
    );

    const made = await makeReady(profile, checks, app.ctx);
    expect(made.steps[0]).toMatchObject({
      ok: true,
      message: expect.stringMatching(/^Restored options.lua from the copy you saved/),
    });
    expect(made.report.results[0]!.status).toBe('pass');
    expect(await fs.readFile(file)).toEqual(original);
    // Journaled like any other change, so it can be undone from Safety.
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value[0]).toMatchObject({
      path: file,
      reason: expect.stringMatching(/^Restore options.lua/),
    });
  });

  it('uses the automatic backup FileStore took before a change, and refuses what cannot be resolved', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const file = path.join(app.ports.folders.savedGames(), 'DCS', 'Config', 'options.lua');
    const original = await fs.readFile(file, 'utf8');
    // Some tool (through RigReady) breaks the file: the old content was backed up first.
    await app.ports.files.write(file, 'options = {}', { reason: 'Some change' });
    const fix = app.wiring.context.checks.remediation('file.restore')!;
    expect(await fix.available!({ path: OPTIONS }, app.ctx)).toMatchObject({
      ok: true,
      description: expect.stringContaining('from the automatic backup of'),
    });
    expect(await fix.run({ path: OPTIONS }, app.ctx)).toMatchObject({ ok: true });
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    expect(await fix.available!({ path: '{NOPE}/x' }, app.ctx)).toMatchObject({ ok: false });
    expect(await fix.run({ path: '{DCS_USER}/never.lua' }, app.ctx)).toMatchObject({
      ok: false,
      error: { code: 'restore.none' },
    });
    expect(await fix.prepare!.run({ path: '{DCS_USER}/never.lua' }, app.ctx)).toMatchObject({
      ok: false,
      error: { code: 'restore.missing' },
    });
    await expect(
      app.invoke('profiles:prepareFix', { type: 'file.restore', params: {} })
    ).rejects.toThrow(/fix.invalid/);
    await expect(
      app.invoke('profiles:prepareFix', { type: 'script.run', params: {} })
    ).rejects.toThrow(/fix.noPrepare/);
  });
});

describe('game.updated', () => {
  const item = (verifiedVersion?: string) => ({
    id: 'g',
    type: 'game.updated',
    title: 'DCS not updated since verified',
    required: true,
    params: { game: 'dcs', ...(verifiedVersion ? { verifiedVersion } : {}) },
  });

  it('warns after a Steam update, never makes the rig Not ready, and Mark verified clears it', async () => {
    app = await wiredApp('flying-all-good', DCS_FILES);
    const checks = app.wiring.context.checks;
    const fresh = await runChecks(profileOf([item()]), checks, app.ctx);
    expect(fresh.results[0]).toMatchObject({
      status: 'warn',
      required: false,
      summary: 'DCS World Steam build 25625823 has not been verified yet',
      acknowledge: 'Mark verified',
    });
    expect(fresh.ready).toBe(true);
    expect(
      (await runChecks(profileOf([item('Steam build 25625823')]), checks, app.ctx)).results[0]
    ).toMatchObject({
      status: 'pass',
      summary: 'DCS World Steam build 25625823, verified',
    });

    await mutate(app, [
      { op: 'setSteamBuild', appId: '223750', buildId: '25999999', stateFlags: 6 },
    ]);
    const updated = await runChecks(profileOf([item('Steam build 25625823')]), checks, app.ctx);
    expect(updated.results[0]).toMatchObject({
      status: 'warn',
      summary:
        'DCS World updated Steam build 25625823 -> Steam build 25999999 since you last verified',
    });
    expect(updated.results[0]!.details).toContain(
      'An update is waiting to be installed; the game may not start until it is.'
    );
    expect(updated.ready).toBe(true);

    const acknowledged = await checks
      .check('game.updated')!
      .acknowledge!.run({ game: 'dcs', verifiedVersion: 'Steam build 25625823' }, app.ctx);
    expect(acknowledged).toEqual(ok({ game: 'dcs', verifiedVersion: 'Steam build 25999999' }));
  });

  it('is an error for a game RigReady does not know or cannot find', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const checks = app.wiring.context.checks;
    const unknown = await runChecks(
      profileOf([{ ...item(), params: { game: 'nope' } }]),
      checks,
      app.ctx
    );
    expect(unknown.results[0]).toMatchObject({
      status: 'error',
      summary: expect.stringContaining('does not know'),
    });
    const missing = await runChecks(profileOf([item()]), checks, app.ctx);
    expect(missing.results[0]).toMatchObject({
      status: 'error',
      summary: 'DCS World was not found on this PC.',
    });
    expect(missing.ready).toBe(true);
    expect(
      await checks.check('game.updated')!.acknowledge!.run({ game: 'nope' }, app.ctx)
    ).toMatchObject({ ok: false });
  });

  it('is proposed in the capture for each detected game', async () => {
    app = await wiredApp('flying-fresh', DCS_FILES);
    const capture = await app.invoke<{ candidates: { key: string; check: { params: unknown } }[] }>(
      'profiles:capture'
    );
    expect(capture.candidates.find((c) => c.key === 'game:dcs')?.check.params).toEqual({
      game: 'dcs',
      verifiedVersion: 'Steam build 25625823',
    });
  });
});
