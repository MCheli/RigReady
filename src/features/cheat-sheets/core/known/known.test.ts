import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../../tests/helpers';
import { planList } from '../drawings';
import { pictureFor, renderPictureSvg } from '../picture';
import { actionIndex, deviceLabels, type Sheet, type SheetControl } from '../sheet';
import { KNOWN_DEVICES, knownDeviceFor, knownDevices, knownLabels, outOfShape } from '.';

/**
 * The devices RigReady can name the controls of without a drawing (see
 * docs/research/device-control-names.md): every map is valid and inside the device, each is
 * found by its USB id and by its name, and a Warthog stick plugged into the recorded rig
 * gets a controls list named the way Thrustmaster names it.
 */

describe('the shipped device maps', () => {
  it('all pass their schema', () => {
    const { devices, broken } = knownDevices();
    expect(broken).toEqual([]);
    expect(devices).toHaveLength(KNOWN_DEVICES.length);
    expect(new Set(devices.map((d) => d.id)).size).toBe(devices.length);
  });

  for (const device of knownDevices().devices) {
    describe(device.name, () => {
      it('names each control once and each input once, inside what the device reports', () => {
        const names = device.controls.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
        const inputs = device.controls.flatMap((c) => c.inputs.map((i) => i.id));
        expect(new Set(inputs).size).toBe(inputs.length);
        for (const id of inputs) expect(outOfShape(id, device.shape), id).toBeUndefined();
        // Every button the device reports has a name.
        for (let n = 1; n <= device.shape.buttons; n++) {
          if (device.id === 'saitek-x52-pro' && n >= 16 && n <= 19) continue;
          if (device.id === 'saitek-x52-pro' && n >= 32) continue;
          expect(inputs, `button ${n}`).toContain(`button:${n}`);
        }
        // Labels of one input are unique too: no two inputs read the same.
        const labels = [...knownLabels(device).values()];
        expect(new Set(labels).size).toBe(labels.length);
      });

      it('is found by its USB ids and by the name it reports', () => {
        for (const productId of device.match.productIds) {
          expect(
            knownDeviceFor({ vendorId: device.match.vendorId, productId, name: 'x' })?.id
          ).toBe(device.id);
        }
        for (const name of device.match.names) {
          expect(knownDeviceFor({ name: `  ${name.toUpperCase()} ` })?.id).toBe(device.id);
          expect(
            knownDeviceFor({ vendorId: device.match.vendorId, productId: 'FFFF', name })?.id
          ).toBe(device.id);
        }
      });
    });
  }

  it('does not take another vendor’s device with a similar name, nor an unknown one', () => {
    expect(
      knownDeviceFor({ vendorId: '1234', productId: '0402', name: 'Gamepad' })
    ).toBeUndefined();
    expect(
      knownDeviceFor({ vendorId: '1234', productId: '5678', name: 'T.16000M' })
    ).toBeUndefined();
    expect(knownDeviceFor({ name: 'Logitech Extreme 3D' })).toBeUndefined();
  });

  it('the Warthog stick: TG1 is button 1, S2 is 2, H2 is 7–10, H4 is 15–19, H1 the POV', () => {
    const stick = knownDeviceFor({ vendorId: '044f', productId: '0402' })!;
    const labels = knownLabels(stick);
    expect(labels.get('button:1')).toBe('TG trigger TG1 first');
    expect(labels.get('button:6')).toBe('TG trigger TG2 second');
    expect(labels.get('button:2')).toBe('S2 weapon release');
    expect(labels.get('button:7')).toBe('H2 TMS hat ↑');
    expect(labels.get('button:19')).toBe('H4 CMS hat Press');
    expect(labels.get('hat:1:UL')).toBe('H1 trim hat ↖');
    expect(labels.get('axis:X')).toBe('Stick Roll');
    const throttle = knownLabels(knownDeviceFor({ vendorId: '044F', productId: '0404' })!);
    expect(throttle.get('button:30')).toBe('Idle detents Left');
    expect(throttle.get('axis:RZ')).toBe('Throttles Left');
    expect(throttle.get('hat:1:U')).toBe('Coolie switch ↑');
  });

  it('a list of a known device has a block per physical control, and the others after it', () => {
    const stick = knownDeviceFor({ vendorId: '044F', productId: '0402' })!;
    const bound = (id: string, action: string): SheetControl => ({
      id,
      name: id,
      conflict: false,
      bindings: [
        {
          actionId: action,
          action,
          short: action,
          modifiers: [],
          category: [],
          kind: 'weapons',
          source: 'default',
          alsoOn: [],
        },
      ],
    });
    // An input the map leaves out (a fourth hat would be one) still gets a place.
    const controls = [bound('button:2', 'Weapon release'), bound('button:9', 'TMS aft')];
    const plan = planList(
      controls,
      { buttons: 24, axes: ['X', 'Y'], hats: 1 },
      {
        showEmpty: true,
        named: stick.controls,
      }
    );
    const heads = plan.callouts.map((c) => c.head);
    expect(heads).toContain('S2 weapon release · 2');
    expect(heads).toContain('H2 TMS hat · 7–10');
    expect(heads).toContain('H1 trim hat · H1');
    expect(heads).toContain('Stick · X, Y');
    expect(heads).toContain('Buttons 20–24');
    expect(heads).not.toContain('Axes');
    expect(heads).not.toContain('Hat 1');
    const tms = plan.callouts.find((c) => c.head === 'H2 TMS hat · 7–10')!;
    expect(tms.rows.map((r) => r.text)).toEqual(['↑ —', '→ —', '↓ TMS aft', '← —']);
    // Without the free inputs only what does something is left.
    const small = planList(
      controls,
      { buttons: 19, axes: ['X', 'Y'], hats: 1 },
      {
        named: stick.controls,
      }
    );
    expect(small.callouts.map((c) => c.head)).toEqual([
      'S2 weapon release · 2',
      'H2 TMS hat · 7–10',
    ]);
  });
});

describe('a Warthog stick on the recorded rig', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  it('gets the controls list named for it, with DCS’s Hornet defaults on its controls', async () => {
    app = await wiredApp('cheat-sheets-known-devices', {
      files: [
        'Saved Games/DCS/**',
        'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
        'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
        'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
      ],
    });
    const sheet = await app.invoke<Sheet>('cheat-sheets:sheet', {
      game: 'dcs',
      aircraftId: 'FA-18C_hornet',
    });
    const warthog = sheet.devices.find((d) => d.name === 'Joystick - HOTAS Warthog');
    expect(warthog, sheet.devices.map((d) => d.name).join(', ')).toBeDefined();
    const picture = pictureFor(warthog!);
    expect(picture).toMatchObject({ kind: 'list', known: { id: 'tm-warthog-stick' } });
    expect(deviceLabels(warthog!).get('button:2')).toBe('S2 weapon release');
    const release = warthog!.controls.find((c) => c.id === 'button:2');
    expect(release?.bindings.map((b) => b.action)).toContain('Weapon Release Button');
    const svg = renderPictureSvg(warthog!, { theme: 'night' });
    expect(svg).toContain('S2 weapon release · 2');
    expect(svg).toContain('H4 CMS hat · 15–19');
    // "Which control does weapon release?" names the physical control.
    const place = actionIndex(sheet)
      .find((e) => e.action === 'Weapon Release Button')
      ?.places.find((p) => p.device === warthog!.title);
    expect(place?.physical).toBe('S2 weapon release');
    // The owner's own devices keep their drawings and layouts.
    expect(pictureFor(sheet.devices.find((d) => d.title === 'Stick')!).kind).toBe('drawing');
  });
});
