import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dataFileStatus, startupNotices } from '../../src/core/dataHealth';
import { DisplayLayoutStore } from '../../src/core/displays/layouts';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { MAX_DATA_FILE_BYTES, readDataText, stripBom } from '../../src/core/files/text';
import { JsonStore } from '../../src/core/jsonStore';
import { nullLogger } from '../../src/core/logger';
import type { Profile } from '../../src/core/profile/schema';
import { ProfileStore } from '../../src/core/profile/store';
import { AppSettingsSchema, SettingsStore } from '../../src/core/settings';
import type { DisplayTarget } from '../../src/shared/models';
import { NodeRawFs } from '../../src/platform/node';
import { damaged, randomBytes, survives, truncations, type Variant } from '../fuzz';
import { fixturesDir, tempDir, TestClock } from '../helpers';

/**
 * NFR-008, RigReady's own stores (settings, setups, monitor layouts, the change journal,
 * every JsonStore): fed missing, empty, cut-off, garbage, non-UTF-8, BOM-prefixed, huge
 * and locked files. Each answers with a Result (an error or a sane default), never a
 * throw and never a hang, and a damaged file is never lost: it stays where it is, or it
 * is kept aside byte for byte before anything is written in its place.
 *
 * Locked files: Node cannot open a file exclusively on Windows (it always shares), so a
 * lock is simulated at the port: a RawFs whose reads or writes of chosen files fail with
 * EBUSY, which is what a real sharing violation looks like to the file store.
 */

class LockableFs extends NodeRawFs {
  readLocked = new Set<string>();
  writeLocked = new Set<string>();

  private check(set: Set<string>, file: string, what: string): void {
    if (set.has(path.resolve(file).toLowerCase())) {
      const error = new Error(`EBUSY: resource busy or locked, ${what} '${file}'`);
      (error as NodeJS.ErrnoException).code = 'EBUSY';
      throw error;
    }
  }
  lockRead(file: string): void {
    this.readLocked.add(path.resolve(file).toLowerCase());
  }
  lockWrite(file: string): void {
    this.writeLocked.add(path.resolve(file).toLowerCase());
  }
  override async readText(file: string): Promise<string> {
    this.check(this.readLocked, file, 'open');
    return super.readText(file);
  }
  override async readBytes(file: string): Promise<Uint8Array> {
    this.check(this.readLocked, file, 'open');
    return super.readBytes(file);
  }
  override async writeBytes(file: string, data: Uint8Array | string): Promise<void> {
    this.check(this.writeLocked, file, 'open');
    return super.writeBytes(file, data);
  }
  override async appendText(file: string, text: string): Promise<void> {
    this.check(this.writeLocked, file, 'open');
    return super.appendText(file, text);
  }
}

let dir: string;
let cleanup: () => Promise<void>;
let dataRoot: string;
let raw: LockableFs;
let files: BackupFileStore;
let clock: TestClock;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  dataRoot = path.join(dir, '.rigready');
  await fs.mkdir(dataRoot, { recursive: true });
  clock = new TestClock();
  raw = new LockableFs();
  files = new BackupFileStore(raw, dataRoot, clock);
});
afterEach(() => cleanup());

const bytesOf = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await fs.readFile(file));
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/** Every file in a folder (not below it) whose name contains `part`. */
async function siblings(folder: string, part: string): Promise<string[]> {
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  return names.filter((n) => n.includes(part)).map((n) => path.join(folder, n));
}

async function keptAside(folder: string, original: Uint8Array): Promise<boolean> {
  for (const file of await siblings(folder, 'corrupt')) {
    if (same(await bytesOf(file), original)) return true;
  }
  return false;
}

const variantsOf = (sample: Uint8Array): Variant[] => [...damaged(sample), ...truncations(sample)];

describe('NFR-008: settings.json', () => {
  const file = (): string => path.join(dataRoot, 'settings.json');
  const fresh = (): SettingsStore => new SettingsStore(files, dataRoot, clock);

  async function sample(): Promise<Uint8Array> {
    const saved = await fresh().update({ minimizeToTray: false, displayRevertSeconds: 30 });
    expect(saved.ok).toBe(true);
    return bytesOf(file());
  }

  it('missing: defaults, and nothing is written', async () => {
    const got = await fresh().get();
    expect(got.ok && got.value.minimizeToTray).toBe(true);
    expect(await fs.readdir(dataRoot)).toEqual([]);
  });

  it('every damaged form: the app gets settings, and the old file is kept byte for byte', async () => {
    const original = await sample();
    let replaced = 0;
    for (const variant of variantsOf(original)) {
      await fs.rm(dataRoot, { recursive: true, force: true });
      await fs.mkdir(dataRoot, { recursive: true });
      await fs.writeFile(file(), variant.bytes);
      const store = fresh();
      const got = await survives(`settings, ${variant.name}`, () => store.get());
      expect(got.ok, variant.name).toBe(true);
      if (!got.ok) continue;
      const notice = store.takeNotice();

      // Is the content settings? (JSON that the schema accepts, with or without a byte order mark.)
      let valid = false;
      try {
        valid = AppSettingsSchema.safeParse(JSON.parse(stripBom(decode(variant.bytes)))).success;
      } catch {
        // Not JSON: not settings.
      }
      if (valid) {
        expect(notice, variant.name).toBeUndefined();
        expect(await siblings(dataRoot, 'corrupt'), variant.name).toEqual([]);
      } else {
        replaced++;
        // Defaults are in use, the user is told, and the damaged file is still there.
        expect(got.value.minimizeToTray, variant.name).toBe(true);
        expect(notice, variant.name).toContain('The settings file could not be read');
        expect(await keptAside(dataRoot, variant.bytes), variant.name).toBe(true);
      }
      if (variant.sameMeaning) {
        expect(got.value.minimizeToTray, variant.name).toBe(false);
        expect(got.value.displayRevertSeconds, variant.name).toBe(30);
      }
      // Changing a setting afterwards works either way.
      const updated = await survives(`settings update, ${variant.name}`, () =>
        store.update({ checkTimeoutSeconds: 9 })
      );
      expect(updated.ok, variant.name).toBe(true);
      expect(JSON.parse(await fs.readFile(file(), 'utf8')).checkTimeoutSeconds).toBe(9);
    }
    expect(replaced).toBeGreaterThan(30);
  });

  it('locked: an error that says so; the file is neither replaced nor set aside', async () => {
    const original = await sample();
    raw.lockRead(file());
    const store = fresh();
    const got = await store.get();
    expect(got).toMatchObject({ ok: false, error: { code: 'file.read' } });
    if (!got.ok) expect(got.error.detail).toContain('EBUSY');
    expect(await store.update({ checkTimeoutSeconds: 9 })).toMatchObject({ ok: false });
    expect(store.takeNotice()).toBeUndefined();
    raw.readLocked.clear();
    expect(same(await bytesOf(file()), original)).toBe(true);
    expect(await siblings(dataRoot, 'corrupt')).toEqual([]);
    // Once the lock is gone the same store reads it.
    const later = await store.get();
    expect(later.ok && later.value.displayRevertSeconds).toBe(30);
  });

  it('cannot be written: the change is refused and the settings in use stay as they were', async () => {
    await sample();
    const store = fresh();
    expect((await store.get()).ok).toBe(true);
    raw.lockWrite(file());
    expect(await store.update({ displayRevertSeconds: 60 })).toMatchObject({
      ok: false,
      error: { code: 'file.write' },
    });
    const now = await store.get();
    expect(now.ok && now.value.displayRevertSeconds).toBe(30);
  });

  it('damaged and the copy cannot be kept: the damaged file is not overwritten', async () => {
    const garbage = randomBytes(500, 3);
    await fs.writeFile(file(), garbage);
    // The aside copy gets a name with the time in it; make every write in the folder fail but the read.
    const realWrite = raw.writeBytes.bind(raw);
    raw.writeBytes = async (target, data) => {
      if (path.basename(target).startsWith('settings.corrupt-'))
        throw new Error('ENOSPC: disk full');
      return realWrite(target, data);
    };
    const got = await fresh().get();
    expect(got).toMatchObject({ ok: false, error: { code: 'file.write' } });
    expect(same(await bytesOf(file()), garbage)).toBe(true);
  });

  it('huge: refused by size, quickly, and left alone', async () => {
    const big = randomBytes(MAX_DATA_FILE_BYTES + 1024, 5);
    await fs.writeFile(file(), big);
    const started = Date.now();
    const got = await survives('settings, 16 MB', () => fresh().get(), 10_000);
    expect(got).toMatchObject({ ok: false, error: { code: 'file.tooLarge' } });
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await fs.stat(file())).size).toBe(big.length);
    expect(await readDataText(files, path.join(dataRoot, 'none.json'))).toMatchObject({
      ok: false,
    });
  });
});

describe('NFR-008: setups (profile YAML)', () => {
  const profilesDir = (): string => path.join(dataRoot, 'profiles');
  const store = (): ProfileStore => new ProfileStore(files, dataRoot);

  async function seed(): Promise<{ good: Profile; sample: Uint8Array }> {
    const text = await fs.readFile(
      path.join(fixturesDir, 'scenarios', 'profiles', 'dcs-f-a-18c.yaml'),
      'utf8'
    );
    const good = yaml.load(text) as Profile;
    await fs.mkdir(profilesDir(), { recursive: true });
    await fs.writeFile(path.join(profilesDir(), 'dcs-f-a-18c.yaml'), text);
    return { good, sample: new TextEncoder().encode(text) };
  }

  it('missing folder: no setups, no error', async () => {
    expect(await store().listDetailed()).toEqual({
      ok: true,
      value: { profiles: [], invalid: [], earlier: [] },
    });
    expect(await store().get('nope')).toMatchObject({
      ok: false,
      error: { code: 'profile.missing' },
    });
    expect(await store().lastProfileId()).toBeUndefined();
  });

  it('every damaged form of one setup: it is listed as unreadable, the others still load, and its file is untouched', async () => {
    const { sample } = await seed();
    const broken = path.join(profilesDir(), 'broken.yaml');
    let unreadable = 0;
    for (const variant of variantsOf(sample)) {
      await fs.writeFile(broken, variant.bytes);
      const profiles = store();
      const listed = await survives(`profiles, ${variant.name}`, () => profiles.listDetailed());
      expect(listed.ok, variant.name).toBe(true);
      if (!listed.ok) continue;
      // The good setup is always there.
      expect(
        listed.value.profiles.map((p) => p.profile.id),
        variant.name
      ).toContain('dcs-f-a-18c');
      const invalid = listed.value.invalid.find((p) => p.id === 'broken');
      // The damaged one is named with a reason; nothing in this corpus is a valid setup called "broken".
      expect(invalid, variant.name).toBeDefined();
      expect(invalid!.message.length, variant.name).toBeGreaterThan(5);
      unreadable++;
      const got = await survives(`profile get, ${variant.name}`, () => profiles.get('broken'));
      expect(got.ok, variant.name).toBe(false);
      expect(profiles.lastValid('broken')).toBeUndefined();
      expect(same(await bytesOf(broken), variant.bytes), variant.name).toBe(true);
      // What is on disk can still be shown for fixing by hand.
      const rawText = await profiles.readRaw('broken');
      expect(rawText.ok, variant.name).toBe(true);
    }
    expect(unreadable).toBeGreaterThan(30);
  });

  it('a byte order mark is not damage: the setup loads', async () => {
    const { sample } = await seed();
    await fs.writeFile(
      path.join(profilesDir(), 'dcs-f-a-18c.yaml'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample)])
    );
    const got = await store().get('dcs-f-a-18c');
    expect(got.ok && got.value.name).toBe('DCS F/A-18C');
  });

  it('locked and huge: an unreadable entry with the reason; the others still load', async () => {
    await seed();
    const locked = path.join(profilesDir(), 'locked.yaml');
    const big = path.join(profilesDir(), 'big.yaml');
    await fs.writeFile(locked, 'schemaVersion: 1\n');
    await fs.writeFile(big, Buffer.alloc(5 * 1024 * 1024, 0x61));
    raw.lockRead(locked);
    const started = Date.now();
    const listed = await store().listDetailed();
    expect(Date.now() - started).toBeLessThan(5000);
    if (!listed.ok) throw new Error('list failed');
    expect(listed.value.profiles.map((p) => p.profile.id)).toEqual(['dcs-f-a-18c']);
    const byId = Object.fromEntries(listed.value.invalid.map((p) => [p.id, p]));
    expect(byId['locked']?.detail).toContain('EBUSY');
    expect(byId['big']?.message).toContain('too large');
    expect((await fs.stat(big)).size).toBe(5 * 1024 * 1024);
  });

  it('a very long line in a valid setup does not overflow the comment detection', async () => {
    const { good } = await seed();
    const long = { ...good, id: 'long', name: 'Long', notes: `"${'x'.repeat(1_500_000)}` };
    const saved = await store().save(long as Profile);
    expect(saved.ok).toBe(true);
    const listed = await survives('profiles, 1.5 MB line', () => store().listDetailed(), 20_000);
    expect(listed.ok && listed.value.profiles.map((p) => p.profile.id).sort()).toEqual([
      'dcs-f-a-18c',
      'long',
    ]);
  });

  it('damaged state.json: the last used setup is forgotten, nothing else', async () => {
    await seed();
    const state = path.join(dataRoot, 'state.json');
    for (const variant of variantsOf(
      new TextEncoder().encode('{"lastProfileId":"dcs-f-a-18c","lastUsed":{}}')
    )) {
      await fs.writeFile(state, variant.bytes);
      const profiles = store();
      const last = await survives(`state, ${variant.name}`, () => profiles.lastProfileId());
      if (variant.sameMeaning) expect(last).toBe('dcs-f-a-18c');
      expect(typeof (await profiles.lastUsed())).toBe('object');
      expect((await profiles.setLastProfileId('dcs-f-a-18c', clock.now())).ok).toBe(true);
      expect(await profiles.lastProfileId()).toBe('dcs-f-a-18c');
    }
    raw.lockRead(state);
    expect(await store().lastProfileId()).toBeUndefined();
  });
});

const TARGETS: DisplayTarget[] = [
  {
    id: 'display#abc',
    name: 'Main',
    enabled: true,
    primary: true,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    rotation: 0,
  },
];

describe('NFR-008: monitor layouts', () => {
  const file = (): string => path.join(dataRoot, 'displays', 'layouts.json');
  const store = (): DisplayLayoutStore => new DisplayLayoutStore(files, dataRoot, clock);

  async function sample(): Promise<Uint8Array> {
    expect((await store().create('Flying', TARGETS)).ok).toBe(true);
    expect((await store().create('Desk', TARGETS)).ok).toBe(true);
    return bytesOf(file());
  }

  it('missing: no layouts; the first one can be saved', async () => {
    expect(await store().list()).toEqual({ ok: true, value: [] });
    expect(await store().recover()).toEqual({ ok: true, value: undefined });
    expect((await store().create('Flying', TARGETS)).ok).toBe(true);
  });

  it('every damaged form: reading says so and changes nothing; recovery keeps the file aside and starts empty', async () => {
    const original = await sample();
    let recovered = 0;
    for (const variant of variantsOf(original)) {
      await fs.rm(path.dirname(file()), { recursive: true, force: true });
      await fs.mkdir(path.dirname(file()), { recursive: true });
      await fs.writeFile(file(), variant.bytes);
      const layouts = store();
      const listed = await survives(`layouts, ${variant.name}`, () => layouts.list());
      if (variant.sameMeaning) {
        expect(listed.ok && listed.value.map((l) => l.name), variant.name).toEqual([
          'Flying',
          'Desk',
        ]);
        continue;
      }
      if (listed.ok) {
        // Valid JSON that happens to fit (an object without layouts): an empty list, nothing to recover.
        expect(listed.value, variant.name).toEqual([]);
        expect(await layouts.recover()).toEqual({ ok: true, value: undefined });
        continue;
      }
      expect(listed.error.code, variant.name).toBe('layouts.invalid');
      // Nothing that writes goes ahead on a damaged file.
      const attempts: (() => Promise<{ ok: boolean }>)[] = [
        () => layouts.create('New', TARGETS),
        () => layouts.rename('flying', 'Other'),
        () => layouts.replace('flying', TARGETS),
        () => layouts.remove('flying'),
        () => layouts.get('flying'),
      ];
      for (const attempt of attempts) {
        const result = await survives(`layouts write, ${variant.name}`, attempt);
        expect(result.ok, variant.name).toBe(false);
      }
      expect(same(await bytesOf(file()), variant.bytes), variant.name).toBe(true);

      // Startup recovery: the file is kept aside, the list starts empty, the user is told.
      const notice = await survives(`layouts recover, ${variant.name}`, () => layouts.recover());
      expect(notice.ok && notice.value, variant.name).toContain(
        'The saved monitor layouts could not be read'
      );
      expect(await keptAside(path.dirname(file()), variant.bytes), variant.name).toBe(true);
      expect(await layouts.list()).toEqual({ ok: true, value: [] });
      expect((await layouts.create('New', TARGETS)).ok, variant.name).toBe(true);
      recovered++;
    }
    expect(recovered).toBeGreaterThan(30);
  });

  it('locked: an error; recovery leaves a file it cannot read alone', async () => {
    const original = await sample();
    raw.lockRead(file());
    const layouts = store();
    expect(await layouts.list()).toMatchObject({ ok: false, error: { code: 'file.read' } });
    expect(await layouts.recover()).toEqual({ ok: true, value: undefined });
    expect(await layouts.create('New', TARGETS)).toMatchObject({ ok: false });
    raw.readLocked.clear();
    expect(same(await bytesOf(file()), original)).toBe(true);
    expect(await siblings(path.dirname(file()), 'corrupt')).toEqual([]);
  });

  it('damaged and the copy cannot be kept: recovery fails and the file stays', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), '{"layouts": "no"}');
    const realWrite = raw.writeBytes.bind(raw);
    raw.writeBytes = async (target, data) => {
      if (path.basename(target).startsWith('layouts.corrupt-'))
        throw new Error('ENOSPC: disk full');
      return realWrite(target, data);
    };
    expect(await store().recover()).toMatchObject({ ok: false, error: { code: 'file.write' } });
    expect(await fs.readFile(file(), 'utf8')).toBe('{"layouts": "no"}');
  });
});

describe('NFR-008: JsonStore (device names, tracked files, every feature store)', () => {
  const schema = z.object({
    names: z.record(z.string(), z.string()).default({}),
    count: z.number().int().default(0),
  });
  const file = (): string => path.join(dataRoot, 'devices', 'devices.json');
  const store = (): JsonStore<typeof schema> => new JsonStore(files, file(), schema);

  it('missing: the defaults; the first write creates it', async () => {
    expect(await store().read()).toEqual({ ok: true, value: { names: {}, count: 0 } });
    const updated = await store().update((v) => ({ ...v, count: v.count + 1 }));
    expect(updated.ok && updated.value.count).toBe(1);
    expect(await new JsonStore(files, file(), z.number()).read()).toMatchObject({ ok: false });
  });

  it('every damaged form: an error result, and an update never overwrites the damaged file', async () => {
    expect((await store().write({ names: { a: 'Left throttle' }, count: 3 })).ok).toBe(true);
    const original = await bytesOf(file());
    let refused = 0;
    for (const variant of variantsOf(original)) {
      await fs.writeFile(file(), variant.bytes);
      const read = await survives(`JsonStore, ${variant.name}`, () => store().read());
      if (variant.sameMeaning) {
        expect(read.ok && read.value.names, variant.name).toEqual({ a: 'Left throttle' });
        continue;
      }
      if (read.ok) continue; // JSON that fits the schema (an object with other keys)
      expect(read.error.code, variant.name).toBe('store.invalid');
      const update = await survives(`JsonStore update, ${variant.name}`, () =>
        store().update((v) => ({ ...v, count: 99 }))
      );
      expect(update.ok, variant.name).toBe(false);
      expect(same(await bytesOf(file()), variant.bytes), variant.name).toBe(true);
      refused++;
    }
    expect(refused).toBeGreaterThan(30);
  });

  it('locked, unwritable and huge: error results', async () => {
    expect((await store().write({ names: {}, count: 1 })).ok).toBe(true);
    raw.lockRead(file());
    expect(await store().read()).toMatchObject({ ok: false, error: { code: 'file.read' } });
    expect(await store().update((v) => v)).toMatchObject({ ok: false });
    raw.readLocked.clear();
    raw.lockWrite(file());
    expect(await store().update((v) => ({ ...v, count: 2 }))).toMatchObject({
      ok: false,
      error: { code: 'file.write' },
    });
    expect(await store().write({ count: 'x' } as never)).toMatchObject({
      ok: false,
      error: { code: 'store.invalid' },
    });
    raw.writeLocked.clear();
    await fs.writeFile(file(), Buffer.alloc(MAX_DATA_FILE_BYTES + 1, 0x20));
    expect(await survives('JsonStore, 16 MB', () => store().read(), 10_000)).toMatchObject({
      ok: false,
      error: { code: 'file.tooLarge' },
    });
  });
});

describe('NFR-008: the change journal', () => {
  const journalFile = (): string => path.join(dataRoot, 'journal.jsonl');
  const outside = (name: string): string => path.join(dir, 'Saved Games', 'DCS', name);

  async function sample(): Promise<Uint8Array> {
    await fs.mkdir(path.dirname(outside('a')), { recursive: true });
    for (const name of ['a.lua', 'b.lua', 'c.lua']) {
      await fs.writeFile(outside(name), `old ${name}`);
      clock.advance(1000);
      expect(
        (await files.write(outside(name), `new ${name}`, { reason: `Change ${name}` })).ok
      ).toBe(true);
    }
    return bytesOf(journalFile());
  }

  it('missing: no changes; the first change starts it', async () => {
    expect(await files.journal()).toEqual({ ok: true, value: [] });
    expect(await files.journalGroups()).toEqual({ ok: true, value: [] });
    expect(await files.prune({ days: 1, groups: 1 })).toMatchObject({ ok: true });
    expect(await files.backupBytes()).toEqual({ ok: true, value: 0 });
  });

  it('every damaged form: the readable entries are listed, new changes are recorded, and no line is lost', async () => {
    const original = await sample();
    for (const variant of variantsOf(original)) {
      await fs.writeFile(journalFile(), variant.bytes);
      // A new store, as after a restart.
      const store = new BackupFileStore(raw, dataRoot, clock);
      const listed = await survives(`journal, ${variant.name}`, () => store.journal());
      expect(listed.ok, variant.name).toBe(true);
      const groups = await survives(`journal groups, ${variant.name}`, () => store.journalGroups());
      expect(groups.ok, variant.name).toBe(true);
      const before = decode(variant.bytes)
        .replace(/^﻿/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      // A change made now is journaled and can be undone, whatever is in the file.
      clock.advance(1000);
      const target = outside('d.lua');
      await fs.writeFile(target, 'old d');
      const written = await survives(`journal write, ${variant.name}`, () =>
        store.write(target, 'new d', { reason: 'Change d' })
      );
      expect(written.ok, variant.name).toBe(true);
      const after = await store.journal();
      expect(after.ok && after.value[0]?.reason, variant.name).toBe('Change d');
      if (written.ok && written.value) {
        const undone = await store.undo(written.value.id);
        expect(undone.ok, variant.name).toBe(true);
        expect(await fs.readFile(target, 'utf8')).toBe('old d');
      }
      // Old automatic backups are pruned without dropping the lines that could not be read.
      clock.advance(40 * 24 * 60 * 60 * 1000);
      const pruned = await survives(`journal prune, ${variant.name}`, () =>
        store.prune({ days: 30, groups: 0 })
      );
      expect(pruned.ok, variant.name).toBe(true);
      const now = (await fs.readFile(journalFile(), 'utf8')).split(/\r?\n/);
      const records = new Set((listed.ok ? listed.value : []).map((e) => e.id));
      for (const line of before) {
        let id: string | undefined;
        try {
          id = (JSON.parse(line) as { id?: string }).id;
        } catch {
          // A damaged line has no id.
        }
        // Readable entries may be pruned (they are 40 days old); unreadable lines never are.
        if (id === undefined || !records.has(id)) {
          expect(now.includes(line), `${variant.name}: lost the line ${line.slice(0, 60)}`).toBe(
            true
          );
        }
      }
      clock.advance(-40 * 24 * 60 * 60 * 1000);
    }
  });

  it('a line cut off by a crash: the entries before it survive and the next entry is not glued to it', async () => {
    const original = decode(await sample());
    const lines = original.trimEnd().split('\n');
    // The third entry was only half written.
    await fs.writeFile(journalFile(), `${lines[0]}\n${lines[1]}\n${lines[2]!.slice(0, 40)}`);
    const store = new BackupFileStore(raw, dataRoot, clock);
    const listed = await store.journal();
    expect(listed.ok && listed.value.map((e) => e.reason)).toEqual([
      'Change b.lua',
      'Change a.lua',
    ]);
    await fs.writeFile(outside('e.lua'), 'old e');
    expect((await store.write(outside('e.lua'), 'new e', { reason: 'Change e' })).ok).toBe(true);
    const after = await store.journal();
    expect(after.ok && after.value.map((e) => e.reason)).toEqual([
      'Change e',
      'Change b.lua',
      'Change a.lua',
    ]);
    // The earlier entries can still be undone.
    const first = after.ok ? after.value.find((e) => e.reason === 'Change a.lua') : undefined;
    expect((await store.undo(first!.id)).ok).toBe(true);
    expect(await fs.readFile(outside('a.lua'), 'utf8')).toBe('old a.lua');
  });

  it('locked: reading says so, and a file is not changed when the change cannot be journaled', async () => {
    await sample();
    const store = new BackupFileStore(raw, dataRoot, clock);
    raw.lockRead(journalFile());
    expect(await store.journal()).toMatchObject({ ok: false, error: { code: 'journal.read' } });
    expect(await store.journalGroups()).toMatchObject({ ok: false });
    expect(await store.prune({ days: 1, groups: 0 })).toMatchObject({ ok: false });
    expect(await store.undo('x')).toMatchObject({ ok: false });
    expect(await store.undoGroup('x')).toMatchObject({ ok: false });
    // The first append looks at the end of the journal; it cannot, so nothing is written.
    const refused = await store.write(outside('a.lua'), 'never', { reason: 'Must not happen' });
    expect(refused.ok).toBe(false);
    expect(await fs.readFile(outside('a.lua'), 'utf8')).toBe('new a.lua');

    raw.readLocked.clear();
    raw.lockWrite(journalFile());
    const again = await store.write(outside('b.lua'), 'never', { reason: 'Must not happen' });
    expect(again).toMatchObject({ ok: false, error: { code: 'file.write' } });
    expect(await fs.readFile(outside('b.lua'), 'utf8')).toBe('new b.lua');
    expect(await store.remove(outside('c.lua'), { reason: 'Must not happen' })).toMatchObject({
      ok: false,
    });
    expect(await fs.readFile(outside('c.lua'), 'utf8')).toBe('new c.lua');
  });

  it('a file that is not UTF-8 is never rewritten from its lossy text', async () => {
    const target = outside('controls.ini');
    await fs.mkdir(path.dirname(target), { recursive: true });
    // "Café" in Windows-1252: the é is one byte that is not UTF-8.
    const latin1 = Buffer.from([0x6e, 0x3d, 0x43, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x78, 0x3d, 0x31]);
    await fs.writeFile(target, latin1);
    const read = await files.readText(target);
    if (!read.ok) throw new Error('read failed');
    expect(read.value).toContain('Caf�');
    // A feature changes one value and writes the text back: refused, the file is untouched.
    const refused = await files.write(target, read.value.replace('x=1', 'x=2'), {
      reason: 'Change x',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'file.encoding' } });
    expect(same(await bytesOf(target), latin1)).toBe(true);
    expect(await files.journal()).toEqual({ ok: true, value: [] });
    // Bytes are written as they are, and so is text for a file that really holds the character.
    expect((await files.write(target, latin1, { reason: 'Copy' })).ok).toBe(true);
    const genuine = outside('notes.txt');
    await fs.writeFile(genuine, 'a � b');
    expect((await files.write(genuine, 'a � c', { reason: 'Edit' })).ok).toBe(true);
    expect((await files.write(outside('new.txt'), '�', { reason: 'New' })).ok).toBe(true);
  });

  it('20 MB of garbage is read in a moment and survives a prune', async () => {
    const garbage = Buffer.from(randomBytes(20 * 1024 * 1024, 11));
    await fs.writeFile(journalFile(), garbage);
    const store = new BackupFileStore(raw, dataRoot, clock);
    const started = Date.now();
    const listed = await survives('journal, 20 MB', () => store.journal(), 20_000);
    expect(listed).toEqual({ ok: true, value: [] });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await store.prune({ days: 30, groups: 0 })).toEqual({
      ok: true,
      value: { removedGroups: 0, freedBytes: 0 },
    });
    expect((await fs.stat(journalFile())).size).toBe(garbage.length);
  });
});

describe('NFR-008: what the user is told at startup', () => {
  it('garbage in every data file: each is named, kept, and the app has something to work with', async () => {
    const garbage = randomBytes(700, 21);
    await fs.mkdir(path.join(dataRoot, 'profiles'), { recursive: true });
    await fs.mkdir(path.join(dataRoot, 'displays'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'settings.json'), garbage);
    await fs.writeFile(path.join(dataRoot, 'profiles', 'huey.yaml'), garbage);
    await fs.writeFile(path.join(dataRoot, 'displays', 'layouts.json'), garbage);
    await fs.writeFile(path.join(dataRoot, 'journal.jsonl'), garbage);
    const ctx = {
      ports: { files, folders: { dataRoot: () => dataRoot } as never },
      log: nullLogger,
      profiles: new ProfileStore(files, dataRoot),
      layouts: new DisplayLayoutStore(files, dataRoot, clock),
      settings: new SettingsStore(files, dataRoot, clock),
    };
    const settings = await ctx.settings.get();
    expect(settings.ok).toBe(true);
    expect(ctx.settings.takeNotice()).toContain('settings.corrupt-');
    const notices = await survives('startup notices', () => startupNotices(ctx));
    expect(notices).toHaveLength(3);
    expect(notices[0]).toContain('The saved monitor layouts could not be read');
    expect(notices[0]).toContain('layouts.corrupt-');
    expect(notices[1]).toContain('huey.yaml');
    expect(notices[1]).toContain('Configure > Setups');
    expect(notices[2]).toContain('Part of the change journal could not be read');
    // All four are still on disk, byte for byte.
    expect(await keptAside(dataRoot, garbage)).toBe(true);
    expect(await keptAside(path.join(dataRoot, 'displays'), garbage)).toBe(true);
    expect(same(await bytesOf(path.join(dataRoot, 'profiles', 'huey.yaml')), garbage)).toBe(true);
    expect(same(await bytesOf(path.join(dataRoot, 'journal.jsonl')), garbage)).toBe(true);
    // A second start has nothing new to say about settings and layouts.
    const again = await startupNotices(ctx);
    expect(again).toHaveLength(2);
    const status = await dataFileStatus(ctx);
    expect(status.map((s) => [s.id, s.ok])).toEqual([
      ['settings', true],
      ['profiles', false],
      ['layouts', true],
      ['journal', false],
    ]);
  });

  it('files that cannot be read at all are reported, not replaced', async () => {
    await fs.mkdir(path.join(dataRoot, 'displays'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'displays', 'layouts.json'), '{"layouts":[]}');
    await fs.writeFile(path.join(dataRoot, 'journal.jsonl'), '');
    raw.lockRead(path.join(dataRoot, 'displays', 'layouts.json'));
    raw.lockRead(path.join(dataRoot, 'journal.jsonl'));
    const ctx = {
      ports: { files, folders: { dataRoot: () => dataRoot } as never },
      log: nullLogger,
      profiles: new ProfileStore(files, dataRoot),
      layouts: new DisplayLayoutStore(files, dataRoot, clock),
      settings: new SettingsStore(files, dataRoot, clock),
    };
    const notices = await startupNotices(ctx);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('The saved monitor layouts could not be read.');
    expect(notices[1]).toContain('Part of the change journal could not be read');
    expect(await siblings(path.join(dataRoot, 'displays'), 'corrupt')).toEqual([]);
    // A check that itself fails is reported too, and does not stop the start.
    const failing = {
      ...ctx,
      layouts: { recover: async () => Promise.reject(new Error('bug')) } as never,
    };
    expect(await startupNotices(failing)).toEqual([
      'RigReady could not check its own data files; the log has the details.',
    ]);
  });
});
