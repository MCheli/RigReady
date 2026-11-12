import { z } from 'zod';
import type { McpToolDefinition } from '../../../core/mcp';
import type { Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { Envelope } from '../../../shared/ipc';

/**
 * Two reading tools that answer narrowly what the channel tools answer whole: one setup in a
 * line per item (instead of every setup with every param), and the check and fix types in a
 * line each, with the params of the ones asked for (instead of the JSON Schema of all of
 * them). An assistant pays for every character a tool answers, again with each later request,
 * so the short answer comes first and the detail only when it is asked for.
 */

const unwrap = <T>(envelope: Envelope): Result<T> =>
  envelope.ok ? ok(envelope.value as T) : envelope;

const JsonObject = z.record(z.string(), z.unknown());

/**
 * What an item is about: the program, file or name in its params, or nothing when they name
 * none (a device check has ids there, and its title already says which device).
 */
function about(params: Record<string, unknown>): string | undefined {
  for (const key of ['exe', 'path', 'name', 'service', 'device', 'layout']) {
    const value = params[key];
    if (typeof value === 'string' && value) {
      const args = Array.isArray(params['args']) ? (params['args'] as unknown[]).join(' ') : '';
      return args ? `${value} ${args}` : value;
    }
  }
  return undefined;
}

/** The text a line shows for its params: what they are about, or their start as they are. */
export function detailOf(params: Record<string, unknown>): string {
  return about(params) ?? JSON.stringify(params).slice(0, 160);
}

// ---- which setup ------------------------------------------------------------

export interface SetupLine {
  id: string;
  name: string;
}

/** Letters and digits only, so "FA-18C", "f/a 18c" and "F/A-18C" are the same words. */
const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

const listed = (setups: SetupLine[]): string =>
  setups.map((s) => `${s.name} (${s.id})`).join(', ') || 'none';

/**
 * The setup an assistant means: by id, by its whole name, or by a part of the name when only
 * one setup has it. More than one that fits is an error that names them, never a guess.
 */
export function matchSetup(asked: string, setups: SetupLine[]): Result<SetupLine> {
  const wanted = asked.trim().toLowerCase();
  const exact = setups.find((s) => s.id === wanted || s.name.trim().toLowerCase() === wanted);
  if (exact) return ok(exact);
  const words = plain(asked);
  const fits =
    words.length < 2
      ? []
      : setups.filter((s) => {
          const name = plain(s.name);
          const id = plain(s.id);
          return name.includes(words) || id.includes(words) || words.includes(name);
        });
  if (fits.length === 1) return ok(fits[0]!);
  if (fits.length > 1) {
    return err(
      'ai.setup',
      `More than one setup fits "${asked}".`,
      `They are: ${listed(fits)}. Ask again with one id.`
    );
  }
  return err('ai.setup', `There is no setup "${asked}".`, `Setups: ${listed(setups)}.`);
}

// ---- setup_read ------------------------------------------------------------

export const ReadSetupInputSchema = z.object({
  setup: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('The setup, by id or name. A part of the name is enough when only one setup has it.'),
  params: z
    .boolean()
    .default(false)
    .describe(
      "True to get every item's params in full as well. Leave it out unless you need a value the short form does not show."
    ),
});

const PHASES = ['preLaunch', 'postLaunch', 'standDown'] as const;

export const SetupReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  game: z.string().optional(),
  description: z.string().optional(),
  /** What Launch starts: the program and its arguments, or the Steam app. */
  launches: z.string().optional(),
  /** What must be so before the game starts, in the order of the setup. */
  checks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      /** Required checks decide Ready; the others only warn. */
      required: z.boolean(),
      /** Switched off in the setup: kept, never checked. */
      off: z.boolean().optional(),
      /** What it is about: the program, file, device or name in its params. */
      about: z.string().optional(),
      /** What Make ready does when it fails: the fix type and what it is about. */
      fix: z.string().optional(),
      params: JsonObject.optional(),
      fixParams: JsonObject.optional(),
    })
  ),
  /** What runs before launch, after launch and at Stand down. */
  steps: z.array(
    z.object({
      phase: z.enum(PHASES),
      id: z.string(),
      title: z.string(),
      type: z.string(),
      about: z.string().optional(),
      params: JsonObject.optional(),
    })
  ),
});

export type SetupRead = z.infer<typeof SetupReadSchema>;

/** One setup as an assistant reads it: a line per check and step, the params only when asked. */
export function setupRead(profile: Profile, withParams: boolean): SetupRead {
  const game = profile.gameName ?? profile.game;
  const launches = profile.launch
    ? [profile.launch.exe, ...profile.launch.args].join(' ')
    : profile.steamAppId
      ? `Steam app ${profile.steamAppId}`
      : undefined;
  return {
    id: profile.id,
    name: profile.name,
    ...(game ? { game } : {}),
    ...(profile.description ? { description: profile.description } : {}),
    ...(launches ? { launches } : {}),
    checks: profile.checks.map((check) => {
      const what = about(check.params);
      const fix = check.remediation;
      const fixAbout = fix ? about(fix.params) : undefined;
      return {
        id: check.id,
        title: check.title,
        type: check.type,
        required: check.required,
        ...(check.disabled ? { off: true } : {}),
        ...(what ? { about: what } : {}),
        ...(fix ? { fix: fixAbout ? `${fix.type}: ${fixAbout}` : fix.type } : {}),
        ...(withParams ? { params: check.params } : {}),
        ...(withParams && fix ? { fixParams: fix.params } : {}),
      };
    }),
    steps: PHASES.flatMap((phase) =>
      (profile.actions?.[phase] ?? []).map((step) => {
        const what = about(step.params);
        return {
          phase,
          id: step.id,
          title: step.title,
          type: step.type,
          ...(what ? { about: what } : {}),
          ...(withParams ? { params: step.params } : {}),
        };
      })
    ),
  };
}

// ---- setup_types ------------------------------------------------------------

export const SetupTypesInputSchema = z.object({
  types: z
    .array(z.string().trim().min(1).max(60))
    .max(8)
    .optional()
    .describe(
      'Check or fix types to get the params of ("process.running", "process.launch"). Left out: every type in a line each, without params.'
    ),
});

export const SetupTypesSchema = z.object({
  /** What a setup can check. */
  checks: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      group: z.string(),
      /** The fix types that suit it; absent means any. */
      fixes: z.array(z.string()).optional(),
      /** Only ever a note; never decides Ready. */
      advisory: z.boolean().optional(),
      /** JSON Schema of its params, when the type was asked for. */
      params: JsonObject.optional(),
    })
  ),
  /** What Make ready or a launch step can do. */
  fixes: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      kind: z.string(),
      /** Runs a program the user confirms first. */
      confirms: z.boolean().optional(),
      params: JsonObject.optional(),
    })
  ),
  /** Types asked for that do not exist. */
  notFound: z.array(z.string()).optional(),
});

export type SetupTypes = z.infer<typeof SetupTypesSchema>;

/** The part of profiles:types this reads. */
export interface KnownTypes {
  checks: {
    type: string;
    label: string;
    group: string;
    schema: Record<string, unknown>;
    fixes?: string[] | undefined;
    advisory?: boolean | undefined;
  }[];
  remediations: {
    type: string;
    label: string;
    kind: string;
    schema: Record<string, unknown>;
    confirms?: boolean | undefined;
  }[];
}

/** Every type in a line each, or the ones asked for with the JSON Schema of their params. */
export function setupTypes(known: KnownTypes, asked: string[] | undefined): Result<SetupTypes> {
  const wanted = asked && asked.length > 0 ? new Set(asked) : undefined;
  const detail = wanted !== undefined;
  const checks = known.checks
    .filter((c) => !wanted || wanted.has(c.type))
    .map((c) => ({
      type: c.type,
      label: c.label,
      group: c.group,
      ...(c.fixes ? { fixes: c.fixes } : {}),
      ...(c.advisory ? { advisory: true } : {}),
      ...(detail ? { params: c.schema } : {}),
    }));
  const fixes = known.remediations
    .filter((r) => !wanted || wanted.has(r.type))
    .map((r) => ({
      type: r.type,
      label: r.label,
      kind: r.kind,
      ...(r.confirms ? { confirms: true } : {}),
      ...(detail ? { params: r.schema } : {}),
    }));
  if (!wanted) return ok({ checks, fixes });
  const found = new Set([...checks.map((c) => c.type), ...fixes.map((f) => f.type)]);
  const notFound = [...wanted].filter((type) => !found.has(type));
  if (found.size === 0) {
    return err(
      'ai.type',
      `There is no check or fix type ${notFound.map((t) => `"${t}"`).join(', ')}.`,
      `Check types: ${known.checks.map((c) => c.type).join(', ')}. Fix types: ${known.remediations.map((r) => r.type).join(', ')}.`
    );
  }
  return ok({ checks, fixes, ...(notFound.length > 0 ? { notFound } : {}) });
}

// ---- the tools ------------------------------------------------------------

export function setupTools(): McpToolDefinition[] {
  const read: McpToolDefinition<typeof ReadSetupInputSchema, typeof SetupReadSchema> = {
    name: 'setup_read',
    title: 'Read one setup',
    description:
      "Answers with one setup, by id or name (a part of the name is enough): what Launch starts, every check with its type, whether it is required, what it is about (the program, file or device) and its fix, and the steps before launch, after launch and at Stand down. Short: a line per item. Use it to answer what a setup checks or starts, and before proposing a change to it. params: true adds every item's params in full. Changes nothing.",
    input: ReadSetupInputSchema,
    output: SetupReadSchema,
    tier: 'read',
    summarize: (input) => `Read the setup ${input.setup}`,
    run: async (input, ctx) => {
      const state = unwrap<{ profiles: SetupLine[] }>(await ctx.invoke('fly:state'));
      if (!state.ok) return state;
      const setup = matchSetup(input.setup, state.value.profiles);
      if (!setup.ok) return setup;
      const profile = unwrap<Profile>(await ctx.invoke('profiles:get', { id: setup.value.id }));
      if (!profile.ok) return profile;
      return ok(setupRead(profile.value, input.params));
    },
  };
  const types: McpToolDefinition<typeof SetupTypesInputSchema, typeof SetupTypesSchema> = {
    name: 'setup_types',
    title: 'List check and fix types',
    description:
      'Answers with what a setup can check and what a fix or launch step can do. Without types: every check type and fix type in a line each (type, label, group or kind). With types (up to 8): those types with the JSON Schema of their params, to write a check or step for setup_propose. Ask for the list first, then for the types you will use. Changes nothing.',
    input: SetupTypesInputSchema,
    output: SetupTypesSchema,
    tier: 'read',
    summarize: (input) =>
      input.types && input.types.length > 0
        ? `Look up ${input.types.join(', ')}`
        : 'List the check and fix types',
    run: async (input, ctx) => {
      const known = unwrap<KnownTypes>(await ctx.invoke('profiles:types'));
      if (!known.ok) return known;
      return setupTypes(known.value, input.types);
    },
  };
  return [read, types] as unknown as McpToolDefinition[];
}
