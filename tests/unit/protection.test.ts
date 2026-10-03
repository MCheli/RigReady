import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupSourceRegistry } from '../../src/core/backupSources';
import { CREDENTIAL_RULES, credentialReason, isProgramFile } from '../../src/core/credentials';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { inspectZip } from '../../src/core/files/zipInspect';
import { resolveTrackedItem, trackedFileTarget, unknownVariableText } from '../../src/core/tracked';
import { NodeRawFs } from '../../src/platform/node';
import { BlobStore } from '../../src/features/backup/core/blobs';
import { diffLines, isText, splitLines } from '../../src/features/backup/core/diff';
import { tempDir, TestClock } from '../helpers';

/** Shared building blocks of backup and sharing: the credential denylist, zip inspection, tracked items. */

let dir: string;
let cleanup: () => Promise<void>;
let store: BackupFileStore;
beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  store = new BackupFileStore(new NodeRawFs(), path.join(dir, '.rigready'), new TestClock());
});
afterEach(() => cleanup());

const vars = (): { APPDATA: string; PROGRAM_FILES: string; DCS_USER: string } => ({
  APPDATA: path.join(dir, 'AppData', 'Roaming'),
  PROGRAM_FILES: path.join(dir, 'Program Files'),
  DCS_USER: path.join(dir, 'Saved Games', 'DCS'),
});

describe('credential denylist', () => {
  it('never allows the SimAppPro account file, DCS vaults, keys or the broker passwords', () => {
    const v = vars();
    expect(credentialReason(path.join(v.APPDATA, 'SimAppPro', 'config.json'), v)).toMatch(
      /password/
    );
    // Only that config.json: SimAppPro's MFD config is fine.
    expect(
      credentialReason(
        path.join(v.APPDATA, 'SimAppPro', 'GameExtendDisplay', 'MFD', 'DCS_config.json'),
        v
      )
    ).toBeUndefined();
    expect(credentialReason(path.join(v.DCS_USER, 'Config', 'network.vault'), v)).toMatch(/login/);
    expect(credentialReason(path.join(v.DCS_USER, 'steam_authdata.bin'), v)).toMatch(/Steam/);
    expect(credentialReason(path.join(dir, 'x', 'ID_RSA'), v)).toMatch(/private key/);
    expect(credentialReason(path.join(dir, 'Steam', 'config', 'loginusers.vdf'), v)).toBeDefined();
    expect(credentialReason(path.join(v.PROGRAM_FILES, 'mosquitto', 'passwd'), v)).toMatch(
      /broker/
    );
    expect(credentialReason(path.join(v.DCS_USER, 'Config', 'options.lua'), v)).toBeUndefined();
    // A rule whose variable this PC does not have is skipped, not an error.
    expect(credentialReason(path.join(dir, 'SimAppPro', 'config.json'), {})).toBeUndefined();
    expect(CREDENTIAL_RULES.length).toBeGreaterThan(10);
  });

  it('knows which files run something', () => {
    for (const f of ['a.exe', 'b.BAT', 'c.cmd', 'd.ps1', 'e.py', 'f.vbs', 'g.js']) {
      expect(isProgramFile(f), f).toBe(true);
    }
    expect(isProgramFile('options.lua')).toBe(false);
    expect(isProgramFile('controls.cfg')).toBe(false);
  });
});

describe('zip inspection', () => {
  const ok = zipSync({ 'a.txt': new TextEncoder().encode('hello'), 'f/': new Uint8Array() });

  it('lists entries from the central directory without unpacking', () => {
    const entries = inspectZip(ok, { maxTotalBytes: 1000 });
    expect(entries).toMatchObject({
      ok: true,
      value: [
        { name: 'a.txt', uncompressedSize: 5, isDirectory: false },
        { name: 'f/', isDirectory: true },
      ],
    });
  });

  it('refuses links, encrypted entries, unsafe names, too many or too big, and non-zips', () => {
    const link = zipSync({ l: [new Uint8Array([1]), { os: 3, attrs: 0o120777 << 16 }] } as never);
    expect(inspectZip(link, { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.symlink' },
    });
    const encrypted = new Uint8Array(ok);
    const view = new DataView(encrypted.buffer);
    for (let i = 0; i < encrypted.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint16(i + 8, 1, true);
        break;
      }
    }
    expect(inspectZip(encrypted, { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.encrypted' },
    });
    const unsafe = zipSync({ '../x': new Uint8Array([1]) });
    expect(inspectZip(unsafe, { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.unsafePath' },
    });
    expect(inspectZip(ok, { maxTotalBytes: 2 })).toMatchObject({
      ok: false,
      error: { code: 'zip.tooBig' },
    });
    expect(inspectZip(ok, { maxTotalBytes: 1000, maxEntries: 1 })).toMatchObject({
      ok: false,
      error: { code: 'zip.tooMany' },
    });
    expect(inspectZip(new Uint8Array(10), { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.read' },
    });
    expect(inspectZip(new Uint8Array(100), { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.read' },
    });
    // A directory that points past the end of the file.
    const cut = ok.slice(0, ok.length - 40);
    const tail = ok.slice(ok.length - 22);
    const broken = new Uint8Array([...cut, ...tail]);
    expect(inspectZip(broken, { maxTotalBytes: 1000 }).ok).toBe(false);
    const zip64 = new Uint8Array(ok);
    new DataView(zip64.buffer).setUint32(zip64.length - 22 + 16, 0xffffffff, true);
    expect(inspectZip(zip64, { maxTotalBytes: 1000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.unsupported' },
    });
  });
});

describe('tracked items', () => {
  it('resolves a file, a folder with patterns, a missing path and an unknown variable', async () => {
    const v = vars();
    await fs.mkdir(path.join(v.DCS_USER, 'Config', 'Input'), { recursive: true });
    await fs.writeFile(path.join(v.DCS_USER, 'Config', 'options.lua'), 'options = {}');
    await fs.writeFile(path.join(v.DCS_USER, 'Config', 'network.vault'), 'secret');
    await fs.writeFile(path.join(v.DCS_USER, 'Config', 'Input', 'a.lua'), 'a');
    const base = { include: [], exclude: [] };
    const file = await resolveTrackedItem(
      store,
      { id: 'o', label: 'O', path: '{DCS_USER}/Config/options.lua', kind: 'file', ...base },
      v
    );
    expect(file).toMatchObject({
      exists: true,
      files: [{ relativePath: 'options.lua', size: 12 }],
    });
    const vault = await resolveTrackedItem(
      store,
      { id: 'v', label: 'V', path: '{DCS_USER}/Config/network.vault', kind: 'file', ...base },
      v
    );
    expect(vault).toMatchObject({
      exists: true,
      files: [],
      withheld: [{ relativePath: 'network.vault' }],
    });
    const folder = await resolveTrackedItem(
      store,
      {
        id: 'c',
        label: 'C',
        path: '{DCS_USER}/Config',
        kind: 'folder',
        include: ['**/*.lua'],
        exclude: ['Input/**'],
      },
      v
    );
    expect(folder.files.map((f) => f.relativePath)).toEqual(['options.lua']);
    const missing = await resolveTrackedItem(
      store,
      { id: 'm', label: 'M', path: '{DCS_USER}/Nope', kind: 'folder', ...base },
      v
    );
    expect(missing).toMatchObject({ exists: false, files: [] });
    const unknown = await resolveTrackedItem(
      store,
      { id: 'u', label: 'U', path: '{IRACING_USER}/x', kind: 'folder', ...base },
      v
    );
    expect(unknown.problem).toBe(unknownVariableText('{IRACING_USER}/x'));
    const climbing = await resolveTrackedItem(
      store,
      { id: 'u', label: 'U', path: '{DCS_USER}/../../x', kind: 'folder', ...base },
      v
    );
    expect(climbing.problem).toMatch(/leaves/);
    expect(unknownVariableText('plain')).toMatch(/not valid/);
    expect(trackedFileTarget({ kind: 'file' }, 'C:\\a\\b.lua', 'b.lua')).toBe('C:\\a\\b.lua');
    expect(trackedFileTarget({ kind: 'folder' }, 'C:\\a', 'x/y.lua')).toBe(
      path.join('C:\\a', 'x', 'y.lua')
    );
  });

  it('backup sources register once', () => {
    const registry = new BackupSourceRegistry();
    const source = { id: 's', label: 'S', suggest: async () => ({ ok: true as const, value: [] }) };
    registry.register(source);
    expect(registry.all()).toEqual([source]);
    expect(() => registry.register(source)).toThrow(/twice/);
  });
});

describe('diff and stored copies', () => {
  it('diffs lines into hunks with context and knows text from binary', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 3', 'line three').replace('line 25', 'line 25\nextra');
    const diff = diffLines(before, after);
    expect(diff).toMatchObject({ added: 2, removed: 1 });
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(diff.hunks[1]!.lines).toContainEqual({ kind: '+', text: 'extra' });
    expect(diffLines('a\nb\n', 'a\r\nb\r\n').hunks).toEqual([]);
    expect(diffLines('', 'x').added).toBe(1);
    const big = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
    const other = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
    expect(diffLines(big, other).tooLarge).toBe(true);
    expect(splitLines('')).toEqual([]);
    expect(isText(new TextEncoder().encode('héllo'))).toBe(true);
    expect(isText(new Uint8Array([0x89, 0x50, 0x00]))).toBe(false);
    expect(isText(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });

  it('stores contents once by hash and notices a damaged copy', async () => {
    const blobs = new BlobStore(store, path.join(dir, '.rigready'));
    const put = await blobs.put(new TextEncoder().encode('abc'));
    if (!put.ok) throw new Error('put');
    expect(await blobs.has(put.value)).toBe(true);
    expect(await blobs.has('nope')).toBe(false);
    expect(await blobs.get('nope')).toMatchObject({ ok: false, error: { code: 'blob.id' } });
    const file = path.join(dir, '.rigready', 'backup', 'blobs', put.value.slice(0, 2), put.value);
    await fs.writeFile(file, 'abd');
    expect(await blobs.get(put.value)).toMatchObject({
      ok: false,
      error: { code: 'blob.damaged' },
    });
    await fs.rm(file);
    expect(await blobs.get(put.value)).toMatchObject({
      ok: false,
      error: { code: 'blob.missing' },
    });
    await blobs.put(new TextEncoder().encode('keep'));
    expect(await blobs.sweep(new Set())).toBe(1);
  });
});
