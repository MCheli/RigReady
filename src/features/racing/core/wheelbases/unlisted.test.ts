import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../../tests/helpers';
import type { RacingOverview, WheelStatus, WheelView } from '../../contract';
import { wheelHead } from './head';
import { looksLikeWheelBase, UNLISTED_NOT_AVAILABLE, UNLISTED_WORKS } from './unlisted';

/**
 * A wheel base whose USB id is not in the table (./products.ts). The scenario
 * `wheel-not-listed` plugs one into the generic PC. Its USB id is the one the research notes
 * list for the VRS DirectForce Pro; its name, GUIDs and controller shape are made up, not
 * recorded from a real base. Everything here runs through the real IPC channels and the
 * real check.
 */

const VRS = { vendorId: '0483', productId: 'A355' };
const VRS_NAME = 'VRS DirectForce Pro Wheel Base';

interface Candidate {
  key: string;
  title: string;
  description?: string;
  check: { type: string; params: Record<string, unknown> };
}

const plug = (
  vendorId: string,
  productId: string,
  name: string,
  guid: string,
  shape: { axes: number; buttons: number } = { axes: 3, buttons: 12 }
) => ({
  op: 'plugDevice' as const,
  device: {
    instanceId: `USB\\VID_${vendorId}&PID_${productId}\\7&1c2d3e4f&0&6`,
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
    numAxes: shape.axes,
    numButtons: shape.buttons,
    numHats: 0,
    axisNames: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ'].slice(0, shape.axes),
  },
});

/** Every file under a folder, as paths relative to it. */
async function filesUnder(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(root, full)));
    else out.push(path.relative(root, full));
  }
  return out.sort();
}

describe('a wheel base RigReady does not know', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const wheel = (a: WiredApp): Promise<WheelView> => a.invoke<WheelView>('racing:wheel');
  const baseCheck = (a: WiredApp, vendorId: string, productId: string) =>
    a.wiring.context.checks.check('racing.wheelBase')!.run({ vendorId, productId }, a.ctx);
  const capture = async (a: WiredApp): Promise<Map<string, Candidate>> => {
    const { candidates } = await a.invoke<{ candidates: Candidate[] }>('profiles:capture');
    return new Map(candidates.filter((c) => c.key.startsWith('racing:')).map((c) => [c.key, c]));
  };

  it('a connected base that is not in the table is seen and said to be unknown, never "no wheel base"', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    const view = await wheel(app);
    // Not connected as far as the page's own rows go: RigReady does not treat it as the base
    // until the user says so. But it is reported, with why it looks like a wheel base.
    expect(view.status.connected).toBe(false);
    expect(view.status.brand).toBeUndefined();
    expect(view.status.unknownBases).toEqual([
      {
        ...VRS,
        name: VRS_NAME,
        controllers: 1,
        axes: 3,
        buttons: 12,
        looksLikeWheel: true,
        why: 'Its name says it is a wheel.',
      },
    ]);
    const head = wheelHead(view.status);
    expect(head).toMatchObject({
      state: 'seen',
      title: `RigReady sees ${VRS_NAME}, but does not know this model`,
    });
    // The Racing page's wheel card reads the same status.
    const overview = await app.invoke<RacingOverview>('racing:overview');
    expect(wheelHead(overview.wheel).title).toBe(head.title);
    // Nothing is offered for a setup before the user has said it is their wheel.
    expect([...(await capture(app)).keys()]).toEqual([]);
    // The picker lists it first, then the PC's other controller that the table does not know.
    expect(view.unlisted.map((c) => [c.name, c.looksLikeWheel])).toEqual([
      [VRS_NAME, true],
      ['Logitech Extreme 3D', false],
    ]);
    expect(view.myWheels).toEqual([]);
  });

  it('with nothing it knows connected it says only that, and a stick or a button box is not called a wheel', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const fresh = await wheel(app);
    expect(fresh.status.unknownBases).toEqual([]);
    expect(wheelHead(fresh.status)).toEqual({
      state: 'none',
      title: 'No wheel base RigReady knows is connected',
    });
    await mutate(app, [
      plug('1DD2', '2301', 'Leo Bodnar BBI-32 Button Box', '5C8A1B30-9C41-11F0-8003-444553540000', {
        axes: 0,
        buttons: 32,
      }),
    ]);
    const view = await wheel(app);
    expect(view.status.unknownBases).toEqual([]);
    expect(wheelHead(view.status).state).toBe('none');
    // Both can still be picked: the guess only decides the wording, the user decides the wheel.
    expect(view.unlisted.map((c) => c.name).sort()).toEqual([
      'Leo Bodnar BBI-32 Button Box',
      'Logitech Extreme 3D',
    ]);
    expect(view.unlisted.every((c) => !c.looksLikeWheel && c.why === undefined)).toBe(true);
  });

  it("what looks like a wheel base: a name that says so, or a wheel maker's id on something with axes and buttons", () => {
    const shape = (numAxes: number, numButtons: number) => ({ numAxes, numButtons });
    expect(looksLikeWheelBase({ vendorId: '0483', name: VRS_NAME }, shape(3, 12))).toBe(
      'Its name says it is a wheel.'
    );
    expect(
      looksLikeWheelBase({ vendorId: '1234', name: 'Acme DD12 Direct Drive' }, undefined)
    ).toBe('Its name says it is a wheel.');
    expect(looksLikeWheelBase({ vendorId: '3670', name: 'Alpha EVO 2' }, shape(6, 40))).toBe(
      'It is from Simagic, a maker of wheel bases.'
    );
    // A wheel maker's pedals (axes, no buttons) and shifter (buttons, no axes) are not a base.
    expect(looksLikeWheelBase({ vendorId: '3670', name: 'P-X' }, shape(3, 0))).toBeUndefined();
    expect(looksLikeWheelBase({ vendorId: '3670', name: 'DS-8X' }, shape(0, 9))).toBeUndefined();
    // A name that says what else it is wins over everything.
    for (const name of [
      'Simagic P1000 Pedals',
      'Heusinkveld Sim Handbrake',
      'T.16000M Joystick',
      'TWCS Throttle',
      'Xbox Wireless Controller',
      'Wheel Stand Button Box',
    ])
      expect(looksLikeWheelBase({ vendorId: '3670', name }, shape(3, 12))).toBeUndefined();
    // Makers that also build flight gear, and chip makers' shared ids, are judged by name only.
    for (const vendorId of ['046D', '044F', '346E', '0483', '16D0'])
      expect(looksLikeWheelBase({ vendorId, name: 'Model 9' }, shape(3, 12))).toBeUndefined();
  });

  it('"My wheel is not listed": the user picks it, RigReady remembers it in its own folder and shows what it can', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    const before = await filesUnder(app.home);
    const started = app.ports.processes.started.length;
    const shell = app.ports.shell.calls.length;

    const view = await app.invoke<WheelView>('racing:addWheel', { ...VRS, maker: '  VRS ' });

    // Only RigReady's own file was written, and no program was started.
    const file = path.join(app.ports.folders.dataRoot(), 'racing', 'wheels.json');
    const after = await filesUnder(app.home);
    expect(after.filter((f) => !before.includes(f))).toEqual([path.relative(app.home, file)]);
    expect(before.filter((f) => !after.includes(f))).toEqual([]);
    expect(app.ports.processes.started.length).toBe(started);
    expect(app.ports.shell.calls.length).toBe(shell);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      wheels: [{ ...VRS, name: VRS_NAME, maker: 'VRS', addedAt: app.clock.now().toISOString() }],
    });

    const expected: Partial<WheelStatus> = {
      connected: true,
      unlisted: true,
      verifiedOnHardware: false,
      maker: 'VRS',
      name: VRS_NAME,
      ...VRS,
      mode: 'unknown',
      modeLabel: 'Mode not known for this model',
      controllers: 1,
      // The names Windows gives, not Wheel, Brake or Clutch.
      axes: [
        { axis: 'X', name: 'X axis' },
        { axis: 'Y', name: 'Y axis' },
        { axis: 'Z', name: 'Z axis' },
      ],
      axesSourced: false,
      // Nothing that needs the maker or the model.
      software: [],
      profiles: [],
      recommendedLinks: [],
      accessories: [],
      parts: [{ role: 'base', name: VRS_NAME, ...VRS }],
      unknownBases: [],
      unlistedWorks: [...UNLISTED_WORKS],
      unlistedNotAvailable: [...UNLISTED_NOT_AVAILABLE],
    };
    expect(view.status).toMatchObject(expected);
    expect(view.status.brand).toBeUndefined();
    expect(view.status.brandName).toBeUndefined();
    expect(view.status.backup).toBeUndefined();
    expect(view.status.softwareNote).toBeUndefined();
    expect(wheelHead(view.status)).toEqual({ state: 'connected', title: VRS_NAME });
    expect(view.myWheels).toEqual([{ ...VRS, name: VRS_NAME, maker: 'VRS', connected: true }]);
    expect(view.unlisted.map((c) => c.name)).toEqual(['Logitech Extreme 3D']);
    // It is the same after the page is read again, and on the Racing page.
    expect((await wheel(app)).status).toMatchObject(expected);
    const overview = await app.invoke<RacingOverview>('racing:overview');
    expect(overview.wheel).toMatchObject({ connected: true, unlisted: true, name: VRS_NAME });
  });

  it('the lists of what an unlisted base gets and does not get are plain, and neither claims the other', () => {
    expect(UNLISTED_WORKS.length).toBeGreaterThan(0);
    expect(UNLISTED_NOT_AVAILABLE.length).toBeGreaterThan(0);
    for (const line of [...UNLISTED_WORKS, ...UNLISTED_NOT_AVAILABLE]) {
      expect(line).not.toMatch(/[—–]/);
      expect(line).toMatch(/\.$/);
    }
    const missing = UNLISTED_NOT_AVAILABLE.join(' ');
    for (const word of ['software', 'mode', 'Axis names', 'Profiles', 'Rotation', 'pedals'])
      expect(missing).toContain(word);
  });

  it('a setup can check an added base: connected passes, unplugged fails, and the mode is said to be unchecked', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    await app.invoke('racing:addWheel', VRS);
    const byKey = await capture(app);
    // One candidate, and none for a maker's software, rotation or settings.
    expect([...byKey.keys()]).toEqual(['racing:wheel-base']);
    expect(byKey.get('racing:wheel-base')).toMatchObject({
      title: 'Wheel base connected',
      description: `${VRS_NAME} · RigReady does not know this model, so its mode is not checked`,
      check: { type: 'racing.wheelBase', params: VRS },
    });
    expect(await baseCheck(app, VRS.vendorId, VRS.productId)).toEqual({
      pass: true,
      summary: 'Connected',
      details: [
        'Games see it as one controller.',
        'RigReady does not know this model, so its mode is not checked.',
      ],
    });
    await mutate(app, [{ op: 'unplugDevice', match: VRS }]);
    expect(await baseCheck(app, VRS.vendorId, VRS.productId)).toEqual({
      pass: false,
      summary: 'Not connected',
    });
    // The page now waits for the base the user added, by its name.
    const view = await wheel(app);
    expect(view.status).toMatchObject({ connected: false, awaitedName: VRS_NAME });
    expect(wheelHead(view.status)).toEqual({
      state: 'awaited',
      title: `${VRS_NAME} is not connected`,
    });
    expect(view.myWheels).toEqual([{ ...VRS, name: VRS_NAME, connected: false }]);
    expect([...(await capture(app)).keys()]).toEqual([]);
  });

  it('a setup made for a known base names the added base when that is what is connected instead', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    await app.invoke('racing:addWheel', VRS);
    expect(await baseCheck(app, '346E', '0002')).toEqual({
      pass: false,
      summary: `A different base is connected: ${VRS_NAME}`,
    });
  });

  it('a base RigReady knows stays the base of the page; an added one beside it is listed as also connected', async () => {
    app = await wiredApp('wheel-moza-r9', { files: [] });
    await mutate(app, [plug('0483', 'A355', VRS_NAME, '4A7B2C10-9C41-11F0-8002-444553540000')]);
    const seen = await wheel(app);
    expect(seen.status).toMatchObject({ brand: 'moza', connected: true });
    expect(seen.status.unknownBases.map((b) => b.name)).toEqual([VRS_NAME]);
    const view = await app.invoke<WheelView>('racing:addWheel', VRS);
    expect(view.status).toMatchObject({ brand: 'moza', connected: true, others: [VRS_NAME] });
    expect(view.status.unlisted).toBeUndefined();
    expect(view.status.unknownBases).toEqual([]);
    // The setup check is still the known base's, with its software rows.
    expect((await capture(app)).get('racing:wheel-base')?.check.params).toEqual({
      vendorId: '346E',
      productId: '0002',
    });
  });

  it('adding is refused for a model RigReady knows, for one that is not connected, and for ids that are not USB ids', async () => {
    app = await wiredApp('wheel-moza-r9', { files: [] });
    const file = path.join(app.ports.folders.dataRoot(), 'racing', 'wheels.json');
    await expect(
      app.invoke('racing:addWheel', { vendorId: '346E', productId: '0002' })
    ).rejects.toThrow(/racing\.wheelKnown RigReady already knows this model/);
    await expect(app.invoke('racing:addWheel', VRS)).rejects.toThrow(
      /racing\.wheelNotConnected That controller is not connected now/
    );
    await expect(
      app.invoke('racing:addWheel', { vendorId: '0483', productId: '..\\x' })
    ).rejects.toThrow();
    await expect(
      app.invoke('racing:addWheel', { ...VRS, maker: 'x'.repeat(61) })
    ).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
    expect((await wheel(app)).myWheels).toEqual([]);
  });

  it('"Forget this wheel" takes it out of the list, and forgetting one that was never added changes nothing', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    await expect(app.invoke('racing:removeWheel', VRS)).rejects.toThrow(/racing\.wheelNotAdded/);
    await app.invoke('racing:addWheel', { ...VRS, maker: 'VRS' });
    // Lower-case ids from a caller mean the same model.
    const view = await app.invoke<WheelView>('racing:removeWheel', {
      vendorId: '0483',
      productId: 'a355',
    });
    expect(view.myWheels).toEqual([]);
    expect(view.status.connected).toBe(false);
    expect(view.status.unknownBases.map((b) => b.name)).toEqual([VRS_NAME]);
    const file = path.join(app.ports.folders.dataRoot(), 'racing', 'wheels.json');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ wheels: [] });
  });

  it('a wheels file that cannot be read adds no wheel, and adding says what is wrong instead of replacing it', async () => {
    app = await wiredApp('wheel-not-listed', { files: [] });
    const file = path.join(app.ports.folders.dataRoot(), 'racing', 'wheels.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ "wheels": [ { "vendorId": "zz" } ] }');
    const view = await wheel(app);
    expect(view.myWheels).toEqual([]);
    expect(view.status.unknownBases.map((b) => b.name)).toEqual([VRS_NAME]);
    await expect(app.invoke('racing:addWheel', VRS)).rejects.toThrow(/store\.invalid/);
    expect(await fs.readFile(file, 'utf8')).toBe('{ "wheels": [ { "vendorId": "zz" } ] }');
  });
});
