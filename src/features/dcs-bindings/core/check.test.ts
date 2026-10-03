import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../../core/checks/engine';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import {
  BINDING_FILES,
  HORNET,
  HUEY,
  fixtureData,
  joystickDir,
  useOldBindings,
} from '../../../../tests/dcsBindings';
import type { Applied, ChangePlan } from './changes';
import { BINDINGS_CHECK, OPEN_MIGRATION } from './check';
import type { CopyPreview } from './copy';
import type { BindingOp } from './edits';
import type { MigrationScan } from './migration';
import type { AircraftView, Overview } from './model';
import type { Comparison, Snapshot } from './snapshots';

let app: WiredApp;
afterEach(() => app?.cleanup());

async function start(): Promise<void> {
  app = await wiredApp('flying-fresh', { files: BINDING_FILES });
}

async function profileWithCheck(): Promise<string> {
  const profile = await app.invoke<{ id: string }>('profiles:create', {
    name: 'DCS F/A-18C',
    game: 'dcs',
    checks: [
      {
        type: BINDINGS_CHECK,
        title: 'DCS bindings match devices (F/A-18C)',
        required: false,
        params: { aircraft: HORNET, aircraftName: 'F/A-18C' },
        remediation: { type: OPEN_MIGRATION, params: {} },
      },
    ],
  });
  return profile.id;
}

describe('the Fly check for bindings', () => {
  it('passes when the bindings sit under the attached devices ids', async () => {
    await start();
    const profileId = await profileWithCheck();
    const report = await app.invoke<ChecklistReport>('fly:check', { profileId });
    expect(report.ready).toBe(true);
    expect(report.results[0]).toMatchObject({
      type: BINDINGS_CHECK,
      group: 'files',
      status: 'pass',
      summary: '11 connected devices have bindings for F/A-18C',
    });
  });

  it('warns that bindings belong to an old device ID, and its fix opens the Device IDs screen', async () => {
    await start();
    const profileId = await profileWithCheck();
    // Only the UFC's file is under an old id.
    const dir = joystickDir(app.home);
    const current = (await fs.readdir(dir)).find((f) => f.startsWith('WINWING UFC1'))!;
    await fs.rename(
      path.join(dir, current),
      path.join(dir, 'WINWING UFC1 + HUD1 {4F2206B0-9AA7-11ee-8023-444553540000}.diff.lua')
    );
    let report = await app.invoke<ChecklistReport>('fly:check', { profileId });
    // Optional by default: a warning, and the setup is still Ready.
    expect(report.ready).toBe(true);
    expect(report.results[0]).toMatchObject({
      status: 'warn',
      summary: 'Bindings for WINWING UFC1 + HUD1 belong to an old device ID',
      fix: 'Open Bindings → Device IDs to move the bindings to the current device IDs',
    });

    // The whole old backup: every device.
    await useOldBindings(app.home, HORNET);
    report = await app.invoke<ChecklistReport>('fly:check', { profileId });
    expect(report.results[0]).toMatchObject({
      status: 'warn',
      summary: 'Bindings for 10 devices belong to old device IDs',
    });
    expect(report.results[0]!.details).toContain(
      'Bindings for WINWING UFC1 + HUD1 belong to an old device ID (4F2206B0-9AA7-11ee-8023-444553540000)'
    );

    // Make ready never leaves the Fly screen for it: the item is listed under "Needs you"
    // with its own button.
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId });
    expect(made.steps).toEqual([]);
    expect(made.needsYou).toEqual([
      {
        itemId: report.results[0]!.itemId,
        title: 'DCS bindings match devices (F/A-18C)',
        summary: 'Bindings for 10 devices belong to old device IDs',
        open: 'Open Bindings → Device IDs to move the bindings to the current device IDs',
      },
    ]);
    expect(app.events).not.toContainEqual({
      channel: 'dcs-bindings:event:openMigration',
      payload: {},
    });
    // The fix does not move anything by itself: it sends the user to the preview. That
    // counts as done, although the check stays as it is until the preview is applied.
    const fixed = await app.invoke<{
      step: { ok: boolean; message: string };
      result: { status: string };
    }>('fly:fix', { profileId, itemId: report.results[0]!.itemId });
    expect(fixed.step).toMatchObject({
      ok: true,
      message: 'Opened Bindings → Device IDs. Review the preview there and apply it.',
    });
    expect(fixed.result.status).toBe('warn');
    expect(app.events).toContainEqual({ channel: 'dcs-bindings:event:openMigration', payload: {} });
    expect(made.report.results[0]!.status).toBe('warn');
    expect(await fs.readdir(dir)).toContain(
      'WINWING UFC1 + HUD1 {4F2206B0-9AA7-11ee-8023-444553540000}.diff.lua'
    );

    // After migrating through the screen's own channel the check is green again.
    const scan = await app.invoke<MigrationScan>('dcs-bindings:migrationScan');
    const mappings = scan.orphans
      .filter((o) => o.status === 'ready')
      .map((o) => ({ from: o.id, toGuid: o.proposed }));
    const plan = await app.invoke<ChangePlan>('dcs-bindings:migrationPlan', { mappings });
    expect(plan.files).toHaveLength(10);
    await app.invoke<Applied>('dcs-bindings:migrationApply', { mappings });
    report = await app.invoke<ChecklistReport>('fly:check', { profileId });
    expect(report.results[0]).toMatchObject({
      status: 'pass',
      summary: '10 connected devices have bindings for F/A-18C',
    });
  });

  it('fails when the aircraft has no bindings of its own at all', async () => {
    await start();
    const profile = await app.invoke<{ id: string }>('profiles:create', {
      name: 'DCS Huey',
      checks: [
        { type: BINDINGS_CHECK, title: 'Bindings', required: true, params: { aircraft: HUEY } },
        { type: BINDINGS_CHECK, title: 'Unknown', required: true, params: { aircraft: 'Nope' } },
      ],
    });
    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(report.results.map((r) => [r.status, r.summary])).toEqual([
      ['fail', 'No bindings of your own for UH-1H on the connected devices'],
      ['fail', 'DCS has no aircraft "Nope" on this PC.'],
    ]);
  });

  it('capture proposes the check for every aircraft that has binding files', async () => {
    await start();
    await useOldBindings(app.home, HUEY);
    const captured = await app.invoke<{
      candidates: { key: string; title: string; selectedByDefault: boolean; check: unknown }[];
    }>('profiles:capture');
    const mine = captured.candidates.filter((c) => c.key.startsWith('dcs-bindings:'));
    expect(mine).toEqual([
      {
        key: `dcs-bindings:${HORNET}`,
        game: 'dcs',
        group: 'files',
        title: 'DCS bindings match devices (F/A-18C)',
        description:
          '11 binding files; warns when Windows has changed a device ID and DCS no longer finds them',
        selectedByDefault: true,
        check: {
          type: BINDINGS_CHECK,
          title: 'DCS bindings match devices (F/A-18C)',
          required: false,
          params: { aircraft: HORNET, aircraftName: 'F/A-18C' },
          remediation: { type: OPEN_MIGRATION, params: {} },
        },
      },
      expect.objectContaining({
        key: `dcs-bindings:${HUEY}`,
        title: 'DCS bindings match devices (UH-1H)',
      }),
    ]);
  });
});

describe('the feature through IPC', () => {
  it('finds DCS through the game module and serves overview, aircraft, edits, undo, roles and marks', async () => {
    await start();
    const overview = await app.invoke<Overview>('dcs-bindings:overview');
    expect(overview).toMatchObject({ found: true, dcsRunning: false, staleDeviceIds: 0 });
    expect(overview.inputDir).toBe(path.join(app.home, 'Saved Games', 'DCS', 'Config', 'Input'));
    expect(overview.installDir).toContain('DCSWorld');
    // The aircraft with the user's bindings first; the Huey gunner positions are profiles too.
    expect(overview.aircraft.map((a) => [a.id, a.name, a.userFiles])).toEqual([
      [HORNET, 'F/A-18C', 11],
      [HUEY, 'UH-1H', 0],
      ['UH-1H_TrackIR_Gunner', 'UH-1H Gunner w Head Tracking', 0],
      ['UH-1H_Gunner', 'UH-1H Gunner w No Head Tracking', 0],
    ]);

    const view = await app.invoke<AircraftView>('dcs-bindings:aircraft', { id: HORNET });
    const stick = view.devices.find((d) => d.name.includes('Orion'))!;
    const center = view.commands.find((c) => c.name === 'View Center')!;
    const ops: BindingOp[] = [
      {
        op: 'unbind',
        aircraft: HORNET,
        deviceId: stick.id,
        commandId: center.id,
        combo: { key: 'JOY_BTN19', reformers: [] },
      },
    ];
    const plan = await app.invoke<ChangePlan>('dcs-bindings:plan', { ops });
    expect(plan.files[0]!.lines).toEqual(['View Center: remove Button 19']);
    const applied = await app.invoke<Applied>('dcs-bindings:apply', { ops });
    let after = await app.invoke<AircraftView>('dcs-bindings:aircraft', { id: HORNET });
    expect(after.problems.actionDuplicates.some((d) => d.commandId === center.id)).toBe(false);
    expect(await app.invoke('dcs-bindings:undo', { groupId: applied.groupId })).toEqual({
      undone: true,
    });
    after = await app.invoke<AircraftView>('dcs-bindings:aircraft', { id: HORNET });
    expect(after.problems.actionDuplicates.find((d) => d.commandId === center.id)).toMatchObject({
      expected: false,
    });

    await app.invoke('dcs-bindings:setExpected', {
      aircraft: HORNET,
      commandId: center.id,
      expected: true,
    });
    const wheel = view.devices.find((d) => d.name.startsWith('FANATEC'))!;
    await app.invoke('dcs-bindings:setRole', {
      name: wheel.name,
      vendorId: wheel.vendorId,
      productId: wheel.productId,
      role: 'other',
    });
    after = await app.invoke<AircraftView>('dcs-bindings:aircraft', { id: HORNET });
    expect(after.problems.actionDuplicates.find((d) => d.commandId === center.id)).toMatchObject({
      expected: true,
    });
    expect(after.problems.unwantedDefaults).toEqual([]);
    await app.invoke('dcs-bindings:setExpected', {
      aircraft: HORNET,
      commandId: center.id,
      expected: false,
    });
    await app.invoke('dcs-bindings:setRole', {
      name: wheel.name,
      vendorId: '0EB7',
      productId: '0007',
      role: 'none',
    });

    // Clean up every aircraft at once.
    const cleanup = await app.invoke<{ ops: BindingOp[]; aircraft: string[] }>(
      'dcs-bindings:cleanupOps',
      { aircraft: [] }
    );
    expect(cleanup.aircraft.sort()).toEqual([HORNET, HUEY]);
    expect(cleanup.ops.length).toBeGreaterThan(50);
    const cleaned = await app.invoke<Applied>('dcs-bindings:apply', {
      ops: cleanup.ops,
      summary: 'Clean up default bindings on every aircraft',
    });
    expect(cleaned.files).toBe(11);
    const none = await app.invoke<{ ops: BindingOp[] }>('dcs-bindings:cleanupOps', {
      aircraft: [],
    });
    expect(none.ops).toEqual([]);
  });

  it('serves copy, snapshots and press-to-pick', async () => {
    await start();
    const view = await app.invoke<AircraftView>('dcs-bindings:aircraft', { id: HORNET });
    const deviceIds = view.devices.filter((d) => d.role === 'stick').map((d) => d.id);
    const preview = await app.invoke<CopyPreview>('dcs-bindings:copyPreview', {
      from: HORNET,
      to: HUEY,
      deviceIds,
    });
    const selected = preview.proposals.filter((p) => p.selected).map((p) => p.id);
    const copy = await app.invoke<{ ops: BindingOp[]; summary: string }>('dcs-bindings:copyOps', {
      from: HORNET,
      to: HUEY,
      deviceIds,
      selected,
    });
    expect(copy.summary).toBe(`Copy ${selected.length} controls from F/A-18C to UH-1H`);
    await app.invoke('dcs-bindings:apply', copy);

    const snapshot = await app.invoke<Snapshot>('dcs-bindings:snapshotCreate', {
      name: 'With the Huey',
      aircraft: [],
    });
    expect(snapshot.folders).toContain(HUEY);
    expect(await app.invoke<Snapshot[]>('dcs-bindings:snapshots')).toHaveLength(1);
    const renamed = await app.invoke<Snapshot>('dcs-bindings:snapshotRename', {
      id: snapshot.id,
      name: 'Both aircraft',
    });
    expect(renamed.name).toBe('Both aircraft');
    await fs.rm(joystickDir(app.home, HUEY), { recursive: true });
    const comparison = await app.invoke<Comparison>('dcs-bindings:snapshotCompare', {
      left: snapshot.id,
    });
    expect(comparison.devices.map((d) => d.folder)).toEqual([HUEY]);
    const restorePlan = await app.invoke<ChangePlan>('dcs-bindings:snapshotRestorePlan', {
      id: snapshot.id,
    });
    expect(restorePlan.files).toHaveLength(1);
    await app.invoke('dcs-bindings:snapshotRestore', { id: snapshot.id });
    expect(await fs.readdir(joystickDir(app.home, HUEY))).toHaveLength(1);
    expect(await app.invoke('dcs-bindings:snapshotDelete', { id: snapshot.id })).toEqual({
      deleted: true,
    });

    // Press-to-pick: presses arrive as events while listening, and stop when told to.
    expect(await app.invoke('dcs-bindings:listenStart')).toEqual({ listening: true });
    const stick = app.ports.state.input.find((d) => d.name.includes('Orion'))!;
    const state = (buttons: number[], hat: [number, number], y: number) => ({
      index: stick.index,
      name: stick.name,
      axes: [0, y, 0, 0, 0, 0],
      buttons: Array.from({ length: 42 }, (_, i) => buttons.includes(i)),
      hats: [hat],
      timestamp: 1,
    });
    app.ports.input.emit([state([], [0, 0], 0)]);
    app.ports.input.emit([state([4], [0, 0], 0)]);
    app.ports.input.emit([state([], [0, 1], 0)]);
    app.ports.input.emit([state([], [0, 0], 0.2)]);
    app.ports.input.emit([state([], [0, 0], -0.8)]);
    app.ports.input.emit([state([], [0, 0], -1)]);
    const pressed = app.events.filter((e) => e.channel === 'dcs-bindings:event:pressed');
    expect(pressed.map((e) => e.payload)).toEqual([
      {
        guid: '806DDF00-B756-11f0-8023-444553540000',
        deviceName: stick.name,
        key: 'JOY_BTN5',
        label: 'Button 5',
        kind: 'button',
      },
      expect.objectContaining({ key: 'JOY_BTN_POV1_U', label: 'Hat 1 up', kind: 'hat' }),
      expect.objectContaining({ key: 'JOY_Y', label: 'Y axis', kind: 'axis' }),
    ]);
    expect(await app.invoke('dcs-bindings:listenStop')).toEqual({ listening: false });
    app.ports.input.emit([state([7], [0, 0], 0)]);
    expect(app.events.filter((e) => e.channel === 'dcs-bindings:event:pressed')).toHaveLength(3);
    expect(fixtureData).toContain('dcs-bindings');
  });
});
