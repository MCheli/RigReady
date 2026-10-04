/**
 * NFR-003 on the main side: a long backup gives the thread back between files, reports
 * progress, and can be cancelled before anything is written. (That the window keeps
 * answering while it runs is tests/e2e/nfr.e2e.ts; how long the real providers hold the
 * thread is tests/rig/performance.rig.test.ts.)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createZip, createZipInSteps, readZip, type ZipEntry } from '../../src/core/files/zip';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** Bytes that compress, but not to nothing. */
function filler(bytes: number): Uint8Array {
  const data = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) data[i] = (i * 31 + (i >> 9)) & 0x7f;
  return data;
}

describe('createZipInSteps', () => {
  const entries: ZipEntry[] = [
    { path: 'manifest.json', data: text('{"a":1}') },
    { path: 'items/0/Config/options.lua', data: text('options = {}\n') },
    { path: 'items/0/empty.txt', data: new Uint8Array(0) },
    // Larger than one slice, so it is compressed in several steps.
    { path: 'items/1/Logs/dcs.log', data: filler(2_600_000) },
    { path: 'folder/', data: new Uint8Array(0) },
  ];

  it('builds an archive with the same files and bytes as createZip', async () => {
    const stepped = await createZipInSteps(entries);
    const atOnce = createZip(entries);
    expect(stepped.ok && atOnce.ok).toBe(true);
    if (!stepped.ok || !atOnce.ok) return;
    const a = readZip(stepped.value);
    const b = readZip(atOnce.value);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const flat = (list: ZipEntry[]): [string, number, string][] =>
      list
        .map((e): [string, number, string] => [
          e.path,
          e.data.length,
          Buffer.from(e.data.subarray(0, 64)).toString('hex'),
        ])
        .sort(([x], [y]) => x.localeCompare(y));
    expect(flat(a.value)).toEqual(flat(b.value));
    expect(a.value.map((e) => e.path).sort()).toEqual([
      'items/0/Config/options.lua',
      'items/0/empty.txt',
      'items/1/Logs/dcs.log',
      'manifest.json',
    ]);
    const log = a.value.find((e) => e.path.endsWith('dcs.log'))!;
    expect(Buffer.from(log.data).equals(Buffer.from(entries[3]!.data))).toBe(true);
    // It compressed: the archive is smaller than what went in.
    expect(stepped.value.length).toBeLessThan(2_600_000);
  });

  it('gives the thread back between files and between the slices of a big file, and reports each file', async () => {
    let turns = 0;
    let stop = false;
    const spin = (): void => {
      turns++;
      if (!stop) setImmediate(spin);
    };
    setImmediate(spin);
    const seen: [number, number][] = [];
    const zipped = await createZipInSteps(entries, {
      onFile: (done, total) => seen.push([done, total]),
    });
    stop = true;
    expect(zipped.ok).toBe(true);
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    // Four files and a 2.6 MB file in 1 MB slices: other work ran at least six times meanwhile.
    expect(turns).toBeGreaterThanOrEqual(6);
  });

  it('stops with zip.cancelled when asked, before, between files and inside a big file', async () => {
    expect(await createZipInSteps(entries, { cancelled: () => true })).toMatchObject({
      ok: false,
      error: { code: 'zip.cancelled' },
    });
    let files = 0;
    expect(
      await createZipInSteps(entries, { onFile: () => files++, cancelled: () => files >= 2 })
    ).toMatchObject({ ok: false, error: { code: 'zip.cancelled' } });
    expect(files).toBe(2);
    let asked = 0;
    expect(await createZipInSteps([entries[3]!], { cancelled: () => ++asked >= 3 })).toMatchObject({
      ok: false,
      error: { code: 'zip.cancelled' },
    });
    // Cancelled after the last file was compressed: still nothing is handed back.
    let done = false;
    expect(
      await createZipInSteps(entries.slice(0, 2), {
        onFile: (n, total) => (done = n === total),
        cancelled: () => done,
      })
    ).toMatchObject({ ok: false, error: { code: 'zip.cancelled' } });
  });

  it('refuses unsafe and duplicate names like createZip', async () => {
    expect(await createZipInSteps([{ path: '../evil.txt', data: text('x') }])).toMatchObject({
      ok: false,
      error: { code: 'zip.unsafePath' },
    });
    expect(
      await createZipInSteps([
        { path: 'a.txt', data: text('1') },
        { path: 'a.txt', data: text('2') },
      ])
    ).toMatchObject({ ok: false, error: { code: 'zip.duplicate' } });
    const empty = await createZipInSteps([]);
    expect(empty.ok && readZip(empty.value)).toEqual({ ok: true, value: [] });
  });
});

describe('a long backup: progress, one at a time, cancel', () => {
  const backups = (target: WiredApp): Promise<string[]> =>
    fs
      .readdir(path.join(target.ports.folders.dataRoot(), 'backups'))
      .then((names) => names.filter((n) => n.endsWith('.zip')))
      .catch(() => []);

  const waitFor = async (what: () => boolean | Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 400; i++) {
      if (await what()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('waited too long');
  };

  it('reports progress, refuses a second backup, and Cancel stops it with nothing written', async () => {
    app = await wiredApp('flying-all-good', { files: ['Saved Games/DCS/**'] });
    const target = app;
    await target.invoke('backup:saveItem', {
      scope: '@always',
      item: { label: 'DCS bindings', path: '{DCS_USER}/Config/Input', kind: 'folder' },
    });
    expect(await target.invoke('backup:backUpStatus')).toEqual({ running: false });
    expect(await target.invoke('backup:cancelBackUp')).toEqual({ cancelling: false });

    // Every file takes 40 ms to read: a backup that would take a second or more.
    await mutate(target, [{ op: 'slowFiles', ms: 40 }]);
    const progress = (): { done: number; total: number; label: string }[] =>
      target.events
        .filter((e) => e.channel === 'backup:event:progress')
        .map((e) => e.payload as { done: number; total: number; label: string });
    const backUp = target.wiring.handlers.get('backup:backUp')!;
    const running = backUp({ scope: { kind: 'full' } });
    await waitFor(() => progress().length >= 2);

    const status = await target.invoke<{
      running: boolean;
      progress?: { done: number; total: number; label: string };
    }>('backup:backUpStatus');
    expect(status.running).toBe(true);
    expect(status.progress).toMatchObject({ label: 'DCS bindings' });
    expect(status.progress!.total).toBeGreaterThan(10);
    expect(status.progress!.done).toBeLessThan(status.progress!.total);
    // One at a time.
    expect(await backUp({ scope: { kind: 'full' } })).toMatchObject({
      ok: false,
      error: { code: 'backup.busy' },
    });

    expect(await target.invoke('backup:cancelBackUp')).toEqual({ cancelling: true });
    expect(await running).toEqual({
      ok: false,
      error: {
        code: 'backup.cancelled',
        message: 'The backup was cancelled. Nothing was written.',
      },
    });
    // It stopped early, wrote no archive, and said that it ended.
    const reported = progress();
    expect(reported.at(-1)!.done).toBeLessThan(reported.at(-1)!.total);
    expect(await backups(target)).toEqual([]);
    expect(target.events.filter((e) => e.channel === 'backup:event:ended')).toEqual([
      { channel: 'backup:event:ended', payload: { cancelled: true } },
    ]);
    expect(await target.invoke('backup:backUpStatus')).toEqual({ running: false });

    // The next backup runs to the end, every file reported.
    await mutate(target, [{ op: 'slowFiles', ms: 0 }]);
    target.events.length = 0;
    const done = await target.invoke<{ backup: { fileCount: number } }>('backup:backUp', {
      scope: { kind: 'full' },
    });
    expect(done.backup.fileCount).toBeGreaterThan(10);
    expect(await backups(target)).toHaveLength(1);
    const all = progress();
    expect(all.at(-1)).toMatchObject({ label: 'Writing the backup' });
    expect(all.at(-1)!.done).toBe(all.at(-1)!.total);
    expect(target.events.at(-1)).toEqual({
      channel: 'backup:event:ended',
      payload: { cancelled: false },
    });
  }, 60_000);

  it('cancelled while the archive is being compressed: still nothing is written', async () => {
    app = await wiredApp('flying-all-good', { files: ['Saved Games/DCS/**'] });
    const target = app;
    await target.invoke('backup:saveItem', {
      scope: '@always',
      item: { label: 'DCS bindings', path: '{DCS_USER}/Config/Input', kind: 'folder' },
    });
    const backUp = target.wiring.handlers.get('backup:backUp')!;
    const running = backUp({ scope: { kind: 'full' } });
    // "Writing the backup" is the step after every file was read.
    await waitFor(() =>
      target.events.some(
        (e) =>
          e.channel === 'backup:event:progress' &&
          (e.payload as { label: string }).label === 'Writing the backup'
      )
    );
    await target.invoke('backup:cancelBackUp');
    expect(await running).toMatchObject({ ok: false, error: { code: 'backup.cancelled' } });
    expect(await backups(target)).toEqual([]);
  }, 60_000);
});
