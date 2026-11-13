import { z } from 'zod';
import { CaptureCandidateSchema } from '../../core/checks/engine';
import { GEAR_KINDS } from '../../core/gearKind';
import {
  CheckGroupSchema,
  CheckItemSchema,
  ProfileActionsSchema,
  ProfileSchema,
} from '../../core/profile/schema';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { GameKindSchema, LaunchTargetSchema } from '../../shared/models';
import { TrackedItemSchema } from '../../core/trackedSchema';

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
  /** The install folder this setup uses, for a game installed more than once. */
  gameInstall: z.string().max(400).optional(),
  /** Checks chosen from the capture; ids are assigned on creation. */
  checks: z.array(CheckItemSchema.omit({ id: true })),
  actions: ProfileActionsSchema.optional(),
  /** Files and folders the setup backs up; ids are assigned on creation. */
  tracked: z
    .array(TrackedItemSchema.omit({ id: true }))
    .max(100)
    .optional(),
});
export type NewProfile = z.infer<typeof NewProfileSchema>;

const ProfileId = z.object({ id: z.string() });

/** A JSON Schema (draft 2020-12) object, as produced by z.toJSONSchema. */
const JsonSchema = z.record(z.string(), z.unknown());

/** One thing a picker offers: the value that is saved and the name the person reads. */
export const PickerChoiceSchema = z.object({
  value: z.string(),
  label: z.string(),
  /** A second line: what kind of thing it is, and what tells two of the same name apart. */
  detail: z.string().optional(),
  /** Other params of the same item that this choice fills in. */
  fill: z.record(z.string(), z.unknown()).optional(),
  /** It is the one in use on this PC right now. */
  current: z.boolean().optional(),
});
export type PickerChoice = z.infer<typeof PickerChoiceSchema>;

/**
 * A param chosen by name from what exists on this PC (a saved monitor layout, a virtual
 * controller, a game), with the choices as they are right now. The form shows one list
 * for `param` and does not ask for the params in `fills`.
 */
export const PickerInfoSchema = z.object({
  /** Names the list; a check and a fix that pick from the same list are kept in step. */
  list: z.string(),
  param: z.string(),
  label: z.string(),
  fills: z.array(z.string()),
  /** Other params a fix that follows its check takes from the check as well. */
  shares: z.array(z.string()).optional(),
  /** Said when there is nothing to choose from. */
  empty: z.string(),
  /** Said when nothing is chosen although the filled params have values. */
  unpicked: z.string().optional(),
  choices: z.array(PickerChoiceSchema),
  /** Why the list could not be read, when it could not. */
  problem: z.string().optional(),
});
export type PickerInfo = z.infer<typeof PickerInfoSchema>;

export const CheckTypeInfoSchema = z.object({
  type: z.string(),
  label: z.string(),
  group: CheckGroupSchema,
  /** The params form is generated from this. */
  schema: JsonSchema,
  /** Params chosen from a list by name in place of a typed id. */
  pickers: z.array(PickerInfoSchema).optional(),
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
  /** Params chosen from a list by name in place of a typed id. */
  pickers: z.array(PickerInfoSchema).optional(),
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
  /** Setup files RigReady 1 left behind: not read, not broken, listed apart. */
  earlier: z.array(
    z.object({
      id: z.string(),
      file: z.string(),
      name: z.string().optional(),
      /** The setup made from it with "Bring it over", while that setup is there. */
      broughtOver: z.object({ id: z.string(), name: z.string() }).optional(),
    })
  ),
  lastProfileId: z.string().optional(),
});
export type ProfileOverview = z.infer<typeof ProfileOverviewSchema>;

/** A part of a RigReady 1 setup and what happens to it. */
const EarlierPartSchema = z.object({ title: z.string(), why: z.string() });

/**
 * What "Bring it over" would make of a setup file RigReady 1 left, worked out without
 * writing anything: the checks that become checks of this version, the parts that cannot
 * (with why), and what stops it now.
 */
export const EarlierPlanSchema = z.object({
  id: z.string(),
  /** The old file, which is only read. */
  file: z.string(),
  /** What RigReady 1 called the setup. */
  name: z.string(),
  /** What the new setup is called. */
  setupName: z.string(),
  gameName: z.string().optional(),
  /** What Launch starts, in words. */
  launch: z.string().optional(),
  checks: z.array(z.object({ title: z.string(), what: z.string(), required: z.boolean() })),
  /** Parts this version has nothing for: not brought over. */
  left: z.array(EarlierPartSchema),
  /** What stops it being brought over now, and what to do. */
  blocked: z.array(EarlierPartSchema),
  /** Said once beside the checks (the game, the launch, backups). */
  notes: z.array(z.string()),
  broughtOver: z.object({ id: z.string(), name: z.string() }).optional(),
  canBringOver: z.boolean(),
});
export type EarlierPlan = z.infer<typeof EarlierPlanSchema>;

export const DetectedGameSchema = z.object({
  id: z.string(),
  name: z.string(),
  installs: z.array(
    z.object({ installDir: z.string(), source: z.string(), launch: LaunchTargetSchema.optional() })
  ),
});
export type DetectedGame = z.infer<typeof DetectedGameSchema>;

/** What a game is played with (see core/gearKind): what a new setup for it starts from. */
export const PlayedWithSchema = z.object({
  /** The kinds of gear the game reads; absent when nothing is known, so nothing is ruled out. */
  gear: z.array(z.enum(GEAR_KINDS)).optional(),
  helpers: z.boolean(),
  microphone: z.boolean(),
  /** The game reads a gamepad and not sim gear. */
  gamepad: z.boolean(),
});

/** A game module and what was found of it on this PC, for the capture screen. */
export const CaptureGameSchema = DetectedGameSchema.extend({
  kind: GameKindSchema.optional(),
  uses: PlayedWithSchema.optional(),
  /** One of the game's programs is running right now. */
  running: z.boolean(),
});
export type CaptureGame = z.infer<typeof CaptureGameSchema>;

/** A file or folder a new setup could back up, found on this PC. */
export const CaptureTrackedSchema = TrackedItemSchema.omit({ id: true }).extend({
  key: z.string(),
  /** Who suggests it: "DCS World", "Stream Deck". */
  source: z.string(),
  /** The aircraft or car it belongs to (the id of a candidate's variant). */
  variant: z.string().optional(),
  description: z.string().optional(),
  /** Kept by default in a setup for its game. */
  selectedByDefault: z.boolean(),
});
export type CaptureTracked = z.infer<typeof CaptureTrackedSchema>;

/**
 * A step before launch that gives a game something it needs and the rig does not have by
 * itself: a virtual controller for a game that reads a gamepad. Offered by the capture
 * screen for such a game, with the picker's choices.
 */
export const CaptureStepSchema = z.object({
  need: z.enum(['gamepad']),
  /** The fix type the step runs. */
  type: z.string(),
  label: z.string(),
  picker: PickerInfoSchema,
  /**
   * Checks the step cannot work without (the driver a virtual controller needs), as they
   * go into the setup. Offered with the step while the step is kept.
   */
  checks: z.array(CaptureCandidateSchema.shape.check),
});
export type CaptureStep = z.infer<typeof CaptureStepSchema>;

export const CaptureResultSchema = z.object({
  candidates: z.array(CaptureCandidateSchema),
  problems: z.array(z.string()),
  games: z.array(CaptureGameSchema),
  tracked: z.array(CaptureTrackedSchema),
  /** Steps before launch a game may need (see CaptureStepSchema). */
  steps: z.array(CaptureStepSchema),
  /** What the rig itself says the setup is for, when it says so clearly. */
  suggested: z.object({
    game: z.string().optional(),
    kind: GameKindSchema.optional(),
    /** Why that game, in words the screen shows. */
    reason: z.string().optional(),
  }),
});
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

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
  /**
   * Every path variable a setup may use, for the Variables menu beside a path field: the
   * standard ones first, then each game's. `path` is what it resolves to on this PC, absent
   * when the game (or Steam) is not here; the variable is accepted all the same.
   */
  variables: z.array(
    z.object({ name: z.string(), label: z.string(), path: z.string().optional() })
  ),
});
export type Pickers = z.infer<typeof PickersSchema>;
export type PathVariableChoice = Pickers['variables'][number];

/** A setup's desktop shortcut: whether it is there and still does what it should. */
export const ShortcutStatusSchema = z.object({
  /** Where the shortcut is, or would be made: the Desktop folder and the name below. */
  file: z.string(),
  /** "<setup name> - RigReady.lnk", with the characters a file name cannot hold replaced. */
  name: z.string(),
  /**
   * none: not on the desktop. current: there, and it starts this RigReady for this setup.
   * outdated: there, but under the setup's earlier name, for another copy of RigReady, or
   * asking for the wrong thing. taken: another file has the name.
   */
  state: z.enum(['none', 'current', 'outdated', 'taken']),
  /** One line on what a double-click does, or on what is wrong with it. */
  detail: z.string(),
  /** True when the shortcut launches the game; false when it only makes the rig ready. */
  launches: z.boolean(),
});
export type ShortcutStatus = z.infer<typeof ShortcutStatusSchema>;

export const profilesContract = defineContract('profiles', {
  list: channel(noInput, z.array(ProfileSchema), {
    describe: 'Answers with every setup that loads, in full. Changes nothing.',
    tier: 'read',
  }),
  /** Every profile with its file, and the files that could not be loaded. */
  overview: channel(noInput, ProfileOverviewSchema, {
    describe:
      'Answers with every setup and the file it lives in, plus the setup files that could not be loaded and why. Changes nothing.',
    tier: 'read',
  }),
  get: channel(ProfileId, ProfileSchema, {
    describe:
      'Answers with one setup in full. id is a setup id from profiles:list or fly:state. Changes nothing.',
    tier: 'read',
  }),
  /** For the editor: the profile plus whether a save would drop hand-written comments. */
  edit: channel(
    ProfileId,
    z.object({ profile: ProfileSchema, file: z.string(), hasComments: z.boolean() }),
    {
      describe:
        'Answers with one setup as the editor loads it, its file, and whether saving would drop comments written by hand in the file. id comes from profiles:list. Changes nothing.',
      tier: 'read',
    }
  ),
  /** Replaces an existing profile. Paths with unknown variables are refused. */
  save: channel(ProfileSchema, ProfileSchema, {
    describe:
      'Replaces an existing setup with the one given and writes its file (backed up first). Paths with unknown variables are refused. Read it with profiles:edit first and warn the user when hasComments is true.',
    tier: 'change',
  }),
  /**
   * Removes the profile file and the setup's desktop shortcut, when it has one, as one
   * journaled action: both are backed up first and the Safety page puts both back together.
   */
  remove: channel(ProfileId, z.object({ removed: z.boolean(), shortcutRemoved: z.boolean() }), {
    describe:
      "Deletes a setup's file and its desktop shortcut, if it has one. Both are backed up first and can be put back together from the Safety page. id comes from profiles:list. Ask the user first.",
    tier: 'change',
  }),
  /** What "Bring it over" would make of a setup file RigReady 1 left. */
  earlierPlan: channel(ProfileId, EarlierPlanSchema, {
    describe:
      'Says what a setup file RigReady 1 left in the setups folder would become in this version: its checks, the parts that cannot be brought over and why, and whether it can be brought over now. id comes from the earlier list of profiles:overview. Changes nothing.',
    tier: 'read',
  }),
  /** Makes a new setup from a RigReady 1 file, as earlierPlan says; the old file stays. */
  bringOver: channel(ProfileId, ProfileSchema, {
    describe:
      'Makes a new setup from a setup file RigReady 1 left, exactly as profiles:earlierPlan says, and writes the new file. The old file is not changed. Show the plan to the user and ask first.',
    tier: 'change',
  }),
  /** Makes this the setup the Play screen shows. */
  use: channel(ProfileId, z.object({ used: z.boolean() }), {
    describe:
      "Makes a setup the one the Play screen shows. id comes from profiles:list. Only RigReady's own note of the setup in use changes.",
    tier: 'read',
  }),
  /** A deep copy under a new id, named "<name> (copy)". */
  clone: channel(ProfileId, ProfileSchema, {
    describe:
      'Copies a setup under a new id, named "<name> (copy)", and writes the new file. id comes from profiles:list.',
    tier: 'change',
  }),
  /** Looks at the machine as it is now and proposes checks. */
  capture: channel(noInput, CaptureResultSchema, {
    describe:
      'Looks at the PC as it is now (games, devices, programs, files worth backing up) and proposes checks for a new setup. Use it before profiles:create. Changes nothing.',
    tier: 'read',
  }),
  /** "Always offer this app": a candidate the capture lists in every new setup from now on, or not. */
  remember: channel(
    z.object({
      capture: z.string().min(1).max(64),
      key: z.string().min(1).max(300),
      on: z.boolean(),
    }),
    z.object({ candidate: CaptureCandidateSchema.optional() }),
    {
      describe:
        "Offers a running program RigReady does not know in every new setup from now on (on: true), or stops (on: false). capture and key come from a candidate of profiles:capture that has remember. Answers with the candidate as it is now. Changes RigReady's own list only.",
      tier: 'change',
    }
  ),
  create: channel(NewProfileSchema, ProfileSchema, {
    describe:
      'Creates a new setup from a name, game and launch target and writes its file. Use profiles:capture and profiles:games first to choose the game and what to check.',
    tier: 'change',
  }),
  /** Every registered check and fix type, with the schema its params form is built from. */
  types: channel(
    noInput,
    z.object({
      checks: z.array(CheckTypeInfoSchema),
      remediations: z.array(RemediationTypeInfoSchema),
    }),
    {
      describe:
        'Answers with every check and fix type a setup can use, each with the JSON Schema of its params. Use it before writing checklist items for profiles:save. Changes nothing.',
      tier: 'read',
    }
  ),
  /** What is connected and running now, for "pick from this PC" in the editor. */
  pickers: channel(noInput, PickersSchema, {
    describe:
      'Answers with the devices connected, programs running, services and path variables on this PC, to fill in checklist items. Changes nothing.',
    tier: 'read',
  }),
  /** Waits for a button press on any game controller and names the device ("press a button on it"). */
  waitForPress: channel(
    z.object({ timeoutSeconds: z.number().int().min(1).max(60).default(15) }),
    z.object({
      device: z
        .object({ name: z.string(), vendorId: z.string(), productId: z.string() })
        .optional(),
    }),
    {
      describe:
        'Waits up to timeoutSeconds for a button press on any game controller and names the device pressed. Ask the user to press a button on it first. Changes nothing.',
      tier: 'read',
    }
  ),
  /** Detected games and their installs, for the game choice and the launch target. */
  games: channel(noInput, z.array(DetectedGameSchema), {
    describe:
      "Answers with the games found on this PC and their installs, for choosing a setup's game and launch target. Changes nothing.",
    tier: 'read',
  }),
  /** A file or folder picker; the answer uses path variables where one applies. */
  browse: channel(
    z.object({ kind: z.enum(['file', 'folder', 'program']), title: z.string().optional() }),
    z.object({ path: z.string().optional() }),
    { describe: 'Opens a native file or folder picker.', tier: 'off' }
  ),
  /** The editor's helper action of a fix type (e.g. keep a copy of a file now). */
  prepareFix: channel(
    z.object({ type: z.string(), params: z.record(z.string(), z.unknown()) }),
    z.object({ message: z.string() }),
    {
      describe:
        'Runs the helper action of a fix type from the setup editor, such as keeping a copy of a file now. type comes from profiles:types and params follow its schema. Ask the user first.',
      tier: 'change',
    }
  ),
  /** Opens the profile's YAML file in the program Windows uses for it. */
  openFile: channel(ProfileId, z.object({ opened: z.boolean() }), {
    describe: "Opens a setup's YAML file in the program Windows uses for it.",
    tier: 'off',
  }),
  /** Opens Explorer with the profile's file selected. */
  showFile: channel(ProfileId, z.object({ opened: z.boolean() }), {
    describe: "Opens Explorer with a setup's file selected.",
    tier: 'off',
  }),
  /** The setup's desktop shortcut, as it is now. */
  shortcut: channel(ProfileId, ShortcutStatusSchema, {
    describe:
      "Says whether a setup's desktop shortcut is there and still starts this setup. id comes from profiles:list. Changes nothing.",
    tier: 'read',
  }),
  /** What making or removing the shortcut would do to the desktop, before anything is written. */
  shortcutPreview: channel(
    ProfileId.extend({ action: z.enum(['create', 'remove']) }),
    ChangePreviewSchema,
    {
      describe:
        "Shows what making or removing a setup's desktop shortcut would do, before anything is written. Show it to the user before profiles:createShortcut or profiles:removeShortcut. Changes nothing.",
      tier: 'read',
    }
  ),
  /** Writes the shortcut; answers only after reading it back and finding it starts this setup. */
  createShortcut: channel(ProfileId, ShortcutStatusSchema, {
    describe:
      "Writes a setup's desktop shortcut and checks it starts this setup. Call profiles:shortcutPreview with action create first and show the user.",
    tier: 'change',
  }),
  /** Removes the shortcut; answers only after finding it gone. */
  removeShortcut: channel(ProfileId, ShortcutStatusSchema, {
    describe:
      "Removes a setup's desktop shortcut and checks it is gone. Call profiles:shortcutPreview with action remove first and show the user.",
    tier: 'change',
  }),
});
