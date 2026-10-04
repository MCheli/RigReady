import path from 'node:path';
import type { FileStore } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import { modelName } from './detect';
import type { Inventory, PluginSummary, ProfileSummary, StreamDeckDevice } from './model';

/**
 * Reads Stream Deck profiles and plugins from their manifests. The same code reads the
 * live ProfilesV3 folder and the inside of a backup archive, so both are given as a
 * list of manifest files with paths relative to the profiles folder.
 */

export interface ManifestFile {
  /** Forward slashes, relative to the profiles folder: "<uuid>.sdProfile/manifest.json". */
  path: string;
  text: string;
}

export const BUILT_IN = 'com.elgato.streamdeck';

/** Plugins RigReady can name and point to even when they are not installed. */
export const KNOWN_PLUGINS: Record<
  string,
  { name: string; source?: { label: string; url: string } }
> = {
  [BUILT_IN]: { name: 'Stream Deck (built-in actions)' },
  'com.ctytler.dcs': {
    name: 'DCS Interface',
    source: {
      label: 'streamdeck-dcs-interface on GitHub',
      url: 'https://github.com/charlestytler/streamdeck-dcs-interface',
    },
  },
  'avionics.madjack.dcs': {
    name: 'DCS-BIOS plugin by Mad Jack',
    source: {
      label: 'the plugin thread on the DCS forum',
      url: 'https://forum.dcs.world/topic/230609-new-streamdeck-plugin/',
    },
  },
  'com.barraider.supermacro': {
    name: 'Super Macro by BarRaider',
    source: {
      label: 'the Elgato Marketplace',
      url: 'https://marketplace.elgato.com/stream-deck/plugins',
    },
  },
  'com.elgato.discord': { name: 'Discord' },
  'com.elgato.keycreator': { name: 'Stream Deck Icon Library' },
  'com.elgato.tutorial': { name: 'Stream Deck Tutorial' },
};

export const MARKETPLACE = {
  label: 'the Elgato Marketplace',
  url: 'https://marketplace.elgato.com/stream-deck/plugins',
};

export interface InstalledPlugin {
  id: string;
  name: string;
  version?: string;
  author?: string;
  /** Action UUIDs the plugin declares; empty when its manifest could not be read. */
  actions: string[];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    // Some manifests are encrypted (see readPluginManifest): not parseable means "no details", not an error.
    return undefined;
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * A plugin folder's manifest. Some (Elgato's own Discord plugin) are encrypted, so a
 * manifest that does not parse still yields the plugin, named from the folder.
 */
export function readPluginManifest(
  folderName: string,
  manifestText: string | undefined
): InstalledPlugin {
  const id = folderName.replace(/\.sdPlugin$/i, '');
  const json = record(manifestText === undefined ? undefined : parseJson(manifestText));
  const known = KNOWN_PLUGINS[id];
  const actions = Array.isArray(json?.['Actions'])
    ? (json['Actions'] as unknown[]).flatMap((a) => text(record(a)?.['UUID']) ?? [])
    : [];
  const version = text(json?.['Version']);
  const author = text(json?.['Author']);
  return {
    id,
    name: text(json?.['Name']) ?? known?.name ?? id,
    ...(version ? { version } : {}),
    ...(author ? { author } : {}),
    actions,
  };
}

export async function readInstalledPlugins(
  files: FileStore,
  pluginsDir: string
): Promise<Result<InstalledPlugin[]>> {
  const entries = await files.listEntries(pluginsDir);
  if (!entries.ok) return entries;
  const plugins: InstalledPlugin[] = [];
  for (const entry of entries.value) {
    if (!entry.isDirectory || !/\.sdPlugin$/i.test(entry.name)) continue;
    const manifest = await files.readText(path.join(entry.path, 'manifest.json'));
    plugins.push(readPluginManifest(entry.name, manifest.ok ? manifest.value : undefined));
  }
  return ok(plugins.sort((a, b) => a.name.localeCompare(b.name)));
}

/** Every action UUID in a page (or old-style profile) manifest, multi-action members included. */
export function actionUuids(manifest: unknown): string[] {
  const found: string[] = [];
  const visitAction = (action: unknown): void => {
    const a = record(action);
    if (!a) return;
    const uuid = text(a['UUID']);
    if (uuid) found.push(uuid);
    // Multi-actions keep their steps in Actions: [{ Actions: [...] }] or Actions: [...].
    if (Array.isArray(a['Actions'])) {
      for (const step of a['Actions'] as unknown[]) {
        const s = record(step);
        if (s && Array.isArray(s['Actions'])) (s['Actions'] as unknown[]).forEach(visitAction);
        else visitAction(step);
      }
    }
  };
  const visitMap = (map: unknown): void => {
    const m = record(map);
    if (m) Object.values(m).forEach(visitAction);
  };
  const root = record(manifest);
  if (!root) return found;
  if (Array.isArray(root['Controllers'])) {
    for (const controller of root['Controllers'] as unknown[]) {
      visitMap(record(controller)?.['Actions']);
    }
  }
  visitMap(root['Actions']);
  return found;
}

/** Which plugin an action belongs to. */
export function pluginForAction(uuid: string, installed: InstalledPlugin[]): string {
  const lower = uuid.toLowerCase();
  if (lower.startsWith(`${BUILT_IN}.`)) return BUILT_IN;
  let best: string | undefined;
  for (const plugin of installed) {
    const id = plugin.id.toLowerCase();
    const declared = plugin.actions.some((a) => a.toLowerCase() === lower);
    if (declared || lower === id || lower.startsWith(`${id}.`)) {
      if (!best || plugin.id.length > best.length) best = plugin.id;
    }
  }
  if (best) return best;
  // Not installed: plugin UUIDs are reverse-DNS ("avionics.madjack.dcs"), actions add a part.
  const known = Object.keys(KNOWN_PLUGINS).find((id) => lower.startsWith(`${id.toLowerCase()}.`));
  if (known) return known;
  const parts = uuid.split('.');
  return parts.length >= 4 ? parts.slice(0, 3).join('.') : uuid;
}

/** "@(1)[4057/143/A00NA33331P1UB]": vendor and product id in decimal, then the serial. */
export function parseDeviceUuid(
  uuid: string | undefined
): { vendorId: string; productId: string; serial?: string } | undefined {
  const match = /\[(\d+)\/(\d+)(?:\/([^\]]*))?\]/.exec(uuid ?? '');
  if (!match) return undefined;
  const hex = (n: string): string => Number(n).toString(16).toUpperCase().padStart(4, '0');
  return {
    vendorId: hex(match[1]!),
    productId: hex(match[2]!),
    ...(match[3] ? { serial: match[3] } : {}),
  };
}

export interface ParsedProfile extends ProfileSummary {
  actionList: string[];
}

/** Groups manifest files by profile folder and summarises each profile. */
export function readProfiles(
  manifests: ManifestFile[],
  devices: StreamDeckDevice[] = []
): { profiles: ParsedProfile[]; problems: string[] } {
  const byProfile = new Map<string, { root?: unknown; rootBroken?: boolean; pages: unknown[] }>();
  const problems: string[] = [];
  for (const file of manifests) {
    const parts = file.path.split('/');
    if (!/\.sdProfile$/i.test(parts[0] ?? '') || parts[parts.length - 1] !== 'manifest.json') {
      continue;
    }
    const uuid = parts[0]!.replace(/\.sdProfile$/i, '');
    const entry = byProfile.get(uuid) ?? { pages: [] };
    byProfile.set(uuid, entry);
    const json = parseJson(file.text);
    if (parts.length === 2) {
      if (json === undefined) entry.rootBroken = true;
      else entry.root = json;
    } else if (json === undefined) {
      problems.push(`A page of profile ${uuid} could not be read (${file.path}).`);
    } else {
      entry.pages.push(json);
    }
  }
  const profiles: ParsedProfile[] = [];
  for (const [uuid, entry] of byProfile) {
    const root = record(entry.root);
    if (!root) {
      problems.push(
        entry.rootBroken
          ? `Profile ${uuid} has a damaged manifest.json and was skipped.`
          : `Profile ${uuid} has no manifest.json and was skipped.`
      );
      continue;
    }
    const device = record(root['Device']);
    const deviceModel = text(device?.['Model']) ?? text(root['DeviceModel']);
    const ids = parseDeviceUuid(text(device?.['UUID']) ?? text(root['DeviceUUID']));
    const connected = ids
      ? devices.some((d) => (ids.serial ? d.serial === ids.serial : d.productId === ids.productId))
      : undefined;
    const deviceName =
      (ids && devices.find((d) => d.serial !== undefined && d.serial === ids.serial)?.name) ??
      (ids ? modelName(ids.productId) : undefined);
    const actionList = [...actionUuids(root), ...entry.pages.flatMap(actionUuids)];
    profiles.push({
      uuid,
      name: text(root['Name']) ?? 'Unnamed profile',
      ...(deviceModel ? { deviceModel } : {}),
      ...(deviceName ? { deviceName } : {}),
      ...(ids?.serial ? { deviceSerial: ids.serial } : {}),
      ...(connected !== undefined ? { deviceConnected: connected } : {}),
      pages: Math.max(entry.pages.length, actionUuids(root).length > 0 ? 1 : 0),
      actions: actionList.length,
      plugins: [],
      actionList,
    });
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name));
  return { profiles, problems };
}

/** Profiles, plugins and how many actions use each plugin. */
export function buildInventory(
  parsed: { profiles: ParsedProfile[]; problems: string[] },
  installed: InstalledPlugin[]
): Inventory {
  const plugins = new Map<string, PluginSummary>();
  for (const plugin of installed) {
    plugins.set(plugin.id, {
      id: plugin.id,
      name: plugin.name,
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.author ? { author: plugin.author } : {}),
      installed: true,
      builtIn: false,
      actions: 0,
      profiles: [],
    });
  }
  const profiles: ProfileSummary[] = [];
  let totalActions = 0;
  for (const profile of parsed.profiles) {
    const counts = new Map<string, number>();
    for (const uuid of profile.actionList) {
      const id = pluginForAction(uuid, installed);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      const known = KNOWN_PLUGINS[id];
      const plugin =
        plugins.get(id) ??
        ({
          id,
          name: known?.name ?? id,
          installed: id === BUILT_IN,
          builtIn: id === BUILT_IN,
          actions: 0,
          profiles: [],
        } satisfies PluginSummary);
      plugin.actions += count;
      plugin.profiles.push({ name: profile.name, actions: count });
      plugins.set(id, plugin);
    }
    totalActions += profile.actionList.length;
    const { actionList: _actions, ...summary } = profile;
    profiles.push({
      ...summary,
      plugins: [...counts]
        .map(([pluginId, actions]) => ({ pluginId, actions }))
        .sort((a, b) => b.actions - a.actions),
    });
  }
  for (const plugin of plugins.values()) {
    plugin.profiles.sort((a, b) => b.actions - a.actions);
    const source = KNOWN_PLUGINS[plugin.id]?.source;
    if (!plugin.builtIn) plugin.source = source ?? MARKETPLACE;
  }
  const order = (p: PluginSummary): number => (p.builtIn ? 2 : p.installed ? 1 : 0);
  return {
    profiles,
    plugins: [...plugins.values()].sort(
      (a, b) => order(a) - order(b) || b.actions - a.actions || a.name.localeCompare(b.name)
    ),
    totalActions,
    problems: parsed.problems,
  };
}

/** The manifest files of a profiles folder on disk. */
export async function readProfileManifests(
  files: FileStore,
  profilesDir: string
): Promise<Result<ManifestFile[]>> {
  const tree = await files.listTree(profilesDir, { include: ['manifest.json'] });
  if (!tree.ok) return tree;
  const manifests: ManifestFile[] = [];
  for (const entry of tree.value) {
    const content = await files.readText(entry.path);
    if (content.ok) manifests.push({ path: entry.relativePath, text: content.value });
  }
  return ok(manifests);
}

export async function readInventory(
  files: FileStore,
  dirs: { profilesDir: string; pluginsDir: string },
  devices: StreamDeckDevice[]
): Promise<Result<Inventory>> {
  const manifests = await readProfileManifests(files, dirs.profilesDir);
  if (!manifests.ok) return manifests;
  const installed = await readInstalledPlugins(files, dirs.pluginsDir);
  if (!installed.ok) return installed;
  return ok(buildInventory(readProfiles(manifests.value, devices), installed.value));
}
