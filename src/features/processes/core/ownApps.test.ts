import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CaptureCandidate } from '../../../core/checks/registry';
import { GameRegistry } from '../../../core/games';
import { scenarioRig, wiredApp, type TestRig, type WiredApp } from '../../../../tests/helpers';
import type { OwnAppsView } from '../contract';
import { OwnApps } from './ownApps';
import {
  createLaunchRemediation,
  createProcessCapture,
  createProcessRunningCheck,
  LaunchParamsSchema,
  pathResolver,
  ProcessParamsSchema,
  refusedToRemember,
  SessionStarts,
} from './processCheck';

let rig: TestRig | undefined;
let app: WiredApp | undefined;
afterEach(async () => {
  for (const f of app?.wiring.features ?? []) await f.dispose?.();
  await app?.cleanup();
  await rig?.cleanup();
  app = undefined;
  rig = undefined;
});

/** A program RigReady does not know, as Windows reports it while it runs. */
const TOOL = { pid: 88001, name: 'SimTool.exe', path: 'D:\\Sims\\Tools\\SimTool.exe' };

const knownFile = (dataRoot: string): string => path.join(dataRoot, 'processes', 'known.json');

async function setup(): Promise<{
  rig: TestRig;
  own: OwnApps;
  capture: ReturnType<typeof createProcessCapture>;
}> {
  rig = await scenarioRig('flying-fresh', { files: [] });
  rig.ports.state.processes.push({ ...TOOL });
  const own = new OwnApps(rig.ports.files, rig.ports.folders.dataRoot());
  return { rig, own, capture: createProcessCapture(new GameRegistry(), own) };
}

async function candidates(
  capture: ReturnType<typeof createProcessCapture>,
  test: TestRig
): Promise<CaptureCandidate[]> {
  const result = await capture.capture(test.ctx);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const byKey = (list: CaptureCandidate[], key: string): CaptureCandidate | undefined =>
  list.find((c) => c.key === key);

describe('always offer this app', () => {
  it('a program RigReady does not know is kept as Windows reported it, and is then offered ticked, under its name, with the launch fix from the running program', async () => {
    const { rig, own, capture } = await setup();
    const before = byKey(await candidates(capture, rig), 'process:simtool.exe')!;
    // Behind "show all", not ticked, and it can be offered from now on.
    expect(before).toMatchObject({
      tier: 'more',
      selectedByDefault: false,
      remember: { capture: 'processes', remembered: false },
    });
    // Known helpers have no such button: RigReady offers them already.
    expect(byKey(await candidates(capture, rig), 'process:trackir5.exe')?.remember).toBeUndefined();

    const remembered = await capture.remember!('process:simtool.exe', true, rig.ctx);
    if (!remembered.ok) throw new Error(remembered.error.message);
    expect(remembered.value.candidate).toMatchObject({
      key: 'process:simtool.exe',
      title: 'SimTool',
      tier: 'main',
      selectedByDefault: true,
      description: `Always offered · ${TOOL.path}`,
      remember: { capture: 'processes', remembered: true },
    });
    // The file holds the name, the user's name for it and the path Windows reported.
    const stored = JSON.parse(await fs.readFile(knownFile(rig.ports.folders.dataRoot()), 'utf8'));
    expect(stored.apps).toEqual([
      {
        name: 'SimTool.exe',
        title: 'SimTool',
        path: TOOL.path,
        closeAtStandDown: false,
        added: rig.ports.clock.now().toISOString(),
      },
    ]);

    // The next new setup offers it like a helper RigReady knows.
    const next = byKey(await candidates(capture, rig), 'process:simtool.exe')!;
    expect(next).toMatchObject({ tier: 'main', selectedByDefault: true, title: 'SimTool' });
    expect(next.check).toEqual({
      type: 'process.running',
      title: 'SimTool',
      required: true,
      params: { name: 'SimTool.exe' },
      remediation: { type: 'process.launch', params: { exe: TOOL.path, args: [] } },
    });

    // Make ready starts it through the port, as a program and an argument array.
    rig.ports.state.processes = rig.ports.state.processes.filter((p) => p.pid !== TOOL.pid);
    const session = new SessionStarts();
    const launch = createLaunchRemediation(
      session,
      pathResolver(new GameRegistry()),
      async () => {}
    );
    const started = await launch.run(LaunchParamsSchema.parse(next.check.remediation!.params), {
      ...rig.ctx,
      ports: rig.ports,
    });
    expect(started).toEqual({ ok: true, value: 'Started SimTool.exe' });
    expect(rig.ports.processes.started.at(-1)).toEqual({ exe: TOOL.path, args: [] });

    // Stop offering it: off the list, and back behind "show all".
    const forgotten = await capture.remember!('process:simtool.exe', false, rig.ctx);
    if (!forgotten.ok) throw new Error(forgotten.error.message);
    expect(forgotten.value.candidate).toMatchObject({
      tier: 'more',
      remember: { remembered: false },
    });
    expect(await own.read(rig.ports.folders.windows())).toEqual({
      ok: true,
      value: { apps: [], refused: [] },
    });
  });

  it('closes it at Stand down only when the user says so', async () => {
    const { rig, own, capture } = await setup();
    const windowsDir = rig.ports.folders.windows();
    const added = await capture.remember!('process:simtool.exe', true, rig.ctx);
    expect(added.ok).toBe(true);
    const changed = await own.change(
      'simtool.exe',
      { closeAtStandDown: true, title: 'Sim Tool' },
      windowsDir
    );
    expect(changed).toMatchObject({
      ok: true,
      value: { apps: [{ title: 'Sim Tool', closeAtStandDown: true }] },
    });
    const candidate = byKey(await candidates(capture, rig), 'process:simtool.exe')!;
    expect(candidate).toMatchObject({ title: 'Sim Tool', standDownNote: 'closed at Stand down' });
    expect(candidate.check.params).toEqual({ name: 'SimTool.exe', stopOnStandDown: true });
    const check = createProcessRunningCheck(new SessionStarts(), pathResolver(new GameRegistry()));
    const closed = await check.standDown!(ProcessParamsSchema.parse(candidate.check.params), {
      ...rig.ctx,
      ports: rig.ports,
    });
    expect(closed).toEqual({ ok: true, value: 'Closed SimTool.exe' });
  });

  it('never takes RigReady, a program of Windows or the Windows folder, whichever way it comes', async () => {
    const { rig, capture } = await setup();
    const windowsDir = rig.ports.folders.windows();
    expect(
      refusedToRemember(
        'RigReady.exe',
        'C:\\Users\\x\\AppData\\Local\\Programs\\RigReady\\RigReady.exe',
        windowsDir
      )
    ).toBe('it is RigReady itself');
    expect(refusedToRemember('electron.exe', 'D:\\dev\\electron.exe', windowsDir)).toBe(
      'it is RigReady itself'
    );
    expect(refusedToRemember('explorer.exe', 'D:\\Tools\\explorer.exe', windowsDir)).toBe(
      'it is part of Windows'
    );
    expect(
      refusedToRemember(
        'msedgewebview2.exe',
        'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\msedgewebview2.exe',
        windowsDir
      )
    ).toBe('it is part of Windows');
    expect(refusedToRemember('Tool.exe', 'C:\\Windows\\System32\\Tool.exe', windowsDir)).toBe(
      'it runs from the Windows folder'
    );
    expect(refusedToRemember('Tool.exe', path.join(windowsDir, 'Tool.exe'), windowsDir)).toBe(
      'it runs from the Windows folder'
    );
    expect(refusedToRemember('Tool.exe', '\\\\server\\share\\Tool.exe', windowsDir)).toBe(
      'it does not run from a drive of this PC'
    );
    expect(refusedToRemember('Tool.exe', 'D:\\Tools\\Other.exe', windowsDir)).toBe(
      'its path does not end in Tool.exe'
    );
    expect(refusedToRemember('SimTool.exe', TOOL.path, windowsDir)).toBeUndefined();

    // The rows of such programs have no "Always offer this app", and asking anyway is refused.
    rig.ports.state.processes.push({
      pid: 88002,
      name: 'pwsh.exe',
      path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    });
    const listed = await candidates(capture, rig);
    expect(byKey(listed, 'process:pwsh.exe')).toMatchObject({ tier: 'more' });
    expect(byKey(listed, 'process:pwsh.exe')!.remember).toBeUndefined();
    expect(await capture.remember!('process:pwsh.exe', true, rig.ctx)).toMatchObject({
      ok: false,
      error: {
        code: 'process.refused',
        message: 'RigReady does not offer pwsh.exe: it is part of Windows.',
      },
    });
    expect(await capture.remember!('process:trackir5.exe', true, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'process.known' },
    });
    // A program that is not running cannot say where it is.
    expect(await capture.remember!('process:nothere.exe', true, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'process.notRunning' },
    });
    expect(await capture.remember!('nonsense', true, rig.ctx)).toMatchObject({ ok: false });
    expect(await fs.stat(knownFile(rig.ports.folders.dataRoot())).catch(() => null)).toBeNull();
  });

  it('a list edited by hand is checked again when it is read: what the never list refuses is left out and said', async () => {
    const { rig, own, capture } = await setup();
    const windowsDir = rig.ports.folders.windows();
    rig.ports.state.processes.push(
      { pid: 88003, name: 'Helper.exe', path: 'E:\\Rig\\Helper.exe' },
      { pid: 88004, name: 'Launcher.exe', path: 'C:\\Games\\Real\\Launcher.exe' }
    );
    const file = knownFile(rig.ports.folders.dataRoot());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        apps: [
          {
            name: 'explorer.exe',
            title: 'Files',
            path: 'C:\\Windows\\explorer.exe',
            closeAtStandDown: true,
          },
          {
            name: 'svchost.exe',
            title: 'Host',
            path: 'D:\\Fake\\svchost.exe',
            closeAtStandDown: true,
          },
          { name: 'RigReady.exe', title: 'Me', path: 'D:\\RigReady\\RigReady.exe' },
          { name: 'Helper.exe', title: 'My helper', path: '\\\\nas\\tools\\Helper.exe' },
          {
            name: 'TrackIR5.exe',
            title: 'Head',
            path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
          },
          { title: 'No name' },
          { name: 'SimTool.exe', title: 'My sim tool', path: TOOL.path, closeAtStandDown: true },
          { name: 'simtool.exe', title: 'Twice', path: TOOL.path },
          // A path that is not where the program runs: the entry does not take the running one.
          { name: 'Launcher.exe', title: 'Some launcher', path: 'D:\\Elsewhere\\Launcher.exe' },
        ],
      })
    );
    const read = await own.read(windowsDir);
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.apps.map((a) => a.title)).toEqual(['My sim tool', 'Some launcher']);
    expect(read.value.refused).toEqual([
      { name: 'explorer.exe', why: 'RigReady never offers it: it is part of Windows.' },
      { name: 'svchost.exe', why: 'RigReady never offers it: it is part of Windows.' },
      { name: 'RigReady.exe', why: 'RigReady never offers it: it is RigReady itself.' },
      {
        name: 'Helper.exe',
        why: 'RigReady never offers it: it does not run from a drive of this PC.',
      },
      { name: 'TrackIR5.exe', why: 'RigReady offers it already, as TrackIR.' },
      { name: 'Entry 6', why: 'The entry is not complete: it needs a name, a title and a path.' },
      { name: 'simtool.exe', why: 'It is on the list twice; the first one is used.' },
    ]);

    const listed = await candidates(capture, rig);
    expect(byKey(listed, 'process:simtool.exe')).toMatchObject({
      title: 'My sim tool',
      tier: 'main',
      selectedByDefault: true,
    });
    // Refused and unmatched entries change nothing: not ticked, never closed at Stand down.
    for (const key of ['process:helper.exe', 'process:launcher.exe']) {
      expect(byKey(listed, key)).toMatchObject({ tier: 'more', selectedByDefault: false });
      expect(byKey(listed, key)!.check.params).not.toHaveProperty('stopOnStandDown');
    }
    expect(byKey(listed, 'process:launcher.exe')!.check.remediation!.params).toEqual({
      exe: 'C:\\Games\\Real\\Launcher.exe',
      args: [],
    });
    expect(listed.some((c) => /explorer|svchost|rigready/i.test(c.key))).toBe(false);
    expect(
      listed.filter((c) => c.check.params['stopOnStandDown'] === true).map((c) => c.key)
    ).not.toContain('process:explorer.exe');

    // Adding writes the refused entries back as they were, and removing takes them off.
    expect((await capture.remember!('process:helper.exe', true, rig.ctx)).ok).toBe(true);
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.apps.find((e: { name?: string }) => e.name === 'explorer.exe')).toEqual({
      name: 'explorer.exe',
      title: 'Files',
      path: 'C:\\Windows\\explorer.exe',
      closeAtStandDown: true,
    });
    expect(after.apps.filter((e: { name?: string }) => e.name === 'Helper.exe')).toEqual([
      expect.objectContaining({ path: 'E:\\Rig\\Helper.exe' }),
    ]);
    const removed = await own.remove('EXPLORER.EXE', windowsDir);
    expect(removed.ok && removed.value.refused.map((r) => r.name)).not.toContain('explorer.exe');
  });

  it('a damaged list is never overwritten: the known apps are still offered, and adding says why it cannot', async () => {
    const { rig, own, capture } = await setup();
    const file = knownFile(rig.ports.folders.dataRoot());
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ "apps": [ broken');
    const listed = await candidates(capture, rig);
    expect(byKey(listed, 'process:trackir5.exe')).toMatchObject({ selectedByDefault: true });
    expect(await capture.remember!('process:simtool.exe', true, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'store.invalid' },
    });
    expect(await own.read(rig.ports.folders.windows())).toMatchObject({ ok: false });
    expect(await fs.readFile(file, 'utf8')).toBe('{ "apps": [ broken');
  });
});

describe('always offer this app, through the app', () => {
  it('the New setup page offers it, Settings lists it, renames it and takes it off again', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    app.ports.state.processes.push({ ...TOOL });
    const handler = (channel: string) => app!.wiring.handlers.get(channel)!;
    const captured = await app.invoke<{ candidates: CaptureCandidate[] }>('profiles:capture');
    const row = byKey(captured.candidates, 'process:simtool.exe')!;
    expect(row.remember).toEqual({ capture: 'processes', remembered: false });

    const on = await app.invoke<{ candidate?: CaptureCandidate }>('profiles:remember', {
      capture: row.remember!.capture,
      key: row.key,
      on: true,
    });
    expect(on.candidate).toMatchObject({ title: 'SimTool', remember: { remembered: true } });
    expect(await app.invoke<OwnAppsView>('processes:ownApps')).toEqual({
      file: knownFile(app.ports.folders.dataRoot()),
      apps: [{ name: 'SimTool.exe', title: 'SimTool', path: TOOL.path, closeAtStandDown: false }],
      refused: [],
    });
    const renamed = await app.invoke<OwnAppsView>('processes:changeOwnApp', {
      name: 'SimTool.exe',
      title: 'Sim Tool',
      closeAtStandDown: true,
    });
    expect(renamed.apps).toEqual([
      { name: 'SimTool.exe', title: 'Sim Tool', path: TOOL.path, closeAtStandDown: true },
    ]);
    const again = await app.invoke<{ candidates: CaptureCandidate[] }>('profiles:capture');
    expect(byKey(again.candidates, 'process:simtool.exe')).toMatchObject({
      title: 'Sim Tool',
      selectedByDefault: true,
      standDownNote: 'closed at Stand down',
    });

    // Nothing but an image name reaches the list, and an unknown capture is refused.
    expect(
      await handler('processes:forgetOwnApp')({ name: 'C:\\Windows\\explorer.exe' })
    ).toMatchObject({ ok: false });
    expect(await handler('processes:changeOwnApp')({ name: 'Nope.exe', title: 'x' })).toMatchObject(
      {
        ok: false,
        error: { code: 'process.ownApp' },
      }
    );
    expect(
      await handler('profiles:remember')({ capture: 'audio', key: row.key, on: true })
    ).toMatchObject({
      ok: false,
      error: { code: 'capture.remember' },
    });

    const gone = await app.invoke<OwnAppsView>('processes:forgetOwnApp', { name: 'simtool.exe' });
    expect(gone.apps).toEqual([]);
    const last = await app.invoke<{ candidates: CaptureCandidate[] }>('profiles:capture');
    expect(byKey(last.candidates, 'process:simtool.exe')).toMatchObject({
      tier: 'more',
      selectedByDefault: false,
    });
    // RigReady's own data only: nothing outside the data folder was changed.
    expect(await app.ports.files.journal()).toEqual({ ok: true, value: [] });
  });
});
