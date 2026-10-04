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
import { GameKindSchema, RotationSchema } from '../../shared/models';

const ProfileRef = z.object({ profileId: z.string() });

/** A monitor as it is now, for the drawing of the rig. */
export const RigMonitorSchema = z.object({
  id: z.string(),
  /** The name the owner gave it, or its own, numbered when several share it. */
  label: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  /** Desktop size in pixels after rotation; 0 while it is off. */
  width: z.number().int(),
  height: z.number().int(),
  rotation: RotationSchema,
  enabled: z.boolean(),
  primary: z.boolean(),
  /** What is different from what the setup expects of it, in a few words. Absent: as expected. */
  issue: z.string().optional(),
});

/** The rig at a glance: the monitors as they are, compared with what the setup expects. */
export const RigGlanceSchema = z.object({
  monitors: z.array(RigMonitorSchema),
  /** Monitors the setup wants on that are not connected, by name. */
  missing: z.array(z.string()),
  /** The checklist item the arrangement belongs to: where choosing a monitor leads. Absent when the setup expects nothing of the monitors. */
  itemId: z.string().optional(),
  /** Why the monitors cannot be drawn. */
  error: z.string().optional(),
});
export type RigGlance = z.infer<typeof RigGlanceSchema>;

/**
 * Another setup the gear on the desk is for: every device it requires is connected, and
 * the setup on screen is missing some of its own. An offer, never a switch.
 */
export const SuggestionSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  /** The device that gives it away: required by that setup and not by the one on screen. */
  device: z.string(),
  /** How many devices the setup on screen requires that are not connected. */
  missing: z.number().int().min(1),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Game module id, or "other". */
  game: z.string().optional(),
  /** What to call the game: the module's name, or the custom name. */
  gameName: z.string().optional(),
  /** When it was last used on the Play screen (ISO). */
  lastUsed: z.string().optional(),
  canLaunch: z.boolean(),
  /** The family of sims its game belongs to, for the words a session is described in. */
  kind: GameKindSchema.optional(),
  /** The last session launched from RigReady with this setup. */
  lastSession: z
    .object({
      startedAt: z.string(),
      /** Absent when RigReady could not tell how long it was. */
      durationSeconds: z.number().int().optional(),
    })
    .optional(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

/** Something Make ready or a fix button put right before a launch. */
export const FixedSchema = z.object({
  title: z.string(),
  group: CheckGroupSchema,
  /** What the fix said it did ("Started TrackIR5.exe"). */
  message: z.string(),
});

/** One session: from the game running to the game closed. */
export const SessionRecordSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  profileName: z.string(),
  gameName: z.string().optional(),
  /** When the game was running (ISO). */
  startedAt: z.string(),
  /** Whole seconds the game ran. Absent when RigReady could not tell (it was closed, or cannot see this game). */
  durationSeconds: z.number().int().min(0).optional(),
  /** Seconds from opening the setup in RigReady until every required check was met. Absent when it was launched not ready. */
  readySeconds: z.number().int().min(0).optional(),
  /** What had to be fixed before the launch. */
  fixed: z.array(FixedSchema).default([]),
  /** The first required item that was not met when the setup was opened. */
  failedFirst: z.object({ title: z.string(), summary: z.string() }).optional(),
  /** Launched with something required not met. */
  notReady: z.boolean().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/** The session of the moment, as every window shows it. */
export const SessionStateSchema = z.object({
  /**
   * idle: none. starting: handed to Steam, the game has not shown up yet. running: the
   * game is running. ended: the game closed ("welcome back") and nothing was done about
   * it yet.
   */
  phase: z.enum(['idle', 'starting', 'running', 'ended']),
  profileId: z.string().optional(),
  profileName: z.string().optional(),
  gameName: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationSeconds: z.number().int().optional(),
  /** Stand down is running by itself right now (the user asked for that). */
  standingDown: z.boolean().optional(),
  /** Stand down ran by itself: what it did. */
  stoodDown: z.object({ headline: z.string(), failed: z.number().int() }).optional(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const HistorySchema = z.object({
  /** Newest first. */
  sessions: z.array(SessionRecordSchema),
  totals: z.object({
    sessions: z.number().int(),
    /** Seconds in the sessions whose length is known. */
    seconds: z.number().int(),
    /** What had to be fixed before launching, most often first. */
    fixes: z.array(
      z.object({ title: z.string(), group: CheckGroupSchema, count: z.number().int() })
    ),
    /** The usual time from opening RigReady to a ready rig (the median). */
    readySeconds: z.number().int().optional(),
    /** Sessions launched with something required not met. */
    notReady: z.number().int(),
  }),
  /** The totals in one line: "12 sessions, 14 h; TrackIR needed starting 6 times". */
  line: z.string(),
  /** One line when a history file could not be read. */
  notice: z.string().optional(),
});
export type History = z.infer<typeof HistorySchema>;

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
  /** When the game closes, run Stand down without being asked. */
  autoStandDown: z.boolean().default(false),
  /** Two quiet notes when the rig becomes ready. */
  readyTone: z.boolean().default(false),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/**
 * A change to the preferences: only what is named changes. (Not PreferencesSchema.partial():
 * its defaults would fill in what was left out and undo the other choices.)
 */
export const PreferencesPatchSchema = z.object({
  minimizeOnLaunch: z.boolean().optional(),
  autoStandDown: z.boolean().optional(),
  readyTone: z.boolean().optional(),
});
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

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
    /** What the Play screen needs to draw itself before any check has run. */
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
    setPreferences: channel(PreferencesPatchSchema, PreferencesSchema),
    /** Starts watching the profiles folder; `profilesChanged` fires within about 2 s of a change. */
    watch: channel(noInput, z.object({ watching: z.boolean() })),
    /** The monitors as they are now, each with what is different from what the setup expects. */
    rig: channel(ProfileRef, RigGlanceSchema),
    /** The session of the moment: none, a game running, or one that just closed. */
    session: channel(noInput, SessionStateSchema),
    /** "Welcome back" was read: back to normal without standing down. */
    dismissSession: channel(noInput, SessionStateSchema),
    /** Every recorded session, newest first, and what they add up to. */
    history: channel(noInput, HistorySchema),
    /**
     * A window of RigReady says whether somebody is at it: true when the user does
     * something in it, false when it is hidden. A window that says nothing for a minute
     * counts as left alone. With nobody at a window, "welcome back" is a Windows
     * notification.
     */
    presence: channel(
      z.object({ window: z.string().min(1).max(40), visible: z.boolean() }),
      z.object({ attended: z.boolean() })
    ),
    /**
     * Opens the compact view (the dial, the setup switcher and the one action) in a small
     * window that stays on top, or brings it forward when it is open.
     */
    openCompact: channel(noInput, z.object({ opened: z.boolean() })),
    /** Brings RigReady's main window forward, from the tray or from behind the game. */
    showMain: channel(noInput, z.object({ shown: z.boolean() })),
    /**
     * The setup the connected gear is for, when the one named is missing a device it
     * requires and another setup has all of its own. Null when there is nothing to offer.
     */
    suggestion: channel(ProfileRef, SuggestionSchema.nullable()),
  },
  {
    /** Another setup became the one in use (chosen in a window of RigReady or from the tray). */
    activeChanged: z.object({ profileId: z.string() }),
    /** The session changed: started, running, closed, stood down. */
    session: SessionStateSchema,
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
