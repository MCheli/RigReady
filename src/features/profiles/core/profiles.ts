import path from 'node:path';
import { z } from 'zod';
import type { MainContext } from '../../../core/feature';
import { allPathVariables, collapsePath, variableOf } from '../../../core/pathVariables';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { storedPathKey, trackedExtension, trackedSuggestions } from './capture';
import type {
  CheckTypeInfo,
  DetectedGame,
  NewProfile,
  Pickers,
  ProfileOverview,
  RemediationTypeInfo,
} from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'profiles' | 'checks' | 'games' | 'log' | 'backupSources'>;

/** Every string in a value, with where it is, for checking path variables. */
function strings(value: unknown, at: string, out: { at: string; text: string }[]): void {
  if (typeof value === 'string') out.push({ at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) strings(v, at ? `${at}.${key}` : key, out);
  }
}

/**
 * A profile may only use path variables RigReady knows. Game variables ({DCS_USER}) are
 * known whether or not the game is installed here; their absence is a check error later,
 * not a reason to refuse the profile.
 */
export async function unknownVariables(ctx: Ctx, profile: Profile): Promise<string[]> {
  const known = new Set(Object.keys(await allPathVariables(ctx, ctx.games)));
  for (const name of KNOWN_GAME_VARIABLES) known.add(name);
  const found: { at: string; text: string }[] = [];
  strings({ launch: profile.launch, checks: profile.checks, actions: profile.actions }, '', found);
  const unknown = new Set<string>();
  for (const { text } of found) {
    const variable = variableOf(text);
    if (variable && !known.has(variable)) unknown.add(variable);
  }
  return [...unknown].sort();
}

/** Game variables that exist on a PC where the game is installed. */
const KNOWN_GAME_VARIABLES = [
  'STEAM',
  'DCS_USER',
  'DCS_INSTALL',
  'IRACING_USER',
  'LMU_USER',
  'BEAMNG_USER',
  'MSFS_USER',
];

/** Field problems of every item and action whose type is registered, one line each. */
export function paramProblems(ctx: Pick<Ctx, 'checks'>, profile: Profile): string[] {
  const lines: string[] = [];
  const report = (where: string, schema: z.ZodType | undefined, params: unknown): void => {
    if (!schema) return;
    const parsed = schema.safeParse(params);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || 'params';
      lines.push(`${where}: ${field}: ${issue.message}`);
    }
  };
  for (const item of profile.checks) {
    report(`${item.id} "${item.title}"`, ctx.checks.check(item.type)?.params, item.params);
    if (item.remediation) {
      report(
        `${item.id} "${item.title}" fix`,
        ctx.checks.remediation(item.remediation.type)?.params,
        item.remediation.params
      );
    }
  }
  for (const action of [
    ...(profile.actions?.preLaunch ?? []),
    ...(profile.actions?.postLaunch ?? []),
    ...(profile.actions?.standDown ?? []),
  ]) {
    report(
      `${action.id} "${action.title}"`,
      ctx.checks.remediation(action.type)?.params,
      action.params
    );
  }
  return lines;
}

async function validate(ctx: Ctx, profile: Profile): Promise<Result<void>> {
  const ids = new Set(profile.checks.map((c) => c.id));
  if (ids.size !== profile.checks.length)
    return err('profile.invalid', 'Two checks have the same id.');
  const problems = paramProblems(ctx, profile);
  if (problems.length > 0) {
    return err(
      'profile.params',
      problems.length === 1 ? 'One field needs fixing.' : `${problems.length} fields need fixing.`,
      problems.join('\n')
    );
  }
  const unknown = await unknownVariables(ctx, profile);
  if (unknown.length > 0) {
    return err(
      'profile.variable',
      `Unknown path variable ${unknown.map((v) => `{${v}}`).join(', ')}.`,
      'Use one of the variables listed in the editor, or a full path.'
    );
  }
  return ok(undefined);
}

/** Creates a profile from checks chosen in the capture screen. */
export async function createProfile(ctx: Ctx, input: NewProfile): Promise<Result<Profile>> {
  // The capture screen offers the files to back up and the user ticks them: a path the
  // renderer sends that main did not offer is refused, never stored for a later backup to read.
  if (input.tracked && input.tracked.length > 0) {
    const offered = new Set((await trackedSuggestions(ctx)).map((s) => storedPathKey(s.path)));
    const stranger = input.tracked.find((item) => !offered.has(storedPathKey(item.path)));
    if (stranger) {
      return err(
        'path.outside',
        `${stranger.path} is not one of the files RigReady offered to back up for this setup.`,
        'Create the setup without it, then add it on the Backups page with Browse.'
      );
    }
  }
  const id = await ctx.profiles.uniqueId(input.name);
  const now = ctx.ports.clock.now().toISOString();
  const checks: CheckItem[] = [];
  for (const [index, proposed] of input.checks.entries()) {
    // The check type may finish its item first (save a captured layout under a name, ...).
    const adopt = ctx.checks.check(proposed.type)?.adopt;
    const adopted = adopt ? await adopt(proposed, ctx) : ok(proposed);
    if (!adopted.ok) return adopted;
    checks.push({ ...adopted.value, id: `c${index + 1}` });
  }
  const profile: Profile = {
    schemaVersion: 1,
    id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    checks,
    extensions: trackedExtension(input.tracked ?? []),
    ...(input.gameInstall ? { gameInstall: input.gameInstall } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.game ? { game: input.game } : {}),
    ...(input.gameName ? { gameName: input.gameName } : {}),
    ...(input.launch ? { launch: input.launch } : {}),
    ...(input.steamAppId ? { steamAppId: input.steamAppId } : {}),
    ...(input.actions ? { actions: input.actions } : {}),
  };
  const valid = await validate(ctx, profile);
  if (!valid.ok) return valid;
  const saved = await ctx.profiles.save(profile);
  if (!saved.ok) return saved;
  // A new setup is the one the Fly screen opens on.
  await ctx.profiles.setLastProfileId(saved.value.id, ctx.ports.clock.now());
  return saved;
}

/** Saves edits to an existing profile. The id and creation time cannot change. */
export async function updateProfile(ctx: Ctx, profile: Profile): Promise<Result<Profile>> {
  const existing = await ctx.profiles.get(profile.id);
  // A file broken by a hand edit can still be saved over from the editor.
  if (!existing.ok && existing.error.code === 'profile.missing') return existing;
  const valid = await validate(ctx, profile);
  if (!valid.ok) return valid;
  return ctx.profiles.save({
    ...profile,
    createdAt: existing.ok ? existing.value.createdAt : profile.createdAt,
    updatedAt: ctx.ports.clock.now().toISOString(),
  });
}

/** A deep copy under a new id. Nothing is shared with the original. */
export async function cloneProfile(ctx: Ctx, id: string): Promise<Result<Profile>> {
  const original = await ctx.profiles.get(id);
  if (!original.ok) return original;
  const name = `${original.value.name} (copy)`.slice(0, 80);
  const now = ctx.ports.clock.now().toISOString();
  const copy: Profile = {
    ...structuredClone(original.value),
    id: await ctx.profiles.uniqueId(name),
    name,
    createdAt: now,
    updatedAt: now,
  };
  return ctx.profiles.save(copy);
}

export async function overview(ctx: Ctx): Promise<Result<ProfileOverview>> {
  const listed = await ctx.profiles.listDetailed();
  if (!listed.ok) return listed;
  const lastUsed = await ctx.profiles.lastUsed();
  const last = await ctx.profiles.lastProfileId();
  return ok({
    profiles: listed.value.profiles.map(({ profile, file, hasComments }) => {
      const gameName =
        profile.game === 'other'
          ? profile.gameName
          : profile.game
            ? (ctx.games.get(profile.game)?.name ?? profile.game)
            : undefined;
      return {
        profile,
        file,
        hasComments,
        ...(lastUsed[profile.id] ? { lastUsed: lastUsed[profile.id] } : {}),
        ...(gameName ? { gameName } : {}),
      };
    }),
    invalid: listed.value.invalid,
    ...(last ? { lastProfileId: last } : {}),
  });
}

const toSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;

/** Every registered type with the JSON Schema of its params, for the generic editor form. */
export function describeTypes(ctx: Ctx): {
  checks: CheckTypeInfo[];
  remediations: RemediationTypeInfo[];
} {
  const checks = ctx.checks.checkTypes().map((type) => {
    const definition = ctx.checks.check(type)!;
    return {
      type,
      label: definition.label,
      group: definition.group,
      schema: toSchema(definition.params),
      ...(definition.fixes ? { fixes: definition.fixes } : {}),
      ...(definition.acknowledge ? { acknowledge: definition.acknowledge.label } : {}),
      advisory: definition.advisory === true,
    };
  });
  const remediations = ctx.checks.remediationTypes().map((type) => {
    const definition = ctx.checks.remediation(type)!;
    return {
      type,
      label: definition.label,
      kind: definition.kind ?? ('action' as const),
      order: definition.order,
      schema: toSchema(definition.params),
      ...(definition.prepare ? { prepare: definition.prepare.label } : {}),
      confirms: definition.confirm !== undefined,
    };
  });
  return { checks, remediations };
}

export async function pickers(ctx: Ctx): Promise<Result<Pickers>> {
  const devices = await ctx.ports.devices.list();
  const processes = await ctx.ports.processes.list();
  const services = await ctx.ports.services.list();
  const variables = await allPathVariables(ctx, ctx.games);
  const peripherals = devices.ok ? devices.value.filter((d) => !d.isHub) : [];
  const twins = (vendorId: string, productId: string): number =>
    peripherals.filter((d) => d.vendorId === vendorId && d.productId === productId).length;
  const seen = new Set<string>();
  return ok({
    devices: peripherals
      .map((d) => ({
        name: d.name,
        vendorId: d.vendorId,
        productId: d.productId,
        ...(d.serial ? { serial: d.serial } : {}),
        instanceId: d.instanceId,
        isGameController: d.isGameController,
        hasTwin: twins(d.vendorId, d.productId) > 1,
      }))
      .sort(
        (a, b) =>
          Number(b.isGameController) - Number(a.isGameController) || a.name.localeCompare(b.name)
      ),
    processes: (processes.ok ? processes.value : [])
      .filter((p) => p.path && !/^[a-z]:\\windows\\/i.test(p.path))
      .filter((p) =>
        seen.has(p.name.toLowerCase()) ? false : (seen.add(p.name.toLowerCase()), true)
      )
      .map((p) => ({ name: p.name, ...(p.path ? { path: p.path } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    services: (services.ok ? services.value : [])
      .map((s) => ({ name: s.name, displayName: s.displayName, state: s.state }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    variables: Object.entries(variables)
      .map(([name, value]) => ({ name, path: value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}

export async function detectedGames(ctx: Ctx): Promise<DetectedGame[]> {
  const games: DetectedGame[] = [];
  for (const module of ctx.games.all()) {
    try {
      const installs = await module.detect(ctx);
      games.push({
        id: module.id,
        name: module.name,
        installs: installs.ok
          ? installs.value.map((i) => ({
              installDir: i.installDir,
              source: i.source,
              ...(i.launch ? { launch: i.launch } : {}),
            }))
          : [],
      });
    } catch (e) {
      ctx.log.error(`detect ${module.id} threw`, e);
    }
  }
  return games;
}

export async function browse(
  ctx: Ctx,
  kind: 'file' | 'folder' | 'program',
  title?: string
): Promise<Result<{ path?: string }>> {
  const picked = await ctx.ports.dialogs.open({
    ...(title ? { title } : {}),
    ...(kind === 'folder' ? { directory: true } : {}),
    ...(kind === 'program'
      ? { filters: [{ name: 'Programs and scripts', extensions: ['exe', 'cmd', 'bat', 'ps1'] }] }
      : {}),
  });
  if (!picked.ok) return picked;
  const chosen = picked.value[0];
  if (!chosen) return ok({});
  // Stored with a variable where one applies, so the setup works under another account.
  return ok({ path: collapsePath(chosen, await allPathVariables(ctx, ctx.games)) });
}

export async function prepareFix(
  ctx: Ctx,
  type: string,
  params: Record<string, unknown>
): Promise<Result<{ message: string }>> {
  const definition = ctx.checks.remediation(type);
  if (!definition?.prepare) return err('fix.noPrepare', 'This fix has nothing to set up.');
  const parsed = definition.params.safeParse(params);
  if (!parsed.success) {
    return err('fix.invalid', 'Fill in the fix first.', z.prettifyError(parsed.error));
  }
  const done = await definition.prepare.run(parsed.data, ctx);
  return done.ok ? ok({ message: done.value }) : done;
}

/** Windows' own Explorer: opens a file with its default program, or shows it selected. */
function explorer(ctx: Pick<Ctx, 'ports'>): string {
  return path.join(ctx.ports.folders.windows(), 'explorer.exe');
}

export async function openProfileFile(
  ctx: Ctx,
  id: string,
  mode: 'open' | 'show'
): Promise<Result<{ opened: boolean }>> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return err('profile.id', `Invalid profile id: ${id}`);
  const file = ctx.profiles.fileFor(id);
  if (!(await ctx.ports.files.exists(file)))
    return err('profile.missing', `There is no profile "${id}".`);
  // An argument array: the path is never part of a command line.
  const started = await ctx.ports.shell.launch(
    explorer(ctx),
    mode === 'open' ? [file] : [`/select,${file}`]
  );
  return started.ok ? ok({ opened: true }) : started;
}
