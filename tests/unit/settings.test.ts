import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import { DisplayLayoutStore, layoutToTargets } from '../../src/core/displays/layouts';
import { err } from '../../src/core/result';
import { AI_KEY_SECRET, SettingsStore, defaultSettings } from '../../src/core/settings';
import type { SafetyView } from '../../src/features/safety/contract';
import type { SettingsView } from '../../src/features/settings/contract';
import {
  statusFromFlyResponse,
  trayMenu,
  trayStatusLine,
  trayTooltip,
} from '../../src/main/trayModel';
import { markFull, rigFromState, wiredApp, type TestRig, type WiredApp } from '../helpers';

let rig: TestRig | undefined;
let app: WiredApp | undefined;
afterEach(async () => {
  await rig?.cleanup();
  await app?.cleanup();
  rig = undefined;
  app = undefined;
});

const NO_FILES = { files: [] as string[] };

describe('SettingsStore', () => {
  it('starts with the documented defaults and stores changes as JSON under the data root', async () => {
    rig = await rigFromState(await markFull());
    const store = new SettingsStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock);
    expect(await store.get()).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        logLevel: 'info',
        startWithWindows: false,
        minimizeToTray: true,
        aiKeyPresent: false,
        retention: { autoBackupDays: 30, autoBackupGroups: 50 },
        displayRevertSeconds: 15,
        checkTimeoutSeconds: 5,
        importMaxMegabytes: 200,
        updates: { check: true, channel: 'stable' },
      },
    });
    expect(defaultSettings().deskLayoutId).toBeUndefined();
    // Reading defaults writes nothing.
    expect(await rig.ports.files.exists(store.file)).toBe(false);

    const seen: number[] = [];
    const off = store.onChange((s) => seen.push(s.displayRevertSeconds));
    const updated = await store.update({
      displayRevertSeconds: 20,
      deskLayoutId: 'desk',
      retention: { autoBackupDays: 10 },
    });
    expect(updated.ok && updated.value).toMatchObject({
      displayRevertSeconds: 20,
      deskLayoutId: 'desk',
      retention: { autoBackupDays: 10, autoBackupGroups: 50 },
    });
    expect(seen).toEqual([20]);
    off();
    expect(store.file).toBe(path.join(rig.ports.folders.dataRoot(), 'settings.json'));
    expect(JSON.parse(await fs.readFile(store.file, 'utf8'))).toMatchObject({
      deskLayoutId: 'desk',
    });

    // A fresh store (an app restart) reads the same values; null clears the desk layout.
    const again = new SettingsStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock);
    expect((await again.get()).ok && (await again.get())).toMatchObject({
      value: { displayRevertSeconds: 20, deskLayoutId: 'desk' },
    });
    const cleared = await again.update({ deskLayoutId: null });
    expect(cleared.ok && 'deskLayoutId' in cleared.value).toBe(false);
    expect(seen).toEqual([20]);

    expect(await again.update({ checkTimeoutSeconds: 0 })).toMatchObject({
      ok: false,
      error: { code: 'settings.invalid' },
    });
    expect((await again.get()).ok && (await again.get())).toMatchObject({
      value: { checkTimeoutSeconds: 5 },
    });
  });

  it('fills in defaults for missing fields, and sets an unreadable file aside with a notice', async () => {
    rig = await rigFromState(await markFull());
    const dataRoot = rig.ports.folders.dataRoot();
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'settings.json'), '{"minimizeToTray": false}');
    const partial = new SettingsStore(rig.ports.files, dataRoot, rig.clock);
    expect((await partial.get()).ok && (await partial.get())).toMatchObject({
      value: { minimizeToTray: false, displayRevertSeconds: 15 },
    });
    expect(partial.takeNotice()).toBeUndefined();

    for (const broken of ['{ not json', '{"displayRevertSeconds": "soon"}']) {
      await fs.writeFile(path.join(dataRoot, 'settings.json'), broken);
      const store = new SettingsStore(rig.ports.files, dataRoot, rig.clock);
      expect(await store.get()).toEqual({ ok: true, value: defaultSettings() });
      const notice = store.takeNotice();
      expect(notice).toContain('could not be read');
      expect(store.takeNotice()).toBeUndefined();
      const aside = (await fs.readdir(dataRoot)).filter((f) => f.startsWith('settings.corrupt-'));
      expect(aside.length).toBeGreaterThan(0);
      expect(await fs.readFile(path.join(dataRoot, aside[0]!), 'utf8')).toBe(broken);
      // The replacement on disk is valid again.
      expect(JSON.parse(await fs.readFile(path.join(dataRoot, 'settings.json'), 'utf8'))).toEqual(
        defaultSettings()
      );
      rig.clock.advance(1000);
      await fs.rm(path.join(dataRoot, aside[0]!));
    }
  });

  it('callers that ask at the same moment share one read of a damaged file', async () => {
    rig = await rigFromState(await markFull());
    const dataRoot = rig.ports.folders.dataRoot();
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'settings.json'), '{ not json');
    const store = new SettingsStore(rig.ports.files, dataRoot, rig.clock);
    const answers = await Promise.all([store.get(), store.get(), store.get()]);
    for (const answer of answers) expect(answer).toEqual({ ok: true, value: defaultSettings() });
    const aside = (await fs.readdir(dataRoot)).filter((f) => f.startsWith('settings.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(store.takeNotice()).toContain('could not be read');
  });
});

describe('DisplayLayoutStore', () => {
  it('saves the current monitors under a name; layouts can be renamed, replaced and deleted', async () => {
    rig = await rigFromState(await markFull());
    const store = new DisplayLayoutStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock);
    expect(await store.list()).toEqual({ ok: true, value: [] });

    const desk = await store.createFromCurrent('  Desk ', rig.ports.displays);
    if (!desk.ok) throw new Error(desk.error.message);
    expect(desk.value).toMatchObject({ id: 'desk', name: 'Desk' });
    expect(desk.value.displays).toHaveLength(5);
    expect(desk.value.displays.find((d) => d.name === 'DELL G3223D')).toMatchObject({
      enabled: true,
      primary: true,
      x: 0,
      y: 0,
      width: 2560,
      height: 1440,
      rotation: 0,
    });
    expect(store.file).toBe(path.join(rig.ports.folders.dataRoot(), 'displays', 'layouts.json'));

    expect(await store.createFromCurrent('desk', rig.ports.displays)).toMatchObject({
      ok: false,
      error: { code: 'layouts.duplicate' },
    });
    expect(await store.create('   ', desk.value.displays)).toMatchObject({
      ok: false,
      error: { code: 'layouts.name' },
    });
    expect(await store.create('Empty', [])).toMatchObject({
      ok: false,
      error: { code: 'layouts.empty' },
    });
    // Same slug, different name: the id gets a suffix.
    const second = await store.create('Desk!', desk.value.displays);
    expect(second.ok && second.value.id).toBe('desk-2');

    rig.clock.advance(5000);
    const renamed = await store.rename('desk', 'Office');
    expect(renamed.ok && renamed.value).toMatchObject({ id: 'desk', name: 'Office' });
    expect(renamed.ok && renamed.value.updatedAt).not.toBe(desk.value.createdAt);
    expect(await store.rename('desk', 'Desk!')).toMatchObject({
      ok: false,
      error: { code: 'layouts.duplicate' },
    });
    expect(await store.rename('nope', 'X')).toMatchObject({
      ok: false,
      error: { code: 'layouts.missing' },
    });

    const off = layoutToTargets({
      displays: [
        {
          id: 'a',
          name: 'A',
          enabled: false,
          primary: false,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
        },
      ],
    });
    expect(off).toEqual([
      { id: 'a', name: 'A', enabled: false, primary: false, x: 0, y: 0, rotation: 0 },
    ]);
    const replaced = await store.replace('desk', off);
    expect(replaced.ok && replaced.value.displays).toEqual(off);
    expect(await store.replace('desk', [])).toMatchObject({
      ok: false,
      error: { code: 'layouts.empty' },
    });
    expect(await store.replace('nope', off)).toMatchObject({
      ok: false,
      error: { code: 'layouts.missing' },
    });

    expect(await store.remove('desk-2')).toEqual({ ok: true, value: undefined });
    expect(await store.remove('desk-2')).toMatchObject({
      ok: false,
      error: { code: 'layouts.missing' },
    });
    const left = await store.list();
    expect(left.ok && left.value.map((l) => l.name)).toEqual(['Office']);
    expect(await store.get('desk')).toMatchObject({ ok: true, value: { name: 'Office' } });
    expect(await store.get('nope')).toMatchObject({
      ok: false,
      error: { code: 'layouts.missing' },
    });
  });

  it('reports a damaged layouts file and a failing display read instead of guessing', async () => {
    rig = await rigFromState(await markFull());
    const store = new DisplayLayoutStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock);
    await fs.mkdir(path.dirname(store.file), { recursive: true });
    for (const broken of ['not json', '{"layouts":[{"id":"x"}]}']) {
      await fs.writeFile(store.file, broken);
      expect(await store.list()).toMatchObject({ ok: false, error: { code: 'layouts.invalid' } });
      expect(await store.get('x')).toMatchObject({ ok: false });
      expect(await store.create('A', [])).toMatchObject({ ok: false });
      expect(await store.rename('x', 'A')).toMatchObject({ ok: false });
      expect(await store.replace('x', [])).toMatchObject({ ok: false });
      expect(await store.remove('x')).toMatchObject({ ok: false });
    }
    await fs.rm(store.file);
    rig.ports.displays.read = async () => err('display.read', 'Could not read the monitors.');
    expect(await store.createFromCurrent('Desk', rig.ports.displays)).toMatchObject({
      ok: false,
      error: { code: 'display.read' },
    });
  });
});

describe('settings feature', () => {
  it('shows settings, saved layouts and the login item; changes go through validation', async () => {
    app = await wiredApp('desk-mfds-wrong', NO_FILES);
    const view = await app.invoke<SettingsView>('settings:get');
    expect(view).toMatchObject({
      settings: { startWithWindows: false, minimizeToTray: true, aiKeyPresent: false },
      layouts: [],
      startsWithWindows: false,
    });

    const saved = await app.invoke<SettingsView>('settings:saveCurrentLayout', { name: 'Desk' });
    expect(saved.layouts.map((l) => l.name)).toEqual(['Desk']);
    const desk = await app.invoke<SettingsView>('settings:update', { deskLayoutId: 'desk' });
    expect(desk.settings.deskLayoutId).toBe('desk');
    await expect(app.invoke('settings:update', { deskLayoutId: 'missing' })).rejects.toThrow(
      /layouts\.missing/
    );
    await expect(app.invoke('settings:update', { aiKeyPresent: true })).rejects.toThrow(
      /settings\.invalid/
    );
    await expect(app.invoke('settings:update', { importMaxMegabytes: 0 })).rejects.toThrow(
      /settings\.invalid/
    );

    const renamed = await app.invoke<SettingsView>('settings:renameLayout', {
      id: 'desk',
      name: 'Office',
    });
    expect(renamed.layouts[0]!.name).toBe('Office');
    // Deleting the desk layout also clears the setting that pointed at it.
    const removed = await app.invoke<SettingsView>('settings:removeLayout', { id: 'desk' });
    expect(removed.layouts).toEqual([]);
    expect(removed.settings.deskLayoutId).toBeUndefined();
    await expect(app.invoke('settings:removeLayout', { id: 'desk' })).rejects.toThrow(
      /layouts\.missing/
    );
    await expect(app.invoke('settings:renameLayout', { id: 'desk', name: 'X' })).rejects.toThrow();
    await expect(app.invoke('settings:saveCurrentLayout', { name: '' })).rejects.toThrow(
      /layouts\.name/
    );
  });

  it('start with Windows registers the login item first, and says so when Windows refuses', async () => {
    app = await wiredApp('desk-mfds-wrong', NO_FILES);
    const on = await app.invoke<SettingsView>('settings:update', { startWithWindows: true });
    expect(on.settings.startWithWindows).toBe(true);
    expect(on.startsWithWindows).toBe(true);
    expect(app.ports.loginItem.enabled).toBe(true);
    const off = await app.invoke<SettingsView>('settings:update', { startWithWindows: false });
    expect(off.startsWithWindows).toBe(false);
    expect(app.ports.loginItem.enabled).toBe(false);

    // Windows (Task Manager > Startup apps) keeps it disabled: the setting must not claim otherwise.
    app.ports.loginItem.setEnabled = async () => ({ ok: true, value: undefined });
    await expect(app.invoke('settings:update', { startWithWindows: true })).rejects.toThrow(
      /login\.write/
    );
    expect((await app.invoke<SettingsView>('settings:get')).settings.startWithWindows).toBe(false);

    app.ports.loginItem.setEnabled = async () => err('login.dev', 'Only in the installed app.');
    await expect(app.invoke('settings:update', { startWithWindows: true })).rejects.toThrow(
      /login\.dev/
    );
    app.ports.loginItem.isEnabled = async () => err('login.read', 'Could not read it.');
    expect(await app.invoke<SettingsView>('settings:get')).toMatchObject({
      startsWithWindows: null,
      startWithWindowsProblem: 'Could not read it.',
    });
  });

  it('the AI key goes to the secret store; settings only hold the presence flag', async () => {
    app = await wiredApp('desk-mfds-wrong', NO_FILES);
    const key = 'test-key-0123456789';
    const stored = await app.invoke<SettingsView>('settings:setAiKey', { key: `  ${key} ` });
    expect(stored.settings.aiKeyPresent).toBe(true);
    expect(await app.ports.secrets.get(AI_KEY_SECRET)).toEqual({ ok: true, value: key });
    // The key is in no file under the data root and in no response.
    expect(JSON.stringify(stored)).not.toContain(key);
    const settingsFile = path.join(app.ports.folders.dataRoot(), 'settings.json');
    expect(await fs.readFile(settingsFile, 'utf8')).not.toContain(key);

    const cleared = await app.invoke<SettingsView>('settings:clearAiKey');
    expect(cleared.settings.aiKeyPresent).toBe(false);
    expect(await app.ports.secrets.get(AI_KEY_SECRET)).toEqual({ ok: true, value: undefined });
    await expect(app.invoke('settings:setAiKey', { key: 'short' })).rejects.toThrow(/ipc\.input/);

    app.ports.secrets.set = async () =>
      err('secret.unavailable', 'Windows cannot encrypt right now.');
    await expect(app.invoke('settings:setAiKey', { key })).rejects.toThrow(/secret\.unavailable/);
    expect((await app.invoke<SettingsView>('settings:get')).settings.aiKeyPresent).toBe(false);
  });
});

describe('Stand down and the desk layout', () => {
  const P = { profileId: 'dcs-f-a-18c' };

  it('applies the desk layout named in the settings, with the keep-or-revert countdown', async () => {
    app = await wiredApp('flying-all-good', NO_FILES);
    // The owner saves the desk arrangement once, while the monitors are in it...
    const flying = structuredClone(app.ports.state.displays);
    const deskState = (await markFull()).displays;
    app.ports.state.displays = structuredClone(deskState);
    await app.invoke('settings:saveCurrentLayout', { name: 'Desk' });
    await app.invoke('settings:update', { deskLayoutId: 'desk' });
    // ...and is flying now.
    app.ports.state.displays = flying;
    expect((await app.invoke<ChecklistReport>('fly:check', P)).ready).toBe(true);

    // The countdown starts, exactly as for any other layout change, and Stand down
    // waits for the answer before it says what it did.
    app.layoutAnswer = 'wait';
    const standingDown = app.invoke<ActionReport>('fly:standDown', P);
    await expect
      .poll(async () => (await app!.invoke<{ pending: boolean }>('displays:pending')).pending)
      .toBe(true);
    expect(app.events.some((e) => e.channel === 'displays:event:applied')).toBe(true);
    expect(await app.invoke('displays:pending')).toMatchObject({ pending: true, seconds: 15 });
    const dell = app.ports.state.displays.find((d) => d.name === 'DELL G3223D')!;
    expect(dell).toMatchObject({ enabled: true, primary: true, x: 0, y: 0 });
    expect(
      app.ports.state.displays.filter((d) => d.name === 'USB_Monitor').map((d) => d.rotation)
    ).toEqual([0, 0, 0]);
    await app.invoke('displays:keep');
    const down = await standingDown;
    expect(down.steps).toContainEqual({
      itemId: 'displays.deskLayout',
      title: 'Desk monitor layout',
      ok: true,
      message: 'Applied desk layout "Desk"',
    });
    app.layoutAnswer = 'keep';

    // Already in the desk layout: nothing to do, and nothing is claimed.
    const again = await app.invoke<ActionReport>('fly:standDown', P);
    expect(again.steps.some((s) => s.itemId === 'displays.deskLayout')).toBe(false);
  });

  it('skips monitors of the desk layout that are not connected, and fails clearly when it cannot apply', async () => {
    app = await wiredApp('flying-all-good', NO_FILES);
    const flying = structuredClone(app.ports.state.displays);
    app.ports.state.displays = (await markFull()).displays;
    await app.invoke('settings:saveCurrentLayout', { name: 'Desk' });
    await app.invoke('settings:update', { deskLayoutId: 'desk' });
    app.ports.state.displays = flying.filter((d) => d.name !== 'DELL G3223D');

    const down = await app.invoke<ActionReport>('fly:standDown', P);
    expect(down.steps.find((s) => s.itemId === 'displays.deskLayout')).toMatchObject({
      ok: true,
      message: 'Applied desk layout "Desk" (1 monitor is not connected)',
    });
    await app.invoke('displays:keep');

    app.ports.state.displays = [];
    const none = await app.invoke<ActionReport>('fly:standDown', P);
    expect(none.steps.find((s) => s.itemId === 'displays.deskLayout')).toMatchObject({
      ok: false,
      message: 'None of the monitors of the "Desk" layout are connected.',
    });

    // The layout was deleted behind the setting's back (hand-edited file).
    await app.ctx.ports.files.write(
      path.join(app.ports.folders.dataRoot(), 'displays', 'layouts.json'),
      '{"layouts":[]}',
      { reason: 'test' }
    );
    const missing = await app.invoke<ActionReport>('fly:standDown', P);
    expect(missing.steps.find((s) => s.itemId === 'displays.deskLayout')).toMatchObject({
      ok: false,
      message: expect.stringContaining('no longer exists'),
    });
  });

  it('without a desk layout Stand down still puts back the layout from before Make ready', async () => {
    app = await wiredApp('flying-mfd-rotated', NO_FILES);
    const before = structuredClone(app.ports.state.displays);
    await app.invoke<ActionReport>('fly:makeReady', P);
    await app.invoke('displays:keep');
    expect(app.ports.state.displays).not.toEqual(before);
    const down = await app.invoke<ActionReport>('fly:standDown', P);
    expect(down.steps.some((s) => s.itemId === 'displays.deskLayout')).toBe(false);
    expect(down.steps.some((s) => s.message === 'Restored the earlier monitor layout')).toBe(true);
    expect(app.ports.state.displays).toEqual(before);
  });

  it('the revert countdown follows the setting', async () => {
    app = await wiredApp('flying-mfd-rotated', NO_FILES);
    await app.invoke('settings:update', { displayRevertSeconds: 30 });
    app.layoutAnswer = 'wait';
    const making = app.invoke<ActionReport>('fly:makeReady', P);
    await expect
      .poll(async () => (await app!.invoke<{ pending: boolean }>('displays:pending')).pending)
      .toBe(true);
    expect(await app.invoke('displays:pending')).toEqual({ pending: true, seconds: 30 });
    await app.invoke('displays:keep');
    await making;
  });
});

describe('safety feature', () => {
  it('lists every change by action with what happened to each file, and undoes a whole action', async () => {
    app = await wiredApp('desk-mfds-wrong', { files: ['Saved Games/DCS/Config/options.lua'] });
    const empty = await app.invoke<SafetyView>('safety:journal');
    expect(empty).toMatchObject({
      groups: [],
      backupBytes: 0,
      retention: { autoBackupDays: 30, autoBackupGroups: 50 },
      backupFolder: path.join(app.ports.folders.dataRoot(), 'backups', 'auto'),
    });

    const dcs = path.join(app.ports.folders.savedGames(), 'DCS');
    const options = path.join(dcs, 'Config', 'options.lua');
    const original = await fs.readFile(options);
    const { files } = app.ports;
    const group = files.beginGroup('Set up MFD screens');
    await files.write(options, 'options = {}', { reason: 'x', group });
    await files.write(path.join(dcs, 'Config', 'MonitorSetup', 'RigReady.lua'), '-- setup', {
      reason: 'x',
      group,
    });
    app.clock.advance(60_000);
    await files.write(path.join(dcs, 'Scripts', 'Hook.lua'), '-- hook', { reason: 'Add hook' });
    await files.remove(path.join(dcs, 'Scripts', 'Hook.lua'), { reason: 'Remove hook' });

    const view = await app.invoke<SafetyView>('safety:journal');
    expect(
      view.groups.map((g) => [g.reason, g.changes.map((c) => c.kind), g.undone, g.isUndo])
    ).toEqual([
      ['Remove hook', ['deleted'], false, false],
      ['Add hook', ['created'], false, false],
      ['Set up MFD screens', ['changed', 'created'], false, false],
    ]);
    expect(view.backupBytes).toBeGreaterThan(0);

    const undone = await app.invoke<SafetyView>('safety:undo', { groupId: group.id });
    expect(await fs.readFile(options)).toEqual(original);
    expect(await files.exists(path.join(dcs, 'Config', 'MonitorSetup', 'RigReady.lua'))).toBe(
      false
    );
    expect(undone.groups[0]).toMatchObject({ reason: 'Undo: Set up MFD screens', isUndo: true });
    expect(undone.groups.find((g) => g.id === group.id)).toMatchObject({ undone: true });
    await expect(app.invoke('safety:undo', { groupId: group.id })).rejects.toThrow(
      /journal\.undone/
    );

    // A file changed since: refused unless forced.
    const hook = view.groups[1]!;
    await fs.writeFile(path.join(dcs, 'Scripts', 'Hook.lua'), 'someone else wrote this');
    await expect(app.invoke('safety:undo', { groupId: hook.id })).rejects.toThrow(
      /journal\.changed/
    );
    await app.invoke<SafetyView>('safety:undo', { groupId: hook.id, force: true });
    expect(await files.exists(path.join(dcs, 'Scripts', 'Hook.lua'))).toBe(false);
  });
});

describe('tray model', () => {
  it('describes the setup status in words', () => {
    expect(trayStatusLine({})).toBe('No setup yet');
    expect(trayStatusLine({ profileId: 'a', profileName: 'DCS F/A-18C' })).toBe(
      'DCS F/A-18C: not checked yet'
    );
    expect(trayStatusLine({ profileName: 'DCS F/A-18C', ready: true, warnings: 0 })).toBe(
      'DCS F/A-18C: Ready'
    );
    expect(trayStatusLine({ profileName: 'DCS F/A-18C', ready: true, warnings: 2 })).toBe(
      'DCS F/A-18C: Ready (2 warnings)'
    );
    expect(trayStatusLine({ profileName: 'DCS F/A-18C', ready: false, failed: 1 })).toBe(
      'DCS F/A-18C: Not ready (1 problem)'
    );
    expect(trayTooltip({})).toBe('RigReady - No setup yet');
  });

  it('offers Open, the status, Make ready, Launch, Stand down and Quit; actions need a setup and wait while busy', () => {
    const none = trayMenu({});
    expect(none.map((i) => i.id)).toEqual([
      'open',
      'separator',
      'status',
      'makeReady',
      'launch',
      'standDown',
      'separator',
      'quit',
    ]);
    expect(none.find((i) => i.id === 'makeReady')).toMatchObject({ enabled: false });
    expect(none.find((i) => i.id === 'status')).toMatchObject({
      enabled: false,
      label: 'No setup yet',
    });
    const ready = trayMenu({ profileId: 'a', profileName: 'A', ready: true });
    expect(ready.find((i) => i.id === 'makeReady')).toMatchObject({
      enabled: true,
      label: 'Make ready',
    });
    const busy = trayMenu({ profileId: 'a', profileName: 'A' }, true);
    expect(busy.find((i) => i.id === 'makeReady')).toMatchObject({
      enabled: false,
      label: 'Working...',
    });
  });

  it('follows the answers of the fly feature', async () => {
    app = await wiredApp('flying-trackir-not-running', NO_FILES);
    let status = statusFromFlyResponse('fly:state', await app.invoke('fly:state'), {})!;
    expect(status).toEqual({
      profileId: 'dcs-f-a-18c',
      profileName: 'DCS F/A-18C',
      profiles: [{ id: 'dcs-f-a-18c', name: 'DCS F/A-18C', canLaunch: true }],
    });

    const P = { profileId: 'dcs-f-a-18c' };
    status = statusFromFlyResponse('fly:check', await app.invoke('fly:check', P), status)!;
    expect(trayStatusLine(status)).toBe('DCS F/A-18C: Not ready (1 problem)');
    status = statusFromFlyResponse('fly:makeReady', await app.invoke('fly:makeReady', P), status)!;
    expect(trayStatusLine(status)).toBe('DCS F/A-18C: Ready');
    // The state answer keeps the last result while the same setup is selected.
    status = statusFromFlyResponse('fly:state', await app.invoke('fly:state'), status)!;
    expect(status.ready).toBe(true);

    // Other channels and odd answers are ignored; no setups clears the status.
    expect(statusFromFlyResponse('devices:list', [], status)).toBeUndefined();
    expect(statusFromFlyResponse('fly:check', null, status)).toBeUndefined();
    expect(statusFromFlyResponse('fly:makeReady', { steps: [] }, status)).toBeUndefined();
    expect(statusFromFlyResponse('fly:state', { profiles: [] }, status)).toEqual({ profiles: [] });
    expect(
      statusFromFlyResponse('fly:check', { profileId: 'other', ready: false, failed: 2 }, status)
    ).toEqual({
      profileId: 'other',
      profileName: 'other',
      profiles: status.profiles,
      ready: false,
      failed: 2,
      warnings: 0,
      fixable: 0,
      // A report without results names nothing.
      problems: [],
      warningNames: [],
    });
    expect(
      statusFromFlyResponse('fly:state', { profiles: [{ id: 'b' }], activeProfileId: 'b' }, status)
    ).toEqual({
      profileId: 'b',
      profileName: 'b',
      profiles: [{ id: 'b', name: 'b', canLaunch: false }],
    });
  });
});
