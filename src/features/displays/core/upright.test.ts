import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChecklistReport } from '../../../core/checks/engine';
import type { Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { DisplaysView } from '../contract';

/** "Which way is up?", monitor identity on the page, and saving a captured arrangement by name. */

let app: WiredApp;
afterEach(() => app?.cleanup());

const NO_FILES = { files: [] };
const view = () => app.invoke<DisplaysView>('displays:view');
const mfds = (v: DisplaysView) => v.monitors.filter((m) => m.name === 'USB_Monitor');
const layouts = async (): Promise<
  { id: string; name: string; displays: { id: string; rotation: number; enabled: boolean }[] }[]
> =>
  JSON.parse(
    await fs.readFile(path.join(app.ports.folders.dataRoot(), 'displays', 'layouts.json'), 'utf8')
  ).layouts;

describe('which way is up?', () => {
  it('Identify draws an arrow on every screen, and the answer is remembered per monitor and rotation', async () => {
    app = await wiredApp('flying-all-good', NO_FILES);
    await app.invoke('displays:identify');
    const shown = app.ports.overlays.shown.at(-1)!;
    expect(shown.labels).toHaveLength(4);
    expect(shown.labels.every((l) => l.up === true)).toBe(true);
    expect((await view()).monitors.some((m) => m.uprightConfirmed)).toBe(false);

    const confirmed = await app.invoke<DisplaysView>('displays:confirmUpright');
    expect(confirmed.monitors.filter((m) => m.enabled).every((m) => m.uprightConfirmed)).toBe(true);
    // A monitor that is off cannot have been looked at.
    expect(confirmed.monitors.find((m) => !m.enabled)?.uprightConfirmed).toBe(false);
    // Turned another way, it has to be looked at again.
    await mutate(app, [
      { op: 'setDisplay', match: { name: 'USB_Monitor', index: 0 }, set: { rotation: 270 } },
    ]);
    expect(mfds(await view()).map((m) => m.uprightConfirmed)).toEqual([false, true, true]);
  });

  it('turning a screen the other way up waits for Keep, then corrects every saved layout that had it the old way', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    // Fly in the saved Flying layout first.
    await app.invoke('displays:applyLayout', { id: 'flying' });
    const before = await view();
    const left = mfds(before)[0]!;
    expect(left.rotation).toBe(90);

    const flipped = await app.invoke<{ kept: boolean; layoutsUpdated: number; message: string }>(
      'displays:flip',
      { id: left.id }
    );
    expect(flipped).toEqual({
      kept: true,
      layoutsUpdated: 1,
      message: 'Turned USB_Monitor (1 of 3) the other way up and corrected it in 1 saved layout.',
    });
    expect(mfds(await view()).map((m) => [m.rotation, m.width, m.height])).toEqual([
      [270, 768, 1024],
      [90, 768, 1024],
      [90, 768, 1024],
    ]);
    // "Flying" has it at 270 now; "Racing" and "Desk" have that screen off and are untouched.
    const saved = await layouts();
    const rotationIn = (name: string) =>
      saved.find((l) => l.name === name)!.displays.find((d) => d.id === left.id)!.rotation;
    expect(rotationIn('Flying')).toBe(270);
    expect(rotationIn('Racing')).toBe(0);
    expect(layoutStatus(await view(), 'Flying')).toBe('current');
    // Having kept it is the user's answer for this screen.
    expect(mfds(await view())[0]!.uprightConfirmed).toBe(true);
  });

  it('going back leaves the screen and the saved layouts as they were', async () => {
    app = await wiredApp('displays-layouts', NO_FILES);
    await app.invoke('displays:applyLayout', { id: 'flying' });
    const left = mfds(await view())[0]!;
    const savedBefore = await layouts();
    app.layoutAnswer = 'revert';
    expect(await app.invoke('displays:flip', { id: left.id })).toEqual({
      kept: false,
      layoutsUpdated: 0,
      message: 'USB_Monitor (1 of 3) is back the way it was. Nothing was changed.',
    });
    expect(mfds(await view())[0]!.rotation).toBe(90);
    expect(await layouts()).toEqual(savedBefore);
    // A monitor that is off cannot be turned.
    const off = (await view()).monitors.find((m) => !m.enabled)!;
    await expect(app.invoke('displays:flip', { id: off.id })).rejects.toThrow(
      /off or not connected/
    );
  });
});

const layoutStatus = (v: DisplaysView, name: string): string =>
  v.layouts.find((l) => l.name === name)!.status;

describe('identity on the Monitors page', () => {
  it('shows connector and serials, and says how identical screens are told apart', async () => {
    app = await wiredApp('flying-all-good', NO_FILES);
    const v = await view();
    expect(v.monitors.find((m) => m.name === 'LC49G95T')).toMatchObject({
      connector: 'DisplayPort',
      serial: 'H4ZR900542',
      identical: false,
    });
    expect(v.monitors.find((m) => m.name === 'DELL G3223D')).toMatchObject({
      enabled: false,
      connector: 'DisplayPort',
      serial: '12NFXG3',
    });
    expect(mfds(v).map((m) => [m.connector, m.serial, m.usbSerial, m.toldApartBy])).toEqual([
      ['USB', '1', 'WWIN29320221210163532', 'serial'],
      ['USB', '1', 'WWIN29320221210092611', 'serial'],
      ['USB', '1', 'WWIN29320221210093818', 'serial'],
    ]);
    // Without the USB serials only the port is left to go by.
    for (const d of app.ports.state.displays) delete d.usbSerial;
    expect(mfds(await view()).map((m) => m.toldApartBy)).toEqual(['port', 'port', 'port']);
  });

  it('a setup still passes after the three USB screens are moved to other USB ports', async () => {
    app = await wiredApp('flying-fresh', NO_FILES);
    const captured = await app.invoke<{
      candidates: { key: string; check: Profile['checks'][number] }[];
    }>('profiles:capture');
    const monitor = captured.candidates.find((c) => c.key === 'displays:layout')!;
    const created = await app.invoke<Profile>('profiles:create', {
      name: 'Flying',
      checks: [monitor.check],
    });
    const check = () => app.invoke<ChecklistReport>('fly:check', { profileId: created.id });
    expect((await check()).ready).toBe(true);

    // Every screen on another port: new ids, and the first id now belongs to another screen.
    const usb = app.ports.state.displays.filter((d) => d.name === 'USB_Monitor');
    const firstId = usb[0]!.id;
    usb[0]!.id = firstId.replace('2c1ac5a9', '11111111');
    usb[1]!.id = usb[1]!.id.replace('270816bc', '22222222');
    usb[2]!.id = firstId;
    expect((await check()).results[0]).toMatchObject({ status: 'pass' });

    // Two of them swap places on the desktop: both are named, by what follows the screen.
    const [a, b] = [usb[0]!.x, usb[1]!.x];
    usb[0]!.x = b;
    usb[1]!.x = a;
    const swapped = (await check()).results[0]!;
    expect(swapped.status).toBe('fail');
    expect(swapped.details).toEqual([
      'USB_Monitor (1 of 3) is at 5888,0, expected 5120,0',
      'USB_Monitor (2 of 3) is at 5120,0, expected 5888,0',
    ]);
  });
});

describe('capture: saving the arrangement as a named layout', () => {
  it('asks for a name only when the arrangement is not a saved layout, and the setup then refers to the layout', async () => {
    app = await wiredApp('flying-fresh', NO_FILES);
    const capture = async () =>
      (
        await app.invoke<{
          candidates: {
            key: string;
            title: string;
            ask?: { param: string; label: string };
            check: Profile['checks'][number];
          }[];
        }>('profiles:capture')
      ).candidates.find((c) => c.key === 'displays:layout')!;
    const candidate = await capture();
    expect(candidate.ask).toMatchObject({
      param: 'saveAs',
      label: 'Save this arrangement as a layout named',
    });

    const created = await app.invoke<Profile>('profiles:create', {
      name: 'DCS F/A-18C',
      checks: [{ ...candidate.check, params: { ...candidate.check.params, saveAs: ' Flying ' } }],
    });
    const item = created.checks[0]!;
    expect(item.title).toBe('Monitor layout: Flying');
    expect(item.params).toMatchObject({ layoutId: 'flying', layoutName: 'Flying' });
    expect(item.params['saveAs']).toBeUndefined();
    expect(item.remediation?.params).toEqual(item.params);
    expect((await layouts()).map((l) => [l.id, l.name, l.displays.length])).toEqual([
      ['flying', 'Flying', 5],
    ]);
    // Saved with what finds each USB screen again on another port.
    const stored = (await layouts())[0]!.displays as { usbSerial?: string }[];
    expect(stored.filter((d) => d.usbSerial).length).toBe(3);
    expect(layoutStatus(await view(), 'Flying')).toBe('current');

    // The same arrangement is a saved layout now: no question, it is referred to by name.
    const again = await capture();
    expect(again.ask).toBeUndefined();
    expect(again.title).toBe('Monitor layout: Flying');

    // Without a name nothing is saved and the answer field leaves no trace.
    const plain = await app.invoke<Profile>('profiles:create', {
      name: 'Other',
      checks: [{ ...candidate.check, params: { ...candidate.check.params, saveAs: '  ' } }],
    });
    expect(plain.checks[0]!.params['saveAs']).toBeUndefined();
    expect(plain.checks[0]!.params['layoutId']).toBeUndefined();
    expect(await layouts()).toHaveLength(1);

    // A name that is taken stops the creation with a message, and no setup is left behind.
    await expect(
      app.invoke('profiles:create', {
        name: 'Third',
        checks: [{ ...candidate.check, params: { ...candidate.check.params, saveAs: 'flying' } }],
      })
    ).rejects.toThrow(/already a layout named "flying"/);
    const all = await app.invoke<{ profiles: { name: string }[] }>('fly:state');
    expect(all.profiles.map((p) => p.name).sort()).toEqual(['DCS F/A-18C', 'Other']);
  });
});
