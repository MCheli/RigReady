import { z } from 'zod';
import {
  ActionReportSchema,
  CheckResultSchema,
  ChecklistReportSchema,
  CommandPreviewSchema,
  StepResultSchema,
} from '../../core/checks/engine';
import { CheckGroupSchema } from '../../core/profile/schema';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { GameKindSchema } from '../../shared/models';

const ProfileRef = z.object({ profileId: z.string() });

export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Game module id, or "other". */
  game: z.string().optional(),
  /** What to call the game: the module's name, or the custom name. */
  gameName: z.string().optional(),
  /** When it was last used on the Fly screen (ISO). */
  lastUsed: z.string().optional(),
  canLaunch: z.boolean(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const InvalidProfileSummarySchema = z.object({
  id: z.string(),
  file: z.string(),
  message: z.string(),
  detail: z.string().optional(),
});

/** One checklist item before it has been checked: enough to draw the list at once. */
export const SkeletonItemSchema = z.object({
  itemId: z.string(),
  type: z.string(),
  title: z.string(),
  group: CheckGroupSchema,
  required: z.boolean(),
  /** Switched off in the setup: listed, never checked, never counted. */
  disabled: z.boolean().optional(),
});
export type SkeletonItem = z.infer<typeof SkeletonItemSchema>;

export const ActionPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.enum(['preLaunch', 'postLaunch', 'standDown']),
  /** Set when the action runs a program the user must confirm first. */
  confirm: CommandPreviewSchema.optional(),
});

export const ProfileViewSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  items: z.array(SkeletonItemSchema),
  /** What Launch starts, for the button's tooltip. Absent when nothing can be launched. */
  launchLabel: z.string().optional(),
  actions: z.array(ActionPlanSchema),
  /**
   * Set when the file on disk is broken and the last version that loaded is shown
   * instead: the validation error, until the file is fixed.
   */
  problem: z.string().optional(),
});
export type ProfileView = z.infer<typeof ProfileViewSchema>;

export const FlyStateSchema = z.object({
  profiles: z.array(ProfileSummarySchema),
  /** Profile files that could not be loaded: shown disabled with the reason. */
  invalid: z.array(InvalidProfileSummarySchema),
  /** The profile to show: the last used one if it still loads, else the most recently changed. */
  activeProfileId: z.string().optional(),
  /** The active profile's checklist, unchecked, so the screen can draw before checks finish. */
  active: ProfileViewSchema.optional(),
  /** One line when the last used setup could not be opened. */
  notice: z.string().optional(),
});
export type FlyState = z.infer<typeof FlyStateSchema>;

export const LaunchStepSchema = StepResultSchema.extend({
  phase: z.enum(['preLaunch', 'launch', 'postLaunch']),
});
export type LaunchStep = z.infer<typeof LaunchStepSchema>;

export const LaunchResultSchema = z.object({
  /**
   * launched: the game is running. paused: a pre-launch action that must not fail did;
   * the user chooses Launch anyway or Cancel. failed: the game did not start.
   */
  outcome: z.enum(['launched', 'paused', 'failed']),
  message: z.string(),
  steps: z.array(LaunchStepSchema),
  /** For a pause: which pre-launch action failed (its index), to resume after it. */
  pausedAt: z.number().int().optional(),
  /** Post-launch actions still to run (they report through the launchProgress event). */
  postLaunchPending: z.number().int().default(0),
  /** The window should get out of the way (the user's preference). */
  minimize: z.boolean().default(false),
});
export type LaunchResult = z.infer<typeof LaunchResultSchema>;

export const PreferencesSchema = z.object({
  /** After a successful launch, hide RigReady to the tray. */
  minimizeOnLaunch: z.boolean().default(true),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

const ProgressStateSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);

/** What RigReady found on this PC, for the first-run screen. */
export const WelcomeSchema = z.object({
  games: z.array(z.object({ id: z.string(), name: z.string(), kind: GameKindSchema.optional() })),
  /** Names of the connected game controllers. */
  controllers: z.array(z.string()),
  monitors: z.object({ connected: z.number().int(), on: z.number().int() }),
});
export type Welcome = z.infer<typeof WelcomeSchema>;

export const flyContract = defineContract(
  'fly',
  {
    /** What the Fly screen needs to draw itself before any check has run. */
    state: channel(noInput, FlyStateSchema),
    /** First run: the games, controllers and monitors found on this PC. */
    welcome: channel(noInput, WelcomeSchema),
    /** One profile's checklist skeleton, for switching without waiting for checks. */
    view: channel(ProfileRef, ProfileViewSchema),
    /**
     * Runs the profile's checklist and remembers it as the last used profile. Results are
     * also sent one by one as `result` events tagged with runId while the run goes on.
     */
    check: channel(
      ProfileRef.extend({
        runId: z.string().optional(),
        /** Remember it as the setup in use. Off for background refreshes. */
        remember: z.boolean().default(true),
      }),
      ChecklistReportSchema
    ),
    /** Runs one item's check again. */
    checkItem: channel(ProfileRef.extend({ itemId: z.string() }), CheckResultSchema),
    /** Runs one item's fix, then its check: ok only when the check passes afterwards. */
    fix: channel(
      ProfileRef.extend({ itemId: z.string(), confirmed: z.boolean().default(false) }),
      z.object({ step: StepResultSchema, result: CheckResultSchema })
    ),
    /**
     * Every available fix in order, then a full re-check. Fixes that run a program run only
     * when their item id is in `approved`; the others are skipped by you.
     */
    makeReady: channel(
      ProfileRef.extend({
        runId: z.string().optional(),
        /** Absent (the tray): nobody can be asked, so such fixes are not run. */
        approved: z.array(z.string()).optional(),
      }),
      ActionReportSchema
    ),
    /** Whether the game this setup launches is running (Stand down asks before closing it). */
    gameStatus: channel(
      ProfileRef,
      z.object({ running: z.boolean(), name: z.string().optional() })
    ),
    standDown: channel(
      ProfileRef.extend({ closeGame: z.boolean().default(false) }),
      ActionReportSchema.extend({ headline: z.string() })
    ),
    /**
     * Pre-launch actions, the game, then post-launch actions in the background. Never
     * blocked by failing checks. `resumeAfter` continues after a paused action ("Launch anyway").
     */
    launch: channel(
      ProfileRef.extend({
        runId: z.string().optional(),
        resumeAfter: z.number().int().optional(),
        approved: z.array(z.string()).default([]),
      }),
      LaunchResultSchema
    ),
    /** The item's own confirm action ("Mark verified"); stores the new params, re-checks. */
    acknowledge: channel(ProfileRef.extend({ itemId: z.string() }), CheckResultSchema),
    preferences: channel(noInput, PreferencesSchema),
    setPreferences: channel(PreferencesSchema.partial(), PreferencesSchema),
    /** Starts watching the profiles folder; `profilesChanged` fires within about 2 s of a change. */
    watch: channel(noInput, z.object({ watching: z.boolean() })),
  },
  {
    result: z.object({ runId: z.string(), profileId: z.string(), result: CheckResultSchema }),
    progress: z.object({
      runId: z.string(),
      itemId: z.string(),
      title: z.string(),
      state: ProgressStateSchema,
      message: z.string().optional(),
    }),
    launchProgress: z.object({
      runId: z.string(),
      phase: z.enum(['preLaunch', 'launch', 'postLaunch']),
      id: z.string(),
      title: z.string(),
      state: ProgressStateSchema,
      message: z.string().optional(),
    }),
    profilesChanged: z.object({ ids: z.array(z.string()) }),
  }
);
