import { z } from 'zod';
import {
  ActionReportSchema,
  CheckResultSchema,
  ChecklistReportSchema,
  CommandPreviewSchema,
  StepResultSchema,
} from '../../core/checks/engine';
import { DEVICE_KINDS } from '../../core/gearKind';
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
  /**
   * The kind of gear the user said a device of the setup is (on the Devices page), by
   * checklist item id. Only what was said: the picture of any other device is told from
   * its name.
   */
  kinds: z.record(z.string(), z.enum(DEVICE_KINDS)).optional(),
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
  /** The kind of gear the user said that device is, when they said. Else its name tells. */
  kind: z.enum(DEVICE_KINDS).optional(),
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
  /**
   * The countdown: Stand down runs by itself at this time (ISO) unless it is cancelled,
   * because the setup says so. Absent when nothing is counting down.
   */
  standDownAt: z.string().optional(),
  /** How long that countdown is in all, in seconds (what the setup says). */
  standDownSeconds: z.number().int().optional(),
  /**
   * Why Stand down is not going to run by itself this time, although the setup asks for
   * it: "cancelled" (the user cancelled the countdown) or "quickExit" (the game closed so
   * soon after it started that it may not have been a session at all).
   */
  standDownHeld: z.enum(['cancelled', 'quickExit']).optional(),
  /** Stand down is running by itself right now (the countdown is over). */
  standingDown: z.boolean().optional(),
  /**
   * Stand down ran by itself: what it did. "failed" counts the steps that did not work
   * and "problems" says which, each in its own words. A Stand down that could not run at
   * all says so in the headline and counts as one failure.
   */
  stoodDown: z
    .object({
      /** False when Stand down could not run, or stopped before its end. */
      finished: z.boolean(),
      headline: z.string(),
      failed: z.number().int(),
      problems: z.array(z.string()),
    })
    .optional(),
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
  /**
   * Set with `minimize`: what Windows says as the window goes away, so the moment before
   * the game shows does not read as a failure. The game by its own name.
   */
  starting: z.object({ title: z.string(), body: z.string() }).optional(),
});
export type LaunchResult = z.infer<typeof LaunchResultSchema>;

export const PreferencesSchema = z.object({
  /** After a successful launch, hide RigReady to the tray. */
  minimizeOnLaunch: z.boolean().default(true),
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
    state: channel(noInput, FlyStateSchema, {
      describe:
        'Lists every setup, the files that could not be loaded, and the setup in use with its checklist not yet checked. Start here: the profileId used by the other fly channels is a setup id from this list. Changes nothing.',
      tier: 'read',
    }),
    /** First run: the games, controllers and monitors found on this PC. */
    welcome: channel(noInput, WelcomeSchema, {
      describe:
        'Answers with the games, game controllers and monitors RigReady found on this PC, as the first-run screen shows them. Changes nothing.',
      tier: 'read',
    }),
    /** One profile's checklist skeleton, for switching without waiting for checks. */
    view: channel(ProfileRef, ProfileViewSchema, {
      describe:
        "Answers with one setup's checklist items and its Make ready, launch and Stand down actions, before any check runs. profileId is a setup id from fly:state. Changes nothing.",
      tier: 'read',
    }),
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
      ChecklistReportSchema,
      {
        describe:
          'Runs the checklist of one setup against the rig as it is now and answers with every item, met or not, and its fix. profileId comes from fly:state; remember (default true) also makes it the setup in use. Changes nothing on the rig.',
        tier: 'read',
      }
    ),
    /** Runs one item's check again. */
    checkItem: channel(ProfileRef.extend({ itemId: z.string() }), CheckResultSchema, {
      describe:
        'Runs the check of one checklist item again and answers with its result. profileId comes from fly:state and itemId from fly:check or fly:view. Changes nothing.',
      tier: 'read',
    }),
    /** Runs one item's fix, then its check: ok only when the check passes afterwards. */
    fix: channel(
      ProfileRef.extend({ itemId: z.string(), confirmed: z.boolean().default(false) }),
      z.object({ step: StepResultSchema, result: CheckResultSchema }),
      {
        describe:
          'Runs the fix of one checklist item, then checks it again; ok only when the check passes afterwards. Fixes that run a program run only with confirmed true, after the user agreed to the program named in the item. ids come from fly:check.',
        tier: 'change',
      }
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
      ActionReportSchema,
      {
        describe:
          'Make ready: runs every available fix of a setup in order, then checks everything again. Fixes that run a program run only when their item id is in approved; ask the user first. Call fly:check first and show the user what would be fixed.',
        tier: 'change',
      }
    ),
    /** Whether the game this setup launches is running (Stand down asks before closing it). */
    gameStatus: channel(
      ProfileRef,
      z.object({ running: z.boolean(), name: z.string().optional() }),
      {
        describe:
          'Says whether the game a setup launches is running now, and its name. Use it before fly:standDown to ask the user about closing the game. profileId comes from fly:state.',
        tier: 'read',
      }
    ),
    standDown: channel(
      ProfileRef.extend({ closeGame: z.boolean().default(false) }),
      ActionReportSchema.extend({ headline: z.string() }),
      {
        describe:
          "Stand down: runs a setup's Stand down actions, such as closing helper programs and putting the monitors back, and answers with what was done. closeGame true also closes the game; ask the user first and check fly:gameStatus.",
        tier: 'change',
      }
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
      LaunchResultSchema,
      {
        describe:
          "Play: runs a setup's pre-launch actions, starts the game, then runs post-launch actions in the background. Not blocked by failing checks, so run fly:check first. approved lists action ids the user agreed to run; resumeAfter continues after a paused action.",
        tier: 'launch',
      }
    ),
    /** The item's own confirm action ("Mark verified"); stores the new params, re-checks. */
    acknowledge: channel(ProfileRef.extend({ itemId: z.string() }), CheckResultSchema, {
      describe:
        "Runs a checklist item's own confirm action (such as Mark verified), which stores new values in the setup file, then checks it again. ids come from fly:check. Ask the user first.",
      tier: 'change',
    }),
    preferences: channel(noInput, PreferencesSchema, {
      describe:
        'Answers with the Play screen preferences: hide RigReady after a launch, and the ready tone. Changes nothing. (Stand down when the game closes is set per setup, in the setup itself.)',
      tier: 'read',
    }),
    setPreferences: channel(PreferencesPatchSchema, PreferencesSchema, {
      describe:
        'Changes the Play screen preferences; only the fields given change. See fly:preferences for the current values.',
      tier: 'change',
    }),
    /** Starts watching the profiles folder; `profilesChanged` fires within about 2 s of a change. */
    watch: channel(noInput, z.object({ watching: z.boolean() }), {
      describe:
        'Starts watching the setups folder so a window of the app hears about changed setups.',
      tier: 'off',
    }),
    /** The monitors as they are now, each with what is different from what the setup expects. */
    rig: channel(ProfileRef, RigGlanceSchema, {
      describe:
        'Answers with the monitors as they are now, each with what is different from what the setup expects, and the monitors it wants that are missing. profileId comes from fly:state. Changes nothing.',
      tier: 'read',
    }),
    /** The session of the moment: none, a game running, or one that just closed. */
    session: channel(noInput, SessionStateSchema, {
      describe:
        'Answers with the session of the moment: none, a game starting or running, or one that just closed. For one that closed it also says whether Stand down is counting down to run by itself (and when), is running, or what it did. Changes nothing.',
      tier: 'read',
    }),
    /** "Welcome back" was read: back to normal without standing down. */
    dismissSession: channel(noInput, SessionStateSchema, {
      describe:
        'Dismisses the welcome back notice of a closed session without running Stand down. A countdown to Stand down that is running is cancelled with it.',
      tier: 'read',
    }),
    /** Cancel on the countdown: Stand down does not run by itself this time. */
    cancelStandDown: channel(noInput, SessionStateSchema, {
      describe:
        'Cancels the countdown to the Stand down that runs by itself after the game closed. Nothing is closed or changed; Stand down can still be run by hand. Answers with the session as it is now: when Stand down had already started, it carries on and the answer says so.',
      tier: 'read',
    }),
    /** Every recorded session, newest first, and what they add up to. */
    history: channel(noInput, HistorySchema, {
      describe:
        'Answers with every recorded session, newest first, and the totals: time played, what had to be fixed most often, and the usual time to a ready rig. Changes nothing.',
      tier: 'read',
    }),
    /**
     * A window of RigReady says whether somebody is at it: true when the user does
     * something in it, false when it is hidden. A window that says nothing for a minute
     * counts as left alone. With nobody at a window, "welcome back" is a Windows
     * notification.
     */
    presence: channel(
      z.object({ window: z.string().min(1).max(40), visible: z.boolean() }),
      z.object({ attended: z.boolean() }),
      {
        describe:
          'A window of the app says whether somebody is at it, to choose between an in-app notice and a Windows notification.',
        tier: 'off',
      }
    ),
    /**
     * Opens the compact view (the dial, the setup switcher and the one action) in a small
     * window that stays on top, or brings it forward when it is open.
     */
    openCompact: channel(noInput, z.object({ opened: z.boolean() }), {
      describe: 'Opens the compact view of the Play screen in a small window that stays on top.',
      tier: 'off',
    }),
    /** Brings RigReady's main window forward, from the tray or from behind the game. */
    showMain: channel(noInput, z.object({ shown: z.boolean() }), {
      describe: "Brings RigReady's main window forward.",
      tier: 'off',
    }),
    /**
     * The setup the connected gear is for, when the one named is missing a device it
     * requires and another setup has all of its own. Null when there is nothing to offer.
     */
    suggestion: channel(ProfileRef, SuggestionSchema.nullable(), {
      describe:
        'When the named setup is missing a device it requires and another setup has all of its own connected, answers with that other setup; null otherwise. profileId comes from fly:state. An offer only; changes nothing.',
      tier: 'read',
    }),
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
