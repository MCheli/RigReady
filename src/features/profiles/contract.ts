import { z } from 'zod';
import { CaptureCandidateSchema } from '../../core/checks/engine';
import {
  CheckGroupSchema,
  CheckItemSchema,
  ProfileActionsSchema,
  ProfileSchema,
} from '../../core/profile/schema';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { LaunchTargetSchema } from '../../shared/models';

export const NewProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  game: z.string().optional(),
  gameName: z.string().max(80).optional(),
  launch: LaunchTargetSchema.optional(),
  steamAppId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  /** Checks chosen from the capture; ids are assigned on creation. */
  checks: z.array(CheckItemSchema.omit({ id: true })),
  actions: ProfileActionsSchema.optional(),
});
export type NewProfile = z.infer<typeof NewProfileSchema>;

const ProfileId = z.object({ id: z.string() });

/** A JSON Schema (draft 2020-12) object, as produced by z.toJSONSchema. */
const JsonSchema = z.record(z.string(), z.unknown());

export const CheckTypeInfoSchema = z.object({
  type: z.string(),
  label: z.string(),
  group: CheckGroupSchema,
  /** The params form is generated from this. */
  schema: JsonSchema,
  /** Remediation types that suit it; absent means any. */
  fixes: z.array(z.string()).optional(),
  /** Label of its acknowledge action, when it has one. */
  acknowledge: z.string().optional(),
  advisory: z.boolean(),
});
export type CheckTypeInfo = z.infer<typeof CheckTypeInfoSchema>;

export const RemediationTypeInfoSchema = z.object({
  type: z.string(),
  label: z.string(),
  kind: z.enum(['action', 'instructions', 'navigate']),
  order: z.number(),
  schema: JsonSchema,
  /** Label of the editor's helper action ("Keep a copy of the file as it is now"). */
  prepare: z.string().optional(),
  /** Runs a program the user confirms first, when its params say so. */
  confirms: z.boolean(),
});
export type RemediationTypeInfo = z.infer<typeof RemediationTypeInfoSchema>;

export const ProfileOverviewSchema = z.object({
  profiles: z.array(
    z.object({
      profile: ProfileSchema,
      file: z.string(),
      hasComments: z.boolean(),
      lastUsed: z.string().optional(),
      gameName: z.string().optional(),
    })
  ),
  invalid: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      message: z.string(),
      detail: z.string().optional(),
      line: z.number().int().optional(),
    })
  ),
  lastProfileId: z.string().optional(),
});
export type ProfileOverview = z.infer<typeof ProfileOverviewSchema>;

export const DetectedGameSchema = z.object({
  id: z.string(),
  name: z.string(),
  installs: z.array(
    z.object({ installDir: z.string(), source: z.string(), launch: LaunchTargetSchema.optional() })
  ),
});
export type DetectedGame = z.infer<typeof DetectedGameSchema>;

export const PickersSchema = z.object({
  devices: z.array(
    z.object({
      name: z.string(),
      vendorId: z.string(),
      productId: z.string(),
      serial: z.string().optional(),
      instanceId: z.string(),
      isGameController: z.boolean(),
      /** Another connected device has the same VID/PID. */
      hasTwin: z.boolean(),
    })
  ),
  processes: z.array(z.object({ name: z.string(), path: z.string().optional() })),
  services: z.array(z.object({ name: z.string(), displayName: z.string(), state: z.string() })),
  variables: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type Pickers = z.infer<typeof PickersSchema>;

export const profilesContract = defineContract('profiles', {
  list: channel(noInput, z.array(ProfileSchema)),
  /** Every profile with its file, and the files that could not be loaded. */
  overview: channel(noInput, ProfileOverviewSchema),
  get: channel(ProfileId, ProfileSchema),
  /** For the editor: the profile plus whether a save would drop hand-written comments. */
  edit: channel(
    ProfileId,
    z.object({ profile: ProfileSchema, file: z.string(), hasComments: z.boolean() })
  ),
  /** Replaces an existing profile. Paths with unknown variables are refused. */
  save: channel(ProfileSchema, ProfileSchema),
  /** Removes the profile file; it is backed up first and can be put back from Safety. */
  remove: channel(ProfileId, z.object({ removed: z.boolean() })),
  /** Makes this the setup the Fly screen shows. */
  use: channel(ProfileId, z.object({ used: z.boolean() })),
  /** A deep copy under a new id, named "<name> (copy)". */
  clone: channel(ProfileId, ProfileSchema),
  /** Looks at the machine as it is now and proposes checks. */
  capture: channel(
    noInput,
    z.object({ candidates: z.array(CaptureCandidateSchema), problems: z.array(z.string()) })
  ),
  create: channel(NewProfileSchema, ProfileSchema),
  /** Every registered check and fix type, with the schema its params form is built from. */
  types: channel(
    noInput,
    z.object({
      checks: z.array(CheckTypeInfoSchema),
      remediations: z.array(RemediationTypeInfoSchema),
    })
  ),
  /** What is connected and running now, for "pick from this PC" in the editor. */
  pickers: channel(noInput, PickersSchema),
  /** Waits for a button press on any game controller and names the device ("press a button on it"). */
  waitForPress: channel(
    z.object({ timeoutSeconds: z.number().int().min(1).max(60).default(15) }),
    z.object({
      device: z
        .object({ name: z.string(), vendorId: z.string(), productId: z.string() })
        .optional(),
    })
  ),
  /** Detected games and their installs, for the game choice and the launch target. */
  games: channel(noInput, z.array(DetectedGameSchema)),
  /** A file or folder picker; the answer uses path variables where one applies. */
  browse: channel(
    z.object({ kind: z.enum(['file', 'folder', 'program']), title: z.string().optional() }),
    z.object({ path: z.string().optional() })
  ),
  /** The editor's helper action of a fix type (e.g. keep a copy of a file now). */
  prepareFix: channel(
    z.object({ type: z.string(), params: z.record(z.string(), z.unknown()) }),
    z.object({ message: z.string() })
  ),
  /** Opens the profile's YAML file in the program Windows uses for it. */
  openFile: channel(ProfileId, z.object({ opened: z.boolean() })),
  /** Opens Explorer with the profile's file selected. */
  showFile: channel(ProfileId, z.object({ opened: z.boolean() })),
});
