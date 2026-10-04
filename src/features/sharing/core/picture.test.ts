import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import { err, ok } from '../../../core/result';
import { sabotage } from '../../../../tests/sabotage';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { PicturePreviewView } from '../contract';
import {
  deviceGrid,
  deviceKind,
  escapeHtml,
  PICTURE_SIZES,
  pictureHtml,
  pictureModel,
  pngSize,
  type PictureModel,
} from './picture';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'share-picture'): Promise<WiredApp> {
  const app = await wiredApp(scenario, { files: [] });
  apps.push(app);
  return app;
}

async function profileOf(app: WiredApp, id: string): Promise<Profile> {
  const loaded = await app.wiring.context.profiles.get(id);
  if (!loaded.ok) throw new Error(loaded.error.message);
  return loaded.value;
}

/** What the page says, without its markup and its style sheet. */
const wordsOf = (html: string): string =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('what the picture of a setup shows', () => {
  it('names the setup and its game, and draws the monitors of its layout by the names the owner gave them', async () => {
    const app = await start();
    const model = await pictureModel(app.wiring.context, await profileOf(app, 'dcs-f-a-18c'));
    expect(model.name).toBe('DCS F/A-18C');
    expect(model.game).toBe('DCS World');
    expect(model.monitorsFrom).toBe('setup');
    // The Dell is off in this setup: it is not in the picture.
    expect(model.monitors).toEqual([
      { label: 'LC49G95T', x: 0, y: 0, width: 5120, height: 1440, primary: true },
      { label: 'MFD left', x: 5120, y: 0, width: 768, height: 1024, primary: false },
      { label: 'MFD centre', x: 5888, y: 0, width: 768, height: 1024, primary: false },
      { label: 'MFD right', x: 6656, y: 0, width: 768, height: 1024, primary: false },
    ]);
  });

  it('lists every controller once, with the name the owner gave it, what it is, and an icon for its kind', async () => {
    const app = await start();
    const model = await pictureModel(app.wiring.context, await profileOf(app, 'dcs-f-a-18c'));
    expect(
      model.devices.map((d) => `${d.kind}: ${d.name}${d.model ? ` (${d.model})` : ''}`)
    ).toEqual([
      'stick: Stick (WINWING Orion Joystick Base 2 + JGRIP-F16)',
      'throttle: Throttle (WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R)',
      'pedals: Pedals (T-Pendular-Rudder)',
      'screen: Left MFD (WINWING MFD1-L)',
      'screen: Centre MFD (WINWING MFD1-C)',
      'screen: Right MFD (WINWING MFD1-R)',
      'panel: WINWING UFC1 + HUD1',
      'panel: WINWING F18 STARTUP PANEL',
      'panel: WINWING F18 TAKEOFF PANEL 2',
      'panel: R-VPC Panel #1',
      'tracker: TrackIR 5',
      'deck: Stream Deck XL',
    ]);
    expect(model.devices.filter((d) => d.optional).map((d) => d.name)).toEqual(['Stream Deck XL']);
    expect(model.apps).toEqual([
      { name: 'TrackIR5', optional: false },
      { name: 'SimAppPro', optional: false },
      { name: 'Stream Deck', optional: true },
    ]);
  });

  it('shows a device once when the setup checks it both in general and by its serial, and leaves out what is switched off', async () => {
    const app = await start();
    const squadron = await profileOf(app, 'squadron-f-a-18c');
    // "Pedals (by serial)" and "T-Pendular-Rudder" are the same pedals.
    const pedals = squadron.checks.filter((c) => c.params['productId'] === 'B68F');
    expect(pedals).toHaveLength(2);
    const model = await pictureModel(app.wiring.context, squadron);
    expect(model.devices.filter((d) => d.kind === 'pedals')).toEqual([
      { name: 'Pedals', model: 'T-Pendular-Rudder', kind: 'pedals', optional: false },
    ]);
    expect(model.devices).toHaveLength(12);

    const without: Profile = {
      ...squadron,
      checks: squadron.checks.map((c) =>
        c.title === 'TrackIR 5' || c.title === 'SimAppPro' ? { ...c, disabled: true } : c
      ),
    };
    const fewer = await pictureModel(app.wiring.context, without);
    expect(fewer.devices.map((d) => d.name)).not.toContain('TrackIR 5');
    expect(fewer.apps.map((a) => a.name)).toEqual(['TrackIR5', 'Stream Deck']);
  });

  it('draws the monitors as they are now for a setup that does not arrange them, and says which', async () => {
    const app = await start();
    const loaded = await profileOf(app, 'dcs-f-a-18c');
    const plain: Profile = {
      ...loaded,
      game: 'star-hauler',
      checks: loaded.checks.filter((c) => c.type !== 'display.layout'),
    };
    const model = await pictureModel(app.wiring.context, plain);
    expect(model.monitorsFrom).toBe('now');
    expect(model.monitors.map((m) => m.label)).toEqual([
      'LC49G95T',
      'MFD left',
      'MFD centre',
      'MFD right',
    ]);
    // A game RigReady has no module for is called what the setup calls it.
    expect(model.game).toBe('star-hauler');

    // A layout that gives no sizes takes them from the monitors that are connected, turned
    // as the layout turns them; one that is not connected stands in as full HD.
    const loose: Profile = {
      ...loaded,
      checks: loaded.checks.map((c) =>
        c.type !== 'display.layout'
          ? c
          : {
              ...c,
              params: {
                displays: [
                  ...(c.params['displays'] as { id: string; rotation: number }[])
                    .filter((d) => d.rotation === 90)
                    .slice(0, 1)
                    .map((d) => ({ ...d, width: undefined, height: undefined, rotation: 0 })),
                  { id: 'tv', name: 'TV', enabled: true, x: 0, y: -1080, rotation: 0 },
                  { id: 'side', name: 'Side', enabled: true, x: -1080, y: 0, rotation: 270 },
                ],
              },
            }
      ),
    };
    const sized = await pictureModel(app.wiring.context, loose);
    expect(sized.monitors.map((m) => `${m.label} ${m.width}x${m.height}`)).toEqual([
      'MFD left 1024x768',
      'TV 1920x1080',
      'Side 1080x1920',
    ]);

    // No monitor to be read at all: the picture says so instead of drawing something.
    app.ports.displays.read = async () => err('display.read', 'The display driver did not answer.');
    const none = await pictureModel(app.wiring.context, plain);
    expect(none.monitorsFrom).toBe('none');
    expect(none.monitors).toEqual([]);
    expect(pictureHtml(none, 'wide')).toContain('This setup does not arrange the monitors.');
  });

  it('tells the kinds of gear apart by what they are called', () => {
    const kinds: [string, string][] = [
      ['WINWING Orion Joystick Base 2 + JGRIP-F16', 'stick'],
      ['WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R', 'throttle'],
      ['T-Pendular-Rudder', 'pedals'],
      ['Thrustmaster TPR', 'pedals'],
      ['FANATEC Podium Wheel Base DD2', 'wheel'],
      ['WINWING MFD1-L', 'screen'],
      ['WINWING UFC1 + HUD1', 'panel'],
      ['R-VPC Panel #1', 'panel'],
      ['TrackIR 5', 'tracker'],
      ['Stream Deck XL', 'deck'],
      ['Logitech Extreme 3D', 'other'],
    ];
    for (const [name, kind] of kinds) expect(deviceKind(name), name).toBe(kind);
    // The owner's name counts too: a device called "Collective" is not a generic controller.
    expect(deviceKind('Collective', 'VKB Sim T-Rudder')).toBe('pedals');
    expect(deviceKind('Collective', 'Some USB device')).toBe('throttle');
    expect(deviceKind(undefined, undefined)).toBe('other');
  });
});

describe('nothing personal is in the picture', () => {
  it('has no serial, user name, PC name, path, device id or monitor id, whatever the setup and the names say', async () => {
    const app = await wiredApp('share-picture', {
      files: [],
      beforeWiring: async (rig) => {
        // The owner named a monitor and a device after themselves and the PC.
        const machine = rig.ports.folders.machineName();
        const user = path.basename(rig.home);
        const root = rig.ports.folders.dataRoot();
        const names = JSON.parse(
          await fs.readFile(path.join(root, 'displays', 'names.json'), 'utf8')
        ) as { names: Record<string, string> };
        const first = Object.keys(names.names)[0]!;
        names.names[first] = `${machine} left screen`;
        await fs.writeFile(path.join(root, 'displays', 'names.json'), JSON.stringify(names));
        const devices = JSON.parse(await fs.readFile(path.join(root, 'devices.json'), 'utf8')) as {
          names: { productId: string; name: string }[];
        };
        devices.names.find((n) => n.productId === 'BEA8')!.name = `${user}'s stick`;
        await fs.writeFile(path.join(root, 'devices.json'), JSON.stringify(devices));
      },
    });
    apps.push(app);
    const machine = app.ports.folders.machineName();
    const user = path.basename(app.home);
    const squadron = await profileOf(app, 'squadron-f-a-18c');
    const personal: Profile = {
      ...squadron,
      name: `${user} on ${machine}: F/A-18C`,
      checks: [
        ...squadron.checks,
        {
          id: 'throttle-serial',
          type: 'device.connected',
          title: 'Throttle WW0099887766',
          required: true,
          params: { vendorId: '4098', productId: 'BD26', serial: 'WW0099887766' },
        },
        {
          id: 'helper',
          type: 'process.running',
          title: `Helper in ${path.join(app.home, 'Documents', 'Tools')}`,
          required: true,
          params: { name: 'Helper.exe' },
        },
      ],
    };
    const model = await pictureModel(app.wiring.context, personal);
    // The names are still told, with what is personal taken out of them.
    expect(model.name).toBe('user on my-pc: F/A-18C');
    expect(model.monitors[1]!.label).toBe('my-pc left screen');
    expect(model.devices.find((d) => d.kind === 'stick')).toMatchObject({
      name: "user's stick",
      kind: 'stick',
    });
    expect(model.apps.at(-1)!.name).toBe('Helper in {DOCUMENTS}\\Tools');

    for (const shape of ['wide', 'square'] as const) {
      const html = pictureHtml(model, shape);
      for (const secret of [
        user,
        machine,
        'TPR0012345',
        'WW0099887766',
        app.home,
        app.home.replace(/\\/g, '/'),
        'display#',
        '{e6f07b5f',
        'VID_',
        '044F',
        'B68F',
        'BEA8',
        '.exe',
        'C:\\',
      ]) {
        expect(html, `${shape}: ${secret}`).not.toContain(secret);
      }
      // And what a reader may see is there.
      const words = wordsOf(html);
      expect(words).toContain('user on my-pc: F/A-18C');
      expect(words).toContain('DCS World');
      expect(words).toContain('Throttle');
    }
  });

  it('is a page without script or outside files, with every name written as text', async () => {
    const hostile: PictureModel = {
      name: '<script>alert(1)</script> & "co"',
      game: "<img src=x onerror='x'>",
      monitors: [{ label: '<b>big</b>', x: 0, y: 0, width: 1920, height: 1080, primary: true }],
      monitorsFrom: 'setup',
      devices: [{ name: '</div><script>x', model: '"quoted"', kind: 'stick', optional: true }],
      apps: [{ name: '<iframe>', optional: false }],
    };
    const html = pictureHtml(hostile, 'wide');
    // No element that runs or fetches anything, no handler on any element, nothing from outside.
    expect(html).not.toMatch(/<script|<iframe|<img|<link|<object|<embed|url\(|@import/i);
    expect(html).not.toMatch(/<[^>]*\s(on\w+|href|src)=/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;co&quot;');
    expect(html).toContain('&lt;b&gt;big&lt;/b&gt;');
    expect(html).toContain('&quot;quoted&quot; · optional');
    expect(escapeHtml(`a'b`)).toBe('a&#39;b');
  });
});

describe('the page of the picture', () => {
  const model = (devices: number, apps = 3): PictureModel => ({
    name: 'DCS F/A-18C',
    game: 'DCS World',
    monitors: [
      { label: 'LC49G95T', x: 0, y: 0, width: 5120, height: 1440, primary: true },
      { label: 'MFD left', x: 5120, y: 0, width: 768, height: 1024, primary: false },
    ],
    monitorsFrom: 'setup',
    devices: Array.from({ length: devices }, (_, i) => ({
      name: `Device ${i + 1}`,
      kind: 'panel' as const,
      optional: false,
    })),
    apps: Array.from({ length: apps }, (_, i) => ({ name: `App ${i + 1}`, optional: i === 0 })),
  });

  it('is exactly 1920 by 1080, or 1080 square, and says what is in it', () => {
    for (const shape of ['wide', 'square'] as const) {
      const { width, height } = PICTURE_SIZES[shape];
      const html = pictureHtml(model(12), shape);
      expect(html).toContain(`html,body{width:${width}px;height:${height}px`);
      expect(html).toContain(`data-shape="${shape}"`);
      const words = wordsOf(html);
      expect(words).toContain('DCS F/A-18C');
      expect(words).toContain('DCS World');
      expect(words).toContain('Monitors · 2');
      expect(words).toContain('Controllers · 12');
      expect(words).toContain('Helper apps · 3');
      expect(words).toContain('2 monitors · 12 controllers · 3 helper apps');
      expect(words).toContain('5120 × 1440');
      expect(words).toContain('App 1 optional');
      expect(words).toContain('Made with RigReady');
      expect(html.match(/class="dev"/g)).toHaveLength(12);
      expect(html.match(/class="mon[ "]/g)).toHaveLength(2);
      expect(html).toContain('class="mon main"');
    }
    expect(PICTURE_SIZES.wide.width / PICTURE_SIZES.wide.height).toBeCloseTo(16 / 9, 5);
  });

  it('draws the monitors to scale: the same pixels per desktop pixel across and down', () => {
    const html = pictureHtml(model(4), 'wide');
    const box = (label: string): { width: number; height: number; left: number } => {
      const match = new RegExp(
        `data-monitor="${label}" style="left:([\\d.]+)px;top:[\\d.]+px;width:([\\d.]+)px;height:([\\d.]+)px"`
      ).exec(html)!;
      return { left: Number(match[1]), width: Number(match[2]), height: Number(match[3]) };
    };
    const wide = box('LC49G95T');
    const mfd = box('MFD left');
    const scale = wide.width / 5120;
    expect(wide.height / 1440).toBeCloseTo(scale, 2);
    expect(mfd.width / 768).toBeCloseTo(scale, 2);
    expect(mfd.height / 1024).toBeCloseTo(scale, 2);
    // Side by side, with no gap that is not there on the desktop.
    expect(mfd.left).toBeCloseTo(wide.left + wide.width, 0);
  });

  it('leaves out the helper apps when there are none, and says so for one of each', () => {
    const alone: PictureModel = { ...model(1, 0), monitors: model(1).monitors.slice(0, 1) };
    const words = wordsOf(pictureHtml(alone, 'square'));
    expect(words).not.toContain('Helper apps');
    expect(words).toContain('1 monitor · 1 controller');
    const one = wordsOf(pictureHtml({ ...model(0, 1) }, 'wide'));
    expect(one).toContain('1 helper app');
    expect(one).toContain('This setup checks no controllers.');
  });

  it('fits a small rig in big rows and a very big one in small rows, counting what does not fit', () => {
    expect(deviceGrid(3, 800, 700)).toEqual({
      columns: 1,
      shown: 3,
      rowHeight: 104,
      compact: false,
    });
    expect(deviceGrid(12, 800, 700)).toMatchObject({ columns: 2, shown: 12, compact: false });
    // The picture of the owner's rig: twelve controllers under the monitors, four across.
    expect(deviceGrid(12, 1776, 258)).toEqual({
      columns: 4,
      shown: 12,
      rowHeight: 86,
      compact: false,
    });
    // Too many for comfortable rows: smaller ones, all of them still shown, using the room.
    expect(deviceGrid(12, 960, 313)).toEqual({
      columns: 3,
      shown: 12,
      rowHeight: 74,
      compact: true,
    });
    expect(deviceGrid(24, 800, 700)).toEqual({
      columns: 2,
      shown: 24,
      rowHeight: 58,
      compact: true,
    });
    const huge = deviceGrid(60, 800, 700);
    expect(huge).toEqual({ columns: 2, shown: 24, rowHeight: 58, compact: true });
    const html = pictureHtml(model(60), 'wide');
    expect(wordsOf(html)).toContain('Controllers · 60');
    expect(html).toContain('devs compact');
    expect(html).toMatch(/and \d+ more/);
    // What is shown and what is counted add up to all of them.
    const shown = (html.match(/class="dev"/g) ?? []).length;
    const more = Number(/and (\d+) more/.exec(html)![1]);
    expect(shown + more).toBe(60);
  });

  it('reads the size of a PNG from its header, and knows what is not one', () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(pngSize(new TextEncoder().encode('this is not a picture at all, just text'))).toBe(
      undefined
    );
  });
});

describe('previewing and saving the picture', () => {
  it('previews exactly the picture that would be saved, at the size of its shape', async () => {
    const app = await start();
    // What the Render port is handed.
    const asked: { size: string; html: string }[] = [];
    const real = app.ports.render.png.bind(app.ports.render);
    app.ports.render.png = async (html, size) => {
      asked.push({ size: `${size.width}x${size.height}`, html });
      return real(html, size);
    };
    const wide = await app.invoke<PicturePreviewView>('sharing:picturePreview', {
      profileId: 'dcs-f-a-18c',
    });
    expect(wide).toMatchObject({
      width: 1920,
      height: 1080,
      monitors: 4,
      controllers: 12,
      apps: 3,
      monitorsFrom: 'setup',
    });
    expect(wide.image.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(wide.image.slice('data:image/png;base64,'.length), 'base64');
    expect(pngSize(bytes)).toEqual({ width: 1920, height: 1080 });
    const square = await app.invoke<PicturePreviewView>('sharing:picturePreview', {
      profileId: 'dcs-f-a-18c',
      shape: 'square',
    });
    expect(square).toMatchObject({ width: 1080, height: 1080 });
    // The Render port was handed the page at each size, and nothing was written or asked.
    expect(asked.map((a) => a.size)).toEqual(['1920x1080', '1080x1080']);
    expect(asked[0]!.html).toContain('DCS F/A-18C');
    expect(asked[1]!.html).toContain('data-shape="square"');
    expect(app.ports.dialogs.calls).toEqual([]);
    await expect(
      app.invoke('sharing:picturePreview', { profileId: 'no-such-setup' })
    ).rejects.toThrow();
  });

  it('saves where the user says, and answers only once the file has been read back', async () => {
    const app = await start();
    app.ports.dialogs.script.save.push('Documents/my rig', null);
    const saved = await app.invoke<{ path: string; size: number; width: number; height: number }>(
      'sharing:savePicture',
      { profileId: 'dcs-f-a-18c', shape: 'square' }
    );
    // The extension is added when the user left it out.
    expect(saved.path).toBe(path.join(app.home, 'Documents', 'my rig.png'));
    const onDisk = await fs.readFile(saved.path);
    expect(onDisk.length).toBe(saved.size);
    expect(pngSize(onDisk)).toEqual({ width: 1080, height: 1080 });
    expect(saved).toMatchObject({ width: 1080, height: 1080 });
    const asked = app.ports.dialogs.calls.at(-1)!;
    expect(asked.kind).toBe('save');
    expect(asked.options).toMatchObject({
      title: 'Save a picture of this setup',
      defaultPath: path.join(app.ports.folders.documents(), 'DCS F-A-18C (square).png'),
      filters: [{ name: 'PNG picture', extensions: ['png'] }],
    });
    // It is in the journal like every file RigReady writes outside its own folder.
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value[0]).toMatchObject({
      path: saved.path,
      reason: 'Save a picture of DCS F/A-18C',
    });

    // Cancelled: nothing is written and nothing is claimed.
    expect(await app.invoke('sharing:savePicture', { profileId: 'dcs-f-a-18c' })).toBeNull();
  });

  it('does not say saved when the file is not the picture afterwards', async () => {
    const app = await start();
    app.ports.dialogs.script.save.push('Documents/gone.png');
    const undo = sabotage(app.ports);
    await expect(app.invoke('sharing:savePicture', { profileId: 'dcs-f-a-18c' })).rejects.toThrow(
      /is not the picture that was written/
    );
    undo.restore();
    await expect(fs.stat(path.join(app.home, 'Documents', 'gone.png'))).rejects.toThrow();
  });

  it('refuses a picture that came out at another size, tries again when the first capture fails, and gives up with the reason', async () => {
    const app = await start();
    const real = app.ports.render.png.bind(app.ports.render);
    app.ports.render.png = async (html, size) => real(html, { width: 640, height: size.height });
    await expect(
      app.invoke('sharing:picturePreview', { profileId: 'dcs-f-a-18c' })
    ).rejects.toThrow(/did not come out at the size/);

    // The first capture of a new window can come too early: the same request then works.
    let calls = 0;
    app.ports.render.png = async (html, size) =>
      ++calls < 3 ? err('render.png', 'Could not render the image.') : real(html, size);
    expect(
      await app.invoke<PicturePreviewView>('sharing:picturePreview', { profileId: 'dcs-f-a-18c' })
    ).toMatchObject({ width: 1920 });
    expect(calls).toBe(3);

    app.ports.render.png = async () => err('render.png', 'Could not render the image.');
    await expect(
      app.invoke('sharing:picturePreview', { profileId: 'dcs-f-a-18c' })
    ).rejects.toThrow(/Could not render the image/);
    app.ports.dialogs.script.save.push('Documents/never.png');
    await expect(app.invoke('sharing:savePicture', { profileId: 'dcs-f-a-18c' })).rejects.toThrow(
      /Could not render the image/
    );
    // It never got as far as asking where to save.
    expect(app.ports.dialogs.calls).toEqual([]);

    // A Save dialog that fails is said, and a file that cannot be written too.
    app.ports.render.png = real;
    app.ports.dialogs.save = async () => err('dialog.save', 'The Save dialog could not be shown.');
    await expect(app.invoke('sharing:savePicture', { profileId: 'dcs-f-a-18c' })).rejects.toThrow(
      /Save dialog could not be shown/
    );
    app.ports.dialogs.save = async () => ok(path.join(app.home, 'Documents', 'blocked.png'));
    app.ports.files.write = async () => err('file.write', 'The disk is full.');
    await expect(app.invoke('sharing:savePicture', { profileId: 'dcs-f-a-18c' })).rejects.toThrow(
      /The disk is full/
    );
    await expect(
      app.invoke('sharing:savePicture', { profileId: 'no-such-setup' })
    ).rejects.toThrow();
  });
});
