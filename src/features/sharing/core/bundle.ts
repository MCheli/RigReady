import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import { allPathVariables } from '../../../core/pathVariables';
import { CompatibilitySchema } from './compat';
import type { PrivacyContext } from './privacy';

export type Ctx = Pick<
  MainContext,
  'ports' | 'log' | 'profiles' | 'settings' | 'layouts' | 'games' | 'checks'
>;

export const BUNDLE_EXTENSION = 'rigready';
export const BUNDLE_FILTER = [{ name: 'RigReady shared setup', extensions: [BUNDLE_EXTENSION] }];

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const StrippedSchema = z.object({
  kind: z.enum(['launch', 'check', 'fix', 'action']),
  name: z.string().max(300),
  description: z.string().max(500),
});

export const BundleFileGroupSchema = z.object({
  label: z.string().min(1).max(120),
  /** Stored path with a path variable: "{DCS_USER}/Config/Input". */
  path: z.string().min(1).max(1024),
  kind: z.enum(['file', 'folder']),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        size: z.number().int().min(0),
        sha256: Sha,
        /** Path tokens (%RIGREADY:NAME:bs%) inside, expanded on import. */
        tokens: z.boolean().default(false),
      })
    )
    .max(5000),
});

/** manifest.json of a .rigready file. Everything else in the archive must be listed here. */
export const BundleManifestSchema = z.object({
  format: z.literal('rigready-setup'),
  schemaVersion: z.literal(1),
  appVersion: z.string().max(50),
  createdAt: z.string().max(40),
  name: z.string().min(1).max(80),
  game: z.string().max(64).optional(),
  notes: z.string().max(10_000).default(''),
  compatibility: CompatibilitySchema,
  /** Removed before sharing: what the setup wanted to run. */
  stripped: z.array(StrippedSchema).max(500).default([]),
  /** Files left out: programs, scripts and credentials. */
  excluded: z
    .array(z.object({ path: z.string().max(1024), reason: z.string().max(300) }))
    .max(5000)
    .default([]),
  profile: z.object({ sha256: Sha }),
  layout: z.object({ sha256: Sha }).optional(),
  groups: z.array(BundleFileGroupSchema).max(100).default([]),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

export async function privacyContext(
  ctx: Ctx,
  extraSerials: string[] = []
): Promise<PrivacyContext> {
  const variables = await allPathVariables(ctx, ctx.games);
  const users = new Set<string>([path.basename(ctx.ports.folders.home())]);
  try {
    users.add(os.userInfo().username);
  } catch {
    // No user name: the home folder's name still counts.
  }
  const devices = await ctx.ports.devices.list();
  const serials = devices.ok
    ? devices.value.map((d) => d.serial).filter((s): s is string => !!s)
    : [];
  return {
    variables,
    users: [...users],
    machine: ctx.ports.folders.machineName(),
    serials: [...serials, ...extraSerials],
  };
}

/** Folders an import may write to: Documents, Saved Games and every game's own config folder. */
export async function importRoots(ctx: Ctx): Promise<string[]> {
  const roots = [ctx.ports.folders.documents(), ctx.ports.folders.savedGames()];
  for (const module of ctx.games.all()) {
    try {
      const locations = await module.configLocations(ctx);
      if (locations.ok) roots.push(...locations.value.map((l) => l.path));
    } catch (e) {
      ctx.log.error(`config locations of ${module.id} threw`, e);
    }
  }
  return roots;
}
