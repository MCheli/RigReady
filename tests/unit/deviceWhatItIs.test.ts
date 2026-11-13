/**
 * DEV-017 across features: what the user says a device is, on the Devices page, is kept in
 * RigReady's own data folder and reaches every page that reads the kind of a device or
 * what it is used for: the names port in core, a new setup's defaults, the rig strip and
 * the picture of a setup. The PC is fixtures/scenarios/devices-unknown-controller.yaml: a
 * home-built wheel that reports itself as "Arduino Leonardo", which no list of RigReady
 * knows, beside a Logitech stick.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../src/core/profile/schema';
import type { Overview } from '../../src/features/devices/core/model';
import type { RigGlance } from '../../src/features/fly/contract';
import type { CaptureResult } from '../../src/features/profiles/contract';
import { choiceFor, keptByDefault } from '../../src/features/profiles/core/captureDefaults';
import { pictureModel } from '../../src/features/sharing/core/picture';
import { wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
});

const BOARD = { vendorId: '2341', productId: '8036' };
const NAME = 'Arduino Leonardo';
const STICK = 'Logitech Extreme 3D';

const capture = (): Promise<CaptureResult> => app.invoke<CaptureResult>('profiles:capture');
const board = async (): Promise<Overview['devices'][number]> =>
  (await app.invoke<Overview>('devices:overview')).devices.find((d) => d.vendorId === '2341')!;
const stored = async (): Promise<{ whatItIs?: unknown[] }> =>
  JSON.parse(
    await fs.readFile(path.join(app.ports.folders.dataRoot(), 'devices.json'), 'utf8')
  ) as { whatItIs?: unknown[] };

/** A setup for the game, with the devices a new setup for it keeps when nothing is changed. */
async function setupFor(game: string, name: string): Promise<Profile> {
  const captured = await capture();
  const choice = choiceFor(captured, game);
  return app.invoke<Profile>('profiles:create', {
    name,
    game,
    checks: captured.candidates
      .filter((c) => c.group === 'devices' && keptByDefault(c, choice))
      .map((c) => c.check),
  });
}

describe('what is this device?', () => {
  it('a controller no list knows is offered to a flight and a racing setup alike, with no picture of its own', async () => {
    app = await wiredApp('devices-unknown-controller', { files: [] });
    const device = await board();
    expect(device).toMatchObject({ name: NAME, kind: 'controller', reads: { kind: 'other' } });
    expect(device.said).toBeUndefined();
    expect(device.reads.usedFor).toBeUndefined();
    expect((await app.wiring.context.names.devices()).whatIs?.(BOARD)).toBeUndefined();

    const captured = await capture();
    const candidate = captured.candidates.find((c) => c.title === NAME)!;
    expect(candidate).toMatchObject({ selectedByDefault: true, tier: 'main' });
    expect(candidate.kind).toBeUndefined();
    expect(candidate.device?.saidKind).toBeUndefined();
    expect(keptByDefault(candidate, choiceFor(captured, 'msfs2020'))).toBe(true);
    expect(keptByDefault(candidate, choiceFor(captured, 'acc'))).toBe(true);

    const setup = await setupFor('acc', 'ACC');
    const item = setup.checks.find((c) => c.title === NAME)!;
    const glance = await app.invoke<RigGlance>('fly:rig', { profileId: setup.id });
    expect(glance.kinds).toBeUndefined();
    const picture = await pictureModel(app.wiring.context, setup);
    expect(picture.devices.find((d) => d.name === NAME)?.kind).toBe('other');
    expect(item.params).toMatchObject(BOARD);
  });

  it('once the user says it is a wheel for racing, the names port, a new setup, the rig strip and the picture all go by that', async () => {
    app = await wiredApp('devices-unknown-controller', { files: [] });
    const device = await board();
    expect(
      await app.invoke('devices:setWhatItIs', {
        key: device.key,
        kind: 'wheel',
        usedFor: 'racing',
      })
    ).toEqual({ kind: 'wheel', usedFor: 'racing' });

    // Kept in RigReady's own data folder, under the identity a name is kept under.
    expect((await stored()).whatItIs).toEqual([
      { ...BOARD, instanceId: device.key, kind: 'wheel', usedFor: 'racing' },
    ]);
    // The Devices page shows what was said beside what RigReady reads by itself.
    expect(await board()).toMatchObject({
      said: { kind: 'wheel', usedFor: 'racing' },
      reads: { kind: 'other' },
    });

    // Through core, as any feature asks.
    const names = await app.wiring.context.names.devices();
    expect(names.whatIs?.(BOARD)).toEqual({ kind: 'wheel', usedFor: 'racing' });
    expect(names.whatIs?.({ ...BOARD, guid: device.controllers[0]!.guid })).toEqual({
      kind: 'wheel',
      usedFor: 'racing',
    });
    // The answer is about that device only, and is not a name.
    expect(names.whatIs?.({ vendorId: '046D', productId: 'C215' })).toBeUndefined();
    expect(names.nameOf(BOARD)).toBeUndefined();

    // A new setup: ticked for a racing sim, offered and not ticked for a flight sim.
    const captured = await capture();
    const candidate = captured.candidates.find((c) => c.title === NAME)!;
    expect(candidate).toMatchObject({
      selectedByDefault: true,
      tier: 'main',
      kind: 'racing',
      icon: 'mdi-steering',
    });
    expect(candidate.device).toMatchObject({ saidKind: 'wheel', gameController: true });
    expect(keptByDefault(candidate, choiceFor(captured, 'acc'))).toBe(true);
    expect(keptByDefault(candidate, choiceFor(captured, 'msfs2020'))).toBe(false);
    // The stick beside it is what it was: flight gear, by its maker's list.
    const stick = captured.candidates.find((c) => c.title === STICK)!;
    expect(keptByDefault(stick, choiceFor(captured, 'msfs2020'))).toBe(true);
    expect(keptByDefault(stick, choiceFor(captured, 'acc'))).toBe(false);

    // The Play page's rig strip and the picture of the setup draw it as a wheel.
    const setup = await setupFor('acc', 'ACC');
    expect(setup.checks.map((c) => c.title)).toEqual([NAME]);
    const item = setup.checks[0]!;
    const glance = await app.invoke<RigGlance>('fly:rig', { profileId: setup.id });
    expect(glance.kinds).toEqual({ [item.id]: 'wheel' });
    const picture = await pictureModel(app.wiring.context, setup);
    expect(picture.devices.find((d) => d.name === NAME)?.kind).toBe('wheel');
    // Only the drawing is in the picture: the setup itself carries nothing of the answer.
    expect(JSON.stringify(setup)).not.toMatch(/whatItIs|saidKind|usedFor/);

    // Taken back: RigReady reads it by itself again, everywhere.
    expect(
      await app.invoke('devices:setWhatItIs', { key: device.key, kind: null, usedFor: null })
    ).toEqual({});
    expect((await stored()).whatItIs).toEqual([]);
    expect((await board()).said).toBeUndefined();
    expect((await app.wiring.context.names.devices()).whatIs?.(BOARD)).toBeUndefined();
    expect((await app.invoke<RigGlance>('fly:rig', { profileId: setup.id })).kinds).toBeUndefined();
    const again = (await capture()).candidates.find((c) => c.title === NAME)!;
    expect(again.kind).toBeUndefined();
    expect(again.icon).toBe('mdi-controller');
  });

  it('a device said to be for both is kept for either family; one said to be a mouse is left for the user to tick', async () => {
    app = await wiredApp('devices-unknown-controller', { files: [] });
    const device = await board();
    await app.invoke('devices:setWhatItIs', { key: device.key, kind: 'panel', usedFor: 'both' });
    let captured = await capture();
    let candidate = captured.candidates.find((c) => c.title === NAME)!;
    expect(candidate.kind).toBeUndefined();
    expect(candidate.device?.saidKind).toBe('panel');
    expect(keptByDefault(candidate, choiceFor(captured, 'acc'))).toBe(true);
    expect(keptByDefault(candidate, choiceFor(captured, 'msfs2020'))).toBe(true);

    // Windows lists it as a game controller; the user says it is not sim gear.
    await app.invoke('devices:setWhatItIs', { key: device.key, kind: 'mouse', usedFor: null });
    captured = await capture();
    candidate = captured.candidates.find((c) => c.title === NAME)!;
    expect(candidate).toMatchObject({ selectedByDefault: false, tier: 'more', icon: 'mdi-mouse' });
    expect(candidate.device?.gameController).toBe(true);
    expect(keptByDefault(candidate, choiceFor(captured, 'acc'))).toBe(false);
  });
});
