import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Render } from '../../../core/ports';
import { err, ok } from '../../../core/result';
import type { FakeRender } from '../../../platform/fake';
import { pngSize } from '../../../platform/fake/png';
import { KNEEBOARD_CHECK, KNEEBOARD_REGENERATE } from './check';
import { fileNamePart, renderPage } from './kneeboard';

/**
 * Kneeboard pages on the recorded rig: PNGs in Saved Games\DCS\Kneeboard\<aircraft type>,
 * written through FileStore, with a manifest of what RigReady wrote.
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];

interface Outcome {
  folder: string;
  written: string[];
  removed: string[];
  kept: string[];
}
interface Status {
  state: string;
  summary: string;
  folder?: string;
  pages: string[];
}

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(scenario = 'cheat-sheets-hornet'): Promise<{ app: WiredApp; folder: string }> {
  app = await wiredApp(scenario, { files: FILES });
  return {
    app,
    folder: path.join(app.home, 'Saved Games', 'DCS', 'Kneeboard', 'FA-18C_hornet'),
  };
}

const exportPages = (running: WiredApp, options: Record<string, unknown> = {}): Promise<Outcome> =>
  running.invoke<Outcome>('cheat-sheets:exportKneeboard', { ...HORNET, options });
const status = (running: WiredApp): Promise<Status> =>
  running.invoke<Status>('cheat-sheets:kneeboardStatus', HORNET);

describe('exporting kneeboard pages', () => {
  it('writes one PNG per device, sized and named for the kneeboard, into the aircraft’s folder', async () => {
    const { app: running, folder } = await start();
    expect(await status(running)).toMatchObject({
      state: 'none',
      summary: 'No kneeboard pages exported for F/A-18C',
      folder,
    });
    const outcome = await exportPages(running);
    expect(outcome.folder).toBe(folder);
    expect(outcome.kept).toEqual([]);
    // The summary first, then the eleven devices with something bound; the bare ICP is left out.
    expect(outcome.written).toHaveLength(12);
    expect(outcome.written.slice(0, 4)).toEqual([
      'RigReady - 01 - Key actions.png',
      'RigReady - 02 - Stick.png',
      'RigReady - 03 - Throttle.png',
      'RigReady - 04 - Pedals.png',
    ]);
    expect(outcome.written.some((n) => n.includes('ICP'))).toBe(false);
    const names = (await fs.readdir(folder)).sort();
    expect(names).toEqual([...outcome.written].sort());
    for (const name of names) {
      // DCS only takes a lower-case extension, and shows pages in name order.
      expect(name).toMatch(/^RigReady - \d\d - [\x20-\x7E]+\.png$/);
      expect(pngSize(new Uint8Array(await fs.readFile(path.join(folder, name))))).toEqual({
        width: 768,
        height: 1024,
      });
    }
    const pages = (running.ports.render as FakeRender).calls.filter((c) => c.kind === 'png');
    expect(pages).toHaveLength(12);
    expect(pages.every((c) => c.width === 768 && c.height === 1024)).toBe(true);
    expect(pages[1]!.html).toContain('>Stick<');
    expect(await status(running)).toMatchObject({
      state: 'current',
      summary: '12 kneeboard pages for F/A-18C match the bindings',
      pages: outcome.written,
    });
  });

  it('goes through FileStore: one action in the journal, and Undo takes the pages away again', async () => {
    const { app: running, folder } = await start();
    await exportPages(running, { devices: ['4098:BEA8'], summary: false });
    const groups = await running.ports.files.journalGroups();
    if (!groups.ok) throw new Error(groups.error.message);
    const group = groups.value.find((g) => g.reason === 'Export 1 kneeboard page for F/A-18C')!;
    expect(group.entries.map((e) => path.basename(e.path))).toEqual(['RigReady - 01 - Stick.png']);
    expect(group.entries[0]!.reason).toBe('Kneeboard page RigReady - 01 - Stick.png');
    const undone = await running.ports.files.undoGroup(group.id);
    expect(undone.ok).toBe(true);
    expect(await fs.readdir(folder)).toEqual([]);
    expect(await status(running)).toMatchObject({
      state: 'missing',
      summary: 'The kneeboard pages for F/A-18C are gone from the Kneeboard folder',
    });
  });

  it('writes a day and a night set, and large-print list pages when asked', async () => {
    const { app: running } = await start();
    const outcome = await exportPages(running, {
      devices: ['4098:BEA8'],
      styles: ['night', 'light'],
      lists: true,
    });
    expect(outcome.written).toEqual([
      'RigReady - 01 - Key actions (day).png',
      'RigReady - 02 - Stick (day).png',
      'RigReady - 03 - Stick list (day).png',
      'RigReady - N01 - Key actions (night).png',
      'RigReady - N02 - Stick (night).png',
      'RigReady - N03 - Stick list (night).png',
    ]);
    const html = (running.ports.render as FakeRender).calls
      .filter((c) => c.kind === 'png')
      .map((c) => c.html);
    expect(html[1]).toContain('class="k-light"');
    expect(html[4]).toContain('class="k-night"');
    expect(html[2]).toContain('Weapon Release Button');
    const night = await exportPages(running, {
      devices: ['4098:BEA8'],
      styles: ['night'],
      summary: false,
    });
    expect(night.written).toEqual(['RigReady - 01 - Stick (night).png']);
    expect(night.removed).toHaveLength(6);
  });

  it('never overwrites or removes a page that is not its own', async () => {
    const { app: running, folder } = await start();
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'my-own.png'), 'mine');
    await fs.writeFile(path.join(folder, 'RigReady - 01 - Stick.png'), 'also mine');
    const first = await exportPages(running, {
      devices: ['4098:BEA8', '4098:BD26'],
      summary: false,
    });
    // The name is taken by a file of the user's: RigReady's page gets another name.
    expect(first.written).toEqual([
      'RigReady - 01 - Stick (2).png',
      'RigReady - 02 - Throttle.png',
    ]);
    expect(first.kept).toEqual(['RigReady - 01 - Stick.png']);
    expect(await fs.readFile(path.join(folder, 'RigReady - 01 - Stick.png'), 'utf8')).toBe(
      'also mine'
    );

    // The user edits one of RigReady's pages: from then on it is theirs.
    await fs.writeFile(path.join(folder, 'RigReady - 02 - Throttle.png'), 'my drawing over it');
    const second = await exportPages(running, { devices: ['4098:BEA8'], summary: false });
    expect(second.written).toEqual(['RigReady - 01 - Stick (2).png']);
    expect(second.removed).toEqual([]);
    expect(second.kept).toEqual(['RigReady - 01 - Stick.png', 'RigReady - 02 - Throttle.png']);
    expect(await fs.readFile(path.join(folder, 'RigReady - 02 - Throttle.png'), 'utf8')).toBe(
      'my drawing over it'
    );

    // Removing takes only what RigReady wrote and nobody changed.
    await fs.writeFile(path.join(folder, 'RigReady - 01 - Stick (2).png'), 'changed too');
    await exportPages(running, { devices: ['4098:BD26'], summary: false });
    const removed = await running.invoke<{ removed: string[]; kept: string[] }>(
      'cheat-sheets:removeKneeboard',
      HORNET
    );
    expect(removed.removed).toEqual(['RigReady - 01 - Throttle.png']);
    expect((await fs.readdir(folder)).sort()).toEqual([
      'RigReady - 01 - Stick (2).png',
      'RigReady - 01 - Stick.png',
      'RigReady - 02 - Throttle.png',
      'my-own.png',
    ]);
    expect(await status(running)).toMatchObject({ state: 'none' });
    expect(await running.invoke('cheat-sheets:removeKneeboard', HORNET)).toEqual({
      removed: [],
      kept: [],
    });
  });

  it('replaces its own pages on the next export and removes the ones no longer wanted', async () => {
    const { app: running, folder } = await start();
    await exportPages(running);
    const again = await exportPages(running, { devices: ['4098:BEA8'], summary: false });
    expect(again.written).toEqual(['RigReady - 01 - Stick.png']);
    expect(again.removed).toHaveLength(12);
    expect(await fs.readdir(folder)).toEqual(['RigReady - 01 - Stick.png']);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(running.ports.folders.dataRoot(), 'cheat-sheets', 'kneeboard.json'),
        'utf8'
      )
    );
    expect(manifest.exports.FA_18C_hornet).toBeUndefined();
    expect(manifest.exports['FA-18C_hornet']).toMatchObject({
      folder,
      aircraftName: 'F/A-18C',
      options: { devices: ['4098:BEA8'], styles: ['light'], summary: false, lists: false },
      pages: [
        {
          file: 'RigReady - 01 - Stick.png',
          kind: 'device',
          style: 'light',
          deviceKey: '4098:BEA8',
        },
      ],
    });
    expect(manifest.exports['FA-18C_hornet'].pages[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('writes nothing when a page cannot be rendered, or when there is nothing to export', async () => {
    const { app: running, folder } = await start();
    const real = running.ports.render.png.bind(running.ports.render);
    let calls = 0;
    running.ports.render.png = async (html, size) =>
      ++calls > 2 ? err('render.size', 'No more pictures today.') : real(html, size);
    await expect(exportPages(running)).rejects.toThrow(/No more pictures today/);
    expect(await fs.readdir(folder).catch(() => [])).toEqual([]);
    running.ports.render.png = real;
    await expect(
      exportPages(running, { devices: ['4098:BF06'], summary: false })
    ).resolves.toMatchObject({ written: ['RigReady - 01 - WinWing ICP.png'] });
    await expect(exportPages(running, { devices: ['nothing'], summary: false })).rejects.toThrow(
      /nothing to export/
    );
    await expect(
      running.invoke('cheat-sheets:exportKneeboard', { game: 'dcs', aircraftId: '..', options: {} })
    ).rejects.toThrow(/not an aircraft type/);
    await expect(
      running.invoke('cheat-sheets:kneeboardStatus', { game: 'iracing', aircraftId: 'x' })
    ).rejects.toThrow();
  });

  it('tries a capture again when the first frame was not there yet', async () => {
    let calls = 0;
    const flaky: Render = {
      png: async () =>
        ++calls < 3 ? err('render.png', 'Could not render the image.') : ok(new Uint8Array([1])),
      pdf: async () => ok(new Uint8Array()),
    };
    expect(await renderPage(flaky, '<html></html>', { width: 10, height: 10 })).toEqual(
      ok(new Uint8Array([1]))
    );
    expect(calls).toBe(3);
    calls = -10;
    expect((await renderPage(flaky, '<html></html>', { width: 10, height: 10 })).ok).toBe(false);
    expect(calls).toBe(-6);
    expect(fileNamePart('Left: MFD / "one" ✈ ')).toBe('Left MFD one');
    expect(fileNamePart('***')).toBe('Device');
  });
});

describe('the check "kneeboard pages are up to date"', () => {
  const params = { game: 'dcs', aircraft: 'FA-18C_hornet', aircraftName: 'F/A-18C' };

  it('passes while the pages show what is bound, and fails once a note or a binding changes', async () => {
    const { app: running, folder } = await start();
    const { checks } = running.wiring.context;
    const run = () => checks.check(KNEEBOARD_CHECK)!.run(params, running.ctx);
    expect(await run()).toMatchObject({
      pass: false,
      summary: 'No kneeboard pages exported for F/A-18C',
    });

    await exportPages(running, { devices: ['4098:BEA8', '4098:BD26'] });
    expect(await run()).toMatchObject({
      pass: true,
      summary: '3 kneeboard pages for F/A-18C match the bindings',
    });

    // A note on the stick: its page no longer says what the sheet says.
    await running.invoke('cheat-sheets:setNote', {
      ...HORNET,
      deviceKey: '4098:BEA8',
      control: 'button:20',
      note: 'hold',
    });
    expect(await run()).toMatchObject({
      pass: false,
      summary: 'The kneeboard pages for F/A-18C no longer match the bindings',
    });

    // The fix writes them again with the options of the last export.
    const fix = checks.remediation(KNEEBOARD_REGENERATE)!;
    expect(fix.describe(params)).toBe('Write the cheat sheet kneeboard pages for F/A-18C again');
    const fixed = await fix.run(params, running.ctx);
    expect(fixed).toEqual(ok(`Wrote 3 kneeboard pages to ${folder}`));
    expect(await run()).toMatchObject({ pass: true });

    // A binding changes: the stick's weapon release moves away from button 20.
    const dir = path.join(
      running.home,
      'Saved Games',
      'DCS',
      'Config',
      'Input',
      'FA-18C_hornet',
      'joystick'
    );
    const file = (await fs.readdir(dir)).find((n) => n.startsWith('WINWING Orion Joystick'))!;
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    expect(text).toContain('JOY_BTN20');
    await fs.writeFile(path.join(dir, file), text.replaceAll('JOY_BTN20', 'JOY_BTN21'));
    expect(await run()).toMatchObject({ pass: false, summary: /no longer match the bindings/ });
    expect((await fix.run(params, running.ctx)).ok).toBe(true);
    expect(await run()).toMatchObject({ pass: true });

    // A page deleted by hand is noticed too.
    await fs.rm(path.join(folder, 'RigReady - 02 - Stick.png'));
    expect(await run()).toMatchObject({
      pass: false,
      summary: '1 of 3 kneeboard pages for F/A-18C are missing',
    });
  });

  it('is proposed for a setup once pages exist, optional, with the fix that writes them again', async () => {
    const { app: running } = await start();
    const capture = running.wiring.context.checks
      .allCaptures()
      .find((c) => c.id === 'cheat-sheets')!;
    expect(await capture.capture(running.ctx)).toEqual(ok([]));
    await exportPages(running, { devices: ['4098:BEA8'], summary: false });
    const proposed = await capture.capture(running.ctx);
    if (!proposed.ok) throw new Error(proposed.error.message);
    expect(proposed.value).toHaveLength(1);
    expect(proposed.value[0]).toMatchObject({
      group: 'files',
      title: 'Kneeboard cheat sheet for F/A-18C is up to date',
      game: 'dcs',
      check: {
        type: KNEEBOARD_CHECK,
        required: false,
        params: { game: 'dcs', aircraft: 'FA-18C_hornet', aircraftName: 'F/A-18C' },
        remediation: { type: KNEEBOARD_REGENERATE },
      },
    });
  });

  it('on a PC without DCS, says the folder was not found instead of writing anywhere', async () => {
    const { app: running } = await start('generic-fresh');
    expect(await running.invoke('cheat-sheets:overview')).toEqual({ games: [] });
    const run = await running.wiring.context.checks
      .check(KNEEBOARD_CHECK)!
      .run(params, running.ctx);
    expect(run.pass).toBe(false);
    const fixed = await running.wiring.context.checks
      .remediation(KNEEBOARD_REGENERATE)!
      .run(params, running.ctx);
    expect(fixed.ok).toBe(false);
  });
});
