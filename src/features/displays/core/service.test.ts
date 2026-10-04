import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import { markFull, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ApplyPreview, DisplaysView, RecoveryView } from '../contract';

/** The Monitors page's main side, called through IPC exactly as the renderer does. */

let app: WiredApp;
afterEach(async () => {
  // Never leave a countdown timer running into the next test.
  if (app) {
    const pending = await app.invoke<{ pending: boolean }>('displays:pending');
    if (pending.pending) await app.invoke('displays:keep');
    await app.cleanup();
  }
});

const NO_FILES = { files: [] };
const view = () => app.invoke<DisplaysView>('displays:view');
const layout = (v: DisplaysView, name: string) => v.layouts.find((l) => l.name === name)!;
const enabledNames = () =>
  app.ports.state.displays
    .filter((d) => d.enabled)
    .map((d) => d.name)
    .sort();

describe('Monitors page: the current arrangement', () => {
  it('lists every connected monitor with identity, mode, position, rotation and flags', async () => {
    app = await wiredApp('flying-fresh', NO_FILES);
    const v = await view();
    expect(v.monitors).toHaveLength(5);
    const dell = v.monitors.find((m) => m.name === 'DELL G3223D')!;
    expect(dell).toMatchObject({
      enabled: false,
      primary: false,
      identical: false,
      edid: 'DELD139',
    });
    expect(dell.number).toBeUndefined();
    const ultrawide = v.monitors.find((m) => m.name === 'LC49G95T')!;
    expect(ultrawide).toMatchObject({
      label: 'LC49G95T',
      number: 1,
      primary: true,
      width: 5120,
      height: 1440,
      rotation: 0,
      refreshHz: 120,
      gdiName: '\\\\.\\DISPLAY1',
    });
    const mfds = v.monitors.filter((m) => m.name === 'USB_Monitor');
    expect(mfds.map((m) => [m.label, m.number, m.rotation, m.identical])).toEqual([
      ['USB_Monitor (1 of 3)', 2, 90, true],
      ['USB_Monitor (2 of 3)', 3, 90, true],
      ['USB_Monitor (3 of 3)', 4, 90, true],
    ]);
    expect(v.layouts).toEqual([]);
  });

  it('Identify shows each number on its own monitor for five seconds', async () => {
    app = await wiredApp('flying-fresh', NO_FILES);
    expect(await app.invoke('displays:identify')).toEqual({ shown: 4, off: 1 });
    expect(app.ports.overlays.shown).toHaveLength(1);
    const { labels, durationMs } = app.ports.overlays.shown[0]!;
    expect(durationMs).toBe(5000);
    expect(labels.map((l) => [l.text, l.caption, l.x, l.width, l.height])).toEqual([
      ['1', 'LC49G95T', 0, 5120, 1440],
      ['2', 'USB_Monitor (1 of 3)', 5120, 768, 1024],
      ['3', 'USB_Monitor (2 of 3)', 5888, 768, 1024],
      ['4', 'USB_Monitor (3 of 3)', 6656, 768, 1024],
    ]);
    app.ports.overlays.showLabels = async () => err('overlay.show', 'Could not show the labels.');
    await expect(app.invoke('displays:identify')).rejects.toThrow(/overlay\.show/);
    app.ports.state.displays = app.ports.state.displays.map((d) => ({ ...d, enabled: false }));
    await expect(app.invoke('displays:identify')).rejects.toThrow(/No monitor is on/);
  });

  it('names stay with the physical screen when Windows renumbers and the screens trade places', async () => {
    app = await wiredApp('flying-fresh', NO_FILES);
    const first = (await view()).monitors.filter((m) => m.name === 'USB_Monitor');
    await app.invoke('displays:setName', { id: first[0]!.id, name: 'MFD left' });
    await app.invoke('displays:setName', { id: first[1]!.id, name: 'MFD centre' });
    await expect(
      app.invoke('displays:setName', { id: first[2]!.id, name: 'mfd LEFT' })
    ).rejects.toThrow(/already called "MFD left"/);
    // Windows hands out new \\.\DISPLAYn numbers and the first two swap places.
    for (const d of app.ports.state.displays) d.gdiName = '\\\\.\\DISPLAY9';
    app.ports.state.displays.find((d) => d.id === first[0]!.id)!.x = 5888;
    app.ports.state.displays.find((d) => d.id === first[1]!.id)!.x = 5120;
    const after = await view();
    expect(after.monitors.find((m) => m.id === first[0]!.id)).toMatchObject({
      label: 'MFD left',
      friendlyName: 'MFD left',
      number: 3,
    });
    expect(after.monitors.find((m) => m.id === first[1]!.id)).toMatchObject({
      label: 'MFD centre',
      number: 2,
    });
    // Kept in the data folder, so a restart (or reboot) finds them again.
    const onDisk = JSON.parse(
      await fs.readFile(path.join(app.ports.folders.dataRoot(), 'displays', 'names.json'), 'utf8')
    );
    expect(Object.values(onDisk.names)).toEqual(['MFD left', 'MFD centre']);
    // An empty name removes it again.
    const cleared = await app.invoke<DisplaysView>('displays:setName', {
      id: first[0]!.id,
      name: ' ',
    });
    expect(cleared.monitors.find((m) => m.id === first[0]!.id)!.friendlyName).toBeUndefined();
  });
});

describe('Monitors page: saved layouts', () => {
  it('shows each saved layout with whether the monitors match it now', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    const v = await view();
    expect(v.layouts.map((l) => [l.name, l.status])).toEqual([
      ['Flying', 'different'],
      ['Racing', 'incomplete'],
      ['Desk', 'different'],
    ]);
    const racing = layout(v, 'Racing');
    expect(racing.missing).toEqual(['TV']);
    expect(racing.differences).toContain('TV is not connected');
    expect(racing.monitors.find((m) => m.name === 'TV')).toMatchObject({
      connected: false,
      enabled: true,
      x: 640,
      y: -2160,
    });
    // Monitors that are off in a layout get their size from the connected monitor.
    expect(
      layout(v, 'Desk').monitors.find((m) => m.label === 'USB_Monitor (1 of 3)')
    ).toMatchObject({ enabled: false, width: 1024, height: 768 });
  });

  it('applies Flying (Dell off, MFD screens on) and Desk (the reverse), each with the keep prompt', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    expect((await view()).canRevert).toBe(false);
    const preview = await app.invoke<ApplyPreview>('displays:preview', { id: 'flying' });
    expect(preview.missing).toEqual([]);
    expect(preview.changes).toContain('DELL G3223D is on, expected off');
    expect(preview.changes).toContain('USB_Monitor (3 of 3) is rotated 0°, expected 90°');
    expect(await app.invoke('displays:applyLayout', { id: 'flying' })).toEqual({
      message: 'Applied "Flying"',
    });
    expect(enabledNames()).toEqual(['LC49G95T', 'USB_Monitor', 'USB_Monitor', 'USB_Monitor']);
    expect(app.events).toContainEqual({
      channel: 'displays:event:applied',
      payload: { seconds: 15 },
    });
    expect(layout(await view(), 'Flying').status).toBe('current');
    await app.invoke('displays:keep');
    // Kept, and still undoable from the Monitors page.
    expect((await view()).canRevert).toBe(true);

    expect(await app.invoke('displays:applyLayout', { id: 'desk' })).toEqual({
      message: 'Applied "Desk"',
    });
    expect(enabledNames()).toEqual(['DELL G3223D', 'LC49G95T']);
    expect(app.ports.state.displays.find((d) => d.primary)?.name).toBe('DELL G3223D');
    await app.invoke('displays:keep');
    expect(await app.invoke('displays:applyLayout', { id: 'desk' })).toEqual({
      message: 'The monitors already match "Desk". Nothing was changed.',
    });
  });

  it('draws the preview from the monitors as they are, and "after" is where they are once applied', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    const shape = (
      m: { enabled: boolean; primary: boolean; x: number; y: number; rotation: number } & {
        width: number;
        height: number;
      }
    ) =>
      m.enabled
        ? `${m.width}x${m.height} at ${m.x},${m.y} turned ${m.rotation}${m.primary ? ' main' : ''}`
        : 'off';
    const now = () => app!.ports.state.displays.map((d) => shape(d));
    const preview = await app.invoke<ApplyPreview>('displays:preview', { id: 'flying' });
    expect(preview.before.map(shape)).toEqual(now());
    expect(preview.before.map((m) => m.label)).toEqual([
      'DELL G3223D',
      'LC49G95T',
      'USB_Monitor (1 of 3)',
      'USB_Monitor (2 of 3)',
      'USB_Monitor (3 of 3)',
    ]);
    expect(preview.after.map(shape)).toEqual([
      'off',
      '5120x1440 at 0,0 turned 0 main',
      '768x1024 at 5120,0 turned 90',
      '768x1024 at 5888,0 turned 90',
      '768x1024 at 6656,0 turned 90',
    ]);
    // The picture is a promise: this is what the monitors are after applying.
    await app.invoke('displays:applyLayout', { id: 'flying' });
    expect(now()).toEqual(preview.after.map(shape));

    // A monitor that is not connected is in "after" only, marked as absent.
    const racing = await app.invoke<ApplyPreview>('displays:preview', { id: 'racing' });
    expect(racing.before).toHaveLength(5);
    expect(racing.after.filter((m) => !m.connected).map((m) => m.label)).toEqual(['TV']);
    expect(racing.after.find((m) => m.label === 'TV')).toMatchObject({
      enabled: true,
      width: 3840,
      height: 2160,
      y: -2160,
    });
  });

  it('applies a layout whose TV is not connected only when told to go without it', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    const before = structuredClone(app.ports.state.displays);
    const preview = await app.invoke<ApplyPreview>('displays:preview', { id: 'racing' });
    expect(preview).toMatchObject({ missing: ['TV'], problems: [], primaryLabel: 'LC49G95T' });
    await expect(app.invoke('displays:applyLayout', { id: 'racing' })).rejects.toThrow(
      /TV is not connected\. Nothing was changed\./
    );
    expect(app.ports.state.displays).toEqual(before);
    expect(
      await app.invoke('displays:applyLayout', { id: 'racing', withoutMissing: true })
    ).toEqual({ message: 'Applied "Racing" without TV' });
    expect(enabledNames()).toEqual(['LC49G95T']);
  });

  it('creates, renames, edits, updates, sets as desk layout and deletes layouts', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    let v = await app.invoke<DisplaysView>('displays:saveLayout', { name: 'Desk as found' });
    const found = layout(v, 'Desk as found');
    expect(found.status).toBe('current');
    await expect(app.invoke('displays:saveLayout', { name: 'flying' })).rejects.toThrow(
      /already a layout named/
    );
    v = await app.invoke('displays:renameLayout', { id: found.id, name: 'Office' });
    expect(v.layouts.map((l) => l.name)).toContain('Office');

    v = await app.invoke('displays:setDeskLayout', { id: found.id });
    expect(v.deskLayoutId).toBe(found.id);
    expect(layout(v, 'Office').isDesk).toBe(true);
    await expect(app.invoke('displays:setDeskLayout', { id: 'nope' })).rejects.toThrow();

    // Edit: rotate the first MFD screen in the saved layout.
    const stored = JSON.parse(
      await fs.readFile(path.join(app.ports.folders.dataRoot(), 'displays', 'layouts.json'), 'utf8')
    ).layouts.find((l: { id: string }) => l.id === found.id).displays;
    const edited = stored.map((d: { name: string; x: number }) =>
      d.name === 'USB_Monitor' && d.x === 9728
        ? { ...d, rotation: 90, width: 768, height: 1024 }
        : d
    );
    v = await app.invoke('displays:editLayout', { id: found.id, displays: edited });
    expect(layout(v, 'Office').status).toBe('different');
    expect(layout(v, 'Office').differences).toEqual([
      'USB_Monitor (3 of 3) is rotated 0°, expected 90°',
      'USB_Monitor (3 of 3) is 1024x768, expected 768x1024',
    ]);
    // Refused edits say why.
    const overlapping = stored.map((d: { name: string }) =>
      d.name === 'LC49G95T' ? { ...d, x: 0 } : d
    );
    await expect(
      app.invoke('displays:editLayout', { id: found.id, displays: overlapping })
    ).rejects.toThrow(/overlap/);
    const noMain = stored.map((d: object) => ({ ...d, primary: false }));
    await expect(
      app.invoke('displays:editLayout', { id: found.id, displays: noMain })
    ).rejects.toThrow(/exactly one main display/);
    const allOff = stored.map((d: object) => ({ ...d, enabled: false }));
    await expect(
      app.invoke('displays:editLayout', { id: found.id, displays: allOff })
    ).rejects.toThrow(/At least one monitor/);
    await expect(
      app.invoke('displays:editLayout', { id: found.id, displays: stored.slice(1) })
    ).rejects.toThrow(/same monitors/);

    // Update from the monitors as they are: back to "current", the TV of Racing is kept.
    v = await app.invoke('displays:updateLayout', { id: found.id });
    expect(layout(v, 'Office').status).toBe('current');
    await app.invoke('displays:applyLayout', { id: 'flying' });
    await app.invoke('displays:keep');
    v = await app.invoke('displays:updateLayout', { id: 'racing' });
    expect(layout(v, 'Racing').monitors.map((m) => m.name)).toContain('TV');
    expect(layout(v, 'Racing').status).toBe('incomplete');

    // Deleting the desk layout also clears the Stand down setting.
    v = await app.invoke('displays:removeLayout', { id: found.id });
    expect(v.layouts.map((l) => l.name)).not.toContain('Office');
    expect(v.deskLayoutId).toBeUndefined();
    v = await app.invoke('displays:setDeskLayout', { id: 'desk' });
    v = await app.invoke('displays:setDeskLayout', { id: null });
    expect(v.deskLayoutId).toBeUndefined();
  });

  it('reports a damaged layouts file without losing the monitor list', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    await fs.writeFile(
      path.join(app.ports.folders.dataRoot(), 'displays', 'layouts.json'),
      '{ not json'
    );
    const v = await view();
    expect(v.monitors).toHaveLength(5);
    expect(v.layoutsError).toMatch(/not valid/);
  });
});

describe('a layout change RigReady never got an answer for', () => {
  it('offers the layout from before it after a restart, and puts it back', async () => {
    app = await wiredApp('displays-recovery', NO_FILES);
    const offer = await app.invoke<RecoveryView | null>('displays:recovery');
    expect(offer?.savedAt).toBe('2026-10-03T11:58:00.000Z');
    expect(offer?.lines).toContain('DELL G3223D: 2560x1440 at 0,0, main');
    expect(await app.invoke('displays:recover', { restore: true })).toEqual({
      message: 'Put back the earlier layout',
    });
    expect(app.ports.state.displays.find((d) => d.primary)?.name).toBe('DELL G3223D');
    // That too waits for Keep; once kept there is nothing left to offer.
    expect(await app.invoke('displays:pending')).toMatchObject({ pending: true });
    await app.invoke('displays:keep');
    await expect.poll(() => app.invoke('displays:recovery')).toBeNull();
    await expect(app.invoke('displays:recover', { restore: true })).rejects.toThrow(
      /no earlier layout/
    );
  });

  it('can be dismissed, and is not offered when the monitors already are as they were', async () => {
    app = await wiredApp('displays-recovery', NO_FILES);
    expect(await app.invoke('displays:recover', { restore: false })).toEqual({
      message: 'Kept the monitors as they are.',
    });
    expect(await app.invoke('displays:recovery')).toBeNull();
    await app.cleanup();

    app = await wiredApp('displays-recovery', NO_FILES);
    // The desk state is what the file holds: nothing to put back.
    app.ports.state.displays = (await markFull()).displays;
    expect(await app.invoke('displays:recovery')).toBeNull();
  });

  it('is written before every change and removed once the change is kept or reverted', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    const file = path.join(app.ports.folders.dataRoot(), 'displays', 'pending-revert.json');
    await app.invoke('displays:applyLayout', { id: 'flying' });
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.displays.find((d: { name: string }) => d.name === 'DELL G3223D').enabled).toBe(
      true
    );
    await app.invoke('displays:revert');
    await expect
      .poll(() =>
        fs.access(file).then(
          () => true,
          () => false
        )
      )
      .toBe(false);
    expect(app.ports.state.displays.find((d) => d.primary)?.name).toBe('DELL G3223D');
  });

  it('is never asked about a change this run made itself: that one has the countdown', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    // The question stays open until this test answers it.
    app.layoutAnswer = 'wait';
    const file = path.join(app.ports.folders.dataRoot(), 'displays', 'pending-revert.json');
    const there = (): Promise<boolean> =>
      fs.access(file).then(
        () => true,
        () => false
      );
    // A start with --launch is here while the window still asks whether anything was left
    // behind: the file exists and the monitors are not as it says, which is exactly what an
    // earlier run would have left.
    await app.invoke('displays:applyLayout', { id: 'flying' });
    expect(await there()).toBe(true);
    expect(await app.invoke('displays:pending')).toMatchObject({ pending: true });
    expect(await app.invoke('displays:recovery')).toBeNull();
    await expect(app.invoke('displays:recover', { restore: true })).rejects.toThrow(
      /no earlier layout/
    );
    await expect(app.invoke('displays:recover', { restore: false })).rejects.toThrow(
      /no earlier layout/
    );
    // Asking took nothing away: the countdown still has its way back after a crash.
    expect(await there()).toBe(true);
    expect(await app.invoke('displays:pending')).toMatchObject({ pending: true });
    await app.invoke('displays:keep');
    await expect.poll(there).toBe(false);
    expect(await app.invoke('displays:recovery')).toBeNull();
  });
});
