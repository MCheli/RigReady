import path from 'node:path';
import { z } from 'zod';
import type { TrackedFileSuggestion } from '../../../core/games';
import type { FileStore, Ports, Registry } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { DeviceInfo, ProcessInfo } from '../../../shared/models';

/**
 * TrackIR 5 (NaturalPoint). There is no API: RigReady reads the program, the camera on
 * USB, the NPClient registration games use to find TrackIR, and TrackIR's own files.
 */

export const NATURALPOINT_VENDOR_ID = '131D';
export const PROCESS_NAME = 'TrackIR5.exe';
export const DOWNLOAD_URL = 'https://www.trackir.com/downloads/';
export const NPCLIENT_KEY = 'Software\\NaturalPoint\\NATURALPOINT\\NPClient Location';

export const TrackIrDeviceSchema = z.object({
  name: z.string(),
  productId: z.string(),
  serial: z.string().optional(),
});

export const NpClientSchema = z.object({
  /** True when games will find TrackIR's NPClient64.dll. */
  ok: z.boolean(),
  /** The folder registered for games, when there is one. */
  path: z.string().optional(),
  /** Why games will not find TrackIR, in words for the user. */
  problem: z.string().optional(),
});

export const TrackIrStatusSchema = z.object({
  installed: z.boolean(),
  exePath: z.string().optional(),
  version: z.string().optional(),
  running: z.boolean(),
  devices: z.array(TrackIrDeviceSchema),
  npClient: NpClientSchema,
  /** %APPDATA%\NaturalPoint\TrackIR 5 */
  dataFolder: z.string(),
});
export type TrackIrStatus = z.infer<typeof TrackIrStatusSchema>;

export const TrackIrProfilesSchema = z.object({
  /** From Settings.xml, as TrackIR last saved it (it may lag what the TrackIR window shows). */
  lastProfile: z.string().optional(),
  /** Set when TrackIR uses one profile for every game. */
  exclusiveProfile: z.string().optional(),
  settingsFound: z.boolean(),
  profiles: z.array(
    z.object({ file: z.string(), name: z.string(), description: z.string().optional() })
  ),
  /** ProfileMap.dat: which profile TrackIR loads when a game connects. */
  map: z.object({
    found: z.boolean(),
    games: z.number().int(),
    byProfile: z.array(
      z.object({
        file: z.string(),
        /** The profile's display name when its file exists. */
        name: z.string().optional(),
        exists: z.boolean(),
        gameIds: z.array(z.string()),
      })
    ),
  }),
});
export type TrackIrProfiles = z.infer<typeof TrackIrProfilesSchema>;

export function isTrackIr(device: Pick<DeviceInfo, 'vendorId'>): boolean {
  return device.vendorId.toUpperCase() === NATURALPOINT_VENDOR_ID;
}

export const isTrackIrProcess = (p: ProcessInfo): boolean =>
  p.name.toLowerCase() === PROCESS_NAME.toLowerCase();

export function dataFolder(ports: Ports): string {
  return path.join(ports.folders.appData(), 'NaturalPoint', 'TrackIR 5');
}

const UNINSTALL_KEYS: { hive: 'HKLM' | 'HKCU'; key: string }[] = [
  { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
];

/** TrackIR's installer leaves two entries ("TrackIR 5" and the bootstrapper's "TrackIR"). */
async function uninstallEntries(
  registry: Registry
): Promise<{ version?: string; installLocation?: string }[]> {
  const found: { version?: string; installLocation?: string }[] = [];
  for (const { hive, key } of UNINSTALL_KEYS) {
    const keys = await registry.listKeys(hive, key);
    if (!keys.ok) continue;
    for (const sub of keys.value) {
      const values = await registry.listValues(hive, `${key}\\${sub}`);
      if (!values.ok) continue;
      const name = values.value['DisplayName'];
      if (name?.type !== 'string' || !/^TrackIR( 5)?$/i.test(name.value.trim())) continue;
      const version = values.value['DisplayVersion'];
      const location = values.value['InstallLocation'];
      found.push({
        ...(version?.type === 'string' && version.value ? { version: version.value } : {}),
        ...(location?.type === 'string' && location.value
          ? { installLocation: location.value }
          : {}),
      });
    }
  }
  return found;
}

export async function findExe(ports: Ports): Promise<{ exe?: string; version?: string }> {
  const entries = await uninstallEntries(ports.registry);
  const candidates = [
    ...entries.flatMap((e) =>
      e.installLocation ? [path.join(e.installLocation, PROCESS_NAME)] : []
    ),
    path.join(ports.folders.programFilesX86(), 'TrackIR5', PROCESS_NAME),
    path.join(ports.folders.programFiles(), 'TrackIR5', PROCESS_NAME),
  ];
  let exe: string | undefined;
  for (const candidate of candidates) {
    if (await ports.files.exists(candidate)) {
      exe = candidate;
      break;
    }
  }
  // The most precise version wins: "5.5.3.317" over "5.5.3".
  const version = entries
    .map((e) => e.version)
    .filter((v): v is string => v !== undefined)
    .sort((a, b) => b.split('.').length - a.split('.').length)[0];
  return { ...(exe ? { exe } : {}), ...(exe && version ? { version } : {}) };
}

async function npClient(ports: Ports, installed: boolean): Promise<z.infer<typeof NpClientSchema>> {
  const value = await ports.registry.getValue('HKCU', NPCLIENT_KEY, 'Path');
  const registered = value.ok && value.value?.type === 'string' ? value.value.value : undefined;
  if (!registered) {
    return {
      ok: false,
      problem: installed
        ? 'Games cannot find TrackIR: it is not registered for this Windows user. TrackIR registers itself when it starts, so start it once.'
        : 'Games cannot find TrackIR: it is not installed.',
    };
  }
  if (!(await ports.files.exists(path.join(registered, 'NPClient64.dll')))) {
    return {
      ok: false,
      path: registered,
      problem: `Games look for TrackIR in ${registered}, which has no NPClient64.dll. Another head-tracking program may have changed this; starting TrackIR sets it back.`,
    };
  }
  return { ok: true, path: registered };
}

export async function detectTrackIr(ports: Ports): Promise<Result<TrackIrStatus>> {
  const { exe, version } = await findExe(ports);
  const processes = await ports.processes.list();
  if (!processes.ok) return processes;
  const devices = await ports.devices.list();
  if (!devices.ok) return devices;
  return ok({
    installed: exe !== undefined,
    ...(exe ? { exePath: exe } : {}),
    ...(version ? { version } : {}),
    running: processes.value.some(isTrackIrProcess),
    devices: devices.value.filter(isTrackIr).map((d) => ({
      name: d.name || 'TrackIR',
      productId: d.productId,
      ...(d.serial ? { serial: d.serial } : {}),
    })),
    npClient: await npClient(ports, exe !== undefined),
    dataFolder: dataFolder(ports),
  });
}

/** TrackIR profiles say UTF-16 but are often plain ASCII: decide from the bytes. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0)
    return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(xml);
  const value = match?.[1]
    ?.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
  return value ? value : undefined;
}

/** ProfileMap.dat: "<NaturalPoint game id> <profile file>" per line. */
export function parseProfileMap(text: string): { gameId: string; file: string }[] {
  const out: { gameId: string; file: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(-?\d+)\s+(.+?)\s*$/.exec(line);
    if (match) out.push({ gameId: match[1]!, file: match[2]! });
  }
  return out;
}

async function readDecoded(files: FileStore, file: string): Promise<string | undefined> {
  const bytes = await files.readBytes(file);
  return bytes.ok ? decodeText(bytes.value) : undefined;
}

export async function readTrackIrProfiles(ports: Ports): Promise<Result<TrackIrProfiles>> {
  const dir = dataFolder(ports);
  const settings = await readDecoded(ports.files, path.join(dir, 'Settings.xml'));
  const entries = await ports.files.listEntries(path.join(dir, 'Profiles'));
  if (!entries.ok) return entries;
  const profiles: TrackIrProfiles['profiles'] = [];
  for (const entry of entries.value) {
    if (entry.isDirectory || !/\.xml$/i.test(entry.name)) continue;
    const xml = await readDecoded(ports.files, entry.path);
    const description = xml ? xmlValue(xml, 'Description') : undefined;
    profiles.push({
      file: entry.name,
      name: (xml && xmlValue(xml, 'Name')) ?? entry.name.replace(/\.xml$/i, ''),
      ...(description ? { description } : {}),
    });
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  const mapText = await readDecoded(ports.files, path.join(dir, 'ProfileMap.dat'));
  const map = mapText ? parseProfileMap(mapText) : [];
  const groups = new Map<string, string[]>();
  for (const { gameId, file } of map) {
    // -1 is TrackIR's own "no game" slot, not a game.
    if (gameId === '-1') continue;
    groups.set(file, [...(groups.get(file) ?? []), gameId]);
  }
  for (const ids of groups.values()) ids.sort((a, b) => Number(a) - Number(b));
  const byFile = new Map(profiles.map((p) => [p.file.toLowerCase(), p]));
  const lastProfile = settings ? xmlValue(settings, 'LastProfile') : undefined;
  const exclusiveProfile = settings ? xmlValue(settings, 'ExclusiveProfile') : undefined;
  return ok({
    ...(lastProfile ? { lastProfile } : {}),
    ...(exclusiveProfile ? { exclusiveProfile } : {}),
    settingsFound: settings !== undefined,
    profiles,
    map: {
      found: mapText !== undefined,
      games: [...groups.values()].reduce((sum, ids) => sum + ids.length, 0),
      byProfile: [...groups]
        .map(([file, gameIds]) => {
          const profile = byFile.get(file.toLowerCase());
          return {
            file,
            ...(profile ? { name: profile.name } : {}),
            exists: profile !== undefined,
            gameIds,
          };
        })
        .sort((a, b) => b.gameIds.length - a.gameIds.length || a.file.localeCompare(b.file)),
    },
  });
}

/**
 * What a full backup should include for TrackIR: settings, the game-to-profile map and
 * every profile. Only files that exist are listed.
 */
export async function trackIrTrackedFiles(ports: Ports): Promise<Result<TrackedFileSuggestion[]>> {
  const dir = dataFolder(ports);
  const out: TrackedFileSuggestion[] = [];
  for (const [file, label] of [
    ['Settings.xml', 'TrackIR settings'],
    ['ProfileMap.dat', 'TrackIR game-to-profile map'],
  ] as const) {
    const full = path.join(dir, file);
    if (await ports.files.exists(full)) out.push({ label, path: full });
  }
  const profiles = await ports.files.listEntries(path.join(dir, 'Profiles'));
  if (!profiles.ok) return profiles;
  for (const entry of profiles.value) {
    if (!entry.isDirectory && /\.xml$/i.test(entry.name)) {
      out.push({ label: `TrackIR profile ${entry.name}`, path: entry.path });
    }
  }
  return ok(out);
}
