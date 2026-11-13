import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../tests/helpers';
import type { VcState } from './contract';
import type { Running } from './core/running';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

describe('virtual controller feature', () => {
  it('says what is installed and lists the starting points, the user profiles and the controllers', async () => {
    app = await wiredApp('virtual-controller-ready');
    const state = await app.invoke<VcState>('virtual-controller:state');
    expect(state.driver).toMatchObject({ installed: true, running: true, state: 'running' });
    expect(state.hidHide.installed).toBe(true);
    expect(state.running).toBeUndefined();
    expect(state.profiles.builtin.map((p) => p.mapped)).toEqual([0, 0, 0]);
    expect(state.profiles.mine).toEqual([
      expect.objectContaining({
        id: 'my-ace-combat-stick',
        mapped: 8,
        missing: [],
        builtin: false,
      }),
    ]);
    expect(state.controllers.map((c) => c.name)).toContain('T-Pendular-Rudder');
    expect(await app.invoke('virtual-controller:running')).toEqual({
      running: null,
      profiles: [{ id: 'my-ace-combat-stick', name: 'My Ace Combat stick' }],
    });
  });

  it('a PC without the driver is told so, and the driver check fails with instructions', async () => {
    app = await wiredApp('virtual-controller-no-driver');
    const state = await app.invoke<VcState>('virtual-controller:state');
    expect(state.driver).toMatchObject({ installed: false, running: false });
    expect(state.driver.downloadUrl).toBe('https://github.com/nefarius/ViGEmBus/releases/latest');
    expect(state.hidHide.installed).toBe(false);
    const check = app.wiring.context.checks.check('virtual-controller.driver')!;
    const outcome = await check.run({}, { ports: app.ports, log: app.ctx.log });
    expect(outcome).toMatchObject({ pass: false, summary: 'The ViGEmBus driver is not installed' });
    const fix = app.wiring.context.checks.remediation('virtual-controller.installDriver')!;
    expect(fix.kind).toBe('instructions');
    expect(fix.instructions!({})).toContain('RigReady never installs drivers');
  });

  it('a setup starts it before launch with the real controllers hidden, and Stand down stops it and shows them again', async () => {
    app = await wiredApp('virtual-controller-ready');
    const hidHideBefore = structuredClone(app.ports.state.hidHide);
    const launched = await app.invoke<{ outcome: string; steps: { message: string }[] }>(
      'fly:launch',
      { profileId: 'virtual-controller-ace-combat' }
    );
    expect(launched.outcome).toBe('launched');
    expect(launched.steps.map((s) => s.message)).toContain(
      'Virtual controller on: My Ace Combat stick (Xbox 360 controller); hidden from games: WINWING Orion Joystick Base 2 + JGRIP-F16, T-Pendular-Rudder, WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R'
    );
    expect(app.ports.processes.started.map((t) => t.exe)).toContainEqual(
      expect.stringMatching(/ACE COMBAT 8\\Game\\Binaries\\Win64\\AceCombat8\.exe$/)
    );
    const running = await app.invoke<{ running: Running | null }>('virtual-controller:running');
    expect(running.running).toMatchObject({ by: 'setup', setup: 'ACE COMBAT 8' });
    expect(app.ports.state.hidHide.cloak).toBe(true);
    expect(
      app.events.some(
        (e) =>
          e.channel === 'virtual-controller:event:changed' &&
          (e.payload as { running?: Running }).running?.profileId === 'my-ace-combat-stick'
      )
    ).toBe(true);

    const stood = await app.invoke<{ headline: string; steps: { message: string }[] }>(
      'fly:standDown',
      { profileId: 'virtual-controller-ace-combat' }
    );
    expect(stood.steps.map((s) => s.message).join(' ')).toContain(
      'Virtual controller off (My Ace Combat stick). Showed'
    );
    expect(app.ports.pads.calls).toEqual(['plug xbox360', 'unplug']);
    expect(app.ports.state.hidHide).toEqual(hidHideBefore);
  });

  it('one started by hand stays at Stand down, and stops when RigReady quits', async () => {
    app = await wiredApp('virtual-controller-ready');
    await app.invoke('virtual-controller:start', { id: 'my-ace-combat-stick', hide: false });
    await app.invoke('fly:standDown', { profileId: 'virtual-controller-ace-combat' });
    expect((await app.ports.pads.status()).ok && (await app.ports.pads.status())).toMatchObject({
      value: { plugged: true, label: 'My Ace Combat stick' },
    });
    for (const feature of app.wiring.features) await feature.dispose?.();
    expect((await app.ports.pads.status()).ok && (await app.ports.pads.status())).toMatchObject({
      value: { plugged: false },
    });
  });

  it('refuses to save over a starting point or delete one that runs; copies, saves and deletes the rest', async () => {
    app = await wiredApp('virtual-controller-ready');
    const copy = await app.invoke<{ id: string; name: string }>('virtual-controller:copy', {
      from: 'starting-wheel-pedals',
      name: 'Wheel for PCSX2',
    });
    expect(copy.id).toBe('wheel-for-pcsx2');
    const profile = await app.invoke<Record<string, unknown>>('virtual-controller:profile', {
      id: 'starting-wheel-pedals',
    });
    await expect(app.invoke('virtual-controller:save', { profile })).rejects.toThrow('vc.builtin');
    await app.invoke('virtual-controller:start', { id: 'my-ace-combat-stick', hide: false });
    await expect(
      app.invoke('virtual-controller:remove', { id: 'my-ace-combat-stick' })
    ).rejects.toThrow('vc.inUse');
    expect(await app.invoke('virtual-controller:remove', { id: 'wheel-for-pcsx2' })).toEqual({
      removed: true,
    });
    expect(await app.invoke('virtual-controller:stop')).toEqual({
      message: 'Virtual controller off (My Ace Combat stick)',
    });
    expect(await app.invoke('virtual-controller:stop')).toEqual({ message: null });
  });

  it('says which setups start each profile, and which profiles share a name', async () => {
    app = await wiredApp('virtual-controller-ready');
    const ready = await app.invoke<VcState>('virtual-controller:state');
    expect(ready.setupsNote).toBeUndefined();
    expect(ready.profiles.mine[0]).toMatchObject({
      id: 'my-ace-combat-stick',
      sameName: false,
      usedBy: [{ id: 'virtual-controller-ace-combat', name: 'ACE COMBAT 8' }],
    });
    // Only the starting point named for a game says so; no setup can start a starting point.
    expect(ready.profiles.builtin.map((p) => [p.game, p.sameName, p.usedBy])).toEqual([
      ['Ace Combat 8', false, []],
      [undefined, false, []],
      [undefined, false, []],
    ]);
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();

    // Two profiles of one name, from before names had to differ: told apart by id.
    app = await wiredApp('virtual-controller-same-names');
    const state = await app.invoke<VcState>('virtual-controller:state');
    expect(
      state.profiles.mine.map(({ id, name, sameName, usedBy, game }) => ({
        id,
        name,
        sameName,
        usedBy,
        game,
      }))
    ).toEqual([
      {
        id: 'my-flight-stick-to-gamepad',
        name: 'My flight stick to gamepad',
        sameName: true,
        usedBy: [],
        game: 'Ace Combat 8',
      },
      {
        id: 'my-flight-stick-to-gamepad-2',
        name: 'My flight stick to gamepad',
        sameName: true,
        usedBy: [{ id: 'virtual-controller-same-names', name: 'Ace Combat 8' }],
        game: 'Ace Combat 8',
      },
      {
        id: 'my-space-stick',
        name: 'My space stick',
        sameName: false,
        usedBy: [],
        game: undefined,
      },
    ]);
    // Where only a name fits (the tray menu), the two carry their ids.
    expect(await app.invoke('virtual-controller:running')).toEqual({
      running: null,
      profiles: [
        {
          id: 'my-flight-stick-to-gamepad',
          name: 'My flight stick to gamepad (my-flight-stick-to-gamepad)',
        },
        {
          id: 'my-flight-stick-to-gamepad-2',
          name: 'My flight stick to gamepad (my-flight-stick-to-gamepad-2)',
        },
        { id: 'my-space-stick', name: 'My space stick' },
      ],
    });
  });

  it('does not delete a profile a setup starts until it is told to all the same', async () => {
    app = await wiredApp('virtual-controller-same-names');
    const ids = async (): Promise<string[]> =>
      (await app!.invoke<VcState>('virtual-controller:state')).profiles.mine.map((p) => p.id);

    // The one the setup starts: refused, with the setup named and what breaks.
    await expect(
      app.invoke('virtual-controller:remove', { id: 'my-flight-stick-to-gamepad-2' })
    ).rejects.toThrow(
      'vc.usedBySetups The setup "Ace Combat 8" starts this profile (my-flight-stick-to-gamepad-2). Deleting it breaks that step: the game would start without a virtual controller. virtual-controller-same-names'
    );
    expect(await ids()).toContain('my-flight-stick-to-gamepad-2');

    // Its twin, which no setup uses, goes without more; then no two share a name.
    expect(
      await app.invoke('virtual-controller:remove', { id: 'my-flight-stick-to-gamepad' })
    ).toEqual({ removed: true });
    const after = await app.invoke<VcState>('virtual-controller:state');
    expect(after.profiles.mine.map((p) => [p.id, p.sameName])).toEqual([
      ['my-flight-stick-to-gamepad-2', false],
      ['my-space-stick', false],
    ]);

    // Told to: deleted. The setup itself is left as it is.
    expect(
      await app.invoke('virtual-controller:remove', {
        id: 'my-flight-stick-to-gamepad-2',
        evenIfUsed: true,
      })
    ).toEqual({ removed: true });
    expect(await ids()).toEqual(['my-space-stick']);
    const setups = await app.wiring.context.profiles.list();
    expect(setups.ok && setups.value.map((s) => s.id)).toEqual(['virtual-controller-same-names']);
    // Never "removed" for something that was not there.
    expect(
      await app.invoke('virtual-controller:remove', { id: 'my-flight-stick-to-gamepad-2' })
    ).toEqual({ removed: false });
  });

  it('when a setup file cannot be read it says so, and a delete then needs the same yes', async () => {
    app = await wiredApp('virtual-controller-same-names');
    const broken = path.join(app.ports.folders.dataRoot(), 'profiles', 'broken.yaml');
    const written = await app.ports.files.write(broken, 'id: [broken', {
      reason: 'A setup file that cannot be read',
    });
    expect(written.ok).toBe(true);
    const state = await app.invoke<VcState>('virtual-controller:state');
    expect(state.setupsNote).toBe(
      'One setup file could not be read, so a setup that uses a profile may be missing here.'
    );
    await expect(app.invoke('virtual-controller:remove', { id: 'my-space-stick' })).rejects.toThrow(
      'vc.setupsUnread One setup file could not be read'
    );
    expect(
      await app.invoke('virtual-controller:remove', { id: 'my-space-stick', evenIfUsed: true })
    ).toEqual({ removed: true });
  });

  it('names a copy for what it was copied from, and never as another profile is named', async () => {
    app = await wiredApp('virtual-controller-ready');
    const copy = (from: string, name?: string): Promise<{ id: string; name: string }> =>
      app!.invoke('virtual-controller:copy', { from, ...(name ? { name } : {}) });
    expect(await copy('starting-flight-stick-ace-combat')).toMatchObject({
      id: 'my-ace-combat-8-stick',
      name: 'My Ace Combat 8 stick',
      game: 'Ace Combat 8',
    });
    // The same press again: a second copy, numbered.
    expect(await copy('starting-flight-stick-ace-combat')).toMatchObject({
      id: 'my-ace-combat-8-stick-2',
      name: 'My Ace Combat 8 stick 2',
    });
    expect(await copy('starting-hotas')).toMatchObject({ id: 'my-hotas', name: 'My HOTAS' });
    expect(await copy('my-hotas')).toMatchObject({ name: 'Copy of My HOTAS' });
    // A name that is asked for and taken is numbered too.
    expect(await copy('starting-hotas', 'My Ace Combat stick')).toMatchObject({
      id: 'my-ace-combat-stick-2',
      name: 'My Ace Combat stick 2',
    });

    // A rename onto another profile's name is refused, and nothing is saved.
    const mine = await app.invoke<Record<string, unknown>>('virtual-controller:profile', {
      id: 'my-hotas',
    });
    await expect(
      app.invoke('virtual-controller:save', { profile: { ...mine, name: 'My Ace Combat stick' } })
    ).rejects.toThrow(
      'vc.nameTaken Another profile is already called "My Ace Combat stick". Give this one a different name.'
    );
    expect(
      await app.invoke<{ name: string }>('virtual-controller:profile', { id: 'my-hotas' })
    ).toMatchObject({ name: 'My HOTAS' });
    expect(
      await app.invoke('virtual-controller:save', { profile: { ...mine, name: 'Space HOTAS' } })
    ).toMatchObject({ id: 'my-hotas', name: 'Space HOTAS' });
    // Every profile's name is its own now.
    const state = await app.invoke<VcState>('virtual-controller:state');
    expect(state.profiles.mine.every((p) => !p.sameName)).toBe(true);
  });

  it('sends the live view of the running virtual controller: what the game is being sent', async () => {
    app = await wiredApp('virtual-controller-ready');
    const stick = app.ports.input.devices().find((d) => d.productId === 'BEA8')!;
    const at = (axes: number[], buttons: boolean[] = []): void =>
      app!.ports.input.emit([
        { index: stick.index, name: stick.name, axes, buttons, hats: [[0, 0]], timestamp: 0 },
      ]);
    const lastLive = (): unknown =>
      app!.events.filter((e) => e.channel === 'virtual-controller:event:live').at(-1)?.payload;

    // Nothing runs and no profile is handed in: there is nothing to show, and nothing is sent.
    expect(await app.invoke('virtual-controller:live', { on: true })).toEqual({ watching: true });
    at([0.5, 0, 0, 0, 0, 0]);
    await new Promise((r) => setTimeout(r, 80));
    expect(lastLive()).toBeUndefined();

    await app.invoke('virtual-controller:start', { id: 'my-ace-combat-stick', hide: false });
    expect(await app.invoke('virtual-controller:live', { on: true })).toEqual({ watching: true });
    at([0.5, 0, 0, 0, 0, 0], [true]);
    await expect.poll(lastLive).toMatchObject({
      plugged: true,
      // Button 1 of the stick is A in this profile.
      report: { lx: expect.closeTo(0.4845, 3), buttons: 0x1000 },
    });
    expect(await app.invoke('virtual-controller:live', { on: false })).toEqual({ watching: false });
    await app.invoke('virtual-controller:stop');
  });

  it('detects the control the user moves, and sends the live view for an edited profile', async () => {
    app = await wiredApp('virtual-controller-ready');
    const stick = app.ports.input.devices().find((d) => d.productId === 'BEA8')!;
    const waiting = app.invoke<{ press: unknown }>('virtual-controller:detect', { seconds: 5 });
    await new Promise((r) => setTimeout(r, 20));
    const at = (axes: number[]): void =>
      app!.ports.input.emit([
        { index: stick.index, name: stick.name, axes, buttons: [], hats: [[0, 0]], timestamp: 0 },
      ]);
    at([0, 0, 0, 0, 0, 0]);
    at([0, 0.9, 0, 0, 0, 0]);
    expect(await waiting).toEqual({
      press: { device: { name: stick.name, guid: stick.guid }, input: 'JOY_Y', kind: 'axis' },
    });

    const profile = await app.invoke('virtual-controller:profile', { id: 'my-ace-combat-stick' });
    expect(await app.invoke('virtual-controller:live', { on: true, profile })).toEqual({
      watching: true,
    });
    at([0.5, 0, 0, 0, 0, 0]);
    await expect
      .poll(
        () =>
          app!.events.filter((e) => e.channel === 'virtual-controller:event:live').at(-1)?.payload
      )
      .toMatchObject({ plugged: false, report: { lx: expect.closeTo(0.4845, 3) } });
    expect(await app.invoke('virtual-controller:live', { on: false })).toEqual({ watching: false });
  });
});
