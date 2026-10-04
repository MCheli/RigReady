import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import { JsonStore } from '../../../core/jsonStore';
import { allPathVariables, type PathVariables } from '../../../core/pathVariables';
import { profileExtension, slugify, withProfileExtension } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import {
  BACKUP_EXTENSION,
  BackupExtensionSchema,
  TrackedItemSchema,
  type TrackedItem,
} from '../../../core/tracked';

export type Ctx = Pick<
  MainContext,
  'ports' | 'log' | 'profiles' | 'settings' | 'layouts' | 'games' | 'backupSources'
>;

/** The scope id of the "Always back up" list. Not a valid profile id, so the two never clash. */
export const ALWAYS = '@always';

const GlobalSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  items: z.array(TrackedItemSchema).default([]),
});

const PrefsSchema = z.object({
  /** Keep this many backups made on this PC; older ones are deleted after a new backup. 0 keeps all. */
  keepBackups: z.number().int().min(0).max(500).default(20),
});
export type BackupPrefs = z.infer<typeof PrefsSchema>;

const IndexSchema = z.object({
  /** Backups added with "Open backup file": retention never deletes them. */
  imported: z.array(z.string()).default([]),
});

export function backupRoot(ctx: Pick<Ctx, 'ports'>): string {
  return path.join(ctx.ports.folders.dataRoot(), 'backups');
}

export const globalStore = (ctx: Pick<Ctx, 'ports'>) =>
  new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'backup', 'tracked.json'),
    GlobalSchema
  );

export const prefsStore = (ctx: Pick<Ctx, 'ports'>) =>
  new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'backup', 'prefs.json'),
    PrefsSchema
  );

export const indexStore = (ctx: Pick<Ctx, 'ports'>) =>
  new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'backup', 'index.json'),
    IndexSchema
  );

/** Who and where a backup was made, for the manifest. Tests may replace it. */
export interface MachineIdentity {
  machine: string;
  /** Windows user names that may appear in files. */
  users: string[];
}

export function machineIdentity(ctx: Pick<Ctx, 'ports'>): MachineIdentity {
  const users = new Set<string>();
  users.add(path.basename(ctx.ports.folders.home()));
  try {
    users.add(os.userInfo().username);
  } catch {
    // No user name available: the home folder's name still counts.
  }
  return {
    machine: ctx.ports.folders.machineName(),
    users: [...users].filter((u) => u.length >= 2),
  };
}

export function pathVariables(ctx: Ctx): Promise<PathVariables> {
  return allPathVariables(ctx, ctx.games);
}

export async function itemsOf(ctx: Ctx, scope: string): Promise<Result<TrackedItem[]>> {
  if (scope === ALWAYS) {
    const global = await globalStore(ctx).read();
    return global.ok ? ok(global.value.items) : global;
  }
  const profile = await ctx.profiles.get(scope);
  if (!profile.ok) return profile;
  const extension = profileExtension(profile.value, BACKUP_EXTENSION, BackupExtensionSchema);
  if (!extension) {
    return err('backup.profileData', `The backup list of "${profile.value.name}" is not valid.`);
  }
  return ok(extension.items);
}

export async function setItemsOf(
  ctx: Ctx,
  scope: string,
  items: TrackedItem[]
): Promise<Result<void>> {
  if (scope === ALWAYS) {
    const written = await globalStore(ctx).update((current) => ({ ...current, items }));
    return written.ok ? ok(undefined) : written;
  }
  const profile = await ctx.profiles.get(scope);
  if (!profile.ok) return profile;
  const current = profile.value.extensions[BACKUP_EXTENSION];
  const base = typeof current === 'object' && current !== null ? current : {};
  const saved = await ctx.profiles.save(
    withProfileExtension(profile.value, BACKUP_EXTENSION, { ...base, items })
  );
  return saved.ok ? ok(undefined) : saved;
}

export interface ScopeInfo {
  id: string;
  name: string;
  game?: string;
  items: TrackedItem[];
}

/** "Always back up" first, then every setup by name. */
export async function allScopes(ctx: Ctx): Promise<Result<ScopeInfo[]>> {
  const global = await itemsOf(ctx, ALWAYS);
  if (!global.ok) return global;
  const profiles = await ctx.profiles.list();
  if (!profiles.ok) return profiles;
  const scopes: ScopeInfo[] = [{ id: ALWAYS, name: 'Always back up', items: global.value }];
  for (const profile of profiles.value) {
    const extension = profileExtension(profile, BACKUP_EXTENSION, BackupExtensionSchema);
    scopes.push({
      id: profile.id,
      name: profile.name,
      ...(profile.game ? { game: profile.game } : {}),
      items: extension?.items ?? [],
    });
  }
  return ok(scopes);
}

/** An item id from the label that the scope does not use yet. */
export function newItemId(label: string, taken: TrackedItem[]): string {
  const base = slugify(label);
  let id = base;
  for (let n = 2; taken.some((i) => i.id === id); n++) id = `${base.slice(0, 60)}-${n}`;
  return id;
}

/** The items to back up for one setup: its own, then the "Always back up" list. */
export async function itemsForProfile(
  ctx: Ctx,
  profileId: string
): Promise<Result<{ source: string; item: TrackedItem }[]>> {
  const own = await itemsOf(ctx, profileId);
  if (!own.ok) return own;
  const global = await itemsOf(ctx, ALWAYS);
  if (!global.ok) return global;
  return ok([
    ...own.value.map((item) => ({ source: profileId, item })),
    ...global.value.map((item) => ({ source: ALWAYS, item })),
  ]);
}
