import { z } from 'zod';
import { LaunchTargetSchema } from '../../shared/models';

/** Checklist groups, in the order Fly mode shows them. */
export const CHECK_GROUPS = ['devices', 'apps', 'displays', 'audio', 'files', 'other'] as const;
export const CheckGroupSchema = z.enum(CHECK_GROUPS);
export type CheckGroup = z.infer<typeof CheckGroupSchema>;

export const GROUP_TITLES: Record<CheckGroup, string> = {
  devices: 'Devices connected',
  apps: 'Apps and services',
  displays: 'Monitors',
  audio: 'Audio',
  files: 'Config files',
  other: 'Other',
};

/** The profile format this version writes. Older files are migrated on load. */
export const PROFILE_SCHEMA_VERSION = 1;

export const RemediationRefSchema = z.object({
  /** A type registered with registerRemediation. */
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RemediationRef = z.infer<typeof RemediationRefSchema>;

export const CheckItemSchema = z.object({
  id: z.string().min(1),
  /** A type registered with registerCheck. */
  type: z.string().min(1),
  title: z.string().min(1),
  /** Required checks decide Ready. Optional ones only ever warn. */
  required: z.boolean().default(true),
  /** Validated against the check type's own schema when the check runs. */
  params: z.record(z.string(), z.unknown()).default({}),
  remediation: RemediationRefSchema.optional(),
  /** Overrides the check timeout from the settings for this item. */
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
  /**
   * Switched off: kept in the setup but not checked, not counted for readiness, not fixed
   * by Make ready and left alone by Stand down. Shown as "Off", never as passed.
   */
  disabled: z.boolean().optional(),
});
export type CheckItem = z.infer<typeof CheckItemSchema>;

/**
 * Something done around a launch or at Stand down: any registered remediation type
 * (start a program, run a script, apply a monitor layout, set an audio device).
 */
export const LaunchActionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  /** A type registered with registerRemediation. */
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  /** A failure is noted and the sequence goes on. When false, a failure asks "Launch anyway / Cancel". */
  continueOnError: z.boolean().default(true),
  /** Post-launch only: seconds to wait after the game is running. */
  delaySeconds: z.number().int().min(0).max(3600).default(0),
  /** Wait for the program to finish before the next action. Default: true for scripts, false for programs. */
  waitForCompletion: z.boolean().optional(),
  /** No console window. Default true. */
  hidden: z.boolean().optional(),
  /** How long to wait for the action. Default 30. */
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
  /** Start-program actions: close the program again at Stand down. Default true. */
  closeOnStandDown: z.boolean().optional(),
});
export type LaunchAction = z.infer<typeof LaunchActionSchema>;

export const ProfileActionsSchema = z.object({
  /** Run in order before the game starts. */
  preLaunch: z.array(LaunchActionSchema).default([]),
  /** Run in order once the game is running. */
  postLaunch: z.array(LaunchActionSchema).default([]),
  /** Run in order by Stand down, after the apps are closed. */
  standDown: z.array(LaunchActionSchema).default([]),
});
export type ProfileActions = z.infer<typeof ProfileActionsSchema>;

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(80),
  /** A line or two for the user's own notes. */
  description: z.string().max(2000).optional(),
  /** Game module id, when the profile belongs to a known game. "other" for a custom game. */
  game: z.string().optional(),
  /** For game "other": what the game is called. */
  gameName: z.string().max(80).optional(),
  /**
   * The install folder this setup uses, for a game installed more than once (DCS stable
   * and open beta). The game's path variables ({DCS_INSTALL}, {DCS_USER}) then mean this
   * install for everything the setup checks, fixes and launches. Absent: the first found.
   */
  gameInstall: z.string().max(400).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  checks: z.array(CheckItemSchema).default([]),
  /** The program Launch starts. Paths may use path variables ({DCS_INSTALL}/bin/DCS.exe). */
  launch: LaunchTargetSchema.optional(),
  /** Launch through Steam (steam://rungameid/<id>) instead of starting `launch` directly. */
  steamAppId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  /** Pre-launch, post-launch and stand-down actions. Optional so existing literals stay valid. */
  actions: ProfileActionsSchema.optional(),
  /**
   * Data a feature keeps with the profile, keyed by feature id (e.g. "backup", "dcs").
   * Each feature validates its own entry with profileExtension(); the profile schema
   * itself never needs to change for it.
   */
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * A feature's own data inside a profile, validated by the feature's schema. A missing
 * entry is parsed from {} so schema defaults apply; an invalid one gives undefined.
 */
export function profileExtension<S extends z.ZodType>(
  profile: Pick<Profile, 'extensions'>,
  featureId: string,
  schema: S
): z.output<S> | undefined {
  const parsed = schema.safeParse(profile.extensions[featureId] ?? {});
  return parsed.success ? parsed.data : undefined;
}

/** A copy of the profile with one feature's data replaced. */
export function withProfileExtension(profile: Profile, featureId: string, value: unknown): Profile {
  return { ...profile, extensions: { ...profile.extensions, [featureId]: value } };
}

/** The profile's actions, with empty lists where it has none. */
export function profileActions(profile: Pick<Profile, 'actions'>): ProfileActions {
  return ProfileActionsSchema.parse(profile.actions ?? {});
}

/**
 * Brings a profile read from disk up to the current format, one version at a time.
 * Version 1 is the first format; a file without a version is treated as version 1.
 * When the format changes, add a step here and keep a fixture of the old version.
 */
export function migrateProfile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = { ...(raw as Record<string, unknown>) };
  const version = record['schemaVersion'] ?? 1;
  if (typeof version === 'number' && version > PROFILE_SCHEMA_VERSION) {
    // Written by a newer RigReady: validation reports it rather than guessing.
    return record;
  }
  record['schemaVersion'] = PROFILE_SCHEMA_VERSION;
  return record;
}

/** Turns a display name into a profile id: "DCS F/A-18C" -> "dcs-f-a-18c". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'profile';
}
