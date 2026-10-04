import { afterEach, describe, expect, it } from 'vitest';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Suggestion } from '../contract';
import { suggestionWords } from './suggestText';

/**
 * The quiet suggestion: the racing rig is on the desk (wheel connected, no flight gear) and
 * the setup on screen is the F/A-18C.
 */
let app: WiredApp;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
});

describe('the words of the offer', () => {
  it('names the kind of device that gave it away, the setup, and what is not here', () => {
    expect(
      suggestionWords({
        name: 'iRacing',
        device: 'FANATEC Podium Wheel Base DD2',
        missing: 11,
      })
    ).toEqual({
      icon: 'mdi-steering',
      title: 'Wheel connected: switch to iRacing?',
      sub: 'FANATEC Podium Wheel Base DD2 is here, and 11 devices this setup needs are not.',
    });
    expect(
      suggestionWords({ name: 'DCS F/A-18C', device: 'T-Pendular-Rudder', missing: 1 })
    ).toEqual({
      icon: 'mdi-shoe-print',
      title: 'Pedals connected: switch to DCS F/A-18C?',
      sub: 'T-Pendular-Rudder is here, and 1 device this setup needs is not.',
    });
  });

  it('calls a device nobody knows the kind of by its own name', () => {
    expect(suggestionWords({ name: 'Truck', device: 'SKRS', missing: 2 })).toEqual({
      icon: 'mdi-usb',
      title: 'SKRS connected: switch to Truck?',
      sub: 'SKRS is here, and 2 devices this setup needs are not.',
    });
  });
});

const HORNET = 'dcs-f-a-18c';
const IRACING = 'racing-iracing';
const WHEEL = 'FANATEC Podium Wheel Base DD2';

const suggestion = (profileId = HORNET): Promise<Suggestion | null> =>
  app.invoke<Suggestion | null>('fly:suggestion', { profileId });

async function setup(id: string): Promise<Profile> {
  const found = await app.wiring.context.profiles.get(id);
  if (!found.ok) throw new Error(found.error.message);
  return found.value;
}
async function save(profile: Profile): Promise<void> {
  const saved = await app.wiring.context.profiles.save(profile);
  if (!saved.ok) throw new Error(saved.error.message);
}
async function used(id: string, at: string): Promise<void> {
  const saved = await app.wiring.context.profiles.setLastProfileId(id, new Date(at));
  if (!saved.ok) throw new Error(saved.error.message);
}
const device = (id: string, title: string, vendorId: string, productId: string): CheckItem => ({
  id,
  type: 'device.connected',
  title,
  required: true,
  params: { vendorId, productId },
});
const keyboard = device('k', 'Keychron K2 Pro', '3434', '0220');
const pedals = device('p', 'T-Pendular-Rudder', '044F', 'B68F');
const wheel = device('w', WHEEL, '0EB7', '0007');
const blank = (id: string, name: string, checks: CheckItem[]): Profile => ({
  schemaVersion: 1,
  id,
  name,
  createdAt: '2026-10-03T12:00:00.000Z',
  updatedAt: '2026-10-03T12:00:00.000Z',
  checks,
  extensions: {},
});

describe('the setup the gear on the desk is for', () => {
  it('offers the setup whose required devices are all connected when the one on screen is missing some', async () => {
    app = await wiredApp('fly-suggest');
    expect(await suggestion()).toEqual({
      profileId: IRACING,
      name: 'iRacing',
      device: WHEEL,
      missing: 11,
    });
  });

  it('says nothing while the gear of the setup on screen is here', async () => {
    app = await wiredApp('fly-suggest');
    expect(await suggestion(IRACING)).toBeNull();
    // Nor for a setup that is not there (it was deleted in another window).
    expect(await suggestion('gone')).toBeNull();
  });

  it('says nothing when no other setup has all of its devices either', async () => {
    app = await wiredApp('fly-suggest');
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7' } }]);
    expect(await suggestion()).toBeNull();
    // Plugged in again, the offer is back: it follows the machine.
    await mutate(app, [{ op: 'plugDevice', match: { vendorId: '0EB7' } }]);
    expect((await suggestion())?.profileId).toBe(IRACING);
  });

  it('counts only the devices a setup requires: optional and switched-off ones decide nothing', async () => {
    app = await wiredApp('fly-suggest');
    const hornet = await setup(HORNET);
    const racing = await setup(IRACING);
    const every = (profile: Profile, change: Partial<CheckItem>): Profile => ({
      ...profile,
      checks: profile.checks.map((item) => ({ ...item, ...change })),
    });

    // Nothing this setup requires is missing: nothing contradicts it.
    await save(every(hornet, { required: false }));
    expect(await suggestion()).toBeNull();
    await save(every(hornet, { required: true, disabled: true }));
    expect(await suggestion()).toBeNull();

    // A setup that requires no device is never the one the gear is for.
    await save(hornet);
    expect((await suggestion())?.profileId).toBe(IRACING);
    await save(every(racing, { required: false }));
    expect(await suggestion()).toBeNull();
  });

  it('of several setups whose gear is here, offers the one used most recently', async () => {
    app = await wiredApp('fly-suggest');
    const racing = await setup(IRACING);
    await save({ ...racing, id: 'racing-acc', name: 'Assetto Corsa Competizione' });

    await used('racing-acc', '2026-10-03T20:00:00.000Z');
    await used(HORNET, '2026-10-04T08:00:00.000Z');
    expect(await suggestion()).toMatchObject({
      profileId: 'racing-acc',
      name: 'Assetto Corsa Competizione',
    });

    await used(IRACING, '2026-10-03T21:00:00.000Z');
    await used(HORNET, '2026-10-04T08:05:00.000Z');
    expect(await suggestion()).toMatchObject({ profileId: IRACING, name: 'iRacing' });
  });

  it('names the device that tells the two setups apart, not one they share', async () => {
    app = await wiredApp('fly-suggest');
    await save(blank('desk-flight', 'Desk flight', [keyboard, pedals]));
    await save(blank('desk-racing', 'Desk racing', [{ ...keyboard, id: 'kb' }, wheel]));
    await used('desk-racing', '2026-10-04T09:00:00.000Z');
    await used('desk-flight', '2026-10-04T09:05:00.000Z');
    expect(await suggestion('desk-flight')).toEqual({
      profileId: 'desk-racing',
      name: 'Desk racing',
      device: WHEEL,
      missing: 1,
    });
  });

  it('looks at the machine once for all the setups', async () => {
    app = await wiredApp('fly-suggest');
    const devices = app.ports.devices;
    let reads = 0;
    const list = devices.list.bind(devices);
    devices.list = async () => {
      reads += 1;
      return list();
    };
    // Thirteen device items in two setups: the list of devices is read once.
    await suggestion();
    expect(reads).toBe(1);
    // Two more setups to compare with are no more reads.
    const racing = await setup(IRACING);
    await save({ ...racing, id: 'racing-acc', name: 'Assetto Corsa Competizione' });
    await save({ ...racing, id: 'racing-lmu', name: 'Le Mans Ultimate' });
    reads = 0;
    await suggestion();
    expect(reads).toBe(1);
  });

  it('nothing else of a setup is looked at: only its devices', async () => {
    app = await wiredApp('fly-suggest');
    const processes = app.ports.processes;
    const displays = app.ports.displays;
    let other = 0;
    const list = processes.list.bind(processes);
    processes.list = async () => {
      other += 1;
      return list();
    };
    const read = displays.read.bind(displays);
    displays.read = async () => {
      other += 1;
      return read();
    };
    expect((await suggestion())?.profileId).toBe(IRACING);
    expect(other).toBe(0);
  });
});
