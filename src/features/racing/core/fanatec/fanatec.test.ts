import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { WheelPresets, WheelView } from '../../contract';

describe('the Fanatec wheel', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const runBaseCheck = (a: WiredApp) =>
    a.wiring.context.checks
      .check('racing.wheelBase')!
      .run({ vendorId: '0EB7', productId: '0007' }, a.ctx);

  /** The DD2 as it reports itself in compatibility (yellow) mode. */
  function toYellowMode(a: WiredApp): void {
    for (const d of a.ports.state.devices)
      if (d.vendorId === '0EB7' && d.productId === '0007') d.productId = '0004';
    for (const d of a.ports.state.input)
      if (d.vendorId === '0EB7' && d.productId === '0007') d.productId = '0004';
  }

  it('detects the Podium DD2 by vendor and product id, in PC mode, with its controllers', async () => {
    app = await wiredApp('racing-fresh');
    const outcome = await runBaseCheck(app);
    expect(outcome).toMatchObject({ pass: true, summary: 'Connected in PC mode' });
    expect(outcome.details).toContain('Games see it as one controller.');
    expect(outcome.details!.some((d) => d.includes('Generic USB Hub'))).toBe(true);

    // The base shows up to games twice under one name: expected, not a duplicate.
    app.ports.state.input.push({
      ...app.ports.state.input.find((d) => d.productId === '0007')!,
      index: 12,
      guid: '20B0BED0-03A4-11F1-8002-444553540000',
      numButtons: 63,
    });
    expect((await runBaseCheck(app)).details).toContain(
      'Games see it as 2 controllers with the same name; that is normal for this base.'
    );
  });

  it('warns when the base is in compatibility mode, and says when it is unplugged', async () => {
    app = await wiredApp('racing-fresh');
    toYellowMode(app);
    const yellow = await runBaseCheck(app);
    expect(yellow).toMatchObject({ pass: false, summary: 'In compatibility (yellow) mode' });
    const view = await app.invoke<WheelView>('racing:wheel');
    expect(view.status).toMatchObject({
      connected: true,
      mode: 'compatibility',
      productId: '0004',
    });

    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7' } }]);
    expect(await runBaseCheck(app)).toMatchObject({ pass: false, summary: 'Not connected' });
  });

  it('fails when Windows sees the base but games do not', async () => {
    app = await wiredApp('racing-fresh');
    app.ports.state.input = app.ports.state.input.filter((d) => d.vendorId !== '0EB7');
    expect(await runBaseCheck(app)).toMatchObject({
      pass: false,
      summary: 'Connected, but games cannot see it',
    });
  });

  it('shows the driver, app and service, the shipped firmware and what the driver last saw', async () => {
    app = await wiredApp('racing-fresh');
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({
      connected: true,
      name: 'FANATEC Podium Wheel Base DD2',
      mode: 'pc',
      controllers: 1,
      firmwareShipped: '3.6.1.2',
    });
    expect(status.software).toEqual([
      { label: 'Fanatec driver', value: 'Installed · 0.52.2', ok: true },
      { label: 'Fanatec Wheel Service (FWPnpService)', value: 'Running', ok: true },
      { label: 'Fanatec Service (LEDs, displays, game integration)', value: 'Running', ok: true },
      { label: 'Fanatec App', value: 'Installed · 1.2.1.3', ok: true },
    ]);
    expect(status.lastSeen).toContainEqual({ label: 'Wheel rotation', value: '1080°' });
    expect(status.lastSeen).toContainEqual({
      label: 'Steering wheel (rim) codes',
      value: '13, 17',
    });
  });

  it('keeps the five presets the user records, and never shows base values as matching', async () => {
    app = await wiredApp('racing-fresh');
    const first = await app.invoke<WheelView>('racing:wheel');
    expect(first.presets.presets.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
    const iracing = first.comparisons.find((c) => c.game === 'iracing')!;
    expect(iracing.source.url).toContain('forum.fanatec.com');
    expect(
      iracing.rows
        .filter((r) => r.where === 'base')
        .every((r) => r.status === 'unreadable' && r.current === 'Set on the wheel')
    ).toBe(true);
    expect(iracing.rows.find((r) => r.label === 'Strength')!.current).toBe(
      'Not stored where RigReady can read it'
    );

    const presets: WheelPresets = structuredClone(first.presets);
    presets.presets[1] = {
      slot: 2,
      name: 'BeamNG',
      values: { SEN: '2520', FF: '100' },
      note: 'Formula rim',
    };
    presets.activeSlot = 2;
    await app.invoke('racing:savePresets', presets);
    const again = await app.invoke<WheelView>('racing:wheel');
    expect(again.presets.presets[1]).toMatchObject({
      name: 'BeamNG',
      values: { SEN: '2520', FF: '100' },
    });
    const beamng = again.comparisons.find((c) => c.game === 'beamng')!;
    expect(beamng.rows.find((r) => r.label.startsWith('SEN'))!).toMatchObject({
      current: 'Set on the wheel · your preset 2: 2520',
      status: 'unreadable',
    });
    // BeamNG's steering rotation is in its files: compared with the SEN you recorded.
    expect(beamng.rows.find((r) => r.label === 'Steering rotation')).toMatchObject({
      current: '2520',
      status: 'match',
    });
    expect(beamng.rows.find((r) => r.label === 'Force feedback')).toMatchObject({
      current: 'On',
      status: 'match',
    });
    await expect(
      app.invoke('racing:savePresets', { presets: [], activeSlot: 1 })
    ).rejects.toThrow();
  });

  it('checks the in-game wheel settings it can read against the recommendations', async () => {
    app = await wiredApp('racing-fresh');
    const check = app.wiring.context.checks.check('racing.wheelSettings')!;
    const lmu = await check.run({ game: 'lmu' }, app.ctx);
    expect(lmu).toMatchObject({ pass: true, summary: '3 readable settings as recommended' });
    const comparison = (await app.invoke<WheelView>('racing:wheel')).comparisons.find(
      (c) => c.game === 'lmu'
    )!;
    expect(comparison.rows.find((r) => r.label === 'Smoothing')).toMatchObject({
      current: '0',
      status: 'match',
    });

    // Without a recorded SEN, BeamNG's rotation is shown for reference only; force feedback is on.
    expect(await check.run({ game: 'beamng' }, app.ctx)).toMatchObject({ pass: true });
    await mutate(app, [
      { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/appmanifest_2399420.acf' },
    ]);
    expect(await check.run({ game: 'lmu' }, app.ctx)).toMatchObject({
      pass: false,
      summary: 'The game was not found',
    });
  });
});
