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
