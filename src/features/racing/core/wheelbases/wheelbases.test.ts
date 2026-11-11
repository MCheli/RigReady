import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { BindingBackup, WheelView } from '../../contract';
import { axisName } from '../devices';
import { WHEEL_BRAND_LIST } from './brands';
import { WHEEL_PRODUCTS } from './products';

/**
 * Every brand but Fanatec is tested here on synthetic fixtures only
 * (fixtures/scenarios/wheel-*.yaml): nobody has run RigReady on a real Moza, Logitech,
 * Simagic or Thrustmaster wheel yet, and the page says so.
 */

interface Candidate {
  key: string;
  title: string;
  selectedByDefault: boolean;
  check: {
    type: string;
    params: Record<string, unknown>;
    remediation?: { type: string; params: Record<string, unknown> };
  };
}

const plug = (vendorId: string, productId: string, name: string, guid: string) => ({
  op: 'plugDevice' as const,
  device: {
    instanceId: `USB\\VID_${vendorId}&PID_${productId}\\7&1c2d3e4f&0&5`,
    vendorId,
    productId,
    name,
    isHid: true,
    isGameController: true,
    isHub: false,
    hubChain: [{ instanceId: 'USB\\ROOT_HUB30\\4&1f2e3d4c&0&0', name: 'USB Root Hub (USB 3.0)' }],
  },
  controller: {
    name,
    guid,
    productGuid: `${productId}${vendorId}-0000-0000-0000-504944564944`,
    vendorId,
    productId,
    numAxes: 2,
    numButtons: 10,
    numHats: 0,
    axisNames: ['X', 'Y'],
  },
});

describe('wheel bases of every brand', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const baseCheck = (a: WiredApp, vendorId: string, productId: string) =>
    a.wiring.context.checks.check('racing.wheelBase')!.run({ vendorId, productId }, a.ctx);
  const capture = async (a: WiredApp): Promise<Map<string, Candidate>> => {
    const { candidates } = await a.invoke<{ candidates: Candidate[] }>('profiles:capture');
    return new Map(candidates.filter((c) => c.key.startsWith('racing:')).map((c) => [c.key, c]));
  };

  it('the brand table is consistent: every product has a brand with a row, every brand but Fanatec is unverified', () => {
    const brands = new Set(WHEEL_BRAND_LIST.map((b) => b.id));
    for (const [id, product] of Object.entries(WHEEL_PRODUCTS)) {
      expect(id).toMatch(/^[0-9A-F]{4}:[0-9A-F]{4}$/);
      expect(brands.has(product.brand as never)).toBe(true);
    }
    expect(WHEEL_BRAND_LIST.filter((b) => b.verifiedOnHardware).map((b) => b.id)).toEqual([
      'fanatec',
    ]);
    // Fanatec's axes are sourced; no other brand publishes its axes, so they keep generic names.
    expect(axisName('S0', '0EB7', '0007')).toBe('Clutch');
    expect(axisName('S0', '346E', '0002')).toBe('Slider 1');
  });

  it('Moza R9: detected by its USB id, Pit House running, mode not claimed, linked settings, a fix that starts Pit House', async () => {
    app = await wiredApp('wheel-moza-r9', { files: [] });
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({
      connected: true,
      brand: 'moza',
      brandName: 'Moza',
      verifiedOnHardware: false,
      name: 'MOZA R9 Base',
      mode: 'unknown',
      vendorId: '346E',
      productId: '0002',
      controllers: 1,
      axesSourced: false,
      profiles: [],
    });
    expect(status.backup).toBeUndefined();
    expect(status.axes.map((a) => a.axis)).toEqual(['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'S0', 'S1']);
    expect(status.software).toEqual([
      {
        label: 'MOZA Pit House (base settings, firmware, rim lights and displays)',
        value: 'Installed · 1.3.2.9 · running',
        ok: true,
      },
    ]);
    expect(status.recommendedLinks[0]!.url).toContain('mozaracing.com');
    expect(await baseCheck(app, '346E', '0002')).toMatchObject({
      pass: true,
      summary: 'Connected',
    });

    const byKey = await capture(app);
    expect(byKey.get('racing:wheel-base')).toMatchObject({
      title: 'Wheel base connected',
      check: { type: 'racing.wheelBase', params: { vendorId: '346E', productId: '0002' } },
    });
    const pitHouse = byKey.get('racing:wheel-software:moza-pit-house')!;
    expect(pitHouse).toMatchObject({
      title: 'MOZA Pit House running',
      selectedByDefault: true,
      check: { type: 'process.running', params: { name: 'MOZA Pit House.exe' } },
    });
    expect(String(pitHouse.check.remediation!.params['exe'])).toMatch(
      /MOZA Pit House[\\/]MOZA Pit House\.exe$/
    );
    // Only Fanatec writes the rotation down where RigReady can read it.
    expect(byKey.has('racing:wheel-rotation')).toBe(false);

    // Pit House closed: the check that a setup would hold fails, and its fix starts it again.
    await mutate(app, [{ op: 'stopProcess', name: 'MOZA Pit House.exe' }]);
    const running = app.wiring.context.checks.check('process.running')!;
    expect((await running.run({ name: 'MOZA Pit House.exe' }, app.ctx)).pass).toBe(false);
    const fix = app.wiring.context.checks.remediation('process.launch')!;
    const fixed = await fix.run(pitHouse.check.remediation!.params as never, app.ctx);
    expect(fixed.ok).toBe(true);
    expect((await running.run({ name: 'MOZA Pit House.exe' }, app.ctx)).pass).toBe(true);
  });

  it('Logitech G923: PC mode, G HUB, and its settings.db backed up and restored with G HUB closed and started again', async () => {
    app = await wiredApp('wheel-logitech-g923', { files: [] });
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({
      brand: 'logitech',
      name: 'Logitech G923 Racing Wheel for Xbox One and PC',
      mode: 'pc',
      modeLabel: 'PC mode',
      backup: 'logitech',
      recommendedLinks: [],
    });
    expect(status.software[0]).toMatchObject({ value: 'Installed · 2025.9.781014 · running' });
    expect(status.profiles).toEqual([
      expect.objectContaining({ label: 'G HUB settings and profiles', present: true }),
    ]);
    expect(await baseCheck(app, '046D', 'C26E')).toMatchObject({
      pass: true,
      summary: 'Connected in PC mode',
    });

    const db = path.join(app.ports.folders.localAppData(), 'LGHUB', 'settings.db');
    const original = await fs.readFile(db, 'utf8');
    const backup = await app.invoke<BindingBackup>('racing:backup', { game: 'logitech' });
    expect(backup.files.map((f) => path.basename(f.path))).toEqual(['settings.db']);
    await fs.writeFile(db, 'changed by G HUB');
    await expect(app.invoke('racing:restore', { game: 'logitech', id: backup.id })).rejects.toThrow(
      'Logitech G HUB is open. It must be closed while its settings are restored.'
    );
    const restored = await app.invoke<{ message: string }>('racing:restore', {
      game: 'logitech',
      id: backup.id,
      closeApp: true,
    });
    expect(restored.message).toMatch(/Logitech G HUB was started again\.$/);
    expect(await fs.readFile(db, 'utf8')).toBe(original);
    // The backup page offers the same file for a full backup.
    const sources = app.wiring.context.backupSources.all().find((s) => s.id === 'wheel-logitech')!;
    const suggested = await sources.suggest(app.ctx);
    expect(suggested.ok && suggested.value[0]!.path).toBe(db);
  });

  it('Logitech G29: the PS3 switch position is told apart from the PS4 one Logitech advises on a PC', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    await mutate(app, [
      plug(
        '046D',
        'C24F',
        'Logitech G29 Driving Force Racing Wheel',
        '7A1B2C3D-9C41-11F0-8005-444553540000'
      ),
    ]);
    const outcome = await baseCheck(app, '046D', 'C260');
    expect(outcome).toMatchObject({ pass: false, summary: 'In PS3 switch position' });
    expect(outcome.details!.join(' ')).toContain('Logitech advises the PS4 position');
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({ mode: 'console', modeLabel: 'PS3 switch position' });
    expect(status.modeHelp).toContain('PS4 position');
  });

  it('Simagic Alpha: the shared STMicro id, SimPro Manager installed but not running, offered unticked with a fix', async () => {
    app = await wiredApp('wheel-simagic-alpha', { files: [] });
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({
      brand: 'simagic',
      name: 'SIMAGIC Alpha',
      mode: 'unknown',
      verifiedOnHardware: false,
    });
    expect(status.software).toEqual([
      {
        label: 'SimPro Manager (base settings and firmware)',
        value: 'Installed · 2.0.345 · not running',
        ok: false,
      },
    ]);
    const simpro = (await capture(app)).get('racing:wheel-software:simpro')!;
    expect(simpro.selectedByDefault).toBe(false);
    expect(String(simpro.check.remediation!.params['exe'])).toMatch(/simpro2[\\/]simpro2\.exe$/);
    // The same id on its own, without SimPro, is still called a Simagic: the note says it is shared.
    expect(await baseCheck(app, '0483', '0522')).toMatchObject({
      pass: true,
      summary: 'Connected',
    });
  });

  it('Thrustmaster T300: PC mode, and a wheel the driver did not switch or one in PS4 mode is named', async () => {
    app = await wiredApp('wheel-thrustmaster-t300', { files: [] });
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({
      brand: 'thrustmaster',
      mode: 'pc',
      productId: 'B66E',
    });
    expect(status.software).toEqual([
      {
        label: 'Thrustmaster FFB Racing Wheel driver (force feedback and the Control Panel)',
        value: 'Installed · 2025.TMWD.2',
        ok: true,
      },
    ]);
    expect(await baseCheck(app, '044F', 'B66E')).toMatchObject({
      pass: true,
      summary: 'Connected in PC mode',
    });
    expect((await capture(app)).get('racing:wheel-base')!.title).toBe('Wheel base in PC mode');

    await mutate(app, [
      { op: 'unplugDevice', match: { vendorId: '044F' } },
      plug('044F', 'B65D', 'Thrustmaster FFB Wheel', '7A1B2C3D-9C41-11F0-8006-444553540000'),
    ]);
    const generic = await baseCheck(app, '044F', 'B66E');
    expect(generic.pass).toBe(false);
    expect(generic.summary).toContain('before the Thrustmaster driver switches it');
    expect(generic.details!.join(' ')).toContain('Install the Thrustmaster force feedback driver');

    await mutate(app, [
      { op: 'unplugDevice', match: { vendorId: '044F' } },
      plug(
        '044F',
        'B66D',
        'Thrustmaster T300RS Racing wheel',
        '7A1B2C3D-9C41-11F0-8007-444553540000'
      ),
    ]);
    expect(await baseCheck(app, '044F', 'B66E')).toMatchObject({
      pass: false,
      summary: 'In PS4 mode',
    });
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F' } }]);
    expect(await baseCheck(app, '044F', 'B66E')).toMatchObject({
      pass: false,
      summary: 'Not connected',
    });
  });

  it('a PC with no wheel names no brand and offers nothing', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({ connected: false, software: [], profiles: [] });
    expect(status.brand).toBeUndefined();
    const byKey = await capture(app);
    expect([...byKey.keys()]).toEqual([]);
  });

  it('Fanatec keeps its rows; its rotation is offered as an optional check from what the driver recorded', async () => {
    app = await wiredApp('racing-fresh');
    const { status } = await app.invoke<WheelView>('racing:wheel');
    expect(status).toMatchObject({ brand: 'fanatec', verifiedOnHardware: true, mode: 'pc' });
    expect(status.axes.find((a) => a.axis === 'X')).toEqual({ axis: 'X', name: 'Wheel' });
    const rotation = (await capture(app)).get('racing:wheel-rotation')!;
    expect(rotation).toMatchObject({
      title: 'Wheel rotation 1080°',
      selectedByDefault: false,
      check: { type: 'racing.wheelRotation', params: { brand: 'fanatec', degrees: 1080 } },
    });
    const check = app.wiring.context.checks.check('racing.wheelRotation')!;
    expect(await check.run({ brand: 'fanatec', degrees: 1080 }, app.ctx)).toMatchObject({
      pass: true,
    });
    expect(await check.run({ brand: 'fanatec', degrees: 900 }, app.ctx)).toMatchObject({
      pass: false,
      summary: '1080°, not 900°',
    });
    expect(await check.run({ brand: 'moza', degrees: 900 }, app.ctx)).toMatchObject({
      pass: false,
      summary: 'The wheel base is not connected',
    });
  });
});
