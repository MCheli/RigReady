import { z } from 'zod';
import { LaunchTargetSchema } from '../../shared/models';

/** Checklist groups, in the order Fly mode shows them. */
export const CHECK_GROUPS = ['devices', 'apps', 'displays', 'audio', 'files', 'other'] as const;
export const CheckGroupSchema = z.enum(CHECK_GROUPS);
export type CheckGroup = z.infer<typeof CheckGroupSchema>;

export const GROUP_TITLES: Record<CheckGroup, string> = {
  devices: 'Devices connected',
  apps: 'Apps running',
  displays: 'Monitors',
  audio: 'Audio',
  files: 'Config files',
  other: 'Other',
};

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
});
export type CheckItem = z.infer<typeof CheckItemSchema>;

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1).max(80),
  /** Game module id, when the profile belongs to a known game. */
  game: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  checks: z.array(CheckItemSchema).default([]),
  launch: LaunchTargetSchema.optional(),
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
