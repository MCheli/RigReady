import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../../../core/files/zip';
import type { Profile } from '../../../core/profile/schema';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ExportReviewView, ImportReportView, ImportResultView } from '../contract';
import { validateBundle } from './importer';
import { expandTokens, Scanner } from './privacy';
import { stripRunnable } from './strip';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(
  scenario = 'flying-all-good',
  files = ['Saved Games/DCS/**']
): Promise<WiredApp> {
  const app = await wiredApp(scenario, { files });
  apps.push(app);
  return app;
}

const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const dcsUser = (app: WiredApp, ...parts: string[]): string =>
  path.join(app.home, 'Saved Games', 'DCS', ...parts);

/** The fixture setup with things worth hiding and things that run, and two tracked folders. */
async function personalSetup(app: WiredApp): Promise<void> {
  const { profiles } = app.wiring.context;
  const loaded = await profiles.get('dcs-f-a-18c');
  if (!loaded.ok) throw new Error('no profile');
  const profile: Profile = {
    ...loaded.value,
    checks: [
      ...loaded.value.checks,
      {
        id: 'vpn',
        type: 'script.run',
        title: 'Checks squadron VPN',
        required: false,
        params: { script: path.join(app.home, 'Scripts', 'check_vpn.py') },
      },
      {
        id: 'pedals-serial',
        type: 'device.connected',
        title: 'Pedals by serial',
        required: true,
        params: { vendorId: '044F', productId: 'B68F', serial: 'TPR0012345' },
      },
      {
        id: 'opts',
        type: 'file.exists',
        title: 'DCS options',
        required: true,
        params: { path: dcsUser(app, 'Config', 'options.lua') },
      },
    ],
  };
  const saved = await profiles.save(profile);
  if (!saved.ok) throw new Error(saved.error.message);
  for (const item of [
    { label: 'DCS bindings', path: '{DCS_USER}/Config/Input', kind: 'folder' },
    { label: 'DCS scripts', path: '{DCS_USER}/Scripts', kind: 'folder' },
  ]) {
    await app.invoke('backup:saveItem', { scope: 'dcs-f-a-18c', item });
  }
  // A config file that mentions this PC, its user folder and its user.
  await fs.writeFile(
    dcsUser(app, 'Scripts', 'Hooks.lua'),
    [
      `-- written on ${os.hostname()} by ${path.basename(app.home)}`,
      `local logs = "${dcsUser(app, 'Logs').replace(/\\/g, '\\\\')}"`,
      `local pedals = "USB\\\\VID_044F&PID_B68F\\\\TPR0012345"`,
      '-- pedals serial TPR0012345',
      '',
    ].join('\n')
  );
  await fs.writeFile(dcsUser(app, 'Scripts', 'check_vpn.py'), 'print("vpn")\n');
  await fs.writeFile(dcsUser(app, 'Scripts', 'helper.exe'), 'MZ');
}

const ALL_ITEMS = ['dcs-bindings', 'dcs-scripts'];

async function exportTo(
  app: WiredApp,
  file: string,
  decisions: Record<string, 'keep' | 'remove'> = {}
): Promise<Map<string, Uint8Array>> {
  app.ports.dialogs.script.save.push(file);
  const result = await app.invoke<{ path: string }>('sharing:export', {
    profileId: 'dcs-f-a-18c',
    includeItems: ALL_ITEMS,
    decisions,
    notes: 'For the squadron',
    reviewed: true,
  });
  const entries = readZip(new Uint8Array(await fs.readFile(result.path)));
  if (!entries.ok) throw new Error(entries.error.message);
  return new Map(entries.value.map((e) => [e.path, e.data]));
}

describe('sharing a setup', () => {
  it('reviews every personal detail, what runs and what is left out, before anything is written', async () => {
    const app = await start();
    await personalSetup(app);
    const review = await app.invoke<ExportReviewView>('sharing:prepare', {
      profileId: 'dcs-f-a-18c',
      includeItems: ALL_ITEMS,
    });
    const found = (kind: string): string[] =>
      review.findings.filter((f) => f.kind === kind).map((f) => f.value);
    expect(found('userName')).toContain(path.basename(app.home));
    expect(found('machineName')).toEqual([os.hostname()]);
    expect(found('serial')).toEqual(['TPR0012345']);
    expect(found('instancePath')).toEqual(
      expect.arrayContaining([
        'USB\\\\VID_044F&PID_B68F\\\\TPR0012345',
        expect.stringMatching(/^\\\\\?\\display#sam7053/),
      ])
    );
    expect(found('path')).toContain(dcsUser(app));
    expect(found('deviceId')).toContain('T-Pendular-Rudder {7F3956A0-B756-11f0-801B-444553540000}');
    // Defaults: identities go, controller ids in file names stay.
    const byKind = (kind: string) => review.findings.find((f) => f.kind === kind)!;
    expect(byKind('serial').defaultAction).toBe('remove');
    expect(byKind('userName').defaultAction).toBe('remove');
    expect(byKind('machineName').defaultAction).toBe('remove');
    expect(byKind('instancePath').defaultAction).toBe('remove');
    expect(byKind('deviceId').defaultAction).toBe('keep');
    expect(byKind('serial').where).toEqual(
      expect.arrayContaining(['Setup: "Pedals by serial"', 'DCS scripts / Hooks.lua'])
    );

    expect(review.stripped).toEqual(
      expect.arrayContaining([
        { kind: 'launch', name: 'DCS.exe', description: 'Launch DCS.exe' },
        { kind: 'check', name: 'check_vpn.py', description: 'Checks squadron VPN' },
        { kind: 'fix', name: 'TrackIR5.exe', description: 'Fix for "TrackIR5"' },
      ])
    );
    expect(review.excluded).toEqual([
      { path: '{DCS_USER}/Scripts/check_vpn.py', reason: 'Program or script' },
      { path: '{DCS_USER}/Scripts/helper.exe', reason: 'Program or script' },
    ]);
    expect(review.compatibility.hardware).toContainEqual({
      name: 'WINWING MFD1-C',
      vendorId: '4098',
      productId: 'BEE0',
      required: true,
    });
    expect(review.compatibility.software.map((s) => s.name)).toEqual([
      'DCS World',
      'TrackIR5',
      'SimAppPro',
      'Stream Deck',
    ]);
    expect(review.compatibility.displays).toEqual({
      count: 4,
      summary: '4 monitors: 5120×1440, 3 × 768×1024 rotated 90°',
    });
    expect(review.notes).toContain('- WINWING MFD1-C (4098:BEE0)');
    expect(review.notes).toContain('Optional hardware:\n- Stream Deck XL (0FD9:008F)');
    // Nothing was written.
    expect(app.ports.dialogs.calls).toEqual([]);
  });

  it('refuses to export until the review was ticked', async () => {
    const app = await start();
    await expect(
      app.invoke('sharing:export', {
        profileId: 'dcs-f-a-18c',
        includeItems: [],
        notes: '',
        reviewed: false,
      })
    ).rejects.toThrow(/ipc.input/);
  });

  it('with the defaults the file holds no user name, machine name, serial or personal path', async () => {
    const app = await start();
    await personalSetup(app);
    const target = path.join(app.home, 'Documents', 'F18.rigready');
    const entries = await exportTo(app, target);
    const user = path.basename(app.home);
    for (const [name, data] of entries) {
      const content = new TextDecoder().decode(data);
      for (const secret of [
        user,
        os.hostname(),
        'TPR0012345',
        app.home,
        app.home.replace(/\\/g, '\\\\'),
      ]) {
        expect(content.toLowerCase(), `${name} contains ${secret}`).not.toContain(
          secret.toLowerCase()
        );
        expect(name.toLowerCase()).not.toContain(secret.toLowerCase());
      }
      expect(name).not.toMatch(/\.(py|exe)$/);
    }
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    expect(manifest).toMatchObject({
      format: 'rigready-setup',
      schemaVersion: 1,
      appVersion: expect.any(String),
      name: 'DCS F/A-18C',
      game: 'dcs',
      notes: 'For the squadron',
      stripped: expect.arrayContaining([
        { kind: 'check', name: 'check_vpn.py', description: 'Checks squadron VPN' },
      ]),
      compatibility: { hardware: expect.any(Array), software: expect.any(Array) },
    });
    const profile = yaml.load(new TextDecoder().decode(entries.get('profile.yaml'))) as Profile;
    expect(profile.launch).toBeUndefined();
    expect(profile.checks.find((c) => c.id === 'vpn')).toBeUndefined();
    expect(profile.checks.find((c) => c.id === 'pedals-serial')!.params).toEqual({
      vendorId: '044F',
      productId: 'B68F',
    });
    expect(profile.checks.find((c) => c.id === 'opts')!.params['path']).toBe(
      '{DCS_USER}\\Config\\options.lua'
    );
    expect(profile.checks.find((c) => c.id === 'c13')!.remediation).toBeUndefined();
    // Paths inside config files become tokens that the importer expands to its own folders.
    const hooks = new TextDecoder().decode([...entries].find(([k]) => k.endsWith('Hooks.lua'))![1]);
    expect(hooks).toContain('local logs = "%RIGREADY:DCS_USER:dbs%\\\\Logs"');
    expect(hooks).toContain('written on my-pc by user');
    expect(hooks).toContain('local pedals = "removed"');
    expect(entries.has('layout.json')).toBe(true);
    // The written file is journaled like any change outside RigReady's folder.
    const groups = await app.ports.files.journalGroups();
    expect(groups.ok && groups.value[0]!.reason).toBe('Share setup DCS F/A-18C');
  });

  it('keeps what the user chose to keep, and leaves out files whose finding is removed', async () => {
    const app = await start();
    await personalSetup(app);
    const review = await app.invoke<ExportReviewView>('sharing:prepare', {
      profileId: 'dcs-f-a-18c',
      includeItems: ALL_ITEMS,
    });
    const machine = review.findings.find((f) => f.kind === 'machineName')!;
    const rudder = review.findings.find(
      (f) => f.kind === 'deviceId' && f.value.startsWith('T-Pendular')
    )!;
    const entries = await exportTo(app, path.join(app.home, 'Documents', 'k.rigready'), {
      [machine.id]: 'keep',
      [rudder.id]: 'remove',
    });
    const hooks = new TextDecoder().decode([...entries].find(([k]) => k.endsWith('Hooks.lua'))![1]);
    expect(hooks).toContain(`written on ${os.hostname()}`);
    expect([...entries.keys()].some((k) => k.includes('T-Pendular'))).toBe(false);
    expect([...entries.keys()].some((k) => k.includes('WINWING MFD1-C'))).toBe(true);
  });

  it('cancelling the save dialog writes nothing', async () => {
    const app = await start();
    app.ports.dialogs.script.save.push(null);
    expect(
      await app.invoke('sharing:export', { profileId: 'dcs-f-a-18c', notes: '', reviewed: true })
    ).toBeNull();
  });
});

describe('importing a shared setup', () => {
  async function shared(): Promise<string> {
    const owner = await start();
    await personalSetup(owner);
    const file = path.join(owner.home, 'Documents', 'F18.rigready');
    await exportTo(owner, file);
    return file;
  }

  async function open(app: WiredApp, file: string): Promise<ImportReportView> {
    const dir = path.join(app.home, 'Downloads');
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(file, path.join(dir, path.basename(file)));
    app.ports.dialogs.script.open.push([`Downloads/${path.basename(file)}`]);
    return app.invoke<ImportReportView>('sharing:openImport');
  }

  it('reports what it needs against this PC: missing devices, the game, helper apps, monitors', async () => {
    const file = await shared();
    // A racing rig: no WinWing gear, no MFD screens, DCS installed.
    const friend = await start('racing-fresh', [
      'Saved Games/DCS/**',
      'Program Files (x86)/Steam/**',
      'Program Files (x86)/TrackIR5/**',
    ]);
    const report = await open(friend, file);
    const winwing = report.compatibility.devices.filter((d) => d.vendorId === '4098');
    expect(winwing.length).toBeGreaterThan(5);
    expect(winwing.every((d) => !d.present)).toBe(true);
    expect(report.compatibility.devices.find((d) => d.name === 'TrackIR 5')!.present).toBe(true);
    expect(report.compatibility.software[0]).toMatchObject({
      name: 'DCS World',
      found: true,
      detail: 'Installed (steam)',
    });
    expect(report.compatibility.software.find((s) => s.name === 'TrackIR5')).toMatchObject({
      found: true,
    });
    expect(report.compatibility.displays).toMatchObject({ needed: 4, here: 2 });
    expect(report.wantedToRun.map((w) => w.name)).toEqual(
      expect.arrayContaining(['DCS.exe', 'check_vpn.py', 'TrackIR5.exe'])
    );
    expect(report.parts.map((p) => [p.id, p.importable])).toEqual([
      ['profile', true],
      ['layout', true],
      ['group:0', true],
      ['group:1', true],
    ]);
  });

  it("imports only the ticked parts, into this PC's folders, as one undoable action", async () => {
    const file = await shared();
    const friend = await start('racing-fresh', ['Saved Games/DCS/Config/**']);
    await fs.rm(dcsUser(friend, 'Config', 'Input'), { recursive: true });
    const report = await open(friend, file);
    const result = await friend.invoke<ImportResultView>('sharing:import', {
      importId: report.importId,
      parts: ['profile', 'group:1'],
    });
    expect(result.failed).toEqual([]);
    expect(result.layoutName).toBeUndefined();
    // Only the scripts group was written; the bindings were not ticked.
    expect(await fs.readdir(dcsUser(friend, 'Config'))).not.toContain('Input');
    const hooks = await fs.readFile(dcsUser(friend, 'Scripts', 'Hooks.lua'), 'utf8');
    expect(hooks).toContain(`local logs = "${dcsUser(friend, 'Logs').replace(/\\/g, '\\\\')}"`);
    expect(result.written.every((w) => w.startsWith(friend.home))).toBe(true);

    const profile = await friend.wiring.context.profiles.get(result.profileId!);
    if (!profile.ok) throw new Error('not imported');
    expect(profile.value.launch).toBeUndefined();
    const mfd = profile.value.checks.find((c) => c.params['productId'] === 'BEE0')!;
    expect(mfd).toMatchObject({ required: false, title: 'WINWING MFD1-C (device not found)' });
    expect(profile.value.checks.find((c) => c.title === 'TrackIR 5')!.required).toBe(true);

    const groups = await friend.ports.files.journalGroups();
    const group = groups.ok ? groups.value.find((g) => g.id === result.groupId) : undefined;
    expect(group?.reason).toBe('Import shared setup "DCS F/A-18C"');
    expect(group?.entries.length).toBe(result.written.length);
    await friend.invoke('safety:undo', { groupId: result.groupId });
    await expect(fs.access(dcsUser(friend, 'Scripts', 'Hooks.lua'))).rejects.toThrow();
  });

  it('keep both adds shared copies next to differing files; a second import of a setup gets its own name', async () => {
    const file = await shared();
    const friend = await start('flying-all-good');
    await fs.writeFile(dcsUser(friend, 'Scripts', 'Hooks.lua'), '-- mine\n');
    const report = await open(friend, file);
    const result = await friend.invoke<ImportResultView>('sharing:import', {
      importId: report.importId,
      parts: ['profile', 'layout', 'group:1'],
      conflict: 'keepBoth',
    });
    expect(await fs.readFile(dcsUser(friend, 'Scripts', 'Hooks.lua'), 'utf8')).toBe('-- mine\n');
    expect(result.written).toContain(dcsUser(friend, 'Scripts', 'Hooks (shared).lua'));
    expect(result.profileName).toBe('DCS F/A-18C (shared)');
    expect(result.layoutName).toBe('DCS F/A-18C monitors');
    // Every device is here, so nothing is marked missing.
    const profile = await friend.wiring.context.profiles.get(result.profileId!);
    expect(
      profile.ok && profile.value.checks.every((c) => !c.title.endsWith('(device not found)'))
    ).toBe(true);
  });
});

describe('hostile .rigready files', () => {
  interface Parts {
    manifest?: Record<string, unknown>;
    profile?: string;
    files?: Record<string, Uint8Array | [Uint8Array, object]>;
    raw?: Record<string, Uint8Array | [Uint8Array, object]>;
  }
  const baseProfile = yaml.dump({
    id: 'x',
    name: 'Shared',
    createdAt: 'a',
    updatedAt: 'b',
    checks: [],
  });

  function bundle(parts: Parts): Uint8Array {
    const profile = parts.profile ?? baseProfile;
    const manifest = {
      format: 'rigready-setup',
      schemaVersion: 1,
      appVersion: '2',
      createdAt: '2026-10-03T12:00:00.000Z',
      name: 'Shared',
      compatibility: { hardware: [], software: [] },
      profile: { sha256: sha(profile) },
      groups: [],
      ...parts.manifest,
    };
    return zipSync({
      'manifest.json': text(JSON.stringify(manifest)),
      'profile.yaml': text(profile),
      ...parts.files,
      ...parts.raw,
    } as never);
  }

  async function offer(app: WiredApp, bytes: Uint8Array): Promise<ImportReportView | string> {
    await fs.mkdir(path.join(app.home, 'Downloads'), { recursive: true });
    await fs.writeFile(path.join(app.home, 'Downloads', 'x.rigready'), bytes);
    app.ports.dialogs.script.open.push(['Downloads/x.rigready']);
    try {
      return await app.invoke<ImportReportView>('sharing:openImport');
    } catch (e) {
      return (e as Error).message;
    }
  }

  const group = (groupPath: string, files: Record<string, string>, extra: object = {}) => ({
    label: 'Files',
    path: groupPath,
    kind: 'folder',
    files: Object.entries(files).map(([p, c]) => ({
      path: p,
      size: c.length,
      sha256: sha(c),
      ...extra,
    })),
  });

  it('rejects path traversal, links, oversized archives and unlisted files before anything is shown', async () => {
    const app = await start('flying-fresh', ['Saved Games/DCS/Config/**']);
    expect(await offer(app, bundle({ raw: { '../../evil.lua': text('x') } }))).toMatch(
      /unsafe path/
    );
    expect(await offer(app, bundle({ raw: { 'C:/Windows/evil.dll': text('x') } }))).toMatch(
      /unsafe path/
    );
    expect(
      await offer(
        app,
        bundle({ raw: { 'files/0/link': [text('C:/Windows'), { os: 3, attrs: 0o120777 << 16 }] } })
      )
    ).toMatch(/link/);
    expect(await offer(app, bundle({ raw: { 'extra.txt': text('x') } }))).toMatch(/does not list/);
    await app.wiring.context.settings.update({ importMaxMegabytes: 1 });
    expect(
      await offer(app, bundle({ raw: { 'big.bin': new Uint8Array(3 * 1024 * 1024) } }))
    ).toMatch(/larger than 1 MB|more than 1 MB/);
    expect(await offer(app, text('not a zip at all'))).toMatch(/not a readable zip/);
  });

  it('rejects an archive that claims to unpack to more than 200 MB, without unpacking it', () => {
    const bytes = bundle({ raw: { 'big.bin': new Uint8Array(1000) } });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Make the central directory say big.bin is 201 MB.
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(i + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLength));
      if (name === 'big.bin') view.setUint32(i + 24, 201 * 1024 * 1024, true);
    }
    expect(validateBundle(bytes, 200 * 1024 * 1024)).toMatchObject({
      ok: false,
      error: { code: 'zip.tooBig', message: 'The archive unpacks to more than 200 MB.' },
    });
    expect(validateBundle(new Uint8Array(201 * 1024 * 1024), 200 * 1024 * 1024)).toMatchObject({
      ok: false,
      error: { code: 'zip.tooBig' },
    });
  });

  it('rejects malformed manifests and setups, damaged files and programs', async () => {
    const app = await start('flying-fresh', ['Saved Games/DCS/Config/**']);
    expect(await offer(app, bundle({ manifest: { format: 'something-else' } }))).toMatch(
      /not valid/
    );
    expect(await offer(app, zipSync({ 'manifest.json': text('{oops') }))).toMatch(/not valid JSON/);
    expect(await offer(app, zipSync({ 'profile.yaml': text(baseProfile) }))).toMatch(/no manifest/);
    expect(await offer(app, bundle({ profile: 'name: [unclosed' }))).toMatch(/not valid YAML/);
    expect(await offer(app, bundle({ profile: yaml.dump({ id: 'Bad Id!', name: '' }) }))).toMatch(
      /setup in the file is not valid/
    );
    expect(
      await offer(
        app,
        bundle({
          manifest: { groups: [group('{DCS_USER}/Scripts', { 'a.lua': 'one' })] },
          files: { 'files/0/a.lua': text('two') },
        })
      )
    ).toMatch(/damaged/);
    expect(
      await offer(
        app,
        bundle({
          manifest: { groups: [group('{DCS_USER}/Scripts', { 'run.ps1': 'x' })] },
          files: { 'files/0/run.ps1': text('x') },
        })
      )
    ).toMatch(/program or script: run\.ps1/);
  });

  it('never writes outside known folders and drops runnable parts that were left in the file', async () => {
    const app = await start('flying-fresh', ['Saved Games/DCS/Config/**']);
    const sneaky = yaml.dump({
      id: 'x',
      name: 'Shared',
      createdAt: 'a',
      updatedAt: 'b',
      launch: { exe: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'del', 'C:\\'] },
      checks: [
        {
          id: 'a',
          type: 'script.run',
          title: 'Totally harmless',
          params: { script: 'payload.ps1' },
        },
        {
          id: 'b',
          type: 'process.running',
          title: 'Helper',
          params: { name: 'helper.exe' },
          remediation: { type: 'process.launch', params: { exe: 'C:\\evil\\helper.exe' } },
        },
      ],
    });
    const report = await offer(
      app,
      bundle({
        profile: sneaky,
        manifest: {
          groups: [
            group('{PROGRAM_FILES}/Startup', { 'a.ini': 'x' }),
            group('C:/Windows/System32', { 'b.ini': 'x' }),
            group('{DCS_USER}/Config', { 'ok.lua': 'fine' }),
            group('{APPDATA}/SimAppPro', { 'config.json': '{}' }),
          ],
        },
        files: {
          'files/0/a.ini': text('x'),
          'files/1/b.ini': text('x'),
          'files/2/ok.lua': text('fine'),
          'files/3/config.json': text('{}'),
        },
      })
    );
    if (typeof report === 'string') throw new Error(report);
    expect(report.wantedToRun).toEqual([
      { kind: 'launch', name: 'cmd.exe', description: 'Launch cmd.exe /c del C:\\', inFile: true },
      { kind: 'check', name: 'payload.ps1', description: 'Totally harmless', inFile: true },
      { kind: 'fix', name: 'helper.exe', description: 'Fix for "Helper"', inFile: true },
    ]);
    const parts = Object.fromEntries(report.parts.map((p) => [p.id, p]));
    expect(parts['group:0']).toMatchObject({
      importable: false,
      problem: expect.stringMatching(/outside Documents/),
    });
    expect(parts['group:1']).toMatchObject({
      importable: false,
      problem: expect.stringMatching(/full path/),
    });
    expect(parts['group:2']).toMatchObject({ importable: true });
    // The credentials file is never written, even when a bundle carries it.
    expect(parts['group:3']).toMatchObject({ importable: false });

    const result = await app.invoke<ImportResultView>('sharing:import', {
      importId: report.importId,
      parts: ['profile', 'group:0', 'group:1', 'group:2', 'group:3'],
    });
    expect(result.written).toEqual([dcsUser(app, 'Config', 'ok.lua')]);
    expect(result.failed.map((f) => f.label)).toEqual(['Files', 'Files', 'Files']);
    await expect(
      fs.access(path.join(app.home, 'Program Files', 'Startup', 'a.ini'))
    ).rejects.toThrow();
    const profile = await app.wiring.context.profiles.get(result.profileId!);
    if (!profile.ok) throw new Error('not imported');
    expect(profile.value.launch).toBeUndefined();
    expect(profile.value.checks.map((c) => c.id)).toEqual(['b']);
    expect(profile.value.checks[0]!.remediation).toBeUndefined();
  });
});

describe('privacy helpers', () => {
  it('strips launch, script checks and program-starting fixes, and keeps everything else', () => {
    const profile: Profile = {
      schemaVersion: 1,
      id: 'p',
      name: 'P',
      createdAt: 'a',
      updatedAt: 'b',
      extensions: {},
      checks: [
        {
          id: '1',
          type: 'service.running',
          title: 'HidHide',
          required: true,
          params: { name: 'HidHide' },
        },
        { id: '2', type: 'runScript', title: 'Custom', required: true, params: {} },
        {
          id: '3',
          type: 'device.connected',
          title: 'Stick',
          required: true,
          params: { vendorId: '4098', productId: 'BEA8' },
        },
      ],
    };
    const { profile: clean, stripped } = stripRunnable(profile);
    expect(clean.checks.map((c) => c.id)).toEqual(['1', '3']);
    expect(stripped).toEqual([{ kind: 'check', name: 'runScript', description: 'Custom' }]);
  });

  it('a user name inside a kept path is part of the path, and tokens expand per spelling', () => {
    const scanner = new Scanner({
      variables: { SAVED_GAMES: 'C:\\Users\\Mark\\Saved Games' },
      users: ['Mark'],
      machine: 'RIG',
      serials: [],
    });
    const keepPaths = (f: { kind: string; defaultAction: 'keep' | 'remove' }) =>
      f.kind === 'path' ? 'keep' : f.defaultAction;
    expect(
      scanner.transform('C:\\Users\\Mark\\Saved Games\\DCS and Mark', 'x', 'file', keepPaths)
    ).toBe('C:\\Users\\Mark\\Saved Games\\DCS and user');
    const tokens = scanner.transform(
      'a=C:\\Users\\Mark\\Saved Games b=C:\\\\Users\\\\Mark\\\\Saved Games c=C:/Users/Mark/Saved Games/x',
      'x',
      'file',
      (f) => f.defaultAction
    );
    expect(tokens).toBe(
      'a=%RIGREADY:SAVED_GAMES:bs% b=%RIGREADY:SAVED_GAMES:dbs% c=%RIGREADY:SAVED_GAMES:fs%/x'
    );
    expect(expandTokens(tokens, { SAVED_GAMES: 'D:\\Bob\\SG' })).toBe(
      'a=D:\\Bob\\SG b=D:\\\\Bob\\\\SG c=D:/Bob/SG/x'
    );
    expect(expandTokens('%RIGREADY:UNKNOWN:bs%', {})).toBe('%RIGREADY:UNKNOWN:bs%');
    // Audio endpoint ids are listed and kept unless the user removes them.
    const audio = '{0.0.0.00000000}.{a1b2c3d4-0000-1111-2222-333344445555}';
    expect(scanner.transform(`id=${audio}`, 'Setup', 'profile', (f) => f.defaultAction)).toBe(
      `id=${audio}`
    );
    expect(scanner.list().find((f) => f.kind === 'audioId')).toMatchObject({
      value: audio,
      defaultAction: 'keep',
    });
    expect(scanner.transform(`id=${audio}`, 'Setup', 'profile', () => 'remove')).toBe('id=');
  });
});
